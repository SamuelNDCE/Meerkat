// meerkat plan brief (lib/planbrief.mjs): section order, unknown id, truncation, cap.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
let repo = ''
let n = 0
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, goal: `do ${id}`, owns: [`src/${id}`], done: 'npm test -- a', timeMinutes: 20, maxTurns: 40, ...extra })
function plan(obj: unknown) {
  const f = join(repo, `plan-${n++}.json`)
  writeFileSync(f, JSON.stringify(obj))
  return f
}
function brief(file: string, ...more: string[]) {
  const r = spawnSync(process.execPath, [BIN, 'plan', 'brief', file, ...more], { cwd: repo, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const SECTIONS = ['Goal', 'Task and dependencies', 'Files you own', 'Done when', 'Gate', 'Limits', 'Report format']

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-planbrief-')))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
})
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('plan brief', () => {
  test('sections appear in the fixed order with the right content', () => {
    const f = plan({ version: 1, tasks: [task('a'), task('b', { dependsOn: ['a'], gate: 'full', notes: 'mind the cache' })] })
    const r = brief(f, 'b')
    expect(r.code).toBe(0)
    let at = -1
    for (const s of SECTIONS) {
      const i = r.out.indexOf(s)
      expect(i, s).toBeGreaterThan(at)
      at = i
    }
    expect(r.out).toContain('npm test -- a')
    expect(r.out).toContain('src/b')
    expect(r.out).toMatch(/merged[\s\S]*\ba\b/)
    expect(r.out).toContain('full')
    expect(r.out).toContain('blocking count')
    expect(r.out).toContain('log folder')
    expect(r.out).toContain('20')
    expect(r.out).toContain('40')
    expect(r.out).toContain('mind the cache')
  })
  test('default gate is quick', () => {
    expect(brief(plan({ version: 1, tasks: [task('a')] }), 'a').out).toContain('quick')
  })
  test('unknown task id is usage (2)', () => {
    const r = brief(plan({ version: 1, tasks: [task('a')] }), 'zzz')
    expect(r.code).toBe(2)
    expect(r.err + r.out).toContain('zzz')
  })
  test('a plan that fails plan check is refused (1)', () => {
    expect(brief(plan({ version: 1, tasks: [task('a', { owns: ['lib'] }), task('b', { owns: ['lib'] })] }), 'a').code).toBe(1)
    expect(brief(plan({ version: 1, tasks: [task('a', { bogus: 1 })] }), 'a').code).toBe(1)
  })
  test('over the cap: goal and notes are truncated with a visible marker, fixed sections stay', () => {
    const f = plan({ version: 1, tasks: [task('a', { goal: 'g'.repeat(5000), notes: 'n'.repeat(3000) })] })
    const r = brief(f, 'a')
    expect(r.code).toBe(0)
    expect(r.out.length).toBeLessThanOrEqual(4000)
    expect(r.out).toContain('[truncated]')
    for (const s of SECTIONS) expect(r.out).toContain(s)
    expect(r.out).toContain('npm test -- a')
  })
  test('over the cap: a long owned-file list is cut to its first N plus a count', () => {
    const owns = Array.from({ length: 200 }, (_, i) => `src/a/file-number-${i}.mjs`)
    const r = brief(plan({ version: 1, tasks: [task('a', { owns })] }), 'a', '--max-chars', '1500')
    expect(r.code).toBe(0)
    expect(r.out.length).toBeLessThanOrEqual(1500)
    expect(r.out).toMatch(/and \d+ more/)
    expect(r.out).toContain('src/a/file-number-0.mjs')
  })
  test('still over the cap: exit 2 and says so', () => {
    const r = brief(plan({ version: 1, tasks: [task('a')] }), 'a', '--max-chars', '100')
    expect(r.code).toBe(2)
    expect(r.err + r.out).toMatch(/cap|max-chars/)
  })
  test('a bad --max-chars is usage (2)', () => {
    expect(brief(plan({ version: 1, tasks: [task('a')] }), 'a', '--max-chars', 'x').code).toBe(2)
  })
})
