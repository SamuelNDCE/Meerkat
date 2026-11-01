// secret-scan: a zero-dependency scan of the files git tracks for things that look like real secrets: cloud and service keys with a
// known shape, private key blocks, and long high-entropy values assigned to names such as "api_key" or "token". It never prints a
// whole secret, only where it is and the first characters.
//
//   node secret-scan.mjs                  scan the repository (files git tracks)
//   node secret-scan.mjs --root <dir>     scan another folder (plain walk when it is not a git repository)
//   node secret-scan.mjs --include-tests also scan test files and fixtures (skipped by default: they hold fake secrets on purpose)
//   node secret-scan.mjs --fixtures       self-test: plant fake secrets in a temp folder and scan that (must FAIL)
//
// Known and accepted findings go in `.meerkat-secrets-allow` at the root, one per line: a path glob (`docs/examples/*`), or
// `rule-name:some text on the line`. Lines starting with # are comments. Nothing else switches a finding off.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { argVal, fail, hasFlag, notRun, pass, repoRoot, say } from './lib.mjs'
import { FAKE_VALUE, configPath, isTestFile, rustTestLines } from './kit.mjs'

const RULES = [
  { name: 'aws-access-key-id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'stripe-live-key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'json-web-token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // A value of 24 or more characters assigned to a name that says it is a secret, and that looks random.
  { name: 'secret-assignment', re: /\b(?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\b["']?\s*[:=]\s*["']([A-Za-z0-9/+_=.-]{24,})["']/i, entropy: 3.6 },
]
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'dist-electron', 'build', '.next', 'coverage'])
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|\.meerkat-secrets-allow)$|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|exe|dll|pdb|rlib|wasm|mp[34]|svg)$/i
// Test files and fixtures hold fake secrets on purpose (a project that tests its own secret detector has hundreds), so they are not scanned
// unless asked (--include-tests). A real secret pasted into a test is still a risk: scan them now and then.
const TEST_FILES = /(^|\/)(__fixtures__|__tests__|fixtures?|testdata|test-fixtures)\/|\.(test|spec)\.[a-z]+$/i
const MAX_BYTES = 1_000_000

function entropy(text) {
  const counts = new Map()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / text.length) * Math.log2(n / text.length)
  return h
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const files = out.split('\0').filter(Boolean)
    if (files.length) return files
  } catch {
    /* not a git repository: walk instead */
  }
  const files = []
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name)
      } else files.push(rel ? `${rel}/${e.name}` : e.name)
    }
  }
  walk(root, '')
  return files
}

const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)

function loadAllow(root) {
  const entries = []
  try {
    for (const line of readFileSync(configPath(root, '.meerkat-secrets-allow'), 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf(':')
      if (i > 0 && /^[a-z-]+$/.test(t.slice(0, i))) entries.push({ rule: t.slice(0, i), text: t.slice(i + 1).trim() })
      else entries.push({ path: globToRe(t) })
    }
  } catch {
    /* no allow list */
  }
  return entries
}

export function scan(root) {
  const allow = loadAllow(root)
  const findings = []
  let scanned = 0
  for (const rel of listFiles(root)) {
    const norm = rel.split(path.sep).join('/')
    if (SKIP_FILES.test(norm) || norm.split('/').some((p) => SKIP_DIRS.has(p))) continue
    if (!hasFlag('--include-tests') && (TEST_FILES.test(norm) || isTestFile(norm))) continue
    if (allow.some((a) => a.path && a.path.test(norm))) continue
    let buf
    try {
      if (statSync(path.join(root, rel)).size > MAX_BYTES) continue
      buf = readFileSync(path.join(root, rel))
    } catch {
      continue
    }
    if (buf.includes(0)) continue // binary
    scanned++
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    // Rust unit tests sit in the same file as the code, in a #[cfg(test)] module: fake secrets there are on purpose.
    const inTest = hasFlag('--include-tests') ? () => false : rustTestLines(norm, text)
    lines.forEach((line, i) => {
      if (line.length > 2000 || inTest(i + 1)) return
      for (const rule of RULES) {
        const m = rule.re.exec(line)
        if (!m) continue
        const value = m[1] ?? m[0]
        if (rule.entropy && entropy(value) < rule.entropy) continue
        // A value that says it is fake (FAKE_TOKEN, SUPERSECRET) is not a secret. A key block mentioned in a comment has no key body under it.
        if (!hasFlag('--include-tests') && (FAKE_VALUE.test(value) || FAKE_VALUE.test(m[0]))) continue
        // Only a header in a comment, with no key text after it on the same line (also after a literal \n) or on the next, is a mention and not a key.
        // The same for a constant that is the header alone (`const PEM_BEGIN = "-----BEGIN PRIVATE KEY-----"`): the line ends right after it.
        if (rule.name === 'private-key-block') {
          const after = line.slice(m.index + m[0].length).replace(/\\n/g, '\n')
          const noBody = !/^[\s"'\\]*[A-Za-z0-9+/=]{10,}/.test(after) && !/^[A-Za-z0-9+/=]{10,}/.test((lines[i + 1] ?? '').trim())
          if (noBody && (/^\s*(?:\/\/|#|\*|\/\*|--\s)/.test(line) || /^["'`]?[\s)\],;}]*$/.test(after.trim()))) continue
        }
        if (allow.some((a) => a.rule === rule.name && line.includes(a.text))) continue
        findings.push({ file: norm, line: i + 1, rule: rule.name, sample: `${value.slice(0, 4)}...` })
      }
    })
  }
  return { findings, scanned }
}

function main() {
  if (hasFlag('--fixtures')) {
    // Plant fake secrets (assembled here, so this source holds no token-shaped text) in a temp folder and scan it: must find them.
    const dir = mkdtempSync(path.join(tmpdir(), 'meerkat-secrets-'))
    try {
      mkdirSync(path.join(dir, 'src'))
      writeFileSync(path.join(dir, 'src', 'config.js'), `const aws = '${'AKIA' + 'IOSFODNN7EXAMPLE'}'\nconst gh = '${'ghp_' + '0123456789abcdefghijklmnopqrstuvwxyz'}'\n`)
      writeFileSync(path.join(dir, 'key.pem'), `${'-----BEGIN ' + 'RSA PRIVATE KEY-----'}\nMIIBOgIBAAJBAK\n`)
      const { findings } = scan(dir)
      say(`planted 3 fake secrets, found ${findings.length}`)
      if (findings.length) fail(`${findings.length} secret(s) found (expected: this is the self-test fixture)`)
      pass('the scanner found nothing in a folder with planted secrets, so it cannot be trusted')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const root = argVal('--root') ?? repoRoot
  try {
    statSync(root)
  } catch {
    notRun(`${root} does not exist`)
  }
  const { findings, scanned } = scan(root)
  say(`scanned ${scanned} files`)
  for (const f of findings.slice(0, 25)) say(`  ${f.file}:${f.line}  ${f.rule}  ${f.sample}`)
  if (findings.length) fail(`${findings.length} possible secret(s). Remove them (and rotate the key), or add an accepted one to .meerkat-secrets-allow`)
  pass(`no secrets found in ${scanned} files`)
}

main()
