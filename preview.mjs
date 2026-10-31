// A PREVIEW of Meerkat's live board, with a fake run (no real check, no app needed). It uses the real scheduler and
// the real start order on made-up checks that take the times a cold fast run takes on Samuel's PC, sped up so a whole
// run plays in about a minute.
//
//   node preview.mjs               play the run in this terminal (Ctrl+C to stop)
//   node preview.mjs --fail        one check fails, so you can see the alarm
//   node preview.mjs --speed 20    faster (default 10: 10 seconds of run per second watched)
//   node preview.mjs --once        print one still frame mid-run and exit
//   node preview.mjs --final --speed 3000   run to the end at once and print the finished board (--fail for the alarm)
//   node preview.mjs --plain       no colour
//   node preview.mjs --head        just the meerkat: every pose side by side, and its colours (--256 for the 256-colour fallback)
import { estimateRemaining } from './lib/eta.mjs'
import { orderForSpeed, runAll } from './lib/runner.mjs'
import { renderLive } from './lib/tui/live.mjs'
import { colorLevel } from './lib/tui/color.mjs'
import { renderGallery } from './lib/tui/gallery.mjs'
import { loadTheme } from './lib/tui/theme.mjs'
import { createModel } from './lib/tui/model.mjs'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const SPEED = has('--speed') ? Number(argv[argv.indexOf('--speed') + 1]) || 10 : 10
const FAIL = has('--fail')
const theme = loadTheme({})
const color = !has('--plain') && !process.env.NO_COLOR
if (has('--head')) {
  console.log(renderGallery({ mode: has('--256') ? '256' : color ? colorLevel(process.env) : false }))
  process.exit(0)
}
const ESC = '\x1b['

