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
  // ignorePaths from meerkat.config.json, set by the run for this preset (lib/ignorepaths.mjs).
  let fromConfig = []
  try {
    const p = JSON.parse(process.env.MEERKAT_IGNORE_PATHS || '[]')
    if (Array.isArray(p)) fromConfig = parseMeerkatIgnore(p.filter((x) => typeof x === 'string').join(String.fromCharCode(10)))
  } catch {
    /* a value that is not JSON leaves nothing out */
  }
  let text = null
  try {
    text = readFileSync(join(root, MEERKATIGNORE_FILE), 'utf8')
  } catch {
    /* no .meerkatignore */
  }
  const rules = text === null ? [] : parseMeerkatIgnore(text)
  const all = [...rules, ...fromConfig]
  if (!all.length) return list
  const kept = list.filter((f) => !isMeerkatIgnored(all, f))
  if (rules.length && kept.length !== list.length && !fromConfig.length) process.stderr.write(`ignored ${list.length - kept.length} files by ${MEERKATIGNORE_FILE}\n`)
  return kept
}

// In a worker (lib/inproc-worker.mjs) the file list of a folder is made once per run: the git index is checked (size and modified time) before the list is
// reused, and the worker is gone at the end of the run. A process makes it every time, as before.
const listCache = new Map()
export function listTrackedFiles(root) {
  if (!globalThis.__meerkatReadCache) return makeTrackedList(root)
  let stamp = ''
  try {
    const st = statSync(join(root, '.git', 'index'))
    stamp = `${st.mtimeMs}:${st.size}`
  } catch {
    /* no index to compare: the list is still reused for this run */
  }
  const hit = listCache.get(root)
  if (hit && hit.stamp === stamp) return hit.list.slice()
  const list = makeTrackedList(root)
  listCache.set(root, { stamp, list })
  return list.slice()
}

