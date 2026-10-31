// Source hygiene for JavaScript and TypeScript, Python, Go and Rust, with no tool to install. Read only: it never edits a file.
//   node thorough/lang.mjs <check> [--root <dir>]      node thorough/lang.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "lang": maxAny (default 25) and maxUnwrap (default 40).
// An accepted finding goes in .meerkat-lang-allow, one "<check-id> <path>" per line. That covers the whole file for that check.
// Code is read with strings, comments and (in JavaScript) regex literals blanked out first, so a word inside one is never a finding.
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.lang ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|out|coverage|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(pb\.go|gen\.go|pb2\.py)$|\.generated\.[a-z]+$|(^|\/)__generated__\//i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.go$/i
const JS = /\.[mc]?[jt]sx?$/i
const TS = /\.[mc]?tsx?$/i
const PY = /\.py$/i
const GO = /\.go$/i
const RS = /\.rs$/i
const JS_OPTS = { regex: true }
const PY_OPTS = { slash: false, hash: true, triple: true, quotes: ['"', "'"] }
const GO_OPTS = { quotes: ['"', "'", '`'] }
const RS_OPTS = { quotes: ['"'], rustChar: true }

const allowSet = (root) => new Set(readText(root, '.meerkat-lang-allow').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && !p[0].startsWith('#')).map((p) => `${p[0]} ${p[1]}`))
const allowed = (allow, id, x) => allow.has(`${id} ${x}`)
const files = (root, re, skipTests = false) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x) && !(skipTests && TEST_FILE.test(x)))
// A file averaging more than 400 characters a line is a bundle, not hand-written source, so it is left alone.
const sourceOf = (root, x) => {
  const t = readText(root, x)
  return t.length > 0 && t.length / t.split('\n').length > 400 ? '' : t
}
const lineOf = (text, index) => (text.slice(0, index).match(/\n/g)?.length ?? 0) + 1
const blank = (s) => s.replace(/[^\n]/g, ' ')
const endOfLine = (s, i) => {
  const j = s.indexOf('\n', i)
  return j < 0 ? s.length : j
}

// Index of the character that closes the bracket opened at `open`, or the last index when it never closes.
function matchClose(code, open, o = '{', c = '}') {
  let depth = 0
  for (let k = open; k < code.length; k++) {
    if (code[k] === o) depth++
    else if (code[k] === c) {
      depth--
      if (depth === 0) return k
    }
  }
  return code.length - 1
}

// Blanks the body of every block a regex introduces. The regex must end with "{" and carry the g flag.
function blankBodies(code, re) {
  const spans = []
  for (const m of code.matchAll(re)) {
    const open = m.index + m[0].length - 1
    spans.push([open, matchClose(code, open)])
  }
  let out = code
  for (const [a, b] of spans) out = out.slice(0, a + 1) + blank(out.slice(a + 1, b)) + out.slice(b)
  return out
}

function stringEnd(src, i, q) {
  let j = i + 1
  while (j < src.length) {
    const ch = src[j]
    if (ch === '\\') {
      j += 2
      continue
    }
    if (ch === q) return j + 1
    if (ch === '\n' && q !== '`') return j
    j++
  }
  return src.length
}

function regexEnd(src, i) {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const ch = src[j]
    if (ch === '\n') return j
    if (ch === '\\') {
      j += 2
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
    } else if (ch === '[') inClass = true
    else if (ch === '/') {
      j++
      while (j < src.length && /[a-z]/i.test(src[j])) j++
      return j
    }
    j++
  }
  return src.length
}

// A slash starts a regex literal (not a division) when the code before it cannot end a value.
const regexStarts = (out, prev) => prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || /\breturn$/.test(out.trimEnd())

