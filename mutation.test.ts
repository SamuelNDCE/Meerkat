// Mutation testing (thorough/mutation.mjs): every mutator is proven, sampling is repeatable, the project is never touched,
// the temporary copy is removed, a hanging test is killed, and the score maths and threshold behave. Also the static test-quality check.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
// @ts-ignore
import * as M from './thorough/mutation.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/mutation.mjs'
const made: string[] = []
const LOGS = mkdtempSync(join(tmpdir(), 'meerkat-mutlogs-'))
made.push(LOGS)
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-muttest-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const PKG = '{"name":"x","type":"module"}\n'
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
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: LOGS } })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}
const weak = (extra = {}) => folder({ 'package.json': PKG, 'index.js': M.WEAK_SRC, 'index.test.js': M.WEAK_TEST, '.meerkat-budgets.json': M.BUDGET(extra) })
const strong = (extra = {}) => folder({ 'package.json': PKG, 'index.js': M.WEAK_SRC, 'index.test.js': M.STRONG_TEST, '.meerkat-budgets.json': M.BUDGET(extra) })

describe('every mutator is proven by a bad and a good sample', () => {
  test('there are at least 40 mutators in the 17 families, with unique ids', () => {
    expect(M.MUTATORS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(M.MUTATORS.map((m: any) => m.id)).size).toBe(M.MUTATORS.length)
    expect(new Set(M.MUTATORS.map((m: any) => m.family))).toEqual(new Set(M.FAMILIES))
  })
  for (const m of M.MUTATORS as any[]) {
    test(`${m.id}: bad is found, good is not`, () => {
      expect(typeof m.bad).toBe('string')
      expect(M.findInLine(m, m.bad, m.lang ?? 'js').length).toBeGreaterThan(0)
      expect(M.findInLine(m, m.good, m.lang ?? 'js')).toEqual([])
    })
  }
  const by = (id: string) => (M.MUTATORS as any[]).find((m) => m.id === id)
  test('language variants: Python, Rust and Go', () => {
    expect(M.findInLine(by('conditional-true'), 'if x > 1:', 'py')[0].to).toBe('True')
    expect(M.findInLine(by('return-nulled'), '    return total', 'py')[0].to).toBe('None')
    expect(M.findInLine(by('logical-and-or'), 'if a and b:', 'py')[0].to).toBe('or')
    expect(M.findInLine(by('conditional-false'), 'if a > b {', 'rs')[0].to).toBe('false')
    expect(M.findInLine(by('conditional-false'), 'if let Some(x) = y {', 'rs')).toEqual([])
    expect(M.findInLine(by('statement-removed'), '    cleanup()', 'py')[0].to).toBe('pass')
    expect(M.findInLine(by('string-method-swap'), 'ok = name.startswith(p)', 'py')[0].to).toBe('endswith')
    expect(M.findInLine(by('string-method-swap'), 'ok = name.endsWith(p)', 'js')[0].to).toBe('startsWith')
  })
  test('narrow rules: no log statements, no comments, no strings, no boundary inside generics', () => {
    expect(M.findSites('a.js', "console.log('a' + b)\n// x = a + b\nconst s = 'a + b'\nconst t = `${a} + ${b}`\n").filter((s: any) => s.family === 'arithmetic' || s.family === 'comparison')).toEqual([])
    expect(M.findSites('a.js', "/* a + b */ const q = 1\nconst re = /a + b/\n").filter((s: any) => s.mutator === 'arith-plus-minus')).toEqual([])
    expect(M.findSites('a.ts', 'const m: Map<string, number> = new Map()\n').filter((s: any) => s.family === 'comparison')).toEqual([])
    expect(M.findSites('a.js', 'import * as x from "y"\n')).toEqual([])
  })
  test('applyMutant changes exactly one place and keeps line endings', () => {
    const text = 'a = 1\r\nb = x + y\r\n'
    const site = M.findSites('a.py', text).find((s: any) => s.mutator === 'arith-plus-minus')
    expect(M.applyMutant(text, site)).toBe('a = 1\r\nb = x - y\r\n')
  })
})

