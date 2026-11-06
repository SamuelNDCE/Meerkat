// Refactor context (lib/refactorctx.mjs): importers, tests, unresolved imports, catalog list and blast radius.
// Uses fixtures/codemap and small temp projects. No network, nothing is run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildCodemap } from './codemap.mjs'
import { listCatalog, parseTarget, refactorCtx, refactorCtxText } from './refactorctx.mjs'

const FIXTURE = join(__dirname, '..', 'fixtures', 'codemap')
let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-refctx-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true })
  writeFileSync(join(tmp, rel), text)
}
const NO_CATALOG = { catalogDir: null }

describe('target parsing', () => {
  test('file, file#symbol and object forms', () => {
    expect(parseTarget('src/a.js')).toEqual({ file: 'src/a.js', symbol: null })
    expect(parseTarget('src/a.js#go')).toEqual({ file: 'src/a.js', symbol: 'go' })
    expect(parseTarget({ file: 'x.py', symbol: 'f' })).toEqual({ file: 'x.py', symbol: 'f' })
  })
})

describe('on fixtures/codemap', () => {
  test('math.js: exports, importers with lines, module and unresolved candidates', () => {
    const r = refactorCtx(FIXTURE, 'src/util/math.js', NO_CATALOG)
    expect(r.found).toBe(true)
    expect(r.exports).toEqual(expect.arrayContaining(['sum', 'Calc']))
    expect(r.importers.map((i: { file: string; line: number }) => `${i.file}:${i.line}`)).toEqual(['src/index.js:3', 'src/server.js:3', 'src/side-effect.js:1', 'src/util/greet.js:1'])
    // server.js has import(name): not a string literal, so it could be this file and must be listed, not ignored.
    expect(r.unresolved.some((u: { file: string; spec: string }) => u.file === 'src/server.js')).toBe(true)
    expect(r.blastRadius.anyUnresolved).toBe(true)
    expect(r.blastRadius.importerCount).toBe(4)
    expect(r.blastRadius.line).toContain('could also be importers')
    expect(r.module.id).toBe(r.target.module)
  })
  test('an unresolved import with a matching name is a candidate; an unrelated one is not', () => {
    const r = refactorCtx(FIXTURE, 'src/util/greet.js', NO_CATALOG)
    expect(r.importers.length).toBeGreaterThan(0)
    const missing = refactorCtx(FIXTURE, 'src/side-effect.js', NO_CATALOG)
    expect(missing.unresolved.every((u: { spec: string }) => u.spec !== './missing.js')).toBe(true)
  })
  test('python target', () => {
    const r = refactorCtx(FIXTURE, 'py/pkg/core.py', NO_CATALOG)
    expect(r.target.language).toBe('python')
    expect(r.exports).toContain('run')
    expect(r.importers.map((i: { file: string }) => i.file)).toContain('py/app.py')
  })
  test('absolute-looking and ./ paths are normalised', () => {
    expect(refactorCtx(FIXTURE, './src/util/math.js', NO_CATALOG).found).toBe(true)
    expect(refactorCtx(FIXTURE, join(FIXTURE, 'src', 'util', 'math.js'), NO_CATALOG).found).toBe(true)
  })
  test('unknown file is reported, not guessed', () => {
    const r = refactorCtx(FIXTURE, 'src/nope.js', NO_CATALOG)
    expect(r.found).toBe(false)
    expect(r.reason).toMatch(/not in the code map/)
    expect(refactorCtxText(r)).toContain('not found')
  })
  test('accepts a prebuilt code map', () => {
    const map = buildCodemap(FIXTURE)
    expect(refactorCtx(FIXTURE, 'src/util/math.js', { ...NO_CATALOG, map }).importers.length).toBe(4)
  })
})

