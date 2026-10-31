// The Meerkat terminal UI: a fake run (no real check, no real terminal), so it is fast and safe to run anywhere.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appendRun, loadHistory, runEntry } from './history.mjs'
import { canUseUi, createTui, tailOf } from './index.mjs'
import { applyFilter, createModel, initialState, nextState, outputFileFrom, typicalMs } from './model.mjs'
import { renderHistory, renderRows, sparkline } from './render.mjs'
import { frameFromStatus, rowsFromStatus, staleNote } from './watch.mjs'
import { mascotLines, moodOf, speechFor, withMascot } from './mascot.mjs'
import { animatedBar, headLines, poseFor, renderLive, timelineStrip, windowRows } from './live.mjs'
import { knownStatus, safeLogPath, stripControl } from './safe.mjs'
import { parseArgs } from '../../run.mjs'
import { finalReport } from '../report.mjs'
import { runCommand } from '../exec.mjs'
import { runOne } from '../runner.mjs'
import { colorLevel, to256 } from './color.mjs'
import { THEMES, furPalette, loadTheme, parseColor, sgrFor } from './theme.mjs'
import { createSplash, renderSplash } from './splash.mjs'
import { estimateRemaining } from '../eta.mjs'
import { PALETTE } from './pixelhead.mjs'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nv-tui-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const checks = [
  { id: 'a', title: 'A', lane: 'free', estSeconds: 10 },
  { id: 'b', title: 'B', lane: 'cargo', estSeconds: 100 },
  { id: 'c', title: 'C', lane: 'electron', estSeconds: 30 },
]
const timings = { checks: { a: { fast: [2000, 4000, 3000] }, b: { fast: [90000] } } }
const fakeStream = () => {
  const out: string[] = []
  return { out, columns: 100, write: (t: string) => out.push(t) }
}

describe('model', () => {
  test('typical time is the middle of the saved samples, not measured when there are none', () => {
    expect(typicalMs(timings, 'a', 'fast')).toBe(3000)
    expect(typicalMs(timings, 'c', 'fast')).toBeNull()
  })
  test('rows follow start and settle events and keep the saved output path', () => {
    const m = createModel({ checks, timings, tier: 'fast' })
    m.start(checks[1], 1000)
    expect(m.snapshot(61000).find((r) => r.id === 'b')).toMatchObject({ status: 'RUNNING', elapsedMs: 60000, slow: false })
    expect(m.snapshot(1000 + 90000 * 3.1).find((r) => r.id === 'b')?.slow).toBe(true)
    m.settle(checks[1], { status: 'FAIL', detail: 'boom', outputFile: 'C:/tmp/b.log' }, 5000)
    expect(m.snapshot(9000).find((r) => r.id === 'b')).toMatchObject({ status: 'FAIL', elapsedMs: 5000, outputFile: 'C:/tmp/b.log' })
    expect(outputFileFrom('no file named')).toBeNull()
  })
  test('waiting rows carry the reason the scheduler gave', () => {
    const m = createModel({ checks, timings })
    m.queue([{ id: 'c', reason: 'after b' }])
    expect(m.snapshot(0).find((r) => r.id === 'c')?.reason).toBe('after b')
  })
  test('filters and keys', () => {
    const m = createModel({ checks, timings })
    m.settle(checks[0], { status: 'PASS' }, 1)
    m.settle(checks[1], { status: 'NOT RUN', detail: 'x' }, 0)
    const rows = m.snapshot(0)
    expect(applyFilter(rows, 'problems').map((r) => r.id)).toEqual(['b'])
    let s = initialState()
    s = nextState(s, 'down', { rowCount: 3 })
    s = nextState(s, 'down', { rowCount: 3 })
    s = nextState(s, 'down', { rowCount: 3 })
    expect(s.selected).toBe(2)
    expect(nextState(s, 'tab', { rowCount: 3 }).view).toBe('history')
    expect(nextState(s, 'f', { rowCount: 1 })).toMatchObject({ filter: 'problems', selected: 0 })
    expect(nextState(s, 'enter', { rowCount: 3 }).open).toBe(true)
  })
})

describe('render', () => {
  test('a status is always a word, with or without colour', () => {
    const m = createModel({ checks, timings })
    m.settle(checks[0], { status: 'PASS' }, 2400)
    const plain = renderRows(m.snapshot(0), { width: 100, color: false }).join('\n')
    expect(plain).toContain('PASS')
    expect(plain).toContain('WAITING')
    expect(plain).not.toContain('\x1b[')
    expect(plain).toContain('not meas.')
  })
  test('a narrow terminal drops the typical and last-run columns', () => {
    const m = createModel({ checks, timings })
    const narrow = renderRows(m.snapshot(0), { width: 50, color: false })[0]
    expect(narrow).not.toContain('TYPICAL')
  })
  test('sparkline and history', () => {
    expect(sparkline([])).toBe('not measured')
    expect(sparkline([1, 2, 3])).toHaveLength(3)
    const lines = renderHistory([{ at: '2026-10-30T10:00:00Z', tier: 'fast', exitCode: 0, ms: 221000, summary: 'MEERKAT fast: ok' }], null, { width: 120 })
    expect(lines.join('\n')).toContain('2026-10-30 10:00')
  })
})

