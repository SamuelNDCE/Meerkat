// Transitive lockfile findings name the direct dependency that pulls the package in (lib/lockparents.mjs), or say "transitive, parent unknown".
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { lockGraph, parentNote } from '../lib/lockparents.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// project -> foo (direct) -> glob -> rimraf@2.6.3 (deprecated); project -> left-pad (direct, deprecated); nobody requires "orphan".
const LOCK = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'demo', version: '1.0.0', dependencies: { foo: '^1.0.0', 'left-pad': '1.0.0' } },
    'node_modules/foo': { version: '1.2.0', dependencies: { glob: '^7.0.0' } },
    'node_modules/glob': { version: '7.1.0', dependencies: { rimraf: '^2.6.0' } },
    'node_modules/rimraf': { version: '2.6.3', deprecated: 'Rimraf versions prior to v4 are no longer supported', resolved: 'https://registry.npmjs.org/rimraf/-/rimraf-2.6.3.tgz', integrity: 'sha512-x' },
    'node_modules/left-pad': { version: '1.0.0', deprecated: 'use String.prototype.padStart()', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.0.0.tgz', integrity: 'sha512-y' },
    'node_modules/orphan': { version: '0.1.0', deprecated: 'gone', resolved: 'https://registry.npmjs.org/orphan/-/orphan-0.1.0.tgz', integrity: 'sha512-z' },
  },
}

function project(lock: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-lock-'))
  made.push(dir)
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', private: true }))
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  return dir
}
function run(script: string, check: string, dir: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

describe('parentNote', () => {
  const g = lockGraph(JSON.stringify(LOCK))
  test('a package pulled in through a chain names the direct dependency and the chain', () => {
    expect(parentNote(g, 'node_modules/rimraf')).toBe('transitive, pulled in by foo (foo > glob > rimraf)')
  })
  test('a direct dependency says so', () => {
    expect(parentNote(g, 'node_modules/left-pad')).toBe('a direct dependency')
  })
  test('a package nobody requires is "transitive, parent unknown"', () => {
    expect(parentNote(g, 'node_modules/orphan')).toBe('transitive, parent unknown')
  })
  test('a v1 lockfile with no requires and no package.json is "transitive, parent unknown"', () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { rimraf: { version: '2.6.3', deprecated: 'old' } } })
    expect(parentNote(lockGraph(v1), 'node_modules/rimraf')).toBe('transitive, parent unknown')
  })
  test('a v1 lockfile reads its requires edges, with the direct names from package.json', () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { foo: { version: '1.0.0', requires: { rimraf: '^2.6.0' } }, rimraf: { version: '2.6.3' } } })
    const g1 = lockGraph(v1, JSON.stringify({ dependencies: { foo: '^1.0.0' } }))
    expect(parentNote(g1, 'node_modules/rimraf')).toBe('transitive, pulled in by foo (foo > rimraf)')
  })
  test('a nested copy resolves to the nearest node_modules', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '1', b: '1' } },
        'node_modules/a': { version: '1.0.0', dependencies: { rimraf: '^3' } },
        'node_modules/a/node_modules/rimraf': { version: '3.0.0' },
        'node_modules/b': { version: '1.0.0', dependencies: { rimraf: '^2' } },
        'node_modules/rimraf': { version: '2.6.3' },
      },
    }
    const g2 = lockGraph(JSON.stringify(lock))
    expect(parentNote(g2, 'node_modules/rimraf')).toBe('transitive, pulled in by b (b > rimraf)')
    expect(parentNote(g2, 'node_modules/a/node_modules/rimraf')).toBe('transitive, pulled in by a (a > rimraf)')
  })
})

describe('deprecated-deps names who pulls a deprecated package in', () => {
  test('rimraf@2.6.3 is pulled in by foo; left-pad is direct; the orphan has an unknown parent', () => {
    const r = run('thorough/repo-files.mjs', 'deprecated-deps', project(LOCK))
    expect(r.code).toBe(1)
    expect(r.out).toContain('rimraf@2.6.3 is deprecated: Rimraf versions prior to v4 are no longer supported (transitive, pulled in by foo (foo > glob > rimraf))')
    expect(r.out).toContain('left-pad@1.0.0 is deprecated: use String.prototype.padStart() (a direct dependency)')
    expect(r.out).toContain('orphan@0.1.0 is deprecated: gone (transitive, parent unknown)')
  })
})

describe('wh-supply names who pulls a deprecated lockfile entry in', () => {
  test('lockfile-deprecated-entry shows rimraf@2.6.3 with its parent', () => {
    const r = run('thorough/web-hardening.mjs', 'wh-supply', project(LOCK))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/lockfile entry carries a deprecated marker[^\n]*rimraf@2\.6\.3 \(transitive, pulled in by foo \(foo > glob > rimraf\)\)/)
  })
  test('lockfile-duplicate-versions-over-budget names a duplicated package and its parent', () => {
    const packages: Record<string, any> = { '': { dependencies: { holder: '1' } }, 'node_modules/holder': { version: '1.0.0', dependencies: {} } }
    for (let i = 0; i < 26; i++) {
      packages[`node_modules/p${i}`] = { version: '1.0.0' }
      packages[`node_modules/holder/node_modules/p${i}`] = { version: '2.0.0' }
      packages['node_modules/holder'].dependencies[`p${i}`] = '^2'
    }
    const r = run('thorough/web-hardening.mjs', 'wh-supply', project({ lockfileVersion: 3, packages }))
    expect(r.out).toMatch(/duplicate-version budget\)[^\n]*: 26 packages; for example p\d+@2\.0\.0 \(transitive, pulled in by holder/)
  })
})
