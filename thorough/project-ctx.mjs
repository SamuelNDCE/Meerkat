// What a rule may learn from the OTHER files of a project: a constant defined in one file and used in another, and a helper function
// whose caller (in any file) passes request data. Shared by the text-based checks so the "split across files" shapes are caught the same way.
import { readText } from './kit.mjs'

// Source files the project context reads. Tests, vendored code and build output are not shipped code.
const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|kt|cs|svelte|vue)$/i
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|tests?|__tests__|fixtures?|spec|examples?|docs?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[\w.-]+\.py$|\.min\.(m?js|css)$/i

export function projectContext(root, tracked) {
  let all = null
  const load = () => (all ??= new Map(tracked.filter((x) => SOURCE.test(x) && !SKIP.test(x)).map((x) => [x, readText(root, x)])))
  let consts = null
  return {
    get all() {
      return load()
    },
    // The text assigned to a name anywhere in the project: exports.NAME = 'x', const NAME = 'x', NAME = 'x', NAME: 'x'. Null when none.
    constant(name) {
      if (!consts) {
        consts = new Map()
        const re = /(?:^|[\s;,{(])(?:(?:export\s+)?(?:const|let|var)\s+|(?:module\.)?exports\.)?([A-Za-z_]\w*)\s*[:=](?!=)\s*([^\n]+)/g
        for (const [, text] of load()) for (const m of text.matchAll(re)) if (!consts.has(m[1])) consts.set(m[1], m[2].trim())
      }
      return consts.get(name) ?? null
    },
  }
}

// Top-level comma split of an argument list.
export function splitArgs(s) {
  const out = []
  let depth = 0
  let cur = ''
  let q = ''
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      q = ch
      cur += ch
      continue
    }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// Function heads: exports.x = (a) =>, function x(a), const x = (a) =>, def x(a):, func x(a).
export const FN_HEADS = [
  /(?:exports|module\.exports)\.(\w+)\s*=\s*(?:async\s*)?(?:function\s*\w*\s*)?\(([^)]*)\)/,
  /\bfunction\s+(\w+)\s*\(([^)]*)\)/,
  /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
  /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/,
  /\bfunc\s+(\w+)\s*\(([^)]*)\)/,
]

// The function a line sits in (looking up to 12 lines above): { name, params }.
export function enclosingFn(t, line) {
  const lines = t.split('\n')
  for (let i = line - 1; i >= Math.max(0, line - 13); i--) {
    for (const re of FN_HEADS) {
      const m = re.exec(lines[i])
      if (m) return { name: m[1], params: splitArgs(m[2]).map((p) => p.replace(/[:=].*$/, '').replace(/^\.\.\.|^\*+/, '').trim().split(/\s+/)[0]) }
    }
  }
  return null
}

// Names assigned from request data in a file (a = req.query.x), one hop.
export function taintNames(t, reqRe) {
  const taint = new Set()
  for (const l of t.split('\n')) {
    if (!reqRe.test(l)) continue
    const a = /([A-Za-z_]\w*)\s*(?::=|=(?![=>]))/.exec(l)
    if (a) taint.add(a[1])
  }
  return taint
}

// Every regex metacharacter is escaped, so a parameter name that is not an identifier (a stray "(" from a parsed parameter list) cannot
// throw "Invalid regular expression" and crash the whole check. Found on NeuralVault: the check then reported its own crash as a FAIL.
export const wordRe = (w) => new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)

// Helper hop: the sink on line `line` uses a parameter of its function (in `expr`), and some call of that function, in any file,
// passes request data for it. `callArgs(text, index)` returns the call text from the opening parenthesis (the check's own callText).
export function helperTaint(t, line, expr, ctx, reqRe, callArgs) {
  const fn = enclosingFn(t, line)
  if (!fn || !ctx) return false
  const idx = fn.params.findIndex((p) => p && wordRe(p).test(expr))
  if (idx < 0) return false
  const call = new RegExp(`(?<![\\w$])${fn.name}\\s*\\(`, 'g')
  for (const [, text] of ctx.all) {
    const tn = taintNames(text, reqRe)
    for (const m of text.matchAll(call)) {
      const start = m.index === 0 ? 0 : text.lastIndexOf('\n', m.index - 1) + 1
      const end = text.indexOf('\n', m.index)
      const lineText = text.slice(start, end < 0 ? text.length : end)
      if (FN_HEADS.some((re) => re.exec(lineText)?.[1] === fn.name)) continue
      const arg = splitArgs(callArgs(text, m.index + m[0].length - 1).slice(1, -1))[idx]
      if (arg && (reqRe.test(arg) || [...tn].some((n) => wordRe(n).test(arg)))) return true
    }
  }
  return false
}
