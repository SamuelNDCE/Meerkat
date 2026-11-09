// meerkat impact [--base <ref>] [--json] [--app <folder>]
// "What did this change break": for the lines changed against the base (git diff hunks, not whole files) it lists the callers of the changed
// symbols (lib/mapquery.mjs findCalls), the test files that reference them (testsFor), and the findings of the newest run that sit on the changed
// lines. One table at most; the first line is the count line. Anything left out of the answer is said (a cap, no run to read findings from).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { baseRef } from './changed.mjs'
import { loadRunFindings } from './findingscmd.mjs'
import { findCalls, loadMap, testsFor } from './mapquery.mjs'
import { repoRootOf } from './paths.mjs'
import { TEST_RE } from './refactorctx.mjs'

const MAX_SYMBOLS = 40
const MAX_ROWS = 200
const CALLABLE = new Set(['function', 'method', 'class', 'fn', 'def', 'func'])
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 3) + '...' : String(s))

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

// New-side line ranges of each file from `git diff -U0` text: { file -> [[from, to], ...] }. A pure deletion marks the line it happened at.
export function parseHunks(diffText) {
  const out = new Map()
  let file = null
  for (const line of String(diffText).split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      file = p === '/dev/null' ? null : norm(p.replace(/^b\//, ''))
      if (file && !out.has(file)) out.set(file, [])
      continue
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (m && file) {
      const start = Number(m[1])
      const len = m[2] === undefined ? 1 : Number(m[2])
      out.get(file).push(len === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + len - 1])
    }
  }
  return out
}

const touches = (ranges, from, to) => ranges.some(([a, b]) => a <= to && b >= from)

// The symbols of a mapped file whose body holds a changed line. A symbol runs from its line to the line before the next symbol (the map keeps no end line).
export function changedSymbols(file, ranges) {
  const syms = [...file.symbols].filter((s) => s.line >= 1).sort((a, b) => a.line - b.line)
  const out = []
  for (let i = 0; i < syms.length; i++) {
    const s = syms[i]
    const end = i + 1 < syms.length ? Math.max(syms[i + 1].line - 1, s.line) : Math.max(file.lines ?? s.line, s.line)
    if (CALLABLE.has(s.kind) && /^[\w$]+$/.test(s.name) && touches(ranges, s.line, end)) out.push({ name: s.name, kind: s.kind, line: s.line, end })
  }
  return out
}

// Resolves what is being compared against: --base, else the repository's base branch, else HEAD (uncommitted changes only).
function pickBase(repoRoot, base, env) {
  const notes = []
  let ref = base ?? baseRef(repoRoot, env)
  if (!ref) {
    ref = 'HEAD'
    notes.push('impact: no base branch found (no origin/HEAD, main, master or dev); comparing the working tree with HEAD. Use --base <ref> to choose.')
  }
  if (git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) === null) return { error: `impact: base "${clip(ref, 80)}" is not a commit in this repository` }
  const mb = git(repoRoot, ['merge-base', ref, 'HEAD'])?.trim()
  return { ref, from: mb || ref, notes }
}

