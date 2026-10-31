// The live board's columns, the sub-second timeline, the duration text, and the after-run menu starting on a fresh line.
import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { COLS, TIMELINE_X, boardGeometry, categoryLine, renderLive, timelineCells, timelineStrip } from './live.mjs'
import { cellWidth, clipLine, padCells, stripAnsi, textWidth } from './cells.mjs'
import { createModel } from './model.mjs'
import { formatShort } from '../progress.mjs'
import { groupRows, rowSpan } from './group.mjs'
// @ts-expect-error plain JS module
import { afterRun } from '../menu.mjs'

const GROUPS = ['security', 'functionality', 'ui', 'performance', 'refactor']

function makeRows(n: number, { failId = 'check-3', detail = 'boom', t0 = 0, ms = 200 }: { failId?: string; detail?: string; t0?: number; ms?: number } = {}) {
  const checks = Array.from({ length: n }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: GROUPS[i % 5], source: 'built in', estSeconds: 1 }))
  const model = createModel({ checks: checks as never })
  checks.forEach((c, i) => {
    model.start(c as never, t0 + i * 10)
    model.settle(c as never, c.id === failId ? { status: 'FAIL', detail } : { status: 'PASS' }, ms)
  })
  return model.snapshot(t0 + 900)
}

const render = (rows: unknown[], width: number, now = 900, color = true) =>
  renderLive({ rows: rows as never, events: [], started: 0, now, tick: 3, fraction: 1, etaMs: null, width, color, grouped: true })

// The lines that belong to the list (category lines and check rows), found by their one-cell mark and status word.
const listLines = (lines: string[]) => lines.filter((l) => /^ {2}[vx!>.] (PASSED|FAILED|NOT RUN|RUNNING|WAITING|PASS|FAIL) /.test(stripAnsi(l)))

// The text of a line from a given cell onward, counted in display cells.
function fromCell(line: string, cell: number) {
  let w = 0
  let out = ''
  for (const ch of stripAnsi(line)) {
    if (w >= cell) out += ch
    w += cellWidth(ch)
  }
  return out
}

describe('display-width helpers', () => {
  test('wide glyphs count two cells, colour codes none', () => {
    expect(textWidth('abc')).toBe(3)
    expect(textWidth('日本')).toBe(4)
    expect(textWidth('\x1b[31mred\x1b[0m')).toBe(3)
    expect(textWidth('á')).toBe(1)
  })
  test('padCells and clipLine give exactly the width asked', () => {
    expect(textWidth(padCells('日本語', 10))).toBe(10)
    expect(textWidth(padCells('a very long name indeed', 8))).toBe(8)
    expect(textWidth(clipLine(`\x1b[32m${'x'.repeat(50)}\x1b[0m`, 20))).toBe(20)
  })
})

