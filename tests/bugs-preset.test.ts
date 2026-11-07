// The bugs preset (lib/bugs-preset.mjs): the quick run without style, documentation and housekeeping rules. Every excluded id must exist
// (a rename cannot silently bring a rule back), the preset must run none of them, and it must be listed in the preset output.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { BUGS_EXCLUDED_CHECKS, BUGS_EXCLUDED_SUBS } from '../lib/bugs-preset.mjs'
// @ts-expect-error plain JS module
import { applyPresetExclusions, PRESETS, resolvePreset } from '../lib/presets.mjs'
import { selectChecks } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-rust-plus.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-bugs-'))
  made.push(d)
  return d
}
const everyCheck = async () => {
  const out: any[] = []
  for (const p of readdirSync(join(ROOT, 'packs'))) out.push(...(await loadChecks(join(ROOT, 'packs', p))))
  return out
}

describe('the bugs preset', () => {
  test('every excluded check and rule exists in the registry and has a one-line reason', async () => {
    const ids = new Set((await everyCheck()).map((c) => c.id))
    for (const [id, why] of Object.entries(BUGS_EXCLUDED_CHECKS)) {
      expect(ids.has(id), `excluded check ${id} no longer exists`).toBe(true)
      expect(String(why).length, `reason for ${id}`).toBeGreaterThan(5)
    }
    for (const [ref, why] of Object.entries(BUGS_EXCLUDED_SUBS)) {
      const [check, rule] = ref.split('/')
      expect(ids.has(check), `excluded rule ${ref}: check ${check} no longer exists`).toBe(true)
      expect((CHECK_TABLES[check] ?? []).some((r: any) => r.id === rule), `excluded rule ${ref} no longer exists`).toBe(true)
      expect(String(why).length, `reason for ${ref}`).toBeGreaterThan(5)
    }
  })

  test('it is the quick run with exclusions, and never excludes a security check', async () => {
    const { preset } = resolvePreset('bugs')
    const quick = PRESETS.quick
    expect(preset.tier).toBe(quick.tier)
    expect(preset.skipCompile).toBe(true)
    expect(preset.allPacks).toBe(true)
    expect(preset.excludeChecks.length).toBe(Object.keys(BUGS_EXCLUDED_CHECKS).length)
    const byId = new Map((await everyCheck()).map((c) => [c.id, c]))
    for (const id of Object.keys(BUGS_EXCLUDED_CHECKS)) expect(byId.get(id).group, `${id} is a security check`).not.toBe('security')
  })

  test('it runs no excluded check and turns off every excluded rule', async () => {
    const { preset } = resolvePreset('bugs')
    const checks = await everyCheck()
    const applied: any = { checks: [...checks], all: checks, disabled: [], disabledSubs: [], notes: [] }
    applyPresetExclusions(applied, preset)
    const sel = selectChecks(applied.checks, { tier: preset.tier, only: [], include: [], mode: 'all', changedFiles: null, groups: preset.groups, skipCompile: true })
    const ran = new Set(sel.run.map((c: any) => c.id))
    for (const id of Object.keys(BUGS_EXCLUDED_CHECKS)) expect(ran.has(id), `${id} still runs`).toBe(false)
    expect(applied.disabled.map((d: any) => d.id).sort()).toEqual(Object.keys(BUGS_EXCLUDED_CHECKS).sort())
    expect([...applied.disabledSubs].sort()).toEqual(Object.keys(BUGS_EXCLUDED_SUBS).sort())
  })

  test('end to end: quick reports an undocumented public function, bugs does not, and both still report a real defect', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'lib.rs'), 'pub fn parse(s: &str) -> u32 {\n    s.parse().unwrap()\n}\n')
    const run = (preset: string) => {
      const logs = join(dir, `logs-${preset}`)
      const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--preset', preset, '--only', 'rp-api-ffi-wasm,rp-errors', '--plain'], { env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_TIMINGS: join(dir, `t-${preset}.json`), NO_COLOR: '1' }, encoding: 'utf8', timeout: 90_000 })
      const files: string[] = []
      const walk = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(join(d, e.name)) : e.name === 'findings.json' && files.push(join(d, e.name)))
      }
      walk(logs)
      const found = files.length ? JSON.parse(readFileSync(files[0], 'utf8')).findings : []
      return { out: r.stdout + r.stderr, rules: new Set(found.map((f: any) => f.rule)) }
    }
    const quick = run('quick')
    const bugs = run('bugs')
    expect(quick.rules.has('rapi-pub-fn-undocumented')).toBe(true)
    expect(bugs.rules.has('rapi-pub-fn-undocumented')).toBe(false)
    for (const ref of Object.keys(BUGS_EXCLUDED_SUBS)) expect(bugs.rules.has(ref.split('/')[1]), ref).toBe(false)
    expect(bugs.rules.has('rerr-parse-unwrap')).toBe(true)
  }, 180_000)

  test('it is listed in the preset list', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', ROOT, '--list-presets'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NO_COLOR: '1' } })
    expect(r.stdout).toMatch(/^bugs\s+bundled\s+fast/m)
  })
})
