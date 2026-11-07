// The estimate follows the newest runs: a check that gets faster is estimated at its new speed after one or two runs, not after three.
import { describe, expect, test } from 'vitest'
import { applyLearned, learnedSeconds, recentMedian, recordRun } from './timings.mjs'
import { CACHED_RUN_BASE_MS, estimateRunMs, estimateRunMsWithCache } from './runestimate.mjs'
import { typicalMs } from './tui/model.mjs'

const check = (id: string, estSeconds = 30) => ({ id, estSeconds, weight: 'light', lane: 'free' })
const pass = (id: string, ms: number, extra = {}) => ({ id, status: 'PASS', ms, ...extra })

describe('recentMedian', () => {
  test('equal or single samples give the plain middle; nothing gives null', () => {
    expect(recentMedian([])).toBeNull()
    expect(recentMedian([100])).toBe(100)
    expect(recentMedian([90, 110, 100])).toBe(100)
    expect(recentMedian([0, NaN, -5] as number[])).toBeNull()
  })
  test('a change of speed wins after two runs, where a plain middle of five still says the old speed', () => {
    expect(recentMedian([6000, 6000, 6000, 100, 100])).toBe(100)
    expect(recentMedian([100, 100, 100, 6000, 6000])).toBe(6000)
  })
})

describe('recordRun', () => {
  test('a pass under a millisecond is kept as 1 ms; a cached pass is not recorded; failures are not recorded', () => {
    const next = recordRun({ checks: {} }, [pass('na', 0), pass('cached', 0, { cached: true }), { id: 'bad', status: 'FAIL', ms: 50 }, pass('real', 412.4)], 'fast')
    expect(next.checks.na.fast).toEqual([1])
    expect(next.checks.cached).toBeUndefined()
    expect(next.checks.bad).toBeUndefined()
    expect(next.checks.real.fast).toEqual([412])
  })
  test('a NOT RUN that ended by itself within a moment is learned; stopped, skipped, slow or unmeasured ones are not', () => {
    const nr = (id: string, ms: number, detail: string) => ({ id, status: 'NOT RUN', ms, detail })
    const next = recordRun({ checks: {} }, [nr('noconf', 335, 'this project has no eslint configuration'), nr('skip', 40, 'skipped by you after 0:01'), nr('slow', 9000, 'needs x'), nr('zero', 0, 'needs y'), nr('limit', 100, 'ran out of time')], 'fast')
    expect(Object.keys(next.checks)).toEqual(['noconf'])
    expect(next.checks.noconf.fast).toEqual([335])
  })
})

describe('the estimate moves toward a faster real time', () => {
  test('after three slow runs and then two fast ones, the run estimate follows the fast time', () => {
    const ids = ['a', 'b', 'c', 'd']
    const checks = () => ids.map((id) => check(id, 60))
    let timings: any = { checks: {} }
    const estimateNow = () => {
      const cs = checks()
      applyLearned(cs, timings, 'fast')
      return estimateRunMs(cs, timings, 'fast', { slots: 4 })
    }
    const first = estimateNow()
    expect(first).toBeGreaterThanOrEqual(60_000) // nothing timed yet: the written guess
    for (let i = 0; i < 3; i++) timings = recordRun(timings, ids.map((id) => pass(id, 8000)), 'fast')
    const slow = estimateNow()
    expect(slow).toBeGreaterThanOrEqual(7_500)
    expect(slow).toBeLessThanOrEqual(8_500)
    const seen: number[] = []
    for (let i = 0; i < 2; i++) {
      timings = recordRun(timings, ids.map((id) => pass(id, 200)), 'fast')
      seen.push(estimateNow())
    }
    expect(seen[1]).toBeLessThan(1000) // after two fast runs the estimate is about the fast time (0.2 s), not the old 8 s
    expect(seen[1]).toBeLessThan(slow / 5)
    expect(typicalMs(timings, 'a', 'fast')).toBe(200)
    expect(learnedSeconds(timings, 'a', 'fast')).toBe(1)
  })
})

describe('a run the result cache serves', () => {
  test('is estimated at the fixed replay cost plus only the checks that will really run', () => {
    const timings = { checks: { a: { fast: [8000] }, b: { fast: [8000] } } }
    const cs = [check('a', 60), check('b', 60)]
    applyLearned(cs, timings, 'fast')
    expect(estimateRunMsWithCache(cs, 0, timings, 'fast', { slots: 4 })).toBe(estimateRunMs(cs, timings, 'fast', { slots: 4 }))
    expect(estimateRunMsWithCache([], 2, timings, 'fast', { slots: 4 })).toBe(CACHED_RUN_BASE_MS)
    expect(estimateRunMsWithCache([cs[0]], 1, timings, 'fast', { slots: 4 })).toBe(CACHED_RUN_BASE_MS + 8000)
    expect(estimateRunMsWithCache([], 0, timings, 'fast', { slots: 4 })).toBeNull()
  })
})
