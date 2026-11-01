// The live board must not flicker: whatever starts and finishes, the frame has the same number of lines for a given terminal size, no line
// is wider than the terminal, finished checks stay visible for a moment, the last finished checks are always listed, and the status line
// holds each message for a while.
import { describe, expect, test } from 'vitest'
import { stripAnsi, textWidth } from './cells.mjs'
import { LINGER_MS, STATUS_HOLD_MS, pickStatus, renderLive } from './live.mjs'
import { createModel } from './model.mjs'

const NL = String.fromCharCode(10)
const SIZES = [
  { width: 80, height: 24 },
  { width: 100, height: 30 },
  { width: 140, height: 45 },
]

// A deterministic burst: `n` checks that start within `spread` ms and each run `min`..`max` ms.
function burst(n: number, { spread, min, max }: { spread: number; min: number; max: number }) {
  const checks = Array.from({ length: n }, (_, i) => ({ id: `check-${i}`, lane: 'free', group: ['security', 'functionality', 'ui', 'performance'][i % 4], source: 'built in', estSeconds: 1 }))
  const plan = checks.map((c, i) => ({ c, start: Math.floor((i * spread) / n), len: min + ((i * 7919) % (max - min + 1)) }))
  return { checks, plan }
}

function frames(n: number, shape: { spread: number; min: number; max: number }, size: { width: number; height: number }, color: boolean, until: number) {
  const { checks, plan } = burst(n, shape)
  const model = createModel({ checks: checks as never })
  const statusState = {}
  const out: string[][] = []
  const started = new Set<string>()
  const settled = new Set<string>()
  for (let t = 0; t <= until; t += 125) {
    for (const p of plan) {
      if (!started.has(p.c.id) && t >= p.start) {
        started.add(p.c.id)
        model.start(p.c as never, p.start)
      }
      if (started.has(p.c.id) && !settled.has(p.c.id) && t >= p.start + p.len) {
        settled.add(p.c.id)
        model.settle(p.c as never, p.c.id.endsWith('7') ? { status: 'FAIL', detail: 'a made-up problem in this check' } : { status: 'PASS' }, p.len)
      }
    }
    out.push(renderLive({ rows: model.snapshot(t) as never, bugs: model.bugs(), events: [], started: 0, now: t, tick: t / 125, fraction: Math.min(1, settled.size / n), etaMs: 5000, width: size.width, height: size.height, color, grouped: true, statusState }))
  }
  return out
}

