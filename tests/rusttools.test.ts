// The Rust tool checks (thorough/rust-tools.mjs): cargo-geiger, cargo-semver-checks, cargo-udeps and cargo-miri. Each parser is proven on the
// REAL recorded output of the tool (tests/fixtures/detectors/) for a planted defect and for its clean twin. No tool has to be installed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { confirmFindings } from '../lib/confirm.mjs'
// @ts-expect-error plain JS module
import { classOf } from '../lib/confirm-classes.mjs'
// @ts-expect-error plain JS module
import { isLibrary, parseGeiger, parseMiri, parseSemver, parseUdeps, toolEnv } from '../thorough/rust-tools.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = join(ROOT, 'tests/fixtures/detectors')
const read = (f: string) => readFileSync(join(FX, f), 'utf8')
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-rt-'))
  made.push(d)
  return d
}
const run = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough/rust-tools.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('cargo-geiger', () => {
  test('real output with an unsafe block is one finding, no line (so it never merges with a lined finding)', () => {
    const f = parseGeiger(JSON.parse(read('geiger.json')), '')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule: 'geiger-unsafe-used', severity: 'low', line: 0 })
    expect(f[0].message).toContain('1 expression(s)')
  })
  test('the clean twin (#![forbid(unsafe_code)]) reports nothing', () => {
    expect(parseGeiger(JSON.parse(read('geiger-clean.json')), '')).toEqual([])
  })
  test('unsafe in a dependency (not a Path source) is not reported', () => {
    const dep = { packages: [{ package: { id: { name: 'libc', version: '0.2.0', source: { Registry: { name: 'crates.io', url: 'x' } } } }, unsafety: { used: { exprs: { safe: 1, unsafe_: 99 } } } }] }
    expect(parseGeiger(dep, '')).toEqual([])
  })
})

describe('cargo-semver-checks', () => {
  test('real output of a removed parameter: one high finding at the file and line', () => {
    const f = parseSemver(read('semver.txt'))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'high', rule: 'semver-function-parameter-count-changed', file: 'fixtures/semver-broken/src/lib.rs', line: 1 })
    expect(f[0].message).toContain('now takes 3 parameters instead of 2')
  })
  test('the clean twin reports nothing', () => {
    expect(parseSemver(read('semver-clean.txt'))).toEqual([])
  })
  test('a crate with no lib is not applicable (binaries are skipped)', () => {
    const d = tmp()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'Cargo.toml'), '[package]\nname = "b"\nversion = "0.1.0"\n')
    writeFileSync(join(d, 'src', 'main.rs'), 'fn main() {}\n')
    expect(isLibrary(d)).toBe(false)
    const r = run(['semver-checks-api', '--root', d])
    expect(r.code).toBe(0)
    expect(r.out).toContain('binary')
    writeFileSync(join(d, 'src', 'lib.rs'), '')
    expect(isLibrary(d)).toBe(true)
  })
})

describe('cargo-udeps', () => {
  test('real output with an unused dependency names it and points at its Cargo.toml line when the file is known', () => {
    const toml = '[package]\nname = "udeps-unused"\n\n[dependencies]\nitoa = "1"\n'
    const f = parseUdeps(JSON.parse(read('udeps.json')), '', () => toml)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ rule: 'udeps-unused-dependency', severity: 'low', file: 'fixtures/udeps-unused/Cargo.toml', line: 5 })
    expect(f[0].message).toContain('itoa')
  })
  test('the clean twin reports nothing', () => {
    expect(parseUdeps(JSON.parse(read('udeps-clean.json')), '')).toEqual([])
  })
})

describe('cargo-miri', () => {
  test('real output with undefined behaviour is one high finding at the line Miri names', () => {
    const f = parseMiri(read('miri.txt'))
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'high', rule: 'miri-undefined-behavior', file: 'src/lib.rs', line: 4 })
  })
  test('the clean twin (test passes under Miri) reports nothing', () => {
    expect(parseMiri(read('miri-clean.txt'))).toEqual([])
  })
})

