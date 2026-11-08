// PowerShell, Rust and Cargo in the code map, and import resolution through tsconfig paths and workspace packages (lib/maplang.mjs, lib/mapalias.mjs).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildCodemap, codemapMarkdown } from './codemap.mjs'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-maplang-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true })
  writeFileSync(join(tmp, rel), text)
}
type Sym = { name: string; kind: string; line: number; exported: boolean; params?: string[] }
type Imp = { spec: string; kind: string; line: number; resolution: { status: string; target: string | null; reason?: string; via?: string } }
type F = { path: string; language: string; purpose: string | null; symbols: Sym[]; imports: Imp[]; exports: string[] }
const fileOf = (map: { files: F[] }, p: string) => map.files.find((f) => f.path === p) as F
const impOf = (f: F, spec: string) => f.imports.find((i) => i.spec === spec) as Imp

describe('PowerShell', () => {
  const PS = ['#Requires -Version 5', '<#', '.SYNOPSIS', 'Deploys the site to staging.', '#>', "param([string]$Env = 'dev', [switch]$Force)", 'Import-Module .\\helpers.psm1', 'Import-Module Pester -Force', '. $PSScriptRoot\\lib\\util.ps1', '# function Commented { }', 'function Get-Thing {', '  param(', '    [Parameter(Mandatory)] [string]$Name,', '    [int]$Count = 3', '  )', '}', 'function private:Hidden { }', ''].join('\n')

  test('functions, param blocks, references and the purpose comment, each with a line', () => {
    put('deploy.ps1', PS)
    put('helpers.psm1', '# Helper functions.\nfunction Help-Me { }\n')
    put('lib/util.ps1', 'function Util { }\n')
    const map = buildCodemap(tmp)
    const f = fileOf(map, 'deploy.ps1')
    expect(f.language).toBe('powershell')
    expect(f.purpose).toBe('Deploys the site to staging.')
    expect(f.symbols.map((s) => `${s.kind}:${s.name}:${s.line}:${s.exported}`)).toEqual(['function:Get-Thing:11:true', 'function:Hidden:17:false'])
    expect((f as unknown as { params: string[] }).params).toEqual(['Env', 'Force'])
    expect(f.symbols[0].params).toEqual(['Name', 'Count'])
    expect(f.exports).toEqual(['Get-Thing'])
    expect(f.imports.map((i) => `${i.kind}:${i.spec}:${i.line}:${i.resolution.status}`)).toEqual(['ps-import-module:.\\helpers.psm1:7:local', 'ps-import-module:Pester:8:external', 'ps-dot-source:$PSScriptRoot\\lib\\util.ps1:9:local'])
    expect(impOf(f, '.\\helpers.psm1').resolution.target).toBe('helpers.psm1')
    expect(impOf(f, '$PSScriptRoot\\lib\\util.ps1').resolution.target).toBe('lib/util.ps1')
    expect(fileOf(map, 'helpers.psm1').purpose).toBe('Helper functions.')
    expect(map.summary.languages).toEqual({ powershell: 3 })
    expect(codemapMarkdown(map)).toContain('deploy.ps1 (ps,')
  })

  test('a reference to a missing file is unresolved with a reason, and a variable path is not guessed', () => {
    put('a.ps1', ". $PSScriptRoot\\gone.ps1\nImport-Module \"$base\\x.psm1\"\n")
    const f = fileOf(buildCodemap(tmp), 'a.ps1')
    expect(f.imports[0].resolution).toMatchObject({ status: 'unresolved', reason: 'path not found: gone.ps1' })
    expect(f.imports[1].resolution.status).toBe('unresolved')
  })
})

describe('Rust and Cargo', () => {
  const LIB = ['//! Core types of the engine.', 'pub mod util;', 'mod hidden;', '/* pub fn commented() {} */', 'pub struct Engine { x: u8 }', 'pub enum Mode { A }', 'pub trait Run { fn go(&self); }', 'impl Engine {', '    pub fn new() -> Self { Engine { x: 0 } }', '}', 'impl<T: Into<String>> Run for Wrapper<T> { fn go(&self) {} }', 'pub fn top() { let s = "pub fn fake() {}"; }', ''].join('\n')

  test('items with lines, mod files resolved, impl blocks with their type', () => {
    put('crates/core/src/lib.rs', LIB)
    put('crates/core/src/util.rs', '')
    const map = buildCodemap(tmp)
    const f = fileOf(map, 'crates/core/src/lib.rs')
    expect(f.language).toBe('rust')
    expect(f.purpose).toBe('Core types of the engine.')
    expect(f.symbols.map((s) => `${s.kind}:${s.name}:${s.line}`)).toEqual(['mod:util:2', 'mod:hidden:3', 'struct:Engine:5', 'enum:Mode:6', 'trait:Run:7', 'impl:Engine:8', 'function:Engine.new:9', 'impl:Run for Wrapper<T>:11', 'function:top:12'])
    expect(impOf(f, 'util').resolution).toMatchObject({ status: 'local', target: 'crates/core/src/util.rs' })
    expect(impOf(f, 'hidden').resolution.status).toBe('unresolved')
    expect(f.exports).toEqual(['Engine', 'Engine.new', 'Mode', 'Run', 'top', 'util'])
    expect(map.summary.languages).toEqual({ rust: 2 })
  })

  test('Cargo.toml: package name and workspace members, each with a line; a missing member is unresolved', () => {
    put('Cargo.toml', '[workspace]\nmembers = [\n  "crates/core", # the engine\n  "crates/app",\n  "missing/x",\n]\n')
    put('crates/core/Cargo.toml', '[package]\nversion = "1"\nname = "nv-core"\n')
    put('crates/app/Cargo.toml', '[package]\nname = "nv-app"\n')
    const map = buildCodemap(tmp)
    const e = (map.entryPoints as { kind: string; name: string; file: string | null; status: string; source: { file: string; line: number } }[]).filter((x) => x.kind.startsWith('cargo'))
    expect(e.map((x) => `${x.kind}:${x.name}:${x.file}:${x.status}:${x.source.file}:${x.source.line}`)).toEqual([
      'cargo-member:crates/app:crates/app/Cargo.toml:local:Cargo.toml:4',
      'cargo-package:nv-app:crates/app/Cargo.toml:local:crates/app/Cargo.toml:2',
      'cargo-member:crates/core:crates/core/Cargo.toml:local:Cargo.toml:3',
      'cargo-package:nv-core:crates/core/Cargo.toml:local:crates/core/Cargo.toml:3',
      'cargo-member:missing/x:null:unresolved:Cargo.toml:5',
    ].sort((a, b) => a.localeCompare(b)).sort())
  })

  test('a workspace glob member expands to the matching crates', () => {
    put('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n')
    put('crates/a/Cargo.toml', '[package]\nname = "a"\n')
    put('crates/b/Cargo.toml', '[package]\nname = "b"\n')
    const names = (buildCodemap(tmp).entryPoints as { kind: string; name: string }[]).filter((x) => x.kind === 'cargo-member').map((x) => x.name)
    expect(names).toEqual(['crates/a', 'crates/b'])
  })
})

