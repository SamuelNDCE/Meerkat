// rust-test scoping: a change inside a crate runs that crate only; a change to the workspace itself runs everything.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs pack module
import { scopeRustTest } from '../packs/rust/rust.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
function ws() {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-rscope-')); made.push(root)
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = ["alpha", "beta"]\n')
  for (const n of ['alpha', 'beta']) {
    mkdirSync(join(root, n, 'src'), { recursive: true })
    writeFileSync(join(root, n, 'Cargo.toml'), `[package]\nname = "${n}"\nversion = "0.1.0"\n`)
    writeFileSync(join(root, n, 'src', 'lib.rs'), '')
  }
  return root
}

describe('rust-test scoping', () => {
  test('a change inside one crate runs only that crate', () => {
    const root = ws()
    const r = scopeRustTest({ repoRoot: root, changedFiles: ['alpha/src/lib.rs'] })
    expect(r.args).toEqual(['test', '-p', 'alpha'])
    expect(r.note).toContain('alpha')
  })
  test('a change to the workspace manifest runs everything', () => {
    expect(scopeRustTest({ repoRoot: ws(), changedFiles: ['Cargo.toml', 'alpha/src/lib.rs'] })).toBeNull()
  })
  test('no changed Rust files means no narrowing', () => {
    expect(scopeRustTest({ repoRoot: ws(), changedFiles: ['README.md'] })).toBeNull()
    expect(scopeRustTest({ repoRoot: ws(), changedFiles: null })).toBeNull()
  })
})
