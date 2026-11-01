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
import { formatShort } from '../progress.mjs'
import { clipLine, fitCells, padCells, stripAnsi, textWidth } from './cells.mjs'
import { PALETTE, pixelHead, SPRITE_WIDTH } from './pixelhead.mjs'
import { miniHead, MINI_HEAD_WIDTH } from './results.mjs'
import { furPalette, sgrFor, SPINNERS, THEMES } from './theme.mjs'
import { originLabel } from '../customchecks.mjs'
import { stripControl } from './safe.mjs'
import { groupRows, rowSpan, segmentCells, timeText } from './group.mjs'
import { isSlow } from './model.mjs'
import { VERSION } from '../version.mjs'

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
// Plain one-cell ASCII marks: the tick and cross glyphs are drawn two cells wide by some terminal fonts and pushed the text by one.
const mark = { PASS: 'v', FAIL: 'x', 'NOT RUN': '!', RUNNING: '>', WAITING: '.' }
const pad = (t, n) => String(t).padEnd(n).slice(0, n)
// Length of a string as it looks on screen (colour codes take no room).
const visible = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').length
const sec = (ms) => (ms === null || ms === undefined ? '-' : formatShort(ms))

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

// One strip per check showing when it ran, on the time scale of the whole run: [0, max(elapsed, 1 s)], so a run of a few hundred
// milliseconds still spreads its bars. Start and end are rounded to cells; any check that ran gets at least one cell; a running check
// reaches "now"; nothing can pass the end of the column. Parallel checks have overlapping strips.
export function timelineCells(begin, end, { started, now, width }) {
  const span = Math.max(1000, now - started)
  const at = (t) => Math.min(width, Math.max(0, Math.round(((t - started) / span) * width)))
  const a = Math.min(width - 1, at(begin))
  const b = Math.min(width, Math.max(a + 1, at(Math.max(begin, end))))
  return [a, b]
}
export function timelineStrip(row, { started, now, tick, width = 22, color = true }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  if (row.begunAt === null || row.begunAt === undefined) return c('90', '·'.repeat(width))
  const end = row.status === 'RUNNING' ? now : (row.endedAt ?? row.begunAt)
  const [a, b] = timelineCells(row.begunAt, end, { started, now, width })
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

// The lanes the board always shows, in order. The window lane is "electron" in the runner and "windows" in discovery (discover.mjs),
// and both print as "windows". A check in a lane the board does not know still gets its own line, so no running check is ever hidden.
const KNOWN_LANES = ['cargo', 'windows', 'free']
export const laneLabel = (lane) => (lane === 'electron' || lane === 'windows' ? 'windows' : lane ? String(lane) : 'other')
const laneNames = (rows) => [...new Set([...KNOWN_LANES, ...rows.map((r) => laneLabel(r.lane))])]
const elapsedOf = (r, now) => (Number.isFinite(r.startedAt) ? now - r.startedAt : 0)
const estimateOf = (r) => r.typicalMs ?? r.expectedMs

// Up to this many remaining checks are named under the progress bar, with how long each has run.
export const REMAINING_NAMED_MAX = 3
// "waiting on 1 long check: found-tests-no-data-loss (windows lane) 1:20 of about 2:30", only when few checks remain and one runs.
export function remainingStatus(rows, now) {
  const running = rows.filter((r) => r.status === 'RUNNING')
  const unfinished = rows.filter((r) => r.status === 'RUNNING' || r.status === 'WAITING')
  if (!running.length || unfinished.length > REMAINING_NAMED_MAX) return ''
  const named = running.slice(0, REMAINING_NAMED_MAX).map((r) => `${r.id} (${laneLabel(r.lane)} lane) ${sec(elapsedOf(r, now))} of about ${sec(estimateOf(r))}`)
  const more = running.length - named.length
  return `waiting on ${running.length} long check${running.length === 1 ? '' : 's'}: ${named.join(', ')}${more > 0 ? `, +${more} more` : ''}`
}

// A running check that has printed nothing for this long is flagged, with the keys that deal with it.
export const STUCK_AFTER_MS = 60_000
export const stuckHint = (r, now) => {
  const since = Number.isFinite(r.lastOutputAt) ? r.lastOutputAt : r.startedAt
  if (!Number.isFinite(since) || now - since < STUCK_AFTER_MS) return null
  return `possibly stuck: no output for ${sec(now - since)}  (s skip it, k kill)`
}

// How long a finished check stays in RUNNING NOW (as a "done" row) so a burst of one-second checks does not make rows flash in and out.
export const LINGER_MS = 1500
const lingering = (r, now) => (r.status === 'PASS' || r.status === 'FAIL' || r.status === 'NOT RUN') && Number.isFinite(r.endedAt) && now - r.endedAt >= 0 && now - r.endedAt < LINGER_MS

function runningRow(r, { now, tick, c, color, spin, tones, width, i }) {
  const label = pad(laneLabel(r.lane), 8)
  if (r.status !== 'RUNNING') {
    const word = r.status === 'PASS' ? 'done' : r.status === 'FAIL' ? 'FAILED' : 'not run'
    return [`  ${label} ${c(colorOf[r.status], mark[r.status])} ${c('1', pad(r.id, 22))} ${c(colorOf[r.status], pad(word, 14))} ${pad(sec(r.ms), 11)} ${c('90', fitCells(stripControl(r.detail ?? ''), Math.max(0, width - 64)))}`]
  }
  const spent = now - r.startedAt
  const base = r.typicalMs ?? r.expectedMs
  const frac = Math.min(0.99, spent / base)
  // "slower than usual" only when the typical time was measured for THIS project (see isSlow in model.mjs).
  const slow = r.slow !== undefined ? r.slow : isSlow({ spent, typicalMs: r.typicalMs, typicalHere: r.typicalHere })
  const left = base - spent
  const estimate = left > 0 ? `est. ${sec(left)} left` : slow ? 'slower than usual' : 'nearly done'
  // What it is on right now, in the room that is left: the file and how many it has done, else the step it last printed.
  const count = filesCount(r)
  const room = Math.max(0, width - (2 + 8 + 1 + 1 + 1 + 22 + 1 + 14 + 1 + 11 + 1 + 18 + 2))
  const onFile = r.currentFile ? midTruncate(stripControl(r.currentFile), Math.max(8, room - (count ? count.length + 1 : 0))) : ''
  const step = r.note ? fit(stripControl(r.note), room) : ''
  const where = room < 8 ? '' : `${count ? `${c('90', count)} ` : ''}${onFile ? c(tones.work, onFile) : c('90', step)}`
  const out = [clipLine(`  ${label} ${c(tones.work, spin(tick + i * 3))} ${c('1', pad(r.id, 22))} ${animatedBar(frac, 14, tick + i * 2, { color, tone: slow ? tones.warn : tones.work, shimmerTone: tones.shimmer })} ${pad(`${sec(spent)}/${sec(base)}`, 11)} ${c(slow ? '33' : '90', pad(estimate, 18))} ${where}`, width)]
  // A check that has printed nothing for a minute says so, under its line, so a hung check is never a silent bar.
  const stuck = stuckHint(r, now)
  if (stuck) out.push(`  ${pad('', 8)}   ${c(tones.warn, fit(stuck, width - 12))}`)
  return out
}

// The RUNNING NOW area in exactly `limit` lines (padded), whatever is running: the longest-running checks first (a stuck one always shows),
// then checks that finished less than LINGER_MS ago, and one stable "+N more running" line for the rest. With nothing running it says
// what each lane waits for.
export function runningLines(rows, now, tick, c, color, spin, tones, width, limit = RUNNING_ROWS) {
  const active = rows.filter((r) => r.status === 'RUNNING').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const done = rows.filter((r) => lingering(r, now)).sort((a, b) => b.endedAt - a.endedAt)
  const items = [...active, ...done]
  const ctx = { now, tick, c, color, spin, tones, width }
  // A lane with nothing running says what it waits for (or that it is idle); these lines give way to running checks when room is short.
  const idle = []
  for (const label of laneNames(rows)) {
    if (items.some((r) => laneLabel(r.lane) === label)) continue
    const waiting = rows.filter((r) => laneLabel(r.lane) === label && r.status === 'WAITING')
    if (!KNOWN_LANES.includes(label) && !waiting.length) continue
    const why = waiting.length ? `waiting: ${waiting.map((w) => `${w.id}${w.reason ? ` (${w.reason})` : ''}`).join(', ')}` : 'idle'
    idle.push(c('90', `  ${pad(label, 8)} ${fit(why, width - 12)}`))
  }
  const build = (room) => {
    const out = []
    let shown = 0
    for (const [i, r] of items.entries()) {
      const rowLines = runningRow(r, { ...ctx, i })
      if (out.length + rowLines.length > room) break
      out.push(...rowLines)
      shown++
    }
    return { out, shown }
  }
  let { out, shown } = build(limit)
  if (shown < items.length) {
    ;({ out, shown } = build(limit - 1))
    const hiddenRun = active.length - Math.min(active.length, shown)
    const hiddenDone = items.length - shown - hiddenRun
    out.push(c('90', `  +${hiddenRun} more running${hiddenDone > 0 ? ` (and ${hiddenDone} just finished)` : ''}`))
  }
  out = [...out, ...idle].slice(0, limit)
  while (out.length < limit) out.push('')
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

// The board's columns, the same for a category line and for a check row, so everything lines up and nothing jumps between frames:
//   2 spaces | icon 1 | status 7 | name 24 | count 9 | time 9 | typical/bar 16 | timeline (8..22) | detail (the rest)
// Every cell is padded or cut to its width in display cells, and each line is clipped to the terminal width.
export const COLS = { status: 7, name: 24, count: 9, time: 9, typ: 16 }
export const TIMELINE_X = 2 + 2 + (COLS.status + 1) + (COLS.name + 1) + (COLS.count + 1) + (COLS.time + 1) + (COLS.typ + 1)
export function boardGeometry(width) {
  const timeline = Math.max(8, Math.min(22, width - TIMELINE_X - 1 - 20))
  return { timeline, detail: Math.max(0, width - TIMELINE_X - timeline - 1) }
}

function boardRow({ tone, icon, word, name, count = '', time = '', typ = '', timeline, detail = '', detailTone, width, c }) {
  const geo = boardGeometry(width)
  const head = `  ${c(tone, icon)} ${c(tone, padCells(word, COLS.status))} ${name.styled ?? padCells(name.text, COLS.name)} ${c('90', padCells(count, COLS.count))} ${padCells(time, COLS.time)} ${typ.styled ?? c('90', padCells(typ, COLS.typ))} ${timeline}`
  const tail = detail && geo.detail > 1 ? ` ${typeof detail === 'string' ? c(detailTone, fitCells(detail, geo.detail)) : detail.fit(geo.detail)}` : ''
  return clipLine(head + tail, width)
}

// One check's row: status word, id, time, typical time, timeline strip, and its reason (failed) or the file it reads (running).
// `indent` pushes the id right under a category line while every column stays where it is.
function checkLine(r, { now, started, tick, color, width, c, indent = 0 }) {
  const geo = boardGeometry(width)
  const typ = r.typicalMs === null || r.typicalMs === undefined ? 'not meas.' : sec(r.typicalMs)
  const time = r.status === 'RUNNING' ? sec(now - r.startedAt) : r.status === 'WAITING' ? '-' : sec(r.ms)
  let detail = r.status === 'FAIL' || r.status === 'NOT RUN' ? stripControl(r.detail ?? '') : ''
  let detailTone = colorOf[r.status]
  if (r.status === 'RUNNING' && (r.currentFile || filesCount(r))) {
    // The running row names the file and the count in the room where a failed row shows its reason.
    const count = filesCount(r)
    const room = geo.detail - (count ? count.length + 1 : 0) - 6
    const file = r.currentFile && room >= 6 ? `now: ${midTruncate(stripControl(r.currentFile), room)}` : ''
    detail = [count, file].filter(Boolean).join(' ')
    detailTone = '36'
  }
  return boardRow({
    tone: colorOf[r.status],
    icon: mark[r.status],
    word: r.status,
    name: originLabel(r.origin) ? { text: '', styled: `${padCells(`${' '.repeat(indent)}${fitCells(stripControl(r.id), COLS.name - indent - originLabel(r.origin).length - 1)}`, COLS.name - originLabel(r.origin).length - 1)} ${c('36', originLabel(r.origin))}` } : { text: `${' '.repeat(indent)}${fitCells(stripControl(r.id), COLS.name - indent)}` },
    time,
    typ: `typical ${typ}`,
    timeline: timelineStrip(r, { started, now, tick, color, width: geo.timeline }),
    detail,
    detailTone,
    width,
    c,
  })
}

// The line under the meerkat. While checks run it rotates through lines tied to what is really running, using the counters the board already
// has (files read so far, findings a check has produced, the bug counter); nothing here is made up. When the run ends it says "Looks good"
// or "Found N issues". `tick` moves it on every STATUS_EVERY ticks so each line can be read.
export const STATUS_EVERY = 14
const WHAT = [
  [/secret|key|token/, 'Scanning for secrets'],
  [/audit|advisor|vuln/, 'Checking dependencies for known holes'],
  [/clippy|cargo|rust|sidecar/, 'Reading Rust code'],
  [/tsc|type/, 'Type-checking TypeScript'],
  [/eslint|lint|smell|rule/, 'Reading the code against the rules'],
  [/test|spec/, 'Running the tests'],
  [/build|bundle/, 'Building the project'],
  [/click|screen|ui|a11y|alt|label/, 'Looking at the screens'],
]
export const whatIsRunning = (r) => WHAT.find(([re]) => re.test(String(r.id).toLowerCase()))?.[1] ?? `Running ${r.id}`
export function statusLines(rows, { bugs = null } = {}) {
  const n = (s) => rows.filter((r) => r.status === s).length
  const total = bugs?.total ?? 0
  const running = rows.filter((r) => r.status === 'RUNNING')
  const finished = n('PASS') + n('FAIL') + n('NOT RUN')
  if (rows.length && finished === rows.length) {
    const issues = total || n('FAIL') + n('NOT RUN')
    return issues ? [{ text: `Found ${issues} issue${issues === 1 ? '' : 's'}`, tone: '31' }] : [{ text: 'Looks good', tone: '32' }]
  }
  if (!running.length) return [{ text: 'Waiting my turn...', tone: '90' }]
  const out = [{ text: 'Looking for bugs, flaws and security issues...', tone: '90' }]
  for (const r of running.slice(0, 4)) {
    const files = filesCount(r)
    out.push({ text: `${whatIsRunning(r)}: ${files ? `${files} files read` : `found ${Number.isFinite(r.found) ? r.found : 0} so far`}${files && Number.isFinite(r.found) ? `, found ${r.found}` : ''}`, tone: '36' })
  }
  if (bugs) out.push({ text: total ? `${total} issue${total === 1 ? '' : 's'} found so far in finished checks` : 'No issues found so far', tone: total ? '33' : '32' })
  return out
}
export const statusLine = (rows, { bugs = null, tick = 0 } = {}) => {
  const list = statusLines(rows, { bugs })
  return list[Math.floor(tick / STATUS_EVERY) % list.length]
}

// The status line with a dwell: a message is held for STATUS_HOLD_MS before it can change, it only changes to a message with a different
// meaning (what the most checks are running, the longest-running first), and a message it just left is not brought back for a while.
// The "found N so far" count inside a message is read fresh every frame, so it stays live without changing which message is shown.
// `state` is a plain object the caller keeps between frames; the finished message is shown at once.
export const STATUS_HOLD_MS = 6000
const STATUS_COOLDOWN_MS = 3 * STATUS_HOLD_MS
export function pickStatus(rows, { bugs = null, now = 0, state = {} } = {}) {
  const n = (s) => rows.filter((r) => r.status === s).length
  const finished = n('PASS') + n('FAIL') + n('NOT RUN')
  if (rows.length && finished === rows.length) {
    state.key = 'done'
    state.since = now
    return statusLines(rows, { bugs })[0]
  }
  const running = rows.filter((r) => r.status === 'RUNNING')
  const groups = new Map()
  for (const r of running) {
    const label = whatIsRunning(r)
    const g = groups.get(label) ?? { label, count: 0, first: Infinity }
    g.count++
    g.first = Math.min(g.first, Number.isFinite(r.startedAt) ? r.startedAt : 0)
    groups.set(label, g)
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.first - b.first || a.label.localeCompare(b.label))
  state.left ??= {}
  const fresh = ranked.filter((g) => !(g.label in state.left) || now - state.left[g.label] >= STATUS_COOLDOWN_MS)
  const candidate = (fresh[0] ?? ranked[0])?.label ?? 'wait'
  if (state.key === undefined || state.key === 'done') {
    state.key = candidate
    state.since = now
  } else if (candidate !== state.key && now - state.since >= STATUS_HOLD_MS) {
    state.left[state.key] = now
    state.key = candidate
    state.since = now
  }
  if (state.key === 'wait') return { text: 'Waiting my turn...', tone: '90' }
  const label = state.key
  const mine = rows.filter((r) => whatIsRunning(r) === label)
  const found = mine.reduce((sum, r) => sum + (Number.isFinite(r.found) ? r.found : 0), 0)
  const reading = running.find((r) => whatIsRunning(r) === label && filesCount(r))
  const files = reading ? filesCount(reading) : ''
  return { text: `${label}: ${files ? `${files} files read, ` : ''}found ${found} so far`, tone: '36' }
}

export const RUNNING_ROWS = 6
const CATEGORY_WORD = { PASS: 'PASSED', FAIL: 'FAILED', 'NOT RUN': 'NOT RUN', RUNNING: 'RUNNING', WAITING: 'WAITING' }
const SEGMENT_TONE = { PASS: '32', FAIL: '31', 'NOT RUN': '33', RUNNING: '36', WAITING: '90' }

// One line for a whole category, in the same columns as a check row: status word, name, how many checks, time so far, a bar split by
// outcome where a row shows its typical time, then (under TIMELINE) when the category ran, and the counts in the detail column.
export function categoryLine(cat, { color = true, width = 110, started, now, tick = 0 } = {}) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const geo = boardGeometry(width)
  const bar = segmentCells(cat.counts, 12).map(([s, n]) => c(SEGMENT_TONE[s], (s === 'WAITING' ? '░' : '█').repeat(n))).join('')
  const k = cat.counts
  const parts = [
    [cat.suite ? cat.subTotal : 0, `${cat.subTotal} sub-checks`, '90'],
    [k.PASS, `${k.PASS} passed`, '32'],
    [k.FAIL, `${k.FAIL} failed`, '31'],
    [k['NOT RUN'], `${k['NOT RUN']} not run`, '33'],
    [k.RUNNING, `${k.RUNNING} running`, '36'],
    [k.WAITING, `${k.WAITING} waiting`, '90'],
  ].filter(([n, , code]) => n > 0 || code === '32' || code === '31')
  // Only the counts that are not zero; whatever does not fit the room is dropped from the end, never wrapped.
  const counts = {
    fit: (room) => {
      let used = 0
      const out = []
      for (const [, text, code] of parts) {
        const w = textWidth(text) + (out.length ? 1 : 0)
        if (used + w > room) break
        used += w
        out.push(c(code, text))
      }
      return out.join(' ')
    },
  }
  const begun = (cat.rows ?? []).filter((r) => r.begunAt !== null && r.begunAt !== undefined)
  const span =
    begun.length && started !== undefined && now !== undefined
      ? { begunAt: Math.min(...begun.map((r) => r.begunAt)), endedAt: Math.max(...begun.map((r) => (r.status === 'RUNNING' ? now : (r.endedAt ?? r.begunAt)))), status: cat.tone }
      : { begunAt: null }
  return boardRow({
    tone: colorOf[cat.tone],
    icon: mark[cat.tone],
    word: CATEGORY_WORD[cat.tone],
    name: { styled: c('1', padCells(fitCells(cat.label, COLS.name), COLS.name)) },
    count: `${cat.total} checks`,
    time: timeText(cat, sec),
    typ: { styled: padCells(bar, COLS.typ) },
    timeline: timelineStrip(span, { started: started ?? 0, now: now ?? 0, tick, color, width: geo.timeline }),
    detail: counts,
    width,
    c,
  })
}

// The grouped list in `space` lines. Everything fits: all groups with their problem rows. Otherwise the open rows of each group are
// capped (failing and running groups come first, so they keep theirs), then only group lines; whatever is still hidden is one status
// strip ("+11 more groups: 3 failed, 8 passed"), never only a line count.
export function fitGroups(cats, space, { rowCtx, catCtx, c }) {
  const build = (cap, shownCats, hints = true) => {
    const out = []
    for (const cat of shownCats) {
      out.push(categoryLine(cat, catCtx))
      for (const r of cat.open.slice(0, cap)) out.push(checkLine(r, { ...rowCtx, indent: 2 }))
      if (hints && cat.open.length > cap) out.push(c('90', `    +${cat.open.length - cap} more in this group (g: every check)`))
    }
    return out
  }
  const all = build(Infinity, cats)
  if (all.length <= space) return all
  for (const cap of [6, 3, 1, 0]) {
    const out = build(cap, cats)
    if (out.length <= space) return out
  }
  // Group lines alone do not fit: keep the first ones (problems first) and summarise the rest.
  const keep = Math.max(1, space - 1)
  const hidden = cats.slice(keep)
  const word = { PASS: 'passed', FAIL: 'failed', 'NOT RUN': 'not run', RUNNING: 'running', WAITING: 'waiting' }
  const tally = ['FAIL', 'NOT RUN', 'RUNNING', 'WAITING', 'PASS'].map((s) => [s, hidden.filter((h) => h.tone === s).length]).filter(([, n]) => n > 0)
  return [...build(0, cats.slice(0, keep), false), c('90', `  +${hidden.length} more group${hidden.length === 1 ? '' : 's'}: ${tally.map(([s, n]) => `${n} ${word[s]}`).join(', ')}  (g toggles)`)]
}

// The live bug counter. Four layouts, by the room there is (low and info stay on the results screen; a level with zero is left out):
//   stack (100+ columns and 24+ rows): the total in bold white, then one line per level present (critical red, high orange,
//     medium yellow), each right-aligned to the terminal edge;
//   line (70+ columns, or a short terminal): `bugs found: 82  (48 high, 22 medium)`;
//   total (under 70 columns, or only low and info): `bugs found: 82`; zero: `bugs found: 0` in green.
// Colour off gives the same layouts without codes. Returns { mode, lines: [{ text, plain, width }], text, plain }.
export const BUG_STACK_MIN_WIDTH = 100
export const BUG_STACK_MIN_ROWS = 24
const BUG_TONE = { critical: '31', high: '38;5;208', medium: '33', low: '34' }
// Where the stacked counter starts, as a row of the header: below the title and the progress bar, so it never sits over either.
export const BUG_STACK_ROW = 3
export function bugCounter(bugs, { width = 110, color = true, height, stack = true } = {}) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  if (!bugs) return { mode: 'none', lines: [], text: '', plain: '' }
  if (!bugs.total) {
    const plain = bugs.low > 0 ? `bugs found: 0   (notes: ${bugs.low}, not bugs)` : 'bugs found: 0'
    return { mode: 'total', lines: [{ text: c('32', plain), plain, width: plain.length }], text: c('32', plain), plain }
  }
  const head = `bugs found: ${bugs.total}`
  const headText = c('1;97', head)
  const shown = ['critical', 'high', 'medium', 'low'].filter((k) => bugs[k] > 0)
  const roomy = height === undefined || height >= BUG_STACK_MIN_ROWS
  if (shown.length && width >= BUG_STACK_MIN_WIDTH && roomy && stack) {
    // Labels end in a colon and numbers are right-aligned to one column, with a fixed minimum width, so digits never jump columns.
    const numW = Math.max(4, String(bugs.total).length)
    const labW = 'bugs found:'.length
    const parts = [
      { text: `${c('1;97', 'bugs found:')} ${c('1;97', String(bugs.total).padStart(numW))}`, plain: `${'bugs found:'} ${String(bugs.total).padStart(numW)}` },
      ...shown.map((k) => ({ text: `${c(BUG_TONE[k] ? `1;${BUG_TONE[k]}` : '90', `${k === 'low' ? 'notes' : k}:`.padStart(labW))} ${c(BUG_TONE[k] ? `1;${BUG_TONE[k]}` : '90', String(bugs[k]).padStart(numW))}`, plain: `${`${k}:`.padStart(labW)} ${String(bugs[k]).padStart(numW)}` })),
    ]
    const w = labW + 1 + numW
    return { mode: 'stack', lines: parts.map((p) => ({ text: p.text, plain: p.plain, width: w })), text: headText, plain: head }
  }
  if (shown.length && width >= 70) {
    const tone = (k) => (BUG_TONE[k] ? `1;${BUG_TONE[k]}` : '90')
    const plain = `${head}  (${shown.map((k) => `${bugs[k]} ${k === 'low' ? 'notes' : k}`).join(', ')})`
    const text = `${headText}  (${shown.map((k) => c(tone(k), `${bugs[k]} ${k === 'low' ? 'notes' : k}`)).join(', ')})`
    return { mode: 'line', lines: [{ text, plain, width: plain.length }], text, plain }
  }
  return { mode: 'total', lines: [{ text: headText, plain: head, width: head.length }], text: headText, plain: head }
}

