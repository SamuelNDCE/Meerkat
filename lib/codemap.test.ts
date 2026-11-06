// The code map (lib/codemap.mjs): parses a small multi-file JS and Python fixture, plus temp projects for edge cases. No network, nothing is run.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildCodemap, codemapMarkdown, extractJsExports, extractJsImports, extractPyImports, maskJs, maskPy, runMap, writeCodemap } from './codemap.mjs'

const FIXTURE = join(__dirname, '..', 'fixtures', 'codemap')
type Imp = { id: string; line: number; kind: string; spec: string; resolution: { status: string; target: string | null; reason?: string; package?: string; mapped?: boolean } }
type FileRec = { id: string; path: string; language: string; lines: number; exports: string[]; imports: Imp[] }

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-codemap-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(tmp, rel)), { recursive: true })
  writeFileSync(join(tmp, rel), text)
}
const file = (map: { files: FileRec[] }, p: string) => map.files.find((f) => f.path === p) as FileRec
const imp = (f: FileRec, spec: string) => f.imports.find((i) => i.spec === spec) as Imp

describe('masking', () => {
  test('JS comments and template bodies are blanked, offsets and newlines stay', () => {
    const src = "// import a from 'x'\nconst s = `import b from 'y'`\n/* require('z') */ import c from 'w'\n"
    const m = maskJs(src)
    expect(m.length).toBe(src.length)
    expect(m.split('\n').length).toBe(src.split('\n').length)
    expect(m).not.toContain("'x'")
    expect(m).not.toContain("'y'")
    expect(m).not.toContain("'z'")
    expect(m).toContain("import c from 'w'")
  })
  test('Python comments and docstrings are blanked', () => {
    const m = maskPy('"""import a"""\n# import b\nimport c\nx = "import d"\n')
    expect(m).not.toMatch(/import [abd]/)
    expect(m).toContain('import c')
  })
})

describe('extraction', () => {
  test('every JS import form, with its line', () => {
    const src = ["import a from './a'", "import { b,", '  c } from "./b"', "import './side'", "export * from './re'", "export { x as y } from './re2'", "const d = require('./d')", "const e = await import('./e')", 'const f = import(name)'].join('\n')
    const got = extractJsImports(src).map((i) => `${i.kind}:${i.spec}:${i.line}:${i.literal}`)
    expect(got).toEqual(["static:./a:1:true", "static:./b:2:true", "static:./side:4:true", "reexport:./re:5:true", "reexport:./re2:6:true", "require:./d:7:true", "dynamic:./e:8:true", "dynamic:name:9:false"])
  })
  test('JS exports: named, default, lists, re-exports and CommonJS', () => {
    const src = "export function a() {}\nexport const b = 1\nexport class C {}\nexport { x as y, z }\nexport default a\nexport * from './m'\nmodule.exports = { p, q: 1 }\nexports.r = 2\n"
    expect(extractJsExports(src)).toEqual(['* from ./m', 'C', 'a', 'b', 'default', 'module.exports', 'p', 'q', 'r', 'y', 'z'])
  })
  test('a commented-out import is not an import', () => {
    expect(extractJsImports("// import x from './no'\n/* import y from './no2' */\n")).toEqual([])
  })
  test('Python import forms', () => {
    const got = extractPyImports('import os, json as j\nfrom a.b import (c,\n   d as e)\nfrom .. import f\n').map((i) => `${i.kind}:${'.'.repeat(i.dots)}${i.module}:${i.names.join('+')}:${i.line}`)
    expect(got).toEqual(['import:os::1', 'import:json::1', 'from:a.b:c+d:2', 'from:..:f:4'])
  })
})