describe('the checks', () => {
  test('selfTests are present, expect a failure and a match, and the nightly ones are opt-in on their own', async () => {
    const all = await loadChecks(join(ROOT, 'packs/detectors'))
    const mine = all.filter((c: any) => ['geiger-unsafe', 'semver-checks-api', 'udeps-unused', 'miri-ub'].includes(c.id))
    expect(mine.map((c: any) => c.id).sort()).toEqual(['geiger-unsafe', 'miri-ub', 'semver-checks-api', 'udeps-unused'])
    for (const c of mine) {
      expect(c.selfTest.expectFail).toBe(true)
      expect(c.selfTest.expectMatch).toBeTruthy()
      expect(c.install).toBeTruthy()
      expect(c.lane).toBe('cargo')
    }
    expect(mine.find((c: any) => c.id === 'udeps-unused').optIn).toBe('rust-nightly')
    expect(mine.find((c: any) => c.id === 'miri-ub').optIn).toBe('rust-nightly')
    expect(mine.find((c: any) => c.id === 'geiger-unsafe').optIn).toBe('detectors')
  })
  test.each([
    ['geiger-unsafe', 'geiger.json', 'geiger-clean.json', 'geiger-unsafe-used'],
    ['semver-checks-api', 'semver.txt', 'semver-clean.txt', 'semver-function'],
    ['udeps-unused', 'udeps.json', 'udeps-clean.json', 'udeps-unused-dependency'],
    ['miri-ub', 'miri.txt', 'miri-clean.txt', 'miri-undefined-behavior'],
  ])('%s: the recorded defect fails with its rule, the clean twin passes', (id, bad, good, rule) => {
    const b = run([id, '--sample', join(FX, bad)])
    expect(b.code).toBe(1)
    expect(b.out).toContain(rule)
    const g = run([id, '--sample', join(FX, good)])
    expect(g.code).toBe(0)
    expect(g.out).toContain('no findings')
  })
  test('a missing tool is NOT RUN (75) with an install hint, never a pass', () => {
    const d = tmp()
    writeFileSync(join(d, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n')
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'lib.rs'), '')
    const empty = tmp()
    for (const [id, hint] of [['geiger-unsafe', 'cargo install cargo-geiger'], ['semver-checks-api', 'cargo install cargo-semver-checks'], ['udeps-unused', 'cargo install cargo-udeps'], ['miri-ub', 'component miri']] as const) {
      const r = run([id, '--root', d], { PATH: empty, Path: empty, MEERKAT_TOOLS_HOME: empty })
      expect(r.code).toBe(75)
      expect(r.out).toContain(hint)
    }
  })
  test('no Cargo.toml is not applicable', () => {
    expect(run(['geiger-unsafe', '--root', tmp()]).code).toBe(0)
  })
  test('the tool folder comes first on PATH and compiler wrappers are emptied', () => {
    const e = toolEnv('/proj', { PATH: ['/usr/bin', '/proj/bin'].join(process.platform === 'win32' ? ';' : ':'), RUSTC_WRAPPER: 'evil', MEERKAT_TOOLS_HOME: '/t' })
    expect(e.PATH.startsWith(join('/t', 'bin'))).toBe(true)
    expect(e.PATH).not.toContain('/proj/bin')
    expect(e.RUSTC_WRAPPER).toBe('')
  })
})

describe('one consolidated finding', () => {
  let n = 0
  const f = (over: Record<string, unknown>) => ({ id: `r${++n}`, severity: 'low', suite: 'x', check: 'a', rule: null, file: 'Cargo.toml', line: 5, lines: [5], occurrences: 1, message: 'm', confidence: 'medium', ...over })
  const merge = (list: any[]) => {
    const map = new Map(list.map((x) => [x.id, x]))
    confirmFindings(map)
    return [...map.values()]
  }
  test('rule families are classified', () => {
    expect(classOf({ rule: 'udeps-unused-dependency' })).toBe('unused-dependency')
    expect(classOf({ rule: 'semver-function-parameter-count-changed' })).toBe('api-break')
    expect(classOf({ rule: 'miri-undefined-behavior' })).toBe('undefined-behavior')
  })
  test('udeps and another unused-dependency check on the same Cargo.toml line become one finding', () => {
    const out = merge([f({ check: 'udeps-unused', rule: 'udeps-unused-dependency' }), f({ check: 'unused-dependency-proof', rule: 'unused-dependency' })])
    expect(out).toHaveLength(1)
    expect(out[0].confirmations).toBe(2)
  })
  test('findings with no line are never merged', () => {
    const out = merge([f({ check: 'udeps-unused', rule: 'udeps-unused-dependency', line: 0, lines: [] }), f({ check: 'unused-dependency-proof', rule: 'unused-dependency', line: 0, lines: [] })])
    expect(out).toHaveLength(2)
  })
  test('the same class on different lines stays separate', () => {
    const out = merge([f({ check: 'udeps-unused', rule: 'udeps-unused-dependency', line: 5, lines: [5] }), f({ check: 'unused-dependency-proof', rule: 'unused-dependency', line: 9, lines: [9] })])
    expect(out).toHaveLength(2)
  })
})
