// The Meerkat viewer, part 3: a second terminal that WATCHES a run without being part of it. It reads the status file
// the runner already rewrites every few seconds (lib/status.mjs) and draws it with the same rows, header and keys as
// the in-run view (`--ui`). Because it only reads, it cannot slow a run down, change a result, or take the run with it
// if it crashes; start it, stop it, start it again at any time.
//
//   node watch.mjs                 follow the run in progress (or show the last one)
//   node watch.mjs --once          print one frame and exit (also what the tests use)
//   node watch.mjs --file <path>   a status file somewhere else (NV_VERIFY_STATUS does the same)
//
// This file holds the pure part: from a status snapshot to rows and a frame.
import { applyFilter, initialState, typicalMs, lastRunMs, samplesFor } from './model.mjs'
import { renderHeader, renderHistory, renderPane, renderRows, renderRunning } from './render.mjs'
import { tailOf } from './index.mjs'
import { mascotEnabled, withMascot } from './mascot.mjs'
import { knownStatus, safeLogPath, stripControl } from './safe.mjs'

// One row per check: finished ones, the running ones, and everything still waiting (the runner lists each pending
// check with the reason it cannot start yet).
// Everything in a status file is untrusted text (it sits in a shared temp folder): control characters are stripped from every
// field, an unknown status becomes NOT RUN, and a saved-output path is kept only if it is inside Meerkat's own log folder.
export function rowsFromStatus(status, timings = { checks: {} }, { env = process.env } = {}) {
  const tier = status?.tier === 'thorough' ? 'thorough' : 'fast'
  const base = (rawId) => {
    const id = stripControl(rawId)
    return {
    id,
    title: id,
    lane: '',
    reason: '',
    startedAt: null,
    ms: null,
    detail: '',
    outputFile: null,
    typicalMs: typicalMs(timings, id, tier),
    lastMs: lastRunMs(timings, id, tier),
    samples: samplesFor(timings, id, tier),
    expectedMs: 30_000,
    elapsedMs: null,
    slow: false,
    }
  }
  const rows = []
  for (const f of status?.finished ?? []) {
    // The runner writes the path at the very end of the line; anchor to the end so text earlier in a detail cannot pose as it.
    const m = /\[full output: ([^\]]+)\]\s*$/.exec(String(f.detail ?? ''))
    rows.push({ ...base(f.id), status: knownStatus(f.status), ms: f.ms, elapsedMs: f.ms, detail: stripControl(f.detail), outputFile: m ? safeLogPath(m[1], { env }) : null })
  }
  for (const r of status?.running ?? []) {
    rows.push({ ...base(r.id), status: 'RUNNING', lane: stripControl(r.lane), elapsedMs: r.elapsedMs, expectedMs: r.expectedMs ?? 30_000, slow: Boolean(r.overran), startedAt: Date.now() - r.elapsedMs })
  }
  for (const w of status?.waiting ?? []) rows.push({ ...base(w.id), status: 'WAITING', reason: stripControl(w.reason) })
  return rows
}

// A status file that is older than this while the run says "running" probably belongs to a run that is gone.
export const STALE_MS = 60_000

export function staleNote(status, now = Date.now()) {
  if (!status || status.state !== 'running') return ''
  const age = now - Date.parse(status.updatedAt)
  return Number.isFinite(age) && age > STALE_MS ? `  (status file last updated ${Math.round(age / 1000)}s ago: the run may have stopped)` : ''
}

// The whole screen as lines. `state` is the view state from model.mjs (selection, filter, history tab).
export function frameFromStatus(status, { timings, history = [], state = initialState(), width = 100, color = true, now = Date.now(), read, env = process.env } = {}) {
  if (!status) return ['No Meerkat status file yet. Start a run (node run.mjs ...) and this follows it.']
  const all = rowsFromStatus(status, timings, { env })
  const rows = applyFilter(all, state.filter)
  const sel = rows[Math.min(state.selected, Math.max(0, rows.length - 1))]
  const head = renderHeader({
    title: stripControl(status.title) || 'MEERKAT',
    rows: all,
    started: 0,
    now,
    width,
    color,
    override: { fraction: (status.percent ?? 0) / 100, etaMs: status.etaMs ?? null, elapsedMs: status.elapsedMs ?? 0 },
  })
  head[1] += status.state === 'done' ? '   finished' : staleNote(status, now)
  const lines = [...withMascot(head, all, { tick: Math.floor(now / 1000), width, enabled: mascotEnabled() })]
  if (state.view === 'history') return [...lines, '', ...renderHistory(history, sel, { width }), '', '  Tab: back to the live view']
  lines.push('', ...renderRows(rows, { selected: state.selected, width, color }), '', ...renderRunning(all.map((r) => (r.status === 'RUNNING' ? { ...r, startedAt: now - r.elapsedMs } : r)), now))
  if (state.pane && sel) lines.push(...renderPane(sel, sel.outputFile ? tailOf(sel.outputFile, state.open ? 14 : 6, read) : [], { open: state.open }))
  if (status.summary) lines.push('', `  ${stripControl(status.summary)}`)
  lines.push(`  keys: up/down move  Enter output  Tab history  f filter (${state.filter})  l pane  q quit`)
  return lines
}
