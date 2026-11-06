// The test catalog (`meerkat tests --json`) must match the check registry, and meerkat.order.json must be validated.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { planCommand } from './cli.mjs'
import { execute } from './commands.mjs'
import { describe as describeCommands } from './help.mjs'
import { GROUPS, loadChecks } from './load-checks.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { selectChecks } from './runner.mjs'
import { SUITES, suiteIdOf } from './suites.mjs'
import { APP_LANES, buildCatalog, costOf, NETWORK_IDS, NETWORK_OPT_INS, PRESET_TRIGGER, TRIGGERS } from './testcatalog.mjs'
import { DEFAULT_KIND_ORDER, loadOrder, ORDER_FILE, orderByKind, parseOrder } from './testorder.mjs'
import { PRESETS } from './presets.mjs'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-catalog-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// The registry, read straight from the packs folder without going through the catalog code.
async function registry() {
  const out: any[] = []
  for (const p of readdirSync(join(MEERKAT_DIR, 'packs'))) for (const c of await loadChecks(join(MEERKAT_DIR, 'packs', p))) out.push({ ...c, source: `pack ${p}` })
  return out
}

describe('the catalog matches the registry', () => {
  test('every check in the registry is in the catalog, and nothing else is', async () => {
    const reg = await registry()
    const cat = await buildCatalog()
    const inCatalog = new Set(cat.checks.map((c: any) => c.id))
    const missing = reg.filter((c) => !inCatalog.has(c.id)).map((c) => c.id)
    expect(missing).toEqual([])
    expect(cat.checks.length).toBe(new Set(reg.map((c) => c.id)).size)
    expect(cat.totals.checks).toBe(cat.checks.length)
  })

  test('a check that is added to the registry shows up in the catalog', async () => {
    const extra = { id: 'brand-new-check', group: 'security', tier: 'fast', lane: 'free', title: 'A sample claim', estSeconds: 90, needs: ['sometool'], run: { cmd: 'node', args: ['-v'] }, source: 'pack sample' }
    const cat = await buildCatalog({ load: async () => [extra] })
    const row = cat.checks.find((c: any) => c.id === 'brand-new-check')
    expect(row).toMatchObject({ kind: 'security', proves: 'A sample claim', cost: 'slow', needs: { tools: ['sometool'], network: false, app: false } })
    expect(row.triggers).toContain('manual')
  })

  test('every kind and every family with checks is listed, with the fields an AI needs', async () => {
    const cat = await buildCatalog()
    expect(cat.kinds.map((k: any) => k.id)).toEqual(GROUPS)
    const reg = await registry()
    const families = new Set(reg.map((c) => suiteIdOf(c)))
    expect(new Set(cat.families.map((f: any) => f.id))).toEqual(families)
    for (const f of cat.families) expect(SUITES.map((s) => s.id)).toContain(f.id)
    for (const e of [...cat.kinds, ...cat.families, ...cat.checks]) {
      expect(typeof e.proves).toBe('string')
      expect(e.proves.length).toBeGreaterThan(0)
      expect(e.triggers.length).toBeGreaterThan(0)
      expect(['fast', 'medium', 'slow']).toContain(e.cost)
      expect(e.needs).toMatchObject({ tools: expect.any(Array), network: expect.any(Boolean), app: expect.any(Boolean) })
    }
    for (const k of cat.kinds) {
      expect(k.add).toContain('selfTest')
      expect(k.reorder).toContain(ORDER_FILE)
      expect(k.checkCount).toBe(cat.checks.filter((c: any) => c.kind === k.id).length)
    }
  })

  test('triggers follow the presets: quick is commit, release is promote, an opt-in check is not in quick', async () => {
    const cat = await buildCatalog()
    for (const name of Object.keys(PRESET_TRIGGER)) expect(PRESETS).toHaveProperty(name)
    const secret = cat.checks.find((c: any) => c.id === 'secret-scan')
    expect(secret.triggers).toEqual(expect.arrayContaining(['commit', 'gate', 'promote', 'manual']))
    const optIn = cat.checks.find((c: any) => c.optIn === 'ai')
    expect(optIn.presets).not.toContain('quick')
    expect(optIn.triggers).toContain('promote')
    for (const c of cat.checks) for (const t of c.triggers) expect(TRIGGERS).toContain(t)
  })

  test('the network list names checks that exist', async () => {
    const ids = new Set((await registry()).map((c) => c.id))
    for (const id of NETWORK_IDS) expect(ids.has(id)).toBe(true)
    const optIns = new Set((await registry()).map((c) => c.optIn).filter(Boolean))
    for (const o of NETWORK_OPT_INS) expect(optIns.has(o)).toBe(true)
    const cat = await buildCatalog()
    expect(cat.checks.find((c: any) => c.id === NETWORK_IDS[0]).needs.network).toBe(true)
    expect(APP_LANES).toContain('windows')
  })

  test('cost bands', () => {
    expect(costOf({ estSeconds: 1 })).toBe('fast')
    expect(costOf({ estSeconds: 10 })).toBe('fast')
    expect(costOf({ estSeconds: 11 })).toBe('medium')
    expect(costOf({ estSeconds: 61 })).toBe('slow')
    expect(costOf({})).toBe('medium')
  })
})

