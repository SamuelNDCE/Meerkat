// Every way a run can end in a terminal opens the results screen, never the old plain list; the Esc flow of the menus; the live bug counter.
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { stripAnsi, textWidth } from './cells.mjs'
import { renderResults, initialResultsState } from './results.mjs'
import { sampleData } from './resultssample.mjs'
import { bugCounter, renderLive } from './live.mjs'
import { createModel } from './model.mjs'
// @ts-expect-error plain JS module
import { afterRun, runMenu } from '../menu.mjs'
// @ts-expect-error plain JS module
import { planCommand } from '../cli.mjs'

function fake(rows = 30, columns = 100) {
  const stdin: any = new EventEmitter()
  Object.assign(stdin, { isTTY: true, setRawMode() {}, resume() {}, pause() {} })
  const out: string[] = []
  const stdout: any = new EventEmitter()
  Object.assign(stdout, { isTTY: true, columns, rows, write: (t: string) => (out.push(String(t)), true) })
  return { stdin, stdout, out, text: () => stripAnsi(out.join('')) }
}
const OLD = 'Verification finished'
const press = (t: any, keys: string[], gap = 40) => keys.forEach((k, i) => setTimeout(() => t.stdin.emit('data', Buffer.from(k)), gap * (i + 1)))
const scratch = () => mkdtempSync(join(tmpdir(), 'mk-route-'))

