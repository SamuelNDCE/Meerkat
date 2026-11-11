// Start order for the gate's pool: longest recorded wall time first, checks with no history first of all.
//
// The wall time of a gate is decided by its longest check and by how well the rest fill the other slots, so the long work must start
// first. A check that has never run on this project has no time on record; it is assumed long, so it starts early rather than last.
// Only the ORDER changes: which checks run, what they read and what they report are untouched (the findings are identical).
// The times are kept per project in one small file beside the gate cache, updated after every gate run (a --no-cache run too).
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { projectSlug, writeAtomic } from './findingshistory.mjs'
import { cacheHome } from './resultcache.mjs'

export const gateTimesFile = (env, projectPath) => join(cacheHome(env), `${projectSlug(projectPath)}--gate-times.json`).split('\\').join('/')

export function readGateTimes(file) {
  try {
    const t = JSON.parse(readFileSync(file, 'utf8'))
    if (t && t.schemaVersion === 1 && t.ms && typeof t.ms === 'object') return t.ms
  } catch {
    /* no history yet, or unreadable: every check counts as never run */
  }
  return {}
}

// Order `checks` for the pool. `ms` maps check id -> last recorded wall time. A check that others wait on (`after`) ranks by the longest
// chain that waits on it, so it starts before the work it holds up. Unknown = Infinity (first). Ties keep the incoming order.
export function orderLongestFirst(checks, ms = {}) {
  const ids = new Set(checks.map((c) => c.id))
  const own = (c) => (Number.isFinite(ms[c.id]) && ms[c.id] >= 0 ? ms[c.id] : Infinity)
  const dependents = new Map(checks.map((c) => [c.id, []]))
  for (const c of checks) for (const d of c.after ?? []) if (ids.has(d)) dependents.get(d).push(c)
  const memo = new Map()
  const chain = (c, seen = new Set()) => {
    if (memo.has(c.id)) return memo.get(c.id)
    if (seen.has(c.id)) return own(c) // a dependency cycle: the scheduler reports it
    seen.add(c.id)
    const w = own(c) + Math.max(0, ...dependents.get(c.id).map((d) => chain(d, seen)))
    memo.set(c.id, w)
    return w
  }
  const index = new Map(checks.map((c, i) => [c.id, i]))
  const weight = (c) => chain(c)
  return [...checks].sort((a, b) => {
    const wa = weight(a)
    const wb = weight(b)
    if (wa === wb) return index.get(a.id) - index.get(b.id)
    return wb > wa ? 1 : -1
  })
}

// The history after a run: the wall time of every check that actually ran to its end (a stopped, skipped or timed-out check says nothing).
export function updatedGateTimes(old, results) {
  const ms = { ...old }
  for (const r of results ?? []) {
    if (!r || !(r.ms >= 0)) continue
    if (r.status === 'PASS' || r.status === 'FAIL') ms[r.id] = Math.max(1, Math.round(r.ms))
  }
  return JSON.stringify({ schemaVersion: 1, ms })
}

export function saveGateTimes(file, text) {
  try {
    writeAtomic(file, text)
  } catch {
    /* a history that cannot be written only costs a worse order */
  }
}
