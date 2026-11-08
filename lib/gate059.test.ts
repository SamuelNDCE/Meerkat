// 0.5.9: the compact gate (CLI and MCP), blocking versus pre-existing findings, and the meerkat_summary tool.
// Every case runs the real CLI (bin/meerkat.mjs) or the real MCP handler in a scratch git repository.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { createContext, handleMessage } from './mcp.mjs'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-059-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const sqlLines = (n: number) => Array.from({ length: n }, (_, i) => `export function f${i}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }`).join('\n') + '\n'
const cli = (args: string[]) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), ...args], { encoding: 'utf8', env, timeout: 170000 })
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) }
}
// A repo on main with one old file full of SQL concatenation and one clean file; `feat` adds a changed file.
const repo = (name: string, change: (d: string) => void) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true,"main":"index.js"}')
  put(d, 'index.js', ["import './src/ok.js'", "import './src/old.js'", ''].join('\n'))
  put(d, 'src/old.js', sqlLines(5))
  put(d, 'src/ok.js', 'export const ok = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  change(d)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change')
  return d
}

let big: string
let small: string
beforeAll(() => {
  big = repo('big', (d) => put(d, 'src/new.js', sqlLines(200)))
  small = repo('small', (d) => put(d, 'src/ok.js', 'export const ok = 2\n'))
})

describe('compact gate on the CLI', () => {
  test('a gate with 200 findings prints under 2 KB by default and the whole list with --full', () => {
    const d = cli(['gate', '--no-input', '--no-cache', '--base', 'main', big])
    expect(d.code).toBe(1)
    expect(Buffer.byteLength(d.out)).toBeLessThan(2048)
    expect(d.out).toMatch(/MEERKAT gate: \d+ blocking, \d+ pre-existing \(not in the change\)/)
    expect(d.out).toMatch(/FAIL {2}sql-concat \(\d+\)/)
    expect(d.out).toMatch(/logs: .*runs/)
    expect(d.out).not.toContain('src/new.js:')
    const f = cli(['gate', '--no-input', '--no-cache', '--base', 'main', '--full', big])
    expect(Buffer.byteLength(f.out)).toBeGreaterThan(Buffer.byteLength(d.out) * 5)
    expect(f.out).toContain('src/new.js:')
  }, 200000)

  test('findings only in files the change did not touch are pre-existing: listed as a count, exit code 0', () => {
    const r = cli(['gate', '--no-input', '--no-cache', '--base', 'main', small])
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/MEERKAT gate: 0 blocking, [1-9]\d* pre-existing \(not in the change\)/)
    expect(r.out).toMatch(/pre-existing: \d+ finding\(s\) in \d+ check\(s\) are not in the files you changed and do not block/)
    const j = JSON.parse(cli(['gate', '--no-input', '--no-cache', '--base', 'main', '--json', small]).out.split('\n').filter((l) => !l.startsWith('folder:')).join('\n'))
    expect(j.blocking).toBe(0)
    expect(j.preExisting).toBeGreaterThan(0)
    expect(j.status).toBe('passed')
  }, 200000)

  test('the blocking count comes first and only counts findings in changed files; old ones are counted apart', () => {
    const r = cli(['gate', '--no-input', '--no-cache', '--base', 'main', big])
    const m = /MEERKAT gate: (\d+) blocking, (\d+) pre-existing/.exec(r.out)
    expect(Number(m?.[1])).toBeGreaterThan(100)
    expect(Number(m?.[2])).toBeGreaterThan(0)
  }, 200000)
})

describe('compact gate and meerkat_summary over MCP', () => {
  const ctxFor = (dir: string) => ({ ...createContext(env), cwd: dir })
  const call = (ctx: unknown, name: string, args: unknown = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)

  test('meerkat_gate is compact by default and complete with full: true', async () => {
    const ctx = ctxFor(big)
    const d = await call(ctx, 'meerkat_gate', { base: 'main' })
    const text = d.result.content[0].text as string
    expect(d.result.isError).toBe(true)
    expect(Buffer.byteLength(text)).toBeLessThan(2048)
    expect(text).toMatch(/blocking, \d+ pre-existing/)
    expect(text).toMatch(/FAIL {2}sql-concat \(\d+\)/)
    expect(d.result.structuredContent.blocking).toBeGreaterThan(100)
    const f = await call(ctx, 'meerkat_gate', { base: 'main', full: true })
    expect(f.result.content[0].text.length).toBeGreaterThan(text.length)
  }, 300000)

  test('meerkat_summary is listed and answers in under 1 KB on a 200-finding fixture', async () => {
    const list = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'bin', 'meerkat-mcp.mjs'), '--list-tools'], { encoding: 'utf8' }))
    const names = list.tools as string[]
    expect(names).toContain('meerkat_summary')
    const ctx = ctxFor(big)
    const s = await call(ctx, 'meerkat_summary', { base: 'main' })
    const text = s.result.content[0].text as string
    expect(Buffer.byteLength(text)).toBeLessThan(1024)
    expect(text).toMatch(/status: fail \(exit 1\)/)
    expect(text).toMatch(/blocking: \d+/)
    expect(text).toMatch(/pre-existing \(not in the change\): \d+/)
    expect(text).toMatch(/sql-concat \(\d+\)/)
    expect(text).toMatch(/run folder: /)
    expect(s.result.structuredContent.status).toBe('fail')
    const ok = await call(ctxFor(small), 'meerkat_summary', { base: 'main' })
    expect(ok.result.content[0].text).toMatch(/status: pass \(exit 0\)/)
    expect((await call(ctx, 'meerkat_summary', { nope: 1 })).result.isError).toBe(true)
    expect((await call(ctx, 'meerkat_summary', { base: '--upload-pack=x' })).result.isError).toBe(true)
  }, 300000)
})
