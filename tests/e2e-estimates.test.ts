// Run-time estimates: shown in the preset menu, counted down on the board, and set beside the real time in the end-of-run line.
//
// Documented tolerance (measured 2026-11-01 on the generated fake apps in tools/fake-apps, quick preset, a PC shared with other work):
//   first run with no timings saved   actual / estimate was 0.3 to 0.6: the estimate is the safe side (too long), by up to about 4x
//   after one run (times learned)     actual / estimate was 0.5 to 1.0
// Before the fix of lib/timings.mjs (outside tool missing counts as NOT RUN, about nothing) and lib/tui/model.mjs (a tiny check really takes
// about 300 ms, not the written 1 s), the first-run estimate was 65 s for a 6 s run (actual / estimate 0.09).
// The bounds below are wide on purpose (the PC's load changes a run's time by 2x); they catch a return of the 10x error, not noise.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { accuracyRatio, estimateRunMs, estimateVsActualText } from '../lib/runestimate.mjs'
import { createEstimates } from '../lib/menuestimate.mjs'
import { presetShow } from '../lib/projectchecks.mjs'
import { summarise } from '../lib/runner.mjs'
import { applyLearned, MISSING_TOOL_SECONDS, toolMissing } from '../lib/timings.mjs'
import { createModel, TINY_FIRST_RUN_MS } from '../lib/tui/model.mjs'
import { compactSummary } from '../lib/tui/results.mjs'
import { generate } from '../tools/fake-apps/index.mjs'

vi.setConfig({ testTimeout: 300_000 })
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-est-'))
  made.push(d)
  return d
}

describe('the pieces', () => {
  test('a check whose outside tool is not installed counts as about nothing, not as its written time', () => {
    const lychee = { id: 'local-links', estSeconds: 60, weight: 'light', needs: ['meerkat-no-such-tool-xyz'] }
    const plain = { id: 'plain', estSeconds: 60, weight: 'light' }
    expect(toolMissing(lychee, {})).toBe(false) // PATH is only read when the caller passes an env
    expect(toolMissing(lychee, { env: process.env })).toBe(true)
    expect(toolMissing(plain, { env: process.env })).toBe(false)
    const checks = [{ ...lychee }, { ...plain }]
    applyLearned(checks, { checks: {} }, 'fast', { env: process.env })
    expect(checks[0].estSeconds).toBe(MISSING_TOOL_SECONDS)
    expect(checks[1].estSeconds).toBe(60)
    const rows = createModel({ checks, timings: { checks: {} }, tier: 'fast' }).snapshot(0)
    expect(rows.find((r) => r.id === 'local-links')?.expectedMs).toBeLessThan(100)
    expect(rows.find((r) => r.id === 'plain')?.expectedMs).toBe(60_000)
  })

  test('a tiny check not yet timed is expected to take a few hundred ms; a timed one uses its own time', () => {
    const c = { id: 'tiny-one', estSeconds: 1, weight: 'tiny' }
    const fresh = createModel({ checks: [c], timings: { checks: {} }, tier: 'fast' }).snapshot(0)[0]
    expect(fresh.expectedMs).toBe(TINY_FIRST_RUN_MS)
    const learned = createModel({ checks: [c], timings: { checks: { 'tiny-one': { fast: [90, 110, 100] } } }, tier: 'fast' }).snapshot(0)[0]
    expect(learned.typicalMs).toBe(100)
    const heavy = createModel({ checks: [{ id: 'build', estSeconds: 90, weight: 'heavy' }], timings: { checks: {} }, tier: 'fast' }).snapshot(0)[0]
    expect(heavy.expectedMs).toBe(90_000)
  })

  test('estimateRunMs follows the lanes: a long check cannot be sped up by many short ones', () => {
    const checks = [{ id: 'a', estSeconds: 30, lane: 'free' }, ...Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, estSeconds: 1, lane: 'free', weight: 'light' }))]
    const ms = estimateRunMs(checks, { checks: {} }, 'fast', { slots: 4 })
    expect(ms).toBeGreaterThanOrEqual(30_000)
    expect(ms).toBeLessThan(40_000)
  })

  test('the end-of-run line says "estimated X, took Y", and says nothing extra when there was no estimate', () => {
    expect(estimateVsActualText(40_000, 38_100)).toBe('estimated about 40 s, took 0:38')
    expect(estimateVsActualText(300_000, 280_000)).toMatch(/^estimated about 5 min, took /)
    expect(estimateVsActualText(null as any, 1000)).toBe('')
    expect(estimateVsActualText(0, 1000)).toBe('')
    const plain = summarise('fast', [{ status: 'PASS' }], 2, 1500)
    expect(plain.line).toBe('MEERKAT fast: 1 passed, 0 failed, 0 not run, 2 skipped in 1.5s')
    const withEstimate = summarise('fast', [{ status: 'PASS' }], 2, 1500, estimateVsActualText(2000, 1500))
    expect(withEstimate.line).toBe('MEERKAT fast: 1 passed, 0 failed, 0 not run, 2 skipped in 1.5s (estimated about 2 s, took 1.5s)')
    expect(withEstimate.exitCode).toBe(0)
    expect(accuracyRatio(2000, 1500)).toBeCloseTo(0.75)
    expect(accuracyRatio(0, 1500)).toBeNull()
  })

  test('the summary kept in the scrollback after the board carries the same sentence', () => {
    const lines = compactSummary({ label: 'full', results: [{ id: 'x', status: 'PASS' }], ms: 38_100, estimatedMs: 40_000 })
    expect(lines[0]).toContain('estimated about 40 s, took 0:38')
    expect(compactSummary({ label: 'full', results: [{ id: 'x', status: 'PASS' }], ms: 38_100 })[0]).not.toContain('estimated')
  })
})

