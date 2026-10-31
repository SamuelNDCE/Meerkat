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
import { pixelHead, SPRITE_WIDTH } from './pixelhead.mjs'
import { stripControl } from './safe.mjs'

const ESC = '\x1b['
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// The head is pixel art (pixelhead.mjs): a profile looking left, its mirror, and a front view for the middle of a scan.
export const headLines = (pose, color = true) => pixelHead(pose, { color })

// Where the head looks: it faces right, toward the numbers, and glances left now and then (a second and a half out of every eight) and blinks now and then,
// keeping the direction it was looking in. It squints when everything passed and stares when something did not.
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
const visible = (t) => t.replace(/\[[0-9;]*m/g, '').length
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
  const head = headLines(poseFor({ mood, tick }), color)
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
  for (let i = 0; i < head.length; i++) lines.push(`${head[i]}${' '.repeat(SPRITE_WIDTH + 4 - visible(head[i]))}${info[i] ?? ''}`)
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
