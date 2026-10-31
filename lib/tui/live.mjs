// Meerkat's live board (mock-up stage): everything that is happening in a run, on one screen, redrawn smoothly.
// Pure: a snapshot in, lines out, so it can be tested and shown without a real run. What it shows:
//   - a pixel-art meerkat head that faces right, glances left, blinks, and reacts to the result;
//   - the overall bar with a spinner, a moving shimmer along it and an "estimated time left";
//   - how many things run in parallel right now, and in which lane;
//   - RUNNING NOW: for each lane what runs in it, with its own animated bar against the typical time on this PC, an
//     estimate of the time that check has left, and the line it printed last, so nothing is a black box;
//   - ALL CHECKS: every check, its status as a word, its time, its typical time, and a TIMELINE strip showing when it
//     ran, so checks that overlap (run in parallel) are visible at a glance;
//   - EVENTS: the last things that happened, with the time each happened.
// Status is always a word as well as a colour; the spinners, shimmer and head are decoration on top.
import { formatDuration } from '../progress.mjs'
import { PALETTE, pixelHead, SPRITE_WIDTH } from './pixelhead.mjs'
import { furPalette, sgrFor, SPINNERS, THEMES } from './theme.mjs'
import { stripControl } from './safe.mjs'
import { groupRows, rowSpan, segmentCells, timeText } from './group.mjs'

const ESC = '\x1b['
// The spinner of the chosen theme (see theme.mjs).
const spinnerOf = (theme) => (tick) => {
  const frames = SPINNERS[theme.spinner] ?? SPINNERS.dots
  return frames[tick % frames.length]
}
// The colour codes of the theme's bars, for the colour level this terminal has.
const tonesOf = (theme, level) => {
  const code = (k, fallback) => sgrFor(theme.bar?.[k], level === '256' ? '256' : 'truecolor') ?? fallback
  return { ok: code('ok', '32'), work: code('work', '36'), warn: code('warn', '33'), bad: code('bad', '31'), shimmer: code('shimmer', '97') }
}

// The head is pixel art (pixelhead.mjs): a profile looking left, its mirror looking right.
export const headLines = (pose, color = true, palette = PALETTE) => pixelHead(pose, { color, palette })

// The head looks straight ahead (to the right, toward the numbers) and only blinks, now and then. It squints when everything
// passed and stares wide-eyed when something did not.
export function poseFor({ mood, tick }) {
  if (mood === 'cheer') return 'happy'
  if (mood === 'alarm') return 'wide'
  return tick % 37 === 36 ? 'blink-right' : 'right'
}

export function moodOfRows(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length
  if (n('FAIL') + n('NOT RUN') > 0) return 'alarm'
  if (rows.length && n('PASS') === rows.length) return 'cheer'
  if (n('RUNNING') > 0) return 'watch'
  return 'wait'
}

const colorOf = { PASS: '32', FAIL: '31', 'NOT RUN': '33', RUNNING: '36', WAITING: '90' }
const mark = { PASS: '✔', FAIL: '✖', 'NOT RUN': '!', RUNNING: '▶', WAITING: '·' }
const pad = (t, n) => String(t).padEnd(n).slice(0, n)
// Length of a string as it looks on screen (colour codes take no room).
const visible = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').length
const sec = (ms) => (ms === null || ms === undefined ? '-' : formatDuration(ms))

// A progress bar that is visibly alive: a bright shimmer sweeps along the filled part, and the leading edge pulses, so a
// run that is working never looks frozen. `tone` is the colour of the filled part. Without colour the shimmer is a
// lighter block.
export function animatedBar(fraction, width, tick, { color = true, tone = '36', shimmerTone = '97' } = {}) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const filled = Math.round(f * width)
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  let out = ''
  const shimmer = filled > 1 ? tick % filled : -1
  for (let i = 0; i < filled; i++) {
    if (i === shimmer) out += c(shimmerTone, color ? '█' : '▒')
    else if (i === filled - 1 && f < 1) out += c(tone, tick % 4 < 2 ? '█' : '▌')
    else out += c(tone, '█')
  }
  return out + c('90', '░'.repeat(width - filled))
}

