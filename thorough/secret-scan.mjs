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
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { argVal, fail, hasFlag, notRun, pass, repoRoot, say } from './lib.mjs'
import { FAKE_VALUE, configPath, isPlaceholderValue, isTestFile, rustTestLines } from './kit.mjs'

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
// Files above this are not read and are reported NOT SCANNED (a big file is scanned in chunks, so this is only a sanity bound).
const MAX_BYTES = Number(process.env.MEERKAT_SECRET_SCAN_MAX) || 50_000_000

function entropy(text) {
  const counts = new Map()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) h -= (n / text.length) * Math.log2(n / text.length)
  return h
}

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
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

// Files are read in chunks of CHUNK_BYTES, cut at the last line break, and the last HOLD_LINES complete lines stay in the next chunk, so a secret that
// straddles a chunk boundary (or a key block whose body is a few lines below its header) is still seen whole. Above MAX_BYTES a file is not read at all.
const CHUNK_BYTES = Math.max(64, Number(process.env.MEERKAT_SECRET_SCAN_CHUNK) || 1_000_000)
const HOLD_LINES = 9
const MAX_LINE = 2000

// Yields { lines, base, count }: the lines to read, the line number of lines[0], and how many leading lines to report on (the rest wait for the next chunk).
// Yields { binary: true } and stops when the file holds a zero byte.
function* chunkedLines(full, size) {
  const fd = openSync(full, 'r')
  try {
    let carry = Buffer.alloc(0)
    let base = 1
    let skipping = false // inside a line already known to be longer than MAX_LINE: dropped up to its line break
    const chunk = Buffer.alloc(size)
    for (;;) {
      const n = readSync(fd, chunk, 0, size, null)
      const eof = n === 0
      let piece = chunk.subarray(0, n)
      if (piece.includes(0)) {
        yield { binary: true }
        return
      }
      if (skipping) {
        const nl = piece.indexOf(10)
        if (nl < 0) {
          if (eof) return
          continue
        }
        skipping = false
        base++ // the dropped long line
        piece = piece.subarray(nl + 1)
      }
      const buf = Buffer.concat([carry, piece])
      const cut = eof ? buf.length : buf.lastIndexOf(10)
      if (cut < 0) {
        if (buf.length > MAX_LINE + 1) {
          skipping = true // this line is longer than MAX_LINE and is skipped anyway
          carry = Buffer.alloc(0)
        } else carry = buf
        continue
      }
      const lines = buf.subarray(0, cut).toString('utf8').split(/\r?\n/)
      const rest = eof ? Buffer.alloc(0) : buf.subarray(cut + 1)
      const count = eof ? lines.length : Math.max(0, lines.length - HOLD_LINES)
      if (count > 0 || eof) yield { lines, base, count }
      base += count
      carry = Buffer.concat([Buffer.from(lines.slice(count).map((l) => `${l}\n`).join('')), rest])
      if (eof) return
    }
  } finally {
    closeSync(fd)
  }
}

export function scan(root) {
  const allow = loadAllow(root)
  const findings = []
  const notScanned = [] // { file, reason }: files that were NOT read, never a silent pass
  let scanned = 0
  let binary = 0
  for (const rel of listFiles(root)) {
    const norm = rel.split(path.sep).join('/')
    if (SKIP_FILES.test(norm) || norm.split('/').some((p) => SKIP_DIRS.has(p))) continue
    if (!hasFlag('--include-tests') && (TEST_FILES.test(norm) || isTestFile(norm))) continue
    if (allow.some((a) => a.path && a.path.test(norm))) continue
    const full = path.join(root, rel)
    let size
    try {
      size = statSync(full).size
    } catch (e) {
      notScanned.push({ file: norm, reason: `unreadable (${e.code ?? 'error'})` })
      continue
    }
    if (size > MAX_BYTES) {
      notScanned.push({ file: norm, reason: `too large (${(size / 1_000_000).toFixed(1)} MB, limit ${MAX_BYTES / 1_000_000} MB)` })
      continue
    }
    // Rust unit tests sit in the same file as the code, in a #[cfg(test)] module: fake secrets there are on purpose.
    let inTest = () => false
    if (!hasFlag('--include-tests') && /\.rs$/i.test(norm)) {
      try {
        inTest = rustTestLines(norm, readFileSync(full, 'utf8'))
      } catch {
        /* the read below reports it */
      }
    }
    const before = findings.length
    let isBinary = false
    try {
      for (const part of chunkedLines(full, Math.min(CHUNK_BYTES, size + 1))) {
        if (part.binary) {
          isBinary = true
          break
        }
        for (let i = 0; i < part.count; i++) scanLine(part.lines, i, part.base + i, norm, inTest, allow, findings)
      }
    } catch (e) {
      findings.length = before
      notScanned.push({ file: norm, reason: `unreadable (${e.code ?? 'error'})` })
      continue
    }
    if (isBinary) {
      findings.length = before
      binary++
      notScanned.push({ file: norm, reason: 'binary, skipped by design', byDesign: true })
      continue
    }
    scanned++
  }
  return { findings, scanned, notScanned, binary }
}

