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
import { formatShort as formatDuration } from '../progress.mjs'
import { colorLevel } from './color.mjs'
import { loadTheme } from './theme.mjs'
import { createModel } from './model.mjs'
import { renderLive } from './live.mjs'
import { shouldGroup } from './group.mjs'
import { renderHeader, renderHistory, renderPane, renderRows, renderRunning } from './render.mjs'
import { safeLogPath, stripControl } from './safe.mjs'
import { createThrottle } from '../progress-files.mjs'

const ESC = '\x1b['
export const KEY_NAMES = { '\x1b[A': 'up', '\x1b[B': 'down', '\r': 'enter', '\n': 'enter', '\t': 'tab', o: 'o', h: 'h', g: 'g', q: 'q', s: 'skip', k: 'skip', S: 'skip-all', '\x03': 'ctrl-c' }
export const WIDE_ENOUGH = 100

// The run's control object (ctx.control: runningIds(), skip(id), skipAll()) behind one small adapter, so the board can be tested with a fake.
// Every call is guarded: a control that is absent or throws leaves the board working, it only loses the skip keys.
export function controlAdapter(control) {
  if (!control || typeof control !== 'object') return null
  const safely = (fn, fallback) => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }
  return {
    // [{ id, lastOutputAt }] for every running check; a bare id string is accepted too.
    running: () =>
      safely(() => (typeof control.runningIds === 'function' ? control.runningIds() : []), []).flatMap((x) => {
        if (typeof x === 'string') return [{ id: x, lastOutputAt: null }]
        if (x && typeof x.id === 'string') return [{ id: x.id, lastOutputAt: Number.isFinite(x.lastOutputAt) ? x.lastOutputAt : null }]
        return []
      }),
    skip: (id) => safely(() => typeof control.skip === 'function' && control.skip(id), false),
    skipAll: () => safely(() => typeof control.skipAll === 'function' && control.skipAll(), false),
  }
}

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
  typicalHere = true, // whether the learned times were measured on THIS project
  showFinal = true, // false: leave nothing on the normal screen when the board ends (the caller prints its own summary)
  sink = null, // the run's findings sink (a Map of check id -> { findings }): the live bug counter reads each settled check's findings from it
  grouped, // true: always fold checks into groups; false: always one line per check; undefined: fold when there are more than 24
  control = null, // the run's control object (runningIds, skip, skipAll), when the runner provides one: enables the skip keys and stuck hints
}) {
  const started = now()
  const model = createModel({ checks, timings, tier, typicalHere })
  const ctl = controlAdapter(control)
  const skipped = new Set() // checks the person asked to skip: their NOT RUN line says so
  const events = []
  const notes = new Map()
  const checkingGate = createThrottle(1000, now)
  const view = { history: false, output: false, grouped }
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
    // The newest sign of life of a running check: what the board saw, or what the run's control reports, whichever is later.
    const live = new Map((ctl ? ctl.running() : []).map((x) => [x.id, x.lastOutputAt]))
    const rows = model.snapshot(t).map((r) => {
      const seen = [r.lastOutputAt, live.get(r.id)].filter(Number.isFinite)
      return { ...r, lastOutputAt: seen.length ? Math.max(...seen) : r.lastOutputAt, note: r.status === 'RUNNING' ? notes.get(r.id) : '' }
    })
    const allDone = rows.length > 0 && rows.every((r) => ['PASS', 'FAIL', 'NOT RUN'].includes(r.status))
    // The countdown and the bar come from one estimate: a simulation of the rest of the run (lib/eta.mjs), so they agree and the
    // time left falls one second per second while checks run as expected.
    const remaining = estimateRemaining(rows, t, { freeSlots })
    // With no measured times for most of what is left, the estimate is only written guesses: say "estimating" instead of a number.
    const left = rows.filter((r) => r.status === 'RUNNING' || r.status === 'WAITING')
    const measured = left.length === 0 || left.filter((r) => r.typicalMs !== null && r.typicalMs !== undefined).length * 2 >= left.length
    const target = allDone ? 1 : (t - started) / Math.max(1, t - started + remaining)
    shown = allDone ? 1 : Math.max(shown, shown + (target - shown) * 0.3)
    let lines
    if (width >= WIDE_ENOUGH) {
      lines = renderLive({ title, rows, bugs: model.bugs(), events, started, now: t, tick, fraction: shown, etaMs: allDone || !measured ? null : remaining, width, height: stream.rows, color, grouped: view.grouped, sprite: color ? colorLevel(env) : false, theme })
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
    const canGroup = view.grouped !== undefined || rows.length > 24
    lines.push(`  keys: s skip a stuck check  g groups  Ctrl-C stop and save  (S skip all · o output · h past runs${canGroup ? '' : ' · g needs more checks'})`)
    return lines
  }

  const draw = () => {
    if (stopped) return
    last = frame()
    const rows = (stream.rows || 60) - 1
    stream.write(`${ESC}H${last.slice(0, rows).map((l) => `${l}${ESC}K`).join('\n')}\n${ESC}J`)
  }

  // s / k: skip the check that has run longest. S: skip every running check. The run settles a skipped check as NOT RUN; the board
  // then says "skipped by you". Without a control object the keys say so instead of doing nothing silently.
  const skipIds = (ids, label) => {
    if (!ctl) say('skip is not available: this run has no control object')
    else if (!ids.length) say('nothing running to skip')
    else {
      for (const id of ids) {
        skipped.add(id)
        ctl.skip(id)
      }
      say(`${label} ${ids.join(', ')}`)
    }
    draw()
  }
  const skipLongest = () => {
    const running = model.snapshot(now()).filter((r) => r.status === 'RUNNING').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    skipIds(running.slice(0, 1).map((r) => r.id), 'skip requested for')
  }
  const skipEvery = () => {
    const ids = model.snapshot(now()).filter((r) => r.status === 'RUNNING').map((r) => r.id)
    if (!ctl || !ids.length) return skipIds([], 'skip requested for')
    for (const id of ids) skipped.add(id)
    ctl.skipAll()
    say(`skip requested for all ${ids.length} running checks`)
    draw()
  }

  const onKey = (chunk) => {
    const name = KEY_NAMES[String(chunk)]
    if (name === 'ctrl-c') return halt(onInterrupt)
    if (name === 'o') view.output = !view.output
    else if (name === 'h') view.history = !view.history
    else if (name === 'g') view.grouped = !shouldGroup(model.rows.size, { grouped: view.grouped })
    else if (name === 'skip') return skipLongest()
    else if (name === 'skip-all') return skipEvery()
    else return
    draw()
  }

  const raw = Boolean(input?.isTTY && input.setRawMode)
  // Never leave the cursor hidden, the alternate screen on or the keyboard in raw mode, even after Ctrl+C.
  // Leave the alternate screen only once: a second ?1049l (the exit handler after stop()) makes some terminals jump the cursor back
  // to where it was saved on entry, which put the after-run menu on top of the finished report.
  let alt = false
  const restore = () => {
    stream.write(`${ESC}?25h${alt ? `${ESC}?1049l` : ''}`)
    alt = false
    if (raw) {
      try {
        input.setRawMode(false)
      } catch {
        /* the terminal is already gone */
      }
    }
  }
  // Ends the board at once: no more redraws, the cursor back, the alternate screen left, the keyboard back to normal. Ctrl-C and the run's
  // own interrupt (the returned `interrupt()`) both go through it, so an interrupted run never leaves the terminal half set up.
  const halt = (after) => {
    if (!stopped) {
      stopped = true
      if (timer) clearInterval(timer)
      if (raw) input.off?.('data', onKey)
      restore()
    }
    if (after) after()
  }
  process.once('exit', restore)
  stream.write(`${ESC}?1049h${ESC}?25l`)
  alt = true
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
      if (name === 'o' || name === 'h' || name === 'g' || name === 's' || name === 'S' || name === 'k') onKey(name)
    },
    frame,
    start(check) {
      model.start(check, now())
      const lane = check.lane === 'cargo' ? ' (cargo lane)' : check.lane === 'electron' || check.lane === 'windows' ? ' (windows lane)' : ''
      say(`started ${check.id}${lane}`)
      draw()
    },
    settle(check, result, ms) {
      // A check the person skipped says so, whatever the run wrote as its reason.
      const wasSkipped = skipped.delete(check.id) && result.status === 'NOT RUN'
      const shown = wasSkipped ? { ...result, detail: 'skipped by you' } : result
      model.settle(check, shown, ms, sink?.get?.(check.id)?.findings ?? null)
      notes.delete(check.id)
      say(`${shown.status} ${check.id} (${formatDuration(ms)})${shown.detail ? `: ${shortDetail(shown.detail)}` : ''}`)
      draw()
    },
    // The run was interrupted by its own control (not by a key): the board closes cleanly, the same as Ctrl-C without the exit.
    interrupt() {
      halt()
    },
    queue(list) {
      model.queue(list)
    },
    // The newest line a running check printed, shown beside it so no check is a black box.
    output(check, line) {
      model.touch(check, now())
      notes.set(check.id, stripControl(line).slice(0, 60))
    },
    // The file a running check says it is looking at, and how many it has done (lib/progress-files.mjs). The board shows it on
    // the next frame; the events list gets one "checking" line per second at most, and a new one replaces the last.
    progress(check, p) {
      model.progress(check, p)
      model.touch(check, now())
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
      if (showFinal) stream.write(`${finalBoard.filter((l) => !l.startsWith('  keys:')).join('\n')}\n`)
      if (raw) input.pause?.()
    },
  }
}
