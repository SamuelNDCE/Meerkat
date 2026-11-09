import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { changedSymbols, computeImpact, impactText, parseHunks, runImpact } from '../lib/impact.mjs'

type R = Record<string, unknown>
let dir: string
let home: string
let env: NodeJS.ProcessEnv

const git = (...a: string[]) => {
  const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), text)
}

const LIB = ['export function alpha(x) {', '  return x + 1', '}', '', 'export function beta(x) {', '  return x * 2', '}', ''].join('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mk-imp-'))
  home = mkdtempSync(join(tmpdir(), 'mk-imp-home-'))
  env = { ...process.env, MEERKAT_LOG_DIR: home }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'x')
  git('config', 'core.autocrlf', 'false')
  put('src/lib.js', LIB)
  put('src/use.js', ["import { alpha } from './lib.js'", 'export function run() {', '  return alpha(2)', '}', ''].join('\n'))
  put('src/other.js', ["import { beta } from './lib.js'", 'export function go() {', '  return beta(3)', '}', ''].join('\n'))
  put('tests/lib.test.js', ["import { alpha } from '../src/lib.js'", "test('a', () => { alpha(1) })", ''].join('\n'))
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feat')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('parseHunks and changedSymbols', () => {
  test('reads the new-side ranges, including a pure deletion', () => {
    const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -2,0 +3,2 @@', '+a', '+b', '@@ -10,2 +11,0 @@', '-c', '-d', '@@ -20 +21 @@', '-e', '+f', '--- a/gone.js', '+++ /dev/null', '@@ -1,3 +0,0 @@'].join('\n')
    const h = parseHunks(diff)
    expect(h.get('x.js')).toEqual([[3, 4], [11, 11], [21, 21]])
    expect(h.has('gone.js')).toBe(false)
  })
  test('a symbol runs to the line before the next one', () => {
    const f = { lines: 10, symbols: [{ name: 'a', kind: 'function', line: 1 }, { name: 'b', kind: 'function', line: 6 }] }
    expect(changedSymbols(f, [[3, 3]]).map((s: R) => s.name)).toEqual(['a'])
    expect(changedSymbols(f, [[6, 9]]).map((s: R) => s.name)).toEqual(['b'])
    expect(changedSymbols(f, [[5, 6]]).map((s: R) => s.name)).toEqual(['a', 'b'])
  })
})