describe('meerkat tests', () => {
  test('is a command, in the registry that describe prints', () => {
    expect(planCommand(['tests', '--json'], { cwd: resolve('/work/app'), env: {}, interactive: false, presets: { user: {}, project: {} } })).toMatchObject({ kind: 'noun', noun: 'tests', verb: 'list', flags: { json: true } })
    expect(describeCommands({}).commands.map((c: any) => c.name)).toContain('tests')
  })

  test('prints the catalog as JSON and exits 2 for a wrong order file', async () => {
    const lines: string[] = []
    const ctx = { out: (t: string) => lines.push(t), err: () => {}, env: {}, cwd: dir }
    const plan = { kind: 'noun', noun: 'tests', verb: 'list', folder: dir, flags: { json: true } }
    expect(await execute(plan, ctx)).toBe(0)
    const parsed = JSON.parse(lines.join('\n'))
    expect(parsed.order).toMatchObject({ source: 'default', error: null })
    writeFileSync(join(dir, ORDER_FILE), JSON.stringify({ kinds: ['ui', 'security'] }))
    lines.length = 0
    expect(await execute(plan, ctx)).toBe(0)
    expect(JSON.parse(lines.join('\n')).order.inUse).toEqual(['ui', 'security', 'functionality', 'performance', 'refactor'])
    writeFileSync(join(dir, ORDER_FILE), JSON.stringify({ kinds: ['smoke'] }))
    lines.length = 0
    expect(await execute(plan, ctx)).toBe(2)
    expect(JSON.parse(lines.join('\n')).order.error).toContain('unknown kind "smoke"')
  })
})

describe('meerkat.order.json', () => {
  test('rejects an unknown kind with a plain message that lists the real ones', () => {
    const r: any = parseOrder('{"kinds": ["security", "speed"]}')
    expect(r.kinds).toBeUndefined()
    expect(r.error).toBe(`meerkat.order.json: unknown kind "speed". Kinds: ${GROUPS.join(', ')}`)
  })

  test('rejects bad JSON, a non-object, a missing list, a repeat, an unknown key and a non-string kind', () => {
    expect((parseOrder('{nope') as any).error).toContain('not valid JSON')
    expect((parseOrder('[]') as any).error).toContain('must be a JSON object')
    expect((parseOrder('{}') as any).error).toContain('"kinds" must be a list')
    expect((parseOrder('{"kinds": ["ui", "ui"]}') as any).error).toContain('listed twice')
    expect((parseOrder('{"kinds": [], "speed": 1}') as any).error).toContain('unknown key "speed"')
    expect((parseOrder('{"kinds": [3]}') as any).error).toContain('unknown kind')
    expect((parseOrder('{"kinds": [], "version": 2}') as any).error).toContain('"version" must be 1')
  })

  test('accepts a list, and puts kinds it leaves out after the listed ones in the default order', () => {
    expect(parseOrder('{"kinds": ["performance", "ui"]}')).toEqual({ kinds: ['performance', 'ui', 'security', 'functionality', 'refactor'] })
    expect(parseOrder('{"version": 1, "kinds": []}')).toEqual({ kinds: DEFAULT_KIND_ORDER })
  })

  test('the file shipped in this repository is valid', () => {
    const r = loadOrder([MEERKAT_DIR]) as any
    expect(r.error).toBeUndefined()
    expect(r.kinds).toEqual(DEFAULT_KIND_ORDER)
  })

  test('loadOrder finds the file in the app folder first, then the repository root, and reports a wrong one', () => {
    const app = join(dir, 'app')
    mkdirSync(app)
    expect(loadOrder([app, dir])).toEqual({})
    writeFileSync(join(dir, ORDER_FILE), '{"kinds": ["ui"]}')
    expect((loadOrder([app, dir]) as any).kinds[0]).toBe('ui')
    writeFileSync(join(app, ORDER_FILE), '{"kinds": ["refactor"]}')
    expect((loadOrder([app, dir]) as any).kinds[0]).toBe('refactor')
    writeFileSync(join(app, ORDER_FILE), '{"kinds": ["bogus"]}')
    expect((loadOrder([app, dir]) as any).error).toContain('unknown kind "bogus"')
  })

  test('the order decides which kind starts first in a run, and keeps the speed order inside a kind', () => {
    const mk = (id: string, group: string) => ({ id, group, tier: 'fast', lane: 'free', title: id, estSeconds: 20, run: { cmd: 'node' } })
    const checks = [mk('a-ui', 'ui'), mk('b-sec', 'security'), mk('c-ui', 'ui'), mk('d-fn', 'functionality')]
    const base = { tier: 'fast', only: [], include: [], mode: 'all', changedFiles: null, groups: [] }
    expect(selectChecks(checks, base).run.map((c: any) => c.id)).toEqual(['a-ui', 'b-sec', 'c-ui', 'd-fn'])
    const ordered = selectChecks(checks, { ...base, kindOrder: parseOrder('{"kinds": ["functionality", "ui"]}').kinds as string[] })
    expect(ordered.run.map((c: any) => c.id)).toEqual(['d-fn', 'a-ui', 'c-ui', 'b-sec'])
    expect(orderByKind(checks, null)).toBe(checks)
  })
})
