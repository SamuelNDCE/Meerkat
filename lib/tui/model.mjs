// Meerkat terminal UI, part 1: the model. Pure: no terminal, no clock of its own, so a test can drive it with fake
// events. It holds one row per check and is fed the same events the progress bar and the status file already get
// (start, settle, queue). It never changes a result.
import { median } from '../timings.mjs'
import { stripControl } from './safe.mjs'

export const OUTPUT_FILE_RE = /\[full output: ([^\]]+)\]/

// The saved-output path a failed check names on its result line (runner.mjs saveFailureLog), or null.
export function outputFileFrom(detail) {
  const m = OUTPUT_FILE_RE.exec(detail ?? '')
  return m ? m[1] : null
}

export const samplesFor = (timings, id, tier) => (timings?.checks?.[id]?.[tier] ?? []).filter((n) => Number.isFinite(n) && n > 0)
// The middle of the saved passing times on this PC (ms), or null when none were measured.
export const typicalMs = (timings, id, tier) => median(samplesFor(timings, id, tier))
export const lastRunMs = (timings, id, tier) => {
  const s = samplesFor(timings, id, tier)
  return s.length ? s[s.length - 1] : null
}

// A running check this many times over its typical time is marked "slower than usual".
export const SLOW_FACTOR = 1.5

export function createModel({ checks, timings = { checks: {} }, tier = 'fast' }) {
  const rows = new Map()
  for (const c of checks) {
    rows.set(c.id, {
      id: c.id,
      title: c.title ?? c.id,
      lane: c.lane,
      after: c.after ?? [],
      status: 'WAITING',
      reason: '',
      startedAt: null,
      begunAt: null,
      endedAt: null,
      ms: null,
      detail: '',
      outputFile: null,
      currentFile: '',
      filesDone: null,
      filesTotal: null,
      typicalMs: typicalMs(timings, c.id, tier),
      lastMs: lastRunMs(timings, c.id, tier),
      samples: samplesFor(timings, c.id, tier),
      expectedMs: Math.max(1, c.estSeconds ?? 30) * 1000,
    })
  }
  return {
    rows,
    start(check, now) {
      const r = rows.get(check.id)
      if (!r) return
      Object.assign(r, { status: 'RUNNING', startedAt: now, begunAt: now, reason: '' })
    },
    // What a running check says it is looking at (lib/progress-files.mjs): { file } and/or { done, total }. Text from a child is
    // untrusted, so it is cleaned and capped here as well.
    progress(check, p) {
      const r = rows.get(check.id)
      if (!r || r.status !== 'RUNNING' || !p) return
      if (typeof p.file === 'string') r.currentFile = stripControl(p.file).slice(0, 120)
      if (Number.isFinite(p.total)) {
        r.filesTotal = p.total
        r.filesDone = Number.isFinite(p.done) ? Math.min(p.done, p.total) : r.filesDone
      }
    },
    settle(check, result, ms) {
      const r = rows.get(check.id)
      if (!r) return
      // The saved-output path comes from the runner's own field, never from the text of the detail line.
      Object.assign(r, { status: result.status, ms, currentFile: '', detail: result.detail ?? '', outputFile: result.outputFile ?? null, startedAt: null, endedAt: r.begunAt === null ? null : r.begunAt + (ms ?? 0), reason: '' })
    },
    queue(list) {
      const why = new Map(list.map((w) => [w.id, w.reason]))
      for (const r of rows.values()) if (r.status === 'WAITING') r.reason = why.get(r.id) ?? ''
    },
    // Rows in run order with elapsed time and the slower-than-usual flag worked out for `now`.
    snapshot(now) {
      return [...rows.values()].map((r) => {
        const elapsedMs = r.status === 'RUNNING' ? now - r.startedAt : r.ms
        const base = r.typicalMs ?? r.expectedMs
        return { ...r, elapsedMs, slow: r.status === 'RUNNING' && elapsedMs > base * SLOW_FACTOR }
      })
    },
  }
}

// Which rows the filter key shows: all, only the ones that need a look, only the running ones.
export const FILTERS = ['all', 'problems', 'running']
export function applyFilter(rows, filter) {
  if (filter === 'problems') return rows.filter((r) => r.status === 'FAIL' || r.status === 'NOT RUN' || r.slow)
  if (filter === 'running') return rows.filter((r) => r.status === 'RUNNING')
  return rows
}

// Keys. Pure: takes the view state, returns the next one, so the key table is testable without a terminal.
export function nextState(state, key, { rowCount = 0 } = {}) {
  const s = { ...state }
  const last = Math.max(0, rowCount - 1)
  if (key === 'up' || key === 'k') s.selected = Math.max(0, s.selected - 1)
  else if (key === 'down' || key === 'j') s.selected = Math.min(last, s.selected + 1)
  else if (key === 'tab') s.view = s.view === 'live' ? 'history' : 'live'
  else if (key === 'f') {
    s.filter = FILTERS[(FILTERS.indexOf(s.filter) + 1) % FILTERS.length]
    s.selected = 0
  } else if (key === 'l') s.pane = !s.pane
  else if (key === 'enter') s.open = !s.open
  s.selected = Math.min(s.selected, last)
  return s
}

export const initialState = () => ({ selected: 0, view: 'live', filter: 'all', pane: true, open: false })
