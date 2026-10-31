// Mutation testing, the newer half: diff mode, the extra mutators, equivalent-mutant flags, coverage hints, parallel workers, result files,
// run history, test selection and the generated mutator table in docs/mutation.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import * as M from '../thorough/mutation.mjs'
// @ts-ignore plain .mjs module has no type declarations
import * as S from '../thorough/mutation-support.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-mutdiff-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const PKG = '{"name":"x","type":"module"}\n'
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' })
// A hash of every file except .git (git may refresh its own index while it reads).
function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === '.git') continue
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
const LIB1 = 'export function add(a, b) {\n  return a + b\n}\n'
const LIB2 = `${LIB1}\nexport function sub(a, b) {\n  return a - b\n}\n`
const LIB_TEST = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from './lib.js'\n\ntest('add', () => {\n  assert.equal(add(2, 3), 5)\n})\n"
const repo = () => {
  const dir = folder({ 'package.json': PKG, 'lib.js': LIB1, 'lib.test.js': LIB_TEST, '.meerkat-budgets.json': M.BUDGET({ totalSeconds: 50, minScore: 0, maxMutants: 40 }) })
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'one')
  writeFileSync(join(dir, 'lib.js'), LIB2)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'two')
  return dir
}
const by = (id: string) => (M.MUTATORS as any[]).find((m) => m.id === id)
const to = (id: string, line: string, lang = 'js') => M.findInLine(by(id), line, lang).map((s: any) => s.to)

describe('diff mode', () => {
  test('parseDiffRanges reads the new side of a -U0 diff', () => {
    const text = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -3,0 +4,3 @@\n+a\n@@ -9 +12 @@\n-x\n+y\n@@ -20,2 +22,0 @@\n-z\ndiff --git a/gone.js b/gone.js\n+++ /dev/null\n'
    const m = S.parseDiffRanges(text)
    expect(m.get('x.js')).toEqual([[4, 6], [12, 12]])
    expect(m.has('gone.js')).toBe(false)
  })

  test('only the lines changed since the base are mutated, and the score is for those lines', async () => {
    const dir = repo()
    const before = hashTree(dir)
    const r = await M.runMutation(dir, { diff: 'HEAD~1' }, () => {})
    expect(r.status).toBe('ok')
    expect(r.mode).toBe('diff')
    expect(r.base.ref).toBe('HEAD~1')
    expect(r.mutants.length).toBeGreaterThan(0)
    expect(r.mutants.every((m: any) => m.file === 'lib.js' && m.line >= 4)).toBe(true)
    expect(r.mutants.some((m: any) => m.mutator === 'arith-minus-plus')).toBe(true)
    expect(r.killed).toBe(0) // sub() has no test
    expect(hashTree(dir)).toBe(before)
    for (const d of r.tmpDirs) expect(existsSync(d)).toBe(false)
    const lines: string[] = []
    M.report(r, (l: string) => lines.push(l))
    expect(lines.join('\n')).toMatch(/mode: diff against the given ref HEAD~1/)
    expect(lines.join('\n')).toMatch(/MEERKAT-FINDING medium mut-arith-minus-plus lib\.js:\d+ mutant survived: '-' -> '\+'/)
  }, 55_000)

  test('automatic mode picks HEAD~1 when there is no other base; nothing changed is a PASS', async () => {
    const dir = repo()
    const auto = await M.runMutation(dir, {}, () => {})
    expect(auto.mode).toBe('diff')
    expect(auto.base.ref).toBe('HEAD~1')
    const none = await M.runMutation(dir, { diff: 'HEAD' }, () => {})
    expect(none.status).toBe('ok')
    expect(none.noChanged).toBe(true)
    expect(none.score).toBeNull()
    const lines: string[] = []
    expect(M.report(none, (l: string) => lines.push(l))).toBe(0)
    expect(lines.join('\n')).toMatch(/PASS, no changed source lines/)
    expect(lines.filter((l) => l.startsWith('MEERKAT-SUB PASS mutation-score')).length).toBe(1)
  }, 55_000)

  test('an unknown ref and an option-looking ref are refused without running git with them', async () => {
    const dir = repo()
    expect((await M.runMutation(dir, { diff: 'no-such-ref' }, () => {})).message).toMatch(/does not exist/)
    expect((await M.runMutation(dir, { diff: '--output=/tmp/x' }, () => {})).message).toMatch(/not a valid ref/)
  }, 30_000)

  test('--no-diff (diff: off) mutates the whole file again', async () => {
    const dir = repo()
    const r = await M.runMutation(dir, { diff: false, maxMutants: 40 }, () => {})
    expect(r.mode).toBe('full')
    expect(r.mutants.some((m: any) => m.line < 4)).toBe(true)
  }, 55_000)
})

