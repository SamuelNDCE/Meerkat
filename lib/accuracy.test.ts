// The false-negative guard: known-bad projects with every planted defect written down (tools/accuracy-corpus.mjs). Every pack runs on
// every project through the real runner, and each planted defect must be reported by the check that owns it. Recall per suite may not fall
// under docs/accuracy-thresholds.json. Defects that are not detected today are printed as KNOWN GAPS (and listed in docs/accuracy.md).
// Skip it with MEERKAT_SKIP_ACCURACY=1. The false-positive side is lib/compat.test.ts.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { evaluate, gapList, generateCorpus, isDetected, percent, recallTable, runCorpus, withSuites } from '../tools/accuracy-corpus.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skip = process.env.MEERKAT_SKIP_ACCURACY === '1'
const onCi = Boolean(process.env.CI)
const thresholds = JSON.parse(readFileSync(join(ROOT, 'docs', 'accuracy-thresholds.json'), 'utf8'))

type Planted = { id: string; key: string; project: string; suite: string; check: string; alt: string[]; rule: string; file: string; line: number; description: string; detected?: boolean; inFindings?: boolean }
let out = ''
let planted: Planted[] = []
let projects: Record<string, string> = {}
let ev: ReturnType<typeof evaluate>

beforeAll(async () => {
  if (skip) return
  out = mkdtempSync(join(tmpdir(), 'meerkat-accuracy-test-'))
  const corpus = generateCorpus(out)
  projects = corpus.projects
  planted = await withSuites(corpus.planted)
  // A shared CI runner (Windows most of all, where every process spawn is slow) shares two cores with the other test files, so a project that takes
  // 40 s on a desktop can pass the 100 s kill and lose its findings.json. Giving the runs more time changes no rule and no threshold.
  const results = await runCorpus({ projects, work: join(out, '.work'), concurrency: onCi ? 4 : 5, ...(onCi ? { overallSeconds: 300 } : {}) })
  ev = evaluate(planted, results)
  console.log(`accuracy corpus: ${ev.total} planted defects, ${ev.detected} detected by a check (${percent(ev.recall)}), ${ev.inFindings} in findings.json (${percent(ev.findingsRecall)})\n${recallTable(ev)}\n\nKNOWN GAPS (planted but not detected):\n${gapList(ev)}`)
}, onCi ? 1_200_000 : 500_000)

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true })
})

describe.skipIf(skip)('the accuracy corpus', () => {
  test('is big enough and every planted defect is well formed', () => {
    expect(planted.length).toBeGreaterThanOrEqual(150)
    expect(Object.keys(projects).length).toBeGreaterThanOrEqual(8)
    const ids = new Set<string>()
    for (const p of planted) {
      expect(ids.has(p.id), `duplicate planted id ${p.id}`).toBe(false)
      ids.add(p.id)
      expect(p.check, `${p.id} has no expected check`).not.toBe('')
      expect(p.suite, `${p.id} has no suite`).not.toBe('other')
      if (p.file) expect(existsSync(join(projects[p.project], p.file)), `${p.id}: ${p.file} is not written`).toBe(true)
      if (p.line > 0) {
        const lines = readFileSync(join(projects[p.project], p.file), 'utf8').split('\n')
        expect(p.line, `${p.id}: line ${p.line} is past the end of ${p.file}`).toBeLessThanOrEqual(lines.length)
        expect(lines[p.line - 1].trim(), `${p.id}: line ${p.line} of ${p.file} is empty`).not.toBe('')
      }
    }
  })

  test('has a manifest written next to the projects, and never a real-looking secret in its own source', () => {
    const source = readFileSync(join(ROOT, 'tools', 'accuracy-corpus.mjs'), 'utf8')
    expect(source).not.toMatch(/AKIA[A-Z0-9]{16}/)
    expect(source).not.toMatch(/ghp_[A-Za-z0-9]{36}/)
    expect(source).not.toMatch(/sk_live_[A-Za-z0-9]{20,}/)
    expect(source).not.toMatch(/xoxb-\d{10,}/)
    writeFileSync(join(out, 'planted.json'), JSON.stringify(planted, null, 2))
    expect(existsSync(join(out, 'planted.json'))).toBe(true)
  })

  test('every project produced a result from the real runner', () => {
    const missing = Object.keys(projects).filter((n) => !planted.some((p) => p.project === n && ev.rows.find((r) => r.id === p.id)?.ran))
    expect(missing).toEqual([])
  })

  test('recall per suite stays at or above its committed threshold', () => {
    const below: string[] = []
    for (const [suite, s] of Object.entries(ev.bySuite)) {
      const min = thresholds.suites[suite]
      if (min === undefined) continue
      if (s.recall + 1e-9 < Math.max(0.6, min)) below.push(`${suite}: ${percent(s.recall)} (${s.detected}/${s.planted}) is under ${percent(min)}`)
    }
    expect(below, `a rule stopped catching a planted defect; the gaps are listed above`).toEqual([])
    for (const suite of Object.keys(ev.bySuite)) expect(thresholds.suites[suite], `no threshold for suite ${suite}: run node tools/accuracy-corpus.mjs --run --write-thresholds`).toBeDefined()
  })

  test('overall recall (a check saw it, and findings.json carries it) stays at or above the thresholds', () => {
    expect(ev.recall + 1e-9).toBeGreaterThanOrEqual(Math.max(0.6, thresholds.overall))
    expect(ev.findingsRecall + 1e-9).toBeGreaterThanOrEqual(Math.max(0.6, thresholds.findingsOverall))
  })

  test('the defects fixed by this guard stay detected (regressions)', () => {
    const must = ['js-exec-concat', 'js-debug-leftover', 'js-regex-dos', 'js-sync-fs-handler', 'el-context-isolation']
    const missed = must.filter((k) => !ev.rows.find((r) => r.key === k)?.detected)
    expect(missed).toEqual([])
  })
})