function scanLine(lines, i, lineNo, norm, inTest, allow, findings) {
  const line = lines[i]
  if (line.length > MAX_LINE || inTest(lineNo)) return
  for (const rule of RULES) {
    const m = rule.re.exec(line)
    if (!m) continue
    const value = m[1] ?? m[0]
    if (rule.entropy && entropy(value) < rule.entropy) continue
    // A value that says it is fake (FAKE_TOKEN, SUPERSECRET) is not a secret. A key block mentioned in a comment has no key body under it.
    if (!hasFlag('--include-tests') && (FAKE_VALUE.test(value) || FAKE_VALUE.test(m[0]) || (rule.entropy && isPlaceholderValue(value)))) continue
    // Only a header in a comment, with no key text after it on the same line (also after a literal \n) or on the next, is a mention and not a key.
    // The same for a constant that is the header alone (a constant named PEM_BEGIN that holds only the header text): the line ends right after it.
    if (rule.name === 'private-key-block') {
      const after = line.slice(m.index + m[0].length).replace(/\\n/g, '\n')
      // A key body can follow after blank lines or armor headers (Proc-Type, DEK-Info), and a commented-out key has a comment prefix on every line.
      const below = lines.slice(i + 1, i + 9).map((l) => l.replace(/^\s*(?:\/\/|#|\*|--\s?|\+|\.\.)?\s*["'`]?/, '')).join('\n')
      const noBody = !/^[\s"'`\\]*[A-Za-z0-9+/=]{10,}/.test(after) && !/(?:^|\n)[A-Za-z0-9+/=]{10,}/.test(below)
      if (noBody && (/^\s*(?:\/\/|#|\*|\/\*|--\s)/.test(line) || /^["'`]?[\s)\],;}]*$/.test(after.trim()))) continue
    }
    if (allow.some((a) => a.rule === rule.name && line.includes(a.text))) continue
    findings.push({ file: norm, line: lineNo, rule: rule.name, sample: `${value.slice(0, 4)}...` })
  }
}

function main() {
  if (hasFlag('--fixtures')) {
    // Plant fake secrets (assembled here, so this source holds no token-shaped text) in a temp folder and scan it: must find them.
    const dir = mkdtempSync(path.join(tmpdir(), 'meerkat-secrets-'))
    try {
      mkdirSync(path.join(dir, 'src'))
      writeFileSync(path.join(dir, 'src', 'config.js'), `const aws = '${'AKIA' + 'QWERTYUIOPASDFGH'}'\nconst gh = '${'ghp_' + '0123456789abcdefghijklmnopqrstuvwxyz'}'\n`)
      writeFileSync(path.join(dir, 'key.pem'), `${'-----BEGIN ' + 'RSA PRIVATE KEY-----'}\nMIIBOgIBAAJBAK\n`)
      const { findings } = scan(dir)
      // The planted secrets must be found BY RULE. Any other failure (git printing "fatal: not a git repository", a crash) is not a detection.
      const rules = new Set(findings.map((f) => f.rule))
      const want = ['aws-access-key-id', 'github-token', 'private-key-block']
      const missing = want.filter((r) => !rules.has(r))
      say(`planted ${want.length} fake secrets, found ${findings.length}: ${[...rules].join(', ') || 'none'}`)
      if (!missing.length) fail(`self-test: planted secrets found by rule (${want.join(', ')}); expected, this is the self-test fixture`)
      pass(`self-test FAILED: the scanner did not find the planted secret(s) for ${missing.join(', ')}, so it cannot be trusted`)
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
  const { findings, scanned, notScanned, binary } = scan(root)
  say(`scanned ${scanned} files`)
  for (const f of findings.slice(0, 25)) say(`  ${f.file}:${f.line}  ${f.rule}  ${f.sample}`)
  const risky = notScanned.filter((n) => !n.byDesign)
  for (const n of risky.slice(0, 25)) say(`  NOT SCANNED: ${n.file}  ${n.reason}`)
  if (risky.length > 25) say(`  ... and ${risky.length - 25} more NOT SCANNED`)
  say(`NOT SCANNED: ${notScanned.length} file(s) (${binary} binary skipped by design, ${risky.length} too large or unreadable)`)
  if (findings.length) fail(`${findings.length} possible secret(s). Remove them (and rotate the key), or add an accepted one to .meerkat-secrets-allow`)
  if (risky.length) pass(`WARNING: no secrets found in the ${scanned} files scanned, but ${risky.length} file(s) were NOT SCANNED (listed above) and are unchecked; ${binary} binary skipped by design`)
  pass(`no secrets found in ${scanned} files scanned (${notScanned.length} NOT SCANNED: ${binary} binary skipped by design, 0 too large or unreadable)`)
}

main()
