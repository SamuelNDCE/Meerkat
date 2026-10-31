// Finding the project's own tests (lib/discover.mjs) and `meerkat discover`. Temp fixture projects only; nothing here runs a project script.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { planCommand } from './cli.mjs'
import { execute } from './commands.mjs'
import { completionScript } from './completion.mjs'
import { classifyScript, discover, discoverChecks, discoverData, discoverText, expandShards, keyOf, readDiscoverSetting, windowCap } from './discover.mjs'
import { COMMANDS } from './help.mjs'

let dir: string
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}
const pkg = (scripts: Record<string, string>) => put('package.json', JSON.stringify({ name: 'fx', scripts }))
const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id)
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-disc-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('which scripts are tests', () => {
  test('test-like names yes, build and watch no', () => {
    expect(classifyScript('test', 'vitest run').use).toBe(true)
    expect(classifyScript('verify:clicks', 'node x.js').use).toBe(true)
    expect(classifyScript('e2e', 'playwright test').use).toBe(true)
    expect(classifyScript('build', 'tsc').use).toBe(false)
    expect(classifyScript('test:watch', 'vitest').use).toBe(false)
    expect(classifyScript('test', 'vitest --watch').use).toBe(false)
    expect(classifyScript('verify:all', 'npm run a && npm run b').use).toBe(false)
  })
  test('finds scripts, skips build and lint', () => {
    pkg({ test: 'vitest run', e2e: 'playwright test', build: 'tsc', lint: 'eslint .', smoke: 'node smoke.js', 'verify:ui': 'node v.js' })
    const r = discover(dir)
    expect(ids(r).sort()).toEqual(['found-e2e', 'found-smoke', 'found-test', 'found-verify-ui'])
    expect(r.items.find((i: { id: string }) => i.id === 'found-e2e')).toMatchObject({ lane: 'windows', weight: 'alone', cmd: 'npm', args: ['run', 'e2e'] })
    expect(r.items.find((i: { id: string }) => i.id === 'found-test')).toMatchObject({ lane: 'free', weight: 'heavy' })
  })
  test('Makefile targets and Playwright and Cypress configs', () => {
    put('Makefile', 'test:\n\techo hi\ncheck:\n\techo\nbuild:\n\techo\n')
    put('playwright.config.ts', 'export default {}')
    put('cypress.config.js', 'module.exports = {}')
    const r = discover(dir)
    expect(ids(r).sort()).toEqual(['found-cypress', 'found-make-check', 'found-make-test', 'found-playwright'])
    expect(r.items.find((i: { id: string }) => i.id === 'found-playwright')).toMatchObject({ lane: 'windows', weight: 'alone', cmd: 'npx' })
  })
  test('scripts/ files named like click, smoke, e2e or verify; others ignored', () => {
    put('scripts/click-all.js', 'process.exit(0)')
    put('scripts/build.js', 'x')
    put('scripts/verify-helper.js', 'x')
    expect(ids(discover(dir))).toEqual(['found-script-click-all'])
  })
})

describe('lanes', () => {
  test('electron in the script file puts it on the windows lane (first 4000 characters)', () => {
    put('scripts/runner.js', "const { app, BrowserWindow } = require('electron')")
    put('scripts/other.js', 'console.log(1)')
    pkg({ 'verify:app': 'node scripts/runner.js', 'verify:pure': 'node scripts/other.js' })
    const r = discover(dir)
    expect(r.items.find((i: { id: string }) => i.id === 'found-verify-app').lane).toBe('windows')
    expect(r.items.find((i: { id: string }) => i.id === 'found-verify-pure').lane).toBe('free')
  })
  test('the found check is data: thorough, 900 s, no shell, windows env, origin discovered', () => {
    pkg({ 'test:e2e': 'playwright test' })
    const c = discoverChecks(dir, { cpuCount: 8 }).checks[0]
    expect(c).toMatchObject({ id: 'found-test-e2e', origin: 'discovered', tier: 'thorough', timeoutSeconds: 900, lane: 'windows', found: true })
    expect(c.run).toMatchObject({ cmd: 'npm', args: ['run', 'test:e2e'] })
    expect(c.run.env).toMatchObject({ HEADLESS: '1', CI: '1', MEERKAT_SHARD: '1/1' })
    expect(typeof c.run).not.toBe('function')
  })
  test('window cap: default 3, never above CPU count minus one', () => {
    expect(windowCap(undefined, 16)).toBe(3)
    expect(windowCap(8, 4)).toBe(3)
    expect(windowCap(3, 2)).toBe(1)
    expect(windowCap(3, 1)).toBe(1)
  })
})