// Everything the command answers, as data. `readFile` may be given to count/replace reads (tests).
export function computeImpact(appDir, { base = null, env = process.env, readFile = null, findings = undefined } = {}) {
  const repoRoot = repoRootOf(appDir)
  const picked = pickBase(repoRoot, base, env)
  if (picked.error) return { error: picked.error }
  const notes = [...picked.notes]
  const diff = git(appDir, ['diff', '--relative', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', picked.from, '--'])
  if (diff === null) return { error: 'impact: git could not produce the diff' }
  const hunks = parseHunks(diff)
  const untracked = (git(appDir, ['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/).filter(Boolean).map(norm)
  const { map, notes: mapNotes } = loadMap(appDir, undefined, { env })
  notes.push(...mapNotes)
  const mapped = new Map(map.files.map((f) => [f.path, f]))
  for (const u of untracked) if (!hunks.has(u)) hunks.set(u, [[1, mapped.get(u)?.lines ?? 1_000_000]])

  const memo = new Map()
  const read = (p) => {
    if (memo.has(p)) return memo.get(p)
    let t = null
    try {
      t = readFile ? readFile(p) : readFileSync(join(appDir, p), 'utf8')
    } catch {
      t = null
    }
    memo.set(p, t)
    return t
  }

  const changedFiles = [...hunks.keys()].sort()
  const symbols = []
  for (const f of changedFiles) {
    const mf = mapped.get(f)
    if (!mf) continue
    for (const s of changedSymbols(mf, hunks.get(f))) symbols.push({ file: f, ...s })
  }
  let symbolsCut = 0
  if (symbols.length > MAX_SYMBOLS) {
    symbolsCut = symbols.length - MAX_SYMBOLS
    symbols.length = MAX_SYMBOLS
  }

  // Callers: one pass per distinct symbol name, over only the files whose text names it. The symbol's own body does not count as a caller.
  const callers = []
  const seenCall = new Set()
  const byName = new Map()
  for (const s of symbols) byName.set(s.name, [...(byName.get(s.name) ?? []), s])
  for (const [name, defs] of byName) {
    const candidates = map.files.filter((f) => read(f.path)?.includes(name))
    const { hits } = findCalls({ files: candidates }, appDir, name, read)
    for (const h of hits) {
      if (defs.some((d) => d.file === h.file && h.line >= d.line && h.line <= d.end)) continue
      const key = `${name}|${h.file}|${h.line}`
      if (seenCall.has(key)) continue
      seenCall.add(key)
      callers.push({ symbol: name, defined: defs[0].file, file: h.file, line: h.line, text: h.text, isTest: TEST_RE.test(h.file) })
    }
  }

  // Tests: those that import or name a changed file, and test files that call a changed symbol.
  const tests = new Map()
  const symbolFiles = [...new Set(symbols.map((s) => s.file))].filter((f) => !TEST_RE.test(f))
  for (const f of symbolFiles) {
    for (const t of testsFor(map, appDir, f, read).rows) if (!tests.has(t.file)) tests.set(t.file, { file: t.file, line: t.line, how: `${t.how} (${f})` })
  }
  for (const c of callers) if (c.isTest && !tests.has(c.file)) tests.set(c.file, { file: c.file, line: c.line, how: `calls ${c.symbol}` })

  // Findings of the newest run that sit on a changed line. A finding with no line (a whole file) is not on a changed line.
  let found = []
  let findingsFrom = null
  if (findings === undefined) {
    const r = loadRunFindings(env, undefined, { folder: appDir })
    if (r.ok) {
      findings = r.doc.findings ?? []
      findingsFrom = r.doc.run?.id ?? null
    } else {
      findings = []
      notes.push(`impact: findings not checked, there is no readable run for this folder yet (run meerkat verify first)`)
    }
  }
  for (const f of findings) {
    const ranges = f.file ? hunks.get(norm(f.file)) : null
    if (!ranges) continue
    const lines = [...new Set([f.line, ...(f.lines ?? [])].filter((n) => Number.isInteger(n) && n >= 1))]
    const hit = lines.find((n) => touches(ranges, n, n))
    if (hit === undefined) continue
    found.push({ id: String(f.id ?? '').slice(0, 8), severity: f.severity, rule: f.rule ?? f.check ?? null, file: norm(f.file), line: hit, message: clip(String(f.message ?? '').replace(/\s+/g, ' '), 90) })
  }

  return { base: picked.ref, comparedWith: picked.from, changedFiles, symbols, symbolsCut, callers, tests: [...tests.values()], findings: found, findingsFrom, notes, mapFiles: map.files.length }
}

const table = (head, rows) => {
  const all = [head, ...rows]
  const w = head.map((_, c) => Math.max(...all.map((r) => String(r[c]).length)))
  return all.map((r) => r.map((v, c) => String(v).padEnd(w[c])).join('  ').trimEnd()).join('\n')
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

export function impactText(r) {
  const head = `impact vs ${r.base}: ${plural(r.changedFiles.length, 'changed file')}, ${plural(r.symbols.length, 'changed symbol')}, ${plural(r.callers.length, 'caller')}, ${plural(r.tests.length, 'test file')}, ${plural(r.findings.length, 'finding')} on changed lines`
  const rows = [
    ...r.callers.map((c) => ['caller', `${c.file}:${c.line}`, `${c.symbol}( ${clip(c.text, 70)}`]),
    ...r.tests.map((t) => ['test', `${t.file}:${t.line}`, t.how]),
    ...r.findings.map((f) => ['finding', `${f.file}:${f.line}`, `${f.severity} ${f.rule ?? ''} ${f.id}: ${f.message}`.replace(/\s+/g, ' ')]),
  ]
  const extra = []
  if (r.symbolsCut) extra.push(`(${r.symbolsCut} more changed symbols were not looked up; the cap is ${MAX_SYMBOLS})`)
  if (rows.length > MAX_ROWS) extra.push(`(showing the first ${MAX_ROWS} of ${rows.length} rows; use --json for all)`)
  if (!rows.length) extra.push(r.symbols.length ? 'Nothing calls a changed symbol, no test names it, and no finding sits on a changed line.' : 'No function, method or class contains a changed line, so there is no caller to look up.')
  return [head, ...(rows.length ? [table(['KIND', 'WHERE', 'DETAIL'], rows.slice(0, MAX_ROWS))] : []), ...extra].join('\n')
}

export function runImpact(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const usage = 'meerkat impact [--base <ref>] [--app <folder>] [--json]'
  let app = null
  let base = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') {
      app = argv[++i]
      if (!app) return (err('impact: --app needs a folder'), 2)
    } else if (a === '--base') {
      base = argv[++i]
      if (!base || base.startsWith('-')) return (err('impact: --base needs a git ref, for example --base origin/main'), 2)
    } else if (a === '--json') json = true
    else return (err(`impact: unexpected ${clip(a, 60)}. Use: ${usage}`), 2)
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) return (err(`impact: ${app ?? '.'} is not a folder`), 2)
  const r = computeImpact(appDir, { base, env })
  if (r.error) return (err(r.error), 2)
  for (const n of r.notes) err(n)
  out(json ? JSON.stringify(r, null, 2) : impactText(r))
  return 0
}
