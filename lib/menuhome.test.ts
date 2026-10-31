// The full-tier presets bring every pack that applies; the home menu (Run list, time estimates, update wording); the startup spinner.
// @ts-nocheck
import { describe, expect, test } from 'vitest'
import { applicablePacks, GENERIC_PACKS, presetPacks } from './init.mjs'
import { MAIN_PRESETS, menuItems, otherPresetItems } from './menu.mjs'
import { createEstimates, estimateText } from './menuestimate.mjs'
import { renderScreen } from './menuscreen.mjs'
import { loadProject } from './projectchecks.mjs'
import { PRESETS, resolvePreset } from './presets.mjs'
import { selectChecks } from './runner.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { createUpdateCheck, FRAMES, outcomeOf, statusText } from './updatecheck.mjs'

const strip = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '')

describe('full-tier presets bring every pack that applies', () => {
  test('full, thorough and release ask for it; quick and the rest do not', () => {
    for (const n of ['full', 'thorough', 'release']) expect(resolvePreset(n).preset.allPacks).toBe(true)
    for (const n of ['quick', 'fast', 'ci', 'security', 'ui', 'functionality']) expect(resolvePreset(n).preset.allPacks).toBe(false)
  })

  test('a Node folder gets the generic packs plus node (and web with an index.html); a Rust folder gets rust', () => {
    const files = (names: string[]) => (p: string) => names.some((n) => p.replace(/\\/g, '/').endsWith(`/${n}`))
    const node = applicablePacks('/x', files(['package.json', 'index.html']), () => [])
    for (const g of GENERIC_PACKS) expect(node).toContain(g)
    expect(node).toContain('node')
    expect(node).toContain('web')
    expect(node).not.toContain('rust')
    const rust = applicablePacks('/x', files(['Cargo.toml']), () => [])
    expect(rust).toContain('rust')
    expect(rust).not.toContain('node')
    expect(new Set(node).size).toBe(node.length)
  })

  test('presetPacks keeps the preset\'s own packs, and adds the applicable ones only for allPacks', () => {
    const none = () => false
    expect(presetPacks({ packs: ['ai'], allPacks: false }, '/x', none, () => [])).toEqual(['ai'])
    const full = presetPacks({ packs: ['ai'], allPacks: true }, '/x', none, () => [])
    expect(full[0]).toBe('ai')
    expect(full).toEqual(expect.arrayContaining(GENERIC_PACKS))
  })

  test('on this repository full runs far more checks than quick, and quick is unchanged by the preset logic', async () => {
    const count = async (name: string) => {
      const p = resolvePreset(name, {}).preset
      const project = await loadProject(MEERKAT_DIR, { extraPacks: presetPacks(p, MEERKAT_DIR) })
      return { n: selectChecks(project.checks, { tier: p.tier, only: [], include: p.include, mode: 'all', changedFiles: null, groups: p.groups }).run.length, packs: project.config.packs }
    }
    const quick = await count('quick')
    const full = await count('full')
    expect(full.n).toBeGreaterThan(quick.n)
    expect(full.n).toBeGreaterThan(100)
    expect(quick.packs.length).toBeLessThan(full.packs.length)
    expect(full.packs).toEqual(expect.arrayContaining(GENERIC_PACKS))
    expect(PRESETS.quick.allPacks).toBeUndefined()
  })
})

describe('the home menu', () => {
  const labels = (items) => items.filter((i) => i.kind === 'item').map((i) => i.label)
  test('Run lists the presets in the asked order; there is no "Fast and combined"', () => {
    const items = menuItems({ user: {}, project: {} })
    const headings = items.filter((i) => i.kind === 'heading').map((i) => i.label)
    expect(headings).toEqual(['Run', 'More'])
    expect(labels(items).slice(0, 9)).toEqual(['quick', 'full', 'security', 'functionality', 'ui', 'performance', 'refactor', 'ci', 'release'])
    expect(MAIN_PRESETS).toEqual(labels(items).slice(0, 9))
    expect(labels(items)).not.toContain('security-fast')
    expect(labels(items)).toContain('More presets...')
    expect(JSON.stringify(items)).not.toContain('Fast and combined')
  })

  test('More presets... lists every other preset, including your own', () => {
    const other = labels(otherPresetItems({ user: { mine: { tier: 'fast', groups: [] } }, project: {} }))
    for (const n of ['fast', 'thorough', 'security-fast', 'ui-fast', 'functionality-fast', 'performance-fast', 'app', 'app-fast', 'security-ai', 'mine']) expect(other).toContain(n)
    for (const n of MAIN_PRESETS) expect(other).not.toContain(n)
  })

  test('a Run row carries its time; other rows do not', () => {
    const items = menuItems({ user: {}, project: {}, estimates: (n) => (n === 'quick' ? '~40 s' : '...') })
    expect(items.find((i) => i.label === 'quick').time).toBe('~40 s')
    expect(items.find((i) => i.label === 'full').time).toBe('...')
    expect(items.find((i) => i.label === 'Quit').time).toBeUndefined()
    expect(menuItems({ user: {}, project: {} }).find((i) => i.label === 'quick').time).toBeUndefined()
  })

  test('the time is right-aligned after the description', () => {
    const items = menuItems({ user: {}, project: {}, estimates: (n) => (n === 'quick' ? '~40 s' : 'about 5 min') })
    const lines = renderScreen({ items, cursor: 1, multi: false }, { width: 100, rows: 60, color: false }).map((l) => strip(l.text))
    const quick = lines.find((l) => /^> quick\b/.test(l))
    const full = lines.find((l) => /^ {2}full\b/.test(l))
    expect(quick.trimEnd().endsWith('~40 s')).toBe(true)
    expect(full.trimEnd().endsWith('about 5 min')).toBe(true)
    expect(quick.trimEnd().length).toBe(full.trimEnd().length)
  })

  test('the update row: new wording, and the version wording when one is known', () => {
    const row = (update) => menuItems({ user: {}, project: {}, update }).find((i) => i.label === 'Check for updates')
    expect(row(null).about).toBe('Look for a newer version and install it if you say yes')
    expect(row({ latest: '1.4.0', current: '1.3.2' }).about).toBe('Version 1.4.0 is available (you have 1.3.2). Press Enter to update')
    expect(labels(menuItems({ user: {}, project: {} }))).not.toContain('Update Meerkat')
  })
})