describe('what is skipped', () => {
  test('a command a loaded check already runs is not found again', () => {
    pkg({ test: 'vitest run', 'verify:ui': 'node v.js' })
    const r = discover(dir, { checks: [{ id: 'my-test', run: { cmd: 'npm', args: ['run', 'test'] } }] })
    expect(ids(r)).toEqual(['found-verify-ui'])
    expect(r.skipped.some((s: { why: string }) => /already has/.test(s.why))).toBe(true)
  })
  test('a script file a loaded check runs is skipped', () => {
    pkg({ 'verify:ui': 'node scripts/v.js' })
    put('scripts/v.js', 'x')
    expect(discover(dir, { checks: [{ id: 'x', run: { cmd: 'node', args: ['scripts/v.js'] } }] }).items).toHaveLength(0)
  })
  test('the file a package script points at is not listed twice', () => {
    pkg({ 'verify:ui': 'node scripts/verify-ui.js' })
    put('scripts/verify-ui.js', 'x')
    expect(ids(discover(dir))).toEqual(['found-verify-ui'])
  })
  test('keyOf ignores --prefix', () => {
    expect(keyOf('npm', ['--prefix', 'a', 'run', 'test'])).toBe(keyOf('npm', ['run', 'test']))
  })
})

describe('sharding', () => {
  test('a --shard script runs as N checks with MEERKAT_SHARD, capped', () => {
    pkg({ 'test:e2e': 'playwright test --shard=1/1' })
    const f = discoverChecks(dir, { cpuCount: 16 })
    expect(f.checks.map((c: { id: string }) => c.id)).toEqual(['found-test-e2e-shard-1', 'found-test-e2e-shard-2', 'found-test-e2e-shard-3'])
    expect(f.checks.map((c: { run: { env: Record<string, string> } }) => c.run.env.MEERKAT_SHARD)).toEqual(['1/3', '2/3', '3/3'])
    expect(f.checks[0].run.args).toContain('--shard=1/3')
    expect(f.checks.every((c: { lane: string; run: { env: Record<string, string> } }) => c.lane === 'windows' && c.run.env.HEADLESS === '1')).toBe(true)
  })
  test('config discover.shards sets the count; maxWindows and the CPU count cap it', () => {
    pkg({ 'test:clicks': 'node click.js', 'verify:other': 'node o.js' })
    const settings = readDiscoverSetting({ maxWindows: 4, shards: { script: 'test:clicks', count: 6 } }).value
    const n = (cpu: number) => discoverChecks(dir, { project: settings, cpuCount: cpu }).checks.filter((c: { id: string }) => c.id.includes('clicks')).length
    expect(n(16)).toBe(4)
    expect(n(3)).toBe(2)
    const one = discoverChecks(dir, { project: readDiscoverSetting({ shards: { script: 'test:clicks', count: 1 } }).value, cpuCount: 8 })
    expect(one.checks.filter((c: { id: string }) => c.id.includes('clicks'))).toHaveLength(1)
  })
  test('a SHARD env script gets SHARD=i/n and a scripts/*shard* file is split', () => {
    pkg({ 'verify:x': 'cross-env SHARD=1 node x.js' })
    put('scripts/click-shards.js', 'process.exit(0) // electron')
    const f = discoverChecks(dir, { cpuCount: 8 })
    const x = f.checks.filter((c: { id: string }) => c.id.startsWith('found-verify-x-shard'))
    expect(x[0].run.env.SHARD).toBe('1/3')
    expect(f.checks.filter((c: { id: string }) => c.id.startsWith('found-script-click-shards-shard'))).toHaveLength(3)
  })
  test('expandShards leaves an unshardable item alone', () => {
    const it = { id: 'a', shardable: null }
    expect(expandShards(it, { cap: 3, cpuCount: 8 })).toEqual([it])
  })
})

