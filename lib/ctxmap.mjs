// `meerkat map --budget <tokens> [--for <file>]` (roadmap C2): the symbols that matter most, ranked and fitted to a token budget.
// Added to `meerkat map` as a second mode: with --budget or --for it prints the ranked list to stdout and writes nothing (no run folder);
// without them `meerkat map` is unchanged (it still writes codemap.json and codemap.md).
//
// How the ranking works (name-based and approximate, not a call graph):
//   - Symbols come from the code map's own parser (lib/codemap.mjs scanFiles): functions, classes, types and so on, in JavaScript,
//     TypeScript, Python, PowerShell and Rust. Only exported (public) symbols outside test files are ranked: a local helper cannot be
//     used by another file, and its name is usually a common word. Names shorter than 3 characters and "default" are left out.
//   - A reference is a source file, other than the one that defines the symbol, that contains the symbol's name as a whole identifier.
//     Identifiers are found with /[A-Za-z_$][\w$]*/g. For JavaScript, TypeScript and Python the text is masked first (comments and, for JS,
//     template literal bodies, are blanked, as the code map does); for PowerShell and Rust the raw text is used, so a name in a comment counts.
//   - Two symbols with the same name in different files share their references, so common names (main, run) are over-counted.
//   - rank score = references. With --for <file>: +1000 if the symbol is defined in that file, +500 if that file mentions it (defined elsewhere),
//     +2 if it is defined in the same folder.
//   - Sorted by score (high first), then name, then path, then line, so the same input always gives the same output.
// The budget: tokens are estimated as characters / 4. The whole output (header and footer included) is at most budget * 4 characters.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { maskJs, maskPy, scanFiles } from './codemap.mjs'
import { TEST_RE } from './refactorctx.mjs'

export const DEFAULT_BUDGET = 4000
const USAGE = 'Use: meerkat map [folder] --budget <tokens> [--for <file>] [--json]'
const IDENT = /[A-Za-z_$][\w$]*/g
const SKIP_KINDS = new Set(['impl', 'param-block'])

const identsOf = (text, language) => {
  const masked = language === 'python' ? maskPy(text) : language === 'javascript' || language === 'typescript' ? maskJs(text) : text
  return new Set(masked.match(IDENT) ?? [])
}

// Ranked symbols of a folder: [{ name, kind, path, line, refs, boost, score }], best first.
export function rankSymbols(appDir, { forFile = null } = {}) {
  const { entries } = scanFiles(appDir)
  const idents = new Map()
  const defs = []
  for (const [path, e] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const rec = e.rec
    if (!rec || !rec.language) continue
    let text
    try {
      text = readFileSync(resolve(appDir, path), 'utf8')
    } catch {
      continue
    }
    idents.set(path, identsOf(text, rec.language))
    const isTest = TEST_RE.test(path)
    for (const s of rec.symbols ?? []) {
      if (!s.exported || isTest || SKIP_KINDS.has(s.kind) || typeof s.name !== 'string' || s.name.length < 3 || s.name === 'default') continue
      defs.push({ name: s.name, kind: s.kind ?? 'symbol', path, line: s.line ?? 0 })
    }
  }
  const refCount = new Map() // name -> Map(path -> true): files mentioning it
  for (const [path, set] of idents) for (const n of set) (refCount.get(n) ?? refCount.set(n, []).get(n)).push(path)
  const forDir = forFile ? posix.dirname(forFile) : null
  const forIdents = forFile ? idents.get(forFile) ?? new Set() : null
  const seen = new Set()
  const out = []
  for (const d of defs) {
    const key = `${d.path}\0${d.name}\0${d.line}`
    if (seen.has(key)) continue
    seen.add(key)
    const refs = (refCount.get(d.name) ?? []).filter((p) => p !== d.path).length
    let boost = 0
    if (forFile) {
      if (d.path === forFile) boost = 1000
      else if (forIdents.has(d.name)) boost = 500
      else if (posix.dirname(d.path) === forDir) boost = 2
    }
    out.push({ ...d, refs, boost, score: refs + boost })
  }
  out.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line)
  return out
}

const lineOf = (s) => `  ${s.name}  ${s.kind}  ${s.path}:${s.line}  refs ${s.refs}${s.boost ? '  near' : ''}\n`
const footerOf = (n) => `# ${n} more symbol${n === 1 ? '' : 's'} not shown (budget)\n`

// The text of the ranked list, at most budget * 4 characters. Returns { text, shown, total }.
export function fitToBudget(ranked, budget, { forFile = null } = {}) {
  const cap = budget * 4
  const longHead = `# Ranked symbols, name-based and approximate (a reference is another file that mentions the name). Budget ${budget} tokens (1 token = 4 characters)${forFile ? `; boosted near ${forFile}` : ''}\n`
  const head = longHead.length <= cap ? longHead : '# symbols by references (name-based)\n'
  const lines = ranked.map(lineOf)
  let used = head.length
  let k = 0
  while (k < lines.length && used + lines[k].length + (k + 1 < lines.length ? footerOf(lines.length - k - 1).length : 0) <= cap) {
    used += lines[k].length
    k++
  }
  let text = head + lines.slice(0, k).join('')
  if (k < lines.length) text += footerOf(lines.length - k)
  if (text.length > cap) text = text.slice(0, cap)
  return { text, shown: k, total: lines.length }
}

// `meerkat map [folder] --budget <tokens> [--for <file>] [--json]`. Exit 0 done, 2 usage.
export function runCtxMap(argv, { cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  let budget = DEFAULT_BUDGET
  let forArg = null
  let app = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--budget') {
      const v = argv[++i]
      if (!/^\d+$/.test(v ?? '') || Number(v) < 1) {
        err(`map: --budget needs a whole number of tokens, 1 or more. ${USAGE}`)
        return 2
      }
      budget = Number(v)
    } else if (a === '--for') {
      forArg = argv[++i]
      if (!forArg) {
        err(`map: --for needs a file. ${USAGE}`)
        return 2
      }
    } else if (a === '--app') {
      app = argv[++i]
      if (!app) {
        err(`map: --app needs a folder. ${USAGE}`)
        return 2
      }
    } else if (a === '--json') json = true
    else if (!String(a).startsWith('-') && app === null) app = a
    else {
      err(`map: unknown option ${String(a).slice(0, 60)}. ${USAGE}`)
      return 2
    }
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    err(`map: ${app ?? '.'} is not a folder`)
    return 2
  }
  let forFile = null
  if (forArg) {
    const abs = resolve(cwd, forArg)
    let ok = false
    try {
      ok = statSync(abs).isFile()
    } catch {
      ok = false
    }
    const rel = posix.normalize(abs.replace(/\\/g, '/').replace(resolve(appDir).replace(/\\/g, '/') + '/', ''))
    if (!ok || rel.startsWith('..') || /^[A-Za-z]:\//.test(rel) || rel.startsWith('/')) {
      err(`map: --for ${forArg} is not a file inside ${app ?? '.'}`)
      return 2
    }
    forFile = rel
  }
  const ranked = rankSymbols(appDir, { forFile })
  const r = fitToBudget(ranked, budget, { forFile })
  if (json) {
    out(JSON.stringify({ budgetTokens: budget, estimatedTokens: Math.ceil(r.text.length / 4), for: forFile, shown: r.shown, total: r.total, symbols: ranked.slice(0, r.shown) }, null, 2))
    return 0
  }
  out(r.text.replace(/\n$/, ''))
  return 0
}