// Real names, lanes and dependencies of the fast tier; durations are the cold-run numbers (seconds).
const spec = [
  ['rule-scan', 'free', 1, [], ['reading 4,474 files', '5 rules, clean']],
  ['npm-audit', 'free', 2, [], ['asking the registry', 'found 0 vulnerabilities']],
  ['cargo-audit', 'free', 3, [], ['fetching advisory database', 'checking 560 crates']],
  ['type-check', 'free', 10, [], ['tsc -p tsconfig.json', 'tsc -p tsconfig.electron.json']],
  ['build-all', 'free', 10, [], ['vite build', 'transforming 1,840 modules', 'tsc -p tsconfig.electron.json']],
  ['unit-tests', 'free', 131, [], ['vitest: 40 / 530 files', 'vitest: 210 / 530 files', 'vitest: 480 / 530 files']],
  ['sidecar-fmt', 'cargo', 3, [], ['cargo fmt --check']],
  ['build-sidecar', 'cargo', 378, [], ['Compiling nv-core v1.1.0', 'Compiling nv-vault v1.1.0', 'Compiling nv-agents v1.1.0', 'Compiling nv-runtime v1.1.0', 'Compiling nv-sidecar v1.1.0', 'Linking nv-sidecar.exe']],
  ['vault-parser-proptest', 'cargo', 90, [], ['Compiling proptest', 'running 10 tests', 'test round_trips ... ok']],
  ['sidecar-clippy', 'cargo', 189, [], ['Checking nv-core', 'Checking nv-agents', 'Checking nv-sidecar (all targets)']],
  ['test-safety', 'electron', 3, ['build-all'], ['opening a hidden window', '5 native calls blocked']],
  ['ui-screens', 'electron', 13, ['build-sidecar'], ['Dashboard', 'Library', 'Settings']],
  ['click-through', 'electron', 112, ['build-sidecar'], ['6 windows open', 'pressing controls: 120 / 362', 'pressing controls: 300 / 362']],
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = spec.map(([id, lane, secs, after, notes]) => ({
  id,
  lane,
  after,
  estSeconds: secs,
  title: id,
  notes,
  run: async () => {
    await sleep((secs * 1000) / SPEED)
    return FAIL && id === 'cargo-audit' ? { ok: false, detail: '4 known advisories (RUSTSEC)' } : { ok: true, detail: '' }
  },
}))
const timings = { checks: Object.fromEntries(spec.map(([id, , secs]) => [id, { fast: [secs * 1000] }])) }

const base = Date.now()
const simNow = () => base + (Date.now() - base) * SPEED
const model = createModel({ checks, timings, tier: 'fast' })
const events = []
const note = new Map()
const say = (text) => events.push({ at: simNow(), text })

let shown = 0
const frame = (tick) => {
  const t = simNow()
  const rows = model.snapshot(t).map((r) => ({ ...r, note: r.status === 'RUNNING' ? note.get(r.id) : '' }))
  // Make each running check print the next of its lines as it goes, so the board shows what it is doing.
  for (const r of rows) {
    if (r.status !== 'RUNNING') continue
    const c = checks.find((x) => x.id === r.id)
    const frac = Math.min(0.999, (t - r.startedAt) / (r.typicalMs ?? r.expectedMs))
    note.set(r.id, c.notes[Math.min(c.notes.length - 1, Math.floor(frac * c.notes.length))])
  }
  const done = new Set(rows.filter((r) => ['PASS', 'FAIL', 'NOT RUN'].includes(r.status)).map((r) => r.id))
  const allDone = done.size === rows.length
  // The same countdown and eased bar as the real run (lib/eta.mjs).
  const remaining = estimateRemaining(rows, t, { freeSlots: 11 })
  const target = allDone ? 1 : (t - base) / Math.max(1, t - base + remaining)
  shown = allDone ? 1 : Math.max(shown, shown + (target - shown) * 0.3)
  return renderLive({ title: 'MEERKAT fast', rows, events, started: base, now: t, tick, fraction: shown, etaMs: allDone ? null : remaining, width: Math.min(process.stdout.columns || 110, 120), height: process.stdout.rows, color, theme })
}

if (has('--once')) {
  // A still frame, taken part way through: some done, the cargo build and a unit-test run going, windows waiting.
  const t0 = base
  const fakeNow = t0 + 140_000
  const early = { 'rule-scan': 2, 'npm-audit': 3, 'cargo-audit': 4, 'type-check': 10, 'build-all': 10, 'sidecar-fmt': 4, 'test-safety': 15 }
  for (const [id, at] of Object.entries(early)) {
    const c = checks.find((x) => x.id === id)
    model.start(c, t0 + at * 1000 - 2000)
    model.settle(c, { status: 'PASS' }, 2000 + (id === 'type-check' || id === 'build-all' ? 8000 : 0))
  }
  for (const id of ['build-sidecar', 'unit-tests']) model.start(checks.find((c) => c.id === id), fakeNow - 120_000)
  model.queue([{ id: 'ui-screens', reason: 'after build-sidecar' }, { id: 'click-through', reason: 'after build-sidecar' }, { id: 'vault-parser-proptest', reason: 'the cargo lane is busy' }, { id: 'sidecar-clippy', reason: 'the cargo lane is busy' }])
  events.push({ at: t0 + 120_000, text: 'started build-sidecar: cargo build -p nv-sidecar' }, { at: t0 + 125_000, text: 'PASS test-safety: 5 native calls blocked' }, { at: t0 + 130_000, text: 'started unit-tests' })
  note.set('build-sidecar', 'Compiling nv-agents v1.1.0')
  note.set('unit-tests', 'vitest: 210 / 530 files')
  const rows = model.snapshot(fakeNow).map((r) => ({ ...r, note: note.get(r.id) }))
  console.log(renderLive({ rows, events, started: t0, now: fakeNow, tick: 22, fraction: 0.38, etaMs: 215_000, width: 110, color, theme }).join('\n'))
  process.exit(0)
}

// The board lives on the terminal's alternate screen: it is redrawn from the top-left every frame, so it never scrolls
// or leaves old frames behind, and the shell comes back untouched when it ends. If the window is shorter than the
// board, the last sections (events, then the check list) are cut off rather than scrolled.
let last = []
const draw = (tick) => {
  const rows = (process.stdout.rows || 60) - 1
  last = frame(tick)
  process.stdout.write(`${ESC}H${last.slice(0, rows).map((l) => `${l}${ESC}K`).join('\n')}\n${ESC}J`)
}
const FINAL = has('--final')
if (!FINAL) process.stdout.write(`${ESC}?1049h${ESC}?25l`)
if (!FINAL) process.on('exit', () => {
  process.stdout.write(`${ESC}?25h${ESC}?1049l`)
  if (last.length) console.log(last.join('\n'))
})
process.on('SIGINT', () => process.exit(130))
let tick = 0
const timer = FINAL ? null : setInterval(() => draw(tick++), 80)
const ordered = orderForSpeed(checks)
await runAll(ordered, { env: process.env, platform: process.platform, exists: () => true }, {
  keepGoing: true,
  parallel: 11,
  hooks: {
    start: (c) => {
      model.start(c, simNow())
      say(`started ${c.id}${c.lane === 'cargo' ? ' (cargo lane)' : c.lane === 'electron' ? ' (window lane)' : ''}`)
    },
    settle: (c, r, ms) => {
      model.settle(c, r, ms * SPEED)
      say(`${r.status} ${c.id} (${Math.round((ms * SPEED) / 1000)}s)${r.detail ? `: ${r.detail}` : ''}`)
    },
    queue: (w) => model.queue(w),
  },
})
if (FINAL) {
  console.log(frame(0).join('\n'))
  process.exit(0)
}
await sleep(400)
draw(tick++)
clearInterval(timer)
await sleep(300)