describe('opt-out and settings', () => {
  test('"discover": false (project or personal) turns it off', () => {
    pkg({ test: 'vitest run' })
    expect(discoverChecks(dir, { project: false }).enabled).toBe(false)
    expect(discoverChecks(dir, { personal: false }).checks).toEqual([])
    expect(discoverChecks(dir, {}).checks).toHaveLength(1)
  })
  test('a bad setting is noted and ignored', () => {
    expect(readDiscoverSetting('yes').notes[0]).toMatch(/must be false or an object/)
    expect(readDiscoverSetting({ maxWindows: 99 }).notes[0]).toMatch(/1 to 32/)
  })
  test('quick and ci never discover: the gate in run.mjs is the thorough tier with every pack', async () => {
    const { PRESETS } = await import('./presets.mjs')
    const gate = (name: string) => PRESETS[name].tier === 'thorough' && PRESETS[name].allPacks === true
    for (const name of ['full', 'thorough', 'release']) expect(gate(name)).toBe(true)
    for (const name of ['quick', 'fast', 'ci']) if (PRESETS[name]) expect(gate(name)).toBe(false)
  })
})

describe('disable and override reach found checks', () => {
  const base = () => pkg({ test: 'vitest run', 'verify:ui': 'node v.js', 'test:e2e': 'playwright test --shard=1/1' })
  test('disable by id, by script (all its shards) and by suite:found', () => {
    base()
    const a = discoverChecks(dir, { config: { disable: ['found-verify-ui'] }, cpuCount: 8 })
    expect(a.checks.map((c: { id: string }) => c.id)).not.toContain('found-verify-ui')
    expect(a.result.disabled.map((d: { id: string }) => d.id)).toEqual(['found-verify-ui'])
    expect(a.result.items.map((i: { id: string }) => i.id)).not.toContain('found-verify-ui')
    const b = discoverChecks(dir, { config: { disable: ['found-test-e2e'] }, cpuCount: 8 })
    expect(b.checks.some((c: { id: string }) => c.id.startsWith('found-test-e2e'))).toBe(false)
    expect(discoverChecks(dir, { config: { disable: ['suite:found'] } }).checks).toEqual([])
  })
  test('a disabled command is not rediscovered when the disabled checks are in `existing`', () => {
    base()
    const existing = [{ id: 'own-test', run: { cmd: 'npm', args: ['run', 'test'] } }]
    expect(discoverChecks(dir, { existing }).checks.map((c: { id: string }) => c.id)).not.toContain('found-test')
  })
  test('override changes a found check and a bad override is refused', () => {
    base()
    const f = discoverChecks(dir, { config: { override: { 'found-verify-ui': { timeoutSeconds: 60, estSeconds: 5 }, 'found-test': { tier: 'bogus' } } } })
    expect(f.checks.find((c: { id: string }) => c.id === 'found-verify-ui')).toMatchObject({ timeoutSeconds: 60, estSeconds: 5, overridden: true })
    expect(f.checks.find((c: { id: string }) => c.id === 'found-test').tier).toBe('thorough')
    expect(f.result.notes.join(' ')).toMatch(/override "found-test"/)
  })
})