// The source with strings, comments and (when o.regex) regex literals turned to spaces. Length and line breaks never change,
// so an index or a line number in the result is the same one in the original file.
function codeOnly(src, o = {}) {
  const quotes = o.quotes ?? ['"', "'", '`']
  let out = ''
  let prev = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    let end = -1
    let value = true
    if (o.slash !== false && c === '/' && d === '/') {
      end = endOfLine(src, i)
      value = false
    } else if (o.slash !== false && c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2)
      end = e < 0 ? src.length : e + 2
      value = false
    } else if (o.hash && c === '#') {
      end = endOfLine(src, i)
      value = false
    } else if (o.triple && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const e = src.indexOf(src.slice(i, i + 3), i + 3)
      end = e < 0 ? src.length : e + 3
    } else if (quotes.includes(c)) end = stringEnd(src, i, c)
    else if (o.regex && c === '/' && regexStarts(out, prev)) end = regexEnd(src, i)
    else if (o.rustChar && c === "'") {
      const m = /^'(?:\\[^\n]{1,10}|[^'\\\n])'/.exec(src.slice(i, i + 12))
      if (m) end = i + m[0].length
    }
    if (end >= 0) {
      out += blank(src.slice(i, end))
      if (value) prev = '"'
      i = end
      continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

// ---- js-eqeqeq: == and != instead of === and !== (comparing with null is allowed, it is the one idiom that means "null or undefined")
const jsEqeqeq = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'js-eqeqeq', x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    for (const m of t.matchAll(/(?<![=!<>])(==|!=)(?!=)/g)) {
      const after = t.slice(m.index + 2, m.index + 14)
      const before = t.slice(Math.max(0, m.index - 12), m.index)
      if (/^\s*null\b/.test(after) || /\bnull\s*$/.test(before)) continue
      f.push(`${x}:${lineOf(t, m.index)} uses ${m[1]}, which converts types before comparing (use ${m[1]}=)`)
    }
  }
  return finish('js-eqeqeq', f, 'comparisons use === and !== (except against null)')
}