describe('the live view with a fake run', () => {
  test('draws, takes keys, shows the saved output tail, and restores the cursor', () => {
    const log = join(dir, 'b.log')
    writeFileSync(log, ['one', 'two', 'three'].join('\n') + '\n')
    const stream = fakeStream()
    let t = 0
    const tui = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, now: () => t, color: false, tickMs: 3_600_000, env: { MEERKAT_LOG_DIR: dir } })
    tui.start(checks[1])
    t = 5000
    tui.settle(checks[1], { status: 'FAIL', detail: 'boom', outputFile: log }, 5000)
    tui.key('o')
    const screen = tui.frame().join('\n')
    expect(screen).toContain('FAIL')
    expect(screen).toContain('1 failed')
    expect(screen).toContain('three')
    tui.stop()
    expect(stream.out.join('')).toContain('\x1b[?25h')
  })
  test('tailOf reads the last lines and reports an unreadable file instead of throwing', () => {
    expect(tailOf(join(dir, 'missing.log'), 3)[0]).toContain('cannot read')
  })
})

describe('plain fallback and run log', () => {
  test('--ui is only an opt-in flag, and CI or a pipe never gets the rich view', () => {
    expect(parseArgs(['--ui']).ui).toBe(true)
    expect(parseArgs([]).ui).toBe(false)
    expect(canUseUi({ isTTY: true, env: {} })).toBe(true)
    expect(canUseUi({ isTTY: false, env: {} })).toBe(false)
    expect(canUseUi({ isTTY: true, env: { CI: '1' } })).toBe(false)
    expect(canUseUi({ isTTY: true, env: { MEERKAT_PLAIN: '1' } })).toBe(false)
  })
  test('the run log keeps the last 20 runs and survives a missing or broken file', () => {
    const file = join(dir, 'h.json')
    expect(loadHistory(file)).toEqual([])
    for (let i = 0; i < 25; i++) appendRun(file, runEntry({ tier: 'fast', summary: `run ${i}`, exitCode: 0, ms: 1000, results: [{ id: 'a', status: 'PASS', ms: 5 }] }))
    const runs = loadHistory(file)
    expect(runs).toHaveLength(20)
    expect(runs[19].summary).toBe('run 24')
    writeFileSync(file, '{ not json')
    expect(loadHistory(file)).toEqual([])
    expect(readFileSync(join(dir, 'h.json'), 'utf8')).toContain('not json')
  })
})

describe('the watch viewer (reads a status file, never touches the run)', () => {
  const status = {
    title: 'MEERKAT fast',
    tier: 'fast',
    state: 'running',
    updatedAt: new Date(1_000_000).toISOString(),
    elapsedMs: 61_000,
    percent: 31,
    etaMs: 129_000,
    finished: [
      { id: 'a', status: 'PASS', ms: 2400, detail: '' },
      { id: 'c', status: 'FAIL', ms: 900, detail: 'boom  [full output: C:/tmp/c.log]' },
    ],
    running: [{ id: 'b', lane: 'cargo', elapsedMs: 57_000, expectedMs: 2000, overran: true }],
    waiting: [{ id: 'd', reason: 'after b' }],
  }
  test('every check becomes one row: finished, running, waiting', () => {
    const rows = rowsFromStatus(status, timings)
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['a:PASS', 'c:FAIL', 'b:RUNNING', 'd:WAITING'])
    expect(rows[1].outputFile).toBeNull() // C:/tmp/c.log is not inside Meerkat's log folder, so it is never opened
    expect(rows[2]).toMatchObject({ slow: true, lane: 'cargo' })
    expect(rows[0].typicalMs).toBe(3000)
  })
  test('the frame shows the percentage from the file and every status as a word', () => {
    const text = frameFromStatus(status, { timings, width: 100, color: false, now: 1_010_000 }).join('\n')
    expect(text).toContain('31%')
    expect(text).toContain('RUNNING')
    expect(text).toContain('slower than usual')
    expect(text).toContain('after b')
    expect(text).not.toContain('\x1b[')
  })
  test('no status file yet, a finished run, and a status file that stopped updating', () => {
    expect(frameFromStatus(null)[0]).toContain('No Meerkat status file')
    expect(frameFromStatus({ ...status, state: 'done', percent: 100, summary: 'MEERKAT fast: ok' }, { timings, color: false }).join('\n')).toContain('MEERKAT fast: ok')
    expect(staleNote(status, 1_000_000 + 5 * 60_000)).toContain('may have stopped')
    expect(staleNote(status, 1_000_000 + 1000)).toBe('')
  })
})