describe('the live board does not flicker', () => {
  for (const size of SIZES) {
    for (const color of [false, true]) {
      test(`${size.width}x${size.height}${color ? ' with colour' : ''}: a burst of 60 one-to-two second checks keeps the frame the same height and never wider than the terminal`, () => {
        const all = frames(60, { spread: 1000, min: 1000, max: 2000 }, size, color, 6000)
        const heights = new Set(all.map((f) => f.length))
        expect([...heights], `line counts seen: ${[...heights]}`).toHaveLength(1)
        expect([...heights][0]).toBeLessThanOrEqual(size.height - 1)
        for (const f of all) for (const l of f) expect(textWidth(l)).toBeLessThanOrEqual(size.width)
      })
      test(`${size.width}x${size.height}${color ? ' with colour' : ''}: 50 checks running at once never grow or shrink the frame, and the rest are one stable line`, () => {
        const all = frames(50, { spread: 1, min: 3000, max: 3000 }, size, color, 5000)
        expect(new Set(all.map((f) => f.length)).size).toBe(1)
        for (const f of all) for (const l of f) expect(textWidth(l)).toBeLessThanOrEqual(size.width)
        const mid = all[4].map(stripAnsi).join(NL)
        expect(mid).toMatch(/\+\d+ more running/)
        expect(mid).toContain('50 running')
        // 6 to 10 running rows are shown (spinner rows carry a "est." time or "nearly done")
        const shown = all[4].map(stripAnsi).filter((l) => /^ {2}free\s/.test(l)).length
        expect(shown).toBeGreaterThanOrEqual(size.height < 34 ? 1 : 5)
        expect(shown).toBeLessThanOrEqual(10)
      })
    }
  }

  test('on a 30 to 45 row terminal at least 5 finished checks are always listed once that many have finished', () => {
    for (const size of SIZES.slice(1)) {
      const all = frames(60, { spread: 1000, min: 1000, max: 2000 }, size, false, 6000)
      for (const f of all) {
        const text = f.map(stripAnsi)
        const at = text.findIndex((l) => l.includes('RECENTLY DONE'))
        const finished = Number(/(\d+) finished/.exec(text[at])?.[1] ?? 0)
        const listed = text.slice(at + 1, at + 9).filter((l) => /^ {4}(PASS|FAIL|NOT RUN) /.test(l)).length
        expect(listed).toBe(Math.min(finished, listed < 5 ? finished : listed))
        if (finished >= 5) expect(listed).toBeGreaterThanOrEqual(5)
      }
    }
  })

  test('a finished check stays in RUNNING NOW for at least 1.5 seconds as a done row', () => {
    const checks = [{ id: 'quick', lane: 'free', group: 'ui', source: 'built in', estSeconds: 1 }]
    const model = createModel({ checks: checks as never })
    model.start(checks[0] as never, 0)
    model.settle(checks[0] as never, { status: 'PASS' }, 300)
    const at = (t: number) => renderLive({ rows: model.snapshot(t) as never, started: 0, now: t, width: 110, height: 40, color: false }).map(stripAnsi)
    const running = (t: number) => {
      const f = at(t)
      const a = f.findIndex((l) => l.includes('RUNNING NOW'))
      const b = f.findIndex((l) => l.includes('RECENTLY DONE'))
      return f.slice(a + 1, b).join(NL)
    }
    expect(LINGER_MS).toBeGreaterThanOrEqual(1500)
    expect(running(300 + 1400)).toContain('quick')
    expect(running(300 + LINGER_MS + 50)).not.toContain('quick')
  })

  test('with colour off there are no escape codes in any frame', () => {
    const all = frames(20, { spread: 500, min: 500, max: 1500 }, SIZES[1], false, 3000)
    for (const f of all) expect(f.join(NL)).not.toContain(String.fromCharCode(27))
  })
})

describe('the status line holds each message', () => {
  const run = (id: string, startedAt: number, extra = {}) => ({ id, status: 'RUNNING', lane: 'free', startedAt, found: 0, ...extra })
  test('a message is kept for the hold time even when another check becomes the bigger group', () => {
    const state = {}
    const first = pickStatus([run('unit-tests', 0)] as never, { now: 0, state })
    expect(first.text).toContain('Running the tests')
    const rows = [run('unit-tests', 0), run('secret-scan', 100), run('key-scan', 100), run('token-scan', 100)]
    expect(pickStatus(rows as never, { now: STATUS_HOLD_MS - 1, state }).text).toContain('Running the tests')
    expect(pickStatus(rows as never, { now: STATUS_HOLD_MS + 1, state }).text).toContain('Scanning for secrets')
  })
  test('the found count is live inside a message that does not change', () => {
    const state = {}
    pickStatus([run('unit-tests', 0)] as never, { now: 0, state })
    const later = pickStatus([run('unit-tests', 0, { found: 4 })] as never, { now: 1000, state })
    expect(later.text).toBe('Running the tests: found 4 so far')
  })
  test('two groups of equal size do not flip back and forth', () => {
    const state = {}
    const seen: string[] = []
    for (let t = 0; t <= 60_000; t += 1000) {
      const rows = [run('unit-tests', 0), run('secret-scan', 0)]
      seen.push(pickStatus(rows as never, { now: t, state }).text.split(':')[0])
    }
    expect(new Set(seen).size).toBe(1)
  })
  test('the finished message is shown at once', () => {
    expect(pickStatus([{ id: 'a', status: 'PASS' }] as never, { now: 10, state: {} }).text).toBe('Looks good')
  })
})
