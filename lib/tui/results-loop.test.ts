// The results screen, part 2: the key table in detail, the terminal loop with a fake terminal and clipboard, the end of a run in a
// terminal, the plain output of a run with no terminal (unchanged), and the board fixes (slower than usual, estimate text, group strip).
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { compactSummary, initialResultsState, resultsStep, visibleChecks } from './results.mjs'
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
const step = (s: ReturnType<typeof initialResultsState>, k: string) => resultsStep(s, k, data)

describe('keys', () => {
  test('the status filter keeps only what needs a look', () => {
    const s = { ...initialResultsState(), tab: 'checks' }
    expect(step(s, 's').state.status).toBe('problems')
    expect(visibleChecks(data, { status: 'problems' } as never).every((c: { status: string }) => c.status === 'FAIL' || c.status === 'NOT RUN')).toBe(true)
    expect(visibleChecks(data, { status: 'passed' } as never).length).toBe(116)
  })
  test('Enter opens a detail, Esc closes it, Up/Down move within the list and stop at the ends', () => {
    let s = initialResultsState()
    s = step(s, 'down').state
    expect(s.cursor.findings).toBe(1)
    s = step(s, 'enter').state
    expect(s.detail?.kind).toBe('finding')
    expect(step(s, 'escape').state.detail).toBeNull()
    expect(step(initialResultsState(), 'up').state.cursor.findings).toBe(0)
  })
  test('c copies the findings folder, l shows a log, r runs again, m menu, q done', () => {
    const s = initialResultsState()
    expect(step(s, 'c').action).toEqual({ type: 'copyFolder' })
    expect(step(s, 'l').action?.type).toBe('log')
    expect(step(s, 'r').action).toEqual({ type: 'again' })
    expect(step(s, 'm').action).toEqual({ type: 'menu' })
    expect(step(s, 'q').action).toEqual({ type: 'done' })
    expect(step(s, 'ctrl-c').action).toEqual({ type: 'done' })
  })
  test('in a check detail c copies that check\'s log path', () => {
    const s = { ...initialResultsState(), tab: 'checks', detail: { kind: 'check', id: 'check-003', scroll: 0 } }
    expect(step(s as never, 'c').action).toEqual({ type: 'copyLog', id: 'check-003' })
    expect(step(s as never, 'l').action).toEqual({ type: 'log', id: 'check-003' })
  })
  test('the real key parser knows Tab, Shift+Tab and the page keys', () => {
    expect(parseKeys('\t\x1b[Z\x1b[5~\x1b[6~')).toEqual(['tab', 'shift-tab', 'pgup', 'pgdn'])
  })
})

describe('the terminal loop', () => {
  function fakeTerm() {
    const stdin: any = new EventEmitter()
    stdin.isTTY = true
    stdin.setRawMode = () => {}
    stdin.resume = () => {}
    stdin.pause = () => {}
    const out: string[] = []
    const stdout: any = new EventEmitter()
    stdout.isTTY = true
    stdout.columns = 110
    stdout.rows = 40
    stdout.write = (x: string) => out.push(x)
    return { stdin, stdout, out }
  }
  const deps = (copied: string[], ok = true) => ({ parseKeys, copyText: (t: string) => (copied.push(t), ok), showWhy: (id: string) => ({ text: `LOG ${id}` }), showLast: () => ({ text: 'REPORT' }), repoChangesText: () => 'CHANGES' })
  test('c copies the findings folder path and says it was created; q leaves the screen clean', async () => {
    const { stdin, stdout, out } = fakeTerm()
    const copied: string[] = []
    const done = runResultsScreen({ data, stdin, stdout, env: {}, deps: deps(copied), exists: () => true })
    stdin.emit('data', 'c')
    stdin.emit('data', 'q')
    expect(await done).toBe('done')
    expect(copied).toEqual([data.runDir])
    const all = out.join('')
    expect(all).toContain('Findings folder created')
    expect(all).toContain('Findings written to')
    expect(all.startsWith('\x1b[?1049h')).toBe(true)
    expect(all.endsWith('\x1b[?25h\x1b[?1049l')).toBe(true)
  })
  test('without a clipboard tool the path is printed instead', async () => {
    const { stdin, stdout, out } = fakeTerm()
    const done = runResultsScreen({ data, stdin, stdout, env: {}, deps: deps([], false), exists: () => true })
    stdin.emit('data', 'c')
    stdin.emit('data', '\x03')
    await done
    expect(out.join('')).toContain('no clipboard tool found')
  })
  test('l opens the log text and Esc closes it; r and m return their result', async () => {
    const t1 = fakeTerm()
    const d1 = runResultsScreen({ data, stdin: t1.stdin, stdout: t1.stdout, env: {}, deps: deps([]), exists: () => true })
    t1.stdin.emit('data', 'l')
    expect(t1.out.join('')).toContain('LOG ')
    t1.stdin.emit('data', '\x1b')
    t1.stdin.emit('data', 'm')
    expect(await d1).toBe('menu')
    const t2 = fakeTerm()
    const d2 = runResultsScreen({ data, stdin: t2.stdin, stdout: t2.stdout, env: {}, deps: deps([]), exists: () => true })
    t2.stdin.emit('data', 'r')
    expect(await d2).toBe('again')
  })
})

