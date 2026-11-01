// The results screen: pure drawing at several sizes, every check shown once, colours and words, the key table, the terminal loop with a
// fake terminal and clipboard, the plain output of a non-terminal run (unchanged), and the board fixes (slower than usual, group strip).
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { FOOTER, SEVERITY_ORDER, axisLines, buildResultsData, compactSummary, concurrency, initialResultsState, renderResults, resultsStep, severityCode, tickLabel, tickStep, timelineRows, visibleChecks, visibleFindings } from './results.mjs'
import { runResultsScreen } from './resultsapp.mjs'
import { bulkSampleData as sampleData } from './resultssample.mjs'
import { stripAnsi } from './cells.mjs'
import { fitGroups, renderLive } from './live.mjs'
import { createModel, isSlow } from './model.mjs'
import { groupRows } from './group.mjs'
// @ts-expect-error plain JS module
import { parseKeys } from '../menu.mjs'
// @ts-expect-error plain JS module
import { saveNotRunLogs } from '../runlog.mjs'

const data = sampleData()
const draw = (over: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => renderResults({ ...initialResultsState(), ...over } as never, data, { width: 110, rows: 40, color: true, level: 'truecolor', env: {}, ...o } as never)
const text = (lines: string[]) => lines.map(stripAnsi).join('\n')

describe('severity colours', () => {
  test('critical red, high orange (bold yellow without 256 colours), medium yellow, low and info white', () => {
    expect(severityCode('critical')).toBe('31')
    expect(severityCode('high', 'truecolor')).toBe('38;5;208')
    expect(severityCode('high', false)).toBe('1;33')
    expect(severityCode('medium')).toBe('33')
    expect(['97', '37']).toContain(severityCode('low'))
    expect(severityCode('info')).toBe('37')
  })
  test('findings are listed worst first', () => {
    const order = visibleFindings(data, initialResultsState() as never).map((f: { severity: string }) => SEVERITY_ORDER.indexOf(f.severity))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
  test('the legend and the words are on screen, and without colour there are no escape codes', () => {
    const t = text(draw())
    expect(t).toContain('critical = fix before shipping   high = fix soon   medium = should fix   low, info = worth knowing')
    expect(draw({}, { color: false, level: false }).join('')).not.toContain('\x1b')
    expect(text(draw({}, { color: false, level: false }))).toContain('CRITICAL')
  })
})

describe('drawing', () => {
  for (const tab of ['findings', 'checks', 'timeline']) {
    for (const [width, rows] of [[60, 20], [80, 24], [110, 40], [140, 50]]) {
      test(`${tab} at ${width}x${rows}: fits the window, no control characters, footer last`, () => {
        const lines = draw({ tab }, { width, rows })
        expect(lines.length).toBeLessThanOrEqual(rows - 1)
        for (const l of lines) {
          const plain = stripAnsi(l)
          expect(plain.length).toBeLessThanOrEqual(width)
          expect(plain).not.toMatch(/[\u0000-\u001f\u007f]/)
        }
        expect(stripAnsi(lines[lines.length - 1])).toContain('Tab sections')
      })
    }
  }
  test('the footer is the agreed one-line text', () => {
    expect(FOOTER.startsWith('Tab sections  Up/Down  Enter details  c copy findings folder  p  create a prompt for an AI  l log  r run again  m menu  q done')).toBe(true)
  })
  test('CHECKS shows every check exactly once, nothing hidden (154 ran, plus the skipped ones)', () => {
    const t = text(draw({ tab: 'checks' }, { rows: 400, width: 140 }))
    for (const c of data.checks) expect(t.match(new RegExp(`${c.id}(?![0-9a-z-])`, 'g'))?.length, c.id).toBe(1)
    expect(data.checks.length).toBe(157)
    expect(t).toContain('SKIPPED')
    expect(t).toContain('NOT RUN')
  })
  test('TIMELINE contains every check exactly once, with an axis and a running row', () => {
    const t = text(draw({ tab: 'timeline' }, { rows: 400, width: 140 }))
    for (const c of data.checks) expect(t.match(new RegExp(`${c.id}(?![0-9a-z-])`, 'g'))?.length, c.id).toBe(1)
    expect(t).toMatch(/running \(max \d+\)/)
    expect(t).toMatch(/0s\s+1s/)
  })
  test('scrolling: the window follows the cursor and says which rows are shown', () => {
    const t = text(draw({ tab: 'checks', cursor: { findings: 0, checks: 150, timeline: 0 } }, { rows: 30 }))
    expect(t).toMatch(/rows \d+-\d+ of 157/)
    expect(t).toContain(visibleChecks(data, { status: 'all' } as never)[150].id)
  })
  test('every finding opens a full detail with who found it, the log and the fix', () => {
    const f = data.findings[1]
    const t = text(draw({ detail: { kind: 'finding', id: f.id, scroll: 0 } }))
    for (const word of ['what', 'where', 'rule', 'check', 'log', 'fix', 'first seen']) expect(t).toContain(word)
  })
  test('a check detail names the command, the reason, the log and its findings', () => {
    const t = text(draw({ tab: 'checks', detail: { kind: 'check', id: 'check-003', scroll: 0 } }))
    expect(t).toContain('node thorough/sample.mjs check-003')
    expect(t).toContain('findings')
    expect(t).toContain('log')
  })
})

describe('the time axis', () => {
  test('a run under a second gets 0.1 s ticks; longer runs get round steps that fit', () => {
    expect(tickStep(500, 80)).toBe(100)
    expect(tickLabel(100, 100)).toBe('0.1s')
    expect(tickStep(5000, 80)).toBe(1000)
    expect(tickStep(600_000, 80)).toBeGreaterThanOrEqual(60_000)
    const a = axisLines(4800, 60)
    expect(a.labels.length).toBe(60)
    expect(a.rule).toContain('┼')
  })
  test('concurrency counts overlapping checks', () => {
    const c = concurrency([{ start: 0, end: 500 }, { start: 100, end: 600 }, { start: 800, end: 900 }] as never, 1000, 10)
    expect(c.peak).toBe(2)
    expect(c.per[2]).toBe(2)
    expect(c.per[7]).toBe(0)
  })
  test('rows are sorted by start time', () => {
    const starts = timelineRows(data).map((c: { start: number | null }) => c.start ?? Infinity)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('keys', () => {
  const step = (s: ReturnType<typeof initialResultsState>, k: string) => resultsStep(s, k, data)
  test('Tab, Left/Right and 1 2 3 switch the section', () => {
    let s = initialResultsState()
    s = step(s, 'tab').state
    expect(s.tab).toBe('checks')
    s = step(s, 'right').state
    expect(s.tab).toBe('timeline')
    s = step(s, 'left').state
    expect(s.tab).toBe('checks')
    expect(step(s, '1').state.tab).toBe('findings')
    expect(step(s, 'shift-tab').state.tab).toBe('findings')
  })
  test('f cycles the severity filter, s the status filter', () => {
    let s = initialResultsState()
    const seen = [s.sev]
    for (let i = 0; i < 7; i++) seen.push((s = step(s, 'f').state).sev)
    expect(seen.slice(0, 3)).toEqual(['all', 'critical', 'high'])
    expect(seen[7]).toBe('all')
    s = { ...initialResultsState(), tab: 'checks' }
    expect(step(s, 's').state.status).toBe('problems')
  })
})