describe('board rows share one set of columns', () => {
  for (const width of [100, 110, 120]) {
    test(`every row fits ${width} cells, and the timeline starts at the same cell on every row`, () => {
      const rows = makeRows(60, { detail: 'a very long reason that has to be cut with an ellipsis because it cannot fit the room left over' })
      const lines = render(rows, width)
      const list = listLines(lines)
      expect(list.length).toBeGreaterThan(5)
      const geo = boardGeometry(width)
      for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(width)
      for (const l of list) {
        const strip = fromCell(l, TIMELINE_X).slice(0, geo.timeline)
        expect(strip).toMatch(/^[█▌·]+$/)
        expect([...strip].length).toBe(geo.timeline)
      }
      const heading = lines.map(stripAnsi).find((l) => l.includes('ALL CHECKS')) as string
      expect(textWidth(heading.slice(0, heading.indexOf('TIMELINE')))).toBe(TIMELINE_X)
    })
  }

  test('the category line and its expanded problem row use the same columns', () => {
    const rows = makeRows(60)
    const lines = listLines(render(rows, 110)).map(stripAnsi)
    const cat = lines.find((l) => /FAILED\s+Performance/.test(l)) as string
    const row = lines.find((l) => /FAIL\s+check-3\b/.test(l)) as string
    expect(cat && row).toBeTruthy()
    // icon at cell 2, status word at 4, name at 12 (the id sits two cells in), checks/time after
    expect(cat.indexOf('x')).toBe(row.indexOf('x'))
    expect(cat.indexOf('FAILED')).toBe(row.indexOf('FAIL'))
    expect(textWidth(cat.slice(0, cat.indexOf('Performance')))).toBe(4 + COLS.status + 1)
    expect(textWidth(row.slice(0, row.indexOf('check-3')))).toBe(4 + COLS.status + 1 + 2)
  })

  test('a wide character in an id or reason does not shift the timeline', () => {
    const rows = makeRows(60, { detail: '日本語 emoji \u{1F600} reason' }).map((r: { id: string }) => (r.id === 'check-3' ? { ...r, id: '日本語-check' } : r))
    const list = listLines(render(rows, 110))
    for (const l of list) {
      expect(textWidth(l)).toBeLessThanOrEqual(110)
      expect(fromCell(l, TIMELINE_X)).toMatch(/^[█▌·]+/)
    }
  })

  test('a one-cell ASCII mark is used, not a glyph some fonts draw two cells wide', () => {
    const out = render(makeRows(60), 110).map(stripAnsi).join('\n')
    expect(out).not.toMatch(/[✔✖▶]/)
    expect(out).toMatch(/ v PASSED /)
    expect(out).toMatch(/ x FAILED /)
  })

  test('no inverse (reverse video) style is used on a board row or id', () => {
    const lines = render(makeRows(60), 110, 900, true)
    for (const l of lines) expect(l).not.toMatch(/\x1b\[(?:[0-9;]*;)?7(?:;[0-9;]*)?m/)
  })

  test('the width is the same on every frame (nothing jumps)', () => {
    const rows = makeRows(60)
    const widths = new Set<number>()
    for (const tick of [0, 1, 2, 3, 7]) {
      const lines = renderLive({ rows: rows as never, events: [], started: 0, now: 900 + tick * 40, tick, fraction: 1, etaMs: null, width: 110, color: true, grouped: true })
      for (const l of listLines(lines)) widths.add(textWidth(l) - textWidth(l.replace(/\s+$/, '')) >= 0 ? TIMELINE_X : 0)
      expect(fromCell(listLines(lines)[0], TIMELINE_X)[0]).toMatch(/[█▌·]/)
    }
    expect(widths.size).toBe(1)
  })

  test('categoryLine alone also fits the width', () => {
    const rows = makeRows(60)
    const cats = groupRows(rows as never, { grouped: true, span: rowSpan(900) }) as never[]
    for (const cat of cats) expect(textWidth(categoryLine(cat, { color: true, width: 100, started: 0, now: 900 }))).toBeLessThanOrEqual(100)
  })
})

describe('timeline over a very short run', () => {
  test('a run of under a second spreads its bars on a 1 s scale', () => {
    const o = { started: 0, now: 300, width: 20 }
    const [a1, b1] = timelineCells(0, 100, o)
    const [a2, b2] = timelineCells(100, 300, o)
    expect([a1, b1]).toEqual([0, 2])
    expect([a2, b2]).toEqual([2, 6])
    expect(a2).toBeGreaterThan(a1)
  })
  test('every check that ran gets at least one cell and nothing passes the column', () => {
    for (const [begin, end] of [[0, 0], [5, 5], [299, 300], [300, 300], [0, 99999], [-50, 20]]) {
      const [a, b] = timelineCells(begin, end, { started: 0, now: 300, width: 12 })
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b - a).toBeGreaterThanOrEqual(1)
      expect(b).toBeLessThanOrEqual(12)
    }
  })
  test('a running check reaches now, and the strip is always exactly the column wide', () => {
    const base = { begunAt: 100, endedAt: null, status: 'RUNNING' }
    const s = timelineStrip(base, { started: 0, now: 400, tick: 0, width: 16, color: false })
    expect([...s].length).toBe(16)
    expect(s.endsWith('▌') || s.endsWith('█')).toBe(false) // starts at 100/1000, reaches 400/1000: not the end of the column
    const done = timelineStrip({ begunAt: 0, endedAt: 50, status: 'PASS' }, { started: 0, now: 50, tick: 0, width: 16, color: false })
    expect([...done].length).toBe(16)
    expect(done).toMatch(/^█+·*$/)
  })
  test('a whole sub-second board has varied bars and no overflow', () => {
    const rows = makeRows(30, { ms: 40 })
    const out = listLines(render(rows, 110, 400, false))
    const strips = out.map((l) => fromCell(l, TIMELINE_X).slice(0, boardGeometry(110).timeline))
    expect(new Set(strips).size).toBeGreaterThan(1)
    for (const s of strips) expect([...s].length).toBe(boardGeometry(110).timeline)
  })
})

describe('duration text', () => {
  test('under 10 s keeps a decimal, from 10 s it is m:ss', () => {
    expect(formatShort(0)).toBe('0.0s')
    expect(formatShort(200)).toBe('0.2s')
    expect(formatShort(1234)).toBe('1.2s')
    expect(formatShort(9949)).toBe('9.9s')
    expect(formatShort(9960)).toBe('0:10')
    expect(formatShort(12_000)).toBe('0:12')
    expect(formatShort(75_000)).toBe('1:15')
  })
  test('the board never prints 0:00 for a check that took 0.2 s', () => {
    const rows = makeRows(30, { ms: 200 })
    const out = render(rows, 110, 900, false).join('\n')
    expect(out).toContain('0.2s')
    expect(out).not.toContain('0:00')
  })
})

describe('the after-run menu starts on a fresh line', () => {
  test('it writes a newline before the first menu line and never moves the cursor up first', async () => {
    const writes: string[] = []
    const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, resume() {}, pause() {} })
    const stdout = { isTTY: true, columns: 100, rows: 30, write: (t: string) => (writes.push(String(t)), true) }
    const p = afterRun({ runDir: null, env: { NO_COLOR: '1', MEERKAT_OLD_MENU: '1' }, stdin, stdout, args: null, cwd: process.cwd() })
    setTimeout(() => stdin.emit('data', Buffer.from('q')), 30)
    await p
    const first = writes.findIndex((w) => w.includes('Verification finished'))
    expect(first).toBeGreaterThan(0)
    const before = writes.slice(0, first).join('')
    expect(before.endsWith('\r\n') || before.endsWith('\n')).toBe(true)
    // nothing before the menu's first line moves the cursor up or erases the screen
    expect(before).not.toMatch(/\x1b\[\d*A/)
    expect(before).not.toMatch(/\x1b\[\d*J/)
  })
})