describe('the meerkat', () => {
  const row = (status: string, slow = false) => ({ id: status, status, slow })
  test('mood: anything not green is alarm, a clean finished run cheers, running is on watch, else waiting', () => {
    expect(moodOf([row('PASS'), row('FAIL')])).toBe('alarm')
    expect(moodOf([row('PASS'), row('NOT RUN')])).toBe('alarm')
    expect(moodOf([row('PASS'), row('PASS')])).toBe('cheer')
    expect(moodOf([row('PASS'), row('RUNNING')])).toBe('watch')
    expect(moodOf([row('WAITING')])).toBe('wait')
    expect(moodOf([])).toBe('wait')
  })
  test('every picture has the same size, and it blinks while on watch', () => {
    const rows = [row('RUNNING')]
    const all = [0, 1, 2, 3, 4].map((t) => mascotLines(rows, t))
    expect(new Set(all.flatMap((a) => a.map((l) => l.length))).size).toBe(1)
    expect(all[4][1]).not.toBe(all[0][1])
  })
  test('a slow check gets the stink eye; the line changes slowly, not every second', () => {
    expect(speechFor([row('RUNNING', true)], 0)).toMatch(/slower|snails/)
    expect(speechFor([row('RUNNING')], 0)).toBe(speechFor([row('RUNNING')], 7))
  })
  test('narrow terminal or switched off: the header alone, nothing else moves', () => {
    const head = ['title line', 'counts line']
    expect(withMascot(head, [row('PASS')], { width: 50 })).toEqual(head)
    expect(withMascot(head, [row('PASS')], { width: 100, enabled: false })).toEqual(head)
    const withArt = withMascot(head, [row('PASS')], { width: 100 })
    expect(withArt).toHaveLength(5)
    expect(withArt[0]).toContain('title line')
  })
})

describe('a status file is untrusted text', () => {
  const ESC = String.fromCharCode(27)
  test('control characters never reach the screen', () => {
    expect(stripControl(`red${ESC}[31m${ESC}]0;owned${String.fromCharCode(7)}x${String.fromCharCode(13)}y`)).toBe('red[31m]0;ownedxy')
    expect(stripControl('a	b')).toBe('a b')
    const hostile = { title: `T${ESC}[2J`, tier: 'fast', state: 'running', updatedAt: new Date().toISOString(), elapsedMs: 1, percent: 1, etaMs: null, summary: `S${ESC}[2J`, finished: [{ id: `id${ESC}[1A`, status: 'PASS', ms: 1, detail: `d${ESC}[0K` }], running: [], waiting: [] }
    const text = frameFromStatus(hostile, { timings, color: false, width: 100 }).join('\n')
    expect(text).not.toContain(ESC)
  })
  test('an unknown status is shown as NOT RUN, never as green', () => {
    expect(knownStatus('PASS')).toBe('PASS')
    expect(knownStatus('GREAT')).toBe('NOT RUN')
    const rows = rowsFromStatus({ tier: 'fast', finished: [{ id: 'x', status: 'GREAT', ms: 1 }] }, timings)
    expect(rows[0].status).toBe('NOT RUN')
  })
  test('only a file inside the log folder is opened', () => {
    const logs = join(dir, 'logs')
    mkdirSync(logs)
    const inside = join(logs, 'c.log')
    const outside = join(dir, 'secret.txt')
    writeFileSync(inside, 'tail line')
    writeFileSync(outside, 'not for the screen')
    const env = { MEERKAT_LOG_DIR: logs }
    expect(safeLogPath(inside, { env })).not.toBeNull()
    expect(safeLogPath(outside, { env })).toBeNull()
    expect(safeLogPath(join(logs, '..', 'secret.txt'), { env })).toBeNull()
    expect(safeLogPath('//server/share/x.log', { env })).toBeNull()
    expect(safeLogPath('//./pipe/x', { env })).toBeNull()
    expect(safeLogPath(join(logs, 'missing.log'), { env })).toBeNull()
    expect(safeLogPath(inside + String.fromCharCode(27) + '[2J', { env })).toBeNull()
    expect(safeLogPath(logs, { env })).toBeNull() // a folder is not a log file
    const mk = (path: string) => ({ tier: 'fast', finished: [{ id: 'c', status: 'FAIL', ms: 1, detail: `boom  [full output: ${path}]` }] })
    expect(rowsFromStatus(mk(inside), timings, { env })[0].outputFile).not.toBeNull()
    expect(rowsFromStatus(mk(outside), timings, { env })[0].outputFile).toBeNull()
    // text earlier in a detail cannot pose as the path: only the one at the very end counts
    const fake = { tier: 'fast', finished: [{ id: 'c', status: 'FAIL', ms: 1, detail: `[full output: ${inside}] and then more text` }] }
    expect(rowsFromStatus(fake, timings, { env })[0].outputFile).toBeNull()
  })
  test('a log tail is shown as plain text', () => {
    const f = join(dir, 'tail.log')
    writeFileSync(f, `ok${ESC}[31m red${ESC}[0m${String.fromCharCode(13)}done
`)
    expect(tailOf(f, 3)).toEqual(['ok[31m red[0mdone'])
  })
})

