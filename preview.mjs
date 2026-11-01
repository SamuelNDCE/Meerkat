// A PREVIEW of Meerkat's live board, with a fake run (no real check, no app needed). It uses the real scheduler and
// the real start order on made-up checks that take the times a cold fast run takes on Samuel's PC, sped up so a whole
// run plays in about a minute.
//
//   node preview.mjs               play the run in this terminal (Ctrl+C to stop)
//   node preview.mjs --fail        one check fails, so you can see the alarm
//   node preview.mjs --speed 20    faster (default 10: 10 seconds of run per second watched)
//   node preview.mjs --height 40   draw for a terminal 40 rows tall (the lists share the rows like the real board)
//   node preview.mjs --once        print one still frame mid-run and exit
//   node preview.mjs --final --speed 3000   run to the end at once and print the finished board (--fail for the alarm)
//   node preview.mjs --plain       no colour
//   node preview.mjs --flat        one line per check, as before (the default folds a run of more than 24 checks into groups; --grouped forces it)
//   node preview.mjs --head        just the meerkat: every pose side by side, and its colours (--256 for the 256-colour fallback)
import { writeFileSync } from 'node:fs'
import { VERSION } from './lib/version.mjs'
import { estimateRemaining } from './lib/eta.mjs'
import { orderForSpeed, runAll } from './lib/runner.mjs'
import { renderLive } from './lib/tui/live.mjs'
import { colorLevel } from './lib/tui/color.mjs'
import { renderGallery } from './lib/tui/gallery.mjs'
import { loadTheme } from './lib/tui/theme.mjs'
import { createModel } from './lib/tui/model.mjs'
import { SAMPLE_NOTE } from './lib/tui/resultssample.mjs'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const SPEED = has('--speed') ? Number(argv[argv.indexOf('--speed') + 1]) || 10 : 10
const FAIL = has('--fail')
// --height N: draw for a terminal N rows tall (default: this terminal, or 40 when the output is not a terminal, so pictures are the same everywhere).
const HEIGHT = has('--height') ? Number(argv[argv.indexOf('--height') + 1]) || 40 : process.stdout.rows || 40
const statusState = {}
// --flat: one line per check; --grouped: always fold into groups; neither: fold when there are more than 24 checks.
const GROUPED = has('--flat') ? false : has('--grouped') ? true : undefined
const theme = loadTheme({})
const color = !has('--plain') && !process.env.NO_COLOR
if (has('--head')) {
  console.log(renderGallery({ mode: has('--256') ? '256' : color ? colorLevel(process.env) : false }))
  process.exit(0)
}
const ESC = '\x1b['
// Everything this file draws is made up; every frame says so, so no picture of it can pass for a real run.
const withNote = (lines) => [...lines, '', color ? `${ESC}1;33m  ${SAMPLE_NOTE}${ESC}0m` : `  ${SAMPLE_NOTE}`]

// Real names, lanes and dependencies of the fast tier; durations are the cold-run numbers (seconds).
const KIND = { 'rule-scan': 'security', 'npm-audit': 'security', 'cargo-audit': 'security', 'ui-screens': 'ui', 'click-through': 'ui' }
const spec = [
  ['rule-scan', 'free', 1, [], ['reading 1,204 files', '5 rules, clean']],
  ['npm-audit', 'free', 2, [], ['asking the registry', 'found 0 vulnerabilities']],
  ['cargo-audit', 'free', 3, [], ['fetching advisory database', 'checking 560 crates']],
  ['type-check', 'free', 10, [], ['tsc -p tsconfig.json', 'tsc -p tsconfig.electron.json']],
  ['build-all', 'free', 10, [], ['vite build', 'transforming 1,840 modules', 'tsc -p tsconfig.electron.json']],
  ['unit-tests', 'free', 131, [], ['vitest: 40 / 530 files', 'vitest: 210 / 530 files', 'vitest: 480 / 530 files']],
  ['cargo-fmt', 'cargo', 3, [], ['cargo fmt --check']],
  ['build-tauri', 'cargo', 378, [], ['Compiling plume-core v1.4.2', 'Compiling plume-db v1.4.2', 'Compiling plume-sync v1.4.2', 'Compiling plume-ipc v1.4.2', 'Compiling plume-app v1.4.2', 'Linking plume-app.exe']],
  ['proptest-db', 'cargo', 90, [], ['Compiling proptest', 'running 10 tests', 'test round_trips ... ok']],
  ['clippy', 'cargo', 189, [], ['Checking plume-core', 'Checking plume-sync', 'Checking plume-app (all targets)']],
  ['test-sandbox', 'electron', 3, ['build-all'], ['opening a hidden window', '5 native calls blocked']],
  ['ui-screens', 'electron', 13, ['build-tauri'], ['Dashboard', 'Library', 'Settings']],
  ['click-through', 'electron', 112, ['build-tauri'], ['6 windows open', 'pressing controls: 120 / 362', 'pressing controls: 300 / 362']],
]

