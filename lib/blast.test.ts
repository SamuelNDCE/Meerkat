// meerkat blast (lib/blast.mjs): counts on a three-module fixture, the per-commit map cache, and unresolved imports.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cachedCodemap, runBlast } from './blast.mjs'
import { buildCodemap, writeCodemap } from './codemap.mjs'

let tmp: string
let app: string
let env: Record<string, string>
const readText = (f: string) => readFileSync(f, 'utf8')
function put(rel: string, text: string) {
  mkdirSync(dirname(join(app, rel)), { recursive: true })
  writeFileSync(join(app, rel), text)
}
function git(args: string[]) {
  execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' })
}
const commit = (msg: string) => {
  git(['add', '-A'])
  git(['commit', '-q', '-m', msg])
}
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-blast-'))
  app = join(tmp, 'app')
  env = { MEERKAT_LOG_DIR: join(tmp, 'logs') }
  put('package.json', '{"name":"fx"}\n')
  put('src/core/calc.js', 'export function add(a, b) { return a + b }\nexport const sub = (a, b) => a - b\n')
  put('src/api/a.js', "import { add } from '../core/calc.js'\nexport const total = (x) => add(x, 1)\n")
  put('src/ui/b.js', "import { add } from '../core/calc.js'\nexport const show = () => add(2, 3)\n")
  put('tests/a.test.js', "import { total } from '../src/api/a.js'\nconsole.log(total(1))\n")
  git(['init', '-q'])
  commit('init')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const run = (argv: string[]) => {
  const lines: string[] = []
  const errs: string[] = []
  const code = runBlast(argv, { env, cwd: tmp, out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) })
  return { code, lines, errs, json: () => JSON.parse(lines.join('\n')) }
}

describe('blast counts', () => {
  test('a module whose export two files import, with one test reaching it', () => {
    const r = run(['src/core/calc.js', '--app', 'app', '--json'])
    expect(r.code).toBe(0)
    const j = r.json()
    expect(j.blastRadius.importerCount).toBe(2)
    expect(j.blastRadius.modulesTouched.length).toBe(3)
    expect(j.blastRadius.testsReaching).toBe(1)
    expect(j.tests[0].file).toBe('tests/a.test.js')
    expect(j.blastRadius.anyUnresolved).toBe(false)
  })
  test('text output carries the counts and a symbol is checked against the exports', () => {
    const text = run(['src/core/calc.js#add', '--app', 'app']).lines.join('\n')
    expect(text).toContain('importers: 2')
    expect(text).toContain('tests reaching it: 1')
    expect(text).toContain('mentions add')
    expect(run(['src/core/calc.js#nope', '--app', 'app']).lines.join('\n')).toContain('warning')
  })
  test('exit codes: 75 for an unknown file, 2 for usage errors', () => {
    expect(run(['src/nothing.js', '--app', 'app']).code).toBe(75)
    expect(run([]).code).toBe(2)
    expect(run(['a.js', 'b.js']).code).toBe(2)
    expect(run(['a.js', '--wat']).code).toBe(2)
    expect(run(['a.js', '--app']).code).toBe(2)
    expect(run(['a.js', '--app', 'missing']).code).toBe(2)
  })
})

describe('unresolved imports', () => {
  test('a computed import is listed as possibly an importer, never as not an importer', () => {
    put('src/ui/dyn.js', 'export const load = (name) => import(name)\n')
    commit('dyn')
    const j = run(['src/core/calc.js', '--app', 'app', '--json']).json()
    expect(j.blastRadius.importerCount).toBe(2)
    expect(j.blastRadius.unresolvedCouldBeImporters).toBe(1)
    expect(j.unresolved[0].file).toBe('src/ui/dyn.js')
    expect(j.blastRadius.line).toContain('could also be importers')
    expect(run(['src/core/calc.js', '--app', 'app']).lines.join('\n')).toContain('src/ui/dyn.js')
  })
})

describe('map cache per commit', () => {
  test('the second run reads the cache and does not rebuild', () => {
    let builds = 0
    const build = (d: string) => {
      builds++
      return buildCodemap(d)
    }
    const first = cachedCodemap(app, { env, build })
    expect(first.source).toBe('built')
    expect(existsSync(first.cacheFile as string)).toBe(true)
    const stamp = statSync(first.cacheFile as string).mtimeMs
    const second = cachedCodemap(app, { env, build })
    expect(second.source).toBe('cache')
    expect(builds).toBe(1)
    expect(statSync(second.cacheFile as string).mtimeMs).toBe(stamp)
    expect(second.map.summary.files).toBe(first.map.summary.files)
  })
  test('a changed source file or a new commit rebuilds; a changed doc file does not', () => {
    let builds = 0
    const build = (d: string) => {
      builds++
      return buildCodemap(d)
    }
    cachedCodemap(app, { env, build })
    put('README.md', 'notes\n')
    expect(cachedCodemap(app, { env, build }).source).toBe('cache')
    put('src/ui/b.js', "import { sub } from '../core/calc.js'\nexport const show = () => sub(2, 3)\n")
    expect(cachedCodemap(app, { env, build }).source).toBe('built-uncached')
    commit('edit')
    expect(cachedCodemap(app, { env, build }).source).toBe('built')
    expect(cachedCodemap(app, { env, build }).source).toBe('cache')
    expect(builds).toBe(3)
  })
  test('a folder that is not a git work tree is always built and nothing is cached', () => {
    const plain = join(tmp, 'plain')
    mkdirSync(plain)
    writeFileSync(join(plain, 'x.js'), 'export const x = 1\n')
    const r = cachedCodemap(plain, { env })
    expect(r.source).toBe('built-uncached')
    expect(r.cacheFile).toBe(null)
  })
})

describe('codemap.md', () => {
  test('lists module edges and the blast radius of the most imported files, with no timestamps', () => {
    const a = writeCodemap(app, join(tmp, 'r1'))
    const b = writeCodemap(app, join(tmp, 'r2'))
    const md = readText(a.md)
    expect(md).toContain('## Module edges')
    expect(md).toContain('## Blast radius of the five most imported files')
    expect(md).toContain('src/core/calc.js: 2 importers')
    expect(md).toBe(readText(b.md))
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
