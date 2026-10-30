// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The Meerkat terminal UI: a fake run (no real check, no real terminal), so it is fast and safe to run anywhere.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appendRun, loadHistory, runEntry } from './history.mjs'
import { canUseUi, createTui, tailOf } from './index.mjs'
import { applyFilter, createModel, initialState, nextState, outputFileFrom, typicalMs } from './model.mjs'
import { renderHistory, renderRows, sparkline } from './render.mjs'
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
