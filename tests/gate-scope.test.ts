// The scoped gate (lib/gate.mjs): only a failure in a file that changed blocks; project-wide failures are listed, not blocking; --all restores
// the old behaviour; the first line says blocking count, files scanned and time; a repeat run reuses the cache (lib/gatecache.mjs).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { gateMain } from '../lib/gate.mjs'
import { gatePathsFor, layoutClassOf } from '../lib/gatepaths.mjs'
import { layoutDigest } from '../lib/gatecache.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-gatescope-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}

// One clean commit with no SECURITY.md, then one staged file with a planted SQL-injection bug.
let dir: string
let logs: string
beforeAll(() => {
  dir = join(root, 'repo')
  logs = join(root, 'logs')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'clean')
  put(dir, 'src/bug.js', 'export function find(db, name) { return db.query("SELECT * FROM users WHERE name = " + name) }\n')
  git(dir, 'add', 'src/bug.js')
})

const env = () => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs })
async function gate(args: string[]) {
  const lines: string[] = []
  const code = await gateMain([...args, '--app', dir], { env: env(), cwd: dir, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
  return { code, text: lines.join('\n'), lines }
}
const kindOf = (json: any, id: string) => json.rows.find((r: any) => r.id === id)?.kind

describe('scoped gate', () => {
  test('blocks on the planted bug, not on the missing SECURITY.md; the first line says so', async () => {
    const r = await gate(['--staged', '--no-cache'])
    expect(r.code).toBe(1)
    expect(r.text.split(String.fromCharCode(10))[0]).toMatch(/^MEERKAT gate: 1 blocking, scanned src\/bug\.js, \d+(\.\d)?s$/)
    expect(r.text).toMatch(/sql-concat\s+src\/bug\.js:1/)
    expect(r.text).toMatch(/project-wide, not blocking \(\d+\)/)
    expect(r.text).toMatch(/security-policy: there is no SECURITY\.md/)
    // SECURITY.md is listed under the project-wide heading, not as a FAIL row.
    expect(r.text).not.toMatch(/^FAIL\s+security-policy/m)
  })
  test('--json: sql-concat is fail, security-policy is wide, and the exit code follows the blocking one', async () => {
    const r = await gate(['--staged', '--no-cache', '--json'])
    const j = JSON.parse(r.text)
    expect(kindOf(j, 'sql-concat')).toBe('fail')
    expect(kindOf(j, 'security-policy')).toBe('wide')
    expect(r.code).toBe(1)
  })
  test('--all restores the old behaviour: both fail and both block', async () => {
    const r = await gate(['--staged', '--no-cache', '--all', '--json'])
    const j = JSON.parse(r.text)
    expect(kindOf(j, 'sql-concat')).toBe('fail')
    expect(kindOf(j, 'security-policy')).toBe('fail')
    expect(j.rows.some((x: any) => x.kind === 'wide')).toBe(false)
  })
  test('a staged change with no bug passes even though SECURITY.md is missing', async () => {
    const d = join(root, 'clean')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], discover: false }))
    put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
    put(d, 'src/a.js', 'export const a = 1\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'clean')
    put(d, 'src/a.js', 'export const a = 2\n')
    git(d, 'add', 'src/a.js')
    const lines: string[] = []
    const code = await gateMain(['--staged', '--no-cache', '--app', d], { env: env(), cwd: d, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
    expect(code).toBe(0)
    expect(lines.join(String.fromCharCode(10)).split(String.fromCharCode(10))[0]).toMatch(/^MEERKAT gate: 0 blocking, scanned src\/a\.js/)
    expect(lines.join('\n')).toMatch(/project-wide, not blocking/)
    const all = []
    expect(await gateMain(['--staged', '--no-cache', '--all', '--app', d], { env: env(), cwd: d, log: (l: string) => all.push(l), err: () => {} })).toBe(1)
  })
})

describe('gate result cache', () => {
  test('a repeat run on the same state reuses every result and gives the same verdict', async () => {
    const first = JSON.parse((await gate(['--staged', '--json'])).text)
    const second = await gate(['--staged', '--json'])
    const j = JSON.parse(second.text)
    expect(j.cached).toBeGreaterThan(0)
    expect(j.rows.map((r: any) => `${r.id}:${r.kind}`).sort()).toEqual(first.rows.map((r: any) => `${r.id}:${r.kind}`).sort())
    expect(second.code).toBe(1)
  })
  test('editing a staged file invalidates the checks that read source; a layout-only check key ignores source edits but not package.json', () => {
    const before = layoutDigest(dir)
    put(dir, 'src/ok.js', 'export const ok = (a) => a + 2\n')
    expect(layoutDigest(dir)).toBe(before)
    put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.1', private: true }))
    expect(layoutDigest(dir)).not.toBe(before)
    put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
    put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  })
  test('the tables name only what they should', () => {
    expect(gatePathsFor({ id: 'rust-todo-macros' })).toEqual(['**/*.rs', '**/Cargo.toml'])
    expect(gatePathsFor({ id: 'sql-concat' })).toBeNull()
    expect(layoutClassOf('security-policy')).toBe('layout')
    expect(layoutClassOf('branch-names')).toBe('git')
    expect(layoutClassOf('sql-concat')).toBeNull()
  })
})
