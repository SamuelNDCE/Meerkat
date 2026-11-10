// Gate speed: the job count (MEERKAT_JOBS) changes timing only, and the result cache keeps only passed or failed checks whose inputs are unchanged.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain JS modules
import { gateCacheHit, gateKey, settingsDigest, updatedGateCache } from '../lib/gatecache.mjs'
// @ts-expect-error plain JS modules
import { jobsFromEnv } from '../lib/runner.mjs'

const BIN = resolve(__dirname, '../bin/meerkat.mjs')
let demo = ''
let logs = ''
const git = (...a: string[]) => spawnSync('git', ['-C', demo, '-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' })

function gate(extra: Record<string, string> = {}, args: string[] = []) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), MEERKAT_LOG_DIR: logs, ...extra }
  delete env.MEERKAT_JOBS
  Object.assign(env, extra)
  const r = spawnSync('node', [BIN, 'gate', '--base', 'main', ...args], { cwd: demo, encoding: 'utf8', env, timeout: 240000 })
  return { out: r.stdout, code: r.status }
}
const summary = (t: string) => (t.split('\n').find((l) => l.startsWith('MEERKAT gate:')) ?? 'NO SUMMARY: ' + t.slice(0, 800)).replace(/, \d+(\.\d+)?m?s( \(status \d+\))?$/, '')
const failedSet = (t: string) => t.split('\n').filter((l) => l.startsWith('FAIL ')).sort()

beforeAll(() => {
  demo = mkdtempSync(join(tmpdir(), 'gs-demo-'))
  logs = mkdtempSync(join(tmpdir(), 'gs-logs-'))
  git('init', '-q', '-b', 'main')
  writeFileSync(join(demo, 'package.json'), '{"name":"demo","version":"1.0.0","type":"module"}\n')
  for (const i of [1, 2, 3]) writeFileSync(join(demo, `m${i}.js`), `export const f${i} = (a, b) => a + b\n`)
  git('add', '-A'); git('commit', '-qm', 'init'); git('checkout', '-qb', 'feat')
  writeFileSync(join(demo, 'a.js'), 'export const g = (x) => x * 2\n')
  writeFileSync(join(demo, 'b.js'), 'export const h = (x) => x - 1\n')
  git('add', '-A'); git('commit', '-qm', 'feat')
}, 60000)
afterAll(() => {
  rmSync(demo, { recursive: true, force: true })
  rmSync(logs, { recursive: true, force: true })
})

describe('MEERKAT_JOBS', () => {
  test('only a positive whole number counts', () => {
    expect(jobsFromEnv({ MEERKAT_JOBS: '1' })).toBe(1)
    expect(jobsFromEnv({ MEERKAT_JOBS: '4' })).toBe(4)
    for (const bad of ['0', '-2', 'x', '1.5', '']) expect(jobsFromEnv({ MEERKAT_JOBS: bad })).toBeNull()
    expect(jobsFromEnv({})).toBeNull()
  })
  test('the job count is not part of the cache key', () => {
    expect(settingsDigest([], { MEERKAT_JOBS: '1' })).toBe(settingsDigest([], { MEERKAT_JOBS: '8' }))
  })
  test('JOBS=1 and the default give the same check results on the demo folder', () => {
    const one = gate({ MEERKAT_JOBS: '1' }, ['--no-cache'])
    const def = gate({}, ['--no-cache'])
    expect(one.code).toBe(def.code)
    expect(summary(one.out)).toBe(summary(def.out))
    expect(failedSet(one.out)).toEqual(failedSet(def.out))
  }, 300000)
})

describe('gate cache', () => {
  const key = gateKey({ digest: 'd1', tier: 'fast', version: 'v', checkId: 'c' })
  const row = (kind: string) => ({ id: 'c', kind, detail: 'x', findings: [], files: [], places: [] })
  test('a NOT RUN, hung or crashed result is never stored as a reusable hit', () => {
    for (const kind of ['notrun', 'hang', 'crash', 'skipped']) {
      const { cache } = updatedGateCache({ entries: {} }, [{ key, row: row(kind) }])
      expect(gateCacheHit(cache, 'c', key)).toBeNull()
    }
    for (const kind of ['pass', 'fail']) {
      const { cache } = updatedGateCache({ entries: {} }, [{ key, row: row(kind) }])
      expect(gateCacheHit(cache, 'c', key)?.row.kind).toBe(kind)
    }
  })
  test('an entry planted as NOT RUN is not served either', () => {
    const cache = { entries: { c: { key, at: new Date().toISOString(), row: row('notrun') } } }
    expect(gateCacheHit(cache, 'c', key)).toBeNull()
  })
  test('a changed input gives another key, so the stored result is not served', () => {
    const { cache } = updatedGateCache({ entries: {} }, [{ key, row: row('pass') }])
    expect(gateCacheHit(cache, 'c', gateKey({ digest: 'd2', tier: 'fast', version: 'v', checkId: 'c' }))).toBeNull()
  })
  test('end to end: unchanged files are served from the cache, an edited file reruns', () => {
    const first = gate({}, [])
    const second = gate({}, [])
    expect(summary(second.out)).toBe(summary(first.out))
    expect(second.out).toMatch(/cache: \d+ check\(s\) served from the cache/)
    writeFileSync(join(demo, 'a.js'), 'export const g = (x) => x * 3\n')
    git('add', '-A'); git('commit', '-qm', 'edit')
    const third = gate({}, [])
    const hits = (t: string) => Number(/cache: (\d+) check/.exec(t)?.[1] ?? 0)
    expect(hits(third.out)).toBeLessThan(hits(second.out))
  }, 300000)
})