// The overall bar split by outcome, in the same colours as the timeline below it: what passed is green, what failed is red, what could
// not run is yellow, and the part still running shimmers. Each share is the check's weight (its typical time here, else its estimate) of
// the whole run, so a failed check takes its own share of the bar. A failure is never rounded away: it is always at least one cell.
export function outcomeBar(rows, fraction, width, tick, { color = true, tones = {} } = {}) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const weight = (r) => Math.max(1, r.typicalMs ?? r.expectedMs ?? 1000)
  const total = rows.reduce((n, r) => n + weight(r), 0) || 1
  const share = (status) => rows.filter((r) => r.status === status).reduce((n, r) => n + weight(r), 0)
  const cells = (w) => Math.round((w / total) * width)
  let pass = cells(share('PASS'))
  let fail = cells(share('FAIL'))
  let notRun = cells(share('NOT RUN'))
  if (share('FAIL') > 0 && fail === 0) fail = 1
  if (share('NOT RUN') > 0 && notRun === 0) notRun = 1
  const filled = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * width)
  let run = Math.max(0, filled - pass - fail - notRun)
  while (pass + fail + notRun + run > width) {
    if (run > 0) run--
    else if (pass > 0) pass--
    else if (notRun > 0) notRun--
    else fail--
  }
  const shimmer = run > 1 ? tick % run : -1
  let working = ''
  for (let i = 0; i < run; i++) working += i === shimmer ? c(tones.shimmer ?? '97', color ? '█' : '▒') : i === run - 1 ? c(tones.work ?? '36', tick % 4 < 2 ? '█' : '▌') : c(tones.work ?? '36', '█')
  return c(tones.ok ?? '32', '█'.repeat(pass)) + c('31', '█'.repeat(fail)) + c(tones.warn ?? '33', '█'.repeat(notRun)) + working + c('90', '░'.repeat(Math.max(0, width - pass - fail - notRun - run)))
}

// One strip per check showing when it ran, on the time scale of the whole run. Parallel checks have overlapping strips.
export function timelineStrip(row, { started, now, tick, width = 22, color = true }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const span = Math.max(1, now - started)
  if (row.begunAt === null || row.begunAt === undefined) return c('90', '·'.repeat(width))
  const end = row.status === 'RUNNING' ? now : (row.endedAt ?? row.begunAt)
  const a = Math.min(width - 1, Math.max(0, Math.floor(((row.begunAt - started) / span) * width)))
  const b = Math.min(width, Math.max(a + 1, Math.ceil(((end - started) / span) * width)))
  const tone = colorOf[row.status] ?? '90'
  let out = c('90', '·'.repeat(a))
  for (let i = a; i < b; i++) out += c(tone, row.status === 'RUNNING' && i === b - 1 && tick % 4 < 2 ? '▌' : '█')
  return out + c('90', '·'.repeat(width - b))
}

// One lane line per running check, and a "waiting" line for a lane with nothing running.
// Everything is cut to the width of the screen, so a long list never wraps and breaks the layout.
const fit = (text, room) => (room <= 0 ? '' : text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text)

// Cut a path in the middle so both the folder it starts in and the file name at its end stay readable: src/vault/…/parser.test.ts
export function midTruncate(text, room) {
  const t = String(text ?? '')
  if (room <= 0) return ''
  if (t.length <= room) return t
  if (room <= 3) return t.slice(0, room)
  const keep = room - 1
  const tail = Math.ceil(keep * 0.6)
  return `${t.slice(0, keep - tail)}…${t.slice(t.length - tail)}`
}
// "412/940" when a check has said how many files it will look at, else ''.
export const filesCount = (r) => (Number.isFinite(r.filesTotal) && r.filesTotal !== null ? `${r.filesDone ?? 0}/${r.filesTotal}` : '')

function laneLines(rows, now, tick, c, color, spin, tones, width) {
  const out = []
  for (const lane of ['cargo', 'electron', 'free']) {
    const label = lane === 'electron' ? 'windows' : lane
    const running = rows.filter((r) => r.lane === lane && r.status === 'RUNNING')
    const waiting = rows.filter((r) => r.lane === lane && r.status === 'WAITING')
    if (!running.length) {
      const why = waiting.length ? `waiting: ${waiting.map((w) => `${w.id}${w.reason ? ` (${w.reason})` : ''}`).join(', ')}` : 'idle'
      out.push(c('90', `  ${pad(label, 8)} ${fit(why, width - 12)}`))
      continue
    }
    running.forEach((r, i) => {
      const spent = now - r.startedAt
      const base = r.typicalMs ?? r.expectedMs
      const frac = Math.min(0.99, spent / base)
      const slow = spent > base * 1.5
      const left = base - spent
      const estimate = left > 0 ? `est. ${sec(left)} left` : slow ? 'slower than usual' : 'nearly done'
      const tail = r.note ? fit(stripControl(r.note), width - 84) : ''
      out.push(`  ${pad(i === 0 ? label : '', 8)} ${c(tones.work, spin(tick + i * 3))} ${pad(r.id, 22)} ${animatedBar(frac, 14, tick + i * 2, { color, tone: slow ? tones.warn : tones.work, shimmerTone: tones.shimmer })} ${pad(`${sec(spent)}/${sec(base)}`, 11)} ${c(slow ? '33' : '90', pad(estimate, 18))}${c('90', tail)}`)
      // The file this check is reading right now, under it, with how many it has done: only while it runs, so a finished board is no taller.
      if (r.currentFile || filesCount(r)) {
        const count = filesCount(r)
        const room = Math.max(8, width - 13 - 5 - (count ? count.length + 2 : 0) - 1)
        const file = r.currentFile ? midTruncate(stripControl(r.currentFile), room) : 'starting'
        out.push(`  ${pad('', 8)}   ${c('90', 'now:')} ${c(tones.work, file)}${count ? `  ${c('90', count)}` : ''}`)
      }
    })
  }
  return out
}