// About fifty more quick checks, so the board has a realistic number of rows to fold: [group, pack, names].
const MORE = [
  ['security', 'security', ['secret-scan', 'private-key-scan', 'env-committed', 'eval-use', 'sql-string-concat', 'workflow-perms', 'pinned-actions']],
  ['functionality', 'quality', ['todo-fixme', 'console-log-left', 'debugger-left', 'empty-catch', 'unused-exports', 'dead-imports', 'duplicate-ids', 'circular-imports', 'long-functions', 'any-types', 'ts-ignore-count', 'skipped-tests', 'focused-tests', 'test-names', 'broken-links', 'readme-present', 'license-present', 'changelog-fresh', 'json-valid', 'yaml-valid', 'lockfile-in-sync', 'engines-field', 'bin-executable', 'shebang-lines']],
  ['functionality', 'node', ['package-scripts', 'peer-deps', 'unused-deps', 'type-field', 'exports-map', 'files-field']],
  ['functionality', null, ['line-endings', 'trailing-space', 'final-newline', 'big-files']],
  ['ui', 'web', ['alt-text', 'html-lang', 'button-names', 'form-labels']],
  ['performance', 'performance', ['bundle-size', 'image-size', 'sync-fs-in-loop']],
  ['refactor', 'refactor', ['file-length', 'nesting-depth', 'param-count', 'duplicate-blocks']],
]
for (const [group, pack, names] of MORE) for (const [i, name] of names.entries()) spec.push([name, 'free', 1 + (i % 3), [], [`checking ${name}`], group, pack])
// Files the made-up checks "look at", so the board shows names moving past and a count rising (the real run reads them from the
// MEERKAT-FILE and MEERKAT-FILES lines a check prints, lib/progress-files.mjs). Which checks read files, and how many.
const FILE_TOTALS = { 'rule-scan': 1204, 'type-check': 940, 'build-all': 1840, 'unit-tests': 530, 'ui-screens': 24 }
const DIRS = ['src/auth', 'src/api', 'src/ui/components', 'src/sync', 'src/util', 'src-tauri/src', 'scripts', 'docs']
const STEMS = ['session', 'orders', 'Sidebar', 'queue', 'settings', 'index', 'db', 'hash', 'router', 'Comment', 'search', 'Header']
const EXTS = ['ts', 'tsx', 'ts', 'mjs', 'ts', 'css', 'ts', 'md']
export const fakeFile = (id, i) => {
  const suffix = id === 'unit-tests' ? '.test.ts' : '.' + EXTS[(i * 5) % EXTS.length]
  return `${DIRS[(i * 7) % DIRS.length]}/${STEMS[(i * 3 + 1) % STEMS.length]}${i % 11 === 0 ? '-' + (i % 97) : ''}${suffix}`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const checks = spec.map(([id, lane, secs, after, notes, group, pack]) => ({
  id,
  group: group ?? KIND[id] ?? 'functionality',
  source: pack ? `pack ${pack}` : 'built in',
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
let lastChecking = 0
const frame = (tick) => {
  const t = simNow()
  const rows = model.snapshot(t).map((r) => ({ ...r, note: r.status === 'RUNNING' ? note.get(r.id) : '' }))
  // Make each running check print the next of its lines as it goes, so the board shows what it is doing.
  for (const r of rows) {
    if (r.status !== 'RUNNING') continue
    const c = checks.find((x) => x.id === r.id)
    const frac = Math.min(0.999, (t - r.startedAt) / (r.typicalMs ?? r.expectedMs))
    note.set(r.id, c.notes[Math.min(c.notes.length - 1, Math.floor(frac * c.notes.length))])
    const total = FILE_TOTALS[r.id]
    if (total) {
      const done = Math.floor(frac * total)
      Object.assign(r, { currentFile: fakeFile(r.id, done), filesDone: done, filesTotal: total })
      // The same one-line-a-second "checking" event the real board writes, replacing the last one.
      if (t - lastChecking > 1000) {
        lastChecking = t
        const e = events[events.length - 1]
        const text = `checking ${r.currentFile} (${r.id})`
        if (e?.kind === 'checking') Object.assign(e, { at: t, text })
        else events.push({ at: t, text, kind: 'checking' })
      }
    }
  }
  const done = new Set(rows.filter((r) => ['PASS', 'FAIL', 'NOT RUN'].includes(r.status)).map((r) => r.id))
  const allDone = done.size === rows.length
  // The same countdown and eased bar as the real run (lib/eta.mjs).
  const remaining = estimateRemaining(rows, t, { freeSlots: 11 })
  const target = allDone ? 1 : (t - base) / Math.max(1, t - base + remaining)
  shown = allDone ? 1 : Math.max(shown, shown + (target - shown) * 0.3)
  return withNote(renderLive({ title: 'MEERKAT v' + VERSION + ' . fast', folder: 'C:/Users/SamuelNDCE/code/plume', preset: 'fast', rows, events, started: base, now: t, tick, fraction: shown, etaMs: allDone ? null : remaining, width: Math.min(process.stdout.columns || 110, 120), height: HEIGHT, color, theme, grouped: GROUPED, statusState }))
}

if (has('--once')) {
  // A still frame, taken part way through: some done, the cargo build and a unit-test run going, windows waiting.
  const t0 = base
  const fakeNow = t0 + 140_000
  const early = { 'rule-scan': 2, 'npm-audit': 3, 'cargo-audit': 4, 'type-check': 10, 'build-all': 10, 'cargo-fmt': 4, 'test-sandbox': 15 }
  for (const [id, at] of Object.entries(early)) {
    const c = checks.find((x) => x.id === id)
    model.start(c, t0 + at * 1000 - 2000)
    model.settle(c, id === 'cargo-audit' && FAIL ? { status: 'FAIL', detail: '4 known advisories (RUSTSEC)' } : { status: 'PASS' }, 2000 + (id === 'type-check' || id === 'build-all' ? 8000 : 0))
  }
  // The extra quick checks: nearly all done by now, a few still running or waiting.
  const extra = checks.filter((c) => !Object.hasOwn(early, c.id) && !['build-tauri', 'unit-tests', 'ui-screens', 'click-through', 'proptest-db', 'clippy'].includes(c.id))
  for (const [i, c] of extra.entries()) {
    if (i % 17 === 16) continue
    model.start(c, i % 17 === 15 ? fakeNow - 1000 : t0 + 20_000 + i * 1500)
    if (i % 17 === 15) continue
    model.settle(c, { status: 'PASS' }, 1000 + (i % 3) * 1000)
  }
  for (const id of ['build-tauri', 'unit-tests']) model.start(checks.find((c) => c.id === id), fakeNow - 120_000)
  model.queue([{ id: 'ui-screens', reason: 'after build-tauri' }, { id: 'click-through', reason: 'after build-tauri' }, { id: 'proptest-db', reason: 'the cargo lane is busy' }, { id: 'clippy', reason: 'the cargo lane is busy' }])
  events.push({ at: t0 + 120_000, text: 'started build-tauri: cargo build -p plume-app' }, { at: t0 + 125_000, text: 'PASS test-sandbox: 5 native calls blocked' }, { at: t0 + 130_000, text: 'started unit-tests' })
  note.set('build-tauri', 'Compiling plume-sync v1.4.2')
  note.set('unit-tests', 'vitest: 210 / 530 files')
  const rows = model.snapshot(fakeNow).map((r) => (r.id === 'unit-tests' ? { ...r, note: note.get(r.id), lastOutputAt: fakeNow - 1500, currentFile: fakeFile('unit-tests', 210), filesDone: 210, filesTotal: 530 } : { ...r, note: note.get(r.id), lastOutputAt: r.status === 'RUNNING' ? fakeNow - 2500 : r.lastOutputAt }))
  console.log(withNote(renderLive({ title: 'MEERKAT v' + VERSION + ' . fast', folder: 'C:/Users/SamuelNDCE/code/plume', preset: 'fast', rows, events, started: t0, now: fakeNow, tick: 22, fraction: 0.38, etaMs: 215_000, width: 110, height: HEIGHT, color, theme, statusState })).join('\n'))
  process.exit(0)
}

// The board lives on the terminal's alternate screen: it is redrawn from the top-left every frame, so it never scrolls
// or leaves old frames behind, and the shell comes back untouched when it ends. If the window is shorter than the
// board, the last sections (events, then the check list) are cut off rather than scrolled.
let last = []
const draw = (tick) => {
  const rows = HEIGHT - 1
  last = frame(tick)
  if (DUMP && tick % 10 === 0) dumped.push(last.join('\n'))
  process.stdout.write(`${ESC}H${last.slice(0, rows).map((l) => `${l}${ESC}K`).join('\n')}\n${ESC}J`)
}
const FINAL = has('--final')
// --dump <file>: also write a frame about every 0.8 s to the file (split by a form-feed line), for tools/make_gif.py.
const DUMP = has('--dump') ? argv[argv.indexOf('--dump') + 1] : null
const dumped = []
if (DUMP) process.on('exit', () => writeFileSync(DUMP, [...dumped, ...(last.length ? [last.join('\n')] : [])].join('\n\f\n')))
if (!FINAL) process.stdout.write(`${ESC}?1049h${ESC}?25l`)
if (!FINAL) process.on('exit', () => {
  process.stdout.write(`${ESC}?25h${ESC}?1049l`)
  if (last.length) process.stdout.write('\r' + last.map((l) => `${l}${ESC}K`).join('\n') + '\n')
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
