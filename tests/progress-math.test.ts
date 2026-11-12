// lib/runprogress.mjs: percent, elapsed, ETA and the running list, all from an injected clock.
import { describe, expect, test } from 'vitest'
import { createProgress, formatClock } from '../lib/runprogress.mjs'

const clockAt = () => {
  const c = { t: 1_000_000 }
  return { c, now: () => c.t }
}

describe('progress math', () => {
  test('percent is finished over total, elapsed comes from the clock', () => {
    const { c, now } = clockAt()
    const p = createProgress({ total: 4, now })
    expect(p.snapshot().percent).toBe(0)
    p.start('a')
    c.t += 10_000
    p.finish('a')
    c.t += 5_000
    const s = p.snapshot()
    expect(s.finished).toBe(1)
    expect(s.total).toBe(4)
    expect(s.percent).toBe(25)
    expect(s.elapsedSeconds).toBe(15)
  })

  test('ETA is unknown under 2 finished checks, and says so on the line', () => {
    const { c, now } = clockAt()
    const p = createProgress({ total: 5, now })
    p.start('a')
    c.t += 20_000
    p.finish('a')
    expect(p.snapshot().etaSeconds).toBeNull()
    expect(p.line()).toContain('ETA unknown')
  })

  test('after 2 finished checks ETA is average duration times remaining checks', () => {
    const { c, now } = clockAt()
    const p = createProgress({ total: 6, now })
    p.start('a')
    c.t += 10_000
    p.finish('a')
    p.start('b')
    c.t += 30_000
    p.finish('b')
    const s = p.snapshot()
    expect(s.finished).toBe(2)
    expect(s.etaSeconds).toBe(80) // average 20 s x 4 left
    expect(p.line()).toContain('ETA ~1m20s')
  })

  test('the running list has the id and the seconds since it started, longest first', () => {
    const { c, now } = clockAt()
    const p = createProgress({ total: 3, now })
    p.start('rust-clippy')
    c.t += 12_000
    p.start('eslint')
    c.t += 3_000
    const s = p.snapshot()
    expect(s.running).toEqual([
      { id: 'rust-clippy', sinceSeconds: 15 },
      { id: 'eslint', sinceSeconds: 3 },
    ])
    expect(p.line()).toBe('[0% 0/3 | 15s elapsed | ETA unknown] running: rust-clippy (since 15s) and 1 more')
  })

  test('checks that were already finished (cached) count toward the percent but not the average', () => {
    const { c, now } = clockAt()
    const p = createProgress({ total: 10, now, already: 4 })
    expect(p.snapshot().percent).toBe(40)
    p.start('a')
    c.t += 10_000
    p.finish('a')
    expect(p.snapshot().etaSeconds).toBeNull() // only 1 timed check
  })

  test('formatClock', () => {
    expect(formatClock(0)).toBe('0s')
    expect(formatClock(45_000)).toBe('45s')
    expect(formatClock(100_000)).toBe('1m40s')
    expect(formatClock(3_725_000)).toBe('1h02m05s')
  })
})