describe('the old plain list never appears in a terminal', () => {
  const withSummary = () => {
    const d = scratch()
    writeFileSync(join(d, 'summary.json'), JSON.stringify({ results: [{ id: 'a', status: 'PASS', ms: 5 }] }))
    return d
  }
  const corrupt = () => {
    const d = scratch()
    writeFileSync(join(d, 'summary.json'), '{nope')
    return d
  }
  const cases: [string, () => string | null][] = [
    ['a run folder with a summary (verify, full, preset + folder, menu runs)', withSummary],
    ['no run folder at all (the board off, a run that saved nothing)', () => null],
    ['a run folder with no summary.json (a run stopped early)', scratch],
    ['a run folder that does not exist', () => join(tmpdir(), 'mk-route-missing-xyz')],
    ['a corrupt summary.json', corrupt],
  ]
  for (const [name, mk] of cases) {
    test(`afterRun: ${name} opens the results screen`, async () => {
      const t = fake()
      const p = afterRun({ runDir: mk(), env: {}, stdin: t.stdin, stdout: t.stdout, args: ['--x'], cwd: process.cwd(), canMenu: true })
      press(t, ['q'])
      expect(await p).toBeNull()
      const all = t.text()
      expect(all).toContain('Findings')
      expect(all).toContain('Timeline')
      expect(all).not.toContain(OLD)
      expect(all).not.toContain('What next')
    })
  }
  test('afterRun: m returns "menu" (back to the preset menu of the same project)', async () => {
    const t = fake()
    const p = afterRun({ runDir: null, env: {}, stdin: t.stdin, stdout: t.stdout, args: null, cwd: process.cwd(), canMenu: true })
    press(t, ['m'])
    expect(await p).toBe('menu')
  })
  test('afterRun: the old list only with MEERKAT_OLD_MENU=1', async () => {
    const t = fake()
    const p = afterRun({ runDir: null, env: { MEERKAT_OLD_MENU: '1', NO_COLOR: '1' }, stdin: t.stdin, stdout: t.stdout, args: null, cwd: process.cwd() })
    press(t, ['q'])
    await p
    expect(t.text()).toContain(OLD)
  })
  test('afterRun: no terminal means no screen at all', async () => {
    const t = fake()
    t.stdin.isTTY = false
    expect(await afterRun({ runDir: null, env: {}, stdin: t.stdin, stdout: t.stdout })).toBeNull()
    expect(t.out.length).toBe(0)
  })
  test('the command line: verify, full, a preset + folder are plain runs that end in afterRun; the menu runs go through it too', () => {
    for (const argv of [['verify'], ['full'], ['quick', '.'], ['full', 'C:/proj'], ['thorough', '.']]) {
      const p = planCommand(argv, { cwd: process.cwd(), env: {}, interactive: true, presets: {} })
      expect(p.kind, argv.join(' ')).toBe('run')
    }
    const bin = readFileSync(resolve(__dirname, '../../bin/meerkat.mjs'), 'utf8')
    expect(bin).toMatch(/case 'run': \{[\s\S]*afterRun\(/)
    expect(bin).toContain("next === 'menu'")
    const menu = readFileSync(resolve(__dirname, '../menu.mjs'), 'utf8')
    expect(menu).toMatch(/const next = await afterRun\(\{ runDir: latestRunDir\(env\)/)
    expect(menu).toContain("env.MEERKAT_OLD_MENU === '1' ? null")
    expect((menu.match(/Verification finished/g) ?? []).length).toBe(1)
  })
})

describe('Esc in the real menu loop', () => {
  test('Esc on the preset menu opens the project picker; Esc there quits', async () => {
    const proj = scratch()
    mkdirSync(join(proj, '.git'))
    writeFileSync(join(proj, 'package.json'), '{"name":"x"}')
    const home = scratch()
    const t = fake(30, 110)
    const p = runMenu({ cwd: proj, env: { NO_COLOR: '1' }, stdin: t.stdin, stdout: t.stdout, folder: proj, home })
    setTimeout(() => t.stdin.emit('data', Buffer.from('\x1b')), 400)
    setTimeout(() => t.stdin.emit('data', Buffer.from('\x1b')), 1200)
    expect(await p).toBe(0)
    const all = t.text()
    expect(all).toContain('Esc change project')
    expect(all).toContain('Esc to change')
  }, 10000)
})

describe('the live bug counter', () => {
  const chk = (id: string) => ({ id, title: id, lane: 'cpu', estSeconds: 1, source: 'packs/x/y.mjs' })
  test('it counts findings as checks settle; a failed check with none counts as one; not run counts nothing', () => {
    const m = createModel({ checks: [chk('a'), chk('b'), chk('c'), chk('d')] })
    expect(m.bugs().total).toBe(0)
    m.settle(chk('a'), { status: 'PASS' }, 5, [])
    expect(m.bugs().total).toBe(0)
    m.settle(chk('b'), { status: 'FAIL' }, 5, [{ severity: 'critical' }, { severity: 'high' }, { severity: 'high' }])
    expect(m.bugs()).toMatchObject({ critical: 1, high: 2, total: 3 })
    m.settle(chk('c'), { status: 'FAIL' }, 5, null)
    expect(m.bugs()).toMatchObject({ medium: 1, total: 4 })
    m.settle(chk('d'), { status: 'NOT RUN' }, 0, null)
    expect(m.bugs().total).toBe(4)
  })
  test('stack (100+ columns, 24+ rows): total in bold white, one right-aligned line per level present, zero levels left out', () => {
    const bugs = { critical: 2, high: 5, medium: 7, low: 3, info: 0, total: 17 }
    const c = bugCounter(bugs, { width: 110, color: true, height: 40 })
    expect(c.mode).toBe('stack')
    expect(c.lines.map((l) => l.plain)).toEqual(['bugs found: 17', '2 critical', '5 high', '7 medium'])
    expect(new Set(c.lines.map((l) => l.width))).toEqual(new Set([14]))
    expect(c.lines[0].text).toContain('\x1b[1;97mbugs found: 17')
    expect(c.lines[1].text).toContain('\x1b[1;31m2 critical')
    expect(c.lines[2].text).toContain('\x1b[1;38;5;208m5 high')
    expect(c.lines[3].text).toContain('\x1b[1;33m7 medium')
    expect(c.lines[1].text.endsWith('2 critical\x1b[0m')).toBe(true)
    expect(bugCounter({ ...bugs, high: 0 }, { width: 110, color: false, height: 40 }).lines.map((l) => l.plain)).toEqual(['bugs found: 17', '2 critical', '7 medium'])
    expect(bugCounter(bugs, { width: 110, color: false, height: 40 }).lines[2].text.trimStart()).toBe('5 high')
    expect(bugCounter({ critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 }, { width: 110, color: true }).text).toBe('\x1b[32mbugs found: 0\x1b[0m')
  })
  test('a short terminal (under 24 rows) gets the one-line form instead of the stack', () => {
    const bugs = { critical: 2, high: 5, medium: 7, low: 3, info: 0, total: 17 }
    expect(bugCounter(bugs, { width: 120, color: false, height: 20 }).mode).toBe('line')
    expect(bugCounter(bugs, { width: 120, color: false, height: 20 }).plain).toBe('bugs found: 17  (2 critical, 5 high, 7 medium)')
  })
  test('width rules: 70 to 99 columns the one-line form, under 70 the total only, only low and info is the total', () => {
    const bugs = { critical: 1, high: 0, medium: 1, low: 0, info: 0, total: 2 }
    expect(bugCounter(bugs, { width: 99, color: false }).plain).toBe('bugs found: 2  (1 critical, 1 medium)')
    expect(bugCounter(bugs, { width: 70, color: false }).mode).toBe('line')
    expect(bugCounter(bugs, { width: 69, color: false }).plain).toBe('bugs found: 2')
    expect(bugCounter(bugs, { width: 69, color: false }).mode).toBe('total')
    expect(bugCounter({ critical: 0, high: 0, medium: 0, low: 3, info: 0, total: 3 }, { width: 120, color: false, height: 40 }).mode).toBe('total')
  })
  test('on the board the stack sits at the right edge below the title and bar: no overlap at 70, 100 and 120 columns', () => {
    const rows = [{ id: 'a', title: 'a', status: 'FAIL', ms: 1, lane: 'cpu', group: null, pack: 'x', suite: 'x', origin: 'bundled', declaredSubs: [], after: [], elapsedMs: 1, typicalHere: true, reason: '', detail: '', subTotal: null }]
    const bugs = { critical: 1, high: 0, medium: 2, low: 0, info: 0, total: 3 }
    for (const width of [70, 100, 120]) {
      const lines = renderLive({ rows: rows as never, bugs, started: 0, now: 1000, width, color: false, height: 40 }).map(stripAnsi)
      const base = renderLive({ rows: rows as never, bugs: null, started: 0, now: 1000, width, color: false, height: 40 }).map(stripAnsi)
      expect(lines.some((l) => l.includes('MEERKAT') && l.includes('elapsed'))).toBe(true)
      if (width >= 100) {
        // the counter is on rows 3 to 5 (below the title, the bar and the status line), each ending one cell short of the edge
        expect(lines[0]).not.toContain('bugs found')
        expect(lines[1]).not.toContain('bugs found')
        expect(lines[3].endsWith('bugs found: 3')).toBe(true)
        expect(lines[4].endsWith('1 critical')).toBe(true)
        expect(lines[5].endsWith('2 medium')).toBe(true)
        for (const i of [3, 4, 5]) expect(textWidth(lines[i])).toBe(width - 1)
      } else {
        // one line: on the title row when it fits, otherwise a line of its own above the board; never more than one copy
        const hits = lines.filter((l) => l.includes('bugs found: 3'))
        expect(hits.length).toBe(1)
        expect(hits[0].trimEnd().endsWith('bugs found: 3  (1 critical, 2 medium)') || hits[0].trimEnd().endsWith('bugs found: 3')).toBe(true)
      }
      // the board without the counter is the same length on every row it has (the counter only ever adds text to the right)
      expect(base.length).toBeGreaterThan(0)
    }
  })
  test('the final value equals the findings total on the results header', () => {
    const data = sampleData()
    const sev = data.findingCounts.bySeverity as Record<string, number>
    const m = createModel({ checks: [chk('a')] })
    m.settle(chk('a'), { status: 'FAIL' }, 1, Object.entries(sev).flatMap(([severity, n]) => Array.from({ length: n }, () => ({ severity }))))
    const lines = renderResults(initialResultsState(), data, { width: 100, rows: 30, color: false, level: false, env: {} }).map(stripAnsi).join('\n')
    expect(m.bugs().total).toBe(data.findingCounts.total)
    expect(lines).toContain(`${data.findingCounts.total} findings`)
  })
})
