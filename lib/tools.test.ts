// Tool discovery, `meerkat tools`, and the built-in fallbacks. Temp folders and fakes only; nothing is installed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { markdown, shell, shellBinary, typos, links, yaml, yamlProblems, markdownProblems } from './builtin.mjs'
import { combinedCommand, installNpmTools, toolsReport, toolsText } from './tools.mjs'
import { extraToolDirs, findBinary, localPath, missingReason } from './which.mjs'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-tools-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const put = (rel: string, text = '') => {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
  return full
}

describe('tool discovery', () => {
  test('finds the project node_modules, python venv, cargo, go, dotnet and the private cache, after the real PATH', () => {
    const home = join(dir, 'home')
    for (const d of ['proj/node_modules/.bin', 'proj/.venv/Scripts', 'proj/venv/bin', 'home/.meerkat/tools/node_modules/.bin', 'home/.cargo/bin', 'home/go/bin', 'home/.dotnet/tools']) mkdirSync(join(dir, d), { recursive: true })
    const dirs = extraToolDirs({}, [join(dir, 'proj')], home.replace(dir, dir))
    const rel = dirs.map((d) => d.replace(dir, '').replace(/\\/g, '/'))
    expect(rel).toEqual(['/proj/node_modules/.bin', '/proj/.venv/Scripts', '/proj/venv/bin', '/home/.meerkat/tools/node_modules/.bin', '/home/.cargo/bin', '/home/go/bin', '/home/.dotnet/tools'])
    const p = localPath({ PATH: '/usr/bin' }, [join(dir, 'proj')], home)
    expect(p.PATH.startsWith(`/usr/bin${delimiter}`)).toBe(true)
  })

  test('a folder that does not exist is left out, and no extra folder means no change to PATH', () => {
    expect(localPath({ PATH: '/x' }, [join(dir, 'nothing')], join(dir, 'nohome'))).toEqual({})
  })

  test('a Windows .cmd shim resolves through PATHEXT', () => {
    put('bin/eslint.cmd', '@echo off')
    expect(findBinary('eslint', { PATH: join(dir, 'bin'), PATHEXT: '.EXE;.CMD' }, 'win32')).toMatch(/eslint\.cmd$/)
    expect(findBinary('eslint', { PATH: join(dir, 'bin') }, 'linux')).toBeNull()
  })

  test('the private cache folder honours MEERKAT_TOOLS_DIR', () => {
    mkdirSync(join(dir, 't/node_modules/.bin'), { recursive: true })
    expect(extraToolDirs({ MEERKAT_TOOLS_DIR: join(dir, 't') }, [], join(dir, 'nohome'))).toEqual([join(dir, 't/node_modules/.bin')])
  })
})

describe('missing tool reason and the tools report', () => {
  test('the reason is one short line', () => {
    expect(missingReason(['prettier'], 'npm i -D prettier')).toBe('needs prettier: meerkat tools install')
    expect(missingReason(['hadolint'], 'your package manager (brew, scoop: hadolint)')).toBe('needs hadolint: your package manager (brew, scoop: hadolint)')
  })

  test('one combined command per ecosystem, only for what is missing', () => {
    const found = new Set(['eslint'])
    const r = toolsReport({ env: {}, dirs: [], home: join(dir, 'h'), find: (bin: string) => (found.has(bin) ? `/x/${bin}` : null) })
    expect(r.commands.npm).toContain('--ignore-scripts')
    expect(r.commands.npm).not.toContain(' eslint')
    expect(r.commands.npm).toContain('typescript')
    expect(r.commands.pip).toBe('pip install yamllint ruff mypy bandit vulture pytest')
    expect(r.commands.cargo).toBe('cargo install typos-cli lychee')
    expect(toolsText(r)).toContain('MISSING prettier')
    expect(combinedCommand('npm', [])).toBeNull()
  })

  test('install runs npm with --prefix and --ignore-scripts into the private folder, never the project', () => {
    const r = toolsReport({ env: {}, dirs: [], home: join(dir, 'h'), find: (bin: string) => (bin === 'eslint' ? '/x/eslint' : null) })
    const calls: string[][] = []
    const done = installNpmTools(r, { run: (cmd: string, args: string[]) => (calls.push(args), { status: 0 }) })
    expect(done.ok).toBe(true)
    const a = calls[0]
    expect(a[a.indexOf('--prefix') + 1]).toBe(r.dir)
    expect(a).toContain('--ignore-scripts')
    expect(a).not.toContain('-g')
    expect(a).not.toContain('eslint')
    expect(a).toContain('prettier')
    expect(installNpmTools(r, { run: () => ({ status: 1 }) }).ok).toBe(false)
  })

  test('nothing to install when every npm tool is found', () => {
    const r = toolsReport({ env: {}, dirs: [], home: join(dir, 'h'), find: (bin: string) => `/x/${bin}` })
    expect(installNpmTools(r, { run: () => { throw new Error('must not run') } }).installed).toEqual([])
  })
})

