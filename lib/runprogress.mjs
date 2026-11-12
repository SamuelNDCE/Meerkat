// How far a run is: percent, what is running now and for how long, elapsed time and an estimate of the time left.
// For people: one summary line on stderr, "[37% 84/226 | 1m40s elapsed | ETA ~3m10s] running: rust-clippy (since 1m12s)".
// For AIs: <run folder>/progress.json, written atomically while the run is going and marked "done" at the end.
//
// createProgress is pure (every time comes from the injected clock), so it can be unit tested without waiting.
// ETA = average duration of the checks that finished and ran (cached ones took no time, so they are left out) x checks still to finish.
// It is only given after 2 timed checks have finished; before that it is "unknown", never a guess.
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROGRESS_JSON = 'progress.json'
export const MIN_TIMED_FOR_ETA = 2

// 45s, 1m40s, 1h02m05s
export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s >= 3600) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`
  if (s >= 60) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${s}s`
}

// One line for a person from a snapshot (or a progress.json document, which has the same fields).
export function renderLine(s) {
    const eta = s.total > 0 && s.finished >= s.total ? 'done' : s.etaSeconds === null ? 'ETA unknown' : `ETA ~${formatClock(s.etaSeconds * 1000)}`
    const grew = s.runs > 1 ? ` (total grew: gate run ${s.runs})` : ''
    const [first, ...rest] = s.running
    const what = first ? `running: ${first.id} (since ${formatClock(first.sinceSeconds * 1000)})${rest.length ? ` and ${rest.length} more` : ''}` : s.finished >= s.total && s.total > 0 ? 'running: none' : 'running: none (starting the next check)'
    const head = `[${s.percent}% ${s.finished}/${s.total}${grew} | ${formatClock(s.elapsedSeconds * 1000)} elapsed | ${eta}]`
    return s.total > 0 && s.finished >= s.total ? head : `${head} ${what}`
}

export function createProgress({ total = 0, now = Date.now, already = 0 } = {}) {
  const t0 = now()
  let totalN = total
  let finishedN = already
  let runs = total > 0 ? 1 : 0
  const live = new Map() // key -> { id, at }
  const durations = []
  const snapshot = () => {
    const t = now()
    const running = [...live.values()].sort((a, b) => a.at - b.at).map((r) => ({ id: r.id, sinceSeconds: Math.floor((t - r.at) / 1000) }))
    const remaining = Math.max(0, totalN - finishedN)
    const etaSeconds = durations.length >= MIN_TIMED_FOR_ETA ? Math.round(((durations.reduce((a, b) => a + b, 0) / durations.length) * remaining) / 1000) : null
    return { percent: totalN > 0 ? Math.min(100, Math.floor((finishedN / totalN) * 100)) : 0, finished: finishedN, total: totalN, running, elapsedSeconds: Math.floor((t - t0) / 1000), etaSeconds, runs }
  }
  const line = () => renderLine(snapshot())
  return {
    start: (id, key = id) => void live.set(key, { id, at: now() }),
    // ms is for a caller that measured the check itself; otherwise the time since start() is used.
    finish: (id, ms, key = id) => {
      const at = live.get(key)?.at
      live.delete(key)
      finishedN += 1
      const took = Number.isFinite(ms) ? ms : at === undefined ? null : now() - at
      if (took !== null) durations.push(Math.max(0, took))
    },
    // A later gate run adds its checks to the total (batch: one progress over every gate run). `done` of them are already finished (cached).
    addTotal: (n, done = 0) => {
      totalN += n
      finishedN += done
      runs += 1
    },
    snapshot,
    line,
  }
}

// The document written to progress.json.
export function progressDoc(snap, state, now = Date.now) {
  return { state, percent: snap.percent, finished: snap.finished, total: snap.total, running: snap.running, elapsedSeconds: snap.elapsedSeconds, etaSeconds: snap.etaSeconds, updated: new Date(now()).toISOString() }
}

// Write <dir>/progress.json: a temp file beside it, then a rename, so a reader never sees half a file. A write that fails is only a missing update.
export function writeProgressFile(dir, doc) {
  const file = join(dir, PROGRESS_JSON)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(doc)}\n`)
    renameSync(tmp, file)
    return true
  } catch {
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* nothing to clean */
    }
    return false
  }
}

// A progress for one run: the summary line to `say` (may be null), the file in `dir` (may be null). The file is written on every start and finish,
// and on a beat at most once every minGapMs.
export function trackProgress({ total = 0, already = 0, say = null, dir = null, now = Date.now, minGapMs = 1000 } = {}) {
  const p = createProgress({ total, now, already })
  let lastWrite = Number.NEGATIVE_INFINITY
  const save = (state, force) => {
    if (!dir) return
    const t = now()
    if (!force && t - lastWrite < minGapMs) return
    lastWrite = t
    writeProgressFile(dir, progressDoc(p.snapshot(), state, now))
  }
  const speak = () => say?.(p.line())
  save('running', true)
  const api = {
    p,
    start: (id, key) => (p.start(id, key), speak(), save('running', true)),
    finish: (id, ms, key) => (p.finish(id, ms, key), speak(), save('running', true)),
    // The heartbeat: a summary line while something runs, and a file refresh (rate limited).
    beat: () => {
      if (p.snapshot().running.length) speak()
      save('running', false)
    },
    end: () => save('done', true),
    // A gate run inside a batch reports here; its checks are added to the batch total and it gets its own handle.
    observer: {
      begin: (n, done = 0) => {
        p.addTotal(n, done)
        const tag = `r${p.snapshot().runs}:`
        save('running', true)
        return {
          start: (id) => api.start(id, tag + id),
          finish: (id, ms) => api.finish(id, ms, tag + id),
          beat: () => api.beat(),
        }
      },
    },
  }
  return api
}

// The one place a batch (or any caller that runs several gates) listens to the gates inside it: while an observer is set, a gate run reports to it
// and prints no summary line of its own.
let observer = null
export const setProgressObserver = (o) => void (observer = o)
export const getProgressObserver = () => observer

// For a caller that runs several gates (batch): one progress over all of them. The gates inside report to it and print no summary line of their own.
// stop() puts the gates back to their own lines and marks the file done.
export function watchGates({ say = null, dir = null } = {}) {
  const t = trackProgress({ say, dir })
  setProgressObserver(t.observer)
  return { stop: () => (setProgressObserver(null), t.end()) }
}