describe('the live board', () => {
  const t0 = 0
  const rows = [
    { id: 'a', status: 'PASS', lane: 'free', ms: 1000, typicalMs: 2000, expectedMs: 2000 },
    { id: 'b', status: 'RUNNING', lane: 'cargo', startedAt: 0, typicalMs: 100_000, expectedMs: 100_000, note: 'Compiling nv-core' },
    { id: 'c', status: 'WAITING', lane: 'electron', reason: 'after b', typicalMs: 5000, expectedMs: 5000 },
  ]
  test('the pixel head looks left and right, every pose has the same size, blinks keep their direction', () => {
    const names = ['left', 'right', 'blink-left', 'blink-right', 'happy', 'wide']
    const heads = names.map((p) => headLines(p, true))
    expect(new Set(heads.map((h) => h.length)).size).toBe(1)
    expect(heads[0]).toHaveLength(10)
    expect(heads[0].join('')).not.toBe(heads[1].join('')) // left is not right
    expect(heads[2].join('')).not.toBe(heads[0].join('')) // a blink changes the eye
    expect(heads[3].join('')).not.toBe(heads[1].join(''))
    expect(heads[5].join('')).not.toBe(heads[0].join('')) // wide-eyed
    expect(heads[0].join('')).toContain(String.fromCharCode(27) + '[38;2;')
  })
  test('without colour the same sprite is drawn in shades, and the eye still shows', () => {
    const plain = headLines('left', false).join('\n')
    expect(plain).not.toContain(String.fromCharCode(27))
    expect(plain).toContain('○')
    expect(headLines('blink-left', false).join('')).not.toContain('○')
  })
  test('the head looks straight ahead and only blinks; it squints when all passed and stares when something failed', () => {
    const seen = new Set([0, 24, 48, 72, 99, 100, 150].map((tick) => poseFor({ mood: 'watch', tick })))
    expect(seen).toEqual(new Set(['right']))
    expect(poseFor({ mood: 'watch', tick: 36 })).toBe('blink-right')
    expect(poseFor({ mood: 'cheer', tick: 0 })).toBe('happy')
    expect(poseFor({ mood: 'alarm', tick: 0 })).toBe('wide')
  })
  test('the board shows every lane, every check as a word, what the running one is doing, and no escape codes without colour', () => {
    const text = renderLive({ rows, events: [{ at: 5000, text: 'started b' }], started: t0, now: 30_000, tick: 3, fraction: 0.3, etaMs: 60_000, color: false }).join('\n')
    for (const word of ['cargo', 'windows', 'free', 'PASS', 'RUNNING', 'WAITING', 'Compiling nv-core', 'after b', 'started b', '30%']) expect(text).toContain(word)
    expect(text).not.toContain(String.fromCharCode(27))
  })
  test('text from a check is cleaned before it is drawn', () => {
    const bad = [{ ...rows[1], note: 'x' + String.fromCharCode(27) + '[2Jy' }]
    expect(renderLive({ rows: bad, started: 0, now: 1000, color: false }).join('\n')).not.toContain(String.fromCharCode(27))
  })
})

