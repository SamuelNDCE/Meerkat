// meerkat plan check (lib/plan.mjs): schema, cycles, ownership overlap, exit codes, line 1.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
let repo = ''
const task = (id: string, extra: Record<string, unknown> = {}) => ({ id, goal: `do ${id}`, owns: [`src/${id}`], done: 'npm test', timeMinutes: 20, maxTurns: 40, ...extra })
let n = 0
function plan(obj: unknown, raw?: string) {
  const f = join(repo, `plan-${n++}.json`)
  writeFileSync(f, raw ?? JSON.stringify(obj))
  return f
}
function check(file: string, ...more: string[]) {
  const r = spawnSync(process.execPath, [BIN, 'plan', 'check', file, ...more], { cwd: repo, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr, line1: r.stdout.split('\n')[0] }
}

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-plan-')))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
})
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('plan check', () => {
  test('a clean plan passes, line 1 is the answer', () => {
    const r = check(plan({ version: 1, tasks: [task('a'), task('b', { dependsOn: ['a'] })] }))
    expect(r.code).toBe(0)
    expect(r.line1).toMatch(/^PASS \(status 200\): 2 tasks/)
  })
  test('invalid JSON is usage (2)', () => {
    const r = check(plan(null, '{not json'))
    expect(r.code).toBe(2)
    expect(r.line1).toMatch(/^USAGE \(status 400\)/)
  })
  test('unknown field, wrong type, duplicate id, unknown dependsOn are usage (2) and all listed in one pass', () => {
    const r = check(plan({ version: 1, colour: 'x', tasks: [task('a', { extra: 1 }), task('a'), task('b', { timeMinutes: 'ten' }), task('c', { dependsOn: ['zzz'] })] }))
    expect(r.code).toBe(2)
    expect(r.line1).toMatch(/\d+ errors/)
    for (const s of ['colour', 'extra', 'duplicate id', 'timeMinutes', 'zzz']) expect(r.out).toContain(s)
  })
  test('bad id pattern and empty owns are errors', () => {
    expect(check(plan({ version: 1, tasks: [task('Bad_Id')] })).code).toBe(2)
    expect(check(plan({ version: 1, tasks: [task('a', { owns: [] })] })).code).toBe(2)
  })
  test('missing or empty done / timeMinutes / maxTurns is FAIL (1)', () => {
    const noDone = { ...task('b') } as Record<string, unknown>
    delete noDone.done
    const r = check(plan({ version: 1, tasks: [task('a', { done: '  ' }), noDone, task('c', { timeMinutes: undefined }), task('d', { maxTurns: undefined })] }))
    expect(r.code).toBe(1)
    expect(r.line1).toMatch(/^FAIL \(status 422\): 4 errors: task a: no done-check/)
    expect(r.out).toContain('task d: no maxTurns')
  })
  test('zero or non-integer limits are a wrong value (2)', () => {
    expect(check(plan({ version: 1, tasks: [task('a', { timeMinutes: 0 })] })).code).toBe(2)
    expect(check(plan({ version: 1, tasks: [task('a', { maxTurns: 1.5 })] })).code).toBe(2)
  })
  test('a dependency cycle is FAIL (1) and names the cycle', () => {
    const r = check(plan({ version: 1, tasks: [task('a', { dependsOn: ['c'] }), task('b', { dependsOn: ['a'] }), task('c', { dependsOn: ['b'] })] }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/cycle: [abc] -> [abc] -> [abc] -> [abc]/)
  })
  test('self dependency is a cycle', () => {
    const r = check(plan({ version: 1, tasks: [task('a', { dependsOn: ['a'] })] }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('cycle: a -> a')
  })
  test('ownership overlap is FAIL (1): same file and directory prefix', () => {
    const same = check(plan({ version: 1, tasks: [task('a', { owns: ['lib/x.mjs'] }), task('b', { owns: ['lib/x.mjs'] })] }))
    expect(same.code).toBe(1)
    expect(same.line1).toMatch(/^FAIL \(status 422\)/)
    expect(same.out).toContain('a and b')
    const dir = check(plan({ version: 1, tasks: [task('a', { owns: ['lib'] }), task('b', { owns: ['lib/deep/x.mjs'] })] }))
    expect(dir.code).toBe(1)
  })
  test('a-b does not overlap a', () => {
    const r = check(plan({ version: 1, tasks: [task('a', { owns: ['src/a'] }), task('b', { owns: ['src/a-b'] })] }))
    expect(r.code).toBe(0)
  })
  test('overlap is allowed when one task transitively dependsOn the other, and the output says so', () => {
    const r = check(plan({ version: 1, tasks: [task('a', { owns: ['lib'] }), task('b', { owns: ['lib/x.mjs'], dependsOn: ['c'] }), task('c', { dependsOn: ['a'], owns: ['docs'] })] }))
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/overlap allowed/)
  })
  test('a path outside the repo is usage (2)', () => {
    expect(check(plan({ version: 1, tasks: [task('a', { owns: ['../elsewhere'] })] })).code).toBe(2)
  })
  test('zero tasks and a missing file are NO_RESULT (3)', () => {
    expect(check(plan({ version: 1, tasks: [] })).code).toBe(3)
    expect(check(join(repo, 'nope.json')).code).toBe(3)
  })
  test('--json carries exit code, status and errors', () => {
    const r = check(plan({ version: 1, tasks: [task('a', { owns: ['lib'] }), task('b', { owns: ['lib'] })] }), '--json')
    expect(r.code).toBe(1)
    const j = JSON.parse(r.out)
    expect(j.exitCode).toBe(1)
    expect(j.exitName).toBe('FAIL')
    expect(j.status).toBe(422)
    expect(j.errors.length).toBeGreaterThan(0)
  })
})
