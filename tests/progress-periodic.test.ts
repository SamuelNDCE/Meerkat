// A periodic progress line: while a check runs, a short line naming it, its elapsed seconds and the count finished is printed at a fixed
// interval (default 60s, MEERKAT_PROGRESS_INTERVAL_MS), even when nothing else changed. No line when nothing runs.
import { afterEach, describe, expect, test, vi } from 'vitest'
// @ts-expect-error plain mjs module
import { DEFAULT_PROGRESS_INTERVAL_MS, periodicLine, progressIntervalMs, trackProgress } from '../lib/runprogress.mjs'

afterEach(() => vi.useRealTimers())

function setup(extra: Record<string, unknown> = {}) {
  let t = 1_000_000
  const lines: string[] = []
  const tr = trackProgress({ total: 10, say: (l: string) => lines.push(l), now: () => t, intervalMs: 60_000, ...extra })
  return { tr, lines, advance: (ms: number) => (t += ms) }
}

describe('periodic progress line', () => {
  test('after the interval a line names the running check, its elapsed seconds and the finished count', () => {
    const { tr, lines, advance } = setup()
    tr.start('rust-clippy')
    lines.length = 0
    advance(75_000)
    tr.tick()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('rust-clippy')
    expect(lines[0]).toContain('75s')
    expect(lines[0]).toContain('0/10')
    expect(lines[0].length).toBeLessThan(100)
  })

  test('no line before the interval has passed since the last line', () => {
    const { tr, lines, advance } = setup()
    tr.start('a')
    lines.length = 0
    advance(30_000)
    tr.tick()
    expect(lines).toHaveLength(0)
  })

  test('nothing running and nothing changed: no line, however often it ticks', () => {
    const { tr, lines, advance } = setup()
    tr.start('a')
    tr.finish('a')
    lines.length = 0
    for (let i = 0; i < 5; i++) {
      advance(120_000)
      tr.tick()
    }
    expect(lines).toHaveLength(0)
  })

  test('counts the checks finished so far', () => {
    const { tr, lines, advance } = setup()
    tr.start('a')
    tr.finish('a')
    tr.start('b')
    lines.length = 0
    advance(61_000)
    tr.tick()
    expect(lines[0]).toContain('1/10')
    expect(lines[0]).toContain('b')
  })

  test('a periodic line then waits a full interval before the next', () => {
    const { tr, lines, advance } = setup()
    tr.start('a')
    lines.length = 0
    advance(60_000)
    tr.tick()
    advance(10_000)
    tr.tick()
    expect(lines).toHaveLength(1)
    advance(50_000)
    tr.tick()
    expect(lines).toHaveLength(2)
  })

  test('periodicLine is short and names the longest-running check', () => {
    const line = periodicLine({ finished: 3, total: 9, running: [{ id: 'x', sinceSeconds: 130 }, { id: 'y', sinceSeconds: 5 }] })
    expect(line).toContain('x')
    expect(line).toContain('130s')
    expect(line).toContain('3/9')
  })
})

describe('interval setting', () => {
  test('falls back to 60000', () => {
    expect(DEFAULT_PROGRESS_INTERVAL_MS).toBe(60_000)
    expect(progressIntervalMs({})).toBe(60_000)
    expect(progressIntervalMs({ MEERKAT_PROGRESS_INTERVAL_MS: 'abc' })).toBe(60_000)
    expect(progressIntervalMs({ MEERKAT_PROGRESS_INTERVAL_MS: '-5' })).toBe(60_000)
  })
  test('reads MEERKAT_PROGRESS_INTERVAL_MS when set', () => {
    expect(progressIntervalMs({ MEERKAT_PROGRESS_INTERVAL_MS: '2500' })).toBe(2500)
  })
})

describe('timer', () => {
  test('is unref-ed, fires on its own, and is cleared when the run ends', () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const tr = trackProgress({ total: 3, say: (l: string) => lines.push(l), intervalMs: 1000 })
    expect(vi.getTimerCount()).toBe(1)
    tr.start('slow')
    lines.length = 0
    vi.advanceTimersByTime(1500)
    expect(lines.some((l) => l.includes('slow'))).toBe(true)
    tr.end()
    expect(vi.getTimerCount()).toBe(0)
  })
  test('the real timer does not keep the process alive', () => {
    const tr = trackProgress({ total: 1, say: () => {}, intervalMs: 1000 })
    const handles = (process as unknown as { _getActiveHandles: () => { hasRef?: () => boolean; constructor: { name: string } }[] })._getActiveHandles()
    const timers = handles.filter((h) => h.constructor.name === 'Timeout' && h.hasRef?.())
    tr.end()
    expect(timers.length).toBe(0)
  })
})
