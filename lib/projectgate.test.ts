// The project gate: Meerkat refuses a folder that is not a project, with a plain message, unless --force.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { main } from '../run.mjs'
import { listSubfolders } from './repos.mjs'
import { notProjectJson, notProjectMessage, projectCheck } from './projectgate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-gate-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const folder = (name: string, files: Record<string, string> = {}) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), body)
  }
  return d
}

describe('what counts as a project', () => {
  test.each([
    ['package.json', { 'package.json': '{}' }],
    ['Cargo.toml', { 'Cargo.toml': '' }],
    ['pyproject.toml', { 'pyproject.toml': '' }],
    ['requirements.txt', { 'requirements.txt': '' }],
    ['go.mod', { 'go.mod': '' }],
    ['pom.xml', { 'pom.xml': '' }],
    ['build.gradle', { 'build.gradle': '' }],
    ['a .csproj', { 'App.csproj': '' }],
    ['a .sln', { 'App.sln': '' }],
    ['composer.json', { 'composer.json': '' }],
    ['Gemfile', { Gemfile: '' }],
    ['pubspec.yaml', { 'pubspec.yaml': '' }],
    ['Package.swift', { 'Package.swift': '' }],
    ['Dockerfile', { Dockerfile: '' }],
    ['a .tf file', { 'main.tf': '' }],
    ['index.html with a stylesheet', { 'index.html': '', 'style.css': '' }],
    ['enough source files', Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`m${i}.py`, '']))],
    ['source files one level down', Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`src/m${i}.py`, '']))],
  ])('%s', (name, files) => {
    const d = folder(`ok-${name.replace(/\W+/g, '_')}`, files as Record<string, string>)
    expect(projectCheck(d).ok).toBe(true)
  })
  test('a git repository (the .git folder) counts, and so does a folder inside one', () => {
    const repo = folder('repo-x', { '.git/HEAD': 'ref: refs/heads/main' })
    expect(projectCheck(repo)).toMatchObject({ ok: true, why: 'a git repository' })
    mkdirSync(join(repo, 'sub'))
    expect(projectCheck(join(repo, 'sub')).ok).toBe(true)
  })
  test('an empty folder, a notes folder, a lone index.html and a few files do not', () => {
    expect(projectCheck(folder('empty')).ok).toBe(false)
    expect(projectCheck(folder('notes', { 'a.txt': '', 'b.md': '', 'c.pdf': '' })).ok).toBe(false)
    expect(projectCheck(folder('lone-html', { 'index.html': '' })).ok).toBe(false)
    expect(projectCheck(folder('few', { 'a.py': '', 'b.py': '' })).ok).toBe(false)
  })
  test('the message says why and how to override, and the JSON carries the same text', () => {
    const m = notProjectMessage('C:\\x')
    expect(m).toContain('C:\\x is not a project: no git repository, no package.json, Cargo.toml')
    expect(m).toContain('pass --force to run anyway')
    expect(notProjectJson('C:\\x')).toMatchObject({ ok: false, error: 'not-a-project', exitCode: 2, folder: 'C:\\x', message: m })
  })
  test('the folder browser marks folders that are not projects', () => {
    const parent = folder('browse')
    folder('browse/app', { 'package.json': '{}' })
    folder('browse/photos', { 'a.jpg': '' })
    const { entries } = listSubfolders(parent)
    expect(entries.find((e: any) => e.name === 'app').isProject).toBe(true)
    expect(entries.find((e: any) => e.name === 'photos').isProject).toBe(false)
  })
})

describe('meerkat verify on a folder that is not a project', () => {
  // The temp folder sits under the OS temp dir, which is not inside a git repository.
  const run = async (argv: string[]) => {
    const out: string[] = []
    const code = await main(argv, { log: (l: string) => out.push(l), env: { ...process.env } })
    return { code, out: out.join('\n') }
  }
  test('exit code 2 with the plain message, and nothing is run', async () => {
    const d = folder('gate-run', { 'notes.txt': 'hi' })
    const r = await run(['--app', d, '--plain'])
    expect(r.code).toBe(2)
    expect(r.out).toContain('is not a project')
    expect(r.out).toContain('pass --force to run anyway')
  })
  test('scripts get the same message in --json-stdout', async () => {
    const d = folder('gate-json', { 'notes.txt': 'hi' })
    const r = await run(['--app', d, '--json-stdout'])
    expect(r.code).toBe(2)
    const json = JSON.parse(r.out.slice(r.out.indexOf('{')))
    expect(json).toMatchObject({ ok: false, error: 'not-a-project', exitCode: 2 })
    expect(json.message).toContain('is not a project')
  })
  test('--force runs anyway, and listing needs no project', async () => {
    const d = folder('gate-force', { 'notes.txt': 'hi' })
    const forced = await run(['--app', d, '--force', '--list'])
    expect(forced.code).toBe(0)
    const listed = await run(['--app', d, '--list'])
    expect(listed.code).toBe(0)
    expect(listed.out).not.toContain('is not a project')
  })
})