describe('the added mutators', () => {
  test('exact replacements', () => {
    expect(to('args-swap', 'const r = pow(base, exp)')).toEqual(['exp, base'])
    expect(to('args-swap', 'function pow(base, exp) {')).toEqual([])
    expect(to('args-swap', '  add(a, b) {')).toEqual([])
    expect(to('args-swap', 'const r = pow(a, a)')).toEqual([])
    expect(to('await-removed', 'const x = await load()')).toEqual([''])
    expect(to('await-removed', 'for await (const x of xs) {')).toEqual([])
    expect(to('return-guard-removed', 'if (!ok) return null;')).toEqual([';'])
    expect(to('return-guard-removed', 'if x:  return 1', 'py')).toEqual(['pass'])
    expect(to('index-shift', 'const v = items[i];')).toEqual(['i + 1', 'i - 1'])
    expect(to('index-shift', 'const xs = [i]')).toEqual([])
    expect(to('numeric-negated', 'const limit = 100;')).toEqual(['-100'])
    expect(to('numeric-negated', 'const t = 0.5;')).toEqual(['-0.5'])
    expect(to('minmax-swap', 'const m = Math.min(a, b);')).toEqual(['max'])
    expect(to('minmax-swap', 'm = max(a, b)', 'py')).toEqual(['min'])
    expect(to('minmax-swap', 'let m = a.min(b);', 'rs')).toEqual(['max'])
    expect(to('collection-contains-negated', 'if (list.includes(item)) {')).toEqual(['!list.includes(item)'])
    expect(to('collection-contains-negated', 'if (!list.includes(item)) {')).toEqual([])
    expect(to('compare-reversed', 'if (a >= b) {')).toEqual(['<='])
    expect(to('assign-logical-flip', 'x ??= 5')).toEqual(['||='])
    expect(to('default-param-changed', 'function page(size = 10, all = false) {')).toEqual(['11', 'true'])
    expect(to('default-param-changed', 'def page(size=10, all=True):', 'py')).toEqual(['11', 'False'])
    expect(to('optional-chain-removed', 'const n = user?.name')).toEqual(['.'])
    expect(to('nullish-to-or', 'const n = a ?? b')).toEqual(['||'])
    expect(to('loop-control-swap', 'if (done) break;')).toEqual(['continue'])
    expect(to('loop-bound-shrunk', 'for (let i = 0; i < n; i++) {')).toEqual(['n - 1'])
    expect(to('literal-string-emptied', "const label = 'ready';")).toEqual(["''"])
    expect(to('literal-string-emptied', "const label = ' ';")).toEqual([])
    expect(to('else-removed', 'if (a) x = 1; else x = 2;')).toEqual([';'])
    expect(to('py-is-flip', 'if x is not None:', 'py')).toEqual(['is'])
    expect(to('py-in-flip', 'if k not in cache:', 'py')).toEqual(['in'])
    expect(to('py-range-extended', 'for i in range(len(xs)):', 'py')).toEqual(['len(xs) + 1'])
    expect(to('py-return-keyword-removed', '    return a + b', 'py')).toEqual([''])
    expect(to('go-err-flip', 'if err != nil {', 'go')).toEqual(['=='])
    expect(to('plusone-removed', 'let n = len - 1;')).toEqual([''])
    expect(to('rs-some-none', '    return Some(x.len())', 'rs')).toEqual(['None'])
    expect(to('rs-some-none', '    let a = Some(1);', 'rs')).toEqual([])
    expect(to('rs-try-removed', 'let v = parse(s)?;', 'rs')).toEqual([''])
    expect(to('conditional-negated', 'if (a > b) {')).toEqual(['!(a > b)'])
    expect(to('conditional-negated', 'if x > 1:', 'py')).toEqual(['not (x > 1)'])
  })

  test('each language only gets its own mutators, and a duplicate site is kept once', () => {
    const ids = (file: string, text: string) => M.findSites(file, text).map((s: any) => s.mutator)
    expect(ids('a.go', 'if err != nil {\n')).toContain('go-err-flip')
    expect(ids('a.go', 'if err != nil {\n')).not.toContain('equality-flip')
    expect(ids('a.js', 'if (x is y) {\n')).not.toContain('py-is-flip')
    expect(ids('a.py', 'if x is None:\n')).toContain('py-is-flip')
    expect(ids('a.py', 'x = await y\n')).not.toContain('await-removed')
    expect(ids('a.js', 'const r = await load()\n')).toContain('await-removed')
    expect(ids('a.rs', 'let v = parse(s)?;\n')).toContain('rs-try-removed')
    expect(ids('a.java', 'if (a == b) {\n')).toContain('equality-flip')
    const keys = M.findSites('a.js', 'const x = 0\nif (a > b) {\n').map((s: any) => `${s.line}:${s.col}:${s.to}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('none of them fires inside a comment, a string, a regex or a log call', () => {
    const src = "// const r = await pow(base, exp)\nconst s = 'if (a > b) break; a ?? b'\nconst re = /a ?? b/\nconsole.log(await pow(base, exp), items[i])\n"
    expect(M.findSites('a.js', src).filter((s: any) => s.mutator !== 'literal-string-emptied')).toEqual([])
  })
})

describe('likely equivalent mutants', () => {
  const reason = (file: string, text: string, mutator: string) => {
    const lang = M.langOf(file)
    const lines = text.split('\n')
    const masked = M.maskLines(lines, lang)
    const site = M.findSites(file, text).find((s: any) => s.mutator === mutator)
    return site ? S.equivalentReason(site, { lines, masked, dead: S.deadLines(masked, lang), noise: /\b(console\.\w+|print)\s*\(/ }) : 'NO SITE'
  }
  test('identity operands, ignore comments, dead branches and multi-line logs', () => {
    expect(reason('a.js', 'const a = x * 1;\n', 'arith-times-divide')).toMatch(/same/)
    expect(reason('a.js', 'const a = x + 0;\n', 'arith-plus-minus')).toMatch(/same/)
    expect(reason('a.js', 'const a = x * 2;\n', 'arith-times-divide')).toBeNull()
    expect(reason('a.js', 'const a = x + y; // meerkat-mutation-ignore\n', 'arith-plus-minus')).toMatch(/ignored/)
    expect(reason('a.js', 'if (false) {\n  const a = b + c;\n}\n', 'arith-plus-minus')).toMatch(/never runs/)
    expect(reason('a.js', 'console.log(\n  a,\n  b + c,\n)\nconst d = e + f;\n', 'arith-plus-minus')).toMatch(/log call/)
    expect(reason('a.py', 'if False:\n    a = b + c\n', 'arith-plus-minus')).toMatch(/never runs/)
  })

  test('equivalent mutants are left out of the score and listed on their own', async () => {
    const dir = folder({ 'package.json': PKG, 'index.js': 'export const same = (x) => x * 1\nexport const add = (a, b) => a + b\n', 'index.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { same, add } from './index.js'\ntest('t', () => {\n  assert.equal(same(4), 4)\n  assert.equal(add(1, 2), 3)\n})\n", '.meerkat-budgets.json': M.BUDGET({ totalSeconds: 50 }) })
    const r = await M.runMutation(dir, {}, () => {})
    expect(r.status).toBe('ok')
    expect(r.equivalent).toBeGreaterThan(0)
    const eq = r.mutants.filter((m: any) => m.result === 'EQUIVALENT')
    expect(eq.length).toBe(r.equivalent)
    expect(eq.every((m: any) => m.status === 'equivalent' && m.durationMs === 0)).toBe(true)
    expect(r.killed + r.survived + r.errors).toBe(r.mutants.length - eq.length)
    const lines: string[] = []
    M.report(r, (l: string) => lines.push(l))
    expect(lines.join('\n')).toMatch(/likely equivalent \(\d+, left out of the score\)/)
  }, 55_000)
})

describe('coverage hints', () => {
  const SRC = 'export function add(a, b) {\n  return a + b\n}\nexport function sub(a, b) {\n  return a - b\n}\n'
  const T = "import { test } from 'node:test'\nimport { add, sub } from './index.js'\ntest('runs', () => {\n  add(1, 2)\n  sub(2, 1)\n})\n"
  const mk = (shift: number) => {
    const dir = folder({ 'package.json': PKG, 'index.js': SRC, 'index.test.js': T, '.meerkat-budgets.json': M.BUDGET({ totalSeconds: 50, maxMutants: 200, minScore: 0 }) })
    mkdirSync(join(dir, 'coverage'))
    const lcov = join(dir, 'coverage', 'lcov.info')
    writeFileSync(lcov, 'TN:\nSF:index.js\nDA:1,3\nDA:2,0\nDA:4,3\nDA:5,3\nend_of_record\n')
    const t = Date.now() / 1000 + shift
    utimesSync(lcov, t, t)
    return dir
  }
  test('lcov parsing and the uncovered flag', () => {
    const m = S.parseLcov('SF:/abs/x.js\nDA:1,2\nDA:2,0\nend_of_record\nSF:y.js\nDA:7,0\n', '/abs')
    expect([...m.get('x.js').covered]).toEqual([1])
    expect([...m.get('x.js').uncovered]).toEqual([2])
    expect(m.get('y.js').uncovered.has(7)).toBe(true)
    const j = S.parseCoverageJson({ '/p/a.js': { path: '/p/a.js', statementMap: { 0: { start: { line: 3 }, end: { line: 3 } }, 1: { start: { line: 4 }, end: { line: 4 } } }, s: { 0: 1, 1: 0 } } }, '/p')
    expect(j.get('a.js').uncovered.has(4)).toBe(true)
    expect(j.get('a.js').covered.has(3)).toBe(true)
  })
  test('a mutant on an uncovered line is survived (not covered) and never run', async () => {
    const r = await M.runMutation(mk(10), {}, () => {})
    const on2 = r.mutants.filter((m: any) => m.line === 2)
    expect(on2.length).toBeGreaterThan(0)
    expect(on2.every((m: any) => m.notCovered === true && m.result === 'SURVIVED' && m.durationMs === 0)).toBe(true)
    expect(r.notCovered).toBe(on2.length)
    expect(r.mutants.filter((m: any) => m.line === 5).every((m: any) => !m.notCovered && m.durationMs > 0)).toBe(true)
    expect(r.coverage).toBe('coverage/lcov.info')
  }, 55_000)
  test('a coverage file older than the source, or coverage switched off, is ignored', async () => {
    expect((await M.runMutation(mk(-1000), {}, () => {})).notCovered).toBe(0)
    expect((await M.runMutation(mk(10), { coverage: false }, () => {})).notCovered).toBe(0)
  }, 55_000)
})

describe('parallel workers, fail fast, result files and history', () => {
  const weak = (extra = {}) => folder({ 'package.json': PKG, 'index.js': M.WEAK_SRC, 'index.test.js': M.WEAK_TEST, '.meerkat-budgets.json': M.BUDGET({ totalSeconds: 50, minScore: 0, ...extra }) })
  const key = (r: any) => r.mutants.map((m: any) => `${m.file}:${m.line}:${m.mutator}:${m.result}`).sort()
  test('two workers give the same result as one with the same seed, in separate copies that are all removed', async () => {
    const dir = weak({ maxMutants: 12, seed: 3 })
    const a = await M.runMutation(dir, { parallel: 1 }, () => {})
    const b = await M.runMutation(dir, { parallel: 2 }, () => {})
    expect(b.tmpDirs.length).toBe(Math.min(2, M.mutationConfig(dir, {}).parallel))
    expect(key(b)).toEqual(key(a))
    expect(b.score).toBe(a.score)
    for (const d of [...a.tmpDirs, ...b.tmpDirs]) expect(existsSync(d)).toBe(false)
  }, 55_000)

  test('fail fast stops once the minimum score can no longer be reached', async () => {
    const r = await M.runMutation(weak({ maxMutants: 30 }), { parallel: 1, failFast: true, minScore: 95 }, () => {})
    expect(r.stoppedEarly).toMatch(/can no longer be reached/)
    expect(r.score).toBeLessThan(95)
    const lines: string[] = []
    expect(M.report(r, (l: string) => lines.push(l))).toBe(1)
    expect(lines.join('\n')).toMatch(/stopped early/)
  }, 55_000)

  test('mutation.json and mutation.md are written to MEERKAT_RUN_DIR, and match the schema', () => {
    const dir = folder({ 'package.json': PKG, 'index.js': M.WEAK_SRC, 'index.test.js': M.STRONG_TEST, '.meerkat-budgets.json': M.BUDGET({ totalSeconds: 50, maxMutants: 10 }) })
    const out = mkdtempSync(join(tmpdir(), 'meerkat-mutrun-'))
    made.push(out)
    const logs = mkdtempSync(join(tmpdir(), 'meerkat-mutlog2-'))
    made.push(logs)
    const text = execFileSync(process.execPath, ['thorough/mutation.mjs', 'mutation-testing', '--root', dir, '--parallel', '1'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, MEERKAT_RUN_DIR: out, MEERKAT_LOG_DIR: logs } })
    expect(text).toMatch(/results: .*mutation\.json/)
    const j = JSON.parse(readFileSync(join(out, 'mutation.json'), 'utf8'))
    expect(S.validateResults(j)).toEqual([])
    expect(j.mutants.length).toBeGreaterThan(0)
    expect(j.mutants.every((m: any) => S.RESULT_STATES.includes(m.result))).toBe(true)
    expect(j.mutants.some((m: any) => m.result === 'killed' && m.killedBy.length > 0)).toBe(true)
    const md = readFileSync(join(out, 'mutation.md'), 'utf8')
    expect(md).toMatch(/# Mutation testing summary/)
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(md + text)).toBe(false)
    expect(readdirSync(out).filter((f) => f.includes('.tmp-'))).toEqual([])
    // the same run recorded its history, and a second run shows a trend
    const hist = readdirSync(join(logs, 'mutation'))
    expect(hist.length).toBe(1)
    const again = execFileSync(process.execPath, ['thorough/mutation.mjs', 'mutation-testing', '--root', dir, '--parallel', '1'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, MEERKAT_RUN_DIR: out, MEERKAT_LOG_DIR: logs } })
    expect(again).toMatch(/trend: [\d.]+% \(unchanged since/)
  }, 58_000)

  test('the validator rejects a broken file', () => {
    expect(S.validateResults({ schema: 2 }).length).toBeGreaterThan(0)
    expect(S.validateResults({ schema: 1, mode: 'full', command: 'x', score: 1, counts: {}, mutants: [{ id: 'a', file: 'f', line: 0, mutator: 'm', from: 'a', to: 'b', result: 'maybe', durationMs: 1, killedBy: '' }] }).join(' ')).toMatch(/line must be|maybe/)
  })

  test('history keeps the last 20 runs, writes atomically, survives garbage and honours MEERKAT_LOG_DIR', () => {
    const logs = mkdtempSync(join(tmpdir(), 'meerkat-hist-'))
    made.push(logs)
    const env = { MEERKAT_LOG_DIR: logs }
    const proj = folder({ 'a.txt': 'x' })
    expect(S.historyHome(env)).toBe(join(logs, 'mutation'))
    expect(S.readHistory(proj, env)).toEqual([])
    for (let i = 1; i <= 25; i++) S.appendHistory(proj, { date: `2026-10-${String(i).padStart(2, '0')}T00:00:00Z`, score: i, mutants: 10, killed: i, survived: 1, mode: i % 2 ? 'diff' : 'full', base: 'HEAD~1' }, env)
    const h = S.readHistory(proj, env)
    expect(h).toHaveLength(20)
    expect(h[0].score).toBe(6)
    expect(h[19].score).toBe(25)
    expect(readdirSync(join(logs, 'mutation')).filter((f) => f.includes('.tmp-'))).toEqual([])
    expect(JSON.stringify(h).length).toBeLessThan(S.HISTORY_MAX_BYTES)
    writeFileSync(join(logs, 'mutation', `${S.slugOf(proj)}.json`), '{not json')
    expect(S.readHistory(proj, env)).toEqual([])
    expect(S.appendHistory(proj, { date: 'd', score: 1, mutants: 1, killed: 1, survived: 0, mode: 'full' }, env)).toHaveLength(1)
  })

  test('the trend line says up, down, unchanged or first', () => {
    const prev = [{ date: '2026-10-01T00:00:00Z', score: 60, mode: 'full' }]
    expect(S.trendLine([], 50, 'full')).toMatch(/first recorded full run/)
    expect(S.trendLine(prev, 70, 'full')).toMatch(/up 10 since 2026-10-01/)
    expect(S.trendLine(prev, 55.5, 'full')).toMatch(/down 4.5/)
    expect(S.trendLine(prev, 60, 'full')).toMatch(/unchanged/)
    expect(S.trendLine(prev, 60, 'diff')).toMatch(/a full run/)
  })
})

describe('which tests run, and the other ecosystems', () => {
  test('a changed module runs only the tests that reach it through imports', () => {
    const dir = folder({ 'a.js': 'export const a = 1\n', 'b.js': "import { a } from './a.js'\nexport const b = a\n", 'b.test.js': "import { b } from './b.js'\n", 'c.test.js': "import { x } from './nothing.js'\n", 'd.test.ts': "const a = require('./a')\n" })
    const files = ['a.js', 'b.js', 'b.test.js', 'c.test.js', 'd.test.ts']
    const g = S.buildImportGraph(dir, files)
    expect(S.testsReaching(g, ['b.test.js', 'c.test.js', 'd.test.ts'], 'a.js').sort()).toEqual(['b.test.js', 'd.test.ts'])
    expect(S.testsReaching(g, ['c.test.js'], 'a.js')).toEqual([])
  })
  test('commands are detected for each ecosystem', () => {
    const cmd = (files: Record<string, string>) => M.detectTestCommand(folder(files))
    expect(cmd({ 'package.json': '{"scripts":{"test":"vitest run"}}' })).toMatchObject({ cmd: 'npm', runner: 'vitest' })
    expect(cmd({ 'package.json': '{"scripts":{"test":"node --test"}}' })).toMatchObject({ runner: 'node-test' })
    expect(cmd({ 'package.json': '{"devDependencies":{"jest":"1"}}' })).toMatchObject({ cmd: 'npx', runner: 'jest' })
    expect(cmd({ 'go.mod': 'module x\n' })).toMatchObject({ cmd: 'go', kind: 'go' })
    expect(cmd({ 'Cargo.toml': '[package]\nname="x"\n' })).toMatchObject({ cmd: 'cargo', kind: 'rs' })
    expect(cmd({ 'pom.xml': '<project/>' })).toMatchObject({ cmd: 'mvn', label: 'mvn -q test' })
    expect(cmd({ 'build.gradle': '' })).toMatchObject({ kind: 'java', label: 'gradle test' })
    expect(cmd({ 'App.csproj': '<Project/>' })).toMatchObject({ cmd: 'dotnet', kind: 'cs' })
    expect(cmd({ 'pytest.ini': '', 'a.py': 'x = 1\n' })).toMatchObject({ kind: 'py', label: 'python -m pytest -x -q' })
    expect(cmd({ 'notes.txt': 'x' })).toBeNull()
  })
  test('the Cargo crate that owns a file is found, the root package is not narrowed', () => {
    const dir = folder({ 'Cargo.toml': '[workspace]\nmembers=["crates/a"]\n', 'crates/a/Cargo.toml': '[package]\nname = "alpha"\nversion = "0.1.0"\n', 'crates/a/src/lib.rs': 'pub fn f() {}\n', 'Cargo2/x': '' })
    expect(S.cargoCrateOf(dir, 'crates/a/src/lib.rs')).toBe('alpha')
    const root = folder({ 'Cargo.toml': '[package]\nname = "solo"\n', 'src/lib.rs': '' })
    expect(S.cargoCrateOf(root, 'src/lib.rs')).toBeNull()
  })
  test('the config accepts diff, parallel and the new switches', () => {
    const cfg = (c: object) => M.mutationConfig(folder({ '.meerkat-budgets.json': JSON.stringify({ mutation: c }) }), {})
    expect(cfg({}).diff).toBe('auto')
    expect(cfg({ diff: 'origin/dev' }).diff).toBe('origin/dev')
    expect(cfg({ diff: false }).diff).toBe('off')
    expect(cfg({ parallel: 1 }).parallel).toBe(1)
    expect(cfg({ parallel: 999 }).parallel).toBeGreaterThanOrEqual(1)
    expect(cfg({ failFast: true }).failFast).toBe(true)
    expect(cfg({}).failFast).toBe(false)
    expect(cfg({ coverage: false }).coverage).toBe(false)
    expect(cfg({}).scopeTests).toBe(true)
  })
})

describe('failing test names and suggestions', () => {
  test('vitest, jest, pytest, go, cargo and node:test summary lines are understood', () => {
    expect(S.parseFailingTest(' FAIL  a.test.ts > suite > adds 4ms\n')).toBe('a.test.ts > suite > adds')
    expect(S.parseFailingTest('  ● suite › adds\n')).toBe('suite › adds')
    expect(S.parseFailingTest('FAILED tests/test_a.py::test_add - assert 1 == 2\n')).toBe('tests/test_a.py::test_add')
    expect(S.parseFailingTest('--- FAIL: TestAdd (0.00s)\n')).toBe('TestAdd')
    expect(S.parseFailingTest('test calc::adds ... FAILED\n')).toBe('calc::adds')
    expect(S.parseFailingTest('not ok 1 - add\n')).toBe('add')
    expect(S.parseFailingTest('all fine\n')).toBe('')
  })
  test('the nearest function and a one-line suggestion', () => {
    const masked = M.maskLines(['export function isAdult(age) {', '  return age >= 18', '}', 'const f = async (x) => {', '  return x + 1', '}'], 'js')
    expect(S.enclosingFunction(masked, 2)).toBe('isAdult')
    expect(S.enclosingFunction(masked, 5)).toBe('f')
    expect(S.enclosingFunction(['x = 1'], 1)).toBe('(top level)')
    expect(S.enclosingFunction(['    def total(self, xs):', '        return sum(xs) + 1'], 2)).toBe('total')
    const s = S.suggestionFor({ file: 'a.js', line: 2, mutator: 'boundary-greater' }, 'isAdult', '  return age >= 18')
    expect(s).toMatch(/^in isAdult\(\) at a\.js:2 \(return age >= 18\): add a test that asserts the result at the exact boundary value/)
    expect(s.includes('\n')).toBe(false)
  })
})

describe('docs/mutation.md', () => {
  test('the mutator table between the markers is the generated one', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'mutation.md'), 'utf8')
    const m = /<!-- MUTATORS:START -->\n([\s\S]*?)\n<!-- MUTATORS:END -->/.exec(doc)
    expect(m, 'markers missing').toBeTruthy()
    expect(m![1]).toBe(M.renderMutatorDocs())
  })
})
