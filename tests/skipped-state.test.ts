// A style tool the project never configured is SKIPPED (with the reason); a configured tool that cannot run stays NOT RUN.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { runOne, summarise } from '../lib/runner.mjs'
import { tool } from '../lib/tool-check.mjs'
import { toolConfigured } from '../lib/toolconfig.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-skipped-'))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const ctxFor = (d: string, env: Record<string, string> = {}) => ({ appDir: d, repoRoot: d, env: { ...process.env, MEERKAT_HOME: dir(), ...env }, platform: process.platform, exists: () => false }) as any
const eslintCheck = () => tool({ id: 'eslint', config: true, bin: 'eslint', args: ['.'], fixture: ['x'], install: 'npm i -D eslint', title: 'ESLint' })

describe('SKIPPED versus NOT RUN for style tools', () => {
  test('no configuration: SKIPPED with the reason, even when the tool is not installed', async () => {
    const d = dir()
    writeFileSync(join(d, 'a.js'), 'var x = 1\n')
    for (const bin of ['eslint', 'prettier', 'stylelint']) {
      const check = tool({ id: bin, config: true, bin, args: ['.'], fixture: ['x'], install: `npm i -D ${bin}`, title: bin })
      const r = await runOne(check, ctxFor(d, { PATH: '' }))
      expect(r.status).toBe('SKIPPED')
      expect(r.detail).toContain(`no ${bin} configuration in this project`)
    }
  })
  test('configured but the tool is missing: NOT RUN, not SKIPPED', async () => {
    const d = dir()
    writeFileSync(join(d, 'eslint.config.js'), 'export default []\n')
    const r = await runOne(eslintCheck(), ctxFor(d, { PATH: '' }))
    expect(r.status).toBe('NOT RUN')
  })
  test('config-guard exits 74 SKIPPED without a configuration, 75 NOT RUN when configured and the tool is missing', () => {
    const guard = join(ROOT, 'thorough/config-guard.mjs')
    const bare = dir()
    const a = spawnSync(process.execPath, [guard, '--bin', 'stylelint', '--root', bare, '--', '.'], { cwd: bare, encoding: 'utf8', env: { ...process.env, PATH: '', MEERKAT_HOME: dir() } })
    expect(a.status).toBe(74)
    expect(a.stdout).toContain('SKIPPED: no stylelint configuration in this project')
    const cfg = dir()
    writeFileSync(join(cfg, '.stylelintrc.json'), '{}\n')
    const b = spawnSync(process.execPath, [guard, '--bin', 'stylelint', '--root', cfg, '--', '.'], { cwd: cfg, encoding: 'utf8', env: { ...process.env, PATH: '', MEERKAT_HOME: dir() } })
    expect(b.status).toBe(75)
    expect(b.stdout).toContain('NOT RUN')
  })
  test('toolConfigured sees a package.json key', () => {
    const d = dir()
    writeFileSync(join(d, 'package.json'), '{"prettier":{}}\n')
    expect(toolConfigured('prettier', d)).toBe(true)
    expect(toolConfigured('eslint', d)).toBe(false)
  })
  test('the summary line counts SKIPPED apart from NOT RUN and does not fail the run', () => {
    const s = summarise('quick', [{ status: 'PASS' }, { status: 'SKIPPED' }, { status: 'SKIPPED' }], 0, 1000)
    expect(s.line).toContain('0 not run, 2 not configured, 0 skipped')
    expect(s.exitCode).toBe(0)
    const t = summarise('quick', [{ status: 'PASS' }, { status: 'NOT RUN' }], 0, 1000)
    expect(t.exitCode).toBe(1)
    expect(t.line).not.toContain('not configured')
  })
})

describe('the quick preset on a fixture with no eslint, prettier or stylelint configuration', () => {
  test('prints SKIPPED lines with a reason, counts them apart, writes them to summary.json, and exits 0', () => {
    const d = dir()
    const home = dir()
    writeFileSync(join(d, 'package.json'), '{"name":"demo","version":"1.0.0"}\n')
    writeFileSync(join(d, 'a.js'), 'export const a = 1\n')
    writeFileSync(join(d, 'a.css'), 'a { color: red; }\n')
    mkdirSync(join(d, 'src'), { recursive: true })
    const run = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', d, '--preset', 'quick', '--plain'], { cwd: d, encoding: 'utf8', timeout: 120000, env: { ...process.env, HOME: home, USERPROFILE: home, MEERKAT_HOME: home } })
    const out = String(run.stdout) + String(run.stderr)
    expect(out).toMatch(/SKIPPED\s+(eslint|prettier|stylelint): no \w+ configuration in this project/)
    expect(out).not.toMatch(/NOT RUN\s+(eslint|prettier|stylelint)/)
    expect(out).toMatch(/\d+ not configured, \d+ skipped/)
  }, 150000)
})
