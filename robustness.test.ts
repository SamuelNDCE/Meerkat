// The robustness checks (thorough/robustness.mjs): each fails on its own fixture and names what is wrong, the pure logic is tested directly,
// the original folder is never touched, no output carries control characters, and the pack loads.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
import * as R from './thorough/robustness.mjs'
import { cleanup } from './thorough/sandbox.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/robustness.mjs'
const ALL = ['tz-locale-matrix', 'test-order-independence', 'parallel-safety', 'reproducible-build', 'crash-fuzz', 'idempotent-cli', 'unused-dependency-proof', 'slow-test-regression']

const made: string[] = []
afterAll(() => {
  for (const d of made) cleanup(d)
})
function run(args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...env } })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}
const cache = new Map<string, { code: number; out: string }>()
const fixture = (c: string) => {
  if (!cache.has(c)) cache.set(c, run([c, '--fixtures']))
  return cache.get(c)!
}
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore' })
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fxrob-'))
  made.push(dir)
  for (const [k, v] of Object.entries(files)) {
    mkdirSync(join(dir, k, '..'), { recursive: true })
    writeFileSync(join(dir, k), v)
  }
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'x')
  return dir
}
function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else h.update(p.slice(dir.length)).update(readFileSync(p)).update(String(statSync(p).mtimeMs))
    }
  }
  walk(dir)
  return h.digest('hex')
}

describe('every check fails on its own fixture', () => {
  for (const c of ALL) {
    test(`${c} --fixtures exits 1 and prints no control characters`, () => {
      const r = fixture(c)
      expect(r.code).toBe(1)
      expect(r.out).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/)
      expect(r.out).toMatch(/MEERKAT-FINDING (critical|high|medium|low|info) [a-z0-9-]+ \S+:\d+ /)
    }, 55_000)
  }
})