// Writes a block (see bugCounter) at the right edge of a line: the line is cut to leave it room, so nothing it shares a row with is drawn
// over, and the block ends one cell short of the last column.
function overlayRight(line, block, width) {
  const start = Math.max(0, width - 1 - block.width)
  const left = textWidth(line) > start ? clipLine(line, start) : line
  return `${left}${' '.repeat(Math.max(0, start - textWidth(left)))}${block.text}`
}

// How the lines of the screen are shared out. When the screen is short the all-checks groups give way first (down to 3 lines), then the
// running area, then the recent list (never under 5 on a 30+ row terminal); the events go first of all.
// The full-size meerkat (ten rows) is shown from this terminal height; below it the half-size one is.
export const FULL_HEAD_ROWS = 30
export function planLayout(height, headerLen) {
  if (height === undefined) return { run: RUNNING_ROWS, recent: 0, events: undefined, groups: undefined }
  const avail = height - 2 - headerLen
  let run = height >= 44 ? 10 : height >= 38 ? 8 : RUNNING_ROWS
  // There is no separate list of finished checks any more: ALL CHECKS shows every group (running, failed and passed) with its time.
  const recent = 0
  // blank + RUNNING NOW heading, blank + ALL CHECKS heading + summary
  const overhead = 5
  const events = avail - overhead - run - recent - 5 >= 8 ? 3 : 0
  let groups = avail - overhead - (events ? events + 2 : 0) - run - recent
  while (groups < 3 && run > 2) {
    run--
    groups++
  }
  // At least five finished checks stay visible; the group list gives way before them.
  return { run, recent, events, groups: Math.max(2, groups) }
}

