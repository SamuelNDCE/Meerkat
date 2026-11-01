// Refactor checks: is the code itself in good shape? They are separate from "does the app work" and run in the thorough tier.
//   node thorough/refactor.mjs <check> [--root <dir>]      node thorough/refactor.mjs <check> --fixtures   (must exit 1)
//   duplicate-code        repeated blocks of code across the repository (copy and paste); the 400 largest files when there are more
//   dead-code             exported names nothing else uses, JS and TS (the Rust compiler and clippy already report dead Rust code)
//   file-length           files too long to read in one sitting
//   long-functions        functions longer than maxFunctionLines (default 80), by matching braces or indentation (Python)
//   deep-nesting          code nested deeper than maxNesting levels (default 6), measured by indentation
//   commented-out-code    three or more consecutive comment lines that look like code (allow list: .meerkat-refactor-allow)
//   many-parameters       functions with more than maxParameters parameters (default 6)
//   unused-files          JavaScript and TypeScript files nothing imports and that are not entry points (allow list: .meerkat-unused-allow)
//   cyclomatic-complexity functions with more branches than maxComplexity allows (default 15)
// Limits live in .meerkat-budgets.json under "refactor". Accepted dead names go in .meerkat-dead-allow, one per line.
// The function finder (findFunctions) is a heuristic: it blanks out strings and comments first, then matches signatures per language.
import { extname, join, posix } from 'node:path'
import { finish, main, readBudgets, readText, sizeOf, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.refactor ?? {}
const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.rs', '.py', '.go', '.svelte', '.vue', '.java', '.cs', '.c', '.cpp', '.h', '.rb', '.php', '.swift', '.kt'])
const SKIP = /(^|\/)(node_modules|dist|build|target|vendor|generated|__snapshots__|fixtures?|\.svelte-kit)\//i
const sources = (root) => trackedFiles(root).filter((x) => CODE.has(extname(x)) && !SKIP.test(x) && !/\.(min|d)\.(js|ts)$|\.lock$/.test(x))
const allowList = (root, name) => new Set(readText(root, name).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const lineOf = (text, index) => text.slice(0, index).split('\n').length

// Lines that carry no meaning on their own: braces, imports, blank lines, one-word lines.
const trivial = (l) => l.length < 12 || /^(import|export \{|use |from |#include|\}|\)|\]|\/\/|\*|\/\*)/.test(l) || /^[)}\],;]+$/.test(l)

const duplicates = (root) => {
  const window = cfg(root).duplicateWindow ?? 8 // consecutive meaningful lines that must match
  const maxPct = cfg(root).maxDuplicatePct ?? 10
  const cap = cfg(root).maxDuplicateFiles ?? 400
  let files = sources(root)
  if (files.length > cap) {
    const total = files.length
    files = files.map((x) => ({ x, size: sizeOf(join(root, x)) })).sort((a, b) => b.size - a.size).slice(0, cap).map((e) => e.x)
    console.log(`  scanning the ${cap} largest of ${total} source files; ${total - cap} were left out, so this result is a sample`)
  }
  const seen = new Map() // hash -> first place
  let total = 0
  let dup = 0
  const spots = new Map() // "file" -> duplicated line count
  const examples = []
  for (const x of files) {
    const lines = readText(root, x).split('\n').map((l, i) => ({ t: l.trim().replace(/\s+/g, ' '), n: i + 1 })).filter((l) => !trivial(l.t))
    total += lines.length
    const mark = new Set()
    for (let i = 0; i + window <= lines.length; i++) {
      const key = lines.slice(i, i + window).map((l) => l.t).join('\n')
      const first = seen.get(key)
      if (first && first.file !== x) {
        for (let k = i; k < i + window; k++) mark.add(k)
        if (examples.length < 40 && !examples.some((e) => e.a === first.where)) examples.push({ a: first.where, b: `${x}:${lines[i].n}` })
      } else if (!first) seen.set(key, { file: x, where: `${x}:${lines[i].n}` })
    }
    dup += mark.size
    if (mark.size) spots.set(x, mark.size)
  }
  const pct = total ? (dup / total) * 100 : 0
  console.log(`  ${dup} of ${total} meaningful lines sit in a block of ${window}+ that also appears in another file (${pct.toFixed(1)}%, limit ${maxPct}%)`)
  const f = []
  if (pct > maxPct) {
    f.push(`${pct.toFixed(1)}% of the code is duplicated, over the ${maxPct}% limit. Worst files: ${[...spots].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ')}`)
    for (const e of examples.slice(0, 5)) f.push(`same block: ${e.a}  and  ${e.b}`)
  }
  return finish('duplicate-code', f, 'duplication is inside the limit')
}

const deadCode = (root) => {
  const allow = new Set(readText(root, '.meerkat-dead-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  const max = cfg(root).maxDeadExports ?? 0
  const files = trackedFiles(root).filter((x) => /\.(m?[jt]sx?|svelte|vue)$/.test(x) && !/(^|\/)(node_modules|dist|build)\//.test(x))
  const texts = new Map(files.map((x) => [x, readText(root, x)]))
  const all = [...texts.values()].join('\n')
  const f = []
  for (const [x, t] of texts) {
    if (/\.(test|spec)\./.test(x) || /(^|\/)(index|main|entry)\.[a-z]+$/.test(x) || /(^|\/)(pages|routes|app)\//.test(x)) continue
    const names = new Set()
    for (const m of t.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
    for (const m of t.matchAll(/^\s*export\s*\{([^}]+)\}/gm)) for (const n of m[1].split(',')) names.add(n.trim().split(/\s+as\s+/).pop())
    for (const n of names) {
      if (!n || allow.has(n) || allow.has(`${x}:${n}`)) continue
      const uses = all.match(new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'))?.length ?? 0
      if (uses <= 1) f.push(`${x}: "${n}" is exported but nothing else mentions it`)
    }
  }
  console.log(`  ${f.length} exported name(s) nothing else uses (limit ${max})`)
  return finish('dead-code', f.length > max ? f : [], 'no unused exports above the limit')
}

const fileLength = (root) => {
  const max = cfg(root).maxFileLines ?? 2000
  const f = []
  for (const x of sources(root)) {
    const n = readText(root, x).split('\n').length
    if (n > max) f.push(`${x} is ${n} lines (limit ${max}); split it by responsibility`)
  }
  return finish('file-length', f, `no file is over ${max} lines`)
}

// ---- shared function finder (used by long-functions, many-parameters and cyclomatic-complexity)
const FAMILY = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.jsx': 'js', '.py': 'py', '.rs': 'rs', '.go': 'go', '.java': 'c', '.cs': 'c', '.c': 'c', '.cpp': 'c', '.h': 'c', '.kt': 'c', '.swift': 'c' }
const HEADERS = {
  js: [
    /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/gm,
    /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?\(/gm,
    /^[ \t]+(?:(?:public|private|protected|static|async|get|set|override|readonly)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/gm,
  ],
  py: [/^([ \t]*)(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm],
  rs: [/^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?(?:default[ \t]+)?(?:const[ \t]+)?(?:async[ \t]+)?(?:unsafe[ \t]+)?(?:extern[ \t]+"[^"\n]*"[ \t]+)?fn[ \t]+([A-Za-z_]\w*)[ \t]*(?:<[^>\n]*>)?[ \t]*\(/gm],
  go: [/^[ \t]*func[ \t]+(?:\([^)\n]*\)[ \t]*)?([A-Za-z_]\w*)[ \t]*(?:\[[^\]\n]*\])?[ \t]*\(/gm],
  c: [/^[ \t]*(?:[\w:<>[\]*&?,.@]+[ \t]+)+[*&]*([A-Za-z_~][\w:~]*)[ \t]*\(/gm],
}
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'new', 'delete', 'sizeof', 'function', 'typeof', 'await', 'yield', 'throw', 'with', 'super', 'import', 'export', 'require', 'assert', 'elif', 'except', 'lambda', 'using', 'foreach', 'when', 'case', 'synchronized'])
const SIG_STOP = /\b(?:if|for|while|switch|catch|return|else|do|with|throw|case)\b/

// Blank out the inside of comments and string literals, keeping every newline and column, so the scans below never match text inside them.
function mask(text, ext) {
  const py = ext === '.py'
  const rust = ext === '.rs'
  const n = text.length
  const out = text.split('')
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  while (i < n) {
    const c = text[i]
    if (py ? c === '#' : c === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      blank(i, j)
      i = j
      continue
    }
    if (!py && c === '/' && text[i + 1] === '*') {
      let j = text.indexOf('*/', i + 2)
      j = j < 0 ? n : j + 2
      blank(i, j)
      i = j
      continue
    }
    if (py && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const q = text.slice(i, i + 3)
      let j = text.indexOf(q, i + 3)
      j = j < 0 ? n : j + 3
      blank(i + 3, j - 3)
      i = j
      continue
    }
    if (c === '"' || c === '`' || (c === "'" && (!rust || text[i + 2] === "'" || text[i + 1] === '\\'))) {
      let j = i + 1
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j++
        else if (text[j] === '\n' && c !== '`') break
        j++
      }
      blank(i + 1, Math.min(j, n))
      i = j + 1
      continue
    }
    i++
  }
  return out.join('')
}

// Index of the bracket that closes the one at `at`, or -1.
function closeOf(s, at) {
  const open = s[at]
  const close = { '(': ')', '{': '}', '[': ']' }[open]
  let depth = 0
  for (let k = at; k < s.length; k++) {
    if (s[k] === open) depth++
    else if (s[k] === close) {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

// After a parameter list, find the "{" that opens the body. Gives up on anything that is not a signature (a call, a declaration ending in ";").
function bodyOpenAfter(s, from) {
  let p = from
  for (let hop = 0; hop < 8; hop++) {
    let q = p
    while (q < s.length && q - p < 200 && !'{};()'.includes(s[q])) q++
    const gap = s.slice(p, q)
    if (SIG_STOP.test(gap)) return -1
    // An arrow only has a body when a "{" follows the arrow directly. "=> expr" is an expression, and whatever brace comes later belongs to the next statement.
    const arrow = gap.indexOf('=>')
    if (arrow >= 0) return gap.slice(arrow + 2).trim() === '' && s[q] === '{' ? q : -1
    if (s[q] === '{') {
      // A "{" reached across a line break with other text in between is the next statement, not this signature's body.
      return gap.includes('\n') && gap.trim() !== '' ? -1 : q
    }
    if (s[q] !== '(') return -1
    // Another parameter list only counts on the same line: across a line break it is the next statement.
    if (s.slice(p, q).includes('\n')) return -1
    const c = closeOf(s, q)
    if (c < 0) return -1
    p = c + 1
  }
  return -1
}

// Top-level parameters of a parameter list, without the receiver (self, this, cls) and a lone void.
function splitParams(inner) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter((p) => p && !/^(&\s*)?(mut\s+)?self$|^this(\s*:.*)?$|^cls$|^void$/.test(p))
}

// Every function in one source text: { name, startLine, endLine, params, body, fam }. Lines are 1-based.
function findFunctions(text, ext) {
  const fam = FAMILY[ext]
  if (!fam) return []
  const s = mask(text, ext)
  const isPy = fam === 'py'
  const found = []
  const seen = new Set()
  for (const re of HEADERS[fam]) {
    for (const m of s.matchAll(re)) {
      const name = isPy ? m[2] : m[1]
      const open = m.index + m[0].length - 1
      if (seen.has(open) || KEYWORDS.has(name)) continue
      seen.add(open)
      const close = closeOf(s, open)
      if (close < 0) continue
      const startLine = lineOf(s, m.index)
      let endLine
      let body
      if (isPy) {
        const lines = s.split('\n')
        const headLine = lineOf(s, close)
        const indent = m[1].length
        let last = headLine
        for (let ln = headLine + 1; ln <= lines.length; ln++) {
          const L = lines[ln - 1]
          if (!L.trim()) continue
          if (L.match(/^[ \t]*/)[0].length <= indent) break
          last = ln
        }
        endLine = last
        body = lines.slice(headLine - 1, last).join('\n')
      } else {
        const brace = bodyOpenAfter(s, close + 1)
        if (brace < 0) continue
        const end = closeOf(s, brace)
        if (end < 0) continue
        endLine = lineOf(s, end)
        body = s.slice(brace, end + 1)
      }
      found.push({ name, startLine, endLine, params: splitParams(s.slice(open + 1, close)), body, fam })
    }
  }
  return found
}

const longFunctions = (root) => {
  const max = cfg(root).maxFunctionLines ?? 80
  const f = []
  for (const x of sources(root)) {
    for (const fn of findFunctions(readText(root, x), extname(x))) {
      const n = fn.endLine - fn.startLine + 1
      if (n > max) f.push(`${x}:${fn.startLine} ${fn.name} (${n} lines, limit ${max})`)
    }
  }
  return finish('long-functions', f, `no function is over ${max} lines`)
}

const deepNesting = (root) => {
  const max = cfg(root).maxNesting ?? 6
  const f = []
  for (const x of sources(root)) {
    const lines = readText(root, x).split('\n')
    const unit = indentStep(lines)
    let first = 0
    let depth = 0
    let count = 0
    lines.forEach((l, i) => {
      if (!l.trim()) return
      const d = depthOf(l, unit)
      if (d > max) {
        count++
        if (!first) {
          first = i + 1
          depth = d
        }
      }
    })
    if (count) f.push(`${x}:${first} is nested ${depth} levels deep (limit ${max}); ${count} line(s) in this file are over the limit`)
  }
  return finish('deep-nesting', f, `no code is nested deeper than ${max} levels`)
}

// "tab" when the file indents with tabs, otherwise the space step (2 or 4) that goes up most often.
function indentStep(lines) {
  let tabs = 0
  let two = 0
  let four = 0
  let prev = 0
  for (const l of lines) {
    if (/^\t/.test(l)) tabs++
    if (!l.trim()) continue
    const w = l.match(/^ */)[0].length
    if (w > prev) {
      if (w - prev === 2) two++
      else if (w - prev === 4) four++
    }
    prev = w
  }
  if (tabs > two + four) return 'tab'
  return four > two ? 4 : 2
}

function depthOf(l, unit) {
  const ws = l.match(/^[ \t]*/)[0]
  if (unit === 'tab') return (ws.match(/\t/g) ?? []).length
  return Math.floor(ws.replace(/\t/g, '    ').length / unit)
}

// Comment text when a line is a comment, otherwise null. Doc comments (/** */) count as prose, never as code.
// A line looks like code when it ends in ; { } with a code character in it, ends in a call such as foo(x), or starts with a keyword.
const LOOKS_CODE = (c) => (/[;{}]$/.test(c) && /[=(){}]/.test(c)) || /\w\([^()]*\)$/.test(c) || /^(const |let |var |function |if \(|for \(|return\b|import |def |class |fn |pub )/.test(c)

const commentedOut = (root) => {
  const allow = allowList(root, '.meerkat-refactor-allow')
  const f = []
  for (const x of sources(root)) {
    const hash = extname(x) === '.py'
    const lines = readText(root, x).split('\n')
    let run = []
    let inBlock = false
    let doc = false
    const flush = () => {
      if (run.length >= 3 && !allow.has(x) && !allow.has(`${x}:${run[0]}`)) f.push(`${x}:${run[0]} commented-out code (${run.length} lines)`)
      run = []
    }
    lines.forEach((raw, i) => {
      const t = raw.trim()
      let text = null
      if (inBlock) {
        text = doc ? '' : t.replace(/\*\/\s*$/, '').replace(/^\*\s?/, '').trim()
        if (t.includes('*/')) {
          inBlock = false
          doc = false
        }
      } else if (t.startsWith('/*')) {
        doc = t.startsWith('/**')
        inBlock = !t.includes('*/', 2)
        text = doc ? '' : t.replace(/^\/\*+/, '').replace(/\*\/\s*$/, '').trim()
      } else if (hash && t.startsWith('#') && !t.startsWith('#!')) text = t.slice(1).trim()
      else if (!hash && t.startsWith('//')) text = t.slice(2).trim()
      if (text !== null && text && LOOKS_CODE(text)) run.push(i + 1)
      else flush()
    })
    flush()
  }
  return finish('commented-out-code', f, 'no run of three or more commented-out code lines')
}

const manyParameters = (root) => {
  const max = cfg(root).maxParameters ?? 6
  const f = []
  for (const x of sources(root)) {
    for (const fn of findFunctions(readText(root, x), extname(x))) {
      if (fn.params.length > max) f.push(`${x}:${fn.startLine} ${fn.name} takes ${fn.params.length} parameters (limit ${max})`)
    }
  }
  return finish('many-parameters', f, `no function takes more than ${max} parameters`)
}

// Entry points: nothing imports these, they are run directly (index, main, bin, tests, configs, packs loaded by folder, scripts named in package.json).
// Files a framework loads by folder and file name (Next.js app router and pages, SvelteKit, Nuxt, Remix routes): nothing imports them.
const FRAMEWORK_ENTRY = /(^|\/)(?:src\/)?app\/(?:.*\/)?(?:layout|page|loading|error|global-error|not-found|template|default|route|forbidden|unauthorized|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[jt]sx?$|(^|\/)(?:src\/)?(?:pages|routes)\/|(^|\/)\+(?:page|layout|server|error)[\w.-]*\.[jt]s$|(^|\/)(?:src\/)?(?:middleware|instrumentation|proxy)\.[jt]s$/
const JS_FILE = /\.[cm]?[jt]sx?$/
const ENTRY = /(^|\/)(index|main)\.[cm]?[jt]sx?$|(^|\/)bin\/|^packs\/|\.(test|spec)\.[cm]?[jt]sx?$|\.config\.[cm]?[jt]sx?$|(^|\/)(tests?|examples?|docs?|scripts|fixtures?)\//
const IMPORT = /(?:from\s+|import\s+|import\(\s*|require\(\s*)['"](\.{1,2}\/[^'"?#]*)['"]/g
const EXTS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.d.ts']
// Any quoted relative path counts as a reference too: new URL('./w.js', import.meta.url), new Worker('./w.js'), optional('./x.cjs'), a loader table.
const QUOTED_PATH = /['"`](\.{1,2}\/[^'"`?#\s]+)['"`]/g
const DOC_FILE = /\.(md|json|ya?ml|html?|txt|toml)$/i

const packageEntries = (root) => {
  let pkg = null
  try {
    pkg = JSON.parse(readText(root, 'package.json') || 'null')
  } catch {
    return []
  }
  const out = []
  const walk = (v) => {
    if (typeof v === 'string') out.push(...v.split(/\s+/))
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  if (pkg) for (const k of ['main', 'bin', 'exports', 'scripts']) walk(pkg[k])
  return out.map((s) => posix.normalize(s.replace(/^\.\//, ''))).filter(Boolean)
}

const unusedFiles = (root) => {
  const allow = allowList(root, '.meerkat-unused-allow')
  const files = trackedFiles(root).filter((x) => JS_FILE.test(x) && !SKIP.test(x))
  const known = new Set(files)
  const texts = new Map(files.map((x) => [x, readText(root, x)]))
  const used = new Set()
  for (const [x, t] of texts) {
    for (const m of t.matchAll(IMPORT)) {
      const target = posix.normalize(posix.join(posix.dirname(x), m[1]))
      const bare = target.replace(/\.(m?js|cjs|jsx)$/, '')
      for (const c of [...EXTS.map((e) => target + e), ...EXTS.map((e) => bare + e), ...EXTS.map((e) => `${target}/index${e}`)]) if (known.has(c)) used.add(c)
    }
    for (const m of t.matchAll(QUOTED_PATH)) {
      const target = posix.normalize(posix.join(posix.dirname(x), m[1]))
      const bare = target.replace(/\.(m?js|cjs|jsx)$/, '')
      for (const c of [...EXTS.map((e) => target + e), ...EXTS.map((e) => bare + e)]) if (known.has(c) && c !== x) used.add(c)
    }
  }
  const named = new Set(packageEntries(root))
  // Documentation and manifests that name a file (a README line telling people to run it) count as use.
  let docTexts = null
  const docs = () => (docTexts ??= trackedFiles(root).filter((y) => DOC_FILE.test(y) && !/package-lock\.json$/.test(y)).map((y) => ({ dir: posix.dirname(y), text: readText(root, y) })))
  // A page names its script relative to itself (<script src="shell.js"> beside index.html), so the path is also tried from the page's folder.
  const namedBy = (d, x) => d.text.includes(x) || (d.dir !== '.' && x.startsWith(`${d.dir}/`) && d.text.includes(x.slice(d.dir.length + 1)))
  const f = []
  for (const x of files) {
    if (used.has(x) || named.has(x) || ENTRY.test(x) || FRAMEWORK_ENTRY.test(x) || allow.has(x)) continue
    // A path written into another file counts as a reference: runners and packs name their scripts by path.
    if ([...texts].some(([y, t]) => y !== x && t.includes(x))) continue
    if (docs().some((d) => namedBy(d, x))) continue
    f.push(`${x} is not imported by any file and is not an entry point (delete it, or list it in .meerkat-unused-allow)`)
  }
  return finish('unused-files', f, 'every JavaScript and TypeScript file is imported or is an entry point')
}

// Branch points: if (includes else if), for, while, case, catch, && and ||, and the ternary "?". Python adds elif, except, and, or.
const BRANCH = /\b(?:if|for|while|case|catch)\b|&&|\|\||(?<![?])\?(?![?.:;,)\]}])/g
const PY_BRANCH = /\b(?:elif|except|and|or)\b/g

const complexity = (root) => {
  const max = cfg(root).maxComplexity ?? 15
  const f = []
  for (const x of sources(root)) {
    for (const fn of findFunctions(readText(root, x), extname(x))) {
      const branches = (fn.body.match(BRANCH) ?? []).length + (fn.fam === 'py' ? (fn.body.match(PY_BRANCH) ?? []).length : 0)
      const c = branches + 1
      if (c > max) f.push(`${x}:${fn.startLine} ${fn.name} has complexity ${c} (limit ${max})`)
    }
  }
  return finish('cyclomatic-complexity', f, `no function is above complexity ${max}`)
}

main({
  'duplicate-code': { run: duplicates, fixture: () => withFixture({ 'a.js': Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'alpha');`).join('\n'), 'b.js': Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'alpha');`).join('\n') }, duplicates) },
  'dead-code': { run: deadCode, fixture: () => withFixture({ 'lib.js': 'export function neverCalledAnywhere() { return 1 }\n', 'main.js': 'console.log(1)\n' }, deadCode) },
  'file-length': { run: fileLength, fixture: () => withFixture({ 'big.js': 'x\n'.repeat(2500), '.meerkat-budgets.json': '{}' }, fileLength) },
  'long-functions': { run: longFunctions, fixture: () => withFixture({ 'big.js': ['function huge() {', ...Array.from({ length: 88 }, () => '  total += 1'), '}', ''].join('\n') }, longFunctions) },
  'deep-nesting': { run: deepNesting, fixture: () => withFixture({ 'deep.js': [...Array.from({ length: 9 }, (_, i) => `${'  '.repeat(i)}if (flag${i}) {`), ...Array.from({ length: 9 }, (_, i) => `${'  '.repeat(8 - i)}}`), ''].join('\n') }, deepNesting) },
  'commented-out-code': { run: commentedOut, fixture: () => withFixture({ 'old.js': '// const a = compute(1);\n// const b = compute(2);\n// if (a) { run(b) }\nconsole.log(1)\n' }, commentedOut) },
  'many-parameters': { run: manyParameters, fixture: () => withFixture({ 'many.js': 'function many(a, b, c, d, e, f, g) {\n  return a\n}\n' }, manyParameters) },
  'unused-files': { run: unusedFiles, fixture: () => withFixture({ 'index.js': "import './used.js'\n", 'used.js': 'export const a = 1\n', 'orphan.js': 'export const b = 2\n' }, unusedFiles) },
  'cyclomatic-complexity': { run: complexity, fixture: () => withFixture({ 'busy.js': ['function busy(x) {', ...Array.from({ length: 20 }, (_, i) => `  if (x === ${i}) return ${i}`), '}', ''].join('\n') }, complexity) },
})
