// The incremental code map (lib/mapsync.mjs): stable output, per-file re-reading, `meerkat map --check`, --quiet, and the MCP map tool and resource.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { checkCodemap, runMap, syncCodemap } from './mapsync.mjs'
// @ts-expect-error plain .mjs module
import { handleMessage } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { latestMapFile } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { readResource } from './mcpextras.mjs'

let tmp: string
let app: string
let env: Record<string, string>
const NOW = new Date('2026-11-07T10:00:00.000Z')
function put(rel: string, text: string) {
  mkdirSync(dirname(join(app, rel)), { recursive: true })
  writeFileSync(join(app, rel), text)
}
function map(argv: string[] = [], now = NOW) {
  const lines: string[] = []
  const errs: string[] = []
  const code = runMap(['--app', app, ...argv], { env, cwd: tmp, out: (l: string) => lines.push(l), err: (l: string) => errs.push(l), now })
  return { code, lines, errs, text: lines.join('\n'), json: () => JSON.parse(lines.join('\n')) }
}
const runFolders = () => (existsSync(join(tmp, 'logs', 'runs')) ? readdirSync(join(tmp, 'logs', 'runs')) : [])
const mapJson = (runDir: string) => readFileSync(join(runDir, 'codemap.json'), 'utf8')

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-mapsync-'))
  app = join(tmp, 'app')
  env = { MEERKAT_LOG_DIR: join(tmp, 'logs') }
  put('package.json', '{"name":"fx","main":"src/server.js"}\n')
  put('src/lib/calc.js', '// Arithmetic helpers.\nexport function add(a, b) {\n  return a + b\n}\n')
  put('src/routes.js', "import express from 'express'\nimport { add } from './lib/calc.js'\nexport const app = express()\napp.get('/health', (req, res) => res.send('ok'))\napp.post('/sum', (req, res) => res.json({ v: add(1, 2) }))\n")
  put('src/server.js', "import { app } from './routes.js'\napp.listen(3000)\n")
  put('tests/calc.test.js', "import { add } from '../src/lib/calc.js'\nconsole.log(add(1, 1))\n")
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('stable output', () => {
  test('an unchanged project gives byte-identical output and no new run folder', () => {
    const a = map([], new Date('2026-11-07T10:00:00.000Z'))
    expect(a.code).toBe(0)
    const dir = a.text.match(/saved in (\S+)/)?.[1] as string
    const first = mapJson(dir)
    const mdFirst = readFileSync(join(dir, 'codemap.md'), 'utf8')
    const b = map(['--json'], new Date('2026-11-07T11:30:00.000Z'))
    expect(b.json()).toMatchObject({ unchanged: true, refreshed: 0, runDir: dir })
    expect(mapJson(dir)).toBe(first)
    expect(readFileSync(join(dir, 'codemap.md'), 'utf8')).toBe(mdFirst)
    expect(runFolders()).toHaveLength(1)
  })
  test('the same project built from scratch twice has the same content hash and sorted files', () => {
    const a = syncCodemap(app, { env: { MEERKAT_LOG_DIR: join(tmp, 'l1') }, now: NOW }).map
    const b = syncCodemap(app, { env: { MEERKAT_LOG_DIR: join(tmp, 'l2') }, now: new Date('2027-01-01T00:00:00Z') }).map
    expect(a.build.contentHash).toBe(b.build.contentHash)
    const paths = a.files.map((f: { path: string }) => f.path)
    expect(paths).toEqual([...paths].sort())
  })
  test('the header has the schema, counts, commit and build time', () => {
    execFileSync('git', ['-C', app, 'init', '-q'])
    execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'add', '-A'])
    execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init'])
    const head = execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const j = map(['--json']).json()
    expect(j.schemaVersion).toBe(2)
    expect(j.build).toMatchObject({ commit: head, builtAt: NOW.toISOString() })
    expect(j.summary).toMatchObject({ files: 4, routes: 2, testFiles: 1 })
    const md = readFileSync(join(j.runDir, 'codemap.md'), 'utf8')
    expect(md).toContain(`built from commit ${head.slice(0, 12)}`)
    expect(md).toContain('schema 2 | 4 files')
  })
  test('functions, purpose, routes with file and line, and which test covers which file', () => {
    const m = syncCodemap(app, { env, now: NOW }).map
    const calc = m.files.find((f: { path: string }) => f.path === 'src/lib/calc.js')
    expect(calc.purpose).toBe('Arithmetic helpers.')
    expect(calc.symbols).toEqual([{ name: 'add', kind: 'function', line: 2, exported: true }])
    expect(calc.testedBy).toEqual(['tests/calc.test.js'])
    expect(m.routes).toEqual([
      { method: 'GET', path: '/health', file: 'src/routes.js', line: 4, framework: 'express' },
      { method: 'POST', path: '/sum', file: 'src/routes.js', line: 5, framework: 'express' },
    ])
    expect(m.tests).toEqual([{ file: 'tests/calc.test.js', covers: ['src/lib/calc.js'] }])
    expect(m.routing.frameworksParsed).toEqual(['express'])
  })
  test('a framework that is seen but not parsed is named in the header', () => {
    put('src/api.ts', "import { Controller, Get } from '@nestjs/common'\nexport class Api {}\n")
    const m = syncCodemap(app, { env, now: NOW }).map
    expect(m.routing.seenButNotParsed).toEqual(['nestjs'])
    expect(m.routing.note).toContain('NOT parsed')
  })
})