describe('own fixture: chain, tests, symbols, clean target', () => {
  beforeEach(() => {
    put('src/core.ts', 'export function work() {}\nexport const LIMIT = 3\n')
    put('src/mid.ts', "import { work } from './core'\nexport const run = () => work()\n")
    put('src/other.ts', "// work is only in a comment\nimport { LIMIT } from './core'\nexport const x = LIMIT\n")
    put('src/mid.test.ts', "import { run } from './mid'\nrun()\n")
    put('tests/core.spec.ts', "import { work } from '../src/core'\nwork()\n")
    put('src/lonely.ts', 'export const z = 1\n')
    put('src/dyn.ts', 'export const load = (n: string) => import(n)\n')
  })
  test('direct and transitive tests say how they matched', () => {
    const r = refactorCtx(tmp, 'src/core.ts', NO_CATALOG)
    const direct = r.tests.find((t: { file: string }) => t.file === 'tests/core.spec.ts')
    const via = r.tests.find((t: { file: string }) => t.file === 'src/mid.test.ts')
    expect(direct).toMatchObject({ matched: 'direct', line: 1 })
    expect(via).toMatchObject({ matched: 'transitive', chain: ['src/mid.test.ts', 'src/mid.ts', 'src/core.ts'] })
    expect(r.blastRadius.testsReaching).toBe(2)
    expect(r.blastRadius.reachableFileCount).toBe(4)
  })
  test('symbol: exported flag and text-match mentions (comments ignored)', () => {
    const r = refactorCtx(tmp, 'src/core.ts#work', NO_CATALOG)
    expect(r.symbol.exported).toBe(true)
    const byFile = Object.fromEntries(r.importers.map((i: { file: string; mentionsSymbol: boolean }) => [i.file, i.mentionsSymbol]))
    expect(byFile['src/mid.ts']).toBe(true)
    expect(byFile['src/other.ts']).toBe(false)
    expect(refactorCtxText(r)).toContain('does not mention work')
  })
  test('symbol that is not exported carries a warning', () => {
    const r = refactorCtx(tmp, { file: 'src/core.ts', symbol: 'ghost' }, NO_CATALOG)
    expect(r.symbol.exported).toBe(false)
    expect(r.symbol.warning).toMatch(/not in the exported names/)
  })
  test('a file nobody imports, with a run-time import elsewhere, still flags the unresolved one', () => {
    const r = refactorCtx(tmp, 'src/lonely.ts', NO_CATALOG)
    expect(r.importers).toEqual([])
    expect(r.unresolved.map((u: { file: string }) => u.file)).toEqual(['src/dyn.ts'])
    expect(r.blastRadius.anyUnresolved).toBe(true)
  })
  test('without any unresolved import the blast line says so', () => {
    const t2 = mkdtempSync(join(tmpdir(), 'meerkat-refctx2-'))
    try {
      writeFileSync(join(t2, 'a.js'), 'export const a = 1\n')
      writeFileSync(join(t2, 'b.js'), "import { a } from './a.js'\nexport const b = a\n")
      const r = refactorCtx(t2, 'a.js', NO_CATALOG)
      expect(r.blastRadius.anyUnresolved).toBe(false)
      expect(r.blastRadius.line).toContain('no unresolved import could be an importer')
      expect(r.blastRadius.line).toContain('1 importer (1 import line)')
    } finally {
      rmSync(t2, { recursive: true, force: true })
    }
  })
  test('JSON round-trips and text form lists sections', () => {
    const r = refactorCtx(tmp, 'src/core.ts', NO_CATALOG)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
    const text = refactorCtxText(r)
    for (const s of ['blast radius:', 'exports:', 'importers (', 'tests that reach it (', 'catalog entries for typescript']) expect(text).toContain(s)
    expect(text).not.toMatch(/2014/)
  })
})

describe('catalog listing', () => {
  test('lists entries by pack folder or glob, by reading text only', () => {
    put('cat/python/py.mjs', "export default [{ id: 'py-lint', title: 'Python lint', paths: ['**/*.py'] }]\nthrow new Error('must never run')\n")
    put('cat/web/web.mjs', "export default [{ id: 'css-lint', title: 'CSS', paths: ['**/*.css'] }, { id: 'ts-types', title: 'TS types', paths: ['**/*.{ts,tsx}'] }]\n")
    const py = listCatalog(join(tmp, 'cat'), 'python', '.py')
    expect(py.entries.map((e: { id: string }) => e.id)).toEqual(['py-lint'])
    expect(py.entries[0].matchedBy).toContain('python pack')
    const ts = listCatalog(join(tmp, 'cat'), 'typescript', '.ts')
    expect(ts.entries.map((e: { id: string }) => e.id)).toEqual(['css-lint', 'ts-types'])
  })
  test('missing folder says found:false, never an empty claim of "no checks"', () => {
    const c = listCatalog(join(tmp, 'absent'), 'python', '.py')
    expect(c.found).toBe(false)
    expect(c.entries).toEqual([])
  })
  test('default catalog finds real Meerkat entries for a JS target', () => {
    const r = refactorCtx(FIXTURE, 'src/util/math.js')
    expect(r.catalog.found).toBe(true)
    expect(r.catalog.entries.length).toBeGreaterThan(0)
  })
})