// ---- js-var-usage: var declarations in modern source (let and const are block scoped and cannot leak out of a loop)
const jsVarUsage = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'js-var-usage', x) || /\.d\.ts$/i.test(x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    for (const m of t.matchAll(/(?<![\w$.])var\s+[A-Za-z_$[{]/g)) f.push(`${x}:${lineOf(t, m.index)} declares a variable with var (use const or let)`)
  }
  return finish('js-var-usage', f, 'no declaration uses var')
}

// ---- js-await-in-loop: await inside the body of a plain for or while loop, so each step waits for the one before.
// Functions written inside the loop are not counted (they run later, and often in parallel), and for await is not matched.
const FN_BODY = /(?:\bfunction\b[^{;]*|=>[ \t\n]*)\{/g
const jsAwaitInLoop = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'js-await-in-loop', x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    for (const m of t.matchAll(/(?<![\w$.])(for|while)\s*\(/g)) {
      const close = matchClose(t, m.index + m[0].length - 1, '(', ')')
      let k = close + 1
      while (k < t.length && /\s/.test(t[k])) k++
      const body = t[k] === '{' ? t.slice(k + 1, matchClose(t, k)) : t.slice(k, endOfLine(t, k))
      if (/(?<![\w$.])await\b/.test(blankBodies(body, FN_BODY))) f.push(`${x}:${lineOf(t, m.index)} awaits inside a ${m[1]} loop, so each step waits for the one before (collect the promises and await Promise.all)`)
    }
  }
  return finish('js-await-in-loop', f, 'no loop awaits each step in turn')
}

// ---- js-unhandled-promise: a statement that starts a promise chain with .then and never handles a rejection (narrow on purpose)
const STMT_START = /^[ \t]*[A-Za-z_$][\w$]*(?:[ \t]*\.[ \t]*[A-Za-z_$][\w$]*)*[ \t]*\(/
const KEYWORDS = /^[ \t]*(const|let|var|return|await|yield|throw|if|for|while|switch|do|else|new|export|import|typeof|void|delete|case|default|class|function|async|try|catch)\b/
// The last significant character before `start` ends a statement (or nothing comes before it), so this line starts a new one.
function startsStatement(t, start) {
  let k = start - 1
  while (k >= 0 && /\s/.test(t[k])) k--
  return k < 0 || /[;{})]/.test(t[k])
}
// The chunk with everything inside a bracket blanked out, so only the chain at the statement's own level is left to test.
function topLevel(chunk) {
  let out = ''
  let depth = 0
  for (const ch of chunk) {
    if ('([{'.includes(ch)) {
      out += depth === 0 ? ch : ' '
      depth++
    } else if (')]}'.includes(ch)) {
      depth--
      out += depth === 0 ? ch : ' '
    } else out += depth === 0 ? ch : ' '
  }
  return out
}
// True when a .then( in the chunk takes a second argument (the rejection handler), which handles the error too.
const hasRejectionArg = (chunk) => [...chunk.matchAll(/\.then[ \t]*\(/g)].some((m) => {
  const open = m.index + m[0].length - 1
  const args = chunk.slice(open + 1, matchClose(chunk, open, '(', ')'))
  let depth = 0
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === ',' && depth === 0) return true
  }
  return false
})
// The text of one statement that begins at `start`: up to a ; at depth 0, or a line break that does not continue with a dot.
function statementText(t, start) {
  let depth = 0
  let k = start
  for (; k < t.length && k - start < 3000; k++) {
    const ch = t[k]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (depth <= 0 && ch === ';') break
    else if (depth <= 0 && ch === '\n') {
      const next = t.slice(k + 1, k + 200).match(/^\s*(\S)/)
      if (!next || next[1] !== '.') break
    }
  }
  return t.slice(start, k)
}
const unhandledPromise = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'js-unhandled-promise', x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    let at = 0
    for (const line of t.split('\n')) {
      const start = at
      at += line.length + 1
      if (!STMT_START.test(line) || KEYWORDS.test(line) || !startsStatement(t, start)) continue
      const chunk = statementText(t, start)
      const top = topLevel(chunk)
      if (/\.then[ \t]*\(/.test(top) && !/\.catch[ \t]*\(/.test(top) && !hasRejectionArg(chunk)) f.push(`${x}:${lineOf(t, start)} starts a promise chain with .then and never handles a rejection (add .catch, or await it)`)
    }
  }
  return finish('js-unhandled-promise', f, 'promise chains handle their rejections')
}

// ---- js-prototype-pollution: assignments that can reach Object.prototype (__proto__, constructor.prototype), or a
// two-level write keyed by a request value (target[req.body.key][sub] = value). Narrow on purpose.
const POLLUTION = [
  /\[\s*(['"`])__proto__\1\s*\]\s*=(?!=)/g,
  /\.__proto__\s*=(?!=)/g,
  /\bconstructor\s*\.\s*prototype\s*\.\s*[\w$]+\s*=(?!=)/g,
  /\[\s*(?:req|request|body|query|params|input|payload)[\w$.]*\s*\]\s*\[[^\]\n]+\]\s*=(?!=)/g,
]
// A recursive merge / assign helper: a loop over the keys of an object that writes target[key] = ... with no check for __proto__,
// constructor or prototype in the loop. Looked for in the loop head and the next 8 lines; the loop must sit in (or right under) a
// function whose name or body says merge, extend, assign, clone, defaults, mixin or set. Linear: bounded windows, one pass.
const KEY_LOOP = /\bfor\s*\(\s*(?:const|let|var)?\s*(\w+)\s+in\s+[^)\n]{1,80}\)|\bfor\s*\(\s*(?:const|let|var)\s*\[\s*(\w+)\s*(?:,\s*\w+\s*)?\]\s+of\s+Object\.(?:keys|entries)\([^)\n]{1,80}\)|\bObject\.(?:keys|entries)\([^)\n]{1,80}\)\.forEach\(\s*\(?\s*(?:\[\s*)?(\w+)/g
const MERGEISH = /\b(?:merge|extend|assign|deep\w*|clone|mixin|defaults|set\w*|copy\w*|combine|patch|update\w*)\b/i
const POLLUTION_GUARD = /__proto__|\bconstructor\b|\bprototype\b|hasOwn(?:Property)?\b|\bsafeKey|\bisSafe|\bforbidden|\bblocklist|\bdenylist/i
function* recursiveMergeHits(t) {
  for (const m of t.matchAll(KEY_LOOP)) {
    const key = m[1] || m[2] || m[3]
    if (!key) continue
    const before = t.slice(Math.max(0, m.index - 300), m.index)
    const win = t.slice(m.index, m.index + 700).split('\n').slice(0, 9).join('\n')
    if (!MERGEISH.test(before.split('\n').slice(-6).join('\n')) && !MERGEISH.test(win)) continue
    if (POLLUTION_GUARD.test(win)) continue
    const hit = new RegExp(`[\\w$.]{1,60}\\[\\s*${key}\\s*\\]\\s*=(?!=)`).exec(win)
    if (hit) yield m.index + hit.index
  }
}
const jsPrototypePollution = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'js-prototype-pollution', x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    for (const at of recursiveMergeHits(t)) f.push(`${x}:${lineOf(t, at)} copies keys into a target in a loop with no check for __proto__ or constructor, so a crafted key can change every object (skip those keys, or use Object.create(null))`)
    for (const re of POLLUTION) {
      for (const m of t.matchAll(re)) f.push(`${x}:${lineOf(t, m.index)} assigns through __proto__, constructor.prototype or a request-supplied key, which can change every object (use a Map, or Object.create(null) with a checked key)`)
    }
  }
  return finish('js-prototype-pollution', f, 'no assignment reaches Object.prototype')
}

// ---- ts-any-overuse: ": any" and "as any" in TypeScript, counted across the project against lang.maxAny (default 25)
const tsAnyOveruse = (root) => {
  const max = cfg(root).maxAny ?? 25
  const allow = allowSet(root)
  const hits = []
  let total = 0
  for (const x of files(root, TS)) {
    if (allowed(allow, 'ts-any-overuse', x)) continue
    const t = codeOnly(sourceOf(root, x), JS_OPTS)
    const n = [...t.matchAll(/(?::\s*any(?![\w$])|\bas\s+any(?![\w$]))/g)].length
    if (n) {
      total += n
      hits.push([x, n])
    }
  }
  const f = []
  if (total > max) {
    f.push(`${total} uses of any in TypeScript (: any and as any), over the budget lang.maxAny of ${max}`)
    for (const [x, n] of hits.sort((a, b) => b[1] - a[1]).slice(0, 10)) f.push(`${x} has ${n}`)
  }
  return finish('ts-any-overuse', f, `uses of any stay within the budget of ${max}`)
}

// ---- ts-ignore-comments: @ts-ignore and @ts-nocheck need a reason after them (@ts-expect-error already says what it expects)
const TS_IGNORE = /(\/\/|\/\*|^\s*\*)\s*@ts-(ignore|nocheck)\b(.*)$/
const tsIgnoreComments = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JS)) {
    if (allowed(allow, 'ts-ignore-comments', x)) continue
    sourceOf(root, x).split('\n').forEach((raw, i) => {
      const m = TS_IGNORE.exec(raw.replace(/\r$/, ''))
      if (!m) return
      const reason = m[3].replace(/\*\/.*$/, '').replace(/^[\s:-]+/, '').trim()
      if (reason.length < 3) f.push(`${x}:${i + 1} uses @ts-${m[2]} with no reason after it (say why it is needed)`)
    })
  }
  return finish('ts-ignore-comments', f, 'every @ts-ignore and @ts-nocheck says why')
}

