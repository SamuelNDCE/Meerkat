// The quick and fast presets run only fast-tier checks: a thorough-tier check selected there would make quick as slow as full.
// Also: a project with no Dockerfile and no workflow gets "not applicable" (a PASS) from hadolint and actionlint, never NOT RUN.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS modules
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS modules
import { resolvePreset } from '../lib/presets.mjs'
// @ts-expect-error plain JS modules
import { selectChecks } from '../lib/runner.mjs'

const root = join(__dirname, '..')
type Check = { id: string; tier?: string; [key: string]: unknown }
const all: Check[] = []
for (const p of readdirSync(join(root, 'packs'))) all.push(...(await loadChecks(join(root, 'packs', p))))

describe('quick runs fast-tier checks only', () => {
  for (const name of ['quick', 'fast']) {
    test(`${name} selects no thorough-tier check`, () => {
      const p = resolvePreset(name).preset
      const run = selectChecks(all, { tier: p.tier, only: [], include: p.include, mode: 'all', changedFiles: null, groups: p.groups, skipCompile: p.skipCompile }).run as Check[]
      expect(run.length).toBeGreaterThan(50)
      expect(run.filter((c) => c.tier === 'thorough').map((c) => c.id)).toEqual([])
    })
  }
})

describe('hadolint and actionlint without a Dockerfile or workflow', () => {
  test('quick shows them as not applicable (PASS), not NOT RUN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-fp095-'))
    writeFileSync(join(dir, 'a.js'), 'export const a = 1\n')
    writeFileSync(join(dir, 'meerkat.config.json'), '{"packs":["infra"]}\n')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'x'], { cwd: dir })
    let out = ''
    try {
      out = execFileSync(process.execPath, [join(root, 'run.mjs'), '--app', dir, '--preset', 'quick', '--plain'], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e: any) {
      out = String(e.stdout ?? '')
    }
    for (const id of ['hadolint', 'actionlint']) {
      const line = out.split(/\r?\n/).find((l) => l.startsWith(`[PASS   ] ${id} `) || l.startsWith(`[NOT RUN] ${id}`) || l.startsWith(`[NOTRUN`) )
      expect(line, id).toContain('PASS')
      expect(line).toContain('not applicable')
    }
  }, 120000)
})