describe('the end of a run in a terminal', () => {
  test('the compact summary is a count line and the findings folder, and says it was created', () => {
    const lines = compactSummary({ label: 'full', results: data.checks as never, ms: 4800, findings: data.findingCounts as never, dir: 'C:/x/run' })
    expect(lines[0]).toMatch(/^MEERKAT full {2}157 checks: 116 passed, 26 failed, 12 not run in 4\.8s {3}findings: 7 critical/)
    expect(lines[1]).toBe('Findings folder created: C:/x/run')
    expect(lines.length).toBe(2)
  })
  test('a NOT RUN check gets a short log that says why', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mk-nr-'))
    try {
      const out = saveNotRunLogs(dir, [{ id: 'typos', status: 'NOT RUN', detail: 'missing on PATH: typos', ms: 22 }, { id: 'a', status: 'PASS' }], [])
      expect(out[0].logFile).toContain('typos.log')
      expect(out[1].logFile).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('a run with no terminal prints the plain lines as before: the table, SUMMARY, the result line, no screens', () => {
    const app = mkdtempSync(join(tmpdir(), 'mk-app-'))
    const logs = mkdtempSync(join(tmpdir(), 'mk-logs-'))
    try {
      mkdirSync(join(app, 'src'))
      writeFileSync(join(app, 'package.json'), '{"name":"x","version":"1.0.0"}')
      writeFileSync(join(app, 'data.json'), '{}')
      const out = execFileSync(process.execPath, [join(__dirname, '..', '..', 'run.mjs'), '--app', app, '--no-config', '--only', 'json-valid', '--all'], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_PLAIN: '1', CI: '1' } })
      expect(out).toMatch(/^(PASS|FAIL|NOT RUN)/m)
      expect(out).toContain('SUMMARY')
      expect(out).toMatch(/MEERKAT fast: \d+ passed/)
      expect(out).toContain('logs: ')
      expect(out).not.toContain('Findings folder created')
      expect(out).not.toContain('\x1b[?1049')
    } finally {
      rmSync(app, { recursive: true, force: true })
      rmSync(logs, { recursive: true, force: true })
    }
  })
})

describe('the live board fixes', () => {
  test('slower than usual: only when the typical time is from this project, over 3x and over 2 s', () => {
    expect(isSlow({ spent: 9000, typicalMs: 2000, typicalHere: true })).toBe(true)
    expect(isSlow({ spent: 9000, typicalMs: 2000, typicalHere: false })).toBe(false)
    expect(isSlow({ spent: 5000, typicalMs: 2000, typicalHere: true })).toBe(false)
    expect(isSlow({ spent: 1900, typicalMs: 100, typicalHere: true })).toBe(false)
    expect(isSlow({ spent: 9000, typicalMs: null, typicalHere: true })).toBe(false)
    const m = createModel({ checks: [{ id: 'a', lane: 'free', estSeconds: 1 }] as never, timings: { checks: { a: { fast: [1000] } } }, tier: 'fast', typicalHere: false })
    m.start({ id: 'a' } as never, 0)
    expect(m.snapshot(60_000)[0].slow).toBe(false)
  })
  test('the header says what the percentage is of, and "estimating..." when no time was measured', () => {
    const rows = [{ id: 'a', lane: 'free', status: 'RUNNING', startedAt: 0, typicalMs: null, expectedMs: 1000 }]
    const t = renderLive({ rows: rows as never, events: [], started: 0, now: 1000, tick: 0, fraction: 0.02, etaMs: null, width: 120, color: false }).map(stripAnsi).join('\n')
    expect(t).toContain('2% of estimated time')
    expect(t).toContain('0/1 checks done')
    // a named running check with no measured time: the label names it instead of "estimating..."
    expect(t).toContain('time left: unknown (no timing recorded for a yet)')
    expect(t).not.toContain('estimating...')
  })
  test('when groups do not fit, the rest become a status strip, never only a line count', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, status: i < 3 ? 'FAIL' : 'PASS', suite: `suite-${i % 20}`, begunAt: 0, endedAt: 10, ms: 10 }))
    const cats = groupRows(rows as never, { grouped: true })!
    const c = (_k: string, t: string) => t
    const lines = fitGroups(cats, 8, { rowCtx: { now: 100, started: 0, tick: 0, color: false, width: 110, c }, catCtx: { color: false, width: 110, started: 0, now: 100, tick: 0 }, c } as never)
    expect(lines.length).toBeLessThanOrEqual(8)
    expect(lines.join('\n')).toMatch(/\+\d+ more groups?: .*passed.*\(g toggles\)/)
    expect(lines.join('\n')).not.toMatch(/and \d+ more lines/)
  })
})
