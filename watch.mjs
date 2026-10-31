// Watch a Meerkat run from a second terminal. Read-only: it reads the run's status file and the saved times and run
// log in your home folder, and never touches the run. See lib/tui/watch.mjs.
//
//   node watch.mjs                 follow the run (Ctrl+C or q to leave; the run keeps going)
//   node watch.mjs --once          one frame, then exit
//   node watch.mjs --file <path>   a different status file (NV_VERIFY_STATUS does the same)
//   node watch.mjs --plain         no colour
import { readFileSync } from 'node:fs'
import { historyPath, loadHistory } from './lib/tui/history.mjs'
import { KEY_NAMES } from './lib/tui/index.mjs'
import { initialState, nextState, applyFilter } from './lib/tui/model.mjs'
import { frameFromStatus, rowsFromStatus } from './lib/tui/watch.mjs'
import { statusPath } from './lib/status.mjs'
import { loadTimings, timingsPath } from './lib/timings.mjs'

const ESC = '\x1b['
const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const file = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : statusPath(process.env)
const color = !flag('--plain') && !process.env.NO_COLOR

const readStatus = () => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const width = () => Math.max(40, Math.min(process.stdout.columns || 100, 140))
const draw = (state) => {
  const status = readStatus()
  return frameFromStatus(status, { timings: loadTimings(timingsPath(process.env)), history: loadHistory(historyPath(process.env)), state, width: width(), color })
}

if (flag('--once') || !process.stdout.isTTY) {
  console.log(draw(initialState()).join('\n'))
  process.exit(0)
}

let state = initialState()
let blockLines = 0
const redraw = () => {
  if (blockLines > 0) process.stdout.write(`${ESC}${blockLines}A${ESC}0J`)
  const lines = draw(state)
  process.stdout.write(`${lines.join('\n')}\n`)
  blockLines = lines.length
}
const leave = () => {
  process.stdout.write(`${ESC}?25h`)
  try {
    process.stdin.setRawMode(false)
  } catch {
    /* already gone */
  }
  process.exit(0)
}
process.stdout.write(`${ESC}?25l`)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (chunk) => {
    const name = KEY_NAMES[String(chunk)]
    if (name === 'ctrl-c' || name === 'q') return leave()
    if (!name) return
    const status = readStatus()
    const rowCount = status ? applyFilter(rowsFromStatus(status), state.filter).length : 0
    state = nextState(state, name, { rowCount })
    redraw()
  })
}
process.on('exit', () => process.stdout.write(`${ESC}?25h`))
redraw()
setInterval(redraw, 1000)
