// Shared helpers for the zero-dependency check scripts (hygiene, perf, ai). A script is run as
//   node <script> <check> [--root <dir>] [--fixtures]
// Exit codes: 0 = clean, 1 = findings (fails the run), 75 = cannot run here (reported as NOT RUN, never as a pass).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createProgressEmitter } from '../lib/progress-files.mjs'
import { formatFindingLine } from '../lib/findings.mjs'

export const NOT_RUN = 75

// What this check is looking at, for the live board (lib/progress-files.mjs). Silent unless the runner sets MEERKAT_PROGRESS.
export { createProgressEmitter }
export const progress = createProgressEmitter()
export const BUDGET_FILE = '.meerkat-budgets.json'

export function parseArgs(argv) {
  const out = { check: argv[2], root: process.cwd(), fixtures: false, rest: [] }
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = argv[++i]
    else if (argv[i] === '--fixtures') out.fixtures = true
    else out.rest.push(argv[i])
  }
  return out
}

// The files git tracks (so ignored build output and node_modules are never scanned); a plain walk when the folder is not a repository.
export function trackedFiles(root) {
  const list = applyMeerkatIgnore(root, listTrackedFiles(root))
  progress.total(list.length)
  return list
}

// .meerkatignore: one pattern per line at the project root (# comments and blank lines ignored). Rules, in the style of .gitignore:
//   dir/        a folder and everything under it     *.min.js   no slash: matches at any depth
//   a/b/c.txt   a slash anchors it to the root        *  inside one path part     **  across parts     ?  one character
//   !pattern    re-includes what an earlier line ignored (the last matching line wins)
export const MEERKATIGNORE_FILE = '.meerkatignore'
// Never ignorable, so a typo in .meerkatignore cannot hide the supply-chain checks.
const NEVER_IGNORED = /(^|\/)(\.meerkatignore|package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|cargo\.toml|go\.mod|go\.sum|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|gemfile\.lock|composer\.(json|lock)|licen[cs]e[^/]*|copying[^/]*)$/i

export function parseMeerkatIgnore(text) {
  const rules = []
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    const dirOnly = line.endsWith('/')
    line = line.replace(/\/+$/, '')
    if (!line) continue
    const anchored = line.startsWith('/') || line.includes('/')
    line = line.replace(/^\/+/, '')
    let body = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '*' && line[i + 1] === '*') {
        i++
        if (line[i + 1] === '/') {
          i++
          body += '(?:.*/)?'
        } else body += '.*'
      } else if (c === '*') body += '[^/]*'
      else if (c === '?') body += '[^/]'
      else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    rules.push({ negate, re: new RegExp((anchored ? '^' : '(?:^|/)') + body + (dirOnly ? '/' : '(?:/|$)')) })
  }
  return rules
}

export function isMeerkatIgnored(rules, file) {
  const f = file.split('\\').join('/')
  if (NEVER_IGNORED.test(f)) return false
  let ignored = false
  for (const r of rules) if (r.re.test(f)) ignored = !r.negate
  return ignored
}

export function applyMeerkatIgnore(root, list) {
  let text
  try {
    text = readFileSync(join(root, MEERKATIGNORE_FILE), 'utf8')
  } catch {
    return list
  }
  const rules = parseMeerkatIgnore(text)
  if (!rules.length) return list
  const kept = list.filter((f) => !isMeerkatIgnored(rules, f))
  if (kept.length !== list.length) process.stderr.write(`ignored ${list.length - kept.length} files by ${MEERKATIGNORE_FILE}\n`)
  return kept
}

function listTrackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
    return out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)))
  } catch {
    const files = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        // With no git to say what is tracked, leave out what no project commits: dependency folders, virtual environments and tool caches.
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || /^(__pycache__|\.venv|venv|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox)$/.test(e.name)) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else files.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    return files
  }
}

// Folders that hold deliberately broken files for tests: the hygiene checks leave them alone.
export const isFixture = (f) => /(^|\/)(fixtures?|testdata|__fixtures__|test-fixtures)\//i.test(f)