describe('what each fixture reports', () => {
  test('tz-locale-matrix names the failing time zone and says the baseline passed', () => {
    const o = fixture('tz-locale-matrix').out
    expect(o).toMatch(/MEERKAT-SUB FAIL tz-america-los-angeles/)
    expect(o).toMatch(/MEERKAT-SUB PASS baseline/)
    expect(o).toMatch(/TZ=America\/Los_Angeles.*failed.*PASS with TZ=UTC/)
    expect(o).toMatch(/plain words/)
  }, 55_000)
  test('test-order-independence names the variant that fails', () => {
    const o = fixture('test-order-independence').out
    expect(o).toMatch(/MEERKAT-SUB FAIL order-1 .*--reverse/)
    expect(o).toMatch(/b needs a to run first/)
  }, 55_000)
  test('parallel-safety fails only the parallel mode', () => {
    const o = fixture('parallel-safety').out
    expect(o).toMatch(/MEERKAT-SUB PASS serial/)
    expect(o).toMatch(/MEERKAT-SUB FAIL parallel/)
  }, 55_000)
  test('reproducible-build names the file and the cause', () => {
    expect(fixture('reproducible-build').out).toMatch(/dist\/main\.js: an embedded timestamp/)
  }, 55_000)
  test('crash-fuzz finds a hang, a stack overflow and prototype pollution, and never calls deleteAll', () => {
    const o = fixture('crash-fuzz').out
    expect(o).toMatch(/MEERKAT-FINDING high fuzz-hang src\/scan\.js:\d+ countPairs/)
    expect(o).toMatch(/MEERKAT-FINDING (low|medium) fuzz-stack-overflow src\/walk\.js:\d+ depth/)
    expect(o).toMatch(/MEERKAT-FINDING high fuzz-prototype-pollution src\/merge\.js:\d+ merge/)
    expect(o).toMatch(/not called: deleteAll .*destructive/)
    expect(o).not.toMatch(/MEERKAT-[^\n]*deleteAll/)
    expect(o).toMatch(/seed 1/)
  }, 55_000)
  test('idempotent-cli catches the stack trace on an unknown flag', () => {
    const o = fixture('idempotent-cli').out
    expect(o).toMatch(/MEERKAT-SUB FAIL fixcli-unknown-flag/)
    expect(o).toMatch(/MEERKAT-SUB PASS fixcli-help-stable/)
  }, 55_000)
  test('unused-dependency-proof static path says it is static and names the package', () => {
    const o = fixture('unused-dependency-proof').out
    expect(o).toMatch(/static check only/)
    expect(o).toMatch(/dependency 'left-padz' appears unused/)
    expect(o).not.toMatch(/used-lib' appears/)
  }, 55_000)
  test('slow-test-regression lists the slowest tests and the slowdown', () => {
    const o = fixture('slow-test-regression').out
    expect(o).toMatch(/900 ms {2}checkout flow/)
    expect(o).toMatch(/8\.6x slower/)
  }, 55_000)
})

describe('the originals are never touched', () => {
  test('tz, reproducible-build and crash-fuzz leave the project folder byte-identical', () => {
    const fuzzSrc = Object.fromEntries(Object.entries(R.FIXTURES.fuzz).filter(([k]) => k.startsWith('src/')))
    const dir = project({ ...R.FIXTURES.tz, ...fuzzSrc })
    const before = hashTree(dir)
    for (const c of ['tz-locale-matrix', 'crash-fuzz']) run([c, '--root', dir])
    expect(hashTree(dir)).toBe(before)
    const dir2 = project(R.FIXTURES.repro)
    const b2 = hashTree(dir2)
    run(['reproducible-build', '--root', dir2])
    expect(hashTree(dir2)).toBe(b2)
  }, 55_000)
  test('a project with nothing to run is NOT RUN (exit 75), not a pass', () => {
    const dir = project({ 'README.md': 'x\n' })
    for (const c of ['tz-locale-matrix', 'reproducible-build', 'idempotent-cli', 'crash-fuzz']) expect(run([c, '--root', dir]).code, c).toBe(75)
  }, 55_000)
})

describe('pure logic', () => {
  test('time zone and locale variants: UTC baseline first, counts honoured, deterministic', () => {
    const v = R.tzLocaleVariants(4, 3)
    expect(v[0]).toMatchObject({ id: 'baseline', TZ: 'UTC', LANG: 'C' })
    expect(v.filter((x: any) => x.kind === 'timezone').map((x: any) => x.value)).toEqual(['America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati'])
    expect(v.filter((x: any) => x.kind === 'locale').map((x: any) => x.value)).toEqual(['tr_TR.UTF-8', 'de_DE.UTF-8'])
    expect(R.tzLocaleVariants(5, 4).length).toBe(1 + 4 + 3)
    expect(R.tzLocaleVariants(1, 1)).toHaveLength(1)
    for (const x of v) expect(x.id).toMatch(/^[a-z0-9][a-z0-9-]{0,60}$/)
  })
  test('runner detection', () => {
    expect(R.detectRunner({ scripts: { test: 'vitest run' } }, ['node'], ['npm', 'test'])).toBe('vitest')
    expect(R.detectRunner({ scripts: { test: 'jest' } }, ['node'], ['npm', 'test'])).toBe('jest')
    expect(R.detectRunner({ scripts: { test: 'mocha' } }, ['node'], ['npm', 'test'])).toBe('mocha')
    expect(R.detectRunner({ scripts: { test: 'node t.js' } }, ['node'], ['npm', 'test'])).toBe('custom')
    expect(R.detectRunner(null, ['go'], ['go', 'test', './...'])).toBe('go')
  })
  test('order command construction per framework', () => {
    expect(R.orderVariants('vitest', ['npm', 'test'], { runs: 2 }).map((x: any) => x.argv)).toEqual([
      ['npm', 'test', '--', '--sequence.shuffle', '--sequence.seed=1'],
      ['npm', 'test', '--', '--sequence.shuffle', '--sequence.seed=2'],
    ])
    expect(R.orderVariants('jest', ['npm', 'test'], { runs: 1 })[0].argv).toEqual(['npm', 'test', '--', '--randomize', '--seed=1'])
    expect(R.orderVariants('go', ['go', 'test', './...'], { runs: 1 })[0].argv).toEqual(['go', 'test', '-shuffle=1', './...'])
    expect(R.orderVariants('mocha', ['npm', 'test'], { runs: 2 })).toEqual([])
    expect(R.orderVariants('cargo', ['cargo', 'test'], { runs: 2 })).toEqual([])
    expect(R.orderVariants('custom', ['npm', 'test'], { runs: 2, custom: ['--reverse', '--shuffle=<seed>'] }).map((x: any) => x.argv)).toEqual([
      ['npm', 'test', '--', '--reverse'],
      ['npm', 'test', '--', '--shuffle=2'],
    ])
  })
  test('parallel modes per framework', () => {
    expect(R.parallelModes('vitest')).toMatchObject({ serial: ['--pool=threads', '--no-file-parallelism'], parallel: [] })
    expect(R.parallelModes('jest', { cpus: 8 })).toMatchObject({ serial: ['-i'], parallel: ['-w', '8'] })
    expect(R.parallelModes('go', { cpus: 8 })).toMatchObject({ serial: ['-p', '1'], parallel: ['-p', '8'] })
    expect(R.withArgs(['cargo', 'test'], ['--test-threads=1'], 'cargo')).toEqual(['cargo', 'test', '--', '--test-threads=1'])
    expect(R.parallelModes('mocha')).toBeNull()
    expect(R.parallelModes('custom', { custom: { serialArgs: ['--serial'], parallelArgs: ['--parallel'] } })).toMatchObject({ serial: ['--serial'], parallel: ['--parallel'] })
  })
  test('budgets: defaults, clamping and the environment override', () => {
    const b = R.budgets(ROOT, '{"fuzzCases":99999,"tzCases":2,"orderArgs":["--x","bad\\nline"]}')
    expect(b.fuzzCases).toBe(5000)
    expect(b.tzCases).toBe(2)
    expect(b.localeCases).toBe(3)
    expect(b.seed).toBe(1)
    expect(b.orderArgs).toEqual(['--x'])
  })
  test('destructive names are skipped, ordinary ones are not', () => {
    for (const n of ['deleteAll', 'removeItem', 'writeFile', 'sendMail', 'execute', 'rm', 'payInvoice', 'killProcess', 'fetchUser', 'doUnlink']) expect(R.looksDestructive(n), n).toBe(true)
    for (const n of ['format', 'normalize', 'parse', 'transform', 'add', 'slugify']) expect(R.looksDestructive(n), n).toBe(false)
  })
  test('export scan: parameters, async, arrow, lists, rest and zero or four parameters', () => {
    const t = 'export function a(x) {}\nexport async function b(x, y) {}\nexport const c = (x, y, z) => x\nexport function d() {}\nexport function e(a, b, c, d) {}\nexport function f(...r) {}\nfunction g(p, q) {}\nexport { g }\nexports.h = function (x) {}\n'
    const got = Object.fromEntries(R.scanJsExports(t).map((x: any) => [x.name, x.arity]))
    expect(got).toEqual({ a: 1, b: 2, c: 3, g: 2, h: 1 })
    expect(R.paramCount('{ a, b }, c')).toBe(2)
    expect(R.scanPyFunctions('def ok(a, b):\n  pass\ndef _p(a):\n  pass\ndef none():\n  pass\ndef star(*a):\n  pass\n').map((x: any) => x.name)).toEqual(['ok'])
  })
  test('banned imports: fs, child_process, network modules and packages', () => {
    expect(R.bannedImports("import fs from 'node:fs'\nconst cp = require('child_process')\nimport x from 'axios'\nimport y from './y.js'\nimport z from 'lodash'").sort()).toEqual(['axios', 'child_process', 'node:fs'])
  })
  test('plan: seeded, within the case budget, same seed same plan', () => {
    const t = Array.from({ length: 80 }, (_, i) => ({ file: 'a.js', name: `f${i}`, arity: 1, line: 1 }))
    const p1 = R.planFuzz(t, { fuzzCases: 400, seed: 1 })
    expect(p1).toEqual(R.planFuzz(t, { fuzzCases: 400, seed: 1 }))
    expect(p1.reduce((n: number, x: any) => n + x.maxCases, 0)).toBeLessThanOrEqual(400)
    expect(R.planFuzz(t, { fuzzCases: 400, seed: 2 }).map((x: any) => x.name)).not.toEqual(p1.map((x: any) => x.name))
  })
  test('harness protocol parsing and classification', () => {
    const h = R.parseHarness('noise\n@@MKF@@ N 3\n@@MKF@@ S 0 100 null\n@@MKF@@ R 0 OK\n@@MKF@@ S 1 200 nested-10000\n')
    expect(h.n).toBe(3)
    expect(h.cases.get(0).kind).toBe('OK')
    expect(h.last).toBe(1)
    expect(h.cases.get(1).kind).toBeNull()
    expect(R.classifyCase('STACK', 'nested-10000')).toMatchObject({ severity: 'low' })
    expect(R.classifyCase('STACK', 'string-1mb')).toMatchObject({ severity: 'medium' })
    expect(R.classifyCase('HANG', 'x')).toMatchObject({ severity: 'high' })
    expect(R.classifyCase('POLLUTE', 'x')).toMatchObject({ severity: 'high' })
    expect(R.classifyCase('THROW', 'x')).toBeNull()
    expect(R.classifyCase('OK', 'x')).toBeNull()
  })
  test('build diff explanation and comparison', () => {
    expect(R.explainDiff('// built 1793435143729\n', '// built 1793435144165\n').reason).toBe('an embedded timestamp')
    expect(R.explainDiff('id="3f9a8c1d2e"', 'id="77bb01c4d9"').reason).toMatch(/random id/)
    const m = (s: string, text: string | null) => ({ sha: s, text })
    const d = R.compareBuilds(
      new Map([['a.js.map', m('1', '{"sources":["C:/tmp/a/src.js"]}')], ['x.tsbuildinfo', m('2', 'q')], ['b.js', m('3', 'var p="C:/tmp/a/b"')], ['c.js', m('4', 'same')], ['gone.js', m('5', 'g')]]),
      new Map([['a.js.map', m('9', '{"sources":["C:/tmp/b/src.js"]}')], ['x.tsbuildinfo', m('8', 'r')], ['b.js', m('7', 'var p="C:/tmp/b/b"')], ['c.js', m('4', 'same')]]),
      'C:/tmp/a',
      'C:/tmp/b',
    )
    const by = Object.fromEntries(d.map((x: any) => [x.file, x.kind]))
    expect(by).toEqual({ 'a.js.map': 'volatile', 'x.tsbuildinfo': 'volatile', 'b.js': 'differs', 'gone.js': 'only-one' })
  })
  test('dependency use scan: imports, config mentions and tooling', () => {
    const files = [{ rel: 'src/a.ts', text: "import x from 'lodash/get'\nimport {y} from '@scope/pkg/sub'\nconst z = require('chalk')" }, { rel: 'vite.config.js', text: "plugins: ['postcss-nested']" }, { rel: 'package.json', text: '"unused-one"' }]
    const r = R.scanDependencyUse(files, ['lodash', '@scope/pkg', 'chalk', 'postcss-nested', 'unused-one'])
    expect([...r.imported].sort()).toEqual(['@scope/pkg', 'chalk', 'lodash'])
    expect(r.mentioned.has('postcss-nested')).toBe(true)
    expect(r.mentioned.has('unused-one')).toBe(false)
    expect(R.packageOf('node:fs')).toBeNull()
    expect(R.packageOf('./x')).toBeNull()
    expect(R.TOOLING_ALLOW.test('typescript')).toBe(true)
    expect(R.TOOLING_ALLOW.test('left-pad')).toBe(false)
  })
  test('cli bin files: string and object forms, unsafe paths dropped', () => {
    expect(R.binFiles({ name: '@s/tool', bin: './bin/t.js' })).toEqual([{ name: 'tool', file: 'bin/t.js' }])
    expect(R.binFiles({ bin: { a: 'bin/a.js', b: '../evil.js', c: '/abs.js' } })).toEqual([{ name: 'a', file: 'bin/a.js' }])
  })
  test('slow-test history: median, regression rule, caps and parsers', () => {
    expect(R.medianOf([3, 1, 2])).toBe(2)
    expect(R.medianOf([1, 2, 3, 4])).toBe(2.5)
    const hist = [100, 110, 90, 105, 95].map((ms) => ({ at: 'x', tests: { slow: ms, fast: 5, other: 400 } }))
    const reg = R.findRegressions(hist, { slow: 900, fast: 400, other: 1100, brandnew: 5000 })
    expect(reg.map((x: any) => x.name)).toEqual(['slow'])
    expect(R.findRegressions(hist, { slow: 450 })).toEqual([])
    const old = [{ at: 'x', tests: { slow: 100 } }, ...Array.from({ length: 5 }, () => ({ at: 'y', tests: { slow: 1000 } }))]
    expect(R.findRegressions(old, { slow: 1500 })).toEqual([])
    let h: any = { version: 1, runs: [] }
    for (let i = 0; i < 8; i++) h = R.appendHistory(h, { a: i })
    expect(h.runs).toHaveLength(5)
    expect(h.runs[4].tests.a).toBe(7)
    const big = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`t${i}`, i]))
    expect(Object.keys(R.appendHistory(null, big).runs[0].tests)).toHaveLength(2000)
    expect(R.topSlowest({ a: 1, b: 9, c: 5 }, 2)).toEqual([['b', 9], ['c', 5]])
    expect(R.parseGenericTimes('MEERKAT-TEST-TIME 12.5 a b\nnoise')).toEqual({ 'a b': 12.5 })
    expect(R.parsePytestDurations('0.52s call     tests/t.py::test_x\n0.01s setup    tests/t.py::test_x')).toEqual({ 'tests/t.py::test_x': 530 })
    expect(R.parseGoJson('{"Action":"pass","Package":"p","Test":"TestA","Elapsed":0.25}\n{"Action":"pass","Package":"p","Elapsed":1}')).toEqual({ 'p.TestA': 250 })
    expect(R.parseJestLikeJson(JSON.stringify({ testResults: [{ name: '/x/y/a.test.js', assertionResults: [{ fullName: 'does it', duration: 42 }] }] }))).toEqual({ 'y/a.test.js::does it': 42 })
    expect(R.timesDir({ MEERKAT_LOG_DIR: join(tmpdir(), 'zz') }, 'H')).toBe(join(tmpdir(), 'zz', 'test-times'))
    expect(R.timesDir({}, 'H')).toBe(join('H', '.meerkat', 'test-times'))
  })
  test('slow-test history file is written atomically and survives a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-times-'))
    made.push(dir)
    const f = join(dir, 'x', 't.json')
    R.saveHistory(f, R.appendHistory(null, { a: 1 }))
    expect(R.loadHistory(f).runs).toHaveLength(1)
    expect(readdirSync(join(dir, 'x'))).toEqual(['t.json'])
    writeFileSync(f, '{broken')
    expect(R.loadHistory(f).runs).toEqual([])
  })
  test('rule ids always satisfy the protocol', () => {
    for (const id of [R.subId('fuzz', 'src/very/long/path/'.repeat(8), 'Name'), R.subId('tz', 'Pacific/Pago_Pago'), R.subId('')]) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,60}$/)
  })
})

describe('the robustness pack', () => {
  test('loads 8 opt-in runtime checks with unique ids and no bad-check-file entries', async () => {
    const checks = (await loadChecks(join(ROOT, 'packs', 'robustness'))) as any[]
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
    for (const c of checks) {
      expect(c.optIn).toBe('runtime')
      expect(c.group).toBe('functionality')
      expect(c.tier).toBe('thorough')
      expect(c.lane).toBe('free')
      expect(c.suite).toBe('test-hygiene')
      expect(c.run.args[0]).toMatch(/robustness\.mjs$/)
      expect(c.selfTest.expectFail).toBe(true)
    }
    const others = new Set<string>()
    for (const d of readdirSync(join(ROOT, 'packs'))) {
      if (d === 'robustness') continue
      for (const c of (await loadChecks(join(ROOT, 'packs', d))) as any[]) others.add(c.id)
    }
    for (const id of ALL) expect(others.has(id), id).toBe(false)
  })
})
