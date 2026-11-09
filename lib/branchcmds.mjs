// `meerkat verdict` (one line for a branch) and `meerkat top` (one table of the worst findings in the changed files). Both run the gate on the
// folder (lib/gate.mjs gatherGate) and read its rows; neither starts a check of its own.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultSeverity, isSeverity, SEVERITY_RANK } from './findings.mjs'
import { EXIT, gatherGate } from './gate.mjs'
import { layoutClassOf } from './gatepaths.mjs'

const failing = (r) => r.kind === 'fail' || r.kind === 'crash'

// { blocking, preExisting }: blocking = findings in files the branch changed; preExisting = findings in code it did not change (other files,
// and findings that were already on the base). Layout notes (a missing lockfile, say) are not code and count for neither.
export function verdictCounts(out) {
  let blocking = 0
  let preExisting = out.hidden ?? 0
  for (const r of out.rows ?? []) {
    if (failing(r)) blocking += r.places?.length || r.findings?.length || 1
    if (r.kind === 'fail') preExisting += r.outside ?? 0
    // A check whose findings are all in untouched files is listed as project-wide; its places are pre-existing code, except for layout/history checks (a missing lockfile is not code).
    if (r.kind === 'wide' && !layoutClassOf(r.id)) preExisting += r.places?.length ?? 0
  }
  return { blocking, preExisting }
}

export function verdictLine({ blocking, preExisting }) {
  if (blocking > 0) return `FAIL ${blocking} blocking in changed files`
  if (preExisting > 0) return `FAIL-PRE-EXISTING only: ${preExisting} findings in code this branch did not change`
  return 'PASS'
}

// Never silent: a run with no result prints one line naming the reason and the next step. Exit 2 for a usage or environment problem (a bad base ref,
// not a git repo), 1 when there is simply no result (nothing changed, no check could run, the run timed out).
const noResult = (out, reason, next, code) => {
  out(`NO-RESULT: ${reason}. next: ${next}`)
  return code
}
export const DEFAULT_VERDICT_SECONDS = 300
export const HARD_SECONDS = (env) => (Number(env.MEERKAT_VERDICT_TIMEOUT_S) > 0 ? Number(env.MEERKAT_VERDICT_TIMEOUT_S) : DEFAULT_VERDICT_SECONDS)

// Runs the gate with a time limit. Returns { g } or { stop: <exit code> } after printing the reason.
async function gather(word, argv, { env, cwd, out, err }) {
  let timer
  const limit = HARD_SECONDS(env)
  const timeout = new Promise((res) => {
    timer = setTimeout(() => res({ timedOut: true }), (limit + 30) * 1000) // backstop only: the gate itself stops at the limit and keeps its partial results
    timer.unref?.()
  })
  let g
  try {
    g = await Promise.race([gatherGate(argv, { env, cwd, err, progress: err, maxSeconds: limit }), timeout])
  } catch (e) {
    clearTimeout(timer)
    return { stop: noResult(out, `the gate failed to run (${String(e?.message ?? e).split(String.fromCharCode(10))[0].slice(0, 120)})`, `run meerkat gate --no-input to see the full error`, 1) }
  }
  clearTimeout(timer)
  if (g.timedOut) return { stop: noResult(out, `the gate did not finish in ${limit}s`, `run meerkat gate in the background, or raise MEERKAT_VERDICT_TIMEOUT_S`, 1) }
  if (!g.error && g.out?.stoppedEarly) {
    const rows = g.out.rows ?? []
    const left = rows.filter((r) => r.kind === 'notrun' && /run deadline reached|interrupted by you/.test(r.detail ?? '')).length
    out(`INCOMPLETE ${rows.length - left} of ${rows.length} checks finished, ${verdictCounts(g.out).blocking} blocking so far (not a pass)`)
    for (const r of topRows(g.out, g.checks).slice(0, 5)) out(`  ${r.file}${r.line ? ':' + r.line : ''}  ${r.check}`)
    return { stop: EXIT.notRun }
  }
  if (g.error) {
    const ref = /git does not know that ref|share no history|no base to compare/.test(g.error)
    const nope = /not inside a git work tree|git was not found/.test(g.error)
    return { stop: noResult(out, g.error.slice(0, 200), ref ? 'pass a base that exists, for example --base origin/main' : nope ? 'run it inside a git repository' : `see meerkat ${word} --help`, 2) }
  }
  if (!g.out.files?.length) return { stop: noResult(out, `nothing changed compared with ${g.changed.ref ?? 'the base'}, so there is nothing to judge`, 'commit or save a change, or pass --base <ref> to compare with another ref', 1) }
  if (!g.out.rows?.length) return { stop: noResult(out, g.out.note || 'no check could run on the changed files', 'run meerkat doctor, or meerkat gate --verbose', 1) }
  return { g }
}

