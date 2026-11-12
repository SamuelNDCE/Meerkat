// test-presence (thorough/quality.mjs): inline tests count. A Rust file with #[cfg(test)] or #[test], or a JS/TS file with describe( / it( / test( calls, has its tests.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-tpi-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  const git = (...a: string[]) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' })
  git('init', '-q')
  git('add', '-A')
  return dir
}
const run = (dir: string) => {
  const r = spawnSync(process.execPath, ['thorough/quality.mjs', 'test-presence', '--root', dir], { cwd: ROOT, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const many = (dir: string, ext: string, n: number, body: (i: number) => string) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/f${i}.${ext}`, body(i)]))

describe('test-presence counts inline tests', () => {
  test('a Rust directory with only inline tests is not reported', () => {
    const files = many('packages/core/src', 'rs', 12, (i) => (i === 0 ? 'pub fn a() -> u8 { 1 }\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() { assert_eq!(1, 1); }\n}\n' : `pub fn f${i}() -> u8 { ${i} }\n`))
    const r = run(project(files))
    expect(r.out).not.toMatch(/no test file/)
    expect(r.out).not.toMatch(/no test files/)
    expect(r.code).toBe(0)
  })
  test('a JavaScript directory with describe( or it( calls inside a source file is not reported', () => {
    const files = many('lib', 'js', 12, (i) => (i === 3 ? "export const a = 1\ndescribe('a', () => { it('works', () => {}) })\n" : `export const v${i} = ${i}\n`))
    const r = run(project(files))
    expect(r.out).not.toMatch(/no test file/)
    expect(r.code).toBe(0)
  })
  test('a directory with no tests at all is still reported', () => {
    const files = many('src', 'rs', 12, (i) => `pub fn f${i}() -> u8 { ${i} }\n`)
    const r = run(project(files))
    expect(r.out).toMatch(/src\/ has 12 source files and no test file for any of them/)
    expect(r.code).toBe(1)
  })
  test('one directory with inline tests does not hide a sibling directory with none', () => {
    const files = {
      ...many('a', 'rs', 12, (i) => (i === 0 ? '#[cfg(test)]\nmod tests {}\n' : `pub fn f${i}() {}\n`)),
      ...many('b', 'rs', 12, (i) => `pub fn g${i}() {}\n`),
    }
    const r = run(project(files))
    expect(r.out).toMatch(/b\/ has 12 source files and no test file/)
    expect(r.out).not.toMatch(/a\/ has/)
  })
})
