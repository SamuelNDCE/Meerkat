// secrets-plus: a zero-dependency scan of the files git tracks for provider-specific secrets (see thorough/rules-secrets-plus.mjs for the
// table) and for generic ones (a secret-like name assigned a quoted value, and high-entropy base64 or hex literals).
//
//   node secrets-plus.mjs secrets-plus                    scan the repository (files git tracks; a plain walk outside a repository)
//   node secrets-plus.mjs secrets-plus --root <dir>       scan another folder
//   node secrets-plus.mjs secrets-plus --include-tests    also scan tests, docs, fixtures and examples (skipped by default: they hold fake secrets on purpose)
//   node secrets-plus.mjs secrets-plus --fixtures         self-test: plant fake secrets in a temp folder and scan that (must exit 1)
//
// Output safety: a finding prints the rule id, file:line and at most 4 characters of the match, never the secret. Lines over 4000
// characters are skipped (and counted), and so are binary files.
//
// Switching findings off, nothing else does:
//   - `meerkat-allow: secret` in a comment on the line, or on the line above
//   - `.meerkat-secrets-plus-allow` at the root, one per line: a path glob (`config/dev/*`), or `rule-id path-glob` (`*` as the rule id means any rule). # starts a comment.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isFixture, main, trackedFiles, withFixture, progress } from './kit.mjs'
import { RULES } from './rules-secrets-plus.mjs'

export const MAX_LINE = 4000
const MAX_BYTES = 2_000_000
export const ALLOW_FILE = '.meerkat-secrets-plus-allow'
const MARKER = /meerkat-allow:\s*secret/i

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|target|\.git|coverage|out|release|\.next|site-packages)\//i
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|eot|exe|dll|pdb|rlib|so|dylib|wasm|mp[34]|mov|avi|webm|wav|ogg|class|jar|pyc|bin|dat|db|sqlite3?|psd|ai)$/i
const LOCK_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|bun\.lockb?|flake\.lock|packages\.lock\.json)$|\.lock$|\.min\.(js|css)$|\.map$|\.meerkat-[a-z-]*allow$/i
// Tests, docs, fixtures and examples hold fake secrets on purpose.
const SAMPLE_PATHS = /(^|\/)(tests?|__tests__|spec|specs|__fixtures__|fixtures?|testdata|test-fixtures|docs?|examples?|samples?|locales?|i18n|l10n|translations?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test[-_][^/]*$|[-_]tests?\.[a-z]+$|(^|\/)tests\.rs$/i

const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]')}$`)

export function readAllow(root) {
  const out = []
  try {
    for (const raw of readFileSync(join(root, ALLOW_FILE), 'utf8').split(/\r?\n/)) {
      const t = raw.trim()
      if (!t || t.startsWith('#')) continue
      const m = /^([a-z0-9][a-z0-9*-]*)\s+(\S+)$/.exec(t)
      out.push(m && (m[1] === '*' || RULES.some((r) => r.id === m[1])) ? { rule: m[1], path: globRe(m[2]) } : { rule: '*', path: globRe(t) })
    }
  } catch {
    /* no allow file */
  }
  return out
}

const wants = (rule, file) => (rule.files ? rule.files.test(file) : rule.ext ? rule.ext.includes((file.split('.').pop() ?? '').toLowerCase()) : true)

// What to print of a match: at most 4 characters, and only plain ones.
export const peek = (m) => String(m ?? '').slice(0, 4).replace(/[^\x21-\x7e]/g, '?')

