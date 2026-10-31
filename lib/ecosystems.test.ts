// The ecosystem packs (Java, .NET, PHP, Ruby, Swift, Dart, Terraform, Kubernetes): they load, their ids are unique across every pack,
// each self-test names fixtures that exist and expects a specific failure, and --init suggests them from the files it finds.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { detect, initConfig } from './init.mjs'
import { loadChecks } from './load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NEW_PACKS = ['java', 'dotnet', 'php', 'ruby', 'swift', 'dart', 'terraform', 'kubernetes']

const allPackFolders = () =>
  readdirSync(join(ROOT, 'packs'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

const norm = (f: string) => f.split(String.fromCharCode(92)).join('/')
const filesNamed = (...names: string[]) => (f: string) => names.some((n) => norm(f).endsWith('/' + n))
const listOf = (...names: string[]) => () => names

describe('the ecosystem packs load and are well-formed', () => {
  test('every new pack loads with no broken check file, and each check is self-testable', async () => {
    for (const name of NEW_PACKS) {
      const checks = await loadChecks(join(ROOT, 'packs', name))
      expect(checks.length, `${name} has checks`).toBeGreaterThan(0)
      for (const c of checks) {
        expect(c.id.startsWith('bad-check-file'), `${name}: ${c.id}`).toBe(false)
        expect(c.lane, c.id).toBe('free')
        expect(c.needs, `${c.id} needs`).toEqual([expect.any(String)])
        expect(typeof c.install, `${c.id} install`).toBe('string')
        expect(c.selfTest.expectFail, c.id).toBe(true)
        expect(typeof c.selfTest.expectMatch, `${c.id} expectMatch`).toBe('string')
        for (const arg of c.selfTest.args as string[]) {
          if (arg.startsWith('fixtures/')) expect(existsSync(join(ROOT, arg)), `${c.id} fixture ${arg}`).toBe(true)
        }
      }
    }
  })

  test('check ids are unique across every pack folder', async () => {
    const ids: string[] = []
    for (const name of allPackFolders()) {
      for (const c of await loadChecks(join(ROOT, 'packs', name))) ids.push(c.id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.startsWith('bad-check-file'))).toEqual([])
  })

  test('each new pack says how to switch it on, and has no em dashes', () => {
    for (const name of NEW_PACKS) {
      const text = readFileSync(join(ROOT, 'packs', name, `${name}.mjs`), 'utf8')
      expect(text.startsWith('// The ' + name + ' pack'), name).toBe(true)
      expect(text, name).toContain(`{ "packs": ["${name}"] }`)
      expect(text.includes('—'), `${name} em dash`).toBe(false)
    }
  })
})

describe('init suggests tool packs from the files it finds, and never switches them on', () => {
  test('each marker suggests its pack', () => {
    const cases: [string, (f: string) => boolean, () => string[]][] = [
      ['java', filesNamed('pom.xml'), listOf()],
      ['java', filesNamed('build.gradle.kts'), listOf()],
      ['dotnet', () => false, listOf('App.csproj', 'Program.cs')],
      ['dotnet', () => false, listOf('Solution.sln')],
      ['php', filesNamed('composer.json'), listOf()],
      ['ruby', filesNamed('Gemfile'), listOf()],
      ['swift', filesNamed('Package.swift'), listOf()],
      ['dart', filesNamed('pubspec.yaml'), listOf()],
      ['terraform', () => false, listOf('main.tf', 'README.md')],
      ['kubernetes', filesNamed('Chart.yaml'), listOf()],
      ['kubernetes', filesNamed('k8s'), listOf()],
      ['python', filesNamed('requirements.txt'), listOf()],
      ['go', filesNamed('go.mod'), listOf()],
      ['web', filesNamed('index.html'), listOf()],
      ['infra', filesNamed('Dockerfile'), listOf()],
    ]
    for (const [pack, exists, list] of cases) {
      const found = detect('/p', exists, list).suggest.map((s) => s.pack)
      expect(found, pack).toContain(pack)
    }
  })

  test('a Maven project suggests java and nothing it has not found', () => {
    expect(detect('/p', filesNamed('pom.xml'), listOf()).suggest).toEqual([
      { pack: 'java', why: 'a Java project (pom.xml or build.gradle)' },
    ])
  })

  test('a Cargo project with a Python file suggests python and keeps the rust config exactly', () => {
    const d = detect('/p', filesNamed('Cargo.toml', 'pyproject.toml'), listOf())
    expect(d.kind).toBe('rust')
    expect(d.config).toEqual({ packs: ['rust', 'security', 'hygiene'] })
    expect(d.suggest.map((s) => s.pack)).toEqual(['python'])
  })

  test('a TypeScript Node project suggests node, a plain package.json does not', () => {
    expect(detect('/p', filesNamed('package.json', 'tsconfig.json'), listOf()).suggest.map((s) => s.pack)).toEqual(['node'])
    expect(detect('/p', filesNamed('package.json'), listOf()).suggest).toEqual([])
  })

  test('the old outputs are unchanged: Cargo gives rust, package.json gives only security and hygiene', () => {
    const cargo = detect('/p', filesNamed('Cargo.toml'), listOf())
    expect(cargo.config).toEqual({ packs: ['rust', 'security', 'hygiene'] })
    expect(cargo.suggest).toEqual([])
    const node = detect('/p', filesNamed('package.json'), listOf())
    expect(node.kind).toBe('node')
    expect(node.config).toEqual({ packs: ['security', 'hygiene'] })
    expect(detect('/p', () => false, listOf()).kind).toBe('unknown')
  })

  test('the written config never gains a tool pack; the suggestion is only in the message', () => {
    const files = new Map<string, string>()
    const write = (f: string, text: string) => void files.set(f, text)
    const result = initConfig('/p', { exists: filesNamed('pom.xml'), write, list: listOf() })
    expect(result.written).toBe(true)
    expect(JSON.parse([...files.values()][0])).toEqual({ packs: ['security', 'hygiene'] })
    expect(result.message).toContain('Found a Java project (pom.xml or build.gradle) in this folder. When the tool is installed, add "java" to packs.')
  })
})