// --known <file>: pre-existing failures a team has accepted, [{ check, file, line? }] (or { "known": [...] }). A finding that matches is KNOWN, not blocking.
export function readKnown(file, cwd) {
  let doc
  try {
    doc = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'))
  } catch (e) {
    return { error: e?.code === 'ENOENT' ? `the --known file ${file} does not exist` : `the --known file ${file} is not valid JSON` }
  }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.known) ? doc.known : null
  if (!list) return { error: `the --known file ${file} must be a JSON list of { "check", "file" } entries` }
  const entries = []
  for (const [i, e] of list.entries()) {
    if (!e || typeof e.check !== 'string' || !e.check || typeof e.file !== 'string' || !e.file || (e.line !== undefined && !Number.isInteger(e.line))) return { error: `the --known file ${file}: entry ${i + 1} needs a string "check", a string "file" and, optionally, an integer "line"` }
    entries.push({ check: e.check, file: e.file.replace(/\\/g, '/'), ...(e.line !== undefined ? { line: e.line } : {}) })
  }
  return { entries }
}

// { blocking, known: [{check,file,line}], stale: [entry] }: blocking places that no entry matches, the ones an entry matches, and the entries that matched nothing.
export function applyKnown(out, entries) {
  const used = new Set()
  const known = []
  let blocking = 0
  const hits = (id, p) => entries.map((e, i) => (e.check === id && e.file === p.file && (e.line === undefined || e.line === p.line) ? i : -1)).filter((i) => i >= 0)
  for (const r of out.rows ?? []) {
    if (failing(r)) {
      if (!r.places?.length) blocking += r.findings?.length || 1
      for (const p of r.places ?? []) {
        const h = hits(r.id, p)
        h.forEach((i) => used.add(i))
        if (h.length) known.push({ check: r.id, file: p.file, line: p.line })
        else blocking++
      }
    } else if (r.kind === 'wide') for (const p of r.places ?? []) hits(r.id, p).forEach((i) => used.add(i))
  }
  return { blocking, known, stale: entries.filter((_, i) => !used.has(i)) }
}

export async function runVerdict(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const rest = []
  let knownFile = null
  let json = false
  let bad = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--known') knownFile = argv[++i] ?? ''
    else if (a.startsWith('-') && !['--base', '--app', '--no-cache', '--max-seconds'].includes(a) && argv[i - 1] !== '--base' && argv[i - 1] !== '--app') bad ??= a
    else rest.push(a)
  }
  const lines = []
  const emit = json ? (t) => lines.push(t) : out
  const stopWith = (code, verdict, reason, extra = {}) => {
    if (json) out(JSON.stringify({ verdict, exitCode: code, blocking: 0, known: 0, stale: [], reason, ...extra }, null, 2))
    return code
  }
  const noRes = (reason, next, code) => {
    noResult(emit, reason, next, code)
    return stopWith(code, 'NO-RESULT', `${reason}. next: ${next}`)
  }
  if (bad) return noRes(`unknown option ${bad}`, 'usage: meerkat verdict [folder] [--base <ref>] [--known <file>] [--json]', EXIT.usage)
  let entries = null
  if (knownFile !== null) {
    const k = knownFile ? readKnown(knownFile, cwd) : { error: '--known needs a file' }
    if (k.error) return noRes(k.error, 'pass a JSON list such as [{ "check": "js-eqeqeq", "file": "src/a.js" }]', EXIT.usage)
    entries = k.entries
  }
  // With --known the team's list replaces the base comparison, so every finding in a changed file is judged against the list.
  const r = await gather('verdict', [...rest, ...(entries ? ['--all-findings'] : [])], { env, cwd, out: emit, err })
  if (r.stop !== undefined) {
    const first = lines.find((l) => l.startsWith('NO-RESULT') || l.startsWith('INCOMPLETE'))?.replace(/^NO-RESULT: /, '') ?? 'no result'
    return json ? stopWith(r.stop, 'NO-RESULT', first) : r.stop
  }
  const c = verdictCounts(r.g.out)
  let blocking = c.blocking
  let known = []
  let stale = []
  if (entries) ({ blocking, known, stale } = applyKnown(r.g.out, entries))
  const suffix = entries ? ` (${known.length} known)` : ''
  const base = verdictLine({ blocking, preExisting: c.preExisting })
  const line = blocking === 0 && c.preExisting === 0 ? `PASS${suffix}` : `${base}${suffix}`
  const code = blocking > 0 || c.preExisting > 0 ? 1 : 0
  if (json) {
    const verdict = blocking > 0 ? 'FAIL' : c.preExisting > 0 ? 'FAIL-PRE-EXISTING' : 'PASS'
    out(JSON.stringify({ verdict, exitCode: code, blocking, known: known.length, knownFindings: known, stale, reason: line }, null, 2))
    return code
  }
  out(line)
  for (const k of known) out(`KNOWN: ${k.check} ${k.file}${k.line ? `:${k.line}` : ''}`)
  for (const e of stale) out(`STALE: ${e.check} ${e.file}${e.line ? `:${e.line}` : ''} matches no finding any more; remove it from ${knownFile}`)
  return code
}