describe('incremental', () => {
  test('a second run reads no file; editing one file re-reads exactly that file', () => {
    const first = syncCodemap(app, { env, now: NOW })
    expect(first.firstBuild).toBe(true)
    expect(first.refreshed).toHaveLength(5)
    const second = syncCodemap(app, { env, now: NOW })
    expect(second.refreshed).toEqual([])
    put('src/routes.js', "import express from 'express'\nexport const app = express()\napp.get('/health', (req, res) => res.send('ok'))\napp.get('/new', (req, res) => res.send('n'))\n")
    const third = syncCodemap(app, { env, now: NOW })
    expect(third.refreshed).toEqual(['src/routes.js'])
    expect(third.map.routes.map((r: { path: string }) => r.path)).toEqual(['/health', '/new'])
  })
  test('touching a file without changing it does not re-read it or make the map stale', () => {
    map()
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(app, 'src/server.js'), later, later)
    expect(syncCodemap(app, { env }).refreshed).toEqual([])
    expect(map(['--check']).code).toBe(0)
  })
  test('the per-file cache is in the Meerkat data folder, not in the project', () => {
    const before = readdirSync(app).sort()
    const s = syncCodemap(app, { env, now: NOW })
    expect(readdirSync(app).sort()).toEqual(before)
    expect(existsSync(s.stateFile)).toBe(true)
    expect(s.stateFile.startsWith(join(tmp, 'logs').split(String.fromCharCode(92)).join('/'))).toBe(true)
  })
  test('a removed file is dropped from the map', () => {
    syncCodemap(app, { env })
    unlinkSync(join(app, 'tests/calc.test.js'))
    const s = syncCodemap(app, { env })
    expect(s.removed).toEqual(['tests/calc.test.js'])
    expect(s.map.summary.files).toBe(3)
  })
})

describe('meerkat map --check', () => {
  test('no map yet is stale; a fresh map is current; an edit, a new file and a removal are listed', () => {
    const none = map(['--check'])
    expect(none.code).toBe(1)
    expect(none.text).toContain('no map has been saved')
    expect(map().code).toBe(0)
    const ok = map(['--check'])
    expect(ok.code).toBe(0)
    expect(ok.text).toContain('map is current')
    put('src/lib/calc.js', 'export function add(a, b) {\n  return a + b + 0\n}\n')
    put('src/new.js', 'export const n = 1\n')
    unlinkSync(join(app, 'src/server.js'))
    const stale = map(['--check'])
    expect(stale.code).toBe(1)
    expect(stale.text).toContain('changed  src/lib/calc.js')
    expect(stale.text).toContain('new      src/new.js')
    expect(stale.text).toContain('removed  src/server.js')
    const j = map(['--check', '--json'])
    expect(j.json().current).toBe(false)
    expect(j.json().stale).toHaveLength(3)
    expect(map().code).toBe(0)
    expect(map(['--check']).code).toBe(0)
  })
  test('a refresh done by blast or brief does not hide that the saved map is behind', () => {
    map()
    put('src/new.js', 'export const n = 1\n')
    syncCodemap(app, { env })
    expect(checkCodemap(app, { env }).current).toBe(false)
  })
  test('--quiet prints nothing when it works and still lists stale files when --check fails', () => {
    const q = map(['--quiet'])
    expect(q.code).toBe(0)
    expect(q.lines).toEqual([])
    expect(map(['--check', '--quiet']).lines).toEqual([])
    put('src/new.js', 'export const n = 1\n')
    const bad = map(['--check', '--quiet'])
    expect(bad.code).toBe(1)
    expect(bad.text).toContain('src/new.js')
  })
  test('warm check on a 300-file project is well under a second', () => {
    for (let i = 0; i < 300; i++) put(`src/gen/f${i}.js`, `import { x${i > 0 ? i - 1 : 0} } from './f${i > 0 ? i - 1 : 0}.js'\nexport const x${i} = ${i}\n`)
    map()
    const t0 = process.hrtime.bigint()
    const r = checkCodemap(app, { env })
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    expect(r.current).toBe(true)
    expect(ms).toBeLessThan(1000)
  })
})

describe('MCP: the map tool and the map resource agree', () => {
  const call = (ctx: unknown, name: string, args: unknown = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
  test('meerkat_map and meerkat://map/latest carry the same schema version as codemap.json', async () => {
    const ctx = {
      version: '9.9.9',
      cwd: app,
      isDirectory: () => true,
      realpath: (p: string) => p,
      roots: () => [],
      readFile: (p: string) => readFileSync(p, 'utf8'),
      latestMap: () => latestMapFile(env, app),
      runCli: async (argv: string[]) => {
        const lines: string[] = []
        const code = runMap(argv.slice(1), { env, cwd: tmp, out: (l: string) => lines.push(l), err: () => {}, now: NOW })
        return { code, stdout: lines.join('\n'), stderr: '', timedOut: false }
      },
    }
    const tool = await call(ctx, 'meerkat_map', {})
    expect(tool.result.isError).not.toBe(true)
    const sc = tool.result.structuredContent
    const res = await readResource('meerkat://map/latest', ctx, (t: string) => t)
    const text: string = res.contents[0].text
    const fromResource = Number(text.match(/^schema (\d+) \|/m)?.[1])
    const fromFile = JSON.parse(readFileSync(join(sc.runFolder, 'codemap.json'), 'utf8')).schemaVersion
    expect(sc.schemaVersion).toBe(2)
    expect(fromResource).toBe(sc.schemaVersion)
    expect(fromFile).toBe(sc.schemaVersion)
    expect(text).toContain('## Routes and endpoints')
    // A second call reuses the saved map instead of writing another one.
    const again = await call(ctx, 'meerkat_map', {})
    expect(again.result.structuredContent.unchanged).toBe(true)
    expect(runFolders()).toHaveLength(1)
  })
})