// `sprite` is how much colour the meerkat gets ('truecolor', '256' or false); by default truecolor when `color` is on.
// `theme` (theme.mjs) sets the bar colours, the spinner, the speed of the animation and whether the meerkat is shown.
// A window onto the list of checks when the screen is too short for all of them: it follows the first running check, and says
// how many are above and below. Pure, so it can be tested.
export function windowRows(rows, room) {
  if (room === undefined || rows.length <= room) return { rows, above: 0, below: 0 }
  const size = Math.max(3, room - 2)
  let focus = rows.findIndex((r) => r.status === 'RUNNING')
  if (focus < 0) focus = rows.findIndex((r) => r.status === 'WAITING')
  if (focus < 0) focus = 0
  const start = Math.min(Math.max(0, focus - Math.floor(size / 3)), rows.length - size)
  return { rows: rows.slice(start, start + size), above: start, below: rows.length - start - size }
}

// One check's row: status word, id, time, typical time, timeline strip, and its reason (failed) or the file it reads (running).
// `indent` pushes it right under a category line while the timeline stays in the same column.
function checkLine(r, { now, started, tick, color, width, c, indent = 0 }) {
  const typ = r.typicalMs === null || r.typicalMs === undefined ? 'not meas.' : sec(r.typicalMs)
  const time = r.status === 'RUNNING' ? sec(now - r.startedAt) : r.status === 'WAITING' ? '-' : sec(r.ms)
  let extra = r.status === 'FAIL' || r.status === 'NOT RUN' ? c(colorOf[r.status], ` ${fit(stripControl(r.detail ?? ''), width - 86)}`) : ''
  if (r.status === 'RUNNING' && (r.currentFile || filesCount(r))) {
    // The running row names the file and the count in the room where a failed row shows its reason.
    const count = filesCount(r)
    const room = width - 86 - (count ? count.length + 1 : 0) - 6
    const file = r.currentFile && room >= 6 ? `now: ${midTruncate(stripControl(r.currentFile), room)}` : ''
    extra = c('36', ` ${[count, file].filter(Boolean).join(' ')}`)
  }
  return `  ${' '.repeat(indent)}${c(colorOf[r.status], pad(`${mark[r.status]} ${r.status}`, 10))} ${pad(r.id, 22 - indent)} ${pad(time, 7)} ${c('90', pad(`typical ${typ}`, 16))} ${timelineStrip(r, { started, now, tick, color })}${extra}`
}

const CATEGORY_WORD = { PASS: 'PASSED', FAIL: 'FAILED', 'NOT RUN': 'NOT RUN', RUNNING: 'RUNNING', WAITING: 'WAITING' }
const SEGMENT_TONE = { PASS: '32', FAIL: '31', 'NOT RUN': '33', RUNNING: '36', WAITING: '90' }

// One line for a whole category: status word, name, how many checks, time so far, a bar split by outcome, and the counts.
// Same columns as a check row where it can be, so the eye does not have to re-learn the layout.
export function categoryLine(cat, { color = true, width = 110 } = {}) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const bar = segmentCells(cat.counts, 12).map(([s, n]) => c(SEGMENT_TONE[s], (s === 'WAITING' ? '░' : '█').repeat(n))).join('')
  const word = c(colorOf[cat.tone], pad(`${mark[cat.tone]} ${CATEGORY_WORD[cat.tone]}`, 10))
  const dim = (n, text, code) => (n ? c(code, text) : c('90', text))
  const k = cat.counts
  const counts = [dim(k.PASS, `${k.PASS} passed`, '32'), dim(k.FAIL, `${k.FAIL} failed`, '31'), ...(k['NOT RUN'] ? [c('33', `${k['NOT RUN']} not run`)] : []), dim(k.RUNNING, `${k.RUNNING} running`, '36'), c('90', `${k.WAITING} waiting`)].join(' ')
  const room = Math.max(8, Math.min(24, width - 88))
  return `  ${word} ${c('1', pad(cat.label, room))} ${c('90', pad(`${cat.total} checks`, 10))} ${pad(timeText(cat, sec), 9)} ${bar} ${counts}`
}

