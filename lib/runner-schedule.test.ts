// Scheduling: longest processing time first. A fake runner on a fake clock, so the numbers are exact and the test is deterministic.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { orderForSpeed, runAll } from './runner.mjs'

const ctx = () => ({ repoRoot: '.', appDir: '.', env: process.env, platform: process.platform, exists: () => true, changedFiles: [] })
const job = (id: string, seconds: number, extra: Record<string, unknown> = {}) => ({
  id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: seconds,
  run: async () => { await new Promise((r) => setTimeout(r, seconds * 1000)); return { ok: true, detail: '' } },
  ...extra,
})
// The order the scheduler used before: cheapest first, long checks last.
const oldOrder = (list: any[]) => [...list].sort((a, b) => a.estSeconds - b.estSeconds)

async function simulate(list: any[], opts: Record<string, unknown> = {}) {
  const startedAt = new Map<string, number>()
  const snapshots: { running: number; waiting: number }[] = []
  let running = 0
  const t0 = Date.now()
  const p = runAll(list, ctx(), {
    parallel: 5,
    hooks: {
      start: (c: any) => { startedAt.set(c.id, Date.now() - t0); running++ },
      settle: () => { running-- },
      queue: (w: any[]) => { snapshots.push({ running, waiting: w.filter((x) => /parallel slots busy/.test(x.reason)).length }) },
    },
    ...opts,
  })
  await vi.runAllTimersAsync()
  const results = await p
  return { results, startedAt, snapshots, makespan: Math.round((Date.now() - t0) / 1000) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('longest processing time first', () => {
  const sample = () => [...Array.from({ length: 40 }, (_, i) => job(`s${String(i).padStart(2, '0')}`, 1)), job('big', 60)]

  test('the longest check starts in the first batch and the makespan beats the old order', async () => {
    const fresh = await simulate(orderForSpeed(sample()))
    expect(fresh.startedAt.get('big')).toBe(0) // the very first batch
    const old = await simulate(oldOrder(sample()))
    expect(old.makespan).toBe(68) // 40 x 1 s on 5 slots = 8 s, then the 60 s check alone
    expect(fresh.makespan).toBe(60) // max(longest check, total / slots)
    expect(fresh.makespan).toBeLessThan(old.makespan)
    expect(fresh.results.every((r: any) => r.status === 'PASS')).toBe(true)
    console.log(`simulated makespan, 40 x 1 s + 1 x 60 s on 5 slots: old order ${old.makespan} s, new order ${fresh.makespan} s`)
  })

  test('no slot sits idle while runnable work is waiting', async () => {
    const mixed = [...Array.from({ length: 30 }, (_, i) => job(`m${i}`, 2 + (i % 5))), job('long', 45), job('mid', 20)]
    const r = await simulate(orderForSpeed(mixed))
    const busy = r.snapshots.filter((s) => s.waiting > 0)
    expect(busy.length).toBeGreaterThan(0)
    for (const s of busy) expect(s.running).toBe(5)
    expect(r.makespan).toBeLessThanOrEqual(Math.max(45, Math.ceil(mixed.reduce((n, c) => n + c.estSeconds, 0) / 5)) + 5)
  })

  test('lane rules hold: one cargo build at a time, windows capped, dependencies respected', async () => {
    let cargo = 0, peakCargo = 0, win = 0, peakWin = 0
    const tracked = (id: string, s: number, lane: string, extra: Record<string, unknown> = {}) => job(id, s, { lane, run: async () => {
      if (lane === 'cargo') peakCargo = Math.max(peakCargo, ++cargo)
      if (lane === 'windows') peakWin = Math.max(peakWin, ++win)
      await new Promise((r) => setTimeout(r, s * 1000))
      if (lane === 'cargo') cargo--
      if (lane === 'windows') win--
      return { ok: true, detail: '' }
    }, ...extra })
    const list = [tracked('c1', 30, 'cargo'), tracked('c2', 50, 'cargo'), tracked('w1', 20, 'windows', { after: ['c2'] }), tracked('w2', 40, 'windows'), tracked('w3', 25, 'windows'), tracked('w4', 90, 'windows'), tracked('w5', 20, 'windows'), job('f1', 3)]
    const r = await simulate(orderForSpeed(list), { budget: { cpu: 99, reserveGB: 0, maxParallel: 99, maxWindows: 2 }, freeMemGB: () => 64 })
    expect(peakCargo).toBe(1)
    expect(peakWin).toBeLessThanOrEqual(2)
    expect(r.startedAt.get('w1')!).toBeGreaterThanOrEqual(r.startedAt.get('c2')! + 50 * 1000)
    expect(r.startedAt.get('w4')).toBe(0) // the longest windows check goes first within its lane
    expect(r.startedAt.get('c2')).toBe(0) // and so does the longest cargo check
    expect(r.results.every((x: any) => x.status === 'PASS')).toBe(true)
  })

  test('order: a few quick gates first, then blockers by chain and the rest by their own time', () => {
    const list = [job('a', 5), job('b', 100), job('fmt', 1), job('build', 50), job('ui', 80, { after: ['build'] }), job('c', 20)]
    expect(orderForSpeed(list).map((c: any) => c.id)).toEqual(['fmt', 'a', 'build', 'b', 'ui', 'c'])
  })
})

describe('a heavy check is not starved by a stream of small ones (the machine budget)', () => {
  const budget = { cpu: 10, reserveGB: 0, maxParallel: 10, maxWindows: 3 }
  test('the build starts within the first seconds and the small checks run beside it', async () => {
    const list = [...Array.from({ length: 30 }, (_, i) => job(`l${String(i).padStart(2, '0')}`, 1, { weight: 'light' })), job('cargo-build', 40, { lane: 'cargo', weight: 'heavy' })]
    const r = await simulate(orderForSpeed(list), { parallel: 9, budget, freeMemGB: () => 64 })
    const buildStart = r.startedAt.get('cargo-build') as number
    expect(buildStart).toBeLessThanOrEqual(3000)
    const during = [...r.startedAt.entries()].filter(([id, t]) => id !== 'cargo-build' && t >= buildStart && t < buildStart + 40000).length
    expect(during, 'small checks that started while the build ran').toBeGreaterThanOrEqual(20)
    expect(r.makespan).toBeLessThanOrEqual(45)
    expect(r.results.every((x: any) => x.status === 'PASS')).toBe(true)
  })
  test('without the hold-back the same run would put the build last (the old behaviour)', async () => {
    const list = [...Array.from({ length: 30 }, (_, i) => job(`l${String(i).padStart(2, '0')}`, 1, { weight: 'light' })), job('cargo-build', 40, { lane: 'cargo', weight: 'heavy' })]
    // The smallest checks first: the build waits for the end, which is what a run without the ordering and the hold-back looks like.
    const r = await simulate(oldOrder(list), { parallel: 9, budget, freeMemGB: () => 64 })
    expect(r.makespan).toBeGreaterThan(40)
  })
})