describe('the fixture', () => {
  const map = buildCodemap(FIXTURE)

  test('schema fields and version', () => {
    expect(map.schemaVersion).toBe(1)
    expect(Object.keys(map).sort()).toEqual(['app', 'entryPoints', 'files', 'generator', 'limits', 'moduleEdges', 'modules', 'mostImported', 'skipped', 'summary', 'unresolved', 'schemaVersion'].sort())
    for (const f of map.files) expect(Object.keys(f).sort()).toEqual(['exports', 'id', 'imports', 'language', 'lines', 'path'])
    expect(map.app.name).toBe('codemap')
    expect(JSON.stringify(map)).not.toMatch(/[A-Za-z]:[\\/]|Users/)
  })

  test('files: ids are paths, languages, line counts, exports', () => {
    expect(map.files.map((f: FileRec) => f.id)).toEqual(map.files.map((f: FileRec) => f.path))
    expect(file(map, 'src/util/math.js')).toMatchObject({ language: 'javascript', lines: 6, exports: ['Calc', 'default', 'plus', 'sum'] })
    expect(file(map, 'py/app.py').language).toBe('python')
    expect(file(map, 'py/app.py').exports).toEqual(['App', 'VALUE', 'main'])
    expect(file(map, 'py/sibling.py').exports).toEqual(['public'])
    expect(file(map, 'src/server.js').exports).toEqual(['greet', 'lazy', 'module.exports', 'start'].filter((x) => x !== 'dynamic').concat('dynamic').sort())
  })

  test('JS imports resolve to local files with the right line', () => {
    const idx = file(map, 'src/index.js')
    expect(imp(idx, './util/greet.js')).toMatchObject({ line: 2, kind: 'static', resolution: { status: 'local', target: 'src/util/greet.js', mapped: true } })
    expect(imp(idx, './util/math.js').line).toBe(3)
    expect(imp(idx, './side-effect.js').resolution.target).toBe('src/side-effect.js')
    expect(file(map, 'src/server.js').imports.find((i) => i.spec === './util/greet')?.resolution.target).toBe('src/util/greet.js')
    expect(file(map, 'bin/fx.js').imports[0].resolution.target).toBe('src/index.js')
  })

  test('packages and builtins are external, never local', () => {
    const idx = file(map, 'src/index.js')
    expect(imp(idx, 'left-pad').resolution).toMatchObject({ status: 'external', target: null, package: 'left-pad' })
    expect(imp(idx, 'node:fs').resolution).toMatchObject({ status: 'external', reason: 'node builtin' })
    expect(file(map, 'src/server.js').imports.find((i) => i.spec === 'http')?.resolution.status).toBe('external')
  })

  test('what cannot be resolved is marked unresolved with a reason', () => {
    expect(imp(file(map, 'src/index.js'), './missing.js').resolution).toMatchObject({ status: 'unresolved', target: null })
    const dyn = file(map, 'src/server.js').imports.find((i) => i.kind === 'dynamic' && i.spec === 'name')
    expect(dyn?.resolution).toMatchObject({ status: 'unresolved', reason: 'specifier is not a string literal' })
    const py = file(map, 'py/app.py')
    expect(imp(py, 'nowhere').resolution.status).toBe('unresolved')
    expect(imp(py, 'os').resolution.status).toBe('unresolved')
    expect(imp(py, '.missing_rel').resolution.status).toBe('unresolved')
    const specs = map.unresolved.map((u: { spec: string }) => u.spec)
    expect(specs).toEqual(expect.arrayContaining(['./missing.js', 'name', 'nowhere', 'os', '.missing_rel']))
    for (const u of map.unresolved) expect(u.reason).toBeTruthy()
  })

  test('Python: relative, package and submodule imports, docstring and comment ignored', () => {
    const py = file(map, 'py/app.py')
    expect(py.imports.some((i) => i.spec === 'fake_mod' || i.spec === 'commented_out')).toBe(false)
    expect(py.imports.filter((i) => i.resolution.target === 'py/pkg/core.py').length).toBeGreaterThanOrEqual(2)
    expect(py.imports.filter((i) => i.resolution.target === 'py/pkg/helpers.py').length).toBe(1)
    expect(py.imports.find((i) => i.resolution.target === 'py/sibling.py')).toMatchObject({ kind: 'py-from', line: 6 })
    expect(file(map, 'py/pkg/core.py').imports[0].resolution.target).toBe('py/pkg/helpers.py')
    expect(py.imports.find((i) => i.resolution.target === 'py/pkg/core.py')?.resolution).toMatchObject({ note: expect.stringContaining('importing file folder') })
  })

  test('every import has a stable id, a source file (its owner) and a line', () => {
    const seen = new Set<string>()
    for (const f of map.files as FileRec[]) {
      for (const i of f.imports) {
        expect(i.id.startsWith(`${f.path}#${i.line}.`)).toBe(true)
        expect(i.line).toBeGreaterThan(0)
        expect(seen.has(i.id)).toBe(false)
        seen.add(i.id)
      }
    }
  })

  test('entry points: package main, bin, scripts, conventions, shebang, python main', () => {
    const by = (id: string) => map.entryPoints.find((e: { id: string }) => e.id === id)
    expect(by('package.json#package-main')).toMatchObject({ file: 'src/index.js', status: 'local', source: { file: 'package.json', line: 4 } })
    expect(by('package.json#package-bin:fx')).toMatchObject({ file: 'bin/fx.js', status: 'local' })
    expect(by('package.json#package-script:start')).toMatchObject({ file: 'src/server.js', status: 'local' })
    expect(by('package.json#package-script:test')).toMatchObject({ file: null, status: 'command-only' })
    expect(by('src/index.js#convention')).toBeTruthy()
    expect(by('bin/fx.js#shebang')).toBeTruthy()
    expect(by('py/app.py#python-main')).toMatchObject({ source: { file: 'py/app.py', line: 22 } })
  })

  test('modules and their dependency edges carry source file and line', () => {
    expect(map.modules.map((m: { id: string }) => m.id)).toEqual(['bin', 'py', 'src/util', 'src'].sort())
    const e = map.moduleEdges.find((x: { id: string }) => x.id === 'bin -> src')
    expect(e).toMatchObject({ from: 'bin', to: 'src', count: 1, sources: [{ file: 'bin/fx.js', line: 2, spec: '../src/index.js', target: 'src/index.js' }] })
    expect(map.moduleEdges.find((x: { id: string }) => x.id === 'src -> src/util')).toBeTruthy()
    expect(map.moduleEdges.find((x: { id: string }) => x.id === 'src/util -> src/util')).toBeUndefined()
    for (const edge of map.moduleEdges) for (const s of edge.sources) expect(s.line).toBeGreaterThan(0)
    expect(map.modules.find((m: { id: string }) => m.id === 'bin').dependsOn).toEqual(['src'])
  })

  test('most imported files, ranked, at most 20', () => {
    expect(map.mostImported.length).toBeLessThanOrEqual(20)
    expect(map.mostImported[0]).toMatchObject({ id: 'src/util/math.js', importedBy: 4 })
    const counts = map.mostImported.map((m: { importedBy: number }) => m.importedBy)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
  })

  test('deterministic: two runs give identical JSON', () => {
    expect(JSON.stringify(buildCodemap(FIXTURE))).toBe(JSON.stringify(map))
  })

  test('markdown summary is short and has the sections, with no em dashes', () => {
    const md = codemapMarkdown(map)
    for (const h of ['# Code map', '## Entry points', '## Modules', '## Most imported files', '## Unresolved', '## How to read this']) expect(md).toContain(h)
    expect(md.split('\n').length).toBeLessThan(80)
    expect(md).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('edge cases', () => {
  test('TypeScript: .js specifier resolves to the .ts file, index files and directories', () => {
    put('src/a.ts', "import { b } from './b.js'\nimport c from './c'\nexport const a = b\n")
    put('src/b.ts', 'export const b = 1\n')
    put('src/c/index.tsx', 'export default 1\n')
    const map = buildCodemap(tmp)
    const a = file(map, 'src/a.ts')
    expect(a.language).toBe('typescript')
    expect(imp(a, './b.js').resolution.target).toBe('src/b.ts')
    expect(imp(a, './c').resolution.target).toBe('src/c/index.tsx')
  })
  test('aliases and escapes outside the folder are unresolved, not guessed', () => {
    put('a.ts', "import x from '@/lib/x'\nimport y from '../outside'\nimport z from '#internal'\n")
    const a = file(buildCodemap(tmp), 'a.ts')
    expect(a.imports.map((i) => i.resolution.status)).toEqual(['unresolved', 'unresolved', 'unresolved'])
    expect(imp(a, '../outside').resolution.reason).toBe('points outside the app folder')
  })
  test('a local non-source target (json) is local but not mapped', () => {
    put('a.js', "import d from './data.json'\n")
    put('data.json', '{}')
    const m = buildCodemap(tmp)
    expect(imp(file(m, 'a.js'), './data.json').resolution).toMatchObject({ status: 'local', target: 'data.json', mapped: false })
    expect(m.mostImported).toEqual([])
  })
  test('package.json entry that points at a missing file is unresolved; invalid JSON is reported', () => {
    put('package.json', JSON.stringify({ main: 'nope.js' }))
    put('sub/package.json', '{ not json')
    const m = buildCodemap(tmp)
    expect(m.entryPoints.find((e: { id: string }) => e.id === 'package.json#package-main')).toMatchObject({ file: null, status: 'unresolved' })
    expect(m.entryPoints.find((e: { id: string }) => e.id === 'sub/package.json#unreadable')).toMatchObject({ status: 'unresolved' })
    expect(m.unresolved.length).toBe(2)
  })
  test('node_modules, dist and hidden build folders are skipped; big files are reported as skipped', () => {
    put('node_modules/x/index.js', "import 'y'\n")
    put('dist/out.js', 'export const o = 1\n')
    put('real.js', 'export const r = 1\n')
    put('huge.js', `export const h = "${'a'.repeat(1_000_100)}"\n`)
    const m = buildCodemap(tmp)
    expect(m.files.map((f: FileRec) => f.path)).toEqual(['real.js'])
    expect(m.skipped).toEqual([{ path: 'huge.js', reason: 'larger than 1000000 bytes' }])
  })
  test('empty folder gives an empty, valid map', () => {
    const m = buildCodemap(tmp)
    expect(m.summary).toMatchObject({ files: 0, imports: 0, modules: 0 })
    expect(codemapMarkdown(m)).toContain('None found.')
  })
  test('CRLF files keep correct line numbers', () => {
    put('a.js', "const q = 1\r\nimport x from './b.js'\r\n")
    put('b.js', 'export default 1\r\n')
    expect(imp(file(buildCodemap(tmp), 'a.js'), './b.js').line).toBe(2)
  })
})

describe('writing and the command', () => {
  test('writeCodemap puts codemap.json and codemap.md in the run folder', () => {
    const run = join(tmp, 'run')
    const r = writeCodemap(FIXTURE, run)
    expect(existsSync(r.json)).toBe(true)
    expect(existsSync(r.md)).toBe(true)
    expect(JSON.parse(readFileSync(r.json, 'utf8')).schemaVersion).toBe(1)
  })
  test('runMap --app writes both files into a new run folder and prints it', () => {
    const lines: string[] = []
    const code = runMap(['--app', FIXTURE, '--json'], { env: { MEERKAT_LOG_DIR: join(tmp, 'logs') }, out: (l: string) => lines.push(l), err: () => {} })
    expect(code).toBe(0)
    const out = JSON.parse(lines.join('\n'))
    expect(existsSync(join(out.runDir, 'codemap.json'))).toBe(true)
    expect(existsSync(join(out.runDir, 'codemap.md'))).toBe(true)
    expect(out.runDir).toContain('codemap')
  })
  test('runMap rejects a missing folder, a missing value and unknown options', () => {
    const errs: string[] = []
    const err = (l: string) => errs.push(l)
    const env = { MEERKAT_LOG_DIR: join(tmp, 'logs') }
    expect(runMap(['--app', join(tmp, 'nope')], { env, err })).toBe(2)
    expect(runMap(['--app'], { env, err })).toBe(2)
    expect(runMap(['--wat'], { env, err })).toBe(2)
    expect(errs.length).toBe(3)
    expect(existsSync(join(tmp, 'logs'))).toBe(false)
  })
})
