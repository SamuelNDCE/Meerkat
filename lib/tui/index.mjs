// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Meerkat terminal UI (opt-in: `--ui`, real terminal only). A richer view of the same events the progress bar and
// the status file already get: every check with its status, elapsed time, typical time on this PC and last run;
// what runs now; the tail of a check's saved output; and a history of past runs. No new dependency: plain ANSI,
// redrawn in place like lib/progress.mjs. It only READS events, so it cannot change a result or an exit code, and a
// terminal that is not interactive (a pipe, CI, NO_COLOR aside) gets the plain lines as before.
//
// Keys: up/down or j/k move, Enter opens/closes the saved output, Tab switches live/history, f filters
// (all, problems, running), l shows/hides the output pane, Ctrl+C stops the run, q quits the keys once it ends.
import { readFileSync } from 'node:fs'
import { applyFilter, createModel, initialState, nextState } from './model.mjs'
import { renderHeader, renderHistory, renderPane, renderRows, renderRunning } from './render.mjs'

const ESC = '\x1b['
export const KEY_NAMES = { '\x1b[A': 'up', '\x1b[B': 'down', '\r': 'enter', '\n': 'enter', '\t': 'tab', k: 'k', j: 'j', f: 'f', l: 'l', q: 'q', '\x03': 'ctrl-c' }

export function tailOf(file, n, read = readFileSync) {
  try {
    const lines = String(read(file, 'utf8')).split(/\r?\n/)
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines.slice(-n)
  } catch (e) {
    return [`(cannot read ${file}: ${e.code ?? e.message})`]
  }
}

// Whether the rich view may be drawn: a real terminal, not CI, not asked to be plain.
export function canUseUi({ isTTY, env = process.env }) {
  return Boolean(isTTY) && !env.CI && env.NV_VERIFY_PLAIN !== '1'
}

export function createTui({
  title,
  checks,
  timings,
  tier,
  history = [],
  stream = process.stdout,
  input = process.stdin,
  now = Date.now,
  color = !process.env.NO_COLOR,
  tickMs = 1000,
  meta = '',
  profile = '',
  read = readFileSync,
  onInterrupt = () => process.kill(process.pid, 'SIGINT'),
}) {
  const started = now()
  const model = createModel({ checks, timings, tier })
  let state = initialState()
  let blockLines = 0
  let timer = null
  let stopped = false
  const cols = () => Math.max(40, Math.min(stream.columns || 100, 140))

  const frame = () => {
    const width = cols()
    const t = now()
    const all = model.snapshot(t)
    const rows = applyFilter(all, state.filter)
    const sel = rows[Math.min(state.selected, Math.max(0, rows.length - 1))]
    const lines = [...renderHeader({ title, rows: all, started, now: t, width, color, meta, profile })]
    if (state.view === 'history') {
      lines.push('', ...renderHistory(history, sel, { width }), '', '  Tab: back to the live view')
      return lines
    }
    lines.push('', ...renderRows(rows, { selected: state.selected, width, color }), '', ...renderRunning(all, t))
    if (state.pane && sel) {
      const n = state.open ? 14 : 6
      lines.push(...renderPane(sel, sel.outputFile ? tailOf(sel.outputFile, n, read) : [], { open: state.open }))
    }
    lines.push(`  keys: up/down move  Enter output  Tab history  f filter (${state.filter})  l pane  Ctrl+C stop`)
    return lines
  }

  const clearBlock = () => {
    if (blockLines > 0) stream.write(`${ESC}${blockLines}A${ESC}0J`)
    blockLines = 0
  }
  const draw = () => {
    const lines = frame()
    stream.write(`${lines.join('\n')}\n`)
    blockLines = lines.length
  }
  const redraw = () => {
    if (stopped) return
    clearBlock()
    draw()
  }

  const onKey = (chunk) => {
    const name = KEY_NAMES[String(chunk)]
    if (name === 'ctrl-c') return onInterrupt()
    if (!name || name === 'q') return
    const rowCount = applyFilter(model.snapshot(now()), state.filter).length
    state = nextState(state, name, { rowCount })
    redraw()
  }

  const raw = Boolean(input?.isTTY && input.setRawMode)
  // Never leave the cursor hidden or the keyboard in raw mode, even after Ctrl+C.
  const restore = () => {
    stream.write(`${ESC}?25h`)
    if (raw) {
      try {
        input.setRawMode(false)
      } catch {
        /* the terminal is already gone */
      }
    }
  }
  process.once('exit', restore)
  stream.write(`${ESC}?25l`)
  if (raw) {
    input.setRawMode(true)
    input.resume()
    input.on('data', onKey)
  }
  draw()
  timer = setInterval(redraw, tickMs)
  timer.unref?.()

  return {
    enabled: true,
    model,
    key: (name) => {
      state = nextState(state, name, { rowCount: applyFilter(model.snapshot(now()), state.filter).length })
      redraw()
    },
    frame,
    start(check) {
      model.start(check, now())
      redraw()
    },
    settle(check, result, ms) {
      model.settle(check, result, ms)
      redraw()
    },
    queue(list) {
      model.queue(list)
    },
    note(text) {
      clearBlock()
      stream.write(`${text}\n`)
      draw()
    },
    stop() {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      if (raw) input.off?.('data', onKey)
      clearBlock()
      const t = now()
      const all = model.snapshot(t)
      stream.write(`${renderHeader({ title, rows: all, started, now: t, width: cols(), color, meta, profile }).join('\n')}\n`)
      restore()
      if (raw) input.pause?.()
    },
  }
}
