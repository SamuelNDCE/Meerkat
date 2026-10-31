// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// How long is left, worked out the way the run itself will work: a small simulation of the rest of the run. Every running
// check has what is left of its usual time on this PC; every waiting check starts when what it waits for is finished and its
// lane is free (one cargo job at a time, one window job at a time, as many light jobs as there are free slots); the answer is
// when the last one ends. Unlike "time spent divided by progress", it counts down at one second per second while checks run
// as expected, and it knows that a long check at the end cannot be sped up by the short ones before it.
//
// Pure: rows in (the snapshot rows of lib/tui/model.mjs), milliseconds out.

// A check that has run past its usual time is assumed to be close to done: a short tail, not another full run.
const OVERRUN_TAIL = 0.15
const MIN_TAIL_MS = 2000

const baseMs = (r) => r.typicalMs ?? r.expectedMs ?? 30_000

export function estimateRemaining(rows, now, { freeSlots = 4 } = {}) {
  const live = rows.filter((r) => r.status === 'RUNNING' || r.status === 'WAITING')
  if (!live.length) return 0
  const ids = new Set(rows.map((r) => r.id))
  const finished = new Set(rows.filter((r) => r.status === 'PASS').map((r) => r.id))
  // A waiting check whose dependency failed or was not run will not run, so it adds no time.
  const dead = new Set(rows.filter((r) => r.status === 'FAIL' || r.status === 'NOT RUN').map((r) => r.id))
  const running = new Map() // id -> end time on the simulated clock, which starts at 0 "now"
  const lane = { cargo: 0, electron: 0, free: 0 }
  const cap = { cargo: 1, electron: 1, free: Math.max(1, freeSlots) }
  let t = 0
  for (const r of rows.filter((x) => x.status === 'RUNNING')) {
    const spent = now - (r.startedAt ?? now)
    const base = baseMs(r)
    const left = spent < base ? base - spent : Math.max(MIN_TAIL_MS, base * OVERRUN_TAIL)
    running.set(r.id, left)
    lane[r.lane] = (lane[r.lane] ?? 0) + 1
  }
  const waiting = rows.filter((r) => r.status === 'WAITING')
  const pending = new Map(waiting.map((r) => [r.id, r]))
  const blocked = (r) => (r.after ?? []).some((d) => ids.has(d) && dead.has(d))
  for (const r of waiting) if (blocked(r)) pending.delete(r.id)
  let guard = 0
  while ((running.size || pending.size) && guard++ < 1000) {
    // Start everything that can start now, in the order given (the run's own start order).
    for (const r of [...pending.values()]) {
      const ready = (r.after ?? []).every((d) => !ids.has(d) || finished.has(d))
      const room = (lane[r.lane] ?? 0) < (cap[r.lane] ?? cap.free)
      if (ready && room) {
        running.set(r.id, t + baseMs(r))
        lane[r.lane] = (lane[r.lane] ?? 0) + 1
        pending.delete(r.id)
      }
    }
    if (!running.size) break // what is left waits on something that never finishes; do not loop forever
    // Move the clock to the next end.
    let nextId = null
    let nextAt = Infinity
    for (const [id, at] of running) {
      if (at < nextAt) {
        nextAt = at
        nextId = id
      }
    }
    t = Math.max(t, nextAt)
    const row = rows.find((x) => x.id === nextId)
    running.delete(nextId)
    lane[row?.lane] = Math.max(0, (lane[row?.lane] ?? 1) - 1)
    finished.add(nextId)
  }
  return Math.max(0, Math.round(t))
}