describe('imports resolved through tsconfig paths, baseUrl and workspace packages', () => {
  function project() {
    put('package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }))
    put('packages/ui/package.json', JSON.stringify({ name: '@acme/ui', main: 'dist/index.js' }))
    put('packages/ui/src/index.ts', 'export const ui = 1\n')
    put('packages/ui/src/button.ts', 'export const b = 1\n')
    put('packages/shared/package.json', JSON.stringify({ name: '@acme/shared', exports: { '.': './dist/index.js' } }))
    put('packages/shared/src/z.ts', 'export const z = 1\n')
    put('tsconfig.base.json', '{\n // shared\n "compilerOptions": { "baseUrl": ".", "paths": { "@shared/*": ["packages/shared/src/*"], }, },\n}\n')
    put('apps/web/tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }')
    put('apps/web/lib/x.ts', 'export const x = 1\n')
    put('apps/web/src/lib/y.ts', 'export const y = 1\n')
    put('apps/web/src/a.ts', ["import { y } from '@/lib/y'", "import { x } from 'lib/x'", "import { ui } from '@acme/ui'", "import { b } from '@acme/ui/button'", "import { s } from '@acme/shared'", "import _ from 'lodash'", "import { t } from '~/theme'", "import { n } from '@acme/nope'", "import { m } from '~/theme2'"].join('\n'))
    put('apps/admin/tsconfig.json', '{ "extends": "../../tsconfig.base.json" }')
    put('apps/admin/src/b.ts', "import { z } from '@shared/z'\nimport { t } from '~/theme'\n")
    return buildCodemap(tmp)
  }

  test('aliases and workspace packages resolve to files; the rest stays unresolved with a reason', () => {
    const map = project()
    const a = fileOf(map, 'apps/web/src/a.ts')
    const r = (s: string) => impOf(a, s).resolution
    expect(r('@/lib/y')).toMatchObject({ status: 'local', target: 'apps/web/src/lib/y.ts', via: 'tsconfig-paths' })
    expect(r('lib/x')).toMatchObject({ status: 'local', target: 'apps/web/lib/x.ts', via: 'baseUrl' })
    expect(r('@acme/ui')).toMatchObject({ status: 'local', target: 'packages/ui/src/index.ts', via: 'workspace' })
    expect(r('@acme/ui/button')).toMatchObject({ status: 'local', target: 'packages/ui/src/button.ts', via: 'workspace' })
    expect(r('@acme/shared')).toMatchObject({ status: 'unresolved' })
    expect(r('@acme/shared').reason).toContain('workspace package @acme/shared')
    expect(r('lodash').status).toBe('external')
    expect(r('~/theme').status).toBe('unresolved')
    expect(impOf(fileOf(map, 'apps/admin/src/b.ts'), '@shared/z').resolution).toMatchObject({ status: 'local', target: 'packages/shared/src/z.ts' })
    expect(map.summary.aliasResolvedImports).toBe(5)
  })

  test('the top unresolved specifiers are counted so aliases can be told from real gaps', () => {
    const map = project()
    expect(map.unresolvedTop[0]).toMatchObject({ spec: '~/theme', count: 2 })
    expect(map.unresolvedTop.length).toBeLessThanOrEqual(10)
    expect(map.unresolvedTop.map((x: { spec: string }) => x.spec)).toContain('~/theme2')
    expect(codemapMarkdown(map)).toContain('~/theme: 2 imports')
  })
})

describe('routes phrase', () => {
  test('no HTTP framework says so instead of a bare 0; a framework with no static route says that', () => {
    put('a.js', 'export const a = 1\n')
    const none = buildCodemap(tmp)
    expect(none.summary.routes).toBe(0)
    expect(codemapMarkdown(none)).toContain('routes: none found (no HTTP framework detected)')
    expect(codemapMarkdown(none)).not.toMatch(/\| 0 routes \|/)
    put('b.js', "import express from 'express'\nconst app = express()\napp.listen(3000)\n")
    const fw = buildCodemap(tmp)
    expect(codemapMarkdown(fw)).toContain('0 routes (framework detected: express; no static route string found)')
    put('c.js', "import express from 'express'\nconst app = express()\napp.get('/x', () => {})\n")
    expect(codemapMarkdown(buildCodemap(tmp))).toContain('| 1 routes |')
  })
})
