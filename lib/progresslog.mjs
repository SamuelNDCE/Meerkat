// Progress log: a long run (gate, verdict, top, map, test-run, a plain run) appends one timestamped line every 10 seconds to
// <run folder>/progress.log, naming the current step (phase, checks done of total, the checks running, elapsed). The last line says why it
// ended: finished, time limit, interrupt or error. `meerkat logs <run>` prints it. One run at a time per process; every piece is a no-op when
// nothing is armed, so a library caller pays nothing. The timer is unref'd and cleared at the end: it never keeps a process alive.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setRunId } from './childreg.mjs'

export const PROGRESS_FILE = 'progress.log'
const state = { armed: null, active: null }

const clock = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function write(a, text) {
  try {
    appendFileSync(join(a.dir, PROGRESS_FILE), `${new Date().toISOString()} ${text}\n`)
  } catch {
    /* a progress problem never stops a run */
  }
}
const line = (a) => `[progress] phase=${a.phase} check=${a.total ? `${a.done} of ${a.total} done` : '-'} running=${[...a.running].join(',') || '-'} elapsed=${clock(Date.now() - a.t0)}`

// Say that the next run folder made in this process gets a progress log. `intervalMs` defaults to 10 s (MEERKAT_PROGRESS_MS overrides it).
export function armProgress({ label = 'run', intervalMs = Number(process.env.MEERKAT_PROGRESS_MS) || 10_000 } = {}) {
  state.armed = { label, intervalMs, reason: null }
}

// Called by makeRunDir when a folder is made: if a run is armed and has no folder yet, it starts writing there.
export function attachRunDir(dir) {
  const arm = state.armed
  if (!arm || state.active || !dir) return
  const a = { dir, label: arm.label, t0: Date.now(), phase: 'starting', total: 0, done: 0, running: new Set(), reason: arm.reason, timer: null }
  state.active = a
  setRunId(String(dir).split('/').pop())
  write(a, `[start] ${a.label}`)
  write(a, line(a))
  a.timer = setInterval(() => write(a, line(a)), arm.intervalMs)
  a.timer.unref?.()
}

export const progressPhase = (name) => {
  if (state.active) state.active.phase = name
}
export const progressPlan = (total) => {
  const a = state.active
  if (a) {
    a.total = total
    a.done = 0
    a.phase = 'checks'
  }
}
export const progressCheckStart = (id) => {
  state.active?.running.add(id)
}
export const progressCheckEnd = (id) => {
  const a = state.active
  if (a && a.running.delete(id)) a.done++
}
// Remember why the run is stopping before it ends (time limit, interrupt). The first reason given wins.
export function noteStopReason(reason) {
  if (state.active && !state.active.reason) state.active.reason = reason
  else if (state.armed && !state.armed.reason) state.armed.reason = reason
}

// Write the last line and stop. `reason` is only used when no earlier reason was noted.
export function endProgress(reason = 'finished') {
  const a = state.active
  const why = a?.reason ?? state.armed?.reason ?? reason
  state.armed = null
  state.active = null
  if (!a) return
  clearInterval(a.timer)
  write(a, line(a))
  write(a, `[stop] reason=${why} elapsed=${clock(Date.now() - a.t0)}`)
}

// An armed run that ends the process without calling endProgress still gets its last line.
process.on('exit', (code) => {
  if (state.active) endProgress(code === 0 ? 'finished' : `exited with code ${code}`)
})
for (const sig of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) {
  try {
    process.on(sig, () => noteStopReason('interrupt'))
  } catch {
    /* this platform has no such signal */
  }
}
process.on('uncaughtException', (e) => noteStopReason(`error: ${String(e?.message ?? e).slice(0, 120)}`))

export function progressText(dir) {
  try {
    return readFileSync(join(dir, PROGRESS_FILE), 'utf8')
  } catch {
    return null
  }
}