// Direct regression tests for the rules this guard fixed: one tiny repository each, the single check run on it.
function runCheck(script: string, id: string, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-accuracy-rule-'))
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), text)
    }
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.excludesFile=', ...a], { cwd: dir, stdio: 'pipe' })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
    try {
      const o = execFileSync(process.execPath, [join(ROOT, 'thorough', script), id], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
      return { failed: false, text: o }
    } catch (e) {
      const err = e as { stdout?: string; status?: number }
      return { failed: err.status === 1, text: String(err.stdout ?? '') }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.skipIf(skip)('rules fixed by the accuracy guard', () => {
  test('debug-leftovers: a debugger statement without a semicolon is found, a word in a comment or string is not', () => {
    expect(runCheck('quality.mjs', 'debug-leftovers', { 'a.js': 'function f(x) {\n  debugger\n  return x\n}\n' }).failed).toBe(true)
    expect(runCheck('quality.mjs', 'debug-leftovers', { 'a.js': 'function f(x) {\n  debugger // stop here\n  return x\n}\n' }).failed).toBe(true)
    expect(runCheck('quality.mjs', 'debug-leftovers', { 'a.js': "// the debugger is not used\nconst s = 'debugger statement'\nexport default s\n" }).failed).toBe(false)
  })

  test('cp-js: exec called through a child_process alias is found, but regex.exec and fixed strings are not', () => {
    const bad = "const cp = require('child_process')\nfunction run(h) {\n  cp.exec('ping ' + h)\n}\n"
    const re = "const re = /a(b)/\nfunction f(s) {\n  return re.exec(s)\n}\n"
    const fixed = "const cp = require('child_process')\ncp.exec('ls -l', () => {})\n"
    expect(runCheck('code-patterns.mjs', 'cp-js', { 'a.js': bad }).failed).toBe(true)
    expect(runCheck('code-patterns.mjs', 'cp-js', { 'a.js': re }).failed).toBe(false)
    expect(runCheck('code-patterns.mjs', 'cp-js', { 'a.js': fixed }).failed).toBe(false)
  })

  test('toml-valid: a key with no value is found, a normal assignment is not', () => {
    expect(runCheck('config.mjs', 'toml-valid', { 'a.toml': '[server]\nport = = 80\n' }).failed).toBe(true)
    expect(runCheck('config.mjs', 'toml-valid', { 'a.toml': '[server]\nport =\n' }).failed).toBe(true)
    expect(runCheck('config.mjs', 'toml-valid', { 'a.toml': '[server]\nport = 80\nhosts = [\n  "a",\n  "b",\n]\n' }).failed).toBe(false)
  })

  test('regex-dos: a repeated token followed by an optional one inside a repeat is found, a required separator is not', () => {
    expect(runCheck('sec-code.mjs', 'regex-dos', { 'a.js': 'export const words = /^(\\w+\\s?)+$/\n' }).failed).toBe(true)
    expect(runCheck('sec-code.mjs', 'regex-dos', { 'a.js': 'export const words = /^(\\w+\\s)+$/\n' }).failed).toBe(false)
  })
})

test('isDetected: a finding for another file or a far-away line does not count', () => {
  const p = { check: 'x', alt: [], rule: '', file: 'a.js', line: 10 }
  expect(isDetected(p, [{ check: 'x', file: 'a.js', line: 11, lines: [] }])).toBe(true)
  expect(isDetected(p, [{ check: 'x', file: 'b.js', line: 10, lines: [] }])).toBe(false)
  expect(isDetected(p, [{ check: 'x', file: 'a.js', line: 40, lines: [] }])).toBe(false)
  expect(isDetected(p, [{ check: 'y', file: 'a.js', line: 10, lines: [] }])).toBe(false)
  expect(isDetected(p, [{ check: 'x', file: 'a.js', line: 40, lines: [9] }])).toBe(true)
  expect(isDetected({ ...p, rule: 'r1' }, [{ check: 'x', rule: 'r2', file: 'a.js', line: 10, lines: [] }])).toBe(false)
})

test('parseOutputLines: "path message" and "path line N: message" lines each become a finding', async () => {
  const { parseOutputLines } = await import('./findings.mjs')
  const exists = (p: string) => (['package.json', 'deploy/nginx.conf', 'public/index.html'].includes(p) ? p : null)
  const out = [
    'wildcard-versions: found 3',
    '  package.json depends on left-pad at "*", which is not a fixed version',
    '  package.json depends on lodash at "latest", which is not a fixed version',
    '  deploy/nginx.conf The server config sets no Strict-Transport-Security (HSTS) header',
    '  public/index.html line 14: onclick is written into the tag',
    'Not a path here: ignored',
  ].join('\n')
  const got = parseOutputLines(out, exists)
  expect(got.map((g: { file: string; line: number }) => `${g.file}:${g.line}`)).toEqual(['package.json:0', 'package.json:0', 'deploy/nginx.conf:0', 'public/index.html:14'])
  expect(new Set(got.map((g: { message: string }) => g.message)).size).toBe(4)
})
