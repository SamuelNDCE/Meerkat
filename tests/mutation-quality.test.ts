// The three quality checks beside mutation testing (thorough/mutation-quality.mjs): tests-fail-without-source, assertion-strength,
// test-to-code-ratio. Each rule is proven by a bad and a good sample, and the checks run end to end on small fixtures.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import * as Q from '../thorough/mutation-quality.mjs'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-mutq-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        h.update(p.slice(dir.length))
        h.update(readFileSync(p))
      }
    }
  }
  walk(dir)
  return h.digest('hex')
}
function cli(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['thorough/mutation-quality.mjs', ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

describe('tests-fail-without-source', () => {
  test('a source file that no test depends on is reported, the others are not, and nothing is touched', async () => {
    const dir = folder(Q.FIX_FILES)
    const before = hashTree(dir)
    const r = await Q.testsFailWithoutSource(dir, {}, () => {})
    expect(r.status).toBe('ok')
    expect(r.untested).toEqual(['orphan.js'])
    expect(r.checked.find((c: any) => c.file === 'used.js').failed).toBe(true)
    expect(r.checked.find((c: any) => c.file === 'used.js').imports).toBe(1)
    expect(hashTree(dir)).toBe(before)
    expect(existsSync(r.tmpDir)).toBe(false)
  }, 55_000)

  test('exit codes, the finding line and --fixtures', () => {
    const dir = folder(Q.FIX_FILES)
    const r = cli(['tests-fail-without-source', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/MEERKAT-SUB FAIL tests-fail-without-source 1 of 2/)
    expect(r.out).toMatch(/MEERKAT-FINDING medium untested-file orphan\.js:1 /)
    expect(cli(['tests-fail-without-source', '--fixtures']).code).toBe(1)
    const { 'orphan.js': _gone, ...rest } = Q.FIX_FILES as Record<string, string>
    const ok = folder(rest)
    const good = cli(['tests-fail-without-source', '--root', ok])
    expect(good.code).toBe(0)
    expect(good.out).toMatch(/MEERKAT-SUB PASS tests-fail-without-source/)
  }, 58_000)

  test('a compiled project, no tests and a failing baseline are NOT RUN (75)', () => {
    expect(cli(['tests-fail-without-source', '--root', folder({ 'go.mod': 'module x\n', 'a.go': 'package x\n' })]).code).toBe(75)
    expect(cli(['tests-fail-without-source', '--root', folder({ 'notes.txt': 'x\n' })]).code).toBe(75)
    const red = folder({ ...Q.FIX_FILES, 'used.test.js': "import { test } from 'node:test'\ntest('red', () => { throw new Error('x') })\n" })
    const r = cli(['tests-fail-without-source', '--root', red])
    expect(r.code).toBe(75)
    expect(r.out).toMatch(/tests fail before/)
  }, 40_000)
})

describe('assertion-strength', () => {
  test('every rule is proven and the ids are unique', () => {
    expect(Q.proveStrength()).toEqual([])
    expect(new Set(Q.STRENGTH_IDS).size).toBe(Q.STRENGTH_IDS.length)
    expect(Q.STRENGTH_IDS.length).toBe(5)
  })

  const bad: Record<string, string> = {
    'defined-after-assignment': "import { a } from '../a.js'\ntest('x', () => {\n  const out = a()\n  expect(out).toBeDefined()\n  expect(out.n).toBe(1)\n})\n",
    'truthy-on-object': "import { a } from '../a.js'\ntest('x', () => {\n  const out = { n: a() }\n  expect(out).toBeTruthy()\n  expect(out.n).toBe(1)\n})\n",
    'only-defined-or-truthy': "import { a } from '../a.js'\ntest('x', () => {\n  expect(a()).toBeTruthy()\n})\n",
    'only-not-throw': "import { a } from '../a.js'\ntest('x', () => {\n  expect(() => a()).not.toThrow()\n})\n",
    'mock-call-only': "import { a } from '../a.js'\ntest('x', () => {\n  const spy = vi.fn()\n  a(spy)\n  expect(spy).toHaveBeenCalledWith(1)\n})\n",
  }
  for (const [rule, body] of Object.entries(bad)) {
    test(`${rule} fails on its bad pattern`, () => {
      const r = cli(['assertion-strength', '--root', folder({ 'a.js': 'export const a = () => 1\n', 'a.test.js': body })])
      expect(r.out).toMatch(new RegExp(`MEERKAT-SUB FAIL ${rule} `))
      expect(r.out).toMatch(new RegExp(`MEERKAT-FINDING low ${rule} a\\.test\\.js:\\d+ `))
      expect(r.code).toBe(1)
    }, 20_000)
  }

  test('strong tests, comments and an allow file are clean; Python is covered', () => {
    const good = "import { a } from '../a.js'\ntest('x', () => {\n  const out = a()\n  expect(out).toBe(1)\n  expect(out).toBeDefined()\n  // expect(out).toBeTruthy()\n})\ntest('y', () => {\n  expect(() => a()).not.toThrow()\n  expect(a()).toBe(1)\n})\n"
    const r = cli(['assertion-strength', '--root', folder({ 'a.js': 'export const a = () => 1\n', 'a.test.js': good })])
    expect(r.out).not.toMatch(/MEERKAT-SUB FAIL/)
    expect(r.code).toBe(0)
    const dir = folder({ 'a.js': 'x\n', 'a.test.js': bad['only-not-throw'], '.meerkat-assertion-strength-allow': 'only-not-throw a.test.js\n' })
    expect(cli(['assertion-strength', '--root', dir]).code).toBe(0)
    const py = cli(['assertion-strength', '--root', folder({ 'calc.py': 'def f():\n    return 1\n', 'test_calc.py': 'from calc import f\n\n\ndef test_f():\n    x = f()\n    assert x is not None\n' })])
    expect(py.out).toMatch(/MEERKAT-SUB FAIL defined-after-assignment/)
    expect(py.out).toMatch(/MEERKAT-SUB FAIL only-defined-or-truthy/)
    expect(py.code).toBe(1)
  }, 30_000)

  test('a project without tests is NA on every rule; --fixtures fails', () => {
    const r = cli(['assertion-strength', '--root', folder({ 'a.js': 'x\n' })])
    expect(r.code).toBe(0)
    expect(r.out.split('\n').filter((l) => l.startsWith('MEERKAT-SUB NA')).length).toBe(Q.STRENGTH_IDS.length)
    expect(cli(['assertion-strength', '--fixtures']).code).toBe(1)
  }, 20_000)
})

describe('test-to-code-ratio', () => {
  const lines = (n: number) => 'export const f = () => 1\n'.repeat(n)
  test('folders are grouped, tests elsewhere that mention a folder count, and it never fails', () => {
    expect(Q.groupKey('src/auth/login.js')).toBe('src/auth')
    expect(Q.groupKey('src/auth/__tests__/login.test.js')).toBe('src/auth')
    expect(Q.groupKey('tests/api.test.js')).toBe('.')
    expect(Q.groupKey('server/app.js')).toBe('server')
    expect(Q.groupKey('index.js')).toBe('.')
    const dir = folder({ 'src/auth/login.js': lines(40), 'src/util/util.js': lines(40), 'src/tiny/t.js': lines(5), 'tests/util.test.js': "import { f } from '../src/util/util.js'\ntest('f', () => { expect(f()).toBe(1) })\n" })
    const r = cli(['test-to-code-ratio', '--root', dir])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-SUB PASS test-to-code-ratio informational/)
    expect(r.out).toMatch(/src\/auth .*NO TESTS/)
    expect(r.out).not.toMatch(/src\/util .*NO TESTS/)
    expect(r.out).not.toMatch(/src\/tiny .*NO TESTS/)
    expect(r.out).toMatch(/MEERKAT-FINDING info folder-without-tests src\/auth:0 /)
    expect(Q.ratioReport(dir).rows.filter((x: any) => x.flagged).map((x: any) => x.key)).toEqual(['src/auth'])
  }, 20_000)
  test('a project with no source is NA', () => {
    const r = cli(['test-to-code-ratio', '--root', folder({ 'README.md': 'x\n' })])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-SUB NA test-to-code-ratio/)
  }, 20_000)
})

describe('the pack entries', () => {
  test('the three checks are declared with the right tier and opt-in flag', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'mutation'))
    const get = (id: string) => checks.find((c: any) => c.id === id) as any
    expect(get('tests-fail-without-source')).toMatchObject({ optIn: 'mutation', weight: 'alone', tier: 'thorough', suite: 'test-hygiene', subs: 1 })
    expect(get('assertion-strength')).toMatchObject({ tier: 'fast', suite: 'test-hygiene', subs: Q.STRENGTH_IDS.length })
    expect(get('assertion-strength').optIn).toBeUndefined()
    expect(get('assertion-strength').selfTest.expectFail).toBe(true)
    expect(get('test-to-code-ratio')).toMatchObject({ tier: 'fast', subs: 1 })
    expect(get('test-to-code-ratio').optIn).toBeUndefined()
  })
})