// Test code is not shipped and holds fake secrets on purpose, so the secret checks leave it alone: test folders, *.test.* and *.spec.* files, *_test.rs/go/py
// and test_*.py. Rust unit tests live in the same file as the code, in a module after #[cfg(test)]: rustTestStart gives the 1-based line where it begins.
export const isTestFile = (f) => isFixture(f) || /(^|\/)(tests?|__tests__|e2e|spec)\//i.test(f) || /(^|\/)(?:scripts|tools|supabase|qa|e2e)\/probes?\//i.test(f) || /\.(test|spec)\.[a-z]+$/i.test(f) || /(^|\/)[\w.-]+_tests?\.(rs|go|py)$/i.test(f) || /(^|\/)test_[\w.-]+\.py$/i.test(f) || /(^|\/)tests\.rs$/i.test(f) || /[-_.]fixtures?\.[a-z]+$/i.test(f) || /(^|\/)test[_-]?(?:support|utils?|helpers?)\.[a-z]+$/i.test(f) || /(^|\/)probe-[\w.-]+\.(?:[cm]?[jt]s|py)$/i.test(f)
// Returns a function: is this 1-based line inside a `#[cfg(test)] mod name { ... }` block? Only that block counts (found by matching braces, with string and char
// literals blanked first); an attribute that is not followed by a module, or a block that never closes, covers nothing.
export const rustTestLines = (file, text) => {
  if (!/\.rs$/i.test(file) || !text.includes('#[cfg(test)]')) return () => false
  // Raw strings (r#"..."#), strings, char literals and comments are blanked (same length, newlines kept) so a brace inside one is not counted.
  const blanked = text.replace(/(?<![A-Za-z0-9_])(?:b|c)?r(#*)"[\s\S]*?"\1|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\\n]|\\.)'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, ' '))
  const ranges = []
  for (const m of blanked.matchAll(/^[ \t]*#\[cfg\(test\)\][ \t]*\r?\n(?:[ \t]*#\[[^\]\n]*\][ \t]*\r?\n)*[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/gm)) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < blanked.length; i++) {
      if (blanked[i] === '{') depth++
      else if (blanked[i] === '}' && --depth === 0) {
        ranges.push([blanked.slice(0, m.index).split('\n').length, blanked.slice(0, i).split('\n').length])
        break
      }
    }
  }
  return (line) => ranges.some(([a, b]) => line >= a && line <= b)
}
// Replaces the text of string literals with spaces (newlines kept), so what is left is the code around them. A small scanner, not a regex, because template literals nest:
// the text of `a ${ f(`b`) } c` is blanked but its hole `${ ... }` stays as code, with its own strings blanked inside it. Raw strings (Rust r#"..."#), single-line quotes,
// and comments (// and /* */, and # in Python) are understood, so an apostrophe or a backtick in a comment never opens a string. A template literal that is never closed
// is left as code, and a template literal with no hole is blanked completely, backticks included. Anything unclear is left unblanked: the result then reads as code.
export function blankStrings(text, lang = 'js') {
  // lang: js (JavaScript and TypeScript), py, go or rs. A backtick means a template literal only in js, a raw string (no escapes) in go, and nothing in py or rs.
  const python = lang === 'py'
  const n = text.length
  const spaces = (s) => s.replace(/[^\n]/g, ' ')
  const raw = /(?<![A-Za-z0-9_])(?:b|c)?r(#*)"/y
  // text[start] is a backtick; returns [output, end index]
  const template = (start) => {
    let i = start + 1
    let out = '`'
    let hole = false
    while (i < n) {
      const c = text[i]
      if (c === '\\') { out += spaces(text.slice(i, i + 2)); i += 2; continue }
      if (c === '`') { out += '`'; return [hole ? out : spaces(out), i + 1] }
      if (c === '$' && text[i + 1] === '{') {
        hole = true
        let depth = 1
        let j = i + 2
        let inner = '${'
        while (j < n && depth > 0) {
          const d = text[j]
          if (d === '`') { const [t, e] = template(j); inner += t; j = e; continue }
          if (d === '"' || d === "'") {
            let k = j + 1
            while (k < n && text[k] !== d && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1
            inner += spaces(text.slice(j, Math.min(n, k + 1)))
            j = Math.min(n, k + 1)
            continue
          }
          if (d === '{') depth++
          else if (d === '}') depth--
          inner += d
          j++
        }
        out += inner
        i = j
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i++
    }
    return [text.slice(start), n] // never closed: leave it as code
  }
  let out = ''
  let i = 0
  while (i < n) {
    const c = text[i]
    if (!python && c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; out += text.slice(i, end); i = end; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += text.slice(i, end); i = end; continue }
    if (python && c === '#') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; out += text.slice(i, end); i = end; continue }
    if (lang === 'js' && c === '/') {
      // A regex literal can hold a quote or a backtick (/`/g), which must not open a string or a template. It starts where a value is expected: after ( , = : [ ! & | ? { } ; or at the start.
      let p = out.length - 1
      while (p >= 0 && /\s/.test(out[p])) p-- // walk back over trailing whitespace; never copy the whole buffer
      const prev = p < 0 ? '' : out[p]
      if (prev === '' || '(,=:[!&|?{};'.includes(prev)) {
        let k = i + 1
        let cls = false
        while (k < n && text[k] !== '\n' && (cls || text[k] !== '/')) {
          if (text[k] === '\\') k++
          else if (text[k] === '[') cls = true
          else if (text[k] === ']') cls = false
          k++
        }
        if (k < n && text[k] === '/') { out += text.slice(i, k + 1); i = k + 1; continue }
      }
    }
    if (c === '"' || c === "'") {
      raw.lastIndex = i
      let k = i + 1
      while (k < n && text[k] !== c && text[k] !== '\n') k += text[k] === '\\' ? 2 : 1
      if (k < n && text[k] === c) { out += spaces(text.slice(i, k + 1)); i = k + 1; continue }
      out += c; i++; continue // an apostrophe that opens nothing
    }
    if (c === '`' && lang === 'js') { const [t, e] = template(i); out += t; i = e; continue }
    if (c === '`' && lang === 'go') { const e = text.indexOf('`', i + 1); const end = e < 0 ? n : e + 1; out += e < 0 ? text.slice(i) : spaces(text.slice(i, end)); i = end; continue }
    if (lang === 'rs' && (c === 'r' || c === 'b' || c === 'c')) {
      raw.lastIndex = i
      const m = raw.exec(text)
      if (m) {
        const close = text.indexOf('"' + m[1], i + m[0].length)
        if (close >= 0) { const end = close + 1 + m[1].length; out += spaces(text.slice(i, end)); i = end; continue }
      }
    }
    out += c
    i++
  }
  return out
}
// Returns a function: is this 1-based line only string literals and punctuation (a table of sample code a detector or a test feeds to itself, such as
// `("js", r#"db.query(...)"#),`, or a line inside a multi-line string)? Strings are blanked first, raw and multi-line ones too; a line with any identifier left
// outside a string is code and is not data. Only for checks that look for code patterns; never for secrets, where the string itself is the problem.
export const langOf = (file) => (/\.rs$/i.test(file) ? 'rs' : /\.py$/i.test(file) ? 'py' : /\.go$/i.test(file) ? 'go' : /\.[cm]?[jt]sx?$/i.test(file) ? 'js' : '')
export const stringOnlyLines = (file, text) => {
  const lang = langOf(file)
  if (!lang) return () => false
  const lines = text.split('\n')
  const blank = blankStrings(text, lang).split('\n')
  return (line) => {
    const o = (lines[line - 1] ?? '').trim()
    const b = blank[line - 1]
    if (o === '' || b === undefined || /^\s*(?:\/\/|#|\/\*|\*)/.test(o)) return false
    // In a Rust table of (language, sample) pairs, field names (`bad:`), `&`, `vec!` and `Some(` around the strings are part of the table; on a line with no tuple
    // (`origin: "*",`) a label is a configuration field and the line is code. In other languages `key: "value"` is always configuration.
    // The descriptive fields of a rules table (a pattern, the reason, the advice) hold regexes and prose, never configuration values, so they count as table fields too.
    // Exactly one field on the line, holding one string: the array forms (`bad: &[(...)]`) are judged as tuples below.
    const descriptive = lang === 'rs' && (b.match(/\b\w+\s*:(?!:)/g) ?? []).length === 1 && /^(?:pat|pattern|why|instead|title|msg|message|hint|note|reason|help|desc|description|example)\s*:\s*(?:r#*"|")/.test(o)
    const rest = lang === 'rs' && (b.includes('(') || descriptive) ? b.replace(/\b\w+\s*:(?!:)/g, ' ').replace(/&|\bvec!|\bSome\b/g, ' ') : b
    if (!/^[,;()[\]{}\s]*$/.test(rest)) return false
    // The strings must be sample CODE: the text that was blanked contains a call (this also covers the first line of a multi-line string), or nothing was blanked.
    const orig = lines[line - 1] ?? ''
    let content = ''
    for (let k = 0; k < orig.length && k < b.length; k++) if (b[k] === ' ' && !/\s/.test(orig[k])) content += orig[k]
    // Or the line is a (language tag, code) pair, the shape of a detector's sample table: `("java", r##"..."##)`, also after a field name (`bad: &[("php", ...)]`).
    // Only in Rust, only when it is the one tuple on the line, and only when the second string has code in it (an assignment, a statement end, a call, a variable or a brace),
    // so `("js", "postgres://user:pw@host")` and `("go", "45.33.12.9")` are still read as the values they are.
    const tagged = lang === 'rs' && (b.match(/\(/g) ?? []).length === 1 && /[=;($<{]/.test(content.replace(/^r?#*"?[a-z]+"?#*/i, '')) &&
      /^\s*(?:\w+\s*:\s*&?\[)?\(\s*r?#*"(?:js|jsx|ts|tsx|py|java|php|go|rs|rb|cs|kt|sh|bash|cpp|html|sql|yaml|toml|xml)"#*\s*,/.test(orig)
    return content === '' || tagged || descriptive || /[\w\])]\s*\(/.test(content)
  }
}
// A value that says it is not real. It is the value itself that has to say so (FAKE_TOKEN, SUPERSECRET, example.com), never the file.
export const FAKE_VALUE = /fake|dummy|placeholder|supersecret|not[-_]?(?:a[-_])?real|redacted|changeme|example|sample|[_-]test[_-]|your[-_]?(?:key|token|secret)/i

// Settings files (.meerkat-budgets.json and every .meerkat-<area>-allow) may sit in the project root or, to keep the root tidy, in a .meerkat/ folder;
// the folder wins when the file is in both.
const CONFIG_NAME = /^\.meerkat-(?:budgets\.json|[a-z-]+-allow)$/
export const configPath = (root, f) => (CONFIG_NAME.test(f) && existsSync(join(root, '.meerkat', f)) ? join(root, '.meerkat', f) : join(root, f))

export const readText = (root, f) => {
  progress.file(f)
  try {
    return readFileSync(configPath(root, f), 'utf8')
  } catch {
    return ''
  }
}

export const readBudgets = (root) => {
  try {
    return JSON.parse(readFileSync(configPath(root, BUDGET_FILE), 'utf8'))
  } catch {
    return null
  }
}

export const isText = (f) => /\.(m?[jt]sx?|json|md|html?|css|scss|rs|toml|ya?ml|py|go|sh|ps1|txt|svelte|vue)$/i.test(f)

// Print findings (capped) and return the exit code.
// `structured` (an option) says the caller reports every finding itself with finding(), so the extras beyond the printed 25 are not repeated here.
export function finish(name, findings, okNote = 'nothing found', { structured = false } = {}) {
  if (!findings.length) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  console.log(`${name}: found ${findings.length}`)
  for (const f of findings.slice(0, 25)) console.log(`  ${f}`)
  if (findings.length > 25 && structured) console.log(`  ... and ${findings.length - 25} more`)
  else if (findings.length > 25) {
    console.log(`  ... and ${findings.length - 25} more`)
    // The printed list stays short, but every finding beyond it is still reported to Meerkat (the finding protocol), so none is lost from findings.json.
    const sev = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY ?? '') ? process.env.MEERKAT_DEFAULT_SEVERITY : 'medium'
    for (const f of findings.slice(25)) {
      const m = /^(\S+?):(\d+)\s+(.+)$/s.exec(String(f))
      if (m) finding(sev, '-', m[1], Number(m[2]), m[3].replace(/\s+/g, ' ').slice(0, 8000))
    }
  }
  return 1
}

// Tell Meerkat about one detection (the finding protocol, lib/findings.mjs). Pure addition to the usual output: a check still prints its own
// lines and returns its own exit code. Returns the line printed, or null when an argument was not valid (nothing is printed then).
export function finding(severity, ruleId, file, line, message) {
  const text = formatFindingLine(severity, ruleId, file, line, message)
  if (text) console.log(text)
  return text
}

export function notRun(message) {
  console.log(`NOT RUN: ${message}`)
  return NOT_RUN
}

// Fixtures mode: build a throwaway folder containing one deliberate violation, run the check on it, and return the check's own exit code.
// A check that finds nothing in its fixture returns 0 here, which the self-test reports as a check that has stopped working.
export async function withFixture(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fixture-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, name)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body)
    }
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const sizeOf = (p) => {
  try {
    const s = statSync(p)
    if (!s.isDirectory()) return s.size
    return readdirSync(p).reduce((n, e) => n + sizeOf(join(p, e)), 0)
  } catch {
    return 0
  }
}

export async function main(checks, argv = process.argv) {
  const a = parseArgs(argv)
  const check = checks[a.check]
  if (!check) {
    console.log(`unknown check "${a.check}". Checks here: ${Object.keys(checks).join(', ')}`)
    process.exit(2)
  }
  const code = a.fixtures ? await check.fixture() : await check.run(a.root, a.rest)
  // Let the event loop drain instead of process.exit(): on Windows an exit with open sockets can abort with a libuv assertion (exit 127).
  process.exitCode = code
  setTimeout(() => process.exit(code), 3000).unref()
}