// Rust test modules (#[cfg(test)] followed by mod x { ... }) hold fake secrets on purpose: returns their line indexes.
export function rustTestLines(lines) {
  const skip = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[cfg\(test\)\]/.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && /^\s*(#\[|\/\/)/.test(lines[j])) j++
    if (!/^\s*(?:pub(?:\([a-z]+\))?\s+)?mod\s+\w+\s*\{/.test(lines[j] ?? '')) continue
    let depth = 0
    for (let k = j; k < lines.length && k - j < 20000; k++) {
      skip.add(k)
      for (const ch of lines[k]) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0
      if (depth <= 0) {
        i = k
        break
      }
    }
  }
  return skip
}

// Scans a set of files (already chosen) and returns the findings. `read(file)` returns a Buffer or null.
export function scanText(file, text, rules, allow = []) {
  const found = []
  let skippedLong = 0
  const lines = text.split(/\r?\n/)
  const mine = rules.filter((r) => wants(r, file))
  const inTest = file.endsWith('.rs') ? rustTestLines(lines) : null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inTest?.has(i)) continue
    if (line.length < 8) continue
    if (line.length > MAX_LINE) {
      skippedLong++
      continue
    }
    if (MARKER.test(line) || (i > 0 && lines[i - 1].length <= MAX_LINE && MARKER.test(lines[i - 1]))) continue
    for (const r of mine) {
      let m
      if (r.find) m = r.find(line)
      else {
        const x = r.re.exec(line)
        m = x ? x[0] : null
      }
      if (m === null || m === undefined) continue
      if (allow.some((a) => (a.rule === '*' || a.rule === r.id) && a.path.test(file))) continue
      found.push({ rule: r.id, file, line: i + 1, peek: peek(m) })
    }
  }
  return { found, skippedLong }
}

export function scan(root, { includeTests = false, rules = RULES } = {}) {
  const allow = readAllow(root)
  const all = trackedFiles(root)
  const found = []
  const reachable = new Set() // ids of file-scoped rules that had a file to read
  let skippedLong = 0
  let binary = 0
  let big = 0
  let scanned = 0
  for (const file of all) {
    if (VENDORED.test(file) || LOCK_FILES.test(file) || BINARY_EXT.test(file)) continue
    if (!includeTests && (isFixture(file) || SAMPLE_PATHS.test(file))) continue
    for (const r of rules) if ((r.files || r.ext) && wants(r, file)) reachable.add(r.id)
    let buf
    try {
      if (statSync(join(root, file)).size > MAX_BYTES) {
        big++
        continue
      }
      buf = readFileSync(join(root, file))
    } catch {
      continue
    }
    progress.file(file)
    if (buf.subarray(0, 8000).includes(0)) {
      binary++
      continue
    }
    scanned++
    const r = scanText(file, buf.toString('utf8'), rules, allow)
    skippedLong += r.skippedLong
    found.push(...r.found)
  }
  return { found, skippedLong, binary, big, scanned, reachable }
}

function run(root, rest = []) {
  const { found, skippedLong, binary, big, scanned, reachable } = scan(root, { includeTests: rest.includes('--include-tests') })
  const hit = new Map()
  for (const f of found) hit.set(f.rule, (hit.get(f.rule) ?? 0) + 1)
  for (const r of RULES) {
    const reason = String(r.title).replace(/[\r\n]+/g, ' ').slice(0, 120)
    if ((r.files || r.ext) && !reachable.has(r.id)) console.log(`MEERKAT-SUB NA ${r.id} ${reason}`)
    else if (hit.has(r.id)) console.log(`MEERKAT-SUB FAIL ${r.id} ${hit.get(r.id)} found: ${reason}`)
    else console.log(`MEERKAT-SUB PASS ${r.id} ${reason}`)
  }
  console.log(`secrets-plus: ${scanned} file(s) scanned, ${binary} binary and ${big} oversized file(s) skipped`)
  if (skippedLong) console.log(`secrets-plus: skipped ${skippedLong} line(s) over ${MAX_LINE} characters (minified or pasted blobs are not scanned)`)
  if (!found.length) {
    console.log('secrets-plus: no secrets found')
    return 0
  }
  console.log(`secrets-plus: found ${found.length} possible secret(s) (only the first 4 characters are shown)`)
  for (const f of found.slice(0, 40)) console.log(`  ${f.file}:${f.line} ${f.rule} [${f.peek}]`)
  if (found.length > 40) console.log(`  ... and ${found.length - 40} more`)
  return 1
}

const sample = (id) => RULES.find((r) => r.id === id).bad

main({
  'secrets-plus': {
    run,
    fixture: () =>
      withFixture(
        {
          'src/config.js': `const key = '${sample('aws-access-key-id')}'\nconst gh = '${sample('github-pat-classic')}'\n${sample('generic-keyword-secret')}\n`,
          'deploy/key.txt': `${sample('pem-rsa-private-key')}\n`,
        },
        (dir) => run(dir, []),
      ),
  },
})
