// Meerkat terminal UI, part 1: the model. Pure: no terminal, no clock of its own, so a test can drive it with fake
// events. It holds one row per check and is fed the same events the progress bar and the status file already get
// (start, settle, queue). It never changes a result.
import { median } from '../timings.mjs'
import { defaultSeverity } from '../findings.mjs'
import { stripControl } from './safe.mjs'
import { packOf } from './group.mjs'
import { hasSubs, subCounts } from '../subchecks.mjs'
import { declaredSubs, suiteOf } from '../suites.mjs'

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

// "Slower than usual": the typical time was measured for THIS project, and the check has run over 3x that and over 2 s.
export const SLOW_OVER = 3
export const SLOW_MIN_MS = 2000
export const isSlow = ({ spent, typicalMs, typicalHere = true }) => Boolean(typicalHere) && typicalMs !== null && typicalMs !== undefined && spent > typicalMs * SLOW_OVER && spent > SLOW_MIN_MS

const SEVS = ['critical', 'high', 'medium', 'low', 'info']
const zeroCounts = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 })

// A check not yet timed on this PC: a tiny in-process check (weight 'tiny', written as 2 s or less) really takes a few hundred
// milliseconds. Measured 2026-11-01 on five generated apps: 278 such checks, median 226 ms, slowest 414 ms, against the written 1000 ms,
// which made a first-run estimate about six times too long (42 s estimated, 7 s taken). Once timed, the learned time wins.
export const TINY_FIRST_RUN_MS = 300
export const MISSING_TOOL_MS = 50 // a check whose tool is not installed ends NOT RUN at once (measured: 14 ms)
const firstRunMs = (c, learned) => (c.toolMissing ? MISSING_TOOL_MS : learned === null && c.weight === 'tiny' && (c.estSeconds ?? 30) <= 2 ? TINY_FIRST_RUN_MS : Math.max(1, c.estSeconds ?? 30) * 1000)

// The board row of one check. Made for the checks the board starts with, and for any check that shows up later (a found check).
function rowFor(c, timings, tier, typicalHere) {
  return {
    id: c.id,
    title: c.title ?? c.id,
    lane: c.lane,
    group: c.group ?? null,
    pack: packOf(c.source),
    suite: suiteOf(c),
    origin: c.origin ?? 'bundled',
    declaredSubs: declaredSubs(c),
    subTotal: null,
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
    lastOutputAt: null,
    typicalMs: typicalMs(timings, c.id, tier),
    typicalHere,
    lastMs: lastRunMs(timings, c.id, tier),
    samples: samplesFor(timings, c.id, tier),
    expectedMs: firstRunMs(c, typicalMs(timings, c.id, tier)),
  }
}

export function createModel({ checks, timings = { checks: {} }, tier = 'fast', typicalHere = true }) {
  const rows = new Map()
  const found = new Map()
  // The row of a check, made the first time the check is seen. A check the board was not given up front (a found check, or one whose
  // start event is the first thing the board hears of) is never dropped from the board.
  const ensure = (c) => {
    if (!rows.has(c.id)) rows.set(c.id, rowFor(c, timings, tier, typicalHere))
    return rows.get(c.id)
  }
  for (const c of checks) ensure(c)
  return {
    rows,
    start(check, now) {
      const r = ensure(check)
      Object.assign(r, { status: 'RUNNING', startedAt: now, begunAt: now, lastOutputAt: now, reason: '' })
    },
    // Any sign of life from a running check (a progress line, a printed line): the stuck hint counts from the last one.
    touch(check, now) {
      const r = rows.get(check.id)
      if (r && r.status === 'RUNNING' && Number.isFinite(now)) r.lastOutputAt = now
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
    // The problems found so far: each FAILED check adds the findings it parsed; a failed check with none counts as one (its default
    // severity, medium unless the check says otherwise). A passing check adds nothing, not-run checks add nothing, and the counter never
    // goes down: a check settled again keeps the larger count.
    bugs() {
      const total = zeroCounts()
      for (const c of found.values()) for (const k of Object.keys(c)) total[k] += c[k]
      return total
    },
    settle(check, result, ms, findings = null) {
      const r = ensure(check)
      const c = zeroCounts()
      if (result.status === 'FAIL') {
        const list = Array.isArray(findings) ? findings : []
        for (const f of list) {
          const sev = SEVS.includes(f?.severity) ? f.severity : 'medium'
          c[sev]++
          c.total++
        }
        if (!list.length) {
          c[defaultSeverity(check)]++
          c.total++
        }
      }
      const prev = found.get(check.id)
      found.set(check.id, prev && prev.total > c.total ? prev : c)
      // The saved-output path comes from the runner's own field, never from the text of the detail line.
      Object.assign(r, { status: result.status, ms, subTotal: hasSubs(result) ? subCounts(result).total : null, currentFile: '', detail: result.detail ?? '', outputFile: result.outputFile ?? null, startedAt: null, lastOutputAt: null, endedAt: r.begunAt === null ? null : r.begunAt + (ms ?? 0), reason: '' })
    },
    queue(list) {
      const why = new Map(list.map((w) => [w.id, w.reason]))
      for (const r of rows.values()) if (r.status === 'WAITING') r.reason = why.get(r.id) ?? ''
    },
    // Rows in run order with elapsed time and the slower-than-usual flag worked out for `now`.
    snapshot(now) {
      return [...rows.values()].map((r) => {
        const elapsedMs = r.status === 'RUNNING' ? now - r.startedAt : r.ms
        return { ...r, found: found.get(r.id)?.total ?? 0, elapsedMs, slow: r.status === 'RUNNING' && isSlow({ spent: elapsedMs, typicalMs: r.typicalMs, typicalHere: r.typicalHere }) }
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
  } else if (key === 'g') s.grouped = !(s.grouped ?? true)
  else if (key === 'l') s.pane = !s.pane
  else if (key === 'enter') s.open = !s.open
  s.selected = Math.min(s.selected, last)
  return s
}

export const initialState = () => ({ selected: 0, view: 'live', filter: 'all', pane: true, open: false })