export function renderLive({ title = 'MEERKAT fast', rows, events = [], started, now, tick: rawTick = 0, fraction = 0, etaMs = null, width = 110, height, color = true, sprite, theme = THEMES.meerkat, grouped }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const level = sprite ?? (color ? 'truecolor' : false)
  const tick = Math.floor(rawTick * (theme.speed ?? 1))
  const spin = spinnerOf(theme)
  const tones = tonesOf(theme, level)
  const mood = moodOfRows(rows)
  const head = theme.mascot === false ? [] : headLines(poseFor({ mood, tick }), level, furPalette(PALETTE, theme.fur))
  const n = (s) => rows.filter((r) => r.status === s).length
  const bad = n('FAIL') + n('NOT RUN') > 0
  const barW = Math.max(20, Math.min(46, width - 70))
  const running = rows.filter((r) => r.status === 'RUNNING')
  const finished = n('PASS') + n('FAIL') + n('NOT RUN')
  const allDone = finished === rows.length && rows.length > 0
  const eta = allDone ? (bad ? c('31', 'finished, with failures') : c('32', 'finished')) : etaMs === null ? c('90', 'estimated time left: working it out') : c('90', `estimated time left ${sec(etaMs)}`)
  const info = [
    `${c('1', title)}   ${c('90', `elapsed ${sec(now - started)}`)}   ${eta}`,
    `${allDone ? c(tones.ok, '✔') : c(tones.work, spin(tick))} ${outcomeBar(rows, fraction, barW, tick, { color, tones })} ${c('1', `${Math.floor(fraction * 100)}%`.padStart(4))}  ${finished}/${rows.length} checks`,
    `${c('32', `${n('PASS')} passed`)}  ${n('FAIL') ? c('31', `${n('FAIL')} failed`) : '0 failed'}  ${n('NOT RUN') ? c('33', `${n('NOT RUN')} not run`) : '0 not run'}  ${c('90', `${n('WAITING')} waiting`)}`,
    '',
    '',
    mood === 'cheer' ? c('32', '"All clear. Safe to push."') : mood === 'alarm' ? c('31', '"Something is off. Look at the red lines."') : mood === 'wait' ? c('90', '"Waiting my turn..."') : c('90', '"Looking for bugs, flaws and security issues."'),
  ]
  const lines = []
  if (head.length) for (let i = 0; i < head.length; i++) lines.push(`${head[i]}${' '.repeat(SPRITE_WIDTH + 4 - visible(head[i]))}${info[i] ?? ''}`)
  else lines.push(...info.filter((l) => l !== '').map((l) => `  ${l}`))
  lines.push('', c('1', '  RUNNING NOW'), ...laneLines(rows, now, tick, c, color, spin, tones, width), '')
  // The heading starts exactly over the first timeline strip: 2 + 10 + 1 + 22 + 1 + 7 + 1 + 16 + 1 = 61 columns in.
  lines.push(c('1', `  ALL CHECKS${' '.repeat(49)}TIMELINE`))
  // The events block (a heading, up to five lines, a blank) and the footer come after the list.
  const room = height === undefined ? undefined : height - lines.length - (2 + Math.min(5, events.length)) - 2
  const rowCtx = { now, started, tick, color, width, c }
  const cats = groupRows(rows, { grouped, span: rowSpan(now) })
  if (cats) {
    // One line per category; the failed, not-run and running checks of a category are listed under it. Problems sort first, so a hard
    // cap on the height cuts the quiet categories at the end, never a failure.
    lines.push(c('90', `  ${rows.length} checks in ${cats.length} group${cats.length === 1 ? "" : "s"}. Problems and running checks are listed under their group. g: every check`))
    const items = cats.flatMap((cat) => [categoryLine(cat, { color, width }), ...cat.open.map((r) => checkLine(r, { ...rowCtx, indent: 2 }))])
    const space = room === undefined ? items.length : Math.max(3, room - 2)
    const shown = items.length > space ? items.slice(0, space - 1) : items
    lines.push(...shown)
    if (shown.length < items.length) lines.push(c('90', `  ... and ${items.length - shown.length} more lines (g: show every check)`))
  } else {
  const view = windowRows(rows, room)
  if (view.above) lines.push(c('90', `  ↑ ${view.above} more above`))
  for (const r of view.rows) lines.push(checkLine(r, rowCtx))
  if (view.below) lines.push(c('90', `  ↓ ${view.below} more below`))
  }
  lines.push('', c('1', '  EVENTS'))
  for (const e of events.slice(-5)) lines.push(c('90', `  ${sec(e.at - started).padStart(5)}  `) + fit(stripControl(e.text), width - 10))
  return lines
}