describe('safe to print', () => {
  const esc = '\u001b]0;pwned\u0007\u009b31m'
  test('escape and C1 characters never reach the text or the data', () => {
    pkg({ test: 'vitest run', [`verify:${esc}x`]: 'node v.js' })
    put('Makefile', 'test:\n')
    const data = discoverData(discoverChecks(dir, {}), `${dir}${esc}`)
    const blob = JSON.stringify(data) + discoverText(data, `${dir}${esc}`)
    expect(blob).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    expect(blob).not.toContain('\\u001b')
  })
  test('hostile strings in rows and skipped lists are cleaned', () => {
    const data = { enabled: true, maxWindows: 3, items: [{ id: `a${esc}`, title: esc, script: esc, source: esc, why: esc, command: `npm${esc}`, lane: 'free', weight: 'heavy', estimateSeconds: 1, shard: null, note: esc }], skipped: [{ what: esc, why: esc }], turnedOff: [], notes: [esc] }
    expect(discoverText(data, esc)).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
  })
  test('items itemToCheck rejects are dropped, not listed', () => {
    pkg({ [`verify:${'a'.repeat(80)}`]: 'node v.js', test: 'vitest' })
    const f = discoverChecks(dir, {})
    expect(f.result.items.map((i: { id: string }) => i.id)).toEqual(['found-test'])
    expect(f.result.notes.length).toBeGreaterThan(0)
  })
})

describe('MEERKAT_NO_PROJECT_CODE and no-run', () => {
  test('items are listed from names but no referenced script file is read', () => {
    pkg({ 'verify:app': 'node scripts/runner.js' })
    put('scripts/runner.js', "require('electron') // opens a window")
    const open = discoverChecks(dir, { noProjectCode: false })
    const shut = discoverChecks(dir, { noProjectCode: true })
    expect(open.result.items[0].lane).toBe('windows')
    expect(shut.result.items).toHaveLength(1)
    expect(shut.result.items[0].lane).toBe('free')
    expect(shut.result.items[0].sniffed).toBe(false)
  })
  test('discovery never runs anything', () => {
    pkg({ test: "node -e \"require('fs').writeFileSync('ran.txt','x')\"", 'verify:x': 'node boom.js' })
    put('boom.js', "require('fs').writeFileSync('ran2.txt','x')")
    discoverChecks(dir, {})
    expect(existsSync(join(dir, 'ran.txt'))).toBe(false)
    expect(existsSync(join(dir, 'ran2.txt'))).toBe(false)
  })
})

describe('meerkat discover', () => {
  const env = () => ({ MEERKAT_USER_CONFIG: join(dir, 'u.json'), MEERKAT_LOG_DIR: join(dir, 'logs') })
  const presets = { user: {}, project: {} }
  const go = async (argv: string[]) => {
    const o: string[] = []
    const e: string[] = []
    const p = planCommand(argv, { cwd: dir, env: env(), interactive: false, presets })
    const code = await execute(p, { out: (t: string) => o.push(t), err: (t: string) => e.push(t), env: env(), cwd: dir, interactive: false, presets, version: '0' })
    return { code, out: o.join('\n'), err: e.join('\n') }
  }
  test('plans, is documented and tab-completes', () => {
    expect(planCommand(['discover'], { cwd: dir, env: {}, interactive: false, presets })).toMatchObject({ noun: 'discover', verb: 'list', folder: dir })
    expect(COMMANDS.some((c: { name: string }) => c.name === 'discover')).toBe(true)
    expect(completionScript('powershell')).toContain("'discover'")
    expect(completionScript('bash')).toContain('discover')
  })
  test('lists what would run, as text and JSON', async () => {
    pkg({ test: 'vitest run', 'test:e2e': 'playwright test' })
    const t = await go(['discover'])
    expect(t.code).toBe(0)
    expect(t.out).toMatch(/2 tests found/)
    expect(t.out).toMatch(/nothing was run/)
    const j = JSON.parse((await go(['discover', '--json'])).out)
    expect(j.items.map((i: { id: string }) => i.id).sort()).toEqual(['found-test', 'found-test-e2e'])
    expect(j.items[0]).toHaveProperty('estimateSeconds')
    expect(j.enabled).toBe(true)
  })
  test('says so when discovery is off, and a disabled found check is reported', async () => {
    pkg({ test: 'vitest run' })
    put('meerkat.config.json', JSON.stringify({ packs: [], discover: false }))
    expect((await go(['discover'])).out).toMatch(/turned off/)
    put('meerkat.config.json', JSON.stringify({ packs: [], disable: ['found-test'] }))
    const r = await go(['discover'])
    expect(r.out).toMatch(/Turned off by your config/)
    expect(r.err).not.toMatch(/no such check/)
  })
})