function makeTrackedList(root) {
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
// Rust source with raw strings, strings, char literals and comments blanked (same length, newlines kept). The char literal comes before the string
// alternative so a '"' cannot open a string that swallows the code after it.
// 1-based line of a character index, by binary search over the newline positions (made once), instead of splitting the text up to the index every time.
export const lineCounter = (text) => {
  const nl = []
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i)
  return (index) => {
    let lo = 0
    let hi = nl.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (nl[mid] < index) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }
}
// Pure functions of the text, asked again and again for the same Rust file by several rules and checks: the answer is kept, keyed on the whole text (a changed
// file can never get an old answer), oldest entry out first, and bounded by size so a huge repository cannot fill memory.
export const memoByText = (fn, maxChars) => {
  const memo = new Map()
  let chars = 0
  return (text) => {
    const hit = memo.get(text)
    if (hit !== undefined) return hit
    const out = fn(text)
    if (text.length * 2 <= maxChars) {
      memo.set(text, out)
      chars += text.length * 2
      for (const k of memo.keys()) {
        if (chars <= maxChars) break
        memo.delete(k)
        chars -= k.length * 2
      }
    }
    return out
  }
}
export const rustBlank = (text) => rustBlankMemo(text)
const rustBlankRaw = (text) => text.replace(/(?<![A-Za-z0-9_])(?:b|c)?r(#*)"[\s\S]*?"\1|'(?:[^'\\\n]|\\.)'|"(?:[^"\\]|\\[\s\S])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, ' '))
const rustTestRangesRaw = (text) => {
  // Raw strings (r#"..."#), strings, char literals and comments are blanked (same length, newlines kept) so a brace inside one is not counted.
  const blanked = rustBlank(text)
  const lineAt = lineCounter(blanked)
  const ranges = []
  for (const m of blanked.matchAll(/^[ \t]*#\[cfg\(test\)\][ \t]*\r?\n(?:[ \t]*#\[[^\]\n]*\][ \t]*\r?\n)*[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/gm)) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < blanked.length; i++) {
      if (blanked[i] === '{') depth++
      else if (blanked[i] === '}' && --depth === 0) {
        ranges.push([lineAt(m.index), lineAt(i)])
        break
      }
    }
  }
  return ranges
}
const rustBlankMemo = memoByText(rustBlankRaw, 96 * 2 ** 20)
const rustTestRanges = memoByText(rustTestRangesRaw, 32 * 2 ** 20)
export const rustTestLines = (file, text) => {
  if (!/\.rs$/i.test(file) || !text.includes('#[cfg(test)]')) return () => false
  const ranges = rustTestRanges(text)
  return (line) => ranges.some(([a, b]) => line >= a && line <= b)
}
// Whether the line at ctx.index (a rule context: { file, lines, index, text, project }) is Rust test code: inside a #[cfg(test)] module, inside a #[test] / #[tokio::test]
// function, or anywhere in a file that starts with #![cfg(test)] or that its parent module declares as `#[cfg(test)] mod name;`. None of that ships.
const rustTestFnRanges = memoByText((text) => {
  const blanked = /#\[(?:[\w:]+::)?test\b/.test(text) ? rustBlank(text) : ''
  const lineAt = lineCounter(blanked)
  const fns = []
  for (const m of blanked.matchAll(/#\[(?:[\w:]+::)?test(?:\([^\]\n]*\))?\][ \t]*\r?\n(?:[ \t]*#\[[^\]\n]*\][ \t]*\r?\n)*[^{;\n]*\bfn\s+\w+[^{;]*\{/g)) {
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < blanked.length; i++) {
      if (blanked[i] === '{') depth++
      else if (blanked[i] === '}' && --depth === 0) {
        fns.push([lineAt(m.index), lineAt(i)])
        break
      }
    }
  }
  return fns
}, 32 * 2 ** 20)
const rustTestCache = new WeakMap()
export const rustInTest = (ctx) => {
  let fn = rustTestCache.get(ctx.lines)
  if (fn === undefined) {
    const text = ctx.text ?? ctx.lines.join('\n')
    const modRanges = /\.rs$/i.test(ctx.file ?? 'a.rs') && text.includes('#[cfg(test)]') ? rustTestRanges(text) : []
    const fns = rustTestFnRanges(text)
    let whole = /^\s*#!\[cfg\(test\)\]/m.test(text)
    const f = /^(.*?)\/?([^/]+)\.rs$/.exec(ctx.file ?? '')
    if (!whole && f && !/^(?:mod|lib|main)$/.test(f[2]) && ctx.project?.read) {
      const pre = f[1] ? `${f[1]}/` : ''
      const decl = new RegExp(`#\\[cfg\\(test\\)\\]\\s*(?:#\\[[^\\]\\n]*\\]\\s*)*(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+${f[2]}\\s*;`)
      whole = [`${pre}mod.rs`, `${pre}lib.rs`, `${pre}main.rs`, ...(f[1] ? [`${f[1]}.rs`] : [])].some((p) => ctx.project.files?.includes(p) && decl.test(ctx.project.read(p) ?? ''))
    }
    // One flag per line, made once for the file: a rule asks about nearly every line, and a big Rust file holds thousands of test functions.
    const ranges = [...modRanges, ...fns]
    const flagged = new Uint8Array(ranges.reduce((n, r) => Math.max(n, r[1]), 0) + 2)
    for (const [a, b] of ranges) flagged.fill(1, Math.max(0, a), b + 1)
    fn = (line) => whole || (line >= 0 && line < flagged.length && flagged[line] === 1)
    rustTestCache.set(ctx.lines, fn)
  }
  return fn(ctx.index + 1)
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
// Rust files that hold deliberately insecure sample code as string data (a scanner's own rule tables). The NAME is the convention: insecure_code*.rs,
// vulnerable_samples*.rs, bad_examples*.rs. Only the strings in such a file are sample text; code written outside a string there is still scanned.
export const isInsecureSampleFile = (f) => /(^|\/)(?:insecure_code|vulnerable_samples?|bad_examples?)[\w.-]*\.rs$/i.test(f)
// The text with every Rust string literal (plain, byte and raw r#"..."#) blanked: same length, newlines kept, so line numbers stay true. Comments are left as they are.
// Only strings that sit inside a DATA TABLE are blanked: the initializer of a `const` or `static` (an array or slice of tuples or struct literals holding sample text).
// A string used anywhere else, such as an argument of a call inside a function, is real code and is left alone. Char literals ('"') are consumed so they cannot shift
// the string pairing.
export const blankRustStrings = (text) => {
  const tok = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<![A-Za-z0-9_])(?:b|c)?r(#*)"[\s\S]*?"\1|(?<![A-Za-z0-9_])b?"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\\n]|\\.)'|=(?![=>])|[(){}[\];]|\b(?:const|static)\b/g
  let out = ''
  let last = 0
  let state = 'code' // code | pending (after const/static, before =) | table
  let depth = 0
  for (const m of text.matchAll(tok)) {
    const s = m[0]
    if (/^\/[/*]/.test(s) || s[0] === "'") continue
    if (state === 'pending' && depth === 0 && s === '{') {
      state = 'code' // const fn / static block, not a table
      continue
    }
    if (s === 'const' || s === 'static') {
      if (state === 'code') {
        state = 'pending'
        depth = 0
      }
    } else if (s === '=') {
      if (state === 'pending' && depth === 0) {
        state = 'table'
        depth = 0
      }
    } else if (s === '(' || s === '[' || s === '{') depth++
    else if (s === ')' || s === ']' || s === '}') depth = Math.max(0, depth - 1)
    else if (s === ';') {
      if (depth === 0 && state !== 'code') state = 'code'
    } else if (state === 'table') {
      out += text.slice(last, m.index) + s.replace(/[^\n]/g, ' ')
      last = m.index + s.length
    }
  }
  return out + text.slice(last)
}
// A value that says it is not real. It is the value itself that has to say so (FAKE_TOKEN, SUPERSECRET, example.com), never the file.
export const FAKE_VALUE = /fake|dummy|placeholder|supersecret|not[-_]?(?:a[-_])?real|redacted|changeme|example|sample|[_-]test[_-]|your[-_]?(?:key|token|secret)/i
// A value that is a stand-in, not a secret: it has a word such as test, example, placeholder, dummy, fake, mock, demo, changeme or xxxx as a whole word
// (set off by - _ . / a digit or the ends, so "latest" and "contest" do not count), or it is filler (one character repeated 8 or more times, or a long value made of
// only one or two different characters). A real-looking random value is not matched.
const PLACEHOLDER_WORD = /(?:^|[^a-z])(?:tests?|testing|examples?|samples?|placeholders?|dummy|fake|mock|demo|changeme|change[-_]me|redacted|replace[-_]?me|todo|x{4,}|your[-_]?(?:key|token|secret|password|api[-_]?key))(?:[^a-z]|$)/i
export const isPlaceholderValue = (value) => {
  const v = String(value ?? '')
  if (PLACEHOLDER_WORD.test(v)) return true
  if (/(.)\1{7,}/.test(v)) return true
  return v.length >= 8 && new Set(v.toLowerCase()).size <= 2
}

// Settings files (.meerkat-budgets.json and every .meerkat-<area>-allow) may sit in the project root or, to keep the root tidy, in a .meerkat/ folder;
// the folder wins when the file is in both.
const CONFIG_NAME = /^\.meerkat-(?:budgets\.json|[a-z-]+-allow)$/
export const configPath = (root, f) => (CONFIG_NAME.test(f) && existsSync(join(root, '.meerkat', f)) ? join(root, '.meerkat', f) : join(root, f))

// In a worker (lib/inproc-worker.mjs) a file is read once per run and shared by every check that asks for it. An entry is only used while the file's
// size and modified time are unchanged, and the worker is gone at the end of the run, so a later run never sees old text. A process keeps no cache.
// The reader behind readText, made by a factory so a test can hand it a fake reader and count the reads. An entry is used only while the file's size and
// modified time are unchanged; when the total passes the limit the oldest entries are dropped first (a Map keeps insertion order); a file over maxFile is never kept.
export function makeCachedReader({ read = (p) => readFileSync(p, 'utf8'), stat = statSync, maxBytes = 256 * 2 ** 20, maxFile = 2 * 2 ** 20 } = {}) {
  const cache = new Map()
  let bytes = 0
  return (p) => {
    const st = stat(p)
    const hit = cache.get(p)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.text
    const text = read(p)
    if (hit) {
      bytes -= hit.size
      cache.delete(p)
    }
    if (st.size <= maxFile) {
      cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, text })
      bytes += st.size
      for (const k of cache.keys()) {
        if (bytes <= maxBytes) break
        bytes -= cache.get(k).size
        cache.delete(k)
      }
    }
    return text
  }
}
const cachedRead = makeCachedReader()
export const readText = (root, f) => {
  progress.file(f)
  const p = configPath(root, f)
  try {
    if (!globalThis.__meerkatReadCache) return readFileSync(p, 'utf8')
    return cachedRead(p)
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
  // Findings can carry text from the scanned project: control characters (CR, LF, ESC, ...) never reach the output, so a name cannot forge a line.
  for (const f of findings.slice(0, 25)) console.log(`  ${String(f).replace(/[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]+/gu, ' ')}`)
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
  // Run inside a worker thread (lib/inproc-worker.mjs): hand the checks over instead of running one and exiting.
  if (globalThis.__meerkatRegister) return globalThis.__meerkatRegister(checks)
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

// A Docker Compose file by its content, whatever it is called (compose/db.yml, deploy/stack.yaml): a top-level services: map whose entries carry an image or a build.
// A GitLab CI "services:" list (dash items), a GitHub Actions job "services:" (indented) and a Kubernetes manifest do not match.
export const isComposeText = (t) => /^services:[ \t]*(?:#.*)?\r?\n(?:[ \t]*(?:#.*)?\r?\n)*[ \t]+[\w.-]+:/m.test(t) && /^[ \t]+(?:image|build):/m.test(t)

// Whether an environment file (.env, .env.production) holds anything worth keeping out of git. A file of placeholders (${VAR}, $VAR, <value>,
// empty), comments and plain settings (a site name, a public URL) is how many projects document what must be set, so it is not a leak.
// A secret is a literal value under a key named like one (password, secret, token, key, ...), a URL with a user and password in it, or a value
// shaped like a well-known token.
const ENV_SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|private|credential|auth|salt|dsn|access[_-]?key|signing|bearer|(^|_)key($|_))/i
const ENV_SECRET_VALUE = /^(sk_(live|test)_|rk_live_|pk_live_|AKIA[0-9A-Z]{8}|xox[abprs]-|gh[pousr]_|github_pat_|SG\.|AIza|npm_[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{10}\.)/
export const envFileHoldsSecret = (text) => {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*?)\s*$/.exec(raw)
    if (!m || raw.trim().startsWith('#')) continue
    let value = m[2].replace(/\s+#.*$/, '').replace(/^(["'])(.*)\1$/, '$2')
    if (!value || /^\$\{[^}]*\}$/.test(value) || /^\$[A-Za-z_]\w*$/.test(value) || /^<[^>]*>$/.test(value)) continue
    value = value.trim()
    if (ENV_SECRET_VALUE.test(value) || /:\/\/[^/\s:@]+:[^@\s]+@/.test(value)) return true
    if (ENV_SECRET_KEY.test(m[1])) return true
  }
  return false
}
// Whether a key or certificate file has any content beyond comments and blank lines (a stub that says "mounted at runtime" holds no key).
// A PEM file whose block headers are all public (PUBLIC KEY, CERTIFICATE, CERTIFICATE REQUEST, X509 CRL) holds nothing secret, whatever its .pem or .key name.
export const isPublicPemOnly = (text) => {
  const heads = [...String(text ?? '').matchAll(/-----BEGIN ([A-Z0-9 ]+)-----/g)].map((m) => m[1])
  return heads.length > 0 && heads.every((h) => /^(?:(?:RSA|EC|DSA) )?PUBLIC KEY$|^(?:(?:TRUSTED|X509|NEW) )?CERTIFICATE(?: REQUEST)?$|^X509 CRL$/.test(h))
}
export const keyFileHasContent = (text) => !isPublicPemOnly(text) && String(text ?? '').split(/\r?\n/).some((l) => l.trim() && !/^\s*(#|;|\/\/)/.test(l))
export const isIgnored = (root, rel) => {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// Which of these paths does git ignore? One `git check-ignore --stdin` call for each run of paths up to CHUNK_CHARS long, not one process per path (a process
// start costs tens of milliseconds on Windows). Gives the same answer per path as isIgnored.
export const CHECK_IGNORE_CHUNK_CHARS = 6000
export function ignoredPaths(root, paths, { run = execFileSync } = {}) {
  const ignored = new Set()
  const chunks = []
  let cur = []
  let size = 0
  for (const p of paths) {
    if (cur.length && size + p.length + 1 > CHECK_IGNORE_CHUNK_CHARS) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(p)
    size += p.length + 1
  }
  if (cur.length) chunks.push(cur)
  for (const chunk of chunks) {
    let out = ''
    try {
      out = run('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: chunk.join('\0') + '\0', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    } catch (e) {
      out = typeof e?.stdout === 'string' ? e.stdout : '' // exit 1 means none of them is ignored
    }
    for (const p of String(out).split('\0')) if (p) ignored.add(p)
  }
  return ignored
}