// ---- py-bare-except: "except:" with no exception type catches everything, including Ctrl+C and sys.exit
const pyBareExcept = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, PY)) {
    if (allowed(allow, 'py-bare-except', x)) continue
    const t = codeOnly(sourceOf(root, x), PY_OPTS)
    for (const m of t.matchAll(/^[ \t]*except[ \t]*:/gm)) f.push(`${x}:${lineOf(t, m.index)} has a bare except: that catches everything, including KeyboardInterrupt (name the exception)`)
  }
  return finish('py-bare-except', f, 'every except names what it catches')
}

// ---- py-mutable-default: a default argument of [], {}, list(), dict() or set() is one object shared by every call
const pyMutableDefault = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, PY)) {
    if (allowed(allow, 'py-mutable-default', x)) continue
    const t = codeOnly(sourceOf(root, x), PY_OPTS)
    for (const m of t.matchAll(/\bdef\s+\w+\s*\(/g)) {
      const open = m.index + m[0].length - 1
      const params = t.slice(open + 1, matchClose(t, open, '(', ')'))
      if (/(?:^|[,(\s])\w+\s*(?::[^=,]*)?=\s*(?:\[\s*\]|\{\s*\}|(?:list|dict|set)\(\s*\))\s*(?=,|$)/m.test(params)) f.push(`${x}:${lineOf(t, m.index)} has a mutable default argument, shared by every call (default to None and create it inside the function)`)
    }
  }
  return finish('py-mutable-default', f, 'no default argument is a shared mutable object')
}

// ---- py-assert-in-prod: assert used to check input in non-test Python. Python removes asserts under -O, so the check vanishes.
const ASSERT_CHECK = /^(?:not\s+)?(?:isinstance|callable|len|hasattr)\s*\(|\bis\s+(?:not\s+)?None\b|^[\w.]+\s+in\s|\b(?:is_admin|is_staff|is_superuser|is_authenticated|is_authorized|is_owner|authorized|authenticated|has_perm\w*|has_permission\w*|permission\w*|can_\w+|role|roles|owner|password|passwd|token|csrf\w*|signature|auth\w*|allowed)\b|\b(?:request|req|session|form|params|payload|body|user_input)\b[\w.[\]'" ]{0,40}\s*(?:==|!=|<=|>=|<|>|\bin\b)|^(?:not\s+)?[\w.]{1,40}\.(?:startswith|endswith|isdigit|isalnum|isalpha|match)\(/
const pyAssertInProd = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, PY, true)) {
    if (allowed(allow, 'py-assert-in-prod', x)) continue
    const t = codeOnly(sourceOf(root, x), PY_OPTS)
    for (const m of t.matchAll(/^[ \t]*assert\s+([^\n]*)/gm)) {
      if (ASSERT_CHECK.test(m[1])) f.push(`${x}:${lineOf(t, m.index)} uses assert to check input; asserts are removed under python -O, so raise an exception instead`)
    }
  }
  return finish('py-assert-in-prod', f, 'no input is checked with assert outside tests')
}