describe('the animations are alive, and the board shows parallel work and an estimate', () => {
  const NL = String.fromCharCode(10)
  const rows = [
    { id: 'a', status: 'PASS', lane: 'free', ms: 10_000, begunAt: 0, endedAt: 10_000, typicalMs: 10_000, expectedMs: 10_000 },
    { id: 'b', status: 'RUNNING', lane: 'cargo', startedAt: 5_000, begunAt: 5_000, typicalMs: 100_000, expectedMs: 100_000, note: 'Compiling' },
    { id: 'c', status: 'RUNNING', lane: 'free', startedAt: 8_000, begunAt: 8_000, typicalMs: 50_000, expectedMs: 50_000 },
    { id: 'd', status: 'WAITING', lane: 'electron', reason: 'after b', typicalMs: 5000, expectedMs: 5000 },
  ]
  const board = (tick: number) => renderLive({ rows, started: 0, now: 30_000, tick, fraction: 0.4, etaMs: 90_000, color: false, width: 110 }).join(NL)
  test('the bar shimmers and its edge pulses: the same progress draws differently on different ticks', () => {
    const frames = new Set([0, 1, 2, 3, 4, 5].map((t) => animatedBar(0.5, 20, t, { color: false })))
    expect(frames.size).toBeGreaterThan(3)
    expect(animatedBar(0.5, 20, 0, { color: false }).replace(/[^█▒▌░]/g, '')).toHaveLength(20) // same width every frame
    expect(animatedBar(1, 10, 3, { color: false })).not.toContain('░')
    expect(animatedBar(0, 10, 3, { color: false })).toBe('░'.repeat(10))
  })
  test('the spinner turns and the whole screen changes from one tick to the next', () => {
    expect(board(0)).not.toBe(board(1))
    expect(board(0)).not.toBe(board(3))
  })
  test('it says how long is estimated to be left, overall and for each running check', () => {
    const text = board(2)
    expect(text).toContain('estimated time left 1:30')
    expect(text).toContain('est. 1:15 left') // b: 100 s typical, 25 s spent
    expect(text).toContain('est. 0:28 left') // c: 50 s typical, 22 s spent
  })
  test('everything that is running is on screen, each with its own bar, and nothing says "in parallel"', () => {
    const text = board(2)
    expect(text).toContain('Compiling') // the running check's own line
    expect(text.match(/est\. /g)?.length).toBe(2) // both running checks have their own estimate
    expect(text).not.toContain('in parallel')
  })
  test('the timeline shows overlap: two running checks cover the same stretch, a waiting one is empty', () => {
    const strip = (r: any) => timelineStrip(r, { started: 0, now: 30_000, tick: 0, width: 30, color: false })
    const b = strip(rows[1])
    const c = strip(rows[2])
    const filled = (s: string) => [...s].map((ch, i) => (ch === '█' || ch === '▌' ? i : -1)).filter((i) => i >= 0)
    const overlap = filled(b).filter((i) => filled(c).includes(i))
    expect(overlap.length).toBeGreaterThan(10)
    expect(filled(strip(rows[3]))).toEqual([])
    expect(filled(strip(rows[0]))[0]).toBe(0) // a started at the beginning
    expect(strip(rows[1])).toHaveLength(30)
  })
  test('with colour on, the animation still only adds colour codes, never changes the text', () => {
    const plain = renderLive({ rows, started: 0, now: 30_000, tick: 5, fraction: 0.4, etaMs: 90_000, color: false, width: 110 }).join(NL)
    const coloured = renderLive({ rows, started: 0, now: 30_000, tick: 5, fraction: 0.4, etaMs: 90_000, color: true, width: 110 }).join(NL)
    expect(coloured.replace(new RegExp(String.fromCharCode(27) + '\[[0-9;]*m', 'g'), '')).toContain('estimated time left 1:30')
    expect(coloured.length).toBeGreaterThan(plain.length)
  })
})

describe('the real run: live board, streamed output, end-of-run report', () => {
  const NL = String.fromCharCode(10)
  const mk = () => {
    const out: string[] = []
    return { out, columns: 120, rows: 50, write: (t: string) => out.push(t) }
  }
  test('it uses the alternate screen, shows what each running check prints, and leaves the finished board behind', () => {
    const stream = mk()
    let t = 0
    const tui = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, now: () => t, color: false, tickMs: 3_600_000 })
    expect(stream.out.join('')).toContain(String.fromCharCode(27) + '[?1049h')
    tui.start(checks[1])
    tui.output(checks[1], 'Compiling nv-core v1.1.0' + String.fromCharCode(27) + '[2J')
    t = 4000
    const screen = tui.frame().join(NL)
    expect(screen).toContain('Compiling nv-core v1.1.0')
    expect(screen).not.toContain(String.fromCharCode(27))
    expect(screen).toContain('estimated time left')
    tui.settle(checks[1], { status: 'PASS' }, 4000)
    tui.stop()
    const all = stream.out.join('')
    expect(all).toContain(String.fromCharCode(27) + '[?1049l')
    expect(all).toContain('MEERKAT fast')
    tui.stop() // a second stop is harmless
  })
  test('a narrow terminal gets the compact view, a wide one the board with the head', () => {
    const narrow = { out: [] as string[], columns: 80, rows: 50, write: (x: string) => narrow.out.push(x) }
    const t1 = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: narrow as never, input: { isTTY: false } as never, color: false, tickMs: 3_600_000 })
    expect(t1.frame().join(NL)).not.toContain('TIMELINE')
    t1.stop()
    const wide = mk()
    const t2 = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: wide as never, input: { isTTY: false } as never, color: false, tickMs: 3_600_000 })
    expect(t2.frame().join(NL)).toContain('TIMELINE')
    t2.stop()
  })
  test('runCommand reports the newest line of output as it arrives, and a display problem never stops the check', async () => {
    const lines: string[] = []
    const r = await runCommand({ cmd: 'node', args: ['-e', "console.log('one'); setTimeout(() => console.log('two'), 50)"], timeoutMs: 20_000, onLine: (l: string) => lines.push(l) })
    expect(r.code).toBe(0)
    expect(lines).toContain('two')
    const r2 = await runCommand({ cmd: 'node', args: ['-e', "console.log('x')"], timeoutMs: 20_000, onLine: () => { throw new Error('display broke') } })
    expect(r2.code).toBe(0)
  })
  test('the report repeats only what needs a look: counts, slow ones, failures with the end of their output, NOT RUN reasons', () => {
    const log = join(dir, 'f.log')
    writeFileSync(log, ['a', 'b', 'c'].join(NL) + NL)
    const results = [
      { id: 'a', status: 'PASS', ms: 20_000, detail: '' },
      { id: 'b', status: 'FAIL', ms: 3000, detail: 'boom', outputFile: log },
      { id: 'c', status: 'NOT RUN', ms: 0, detail: 'stopped after the first failure' },
    ]
    const text = finalReport({ results, tier: 'fast', timings: { checks: { a: { fast: [2000] } } }, totalMs: 61_000, env: { MEERKAT_LOG_DIR: dir } }).join(NL)
    expect(text).toContain('SUMMARY [ 1:01 ] 3 checks: 1 passed (1 slow), 1 failed, 1 not run')
    expect(text).toContain('SLOWEST   a 0:20')
    expect(text).toContain('SLOW      a took 0:20, usually 2.0s')
    expect(text).toContain('FAIL      b: boom')
    expect(text).toContain('output: ')
    // the log's lines are not repeated by default: the full log is opened on purpose
    expect(text).not.toContain('| c')
    expect(finalReport({ results, tier: 'fast', timings: { checks: {} }, totalMs: 1000, logTail: 8, env: { MEERKAT_LOG_DIR: dir } }).join(NL)).toContain('| c')
    expect(text).toContain('NOT RUN   c: stopped after the first failure')
    // a passing check shows nothing beyond its slow line
    const clean = finalReport({ results: [{ id: 'a', status: 'PASS', ms: 1000, detail: '' }], tier: 'fast', timings, totalMs: 1000 }).join(NL)
    expect(clean).toContain('1 passed')
    expect(clean).not.toContain('FAIL')
  })
})

