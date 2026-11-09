// Item 10 and item 24: --known counts are stable, and an unfinished base comparison never blocks. Real CLI on a fixture repo.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-known053-'))
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
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const cli = join(__dirname, '..', 'bin', 'meerkat.mjs')
const meerkat = (cwd: string, logs: string, env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, logs), NO_COLOR: '1', ...env } as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 170_000 })
  return { code: r.status, out: r.stdout.replace(/\r/g, ''), err: r.stderr.replace(/\r/g, '') }
}
let dir: string
let knownFile: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, '.gitignore', 'logs\n')
  put(dir, 'src/old.js', bug('oldBug'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'feat')
  put(dir, 'src/new.js', bug('newBug'))
  put(dir, 'src/old.js', bug('oldBug') + 'export const touched = 1\n') // changed file, finding already on the base
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'branch')
  const plain = JSON.parse(meerkat(dir, 'logs-probe', { MEERKAT_TEST_BASE_UNFINISHED: '1' }, 'verdict', '--json', '--base', 'main').out)
  const places = (plain.checks as { check: string; places: { file: string; line: number }[] }[]).flatMap((c) => c.places.map((p) => ({ check: c.check, file: p.file, line: p.line })))
  knownFile = join(root, 'known.json')
  writeFileSync(knownFile, JSON.stringify(places.filter((p) => p.file.endsWith('old.js'))))
})

describe('--known is stable (item 10)', () => {
  test('a known entry matching a pre-existing finding is counted and marked preExisting', () => {
    const doc = JSON.parse(meerkat(dir, 'logs-k1', {}, 'verdict', '--json', '--known', knownFile).out)
    expect(doc.known).toBeGreaterThan(0)
    expect(doc.knownFindings.every((k: { preExisting?: boolean }) => k.preExisting === true)).toBe(true)
    expect(doc.stale).toEqual([])
    expect(doc.baseState).toBe('done')
  })
  test('the same known file gives the same knownFindings count whether the base comparison finishes or not', () => {
    const done = JSON.parse(meerkat(dir, 'logs-k2', {}, 'verdict', '--json', '--known', knownFile).out)
    const cut = JSON.parse(meerkat(dir, 'logs-k3', { MEERKAT_TEST_BASE_UNFINISHED: '1' }, 'verdict', '--json', '--known', knownFile).out)
    expect(done.baseState).toBe('done')
    expect(cut.baseState).toBe('unfinished')
    expect(cut.knownFindings.length).toBe(done.knownFindings.length)
    expect(cut.known).toBe(done.known)
    expect(cut.stale).toEqual([])
  })
})

describe('unfinished base comparison (item 24)', () => {
  test('findings are classified unknown and are not counted as blocking', () => {
    const r = meerkat(dir, 'logs-u1', { MEERKAT_TEST_BASE_UNFINISHED: '1' }, 'verdict', '--json')
    const doc = JSON.parse(r.out)
    expect(doc.baseState).toBe('unfinished')
    expect(doc.blocking).toBe(0)
    expect(doc.unknown).toBeGreaterThan(0)
    const places = doc.checks.filter((c: { status: string }) => c.status === 'fail').flatMap((c: { places: { classification?: string }[] }) => c.places)
    expect(places.length).toBeGreaterThan(0)
    expect(places.every((p: { classification?: string }) => p.classification === 'unknown')).toBe(true)
    const text = meerkat(dir, 'logs-u2', { MEERKAT_TEST_BASE_UNFINISHED: '1' }, 'verdict').out
    expect(text).toMatch(/base comparison did not finish: [0-9]+ finding/)
  })
  test('a finished comparison classifies them as new', () => {
    const doc = JSON.parse(meerkat(dir, 'logs-u3', {}, 'verdict', '--json').out)
    expect(doc.baseState).toBe('done')
    expect(doc.blocking).toBe(1)
    const places = doc.checks.filter((c: { status: string }) => c.status === 'fail').flatMap((c: { places: { classification?: string }[] }) => c.places)
    expect(places.every((p: { classification?: string }) => p.classification === 'new')).toBe(true)
  })
})
