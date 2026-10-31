// Grouping of a long check list: the pure function, the board, the toggle key, the run option and the end-of-run report.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { countsText, groupResults, groupRows, labelOf, packOf, segmentCells, shouldGroup, toneOf } from './group.mjs'
import { createTui } from './index.mjs'
import { renderLive } from './live.mjs'
import { createModel, nextState, initialState } from './model.mjs'
import { parseArgs } from '../../run.mjs'
import { finalReport } from '../report.mjs'
import { writeRunReport } from '../runlog.mjs'
import { table } from '../runner.mjs'
import { spansFromRecorder } from './group.mjs'

type Row = { id: string; status: string; group: string; pack?: string | null; elapsedMs?: number; [k: string]: unknown }
const mk = (n: number, group: string, pack: string | null = null, status = 'PASS', prefix = group): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${pack ?? 'x'}-${i}`, status, group, pack, elapsedMs: 1000 }))

describe('groupRows (pure)', () => {
  test('nothing is grouped at 24 checks or fewer, grouping starts at 25', () => {
    expect(groupRows(mk(24, 'security'))).toBeNull()
    expect(groupRows(mk(25, 'security'))).not.toBeNull()
    expect(shouldGroup(24, {})).toBe(false)
    expect(shouldGroup(25, {})).toBe(true)
    expect(groupRows(mk(3, 'ui'), { grouped: true })).toHaveLength(1)
    expect(groupRows(mk(300, 'ui'), { grouped: false })).toBeNull()
  })

  test('counts, time and tone per category', () => {
    const rows = [...mk(10, 'security'), ...mk(2, 'security', null, 'FAIL', 'bad'), ...mk(3, 'ui', null, 'RUNNING'), ...mk(2, 'ui', null, 'WAITING', 'w'), ...mk(15, 'performance')]
    const cats = groupRows(rows)!
    const sec = cats.find((c: { group: string }) => c.group === 'security')!
    expect(sec.total).toBe(12)
    expect(sec.counts).toMatchObject({ PASS: 10, FAIL: 2, RUNNING: 0, WAITING: 0 })
    expect(sec.ms).toBe(12_000)
    expect(sec.tone).toBe('FAIL')
    expect(cats.find((c: { group: string }) => c.group === 'ui')!.tone).toBe('RUNNING')
    expect(cats.find((c: { group: string }) => c.group === 'performance')!.tone).toBe('PASS')
    expect(toneOf({ PASS: 1, FAIL: 0, 'NOT RUN': 1, RUNNING: 5, WAITING: 0 }, 7)).toBe('NOT RUN')
    expect(toneOf({ PASS: 0, FAIL: 0, 'NOT RUN': 0, RUNNING: 0, WAITING: 4 }, 4)).toBe('WAITING')
    expect(countsText({ PASS: 28, FAIL: 1, 'NOT RUN': 0, RUNNING: 0, WAITING: 3 })).toBe('28 passed  1 failed  0 running  3 waiting')
  })

  test('failed, not-run and running checks are never folded away; passed ones are', () => {
    const rows = [...mk(30, 'functionality'), { id: 'z-fail', status: 'FAIL', group: 'functionality' }, { id: 'a-nr', status: 'NOT RUN', group: 'functionality' }, { id: 'm-run', status: 'RUNNING', group: 'functionality' }, { id: 'q-wait', status: 'WAITING', group: 'functionality' }]
    const [cat] = groupRows(rows)!
    expect(cat.open.map((r: Row) => r.id)).toEqual(['z-fail', 'a-nr', 'm-run'])
    expect(cat.open.some((r: Row) => r.status === 'PASS')).toBe(false)
    // every problem check of the run shows up in some category's open list
    const all = groupRows(rows)!.flatMap((c: { open: Row[] }) => c.open)
    for (const r of rows.filter((x) => ['FAIL', 'NOT RUN', 'RUNNING'].includes(x.status))) expect(all).toContainEqual(r)
  })

  test('ordering: failing categories first, then not run, then running, then by name', () => {
    const rows = [...mk(5, 'ui'), ...mk(5, 'refactor', null, 'RUNNING'), ...mk(5, 'security'), ...mk(5, 'performance', null, 'FAIL'), ...mk(5, 'functionality', null, 'NOT RUN')]
    const order = groupRows(rows)!.map((c: { group: string }) => c.group)
    expect(order).toEqual(['performance', 'functionality', 'refactor', 'security', 'ui'])
  })

  test('a kind with more than 40 checks splits by pack, with a readable label; 40 or fewer does not', () => {
    const big = [...mk(20, 'functionality', 'quality'), ...mk(15, 'functionality', 'security-plus'), ...mk(7, 'functionality', null)]
    const labels = groupRows(big)!.map((c: { label: string }) => c.label).sort()
    expect(labels).toEqual(['Functionality: core', 'Functionality: quality', 'Functionality: security plus'])
    const exactly40 = [...mk(20, 'functionality', 'quality'), ...mk(20, 'functionality', 'node')]
    expect(groupRows(exactly40)!.map((c: { label: string }) => c.label)).toEqual(['Functionality'])
    // a pack read from a check's source text
    const bySource = Array.from({ length: 45 }, (_, i) => ({ id: `s${i}`, status: 'PASS', group: 'security', source: i < 30 ? 'pack security' : 'pack ai' }))
    expect(groupRows(bySource)!.map((c: { label: string }) => c.label).sort()).toEqual(['Security: ai', 'Security: security'])
    expect(packOf('pack web-plus')).toBe('web-plus')
    expect(packOf('/some/file.mjs')).toBeNull()
    expect(labelOf('ui')).toBe('UI')
  })

  test('the bar always shows a lone failure and always has the width asked for', () => {
    const cells = segmentCells({ PASS: 199, FAIL: 1, 'NOT RUN': 0, RUNNING: 0, WAITING: 0 }, 12)
    expect(Object.fromEntries(cells).FAIL).toBe(1)
    expect(cells.reduce((n: number, [, k]: [string, number]) => n + k, 0)).toBe(12)
  })
})

// A model with `n` checks, so the board can be drawn in both layouts.
const board = (n: number, grouped?: boolean, mutate?: (m: ReturnType<typeof createModel>, checks: unknown[]) => void) => {
  const groups = ['security', 'functionality', 'ui', 'performance', 'refactor']
  const checks = Array.from({ length: n }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: groups[i % 5], source: 'built in', estSeconds: 1 }))
  const model = createModel({ checks: checks as never })
  for (const c of checks) {
    model.start(c as never, 0)
    model.settle(c as never, { status: 'PASS' }, 1000)
  }
  mutate?.(model, checks)
  const rows = model.snapshot(5000)
  return renderLive({ rows, events: [], started: 0, now: 5000, tick: 3, fraction: 0.5, etaMs: 1000, width: 110, color: false, grouped }).join('\n')
}

describe('the board', () => {
  test('24 checks: one row per check, exactly as before', () => {
    const out = board(24)
    expect(out).toContain('check-23')
    expect(out).not.toContain('checks in')
  })
  test('more than 24: one line per kind, the passed checks are folded', () => {
    const out = board(60)
    expect(out).toContain('60 checks in 5 groups')
    expect(out).toContain('Security')
    expect(out).toContain('12 passed 0 failed')
    expect(out).not.toContain('check-17')
    expect(out).toContain('PASSED')
  })
  test('a failed check stays visible under its open category, a running one too', () => {
    const out = board(60, undefined, (m, checks) => {
      m.settle(checks[7] as never, { status: 'FAIL', detail: 'boom here' }, 100)
      m.start(checks[11] as never, 4000)
    })
    expect(out).toContain('FAILED')
    expect(out).toContain('check-7')
    expect(out).toContain('boom here')
    expect(out).toContain('check-11')
    expect(out).not.toContain('check-3 ')
  })
  test('flat is every check; grouped true folds even a short list; the height cap says how many lines are left', () => {
    expect(board(60, false)).toContain('check-59')
    expect(board(60, false)).not.toContain('checks in')
    expect(board(8, true)).toContain('8 checks in 5 groups')
    const groups = ['security', 'functionality', 'ui', 'performance', 'refactor']
    const checks = Array.from({ length: 30 }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: groups[i % 5], source: 'built in', estSeconds: 1 }))
    const model = createModel({ checks: checks as never })
    for (const c of checks) model.settle(c as never, { status: 'FAIL', detail: 'x' }, 1)
    const lines = renderLive({ rows: model.snapshot(5000), events: [], started: 0, now: 5000, tick: 0, fraction: 0.5, width: 110, height: 40, color: false }).join('\n')
    expect(lines).toMatch(/more in this group|more groups?:/)
  })
  test('the toggle key: g flips between groups and every check, on the live board and in the pure key table', () => {
    const stream = { out: [] as string[], columns: 110, rows: 80, write: (x: string) => stream.out.push(x) }
    const groups = ['security', 'functionality', 'ui', 'performance', 'refactor']
    const checks = Array.from({ length: 30 }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: groups[i % 5], source: 'built in', estSeconds: 1 }))
    const tui = createTui({ title: 'MEERKAT fast', checks: checks as never, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, now: () => 0, color: false, tickMs: 3_600_000 })
    expect(tui.frame().join('\n')).toContain('30 checks in 5 groups')
    expect(tui.frame().join('\n')).toContain('g groups or every check')
    tui.key('g')
    expect(tui.frame().join('\n')).toContain('check-29')
    expect(tui.frame().join('\n')).not.toContain('30 checks in 5 groups')
    tui.key('g')
    expect(tui.frame().join('\n')).toContain('30 checks in 5 groups')
    tui.stop()
    expect(nextState(initialState(), 'g', { rowCount: 5 }).grouped).toBe(false)
    expect(nextState({ ...initialState(), grouped: false }, 'g', { rowCount: 5 }).grouped).toBe(true)
  })
  test('--flat and --grouped are run options', () => {
    expect(parseArgs(['--flat']).grouped).toBe(false)
    expect(parseArgs(['--grouped']).grouped).toBe(true)
    expect(parseArgs([]).grouped).toBeUndefined()
    expect(parseArgs(['--flat']).errors).toEqual([])
  })
  test('--flat in createTui keeps the per-check list for a long run', () => {
    const stream = { out: [] as string[], columns: 110, rows: 80, write: (x: string) => stream.out.push(x) }
    const checks = Array.from({ length: 30 }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: 'security', source: 'built in', estSeconds: 1 }))
    const tui = createTui({ title: 'MEERKAT fast', checks: checks as never, tier: 'fast', stream: stream as never, input: { isTTY: false } as never, now: () => 0, color: false, tickMs: 3_600_000, grouped: false })
    expect(tui.frame().join('\n')).toContain('check-29')
    tui.stop()
  })
})

describe('the end-of-run report', () => {
  const groups = ['security', 'functionality', 'ui', 'performance', 'refactor']
  const checks = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, group: groups[i % 5], source: 'built in' }))
  const results = checks.map((c, i) => ({ id: c.id, title: c.id, status: i === 3 ? 'FAIL' : i === 9 ? 'NOT RUN' : 'PASS', detail: i === 3 ? 'broke' : i === 9 ? 'missing tool' : '', ms: 1000 + i }))
  test('more than 24 checks: one KIND line per category, FAIL and NOT RUN lines stay individual', () => {
    const lines = finalReport({ results, tier: 'fast', totalMs: 5000, checks })
    expect(lines.filter((l) => l.startsWith('KIND'))).toHaveLength(5)
    expect(lines.find((l) => l.startsWith('KIND') && l.includes('Performance'))).toContain('8 checks')
    expect(lines.some((l) => l.startsWith('FAIL      c3: broke'))).toBe(true)
    expect(lines.some((l) => l.startsWith('NOT RUN   c9: missing tool'))).toBe(true)
  })
  test('24 checks or fewer, --flat, and results with no check list: no KIND lines', () => {
    expect(finalReport({ results: results.slice(0, 24), tier: 'fast', totalMs: 1, checks }).some((l) => l.startsWith('KIND'))).toBe(false)
    expect(finalReport({ results, tier: 'fast', totalMs: 1, checks, grouped: false }).some((l) => l.startsWith('KIND'))).toBe(false)
    expect(finalReport({ results, tier: 'fast', totalMs: 1, grouped: true }).some((l) => l.startsWith('KIND'))).toBe(true)
  })
  test('grouping is display only: results are untouched and the saved files still list every check', () => {
    const before = JSON.stringify(results)
    finalReport({ results, tier: 'fast', totalMs: 5000, checks })
    expect(JSON.stringify(results)).toBe(before)
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-group-'))
    try {
      writeRunReport({ dir, tier: 'fast', results, line: 'MEERKAT fast: 38 passed', exitCode: 1, ms: 5000, argv: [], env: {}, version: 't', selection: null, scheduler: null, git: null, startedAtMs: 0 } as never)
      const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /report\.md$|summary\.json$/.test(f))
      expect(files.length).toBe(2)
      for (const f of files) {
        const text = readFileSync(join(dir, f), 'utf8')
        for (const r of results) expect(text).toContain(r.id)
        expect(text).not.toContain('KIND      ')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the end list, and the time of a category', () => {
  const groups = ['security', 'functionality', 'ui']
  const checks = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, group: groups[i % 3], source: 'built in' }))
  const results = checks.map((c, i) => ({ id: c.id, status: i === 4 ? 'FAIL' : i === 8 ? 'NOT RUN' : 'PASS', detail: i === 4 ? 'broke' : '', ms: 2000 }))
  test('table folds above 24 checks, keeps FAIL and NOT RUN lines, and --flat restores every line', () => {
    const t = table(results as never, { checks })
    expect(t.split(String.fromCharCode(10)).length).toBeLessThan(10)
    expect(t).toContain('c4')
    expect(t).toContain('broke')
    expect(t).toContain('c8')
    expect(t).not.toContain('c11 ')
    expect(table(results as never, { checks, grouped: false }).split(String.fromCharCode(10))).toHaveLength(30)
    expect(table(results.slice(0, 24) as never, { checks }).split(String.fromCharCode(10))).toHaveLength(24)
  })
  test('a category time is the wall-clock span when start and end times are known, else a labelled sum', () => {
    const rec = { events: checks.flatMap((c, i) => [{ t: 1000 + i * 100, event: 'start', id: c.id }, { t: 1000 + i * 100 + 2000, event: 'end', id: c.id }]) }
    const spans = spansFromRecorder(rec)
    const cats = groupResults(results, { checks, spans })!
    expect(cats[0].timeKind).toBe('span')
    // ten checks per kind, each 2000 ms long, all running at overlapping times: the span is far below the 20000 ms sum
    expect(Math.max(...cats.map((c: { ms: number }) => c.ms))).toBeLessThan(20_000)
    expect(groupResults(results, { checks })![0].timeKind).toBe('sum')
    expect(table(results as never, { checks })).toContain('sum ')
    expect(table(results as never, { checks, spans })).not.toContain('sum ')
  })
})