describe('sampling', () => {
  const sites = M.findSites('index.js', M.WEAK_SRC)
  test('the same seed picks the same mutants, a different seed can differ', () => {
    const a = M.sampleSites(sites, { max: 6, seed: 1 })
    const b = M.sampleSites(sites, { max: 6, seed: 1 })
    expect(a).toEqual(b)
    expect(a).toHaveLength(6)
    const others = [2, 3, 4, 5, 6].map((s) => JSON.stringify(M.sampleSites(sites, { max: 6, seed: s })))
    expect(others.some((o) => o !== JSON.stringify(a))).toBe(true)
  })
  test('max is respected and recent files are favoured', () => {
    const two = [...sites.map((s: any) => ({ ...s, file: 'a.js' })), ...sites.map((s: any) => ({ ...s, file: 'b.js' }))]
    let a = 0
    for (let seed = 1; seed <= 30; seed++) a += M.sampleSites(two, { max: 4, seed, recent: new Set(['a.js']) }).filter((s: any) => s.file === 'a.js').length
    expect(a).toBeGreaterThan(30 * 2)
    expect(M.sampleSites(sites, { max: 0 })).toEqual([])
  })
  test('the pseudo random numbers repeat and stay in range', () => {
    const r1 = M.prng(7)
    const r2 = M.prng(7)
    for (let i = 0; i < 20; i++) {
      const x = r1()
      expect(x).toBe(r2())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('safety', () => {
  test('the original is never touched (hashed before and after, node_modules included) and the temp copy is removed', async () => {
    const dir = strong({ totalSeconds: 60 })
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1\n')
    const before = hashTree(dir)
    const r = await M.runMutation(dir, {}, () => {})
    expect(r.status).toBe('ok')
    expect(r.killed + r.survived).toBeGreaterThan(5)
    expect(hashTree(dir)).toBe(before)
    expect(existsSync(join(dir, 'node_modules', 'dep', 'index.js'))).toBe(true)
    expect(r.tmpDir).toBeTruthy()
    expect(existsSync(r.tmpDir)).toBe(false)
  }, 55_000)

  test('a failing baseline is NOT RUN, with a clear reason', async () => {
    const dir = folder({ 'package.json': PKG, 'index.js': M.WEAK_SRC, 'index.test.js': "import { test } from 'node:test'\ntest('fails', () => {\n  throw new Error('red')\n})\n", '.meerkat-budgets.json': M.BUDGET() })
    const r = await M.runMutation(dir, {}, () => {})
    expect(r.status).toBe('notrun')
    expect(r.message).toMatch(/tests fail before mutation/)
    expect(existsSync(r.tmpDir)).toBe(false)
    expect(cli(['mutation-testing', '--root', dir]).code).toBe(75)
  }, 40_000)

  test('no test command is NOT RUN', async () => {
    const dir = folder({ 'notes.txt': 'hello\n', 'a.js': 'export const a = 1 + 2\n' })
    const r = await M.runMutation(dir, {}, () => {})
    expect(r.status).toBe('notrun')
    expect(r.message).toMatch(/no test command/)
    expect(cli(['mutation-testing', '--root', dir]).code).toBe(75)
  })

  test('a test that hangs is killed at the per-mutant timeout and counts as killed', async () => {
    const src = 'export function count(n) {\n  let i = 0\n  let c = 0\n  while (i < n) {\n    c = c + 1\n    i++\n  }\n  return c\n}\n'
    const t = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { count } from './index.js'\ntest('count', () => {\n  assert.equal(count(3), 3)\n})\n"
    const dir = folder({ 'package.json': PKG, 'index.js': src, 'index.test.js': t, '.meerkat-budgets.json': M.BUDGET({ timeoutSeconds: 3, totalSeconds: 40 }) })
    const t0 = Date.now()
    const r = await M.runMutation(dir, {}, () => {})
    expect(r.status).toBe('ok')
    const hung = r.mutants.filter((m: any) => m.why === 'timed out')
    expect(hung.length).toBeGreaterThanOrEqual(1)
    expect(hung.every((m: any) => m.result === 'KILLED')).toBe(true)
    expect(Date.now() - t0).toBeLessThan(40_000)
  }, 55_000)

  test('the total time cap stops the run and reports partial (NOT RUN when fewer than 5 were tested)', async () => {
    const dir = weak({ totalSeconds: 5 })
    const r = await M.runMutation(dir, { totalSeconds: 5, maxMutants: 30, testCommand: [process.execPath, '-e', 'setTimeout(()=>{},1500)'] }, () => {})
    expect(r.status === 'notrun' || r.partial).toBe(true)
  }, 30_000)
})

describe('score, threshold and output', () => {
  test('score maths', () => {
    expect(M.scoreOf(3, 1)).toBe(75)
    expect(M.scoreOf(1, 2)).toBe(33.3)
    expect(M.scoreOf(5, 0)).toBe(100)
    expect(M.scoreOf(0, 4)).toBe(0)
    expect(M.scoreOf(0, 0)).toBeNull()
  })
  test('report: exit 1 below the minimum, 0 at or above it; NOT RUN is 75', () => {
    const cfg = (minScore: number) => ({ minScore })
    const mk = (killed: number, survived: number, minScore: number) => ({ status: 'ok', cfg: cfg(minScore), killed, survived, errors: 0, score: M.scoreOf(killed, survived), partial: false, mutants: [] })
    const quiet = () => {}
    expect(M.report(mk(6, 4, 60), quiet)).toBe(0)
    expect(M.report(mk(6, 4, 61), quiet)).toBe(1)
    expect(M.report(mk(0, 5, 0), quiet)).toBe(0)
    expect(M.report({ status: 'notrun', message: 'x' }, quiet)).toBe(75)
  })
  test('the weak test fails (exit 1, survivors listed), the strong test passes (exit 0)', () => {
    const w = cli(['mutation-testing', '--root', weak()])
    expect(w.code).toBe(1)
    expect(w.out).toMatch(/SURVIVED mutants/)
    expect(w.out).toMatch(/MEERKAT-SUB FAIL arithmetic/)
    const s = cli(['mutation-testing', '--root', strong()])
    expect(s.code).toBe(0)
    expect(s.out).toMatch(/mutation score: 100%/)
    expect(s.out).not.toMatch(/SURVIVED mutants/)
  }, 55_000)
  test('minScore 0 lets even the weak test pass; maxMutants limits the run; the seed gives the same picks', () => {
    const dir = weak()
    const a = cli(['mutation-testing', '--root', dir, '--min-score', '0', '--max-mutants', '6', '--parallel', '1'])
    expect(a.code).toBe(0)
    expect(a.out.match(/^\[\d+\/6\]/gm)).toHaveLength(6)
    const b = cli(['mutation-testing', '--root', dir, '--min-score', '0', '--max-mutants', '6', '--parallel', '1'])
    const picks = (o: string) => o.split('\n').filter((l) => /^\[\d+\//.test(l)).join('\n')
    expect(picks(a.out)).toBe(picks(b.out))
  }, 55_000)
  test('the output has no control characters and the result is clean JSON', async () => {
    const out = cli(['mutation-testing', '--root', weak()]).out
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out)).toBe(false)
    expect(M.clean('a\u001b[31mb\u0007c\u0000d\re')).toBe('a [31mb c d e')
    const r = await M.runMutation(weak(), { maxMutants: 4 }, () => {})
    expect(/[\u0000-\u001f\u007f]/.test(JSON.parse(JSON.stringify(r)).message)).toBe(false)
    expect(r.mutants.every((m: any) => !/[\u0000-\u001f\u007f]/.test(`${m.file}${m.from}${m.to}`))).toBe(true)
  }, 40_000)
  test('--fixtures finds the weak test (exit 1) in under 20 seconds', () => {
    const t0 = Date.now()
    expect(cli(['mutation-testing', '--fixtures']).code).toBe(1)
    expect(Date.now() - t0).toBeLessThan(20_000)
  }, 30_000)
})

describe('test-quality-static', () => {
  test('every rule is proven by a bad and a good sample, and there are at least 12', () => {
    expect(M.ALL_TQ_RULES.length).toBeGreaterThanOrEqual(12)
    expect(new Set(M.ALL_TQ_RULES).size).toBe(M.ALL_TQ_RULES.length)
    expect(M.proveLogic()).toEqual([])
  })
  test('--fixtures reports its deliberate problem', () => {
    expect(cli(['test-quality-static', '--fixtures']).code).toBe(1)
  })
  test('a project without tests is not applicable on every rule and passes', () => {
    const r = cli(['test-quality-static', '--root', folder({ 'src/a.js': 'export const a = 1\n' })])
    expect(r.code).toBe(0)
    const subs = r.out.split('\n').filter((l) => l.startsWith('MEERKAT-SUB'))
    expect(subs).toHaveLength(M.ALL_TQ_RULES.length)
    expect(subs.every((l) => l.startsWith('MEERKAT-SUB NA'))).toBe(true)
  })
  test('good tests are clean', () => {
    const r = cli(['test-quality-static', '--root', folder({ 'index.js': M.WEAK_SRC, 'package.json': PKG, 'index.test.js': M.STRONG_TEST.replace("import assert from 'node:assert/strict'", "import assert from 'node:assert/strict'") })])
    expect(r.out).not.toMatch(/MEERKAT-SUB FAIL/)
    expect(r.code).toBe(0)
  })
  test('each bad pattern fails its own rule', () => {
    const bad: Record<string, string> = {
      'tautology-assert': "import { add } from './a.js'\ntest('x', () => {\n  expect(true).toBe(true)\n  expect(add(1, 1)).toBe(2)\n})\n",
      'file-without-assertions': "import { add } from './a.js'\ntest('x', () => {\n  add(1, 1)\n})\n",
      'empty-test-body': "import { add } from './a.js'\ntest('x', () => {})\ntest('y', () => { expect(add(1, 1)).toBe(2) })\n",
      'sleep-based-test': "import { add } from './a.js'\ntest('x', async () => {\n  await new Promise((r) => setTimeout(r, 5000))\n  expect(add(1, 1)).toBe(2)\n})\n",
      'commented-out-test': "import { add } from './a.js'\n// it('old', () => {\ntest('x', () => { expect(add(1, 1)).toBe(2) })\n",
      'network-in-unit-test': "import { add } from './a.js'\ntest('x', async () => {\n  await fetch('https://example.org/api')\n  expect(add(1, 1)).toBe(2)\n})\n",
      'never-imports-source': "test('x', () => {\n  expect(1 + 1).toBe(2)\n})\n",
      'skip-ratio': "import { add } from './a.js'\ntest('a', () => { expect(add(1, 1)).toBe(2) })\ntest.skip('b', () => { expect(add(1, 1)).toBe(2) })\ntest.skip('c', () => { expect(add(1, 1)).toBe(2) })\n",
      'duplicate-test-name': "import { add } from './a.js'\ntest('a', () => { expect(add(1, 1)).toBe(2) })\ntest('a', () => { expect(add(2, 2)).toBe(4) })\n",
    }
    for (const [rule, body] of Object.entries(bad)) {
      const r = cli(['test-quality-static', '--root', folder({ 'a.js': 'export const add = (a, b) => a + b\n', 'a.test.js': body })])
      expect(r.out, rule).toMatch(new RegExp(`MEERKAT-SUB FAIL ${rule} `))
      expect(r.code, rule).toBe(1)
    }
  }, 55_000)
  test('Python tests: no assertion is found, and a real assertion is clean', () => {
    const src = 'def add(a, b):\n    return a + b\n'
    const weakPy = 'from calc import add\n\n\ndef test_add():\n    add(1, 2)\n'
    const goodPy = 'from calc import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n'
    expect(cli(['test-quality-static', '--root', folder({ 'calc.py': src, 'test_calc.py': weakPy })]).out).toMatch(/MEERKAT-SUB FAIL file-without-assertions/)
    const ok = cli(['test-quality-static', '--root', folder({ 'calc.py': src, 'test_calc.py': goodPy })])
    expect(ok.out).not.toMatch(/MEERKAT-SUB FAIL/)
    expect(ok.code).toBe(0)
  })
})

describe('the mutation pack', () => {
  test('loads with no bad-check-file entries; mutation-testing is opt-in and heavy', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'mutation'))
    expect(checks.filter((c: any) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c: any) => c.id).sort()).toEqual(['assertion-strength', 'mutation-testing', 'test-quality-static', 'test-to-code-ratio', 'tests-fail-without-source'])
    const mt = checks.find((c: any) => c.id === 'mutation-testing') as any
    expect(mt).toMatchObject({ optIn: 'mutation', weight: 'alone', tier: 'thorough', lane: 'free', suite: 'test-hygiene', estSeconds: 300, timeoutSeconds: 900, group: 'functionality' })
    const tq = checks.find((c: any) => c.id === 'test-quality-static') as any
    expect(tq).toMatchObject({ tier: 'fast', suite: 'test-hygiene' })
    expect(tq.optIn).toBeUndefined()
    expect(tq.selfTest).toBeTruthy()
    expect(mt.subs).toBe(M.FAMILIES.length + 1)
    expect(tq.subs).toBe(M.ALL_TQ_RULES.length)
  })
  test('the source files use no em dashes', () => {
    for (const f of ['thorough/mutation.mjs', 'thorough/mutation-support.mjs', 'thorough/mutation-quality.mjs', 'packs/mutation/mutation.mjs', 'mutation.test.ts', 'mutation-diff.test.ts', 'mutation-quality.test.ts', 'docs/mutation.md']) {
      const p = join(ROOT, f)
      if (statSync(p, { throwIfNoEntry: false })) expect(readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014)), f).toBe(false)
    }
  })
})
