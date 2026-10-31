// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Meerkat's live board (mock-up stage): everything that is happening in a run, on one screen, redrawn smoothly.
// Pure: a snapshot in, lines out, so it can be tested and shown without a real run. What it shows:
//   - a meerkat head that scans left and right while it watches, blinks, and reacts to the result;
//   - the overall bar, time spent, time left, counts;
//   - LANES: for each lane (cargo, windows, free) what runs in it right now, with its own bar against the typical
//     time on this PC, and the line the check printed last, so nothing is a black box;
//   - CHECKS: every check, its status as a word, its time, its typical time;
//   - EVENTS: the last things that happened, with the time each happened.
// Status is always a word as well as a colour; the spinner and the head are decoration on top.
import { formatDuration, renderBar } from '../progress.mjs'
import { stripControl } from './safe.mjs'

const ESC = '\x1b['
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// The head: a profile looking left (the pose of a meerkat on lookout), its mirror looking right, and a front view for
// the middle of a scan. E marks the eye; it is swapped for a blink, a happy or a wide-eyed one. First drawing, to be
// refined; the shape matters less than that it turns.
const PROFILE_LEFT = [
  '           __,.-.      ',
  "      ,.-''     `.     ",
  "  .--'   (▓E▓)    `.   ",
  " <●  `-.   `'  ,-.  \\  ",
  '   `-.__`--.__(  )  |  ',
  "        `-.____`-'_/   ",
]
const FRONT = [
  '     ,-._____,-.     ',
  "    (  ,'     `.  )    ",
  '     \\/ (▓E▓)(▓E▓) \\/     ',
  "      |    .v.    |      ",
  '       \\    \\ /   /       ',
  "        `.   V  .'        ",
  "          `-...-'          ",
]
const MIRROR = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '`': "'", "'": '`', '[': ']', ']': '[', '{': '}', '}': '{' }
const mirror = (rows) => {
  const w = Math.max(...rows.map((r) => [...r].length))
  return rows.map((r) => [...r.padEnd(w)].reverse().map((ch) => MIRROR[ch] ?? ch).join(''))
}
const EYE = { look: '●', blink: '-', happy: '^', wide: 'O' }

export function headLines(pose) {
  const eye = pose === 'blink' ? EYE.blink : pose === 'happy' ? EYE.happy : pose === 'wide' ? EYE.wide : EYE.look
  const art = pose === 'right' ? mirror(PROFILE_LEFT) : pose === 'center' || pose === 'blink' ? FRONT : PROFILE_LEFT
  const rows = art.map((r) => r.replace(/E/g, eye).replace(/\s+$/, ''))
  while (rows.length < 7) rows.push('')
  return rows
}

// Where the head looks: it scans left, centre, right, centre (about two seconds a look), blinks now and then.
export function poseFor({ mood, tick }) {
  if (mood === 'cheer') return 'happy'
  if (mood === 'alarm') return 'wide'
  if (mood === 'wait') return tick % 24 < 20 ? 'center' : 'blink'
  const look = ['left', 'center', 'right', 'center'][Math.floor(tick / 20) % 4]
  return tick % 37 === 36 ? 'blink' : look
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
const sec = (ms) => (ms === null || ms === undefined ? '-' : formatDuration(ms))

// One lane line per running check, and a "waiting" line for a lane with nothing running.
function laneLines(rows, now, width, c) {
  const out = []
  for (const lane of ['cargo', 'electron', 'free']) {
    const label = lane === 'electron' ? 'windows' : lane
    const running = rows.filter((r) => r.lane === lane && r.status === 'RUNNING')
    const waiting = rows.filter((r) => r.lane === lane && r.status === 'WAITING')
    if (!running.length) {
      const why = waiting.length ? `waiting: ${waiting.map((w) => `${w.id}${w.reason ? ` (${w.reason})` : ''}`).join(', ')}` : 'idle'
      out.push(c('90', `  ${pad(label, 8)} ${why}`).slice(0, width + 20))
      continue
    }
    running.forEach((r, i) => {
      const spent = now - r.startedAt
      const base = r.typicalMs ?? r.expectedMs
      const frac = Math.min(0.99, spent / base)
      const slow = spent > base * 1.5
      const bar = renderBar(frac, 14)
      const tail = r.note ? stripControl(r.note) : ''
      out.push(`  ${pad(i === 0 ? label : '', 8)} ${c('36', SPIN[Math.floor(now / 80) % SPIN.length])} ${pad(r.id, 22)} ${c(slow ? '33' : '36', bar)} ${pad(`${sec(spent)}/${sec(base)}`, 11)}${slow ? c('33', 'slower than usual ') : ''}${c('90', tail)}`)
    })
  }
  return out
}

export function renderLive({ title = 'MEERKAT fast', rows, events = [], started, now, tick = 0, fraction = 0, etaMs = null, width = 110, color = true }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const mood = moodOfRows(rows)
  const head = headLines(poseFor({ mood, tick }))
  const n = (s) => rows.filter((r) => r.status === s).length
  const bad = n('FAIL') + n('NOT RUN') > 0
  const barW = Math.max(20, Math.min(46, width - 62))
  const info = [
    `${c('1', title)}   ${c('90', `elapsed ${sec(now - started)}${etaMs === null ? '' : `   about ${sec(etaMs)} left`}`)}`,
    `${c(bad ? '33' : '32', renderBar(fraction, barW))} ${c('1', `${Math.floor(fraction * 100)}%`.padStart(4))}  ${n('PASS') + n('FAIL') + n('NOT RUN')}/${rows.length} checks`,
    `${c('32', `${n('PASS')} passed`)}  ${n('FAIL') ? c('31', `${n('FAIL')} failed`) : '0 failed'}  ${n('NOT RUN') ? c('33', `${n('NOT RUN')} not run`) : '0 not run'}  ${c('36', `${n('RUNNING')} running`)}  ${c('90', `${n('WAITING')} waiting`)}`,
    '',
    mood === 'cheer' ? c('32', '"All clear. Safe to push."') : mood === 'alarm' ? c('31', '"Something is off. Look at the red lines."') : mood === 'wait' ? c('90', '"Waiting my turn..."') : c('90', '"On lookout. I can see everything that is running."'),
  ]
  const lines = []
  for (let i = 0; i < head.length; i++) lines.push(`${pad(head[i], 30)}${info[i] ?? ''}`)
  lines.push('', c('1', '  RUNNING NOW'), ...laneLines(rows, now, width, c), '')
  lines.push(c('1', '  ALL CHECKS'))
  for (const r of rows) {
    const typ = r.typicalMs === null || r.typicalMs === undefined ? 'not meas.' : sec(r.typicalMs)
    const time = r.status === 'RUNNING' ? sec(now - r.startedAt) : r.status === 'WAITING' ? '-' : sec(r.ms)
    lines.push(`  ${c(colorOf[r.status], pad(`${mark[r.status]} ${r.status}`, 10))} ${pad(r.id, 22)} ${pad(time, 7)} ${c('90', pad(`typical ${typ}`, 17))}${r.status === 'WAITING' && r.reason ? c('90', r.reason) : ''}${r.status === 'FAIL' || r.status === 'NOT RUN' ? c(colorOf[r.status], stripControl(r.detail ?? '')) : ''}`)
  }
  lines.push('', c('1', '  EVENTS'))
  for (const e of events.slice(-5)) lines.push(c('90', `  ${sec(e.at - started).padStart(5)}  `) + stripControl(e.text))
  return lines
}