describe('estimates', () => {
  test('estimateText', () => {
    expect(estimateText(300)).toBe('about 5 min')
    expect(estimateText(50)).toBe('under 1 min')
    expect(estimateText(70)).toBe('about 1 min')
    expect(estimateText(40)).toBe('~40 s')
    expect(estimateText(12)).toBe('~10 s')
    expect(estimateText(2)).toBe('~2 s')
    expect(estimateText(0)).toBe('~1 s')
    expect(estimateText(3600)).toBe('about 1 h')
    expect(estimateText(Number.NaN)).toBe('est. n/a')
  })

  const timers = { setTimeout: () => 0, clearTimeout: () => {} }
  test('worked out lazily, cached per project and preset', async () => {
    const calls: string[] = []
    const cache = new Map()
    const show = async (n: string) => (calls.push(n), { ok: true, data: { estimateSeconds: n === 'quick' ? 40 : 300 } })
    const est = createEstimates({ project: 'p', names: ['quick', 'full'], show, cache, timers })
    expect(est.get('quick')).toBe('...')
    await est.start()
    expect(est.get('quick')).toBe('~40 s')
    expect(est.get('full')).toBe('about 5 min')
    const again = createEstimates({ project: 'p', names: ['quick', 'full'], show, cache, timers })
    await again.start()
    expect(calls).toEqual(['quick', 'full']) // not asked twice
    expect(again.get('full')).toBe('about 5 min')
    const other = createEstimates({ project: 'q', names: ['quick'], show, cache, timers })
    await other.start()
    expect(calls).toEqual(['quick', 'full', 'quick']) // another project is its own entry
  })

  test('the whole list shares one budget: what is not ready in time shows est. n/a', async () => {
    let clock = 0
    const show = async () => {
      clock += 900
      return { ok: true, data: { estimateSeconds: 10 } }
    }
    const changes: string[] = []
    const est = createEstimates({ project: 'p', names: ['a', 'b', 'c', 'd'], show, now: () => clock, budgetMs: 2000, timers, onChange: () => changes.push('x') })
    await est.start()
    expect(est.get('a')).toBe('~10 s')
    expect(est.get('b')).toBe('~10 s')
    expect(est.get('c')).toBe('~10 s') // started at 1800 ms, inside the budget
    expect(est.get('d')).toBe('est. n/a') // 2700 ms: out of budget
    expect(est.done).toBe(true)
    expect(changes.length).toBeGreaterThan(2)
  })

  test('a preset that fails shows est. n/a and does not stop the others', async () => {
    const show = async (n: string) => (n === 'a' ? { ok: false, text: 'no' } : { ok: true, data: { estimateSeconds: 100 } })
    const est = createEstimates({ project: 'p', names: ['a', 'b'], show, timers })
    await est.start()
    expect(est.get('a')).toBe('est. n/a')
    expect(est.get('b')).toBe('about 2 min')
  })
})

