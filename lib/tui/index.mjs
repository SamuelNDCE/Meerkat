// Meerkat's live board for a real run (opt-in: `--ui`, real terminal only). It is the board shown in preview.mjs, fed by the
// events a run already produces: a pixel-art meerkat head, an animated overall bar with an estimated time left, what runs
// in each lane right now (with the newest line each check printed, its own bar and its own estimate), every check with its
// status, time and a timeline strip that shows what ran in parallel, and the latest events. It only READS events, so it
// cannot change a result or an exit code, and a terminal that is not interactive (a pipe, CI) gets the plain lines.
//
// The board is drawn on the terminal's alternate screen, redrawn from the top-left every frame (it never scrolls or
// leaves old frames), and when the run ends the finished board is left on the normal screen above the results table.
// Under 100 columns the compact view is used instead (no head, no timeline). Keys: o shows the end of the first failed
// check's saved output, h shows past runs, Ctrl+C stops the run.
import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { estimateRemaining } from '../eta.mjs'
import { formatDuration } from '../progress.mjs'
import { colorLevel } from './color.mjs'
import { loadTheme } from './theme.mjs'
import { createModel } from './model.mjs'
import { renderLive } from './live.mjs'
import { renderHeader, renderHistory, renderPane, renderRows, renderRunning } from './render.mjs'
import { safeLogPath, stripControl } from './safe.mjs'
import { createThrottle } from '../progress-files.mjs'

const ESC = '\x1b['
export const KEY_NAMES = { '\x1b[A': 'up', '\x1b[B': 'down', '\r': 'enter', '\n': 'enter', '\t': 'tab', o: 'o', h: 'h', q: 'q', '\x03': 'ctrl-c' }
export const WIDE_ENOUGH = 100

export function tailOf(file, n, read = readFileSync) {
  try {
    const lines = String(read(file, 'utf8')).split(/\r?\n/)
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    // A log is whatever the tools printed (colour codes, progress bars with carriage returns): show it as plain text.
    return lines.slice(-n).map(stripControl)
  } catch (e) {
    return [`(cannot read ${stripControl(file)}: ${stripControl(e.code ?? e.message)})`]
  }
}