describe('the preset menu estimates, for a real project', () => {
  test('every preset gets an estimate scaled to the project; quick is shorter than full; the menu shows each one', async () => {
    const dir = generate('ledger-core', 'clean', tmp())
    const env = { ...process.env, MEERKAT_TIMINGS: join(tmp(), 'none.json') }
    const names = ['quick', 'full', 'security-fast', 'ui-fast']
    const secs: Record<string, number> = {}
    for (const n of names) {
      const r = await presetShow(n, dir, { env })
      expect(r.ok, n).toBe(true)
      secs[n] = r.data.estimateSeconds
      expect(Number.isFinite(secs[n]), n).toBe(true)
    }
    expect(secs.quick).toBeGreaterThan(0)
    expect(secs.full).toBeGreaterThanOrEqual(secs.quick)
    expect(secs['security-fast']).toBeLessThanOrEqual(secs.quick)
    const shown = createEstimates({ project: dir, names, show: (n: string) => presetShow(n, dir, { env }), budgetMs: 90_000 })
    expect(shown.get('quick')).toBe('...')
    await shown.start()
    for (const n of names) expect(shown.get(n), n).toMatch(/^(~\d+ s|under 1 min|about .+)$/)
  }, 120_000)

  test('the estimate falls as the project is timed (learned times replace the written guesses)', async () => {
    const dir = generate('ledger-core', 'clean', tmp())
    const timings = join(tmp(), 'timings.json')
    const run = () => spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--preset', 'quick', '--plain'], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: join(tmp(), 'l'), MEERKAT_TIMINGS: timings, NO_COLOR: '1' } })
    const before = (await presetShow('quick', dir, { env: { ...process.env, MEERKAT_TIMINGS: timings } })).data.estimateSeconds
    run()
    expect(existsSync(timings)).toBe(true)
    const after = (await presetShow('quick', dir, { env: { ...process.env, MEERKAT_TIMINGS: timings } })).data.estimateSeconds
    expect(after).toBeLessThanOrEqual(before)
  }, 240_000)
})

// A tiny Rust crate is the known bad case: the cargo checks are written for a mid-size crate (60 to 120 s each, halved for one crate) and
// a crate with no dependencies builds in a second or two. The first run is then up to about 30x too long; after one run it is right.
const FIRST_RUN_FLOOR: Record<string, number> = { 'ledger-core': 0.02, 'express-api': 0.04 }

describe.each(['ledger-core', 'express-api'])('estimate against the real time, %s, quick preset', (name) => {
  test('first run (no times saved) and second run (times learned) are inside the documented tolerance', () => {
    const root = tmp()
    const dir = generate(name, 'clean', join(root, 'p'))
    const env = { ...process.env, MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_TIMINGS: join(root, 'timings.json'), NO_COLOR: '1' }
    const go = () => {
      const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--preset', 'quick', '--plain'], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
      const runs = join(root, 'logs', 'runs')
      const last = readdirSync(runs).sort().pop() as string
      const summary = JSON.parse(readFileSync(join(runs, last, 'summary.json'), 'utf8'))
      const m = /\(estimated (.+?), took ([^)]+)\)/.exec(r.stdout)
      return { out: r.stdout, summary, m }
    }
    const ratios: number[] = []
    for (const round of [0, 1]) {
      const { out, summary, m } = go()
      expect(m, `round ${round}: the summary line has no estimate\n${out.slice(-600)}`).not.toBeNull()
      expect(summary.summary).toContain('estimated')
      expect(summary.estimatedMs).toBeGreaterThan(0)
      const ratio = summary.ms / summary.estimatedMs
      ratios.push(ratio)
      // Never more than 10x too short, never more than 10x too long; learned times must be much closer than the written guesses.
      expect(ratio, `round ${round}: actual ${summary.ms} ms, estimated ${summary.estimatedMs} ms`).toBeGreaterThan(round === 0 ? FIRST_RUN_FLOOR[name] : 0.1)
      expect(ratio).toBeLessThan(10)
    }
    expect(ratios[1], `ratios ${ratios.map((r) => r.toFixed(2)).join(', ')}`).toBeGreaterThan(0.3)
    expect(ratios[1]).toBeLessThan(6)
    console.log(`estimate accuracy ${name}: actual/estimate first run ${ratios[0].toFixed(2)}, learned ${ratios[1].toFixed(2)}`)
  }, 300_000)
})