const padTo = (list, n) => {
  const out = list.slice(0, n)
  while (out.length < n) out.push('')
  return out
}

export function renderLive({ folder: rawFolder = '', preset: rawPreset = 'full', title: rawTitle, notice = null, rows, bugs = null, events = [], started, now, tick: rawTick = 0, fraction = 0, etaMs = null, width = 110, height, color = true, sprite, theme = THEMES.meerkat, grouped, statusState }) {
  // The folder and the preset come from the command line and the file system: no control or escape characters reach the terminal.
  const folder = stripControl(String(rawFolder))
  const preset = stripControl(String(rawPreset))
  const title = rawTitle ?? `MEERKAT v${VERSION} . ${preset}`
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const level = sprite ?? (color ? 'truecolor' : false)
  const tick = Math.floor(rawTick * (theme.speed ?? 1))
  const spin = spinnerOf(theme)
  const tones = tonesOf(theme, level)
  const mood = moodOfRows(rows)
  // The meerkat is dropped on a short screen: its ten rows are worth more as the lists below.
  const tall = height === undefined || height >= FULL_HEAD_ROWS
  const head = theme.mascot === false || !tall ? [] : headLines(poseFor({ mood, tick }), level, furPalette(PALETTE, theme.fur))
  const n = (s) => rows.filter((r) => r.status === s).length
  const bad = n('FAIL') + n('NOT RUN') > 0
  const barW = Math.max(14, Math.min(46, width - 92))
  const running = rows.filter((r) => r.status === 'RUNNING')
  const finished = n('PASS') + n('FAIL') + n('NOT RUN')
  const allDone = finished === rows.length && rows.length > 0
  // On a shorter screen the meerkat is still there, at half size (five rows), so it can be watched as the run goes.
  const mini = theme.mascot === false || !color || tall || (height !== undefined && height < 20) ? [] : miniHead(bad ? 'wide' : allDone ? 'joy' : Math.floor(tick / 3) % 14 === 0 ? 'blink' : 'happy', level)
  const headW = head.length ? SPRITE_WIDTH + 4 : mini.length ? MINI_HEAD_WIDTH + 2 : 2
  // Checks still running that have no measured time: the time left cannot be counted for them, so the line names the first one.
  const unknownRunning = running.filter((r) => r.typicalMs === null || r.typicalMs === undefined)
  const unknownText = unknownRunning.length ? `${unknownRunning[0].id}${unknownRunning.length > 1 ? `, +${unknownRunning.length - 1} more` : ''}` : ''
  const eta = allDone
    ? bad
      ? c('31', 'finished, with failures')
      : c('32', 'finished')
    : etaMs === null
      ? c('90', unknownText ? `time left: unknown (no timing recorded for ${unknownText} yet)` : 'estimated time left: estimating...')
      : c('90', `estimated time left ${sec(etaMs)}`)
  // A running check that is past its estimate is said so on the percentage label, not hidden behind it.
  const overdue = !allDone && running.some((r) => Number.isFinite(r.startedAt) && now - r.startedAt > estimateOf(r))
  const remaining = remainingStatus(rows, now)
  const st = pickStatus(rows, { bugs, now, state: statusState ?? {} })
  // The title gives way (ends in an ellipsis) before the elapsed time and the time left do: those are what is read on every frame.
  const tailText = `   elapsed ${sec(now - started)}   ${stripAnsi(eta)}${notice?.latest ? `   update available: v${notice.latest} (you have v${VERSION})` : ''}`
  const titleRoom = Math.max(32, width - 1 - headW - textWidth(tailText) - 2)
  const info = [
    `${c('1', fitCells(title, titleRoom))}${notice?.latest ? `   ${c('33', `update available: v${notice.latest} (you have v${VERSION})`)}` : ''}   ${c('90', `elapsed ${sec(now - started)}`)}   ${eta}`,
    `${allDone ? c(tones.ok, 'v') : c(tones.work, spin(tick))} ${outcomeBar(rows, fraction, barW, tick, { color, tones })} ${c('1', `${Math.floor(fraction * 100)}%`.padStart(4))} of estimated time${overdue ? c(tones.warn, ', still running, longer than estimated') : ''}  ${finished}/${rows.length} checks done`,
    remaining ? c(tones.work, remaining) : '',
    `${c('32', `${n('PASS')} passed`)}  ${n('FAIL') ? c('31', `${n('FAIL')} failed`) : '0 failed'}  ${n('NOT RUN') ? c('33', `${n('NOT RUN')} not run`) : '0 not run'}  ${running.length ? c(tones.work, `${running.length} running`) : '0 running'}  ${c('90', `${n('WAITING')} waiting`)}`,
    folder ? `${c('90', 'scanning')} ${midTruncate(folder, Math.max(20, width - headW - 14 - (bugs && bugs.total ? 18 : 0)))}` : '',
    '',
    c(st.tone, `"${st.text}"`),
  ]
  // The bug counter. Stacked (100+ columns, 24+ rows, with the meerkat): on the right, on the rows below the title and the bar. Otherwise
  // one line: beside the title when there is room, else on the (always present) spare line under the counts.
  const counter = bugCounter(bugs, { width, color, height, stack: head.length > 0 })
  const lead = headW + visible(info[0])
  const inline = counter.mode !== 'stack' && counter.plain && lead + 3 + counter.plain.length <= width - 1
  if (inline) info[0] = `${info[0]}${' '.repeat(width - 1 - lead - counter.plain.length)}${counter.text}`
  const lines = []
  if (head.length) for (let i = 0; i < head.length; i++) lines.push(`${head[i]}${' '.repeat(SPRITE_WIDTH + 4 - visible(head[i]))}${info[i] ?? ''}`)
  else if (mini.length) {
    const idx = [0, 1, 2, 3, 4, 6]
    idx.forEach((i, k) => lines.push(`${mini[k] ?? ' '.repeat(MINI_HEAD_WIDTH)}${' '.repeat(Math.max(0, MINI_HEAD_WIDTH + 2 - visible(mini[k] ?? '')))}${info[i] ?? ''}`.trimEnd()))
  } else lines.push(...[0, 1, 2, 3, 4, 6].map((i) => (info[i] ? `  ${info[i]}` : '')))
  if (counter.mode === 'stack') counter.lines.forEach((b, k) => (lines[BUG_STACK_ROW + k] = overlayRight(lines[BUG_STACK_ROW + k] ?? '', b, width)))
  else if (counter.plain && !inline) lines[4] = overlayRight(lines[4] ?? '', { text: counter.text, width: counter.plain.length }, width)
  const plan = planLayout(height, lines.length)

  // RUNNING NOW: a fixed number of lines, however many checks run.
  lines.push('', c('1', '  RUNNING NOW') + c('90', `   ${running.length} running${running.length > plan.run ? ', longest-running shown' : ''}: lane, check, time so far of the usual, and the file or step it is on`))
  // Rows the running area does not need go to the group list below, so there is no empty block; the frame keeps the same total height.
  const runBlock = runningLines(rows, now, tick, c, color, spin, tones, width, plan.run)
  let spare = 0
  while (runBlock.length > 3 && runBlock[runBlock.length - 1] === '') {
    runBlock.pop()
    spare++
  }
  lines.push(...runBlock)
  // The heading starts exactly over the timeline column (TIMELINE_X cells in).
  lines.push('', c('1', `${padCells('  ALL CHECKS', TIMELINE_X)}TIMELINE`))
  const rowCtx = { now, started, tick, color, width, c }
  const cats = groupRows(rows, { grouped, span: rowSpan(now) })
  const space = plan.groups === undefined ? undefined : plan.groups + spare
  let listing
  if (cats) {
    // One line per category; the failed, not-run and running checks of a category are listed under it. Problems sort first, so a hard
    // cap on the height cuts the quiet categories at the end, never a failure.
    lines.push(c('90', `  ${rows.length} checks in ${cats.length} group${cats.length === 1 ? '' : 's'}. Problems and running checks are listed under their group. g: every check`))
    listing = fitGroups(cats, space === undefined ? Infinity : space, { rowCtx, catCtx: { color, width, started, now, tick }, c })
  } else {
    lines.push(c('90', `  ${rows.length} check${rows.length === 1 ? '' : 's'}, one line each. g: fold them into groups`))
    const view = windowRows(rows, space)
    listing = [...(view.above ? [c('90', `  ↑ ${view.above} more above`)] : []), ...view.rows.map((r) => checkLine(r, rowCtx)), ...(view.below ? [c('90', `  ↓ ${view.below} more below`)] : [])]
  }
  lines.push(...(space === undefined ? listing : padTo(listing, space)))
  if (plan.events === undefined || plan.events > 0) {
    lines.push('', c('1', '  EVENTS'))
    const ev = events.slice(plan.events === undefined ? -5 : -plan.events).map((e) => c('90', `  ${sec(e.at - started).padStart(5)}  `) + fit(stripControl(e.text), width - 10))
    lines.push(...(plan.events === undefined ? ev : padTo(ev, plan.events)))
  }
  return lines.map((l) => clipLine(l, width))
}
