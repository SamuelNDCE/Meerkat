// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

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
import { pixelHead, SPRITE_WIDTH } from './pixelhead.mjs'
import { stripControl } from './safe.mjs'

const ESC = '\x1b['
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const spinner = (tick) => SPIN[tick % SPIN.length]

// The head is pixel art (pixelhead.mjs): a profile looking left, its mirror looking right.
export const headLines = (pose, color = true) => pixelHead(pose, { color })

// Where the head looks: it faces right, toward the numbers, and glances left now and then (a second and a half out of
// every eight) and blinks now and then, keeping the direction it was looking in. It squints when everything passed and
// stares when something did not.
export function poseFor({ mood, tick }) {
  if (mood === 'cheer') return 'happy'
  if (mood === 'alarm') return 'wide'
  const look = tick % 100 >= 82 ? 'left' : 'right'
  return tick % 37 === 36 ? `blink-${look}` : look
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
export function animatedBar(fraction, width, tick, { color = true, tone = '36' } = {}) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const filled = Math.round(f * width)
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  let out = ''
  const shimmer = filled > 1 ? tick % filled : -1
  for (let i = 0; i < filled; i++) {
    if (i === shimmer) out += c('97', color ? '█' : '▒')
    else if (i === filled - 1 && f < 1) out += c(tone, tick % 4 < 2 ? '█' : '▌')
    else out += c(tone, '█')
  }
  return out + c('90', '░'.repeat(width - filled))
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
function laneLines(rows, now, tick, c, color) {
  const out = []
  for (const lane of ['cargo', 'electron', 'free']) {
    const label = lane === 'electron' ? 'windows' : lane
    const running = rows.filter((r) => r.lane === lane && r.status === 'RUNNING')
    const waiting = rows.filter((r) => r.lane === lane && r.status === 'WAITING')
    if (!running.length) {
      const why = waiting.length ? `waiting: ${waiting.map((w) => `${w.id}${w.reason ? ` (${w.reason})` : ''}`).join(', ')}` : 'idle'
      out.push(c('90', `  ${pad(label, 8)} ${why}`))
      continue
    }
    running.forEach((r, i) => {
      const spent = now - r.startedAt
      const base = r.typicalMs ?? r.expectedMs
      const frac = Math.min(0.99, spent / base)
      const slow = spent > base * 1.5
      const left = base - spent
      const estimate = left > 0 ? `est. ${sec(left)} left` : slow ? 'slower than usual' : 'nearly done'
      const tail = r.note ? stripControl(r.note) : ''
      out.push(`  ${pad(i === 0 ? label : '', 8)} ${c('36', spinner(tick + i * 3))} ${pad(r.id, 22)} ${animatedBar(frac, 14, tick + i * 2, { color, tone: slow ? '33' : '36' })} ${pad(`${sec(spent)}/${sec(base)}`, 11)} ${c(slow ? '33' : '90', pad(estimate, 18))}${c('90', tail)}`)
    })
  }
  return out
}

export function renderLive({ title = 'MEERKAT fast', rows, events = [], started, now, tick = 0, fraction = 0, etaMs = null, width = 110, color = true }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const mood = moodOfRows(rows)
  const head = headLines(poseFor({ mood, tick }), color)
  const n = (s) => rows.filter((r) => r.status === s).length
  const bad = n('FAIL') + n('NOT RUN') > 0
  const barW = Math.max(20, Math.min(46, width - 70))
  const running = rows.filter((r) => r.status === 'RUNNING')
  const lane = (l) => running.filter((r) => r.lane === l).length
  const finished = n('PASS') + n('FAIL') + n('NOT RUN')
  const allDone = finished === rows.length && rows.length > 0
  const eta = allDone ? c('32', 'finished') : etaMs === null ? c('90', 'estimated time left: working it out') : c('90', `estimated time left ${sec(etaMs)}`)
  const info = [
    `${c('1', title)}   ${c('90', `elapsed ${sec(now - started)}`)}   ${eta}`,
    `${allDone ? c('32', '✔') : c('36', spinner(tick))} ${animatedBar(fraction, barW, tick, { color, tone: bad ? '33' : '32' })} ${c('1', `${Math.floor(fraction * 100)}%`.padStart(4))}  ${finished}/${rows.length} checks`,
    `${c('32', `${n('PASS')} passed`)}  ${n('FAIL') ? c('31', `${n('FAIL')} failed`) : '0 failed'}  ${n('NOT RUN') ? c('33', `${n('NOT RUN')} not run`) : '0 not run'}  ${c('90', `${n('WAITING')} waiting`)}`,
    running.length ? c('36', `${running.length} running in parallel`) + c('90', `  (cargo ${lane('cargo')} · windows ${lane('electron')} · free ${lane('free')})`) : c('90', 'nothing running right now'),
    '',
    mood === 'cheer' ? c('32', '"All clear. Safe to push."') : mood === 'alarm' ? c('31', '"Something is off. Look at the red lines."') : mood === 'wait' ? c('90', '"Waiting my turn..."') : c('90', '"On lookout. I can see everything that is running."'),
  ]
  const lines = []
  for (let i = 0; i < head.length; i++) lines.push(`${head[i]}${' '.repeat(SPRITE_WIDTH + 4 - visible(head[i]))}${info[i] ?? ''}`)
  lines.push('', c('1', '  RUNNING NOW'), ...laneLines(rows, now, tick, c, color), '')
  lines.push(c('1', `  ALL CHECKS${' '.repeat(52)}TIMELINE (overlap = running in parallel)`))
  for (const r of rows) {
    const typ = r.typicalMs === null || r.typicalMs === undefined ? 'not meas.' : sec(r.typicalMs)
    const time = r.status === 'RUNNING' ? sec(now - r.startedAt) : r.status === 'WAITING' ? '-' : sec(r.ms)
    const extra = r.status === 'FAIL' || r.status === 'NOT RUN' ? c(colorOf[r.status], ` ${stripControl(r.detail ?? '')}`) : ''
    lines.push(`  ${c(colorOf[r.status], pad(`${mark[r.status]} ${r.status}`, 10))} ${pad(r.id, 22)} ${pad(time, 7)} ${c('90', pad(`typical ${typ}`, 16))} ${timelineStrip(r, { started, now, tick, color })}${extra}`)
  }
  lines.push('', c('1', '  EVENTS'))
  for (const e of events.slice(-5)) lines.push(c('90', `  ${sec(e.at - started).padStart(5)}  `) + stripControl(e.text))
  return lines
}
