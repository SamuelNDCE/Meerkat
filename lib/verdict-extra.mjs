// `meerkat verdict` helpers for the base line, --timings and --rerun-failed. Pure functions plus one small record file; the verdict itself stays in lib/branchcmds.mjs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'

const failing = (r) => r.kind === 'fail' || r.kind === 'crash'

// `base <sha12> (<ref>)`: the commit the verdict compared against, so a stale base is visible. Without a merge base (a working-tree compare) it says so.
export const baseInfo = (changed) => (changed?.mb ? { sha: String(changed.mb).slice(0, 12), ref: changed.ref ?? 'base' } : null)
export const baseLineOf = (info) => (info ? `base ${info.sha} (${info.ref})` : 'base none (no merge base: compared with the working tree)')

// Top `max` checks by wall time: [{ check, seconds, status }].
export function timingRows(out, max = 15) {
  return (out.rows ?? [])
    .map((r) => ({ check: r.id, seconds: Math.round(((r.ms ?? 0) / 1000) * 100) / 100, status: r.cached ? `${r.kind} (cached)` : r.kind }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, max)
}
export function timingLines(out, max = 15) {
  const rows = timingRows(out, max)
  const w = Math.max(5, ...rows.map((r) => r.check.length))
  return [`timings: top ${rows.length} of ${(out.rows ?? []).length} checks by wall time`, `${'check'.padEnd(w)}  seconds  status`, ...rows.map((r) => `${r.check.padEnd(w)}  ${r.seconds.toFixed(2).padStart(7)}  ${r.status}`)]
}

export const failedCheckIds = (out) => [...new Set((out.rows ?? []).filter(failing).map((r) => r.id))]

// The checks that failed in the last verdict of a folder and base: one small JSON file in the Meerkat data folder, keyed by folder and base ref.
export function readFailedRecord(file, key) {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(doc?.[key]?.failed) ? doc[key] : null
  } catch {
    return null
  }
}
// Returns null, or one line saying why the record was not saved (never silent).
export function writeFailedRecord(file, key, failed, commit) {
  try {
    let doc = {}
    try {
      doc = JSON.parse(readFileSync(file, 'utf8')) ?? {}
    } catch {
      doc = {}
    }
    doc[key] = { failed, commit, at: new Date().toISOString() }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(doc, null, 2))
    return null
  } catch (e) {
    return String(e?.message ?? e).split('\n')[0].slice(0, 120)
  }
}

// Is this row a blocking one? A fail that is not pre-existing (the gate already keeps only the places in the change; a row hidden because the base has it is a pass),
// and a crash. With an unfinished base comparison a fail with places cannot be told from one already on the base, so it is unclassified, not blocking.
export const isBlockingRow = (r, baseState = null) => (r.kind === 'fail' && !(baseState === 'unfinished' && r.places?.length)) || r.kind === 'crash'

// The one blocking-so-far count of a run that stopped early. Every line that states it (the stderr "stopped early" line, the verdict line, the batch) reads it from
// here, so two lines never give two numbers for one stop. A count of places (else findings, else 1) per blocking row; a crash is a tool problem and only counts with withCrash.
export function blockingSoFar(out, { withCrash = false } = {}) {
  let n = 0
  for (const r of out.rows ?? []) if (isBlockingRow(r, out.baseState) && (r.kind === 'fail' || withCrash)) n += r.places?.length || r.findings?.length || 1
  return n
}

// A row that did not run: the gate's own kind 'notrun', or the JSON form that carries only status 'NOT RUN' (29an: the JSON form was counted as finished).
const isNotRunRow = (r) => r.kind === 'notrun' || r.status === 'NOT RUN' || r.status === 'notrun'
// The two counts every line and the JSON share: checksTotal = checks the run selected (one row each), checksFinished = those with a result (not cut off by a deadline or Ctrl-C).
export function checkCounts(out) {
  const rows = out.rows ?? []
  return { checksTotal: rows.length, checksFinished: rows.filter((r) => !(isNotRunRow(r) && /run deadline reached|interrupted by you/.test(r.detail ?? ''))).length }
}

// One row per check for the JSON output: id, status, wall seconds, and the file:line of each place that failed. Read by an external queue without parsing text.
export function checkRows(out) {
  return (out.rows ?? []).map((r) => ({
    check: r.id,
    status: r.kind,
    blocking: isBlockingRow(r, out.baseState),
    seconds: Math.round(((r.ms ?? 0) / 1000) * 100) / 100,
    cached: !!r.cached,
    detail: r.detail ?? "",
    places: (r.places ?? []).map((p) => ({ file: p.file, line: p.line ?? 0, ...(r.kind === 'fail' && out.baseState ? { classification: out.baseState === 'unfinished' ? 'unknown' : 'new' } : {}) })),
  }))
}

// The last verdict of a repo and branch, at a fixed path under the Meerkat data folder: verdicts/<repo>-<branch>.json. Written atomically (temp file, then rename). Returns the path, or null when it could not be written.
export function writeVerdictSummary(dataFolder, repoName, branch, doc) {
  try {
    const safe = (x) => String(x || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
    const dir = join(dataFolder, 'verdicts')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${safe(repoName)}-${safe(branch)}.json`)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    renameSync(tmp, file)
    return file
  } catch {
    return null
  }
}
