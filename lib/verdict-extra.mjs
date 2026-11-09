// `meerkat verdict` helpers for the base line, --timings and --rerun-failed. Pure functions plus one small record file; the verdict itself stays in lib/branchcmds.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