describe('the startup update spinner', () => {
  function fakeClock() {
    let now = 0
    let id = 0
    const jobs = new Map<number, { at: number; every: number | null; fn: () => void }>()
    const add = (fn, ms, every) => {
      const h = { id: ++id, unref() {} }
      jobs.set(h.id, { at: now + ms, every, fn })
      return h
    }
    return {
      timers: {
        setTimeout: (fn, ms) => add(fn, ms, null),
        setInterval: (fn, ms) => add(fn, ms, ms),
        clearTimeout: (h) => jobs.delete(h.id),
        clearInterval: (h) => jobs.delete(h.id),
      },
      advance(ms: number) {
        const end = now + ms
        for (;;) {
          const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
          if (!due) break
          const [k, j] = due
          now = j.at
          if (j.every) j.at += j.every
          else jobs.delete(k)
          j.fn()
        }
        now = end
      },
    }
  }
  const flush = () => new Promise((r) => setImmediate(r))

  test('wording of each state; plain without colour, no frame', () => {
    expect(strip(statusText('checking', { color: true, frame: 0 }))).toBe(`${FRAMES[0]} Checking for updates...`)
    expect(statusText('checking', { color: true })).toContain('\x1b[2m')
    expect(statusText('checking', { color: false })).toBe('Checking for updates...')
    expect(statusText('current', { color: true, version: '1.2.3' })).toBe('\x1b[32mUp to date (v1.2.3)\x1b[0m')
    expect(statusText('failed', { color: false })).toBe('Could not check (offline)')
    expect(statusText('idle')).toBeNull()
    expect(FRAMES.length).toBeGreaterThan(5)
  })

  test('outcomes of the real look-up', () => {
    expect(outcomeOf({ ran: false })).toBe('skipped')
    expect(outcomeOf({ ran: true, found: { ok: false } })).toBe('failed')
    expect(outcomeOf({ ran: true, found: { ok: true, behind: 0 } })).toBe('current')
    expect(outcomeOf({ ran: true, found: { ok: true, behind: 2 } })).toBe('newer')
  })

  test('checking animates, up to date shows for 1 second, then the line goes away', async () => {
    const { timers, advance } = fakeClock()
    const events: string[] = []
    let finish: (v: unknown) => void = () => {}
    const c = createUpdateCheck({ color: true, version: '1.2.3', timers, onChange: (k) => events.push(k), run: ({ onCheck }) => (onCheck(), new Promise((r) => { finish = r })) })
    const done = c.start()
    await flush()
    expect(c.state).toBe('checking')
    const first = strip(c.line()!)
    advance(90)
    expect(strip(c.line()!)).not.toBe(first) // a new frame
    expect(events.filter((e) => e === 'tick').length).toBe(1)
    finish({ outcome: 'current' })
    await done
    expect(c.state).toBe('current')
    expect(strip(c.line()!)).toBe('Up to date (v1.2.3)')
    advance(999)
    expect(c.state).toBe('current')
    advance(2)
    expect(c.state).toBe('idle')
    expect(c.line()).toBeNull()
    advance(1000) // no frames keep coming after the end
    expect(events.filter((e) => e === 'tick').length).toBe(1)
  })

  test('a newer version leaves no spinner line (the yellow bar shows it); a failure shows for 1 second', async () => {
    const a = fakeClock()
    const newer = createUpdateCheck({ color: true, timers: a.timers, run: async ({ onCheck }) => (onCheck(), { outcome: 'newer' }) })
    await newer.start()
    expect(newer.state).toBe('idle')
    expect(newer.line()).toBeNull()
    const b = fakeClock()
    const failed = createUpdateCheck({ color: false, timers: b.timers, run: async ({ onCheck }) => (onCheck(), { outcome: 'failed' }) })
    await failed.start()
    expect(failed.line()).toBe('Could not check (offline)')
    b.advance(1000)
    expect(failed.line()).toBeNull()
  })

  test('a look-up that never ends is given up on after 3 seconds, and its late answer changes nothing', async () => {
    const { timers, advance } = fakeClock()
    let finish: (v: unknown) => void = () => {}
    const c = createUpdateCheck({ color: true, timers, run: ({ onCheck }) => (onCheck(), new Promise((r) => { finish = r })) })
    c.start()
    await flush()
    advance(2999)
    expect(c.state).toBe('checking')
    advance(2)
    expect(c.state).toBe('failed')
    finish({ outcome: 'current' })
    await flush()
    expect(c.state).toBe('failed')
    advance(1000)
    expect(c.state).toBe('idle')
  })

  test('not due: nothing is shown. Not a terminal: never a line. No colour: one static line, no timer', async () => {
    const { timers, advance } = fakeClock()
    const skipped = createUpdateCheck({ color: true, timers, run: async () => ({ outcome: 'skipped' }) })
    await skipped.start()
    expect(skipped.line()).toBeNull()
    const pipe = createUpdateCheck({ color: true, isTTY: false, timers, run: ({ onCheck }) => (onCheck(), new Promise(() => {})) })
    pipe.start()
    await flush()
    expect(pipe.state).toBe('checking')
    expect(pipe.line()).toBeNull()
    const events: string[] = []
    const plain = createUpdateCheck({ color: false, timers, onChange: (k) => events.push(k), run: ({ onCheck }) => (onCheck(), new Promise(() => {})) })
    plain.start()
    await flush()
    advance(1000)
    expect(plain.line()).toBe('Checking for updates...')
    expect(events).not.toContain('tick')
  })

  test('a look-up that throws counts as could not check', async () => {
    const { timers } = fakeClock()
    const c = createUpdateCheck({ color: false, timers, run: async () => { throw new Error('boom') } })
    await c.start()
    expect(c.line()).toBe('Could not check (offline)')
  })
})