describe('a saved-output path is never taken from text, and never read from outside the log folder', () => {
  const NL = String.fromCharCode(10)
  test('the board and the report ignore a path that only appears in a detail line', () => {
    const secret = join(dir, 'secret.txt')
    writeFileSync(secret, 'not for the screen')
    const out: string[] = []
    const stream = { columns: 120, rows: 50, write: (x: string) => out.push(x) }
    const tui = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, color: false, tickMs: 3_600_000, env: { MEERKAT_LOG_DIR: dir } })
    tui.start(checks[1])
    tui.settle(checks[1], { status: 'FAIL', detail: `boom [full output: ${secret}]` }, 1000)
    tui.key('o')
    expect(tui.frame().join(NL)).not.toContain('not for the screen')
    tui.stop()
    const text = finalReport({ results: [{ id: 'b', status: 'FAIL', ms: 1000, detail: `boom [full output: ${secret}]` }], tier: 'fast', timings, totalMs: 1000, env: { MEERKAT_LOG_DIR: dir } }).join(NL)
    expect(text).not.toContain('not for the screen')
    expect(text).not.toContain('output:')
  })
  test('a real field that points outside the log folder is refused too', () => {
    const logs = join(dir, 'logs2')
    mkdirSync(logs)
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, 'outside content')
    const text = finalReport({ results: [{ id: 'b', status: 'FAIL', ms: 1000, detail: 'boom', outputFile: outside }], tier: 'fast', timings, totalMs: 1000, env: { MEERKAT_LOG_DIR: logs } }).join(NL)
    expect(text).not.toContain('outside content')
  })
  test('the runner returns the saved path as its own field', async () => {
    const logs = join(dir, 'logs3')
    mkdirSync(logs)
    const r = await runOne(
      { id: 'x', lane: 'free', run: { cmd: 'node', args: ['-e', 'process.exit(3)'], cwd: 'app' } } as never,
      { repoRoot: dir, appDir: dir, env: { ...process.env, MEERKAT_LOG_DIR: logs }, platform: process.platform, exists: () => true, changedFiles: [] } as never,
    )
    expect(r.status).toBe('FAIL')
    expect((r as any).outputFile).toContain('logs3')
    expect(r.detail).toContain('[full output:')
  })
})

