// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

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
import { knownStatus, safeLogPath, stripControl } from './safe.mjs'
import { parseArgs } from '../../run.mjs'

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
    expect(m.snapshot(1000 + 90000 * 1.6).find((r) => r.id === 'b')?.slow).toBe(true)
    m.settle(checks[1], { status: 'FAIL', detail: 'boom  [full output: C:/tmp/b.log]' }, 5000)
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
    const tui = createTui({ title: 'MEERKAT fast', checks, timings, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, now: () => t, color: false, tickMs: 3_600_000 })
    tui.start(checks[1])
    t = 5000
    tui.settle(checks[1], { status: 'FAIL', detail: `boom  [full output: ${log}]` }, 5000)
    tui.key('down')
    tui.key('enter')
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
    expect(canUseUi({ isTTY: true, env: { NV_VERIFY_PLAIN: '1' } })).toBe(false)
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
    const env = { NV_VERIFY_LOG_DIR: logs }
    expect(safeLogPath(inside, { env })).not.toBeNull()
    expect(safeLogPath(outside, { env })).toBeNull()
    expect(safeLogPath(join(logs, '..', 'secret.txt'), { env })).toBeNull()
    expect(safeLogPath('//server/share/x.log', { env })).toBeNull()
    expect(safeLogPath('//./pipe/x', { env })).toBeNull()
    expect(safeLogPath(join(logs, 'missing.log'), { env })).toBeNull()
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
