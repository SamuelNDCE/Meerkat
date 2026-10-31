// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Meerkat terminal UI, part 2: what a person reads. Pure functions from a snapshot to lines of text.
// A status is always a WORD with a mark; colour is a second channel on top, never the only one (NO_COLOR and
// greyscale terminals keep the full meaning).
import { computeProgress, etaMs, formatDuration, renderBar } from '../progress.mjs'

const ESC = '\x1b['
export const MARK = { PASS: '✔', FAIL: '✖', 'NOT RUN': '!', RUNNING: '▶', WAITING: '·' }
const COLOR = { PASS: '32', FAIL: '31', 'NOT RUN': '33', RUNNING: '36', WAITING: '90' }

const seconds = (ms) => (ms === null || ms === undefined ? '-' : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(ms))
const pad = (t, n) => String(t).padEnd(n).slice(0, n)
const clip = (t, w) => {
  const s = String(t).replace(/\s+/g, ' ')
  return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s
}

export function sparkline(samples) {
  const bars = '▁▂▃▄▅▆▇█'
  if (!samples.length) return 'not measured'
  const lo = Math.min(...samples)
  const hi = Math.max(...samples)
  return samples.map((n) => bars[hi === lo ? 3 : Math.round(((n - lo) / (hi - lo)) * 7)]).join('')
}

// One line per check. Narrow terminals (under 60 columns) drop the TYPICAL and LAST RUN columns.
export function renderRows(rows, { selected = 0, width = 100, color = true } = {}) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const wide = width >= 60
  const idW = 24
  const head = wide ? `  ${pad('CHECK', idW)} ${pad('STATUS', 10)} ${pad('NOW', 7)} ${pad('TYPICAL', 9)} LAST RUN` : `  ${pad('CHECK', idW)} ${pad('STATUS', 10)} NOW`
  const out = [c('1', head)]
  rows.forEach((r, i) => {
    const word = `${MARK[r.status] ?? ' '} ${r.status}`
    const status = c(COLOR[r.status] ?? '0', pad(word, 10))
    const typical = r.typicalMs === null ? 'not meas.' : seconds(r.typicalMs)
    const note = r.slow ? '  slower than usual' : r.status === 'WAITING' && r.reason ? `  (${r.reason})` : r.outputFile ? '  (Enter: output)' : ''
    const body = wide
      ? `${pad(r.id, idW)} ${status} ${pad(seconds(r.elapsedMs), 7)} ${pad(typical, 9)} ${seconds(r.lastMs)}${note}`
      : `${pad(r.id, idW)} ${status} ${seconds(r.elapsedMs)}`
    out.push(`${i === selected ? '>' : ' '} ${body}`)
  })
  return out
}

// `override` ({ fraction, etaMs, elapsedMs }) is for a viewer that reads a run's status file instead of watching the run itself.
export function renderHeader({ title, rows, started, now, width = 100, color = true, meta = '', profile = '', override = null }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const checks = rows.map((r) => ({ id: r.id, estSeconds: (r.typicalMs ?? r.expectedMs) / 1000 }))
  const done = new Set(rows.filter((r) => ['PASS', 'FAIL', 'NOT RUN'].includes(r.status)).map((r) => r.id))
  const running = new Map(rows.filter((r) => r.status === 'RUNNING').map((r) => [r.id, r.startedAt]))
  const fraction = override?.fraction ?? computeProgress({ checks, done, running, now }).fraction
  const left = override ? override.etaMs : etaMs(fraction, now - started)
  const n = (s) => rows.filter((r) => r.status === s).length
  const bad = n('FAIL') + n('NOT RUN') > 0
  const bar = renderBar(fraction, Math.max(16, Math.min(40, width - 60)))
  return [
    `${c('1', title)}  ${c(bad ? '33' : '32', bar)} ${c('1', `${Math.floor(fraction * 100)}%`.padStart(4))}  ${done.size}/${rows.length} checks   elapsed ${formatDuration(override?.elapsedMs ?? now - started)}${left === null ? '' : `   about ${formatDuration(left)} left`}`,
    `  ${c('32', `${n('PASS')} passed`)}  ${n('FAIL') ? c('31', `${n('FAIL')} failed`) : '0 failed'}  ${n('NOT RUN') ? c('33', `${n('NOT RUN')} not run`) : '0 not run'}${meta ? `   ${meta}` : ''}${profile ? `   profile ${profile}` : ''}`,
  ]
}

export function renderRunning(rows, now) {
  const run = rows.filter((r) => r.status === 'RUNNING')
  if (!run.length) return ['  Running now: nothing (waiting on a build or a lock)']
  return [`  Running now: ${run.map((r) => `${r.id} [${r.lane}] ${formatDuration(now - r.startedAt)}`).join('  ·  ')}`]
}

// History view: the last runs, and the saved times of the selected check as a small bar strip.
export function renderHistory(runs, row, { width = 100 } = {}) {
  const out = ['  PAST RUNS (newest first)']
  if (!runs.length) out.push('  none recorded yet; a run adds itself when it ends')
  for (const r of [...runs].reverse().slice(0, 10)) out.push(clip(`  ${r.at.slice(0, 16).replace('T', ' ')}  ${pad(r.tier, 9)} ${pad(r.exitCode === 0 ? 'PASS' : 'NOT GREEN', 9)} ${pad(formatDuration(r.ms), 8)} ${r.summary}`, width))
  if (row) out.push('', `  ${row.id}: saved times on this PC  ${sparkline(row.samples)}  (${row.samples.map((n) => seconds(n)).join(', ') || 'none'})`)
  return out
}

export function renderPane(row, tailLines, { open = false } = {}) {
  if (!row) return []
  if (!row.outputFile) return [`  Output of ${row.id}: ${open ? 'no saved output (only a check that did not pass keeps one)' : '-'}`]
  return [`  Output of ${row.id}  (${row.outputFile})`, ...tailLines.map((l) => `    ${l}`)]
}
