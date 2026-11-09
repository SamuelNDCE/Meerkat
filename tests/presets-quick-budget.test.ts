// The quick preset is "before every push", about 5 to 10 minutes at most on a large app. It must never carry a compile-heavy check
// (a build, clippy, a test run), or it stops differing from full. COMPILE_HEAVY_IDS and COMPILE_HEAVY_COMMAND in lib/presets.mjs name them.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS modules
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS modules
import { COMPILE_HEAVY_IDS, PRESETS, QUICK_TYPECHECKS, isCompileHeavy, resolvePreset } from '../lib/presets.mjs'
// @ts-expect-error plain JS modules
import { isCompileCheck } from '../lib/timeouts.mjs'
// @ts-expect-error plain JS modules
import { compileHeavyWithDependants, selectChecks } from '../lib/runner.mjs'

const root = join(__dirname, '..')
type Check = { id: string; optIn?: boolean; supersededBy?: string; [key: string]: unknown }
const all: Check[] = []
for (const p of readdirSync(join(root, 'packs'))) all.push(...(await loadChecks(join(root, 'packs', p))))
all.push(...(await loadChecks(join(root, 'examples', 'neuralvault'))))
const select = (preset: string) => {
  const p = resolvePreset(preset).preset
  return selectChecks(all, { tier: p.tier, only: [], include: p.include, mode: 'all', changedFiles: null, groups: p.groups, skipCompile: p.skipCompile }).run
}

describe('the quick preset stays quick', () => {
  test('quick and fast say they skip compile-heavy checks, full and thorough do not', () => {
    expect(PRESETS.quick.skipCompile).toBe(true)
    expect(PRESETS.fast.skipCompile).toBe(true)
    for (const name of ['full', 'thorough', 'release', 'detectors']) expect((PRESETS as Record<string, { skipCompile?: unknown }>)[name].skipCompile).toBeUndefined()
  })
  test('no compile-heavy check is selected by quick or fast', () => {
    for (const name of ['quick', 'fast']) {
      const bad = select(name).filter(isCompileHeavy).map((c: Check) => c.id)
      expect(bad).toEqual([])
    }
  })
  test('nothing in quick runs a compiler, whatever its id: every check the runner recognises as compiling is out, bar the named type checks', () => {
    const bad = select('quick').filter((c: Check) => isCompileCheck(c) && !QUICK_TYPECHECKS[c.id]).map((c: Check) => c.id)
    expect(bad).toEqual([])
  })
  test('a check that waits on a compile-heavy one (a window test needing the build) leaves quick with it', () => {
    const skipped = compileHeavyWithDependants(all)
    for (const c of all) if ((c.after ?? []).some((d: string) => skipped.has(d))) expect(skipped.has(c.id)).toBe(true)
    const inQuick = new Set(select('quick').map((c: Check) => c.id))
    for (const id of skipped) expect(inQuick.has(id)).toBe(false)
  })
  test('the named list is current: every bundled id in it exists, and every bundled compile check is covered', () => {
    const ids = new Set(all.map((c: Check) => c.id))
    for (const id of COMPILE_HEAVY_IDS) expect(ids.has(id), id).toBe(true)
    const uncovered = all.filter((c: Check) => isCompileCheck(c) && !QUICK_TYPECHECKS[c.id] && !isCompileHeavy(c)).map((c: Check) => c.id)
    expect(uncovered).toEqual([])
  })
  test('full and thorough keep every compile-heavy check, and are a real superset of quick', () => {
    const heavy = all.filter(isCompileHeavy).filter((c: Check) => !c.optIn).map((c: Check) => c.id)
    expect(heavy.length).toBeGreaterThan(8)
    for (const name of ['full', 'thorough']) {
      const ids = new Set(select(name).map((c: Check) => c.id))
      // A smaller check that a bigger one covers (the changed-files tests next to every test) is not run beside it: it counts as kept.
      const kept = (id: string) => ids.has(id) || ids.has(all.find((c: Check) => c.id === id)?.supersededBy)
      for (const id of heavy) expect(kept(id), `${name} lacks ${id}`).toBe(true)
      const quick = select('quick').map((c: Check) => c.id)
      for (const id of quick) expect(kept(id), `${name} lacks quick check ${id}`).toBe(true)
      expect(ids.size).toBeGreaterThan(quick.length + 8)
    }
  })
  test('a direct JavaScript unit-test runner (vitest, jest) is in quick, npm test and the window checks are not', () => {
    const quick = new Set(select('quick').map((c: Check) => c.id))
    for (const c of all) if (/^(npxs+)?(vitest|jest)/.test([c.run?.cmd, ...(c.run?.args ?? [])].join(' ').replace(/^npxs+/, 'npx '))) {
      expect(isCompileHeavy(c), c.id).toBe(false)
      expect(isCompileCheck(c), c.id).toBe(false)
    }
    expect(all.some((c: Check) => c.id === 'unit-tests-changed')).toBe(true)
    expect(quick.has('unit-tests-changed')).toBe(true)
    // npm test may build first and the check cannot see what the script runs, so it stays out of quick.
    expect(isCompileHeavy(all.find((c: Check) => c.id === 'unit-tests'))).toBe(true)
    expect(quick.has('unit-tests')).toBe(false)
    expect(isCompileHeavy({ id: 'x', run: { cmd: 'npx', args: ['vitest', 'run'] } })).toBe(false)
    expect(isCompileHeavy({ id: 'x', run: { cmd: 'npx', args: ['jest', '--ci'] } })).toBe(false)
    expect(isCompileHeavy({ id: 'x', run: { cmd: 'npx', args: ['vite', 'build'] } })).toBe(true)
    // the window checks need a built app and stay out of quick (they run in release, where the windows lane is on)
    for (const id of ['click-through', 'ui-screens']) expect(quick.has(id), id).toBe(false)
  })
  test('naming a compile-heavy check with --only still runs it in a quick run', () => {
    const p = resolvePreset('quick').preset
    const run = selectChecks(all, { tier: p.tier, only: ['rust-clippy'], include: [], mode: 'all', changedFiles: null, groups: p.groups, skipCompile: p.skipCompile }).run
    expect(run.map((c: Check) => c.id)).toContain('rust-clippy')
  })
})