describe('built-in fallbacks', () => {
  const files = (list: string[]) => ({ root: dir, files: list })

  test('typos: bad and good', () => {
    put('a.md', 'We recieve a seperate message.\n\n```\nrecieve in a fence is ignored\n```\nAlso `recieve` inline is ignored and https://x.test/recieve too.\n')
    put('b.mjs', '// teh comment is wrong\nconst recieve = 1\n')
    put('c.md', 'All words are right here. constructor and toString are not typos.\n')
    const r = typos(files(['a.md', 'b.mjs', 'c.md']))
    expect(r.findings).toEqual(['a.md:1 "recieve" should be "receive"', 'a.md:1 "seperate" should be "separate"', 'b.mjs:1 "teh" should be "the"'])
  })

  test('yaml: tabs and duplicate keys are found, a clean file and block text are not', () => {
    expect(yamlProblems('a: 1\nb: 2\na: 3\n')).toHaveLength(1)
    expect(yamlProblems('a:\n\tb: 1\n')[0]).toMatch(/tab/)
    expect(yamlProblems('a:\n  x: 1\nb:\n  x: 2\n')).toEqual([])
    expect(yamlProblems('steps:\n  - name: a\n    run: x\n  - name: b\n    run: y\n')).toEqual([])
    expect(yamlProblems('run: |\n  a: 1\n  a: 2\nnext: 1\n')).toEqual([])
    expect(yamlProblems('---\na: 1\n---\na: 2\n')).toEqual([])
    put('x.yaml', 'a: 1\na: 2\n')
    expect(yaml(files(['x.yaml'])).findings[0]).toMatch(/x\.yaml: line 2/)
  })

  test('markdown: unclosed fence, heading jump, empty link; clean text passes', () => {
    expect(markdownProblems('# T\n\n### Jump\n')).toHaveLength(1)
    expect(markdownProblems('# T\n\n```js\nx\n')[0]).toMatch(/never closed/)
    expect(markdownProblems('# T\n\n[x]()\n')[0]).toMatch(/empty target/)
    expect(markdownProblems('# T\n\n## U\n\n```js\n### not a heading\n```\n')).toEqual([])
    put('m.md', '# T\n\n```\nx\n')
    expect(markdown(files(['m.md'])).findings).toHaveLength(1)
  })

  test('links: a missing relative target is found, existing ones, urls and anchors are not', () => {
    put('docs/a.md', 'See [b](b.md) and [c](../c.md#top) and [web](https://x.test/y) and [anchor](#here) and [gone](nope.md).\n')
    put('docs/b.md', '# b\n')
    put('c.md', '# c\n')
    const r = links(files(['docs/a.md', 'docs/b.md', 'c.md']))
    expect(r.findings).toEqual(['docs/a.md:1 link to a file that does not exist: nope.md'])
  })

  test.runIf(Boolean(shellBinary()))('shell: a syntax error is found, a good script and CRLF line ends are not', () => {
    put('bad.sh', '#!/bin/sh\nif true; then\n  echo hi\n')
    put('good.sh', '#!/bin/sh\nif true; then\n  echo hi\nfi\n')
    put('crlf.sh', '#!/bin/sh\r\nif true; then\r\n  echo hi\r\nfi\r\n')
    const r = shell(files(['bad.sh', 'good.sh', 'crlf.sh']))
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatch(/^bad\.sh/)
  })

  test('the wrapper says "built-in fallback" and fails on the bad fixture', () => {
    const repo = resolve(__dirname, '..')
    const r = spawnSync(process.execPath, [join(repo, 'thorough/tool-or-builtin.mjs'), '--bin', 'no-such-tool-xyz', '--fallback', 'yaml', '--builtin-root', join(repo, 'fixtures/tools/builtin/yaml'), '--force-fallback'], { encoding: 'utf8', cwd: dir })
    expect(r.stdout).toContain('built-in fallback')
    expect(r.status).toBe(1)
  })
})