// ---- go-ignored-errors: an error thrown away with _ (narrow: "_ = err", or the last result of a call assigned to _)
const goIgnoredErrors = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, GO, true)) {
    if (allowed(allow, 'go-ignored-errors', x)) continue
    const t = codeOnly(sourceOf(root, x), GO_OPTS)
    for (const m of t.matchAll(/^[ \t]*_[ \t]*=[ \t]*err\b/gm)) f.push(`${x}:${lineOf(t, m.index)} throws away an error value (_ = err), so a failure goes unnoticed`)
    for (const m of t.matchAll(/^[ \t]*[\w, \t]*?,[ \t]*_[ \t]*:?=[ \t]*[\w.]+[ \t]*\(/gm)) f.push(`${x}:${lineOf(t, m.index)} assigns the last result of a call to _, so its error (if it returns one) is ignored`)
  }
  return finish('go-ignored-errors', f, 'no error is thrown away with _')
}

// ---- go-defer-in-loop: defer inside a for body runs only when the function returns, so the resources pile up until then
const GO_FUNC = /\bfunc\s*\([^)\n]*\)[^{\n]*\{/g
const goDeferInLoop = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, GO, true)) {
    if (allowed(allow, 'go-defer-in-loop', x)) continue
    const t = codeOnly(sourceOf(root, x), GO_OPTS)
    const seen = new Set()
    for (const m of t.matchAll(/\bfor\b/g)) {
      const open = t.indexOf('{', m.index)
      if (open < 0) continue
      const body = blankBodies(t.slice(open + 1, matchClose(t, open)), GO_FUNC)
      for (const d of body.matchAll(/\bdefer\b/g)) {
        const at = open + 1 + d.index
        if (seen.has(at)) continue
        seen.add(at)
        f.push(`${x}:${lineOf(t, at)} defers inside a loop, so the deferred call waits until the function returns`)
      }
    }
  }
  return finish('go-defer-in-loop', f, 'no defer sits inside a loop')
}