// Every blocking place of the changed files, worst first: severity, then check id, then file and line.
export function topRows(out, checks = []) {
  const byId = new Map(checks.map((c) => [c.id, c]))
  const rows = []
  for (const r of out.rows ?? []) {
    if (!failing(r)) continue
    const places = r.places?.length ? r.places : [{ file: '', line: 0, message: String(r.detail ?? '').split(String.fromCharCode(10))[0].slice(0, 200) }]
    for (const p of places) {
      const f = (r.findings ?? []).find((x) => x?.file && String(x.file).replace(/\\/g, '/').endsWith(p.file) && Number(x.line) === p.line)
      const severity = isSeverity(f?.severity) ? f.severity : defaultSeverity(byId.get(r.id))
      rows.push({ file: p.file || '(no file)', check: r.id, line: p.line, message: p.message, severity })
    }
  }
  return rows.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || a.check.localeCompare(b.check) || a.file.localeCompare(b.file) || a.line - b.line)
}

export function topTable(rows, limit) {
  if (!rows.length) return 'no findings in the changed files'
  const shown = rows.slice(0, limit).map((r) => [r.file, r.check, r.line ? String(r.line) : '-', (r.message || '').replace(/\s+/g, ' ').slice(0, 90)])
  const head = ['file', 'check', 'line', 'message']
  const width = head.map((h, i) => Math.max(h.length, ...shown.map((r) => r[i].length)))
  const fmt = (r) => r.map((c, i) => (i === 3 ? c : c.padEnd(width[i]))).join('  ').trimEnd()
  const lines = [fmt(head), `${width.slice(0, 3).map((w) => '-'.repeat(w)).join('  ')}  -------`, ...shown.map(fmt)]
  if (rows.length > shown.length) lines.push(`(${rows.length - shown.length} more; --limit ${rows.length} shows all)`)
  return lines.join('\n')
}

export async function runTop(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let limit = 10
  let oneLine = false
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--line') oneLine = true
    else if (argv[i] === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 1) return noResult(out, '--limit needs a whole number, 1 or more', 'usage: meerkat top [folder] [--base <ref>] [--limit <n>]', EXIT.usage)
      limit = n
    } else rest.push(argv[i])
  }
  const r = await gather('top', [...rest, '--all-findings'], { env, cwd, out, err })
  if (r.stop !== undefined) return r.stop
  const rows = topRows(r.g.out, r.g.checks)
  if (oneLine) {
    // One line for a client that wants only the first thing to fix: file:line check: message, or PASS. NO-RESULT and INCOMPLETE come from gather().
    const f = rows[0]
    out(f ? `${f.file}${f.line ? `:${f.line}` : ''} ${f.check}: ${(f.message || '').replace(/\s+/g, ' ').slice(0, 160)}` : 'PASS')
    return f ? 1 : 0
  }
  out(topTable(rows, limit))
  return 0
}
