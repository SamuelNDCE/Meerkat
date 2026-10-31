// Three test-quality checks that sit beside mutation testing (docs/mutation.md):
//   node thorough/mutation-quality.mjs tests-fail-without-source [--root <dir>] [--max-files N] [--total-seconds N] [--timeout N] [--test-command '[...]']   (opt-in, runs the tests)
//   node thorough/mutation-quality.mjs assertion-strength [--root <dir>]       (static, fast)
//   node thorough/mutation-quality.mjs test-to-code-ratio [--root <dir>]       (static, informational, never fails)
//   node thorough/mutation-quality.mjs <check> --fixtures                      (the first two must exit 1)
// tests-fail-without-source empties ONE source file at a time in a TEMPORARY COPY and requires that a test fails; the project is never edited.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { NOT_RUN, finding, isFixture, main, progress, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'
import { evaluate, readAllow, selfProve } from './rules.mjs'
import { CODE_EXT, SRC_TEST, clean, copyProject, detectTestCommand, extractTests, langOf, listFiles, mutationConfig, parseCli, pickSources, removeTemp, runTests, testable } from './mutation.mjs'
import { buildImportGraph } from './mutation-support.mjs'
import { symlinkSync, writeFileSync } from 'node:fs'

// ============================================================ tests-fail-without-source
// Returns { status: 'ok' | 'notrun', message, checked: [{ file, imports, failed, ms }], untested: [file], tmpDir }.
export async function testsFailWithoutSource(rootArg, cli = {}, log = () => {}) {
  const root = resolve(rootArg)
  const cfg = mutationConfig(root, cli)
  const deadline = Date.now() + cfg.totalSeconds * 1000
  const out = { status: 'notrun', message: '', checked: [], untested: [], tmpDir: null }
  const bail = (m) => ({ ...out, message: m })
  const spec = cfg.testCommand ? { cmd: cfg.testCommand[0], args: cfg.testCommand.slice(1), kind: 'custom', label: cfg.testCommand.join(' ') } : detectTestCommand(root)
  if (!spec) return bail('no test command found (set "mutation": { "testCommand": ["cmd", "arg"] } in .meerkat-budgets.json)')
  if (!['node', 'py', 'custom'].includes(spec.kind)) return bail('this check needs an interpreted language (JavaScript, TypeScript or Python): in a compiled project an emptied file fails the build, which proves nothing')
  const all = listFiles(root)
  const sources = pickSources(root, all, cfg, ['js', 'py'])
  if (!sources.length) return bail('no JavaScript, TypeScript or Python source files to empty (test files, config files and fixtures are left out)')
  // The most imported files first: they are the ones a missing test hurts most.
  const imports = new Map(sources.map((f) => [f, 0]))
  for (const deps of buildImportGraph(root, all).values()) for (const d of deps) if (imports.has(d)) imports.set(d, imports.get(d) + 1)
  const byStem = new Map(sources.filter((f) => f.endsWith('.py')).map((f) => [f.split('/').pop().replace(/\.py$/, ''), f]))
  for (const f of all.filter((x) => x.endsWith('.py'))) {
    let t = ''
    try {
      t = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    for (const m of t.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const target = byStem.get((m[1] ?? m[2]).split('.').pop())
      if (target && target !== f) imports.set(target, imports.get(target) + 1)
    }
  }
  const maxFiles = Math.min(50, Math.max(1, Math.floor(Number(cli.maxFiles) || 10)))
  const ranked = [...sources].sort((a, b) => imports.get(b) - imports.get(a) || (a < b ? -1 : 1)).slice(0, maxFiles)

  const copy = copyProject(root)
  if (copy.error) return bail(copy.error)
  out.tmpDir = copy.dir
  const cleanup = () => removeTemp(copy.dir, copy.links)
  process.once('exit', cleanup)
  try {
    for (const l of copy.links) {
      try {
        symlinkSync(join(root, l), join(copy.dir, l), process.platform === 'win32' ? 'junction' : 'dir')
      } catch (e) {
        if (spec.kind === 'node' || spec.kind === 'custom') return bail(`node_modules cannot be linked into the copy (${e.code ?? 'error'})`)
      }
    }
    const base = await runTests(spec, copy.dir, Math.min(300_000, Math.max(5000, deadline - Date.now())))
    if (base.spawnError) return bail(`the test command could not start (${base.spawnError})`)
    if (base.timedOut) return bail('the baseline test run timed out')
    if (base.code !== 0) return bail('tests fail before the check starts, fix them first')
    log(`baseline: tests pass (${(base.ms / 1000).toFixed(1)}s); emptying up to ${ranked.length} file(s), one at a time`)
    const per = Math.min(cfg.timeoutSeconds * 1000, Math.max(5000, base.ms * 3 + 3000))
    for (const f of ranked) {
      if (deadline - Date.now() < 2000) {
        out.partial = true
        break
      }
      const p = join(copy.dir, f)
      const orig = readFileSync(join(root, f), 'utf8')
      progress.file(f)
      try {
        writeFileSync(p, '')
        const r = await runTests(spec, copy.dir, Math.min(per, deadline - Date.now()))
        if (r.spawnError) return bail(`the test command could not start (${r.spawnError})`)
        const failed = r.timedOut || r.code !== 0
        out.checked.push({ file: f, imports: imports.get(f), failed, ms: r.ms })
        if (!failed) out.untested.push(f)
        log(`${failed ? 'TESTED  ' : 'UNTESTED'} ${f}`)
      } finally {
        writeFileSync(p, orig)
      }
    }
  } finally {
    cleanup()
    process.removeListener('exit', cleanup)
  }
  if (!out.checked.length) return bail('the time cap was reached before any file could be checked')
  return { ...out, status: 'ok' }
}

async function runTfws(root, rest) {
  const r = await testsFailWithoutSource(root, parseCli(rest), (l) => console.log(clean(l)))
  if (r.status === 'notrun') {
    console.log(clean(`NOT RUN: ${r.message}`))
    return NOT_RUN
  }
  const bad = r.untested.length
  console.log(`MEERKAT-SUB ${bad ? 'FAIL' : 'PASS'} tests-fail-without-source ${bad ? `${bad} of ${r.checked.length} files can be emptied without any test failing` : `all ${r.checked.length} files checked are needed by a test`}`)
  for (const f of r.untested) finding('medium', 'untested-file', f, 1, 'emptying this file changed no test result: no test depends on it')
  if (r.partial) console.log('stopped early at the time cap: not every chosen file was checked')
  console.log(bad ? `tests-fail-without-source: ${bad} untested file(s): ${r.untested.map(clean).join(', ')}` : 'tests-fail-without-source: every file checked is needed by a test')
  return bad ? 1 : 0
}

// ============================================================ assertion-strength
const NO_COMMENT = /^\s*(\/\/|#|\*|\/\*)/
const prevCode = (ctx) => {
  for (let i = ctx.index - 1; i >= 0; i--) if (ctx.lines[i].trim()) return ctx.lines[i]
  return ''
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const JS_EXT = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']

export const STRENGTH_LINE_RULES = [
  {
    id: 'defined-after-assignment',
    title: 'a test asserts only that a value just assigned is defined or not None',
    ext: [...JS_EXT, 'py'],
    skipLine: NO_COMMENT,
    sample: 'a.test.js',
    bad: 'const user = makeUser()\nexpect(user).toBeDefined()\n',
    good: 'const user = makeUser()\nexpect(user.name).toBe("ann")\n',
    test: (line, ctx) => {
      const js = /^\s*expect\(\s*([\w$]+)\s*\)\s*\.\s*(?:toBeDefined\(\)|not\s*\.\s*toBeUndefined\(\))\s*;?\s*$/.exec(line)
      const py = /^\s*assert\s+(\w+)\s+is\s+not\s+None\s*$/.exec(line)
      const m = js ?? py
      return Boolean(m) && new RegExp(`(?:\\b(?:const|let|var)\\s+)?\\b${esc(m[1])}\\s*=(?!=)`).test(prevCode(ctx))
    },
  },
  {
    id: 'truthy-on-object',
    title: 'toBeTruthy on an object or array, which is always truthy',
    ext: JS_EXT,
    skipLine: NO_COMMENT,
    sample: 'a.test.js',
    bad: 'const out = { a: 1 }\nexpect(out).toBeTruthy()\n',
    good: 'const out = compute()\nexpect(out.a).toBeTruthy()\n',
    test: (line, ctx) => {
      if (/^\s*expect\(\s*(\{|\[|new\s)[^)]*\)\s*\.\s*toBeTruthy\(\)/.test(line)) return true
      const m = /^\s*expect\(\s*([\w$]+)\s*\)\s*\.\s*toBeTruthy\(\)/.exec(line)
      return Boolean(m) && new RegExp(`\\b${esc(m[1])}\\s*=\\s*(\\{|\\[|new\\s)`).test(prevCode(ctx))
    },
  },
]

const assertLines = (t) => t.mbody.split('\n').filter((l) => /\bexpect\s*\(|\bassert\b|\bassert_\w+|\bshould\b|\bverify\s*\(/.test(l))
const onlyWeak = (re) => (text, file, lang) =>
  extractTests(text, lang)
    .filter(testable)
    .filter((t) => {
      const a = assertLines(t)
      return a.length > 0 && a.every((l) => re.test(l))
    })
    .map((t) => ({ line: t.line, msg: `test "${t.name}" has no check that can fail for a wrong value` }))

export const STRENGTH_LOGIC_RULES = [
  {
    id: 'only-defined-or-truthy',
    title: 'every assertion of a test is only defined, truthy or not None',
    langs: ['js', 'py'],
    sample: 'a.test.js',
    bad: "test('x', () => {\n  const r = run()\n  expect(r).toBeDefined()\n})\n",
    good: "test('x', () => {\n  const r = run()\n  expect(r).toBeDefined()\n  expect(r.n).toBe(2)\n})\n",
    find: onlyWeak(/\.\s*(toBeDefined|toBeTruthy)\s*\(\s*\)|\.\s*not\s*\.\s*(toBeNull|toBeUndefined|toBeFalsy)\s*\(\s*\)|^\s*assert\s+[\w.[\]()'"]+\s+is\s+not\s+None\s*$|^\s*assert\s+[\w.]+\s*$/),
  },
  {
    id: 'only-not-throw',
    title: 'the only assertion of a test is that nothing throws',
    langs: ['js'],
    sample: 'a.test.js',
    bad: "test('x', () => {\n  expect(() => run()).not.toThrow()\n})\n",
    good: "test('x', () => {\n  expect(() => run()).not.toThrow()\n  expect(run()).toBe(3)\n})\n",
    find: onlyWeak(/\.\s*not\s*\.\s*toThrow(Error)?\s*\(/),
  },
  {
    id: 'mock-call-only',
    title: 'a test only checks that a mock was called, never what came out',
    langs: ['js', 'py'],
    sample: 'a.test.js',
    bad: "test('x', () => {\n  const fn = vi.fn()\n  run(fn)\n  expect(fn).toHaveBeenCalled()\n})\n",
    good: "test('x', () => {\n  const fn = vi.fn()\n  run(fn)\n  expect(fn).toHaveBeenCalled()\n  expect(run(fn)).toBe(1)\n})\n",
    find: onlyWeak(/\.\s*toHaveBeenCalled(Times|With|LastWith|NthCalledWith)?\s*\(|\.\s*toBeCalled\w*\s*\(|\bassert_called\w*\(|\.assert_has_calls\(|\.assert_any_call\(|\bverify\s*\(/),
  },
]
export const STRENGTH_IDS = [...STRENGTH_LINE_RULES.map((r) => r.id), ...STRENGTH_LOGIC_RULES.map((r) => r.id)]

export function proveStrength() {
  const problems = [...selfProve(STRENGTH_LINE_RULES)]
  for (const r of STRENGTH_LOGIC_RULES) {
    const lang = langOf(r.sample)
    if (!r.find(r.bad, r.sample, lang).length) problems.push(`${r.id}: its bad sample is not found`)
    if (r.find(r.good, r.sample, lang).length) problems.push(`${r.id}: its good sample is found (false positive)`)
  }
  return problems
}

export function assertionStrength(root) {
  const all = trackedFiles(root).filter((f) => CODE_EXT.test(f) && !isFixture(f) && !/(^|\/)(node_modules|vendor|dist|build|target)\//.test(f))
  const tests = all.filter((f) => SRC_TEST.test(f))
  if (!tests.length) {
    for (const id of STRENGTH_IDS) console.log(`MEERKAT-SUB NA ${id} this project has no test files`)
    console.log('assertion-strength: no test files found')
    return 0
  }
  const allow = readAllow(root, '.meerkat-assertion-strength-allow')
  const hit = new Map()
  const na = new Set()
  const found = []
  const ev = evaluate(root, STRENGTH_LINE_RULES, { files: tests, allow })
  for (const h of ev.hits) {
    hit.set(h.rule, (hit.get(h.rule) ?? 0) + 1)
    found.push({ rule: h.rule, file: h.file, line: h.line, text: `${h.file}:${h.line} ${h.title}` })
  }
  for (const id of ev.na) na.add(id)
  for (const r of STRENGTH_LOGIC_RULES) {
    const mine = tests.filter((f) => r.langs.includes(langOf(f)))
    if (!mine.length) {
      na.add(r.id)
      continue
    }
    for (const f of mine) {
      if (allow.has(`${r.id} ${f}`) || allow.has(`${r.id} *`)) continue
      for (const x of r.find(readText(root, f), f, langOf(f))) {
        hit.set(r.id, (hit.get(r.id) ?? 0) + 1)
        found.push({ rule: r.id, file: f, line: x.line, text: `${f}:${x.line} ${clean(x.msg)}` })
      }
    }
  }
  const titles = new Map([...STRENGTH_LINE_RULES, ...STRENGTH_LOGIC_RULES].map((r) => [r.id, r.title]))
  for (const id of STRENGTH_IDS) {
    if (na.has(id)) console.log(`MEERKAT-SUB NA ${id} ${titles.get(id)}`)
    else if (hit.has(id)) console.log(`MEERKAT-SUB FAIL ${id} ${hit.get(id)} found: ${titles.get(id)}`)
    else console.log(`MEERKAT-SUB PASS ${id} ${titles.get(id)}`)
  }
  for (const f of found) finding('low', f.rule, f.file, f.line, titles.get(f.rule))
  if (!found.length) {
    console.log(`assertion-strength: ${tests.length} test file(s), every assertion can fail`)
    return 0
  }
  console.log(`assertion-strength: found ${found.length}`)
  for (const f of found.slice(0, 25)) console.log(`  ${clean(f.text)}`)
  if (found.length > 25) console.log(`  ... and ${found.length - 25} more`)
  return 1
}

// ============================================================ test-to-code-ratio
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs'])
const GROUP_ROOTS = /^(src|lib|app|packages|crates|internal|pkg|cmd)$/
export function groupKey(file) {
  const segs = file.split('/').slice(0, -1).filter((s) => !TEST_DIRS.has(s))
  if (!segs.length) return '.'
  return GROUP_ROOTS.test(segs[0]) && segs.length > 1 ? segs.slice(0, 2).join('/') : segs[0]
}
const countLines = (text) => text.split('\n').filter((l) => l.trim()).length

// Test lines per source line, per folder. Returns { rows: [{ key, src, test, mentioned, flagged }], totalSrc, totalTest }.
export function ratioReport(root, files = trackedFiles(root)) {
  const code = files.filter((f) => CODE_EXT.test(f) && !isFixture(f) && !/(^|\/)(node_modules|vendor|dist|build|target|coverage)\//.test(f) && !/\.d\.ts$/.test(f))
  const isTest = (f) => SRC_TEST.test(f) || /(^|\/)(tests?|__tests__|spec|specs)\//i.test(f)
  const g = new Map()
  const testTexts = []
  for (const f of code) {
    const text = readText(root, f)
    const e = g.get(groupKey(f)) ?? { src: 0, test: 0 }
    if (isTest(f)) {
      e.test += countLines(text)
      if (testTexts.length < 300) testTexts.push(text.slice(0, 200_000))
    } else e.src += countLines(text)
    g.set(groupKey(f), e)
  }
  const blob = testTexts.join('\n')
  const rows = [...g.entries()]
    .map(([key, e]) => {
      const mentioned = key === '.' ? false : blob.includes(`${key}/`)
      return { key, ...e, mentioned, flagged: e.src >= 30 && e.test === 0 && !mentioned }
    })
    .filter((r) => r.src > 0)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
  return { rows, totalSrc: rows.reduce((n, r) => n + r.src, 0), totalTest: [...g.values()].reduce((n, r) => n + r.test, 0) }
}

export function testToCodeRatio(root) {
  const r = ratioReport(root)
  if (!r.rows.length) {
    console.log('MEERKAT-SUB NA test-to-code-ratio this project has no source files')
    console.log('test-to-code-ratio: no source files found')
    return 0
  }
  const flagged = r.rows.filter((x) => x.flagged)
  console.log(`MEERKAT-SUB PASS test-to-code-ratio informational: ${r.totalTest} test lines for ${r.totalSrc} source lines, ${flagged.length} folder(s) with source and no tests`)
  for (const x of r.rows.slice(0, 40)) console.log(clean(`  ${x.key.padEnd(28)} source ${String(x.src).padStart(6)}  tests ${String(x.test).padStart(6)}  ratio ${(x.test / x.src).toFixed(2)}${x.flagged ? '  NO TESTS' : x.test === 0 && x.mentioned ? '  (covered by tests elsewhere)' : ''}`))
  for (const x of flagged) finding('info', 'folder-without-tests', x.key === '.' ? 'package.json' : x.key, 0, `${x.src} source lines and no test mentions or lives in this folder`)
  console.log(`test-to-code-ratio: ${(r.totalTest / Math.max(1, r.totalSrc)).toFixed(2)} test lines per source line overall (informational, never fails)`)
  return 0
}

// ============================================================ the checks
export const FIX_PKG = '{\n  "name": "fx",\n  "version": "1.0.0",\n  "type": "module"\n}\n'
export const FIX_BUDGET = `${JSON.stringify({ mutation: { testCommand: [process.execPath, '--test'], totalSeconds: 40, timeoutSeconds: 10 } }, null, 2)}\n`
export const FIX_FILES = {
  'package.json': FIX_PKG,
  'used.js': 'export const add = (a, b) => a + b\n',
  'orphan.js': 'export const sub = (a, b) => a - b\n',
  'used.test.js': "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from './used.js'\n\ntest('add', () => {\n  assert.equal(add(1, 2), 3)\n})\n",
  '.meerkat-budgets.json': FIX_BUDGET,
}
const CHECKS = {
  'tests-fail-without-source': {
    run: async (root, rest) => runTfws(root, rest),
    fixture: () => withFixture(FIX_FILES, (dir) => runTfws(dir, [])),
  },
  'assertion-strength': {
    run: async (root) => {
      const p = proveStrength()
      if (p.length) {
        console.log(`assertion-strength: internal rule proof failed: ${p.join('; ')}`)
        return 2
      }
      return assertionStrength(root)
    },
    fixture: () => withFixture({ 'a.js': 'export const a = () => ({ n: 1 })\n', 'a.test.js': "import { a } from './a.js'\n\ntest('a', () => {\n  const out = a()\n  expect(out).toBeDefined()\n})\n" }, (dir) => assertionStrength(dir)),
  },
  'test-to-code-ratio': {
    run: async (root) => testToCodeRatio(root),
    fixture: () => withFixture({ 'src/auth/login.js': `${'export const f = () => 1\n'.repeat(40)}`, 'README.md': 'x\n' }, (dir) => (ratioReport(dir).rows.some((r) => r.flagged) ? 1 : 0)),
  },
}

if (process.argv[1] && process.argv[1].endsWith('mutation-quality.mjs')) await main(CHECKS)