// ---- rust-unwrap-overuse: unwrap() and expect( outside tests, counted against lang.maxUnwrap (default 40)
const TEST_BLOCKS = [/#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s+\w+\s*\{/g, /#\[test\]\s*(?:#\[[^\]\n]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+\w+[^{;]*\{/g]
const rustNonTest = (t) => TEST_BLOCKS.reduce((s, re) => blankBodies(s, re), t)
const rustUnwrapOveruse = (root) => {
  const max = cfg(root).maxUnwrap ?? 40
  const allow = allowSet(root)
  const hits = []
  let total = 0
  for (const x of files(root, RS, true)) {
    if (allowed(allow, 'rust-unwrap-overuse', x)) continue
    const t = rustNonTest(codeOnly(sourceOf(root, x), RS_OPTS))
    const n = [...t.matchAll(/\.unwrap\s*\(\s*\)|\.expect\s*\(/g)].length
    if (n) {
      total += n
      hits.push([x, n])
    }
  }
  const f = []
  if (total > max) {
    f.push(`${total} calls to unwrap() or expect() outside tests, over the budget lang.maxUnwrap of ${max} (return a Result and use ?)`)
    for (const [x, n] of hits.sort((a, b) => b[1] - a[1]).slice(0, 10)) f.push(`${x} has ${n}`)
  }
  return finish('rust-unwrap-overuse', f, `unwrap() and expect() outside tests stay within the budget of ${max}`)
}

// ---- rust-todo-macros: todo! and unimplemented! outside tests panic when they run
const rustTodoMacros = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, RS, true)) {
    if (allowed(allow, 'rust-todo-macros', x)) continue
    const t = rustNonTest(codeOnly(sourceOf(root, x), RS_OPTS))
    for (const m of t.matchAll(/(?<![\w$])(todo|unimplemented)!\s*[([{]/g)) f.push(`${x}:${lineOf(t, m.index)} has ${m[1]}!(), which panics when this code runs`)
  }
  return finish('rust-todo-macros', f, 'no todo! or unimplemented! outside tests')
}

const fx = (tree, run) => ({ fixture: () => withFixture(tree, run) })

main({
  'js-eqeqeq': { run: jsEqeqeq, ...fx({ 'a.js': 'export const same = (a, b) => a == b\n' }, jsEqeqeq) },
  'js-var-usage': { run: jsVarUsage, ...fx({ 'a.js': 'var count = 0\nexport { count }\n' }, jsVarUsage) },
  'js-await-in-loop': { run: jsAwaitInLoop, ...fx({ 'a.js': 'export async function load(ids) {\n  for (const id of ids) {\n    await fetchOne(id)\n  }\n}\n' }, jsAwaitInLoop) },
  'js-unhandled-promise': { run: unhandledPromise, ...fx({ 'a.js': 'export function save(id) {\n  fetchUser(id).then((u) => store(u))\n}\n' }, unhandledPromise) },
  'js-prototype-pollution': { run: jsPrototypePollution, ...fx({ 'a.js': 'export function merge(target, req) {\n  target[req.body.key][req.body.sub] = req.body.value\n}\n' }, jsPrototypePollution) },
  'ts-any-overuse': { run: tsAnyOveruse, ...fx({ 'a.ts': Array.from({ length: 26 }, (_, i) => `export const v${i}: any = ${i}\n`).join('') }, tsAnyOveruse) },
  'ts-ignore-comments': { run: tsIgnoreComments, ...fx({ 'a.ts': '// @ts-ignore\nexport const n: number = "x"\n' }, tsIgnoreComments) },
  'py-bare-except': { run: pyBareExcept, ...fx({ 'a.py': 'try:\n    run()\nexcept:\n    pass\n' }, pyBareExcept) },
  'py-mutable-default': { run: pyMutableDefault, ...fx({ 'a.py': 'def add(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n' }, pyMutableDefault) },
  'py-assert-in-prod': { run: pyAssertInProd, ...fx({ 'app/check.py': 'def load(user):\n    assert user is not None\n    return user\n' }, pyAssertInProd) },
  'go-ignored-errors': { run: goIgnoredErrors, ...fx({ 'main.go': 'package main\n\nimport "strconv"\n\nfunc parse(s string) int {\n\tn, _ := strconv.Atoi(s)\n\treturn n\n}\n' }, goIgnoredErrors) },
  'go-defer-in-loop': { run: goDeferInLoop, ...fx({ 'main.go': 'package main\n\nimport "os"\n\nfunc run(names []string) {\n\tfor _, n := range names {\n\t\tf, err := os.Open(n)\n\t\tif err != nil {\n\t\t\treturn\n\t\t}\n\t\tdefer f.Close()\n\t}\n}\n' }, goDeferInLoop) },
  'rust-unwrap-overuse': { run: rustUnwrapOveruse, ...fx({ 'src/lib.rs': 'pub fn run() {\n' + Array.from({ length: 41 }, (_, i) => `    let v${i} = "1".parse::<u32>().unwrap();\n`).join('') + '}\n' }, rustUnwrapOveruse) },
  'rust-todo-macros': { run: rustTodoMacros, ...fx({ 'src/lib.rs': 'pub fn later() -> u32 {\n    todo!()\n}\n' }, rustTodoMacros) },
})