// Whether the rich view may be drawn: a real terminal, not CI, not asked to be plain.
export function canUseUi({ isTTY, env = process.env }) {
  return Boolean(isTTY) && !env.CI && env.MEERKAT_PLAIN !== '1'
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
  tickMs = 60,
  freeSlots = Math.max(1, cpus().length - 1),
  env = process.env,
  theme = loadTheme({ env }),
  meta = '',
  profile = '',
  read = readFileSync,
  onInterrupt = () => process.kill(process.pid, 'SIGINT'),
}) {
  const started = now()
  const model = createModel({ checks, timings, tier })
  const events = []
  const notes = new Map()
  const checkingGate = createThrottle(1000, now)
  const view = { history: false, output: false }
  let tick = 0
  let timer = null
  let stopped = false
  let last = []
  let shown = 0 // the bar's fill, eased toward the target so it glides instead of jumping, and never goes backwards

  const say = (text) => events.push({ at: now(), text })
  const shortDetail = (d) => stripControl(d ?? '').slice(0, 90)

  const frame = () => {
    const t = now()
    const width = Math.min(stream.columns || 110, 120)
    const rows = model.snapshot(t).map((r) => ({ ...r, note: r.status === 'RUNNING' ? notes.get(r.id) : '' }))
    const allDone = rows.length > 0 && rows.every((r) => ['PASS', 'FAIL', 'NOT RUN'].includes(r.status))
    // The countdown and the bar come from one estimate: a simulation of the rest of the run (lib/eta.mjs), so they agree and the
    // time left falls one second per second while checks run as expected.
    const remaining = estimateRemaining(rows, t, { freeSlots })
    const target = allDone ? 1 : (t - started) / Math.max(1, t - started + remaining)
    shown = allDone ? 1 : Math.max(shown, shown + (target - shown) * 0.3)
    let lines
    if (width >= WIDE_ENOUGH) {
      lines = renderLive({ title, rows, events, started, now: t, tick, fraction: shown, etaMs: allDone ? null : remaining, width, height: stream.rows, color, sprite: color ? colorLevel(env) : false, theme })
    } else {
      // A narrow terminal: the compact view, no head and no timeline.
      lines = [...renderHeader({ title, rows, started, now: t, width, color, meta, profile }), '', ...renderRows(rows, { selected: -1, width, color }), '', ...renderRunning(rows, t)]
    }
    if (view.history) lines = [...lines.slice(0, 7), '', ...renderHistory(history, null, { width }), '', '  h: back to the live board']
    if (view.output) {
      const bad = rows.find((r) => (r.status === 'FAIL' || r.status === 'NOT RUN') && r.outputFile)
      // Only a file inside Meerkat's own log folder is ever opened (defence in depth: the path should be ours already).
      const safe = bad ? safeLogPath(bad.outputFile, { env }) : null
      lines.push('', ...(safe ? renderPane({ ...bad, outputFile: safe }, tailOf(safe, 12, read), { open: true }) : ['  No failed check has saved output to show yet.']))
    }
    lines.push(`  keys: o output of the first failure · h past runs · Ctrl+C stop`)
    return lines
  }

  const draw = () => {
    if (stopped) return
    last = frame()
    const rows = (stream.rows || 60) - 1
    stream.write(`${ESC}H${last.slice(0, rows).map((l) => `${l}${ESC}K`).join('\n')}\n${ESC}J`)
  }

  const onKey = (chunk) => {
    const name = KEY_NAMES[String(chunk)]
    if (name === 'ctrl-c') return onInterrupt()
    if (name === 'o') view.output = !view.output
    else if (name === 'h') view.history = !view.history
    else return
    draw()
  }

  const raw = Boolean(input?.isTTY && input.setRawMode)
  // Never leave the cursor hidden, the alternate screen on or the keyboard in raw mode, even after Ctrl+C.
  const restore = () => {
    stream.write(`${ESC}?25h${ESC}?1049l`)
    if (raw) {
      try {
        input.setRawMode(false)
      } catch {
        /* the terminal is already gone */
      }
    }
  }
  process.once('exit', restore)
  stream.write(`${ESC}?1049h${ESC}?25l`)
  if (raw) {
    input.setRawMode(true)
    input.resume()
    input.on('data', onKey)
  }
  draw()
  timer = setInterval(() => {
    tick++
    draw()
  }, tickMs)
  timer.unref?.()

  return {
    enabled: true,
    model,
    key: (name) => {
      if (name === 'o' || name === 'h') onKey(name)
    },
    frame,
    start(check) {
      model.start(check, now())
      say(`started ${check.id}${check.lane === 'cargo' ? ' (cargo lane)' : check.lane === 'electron' ? ' (window lane)' : ''}`)
      draw()
    },
    settle(check, result, ms) {
      model.settle(check, result, ms)
      notes.delete(check.id)
      say(`${result.status} ${check.id} (${formatDuration(ms)})${result.detail ? `: ${shortDetail(result.detail)}` : ''}`)
      draw()
    },
    queue(list) {
      model.queue(list)
    },
    // The newest line a running check printed, shown beside it so no check is a black box.
    output(check, line) {
      notes.set(check.id, stripControl(line).slice(0, 60))
    },
    // The file a running check says it is looking at, and how many it has done (lib/progress-files.mjs). The board shows it on
    // the next frame; the events list gets one "checking" line per second at most, and a new one replaces the last.
    progress(check, p) {
      model.progress(check, p)
      if (typeof p?.file !== 'string' || !checkingGate.ok()) return
      const text = `checking ${stripControl(p.file).slice(0, 120)} (${check.id})`
      const lastEvent = events[events.length - 1]
      if (lastEvent?.kind === 'checking') Object.assign(lastEvent, { at: now(), text })
      else events.push({ at: now(), text, kind: 'checking' })
    },
    note(text) {
      say(text)
      draw()
    },
    stop() {
      if (stopped) return
      const finalBoard = frame()
      stopped = true
      if (timer) clearInterval(timer)
      if (raw) input.off?.('data', onKey)
      restore()
      stream.write(`${finalBoard.filter((l) => !l.startsWith('  keys:')).join('\n')}\n`)
      if (raw) input.pause?.()
    },
  }
}