describe('meerkat impact', () => {
  test('a changed function with one caller and one test reports both', () => {
    put('src/lib.js', LIB.replace('return x + 1', 'return x + 100'))
    git('commit', '-qam', 'change alpha')
    const r = computeImpact(dir, { base: 'main', env, findings: [] })
    expect(r.symbols.map((s: R) => s.name)).toEqual(['alpha'])
    const prod = r.callers.filter((c: R) => !c.isTest)
    expect(prod.map((c: R) => `${c.file}:${c.line}`)).toEqual(['src/use.js:3'])
    expect(r.callers.filter((c: R) => c.isTest).map((c: R) => c.file)).toEqual(['tests/lib.test.js'])
    expect(r.tests.map((t: R) => t.file)).toEqual(['tests/lib.test.js'])
    // beta sits in the same file but its lines did not change: its caller is not listed
    expect(r.callers.some((c: R) => c.symbol === 'beta')).toBe(false)
    expect(r.callers.some((c: R) => c.file === 'src/other.js')).toBe(false)
  })

  test('a finding on a changed line is listed, one on an unchanged line is not', () => {
    put('src/lib.js', LIB.replace('return x + 1', 'return x + 100'))
    git('commit', '-qam', 'change alpha')
    const findings = [
      { id: 'aaaaaaaa11112222', severity: 'high', rule: 'r-changed', file: 'src/lib.js', line: 2, message: 'on the changed line' },
      { id: 'bbbbbbbb11112222', severity: 'high', rule: 'r-same', file: 'src/lib.js', line: 6, message: 'on an unchanged line of a changed file' },
      { id: 'cccccccc11112222', severity: 'low', rule: 'r-whole', file: 'src/lib.js', line: 0, message: 'whole file' },
      { id: 'dddddddd11112222', severity: 'low', rule: 'r-other', file: 'src/use.js', line: 3, message: 'other file' },
    ]
    const r = computeImpact(dir, { base: 'main', env, findings })
    expect(r.findings.map((f: R) => f.rule)).toEqual(['r-changed'])
    const text = impactText(r)
    expect(text).toMatch(/r-changed/)
    expect(text).not.toMatch(/r-same/)
  })

  test('the first output line is the count line and there is one table at most', () => {
    put('src/lib.js', LIB.replace('return x + 1', 'return x + 100'))
    git('commit', '-qam', 'change alpha')
    const lines: string[] = []
    const code = runImpact(['--app', dir, '--base', 'main'], { env, cwd: dir, out: (l: string) => lines.push(l), err: () => {} })
    expect(code).toBe(0)
    const all = lines.join('\n').split('\n')
    expect(all[0]).toMatch(/^impact vs main: 1 changed file, 1 changed symbol, 2 callers, 1 test file, 0 findings on changed lines$/)
    expect(all.filter((l) => l.startsWith('KIND'))).toHaveLength(1)
  })

  test('uncommitted and untracked changes count too', () => {
    put('src/lib.js', LIB.replace('return x * 2', 'return x * 3'))
    put('src/fresh.js', 'export function brandNew() {\n  return 1\n}\n')
    const r = computeImpact(dir, { base: 'main', env, findings: [] })
    expect(r.changedFiles).toEqual(['src/fresh.js', 'src/lib.js'])
    expect(r.symbols.map((s: R) => s.name).sort()).toEqual(['beta', 'brandNew'])
    expect(r.callers.map((c: R) => c.file)).toEqual(['src/other.js'])
  })

  test('a change outside any function says so instead of going quiet', () => {
    put('src/lib.js', '// header comment\n' + LIB)
    git('commit', '-qam', 'comment')
    const lines: string[] = []
    runImpact(['--app', dir, '--base', 'main'], { env, cwd: dir, out: (l: string) => lines.push(l), err: () => {} })
    expect(lines.join('\n')).toMatch(/1 changed file, 0 changed symbols, 0 callers/)
  })

  test('no change at all gives a count line of zeros and a reason', () => {
    const lines: string[] = []
    const code = runImpact(['--app', dir, '--base', 'main'], { env, cwd: dir, out: (l: string) => lines.push(l), err: () => {} })
    expect(code).toBe(0)
    expect(lines[0]).toMatch(/0 changed files, 0 changed symbols, 0 callers, 0 test files, 0 findings/)
    expect(lines.join('\n')).toMatch(/No function, method or class contains a changed line/)
  })

  test('a base that is not a commit is refused with exit 2 and a reason', () => {
    const errs: string[] = []
    const code = runImpact(['--app', dir, '--base', 'no-such-ref'], { env, cwd: dir, out: () => {}, err: (l: string) => errs.push(l) })
    expect(code).toBe(2)
    expect(errs.join('\n')).toMatch(/not a commit/)
  })

  test('--json carries the same counts', () => {
    put('src/lib.js', LIB.replace('return x + 1', 'return x + 100'))
    git('commit', '-qam', 'change alpha')
    const lines: string[] = []
    runImpact(['--app', dir, '--base', 'main', '--json'], { env, cwd: dir, out: (l: string) => lines.push(l), err: () => {} })
    const j = JSON.parse(lines.join('\n'))
    expect(j.symbols).toHaveLength(1)
    expect(j.callers).toHaveLength(2)
    expect(j.tests).toHaveLength(1)
  })

  test('a missing run for findings is said, not hidden', () => {
    put('src/lib.js', LIB.replace('return x + 1', 'return x + 100'))
    git('commit', '-qam', 'change alpha')
    const errs: string[] = []
    runImpact(['--app', dir, '--base', 'main'], { env, cwd: dir, out: () => {}, err: (l: string) => errs.push(l) })
    expect(errs.join('\n')).toMatch(/findings not checked/)
  })
})