describe('colour level: truecolor, 256 colours, or shades, decided the way image tools do', () => {
  const ESC = String.fromCharCode(27)
  test('NO_COLOR wins, COLORTERM says truecolor, known terminals are trusted, TERM 256color, a modern Windows console', () => {
    expect(colorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' }, 'linux')).toBe(false)
    expect(colorLevel({ COLORTERM: 'truecolor' }, 'linux')).toBe('truecolor')
    expect(colorLevel({ COLORTERM: '24bit' }, 'linux')).toBe('truecolor')
    expect(colorLevel({ WT_SESSION: 'x' }, 'win32')).toBe('truecolor')
    expect(colorLevel({ TERM_PROGRAM: 'vscode' }, 'linux')).toBe('truecolor')
    expect(colorLevel({ TERM: 'xterm-256color' }, 'linux')).toBe('256')
    expect(colorLevel({}, 'win32')).toBe('truecolor')
    expect(colorLevel({}, 'linux')).toBe('256')
  })
  test('the 256-colour mapping uses the colour cube for colours and the grey ramp for greys', () => {
    expect(to256([255, 0, 0])).toBe(196)
    expect(to256([0, 0, 0])).toBe(16)
    expect(to256([255, 255, 255])).toBe(231)
    const grey = to256([128, 128, 128])
    expect(grey).toBeGreaterThanOrEqual(232)
    expect(grey).toBeLessThanOrEqual(255)
  })
  test('the sprite is drawn in each mode: 24-bit codes, 256-colour codes, or plain shades with no escape codes', () => {
    const t = headLines('right', 'truecolor').join('')
    const c = headLines('right', '256').join('')
    const plain = headLines('right', false).join('')
    expect(t).toContain(ESC + '[38;2;')
    expect(t).not.toContain('38;5;')
    expect(c).toContain(ESC + '[38;5;')
    expect(c).not.toContain('38;2;')
    expect(plain).not.toContain(ESC)
    expect(plain).toContain('○') // the eye still shows
  })
})

describe('themes: customisation that can never break a run', () => {
  const ESC = String.fromCharCode(27)
  const NL = String.fromCharCode(10)
  const rows = [{ id: 'b', status: 'RUNNING', lane: 'cargo', startedAt: 0, begunAt: 0, typicalMs: 100_000, expectedMs: 100_000 }]
  const board = (theme: any, tick = 3) => renderLive({ rows, started: 0, now: 30_000, tick, fraction: 0.4, etaMs: 90_000, color: true, width: 110, theme }).join(NL)
  test('colours may be hex or names, anything else is ignored', () => {
    expect(parseColor('#7aa2f7')).toEqual(['rgb', [122, 162, 247]])
    expect(parseColor('green')).toEqual(['sgr', '32'])
    expect(parseColor('32')).toEqual(['sgr', '32'])
    expect(parseColor('not a colour')).toBeNull()
    expect(parseColor(42 as never)).toBeNull()
    expect(sgrFor('#010203', '256')).toMatch(/^38;5;\d+$/)
  })
  test('a theme file tunes the one look; invalid values fall back; a missing or broken file is fine', () => {
    const read = (json: string) => () => json
    const t = loadTheme({ env: {}, readFile: read(JSON.stringify({ spinner: 'line', speed: 2, mascot: false, bar: { ok: '#112233', bad: 'nonsense' }, fur: { M: '#8899bb', Q: 'bad' } })) })
    expect(t.spinner).toBe('line')
    expect(t.speed).toBe(2)
    expect(t.mascot).toBe(false)
    expect(t.bar.ok).toBe('#112233')
    expect(t.bar.bad).toBe(THEMES.meerkat.bar.bad) // the bad value was ignored
    expect(t.fur.M).toBe('#8899bb')
    expect(t.fur.Q).toBeUndefined()
    const broken = loadTheme({ env: {}, readFile: read('{ not json') })
    expect(broken.name).toBe('meerkat')
    expect(Object.keys(THEMES)).toEqual(['meerkat']) // there is one look, no presets
    expect(loadTheme({ env: {}, readFile: read(JSON.stringify({ speed: 99 })) }).speed).toBe(1) // out of range, ignored
  })
  test('the spinner, bar colours and meerkat follow the personal file', () => {
    expect(board(THEMES.meerkat)).toContain('⠸') // frame 3 of the dots spinner
    expect(board({ ...THEMES.meerkat, spinner: 'line' }, 1)).toContain(String.fromCharCode(92))
    expect(board({ ...THEMES.meerkat, bar: { ...THEMES.meerkat.bar, work: '#bb9af7' } })).toContain(ESC + '[38;2;187;154;247m')
    const noMascot = board({ ...THEMES.meerkat, mascot: false })
    expect(noMascot).not.toContain('▀')
    expect(noMascot).toContain('MEERKAT fast')
  })
  test('animation speed scales the ticks: a slower theme changes less from tick to tick', () => {
    const calm = (t: number) => board({ ...THEMES.meerkat, speed: 0.25 }, t)
    expect(calm(0)).toBe(calm(1)) // a quarter speed: tick 1 is still frame 0
    expect(board(THEMES.meerkat, 0)).not.toBe(board(THEMES.meerkat, 1))
  })
  test('the meerkat can be recoloured by the theme', () => {
    const recoloured = furPalette(PALETTE, { M: '#ff0000' })
    expect(recoloured.M).toEqual([255, 0, 0])
    expect(PALETTE.M).not.toEqual([255, 0, 0]) // the original palette is untouched
    expect(headLines('right', 'truecolor', recoloured).join('')).toContain('38;2;255;0;0')
  })
})

describe('the loading screen', () => {
  const NL = String.fromCharCode(10)
  const ESC = String.fromCharCode(27)
  test('it lists real steps with a spinner on the one in progress and a tick on the finished ones', () => {
    const text = renderSplash({ steps: [{ label: 'Loading the checks', state: 'done' }, { label: 'Finding what changed', state: 'doing' }, { label: 'Choosing', state: 'todo' }], tick: 2, color: false, level: false }).join(NL)
    expect(text).toContain('getting ready')
    expect(text).toContain('✔ Loading the checks')
    expect(text).toContain('⠹ Finding what changed')
    expect(text).toContain('· Choosing')
  })
  test('it draws a step at a time, erases itself, and leaves the cursor visible', () => {
    const out: string[] = []
    const splash = createSplash({ stream: { write: (x: string) => out.push(x) } as never, env: {}, color: false })
    splash.step('one')
    splash.step('two')
    splash.finish()
    const all = out.join('')
    expect(all).toContain('one')
    expect(all).toContain('two')
    expect(all.endsWith(ESC + '[?25h')).toBe(true)
    expect(createSplash({ enabled: false }).enabled).toBe(false)
  })
})

describe('the countdown is a simulation of the rest of the run, and the list scrolls', () => {
  const r = (id: string, lane: string, status: string, typicalMs: number, extra: any = {}) => ({ id, lane, status, typicalMs, expectedMs: typicalMs, after: [], ...extra })
  test('a running check counts down by exactly the time that passes', () => {
    const rows = [r('b', 'cargo', 'RUNNING', 100_000, { startedAt: 0 })]
    expect(estimateRemaining(rows, 10_000)).toBe(90_000)
    expect(estimateRemaining(rows, 40_000)).toBe(60_000)
  })
  test('checks in different lanes overlap, checks in one lane queue, and a check waits for what it needs', () => {
    const rows = [
      r('build', 'cargo', 'RUNNING', 100_000, { startedAt: 0 }),
      r('tests', 'free', 'RUNNING', 60_000, { startedAt: 0 }),
      r('clippy', 'cargo', 'WAITING', 50_000),
      r('window', 'electron', 'WAITING', 30_000, { after: ['build'] }),
    ]
    // build ends at 100 s, then clippy (cargo, 50 s) and window (electron, 30 s) run together: 150 s, not 240 s
    expect(estimateRemaining(rows, 0)).toBe(150_000)
  })
  test('a check that overran is assumed to be nearly done, and a dead dependency adds no time', () => {
    const rows = [r('a', 'free', 'RUNNING', 10_000, { startedAt: 0 })]
    const tail = estimateRemaining(rows, 60_000)
    expect(tail).toBeGreaterThan(0)
    expect(tail).toBeLessThan(5000)
    const failed = [r('build', 'cargo', 'FAIL', 1000), r('window', 'electron', 'WAITING', 99_000, { after: ['build'] })]
    expect(estimateRemaining(failed, 0)).toBe(0)
    expect(estimateRemaining([], 0)).toBe(0)
  })
  test('light checks run side by side up to the free slots, then wait', () => {
    const rows = [r('a', 'free', 'WAITING', 10_000), r('b', 'free', 'WAITING', 10_000), r('c', 'free', 'WAITING', 10_000)]
    expect(estimateRemaining(rows, 0, { freeSlots: 3 })).toBe(10_000)
    expect(estimateRemaining(rows, 0, { freeSlots: 1 })).toBe(30_000)
  })
  test('the list scrolls to follow the running checks and says how many are hidden', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i, status: i === 12 ? 'RUNNING' : i < 12 ? 'PASS' : 'WAITING' }))
    const all = windowRows(rows, undefined)
    expect(all.rows).toHaveLength(20)
    const v = windowRows(rows, 8)
    expect(v.rows.length).toBeLessThanOrEqual(8)
    expect(v.rows.some((x: any) => x.status === 'RUNNING')).toBe(true)
    expect(v.above + v.rows.length + v.below).toBe(20)
    expect(v.above).toBeGreaterThan(0)
  })
  test('on a short screen the board fits and shows the hidden counts', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: 'check-' + i, lane: 'free', status: i === 20 ? 'RUNNING' : i < 20 ? 'PASS' : 'WAITING', ms: 1000, begunAt: 0, endedAt: 1000, startedAt: i === 20 ? 0 : null, typicalMs: 5000, expectedMs: 5000, after: [] }))
    const text = renderLive({ rows, started: 0, now: 3000, tick: 1, fraction: 0.5, etaMs: 10_000, color: false, width: 110, height: 40, grouped: false }).join(String.fromCharCode(10))
    expect(text).toMatch(/↑ \d+ more above/)
    expect(text.split(String.fromCharCode(10)).length).toBeLessThanOrEqual(40)
  })
})
