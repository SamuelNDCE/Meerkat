// Outside-test findings on the code map: PowerShell variable-prefixed paths, Rust use and entry points, unresolved aliases, param blocks, unborn git.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildCodemap, codemapMarkdown } from './codemap.mjs'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-mapfixes-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true })
  writeFileSync(join(tmp, rel), text)
}
type Imp = { spec: string; kind: string; resolution: { status: string; target: string | null; reason?: string } }
type F = { path: string; symbols: { name: string; kind: string; params?: string[] }[]; imports: Imp[] }
const fileOf = (map: { files: F[] }, p: string) => map.files.find((f) => f.path === p) as F
const impOf = (f: F, spec: string) => f.imports.find((i) => i.spec === spec) as Imp

describe('PowerShell: a path with a $PSScriptRoot prefix is a literal path', () => {
  test('resolves against the file folder; a missing target says path not found', () => {
    put('main.ps1', 'Import-Module "$PSScriptRoot\\modules\\Helpers.psm1"\nImport-Module "$PSScriptRoot\\modules\\Missing.psm1"\n')
    put('modules/Helpers.psm1', 'function Get-Greeting {\n  param([string]$Name)\n}\n')
    const map = buildCodemap(tmp)
    const f = fileOf(map, 'main.ps1')
    expect(f.imports[0].resolution).toMatchObject({ status: 'local', target: 'modules/Helpers.psm1' })
    expect(f.imports[1].resolution).toMatchObject({ status: 'unresolved', reason: 'path not found: modules/Missing.psm1' })
  })
  test('a param block is not listed as a function; its names sit on the function', () => {
    put('modules/Helpers.psm1', 'function Get-Greeting {\n  param([string]$Name, [int]$Times)\n}\n')
    const f = fileOf(buildCodemap(tmp), 'modules/Helpers.psm1')
    expect(f.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(['function:Get-Greeting'])
    expect(f.symbols[0].params).toEqual(['Name', 'Times'])
  })
})

describe('Rust: use statements and entry points', () => {
  function workspace() {
    put('Cargo.toml', '[workspace]\nmembers = ["crates/core-lib", "crates/cli"]\n')
    put('crates/core-lib/Cargo.toml', '[package]\nname = "core-lib"\n')
    put('crates/core-lib/src/lib.rs', 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n')
    put('crates/cli/Cargo.toml', '[package]\nname = "cli"\n')
    put('crates/cli/src/main.rs', 'use core_lib::add;\nuse std::collections::HashMap;\nuse crate::local;\nfn main() { let _ = add(1, 2); }\n')
    return buildCodemap(tmp)
  }
  test('a workspace member is a local import, std is external, crate:: is skipped', () => {
    const f = fileOf(workspace(), 'crates/cli/src/main.rs')
    expect(f.imports.map((i) => `${i.spec}:${i.resolution.status}:${i.resolution.target}`)).toEqual(['core_lib::add:local:crates/core-lib/src/lib.rs', 'std::collections::HashMap:external:null'])
  })
  test('the cli to core module edge is shown, not "None found"', () => {
    const map = workspace()
    expect(map.moduleEdges.map((e: { id: string }) => e.id)).toEqual(['crates/cli -> crates/core-lib'])
    expect(codemapMarkdown(map)).toContain('crates/cli -> crates/core-lib (1 import)')
  })
  test('main.rs and lib.rs are entry points (a crate bin and lib root)', () => {
    const e = workspace().entryPoints as { kind: string; file: string }[]
    expect(e.filter((x) => x.kind.startsWith('rust-')).map((x) => `${x.kind}:${x.file}`)).toEqual(['rust-bin:crates/cli/src/main.rs', 'rust-lib:crates/core-lib/src/lib.rs'])
  })
})

describe('TypeScript: an alias that points at no file is unresolved, not external', () => {
  test('@lib/nope is unresolved and listed; react stays external', () => {
    put('tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }')
    put('src/lib/real.ts', 'export const r = 1\n')
    put('src/a.ts', "import react from 'react'\nimport { n } from '@lib/nope'\nimport { r } from '@lib/real'\n")
    const map = buildCodemap(tmp)
    const f = fileOf(map, 'src/a.ts')
    expect(impOf(f, 'react').resolution.status).toBe('external')
    expect(impOf(f, '@lib/nope').resolution.status).toBe('unresolved')
    expect(impOf(f, '@lib/real').resolution.status).toBe('local')
    expect(map.unresolved.map((u: { spec: string }) => u.spec)).toEqual(['@lib/nope'])
    expect(codemapMarkdown(map)).toContain('src/a.ts:2 @lib/nope')
  })
})

describe('git repo with no commits', () => {
  test('says "no commits yet", not "not a git work tree"', () => {
    put('a.js', 'export const a = 1\n')
    execFileSync('git', ['init', '-q'], { cwd: tmp })
    const md = codemapMarkdown(buildCodemap(tmp))
    expect(md).toContain('built from commit no commits yet')
    expect(md).not.toContain('not a git work tree')
  })
  test('outside a git work tree it still says so', () => {
    put('a.js', 'export const a = 1\n')
    expect(codemapMarkdown(buildCodemap(tmp))).toContain('(not a git work tree)')
  })
})

describe('codemap.md names the PowerShell files', () => {
  test('a PowerShell section lists each path with its functions and line numbers', () => {
    put('supabase/scripts/bug-inbox.ps1', '# Reads the bug inbox.\nfunction Get-Inbox { }\n\nfunction Close-Item { }\n')
    const md = codemapMarkdown(buildCodemap(tmp))
    expect(md).toContain('## PowerShell files')
    expect(md).toContain('- supabase/scripts/bug-inbox.ps1 (4 lines): Reads the bug inbox. functions: Get-Inbox:2 Close-Item:4')
  })
})
