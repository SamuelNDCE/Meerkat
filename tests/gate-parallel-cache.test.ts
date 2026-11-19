// Gate scheduling and cache parity. No cargo runs: a fake runner stands in (ctx.runCommand).
// 1. Checks run at most MEERKAT_JOBS at once; 1 keeps them one after another; cargo-lane checks never overlap each other.
// 2. A cache hit gives the same blocking count and exit code as a fresh run (a passing and a failing fixture).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, runAll } from '../lib/runner.mjs'
// @ts-expect-error plain JS modules
import { gateCacheHit, gateKey, updatedGateCache } from '../lib/gatecache.mjs'

const ctxFor = (env: Record<string, string> = {}) => ({
  timeoutScale: 1, repoRoot: tmpdir(), appDir: tmpdir(), tier: 'fast', env: { ...process.env, ...env }, platform: process.platform, exists: existsSync,
  changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl(),
})

// Function checks that record how many are in flight at once (overall and on the cargo lane) and the order they started.
function tracker() {
  const s = { now: 0, peak: 0, cargoNow: 0, cargoPeak: 0, started: [] as string[] }
  const mk = (id: string, lane = 'free') => ({
    id, title: id, lane, needs: [], timeout: 60,
    run: async () => {
      s.started.push(id)
      s.now++; s.peak = Math.max(s.peak, s.now)
      if (lane === 'cargo') (s.cargoNow++, (s.cargoPeak = Math.max(s.cargoPeak, s.cargoNow)))
      await new Promise((r) => setTimeout(r, 40))
      if (lane === 'cargo') s.cargoNow--
      s.now--
      return { ok: true, detail: '' }
    },
  })
  return { s, mk }
}

describe('check scheduling', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  test('independent checks overlap, never more than MEERKAT_JOBS at once', async () => {
    const { s, mk } = tracker()
    const res = await runAll(ids.map((i) => mk(i)), ctxFor({ MEERKAT_JOBS: '3' }), { log: () => {}, keepGoing: true, parallel: 3 })
    expect(res).toHaveLength(ids.length)
    expect(s.peak).toBeGreaterThan(1)
    expect(s.peak).toBeLessThanOrEqual(3)
  })
  test('MEERKAT_JOBS=1 runs one at a time, in the given order', async () => {
    const { s, mk } = tracker()
    await runAll(ids.map((i) => mk(i)), ctxFor({ MEERKAT_JOBS: '1' }), { log: () => {}, keepGoing: true, parallel: 1 })
    expect(s.peak).toBe(1)
    expect(s.started).toEqual(ids)
  })
  test('checks on the cargo lane never run together, even with many jobs', async () => {
    const { s, mk } = tracker()
    await runAll([mk('c1', 'cargo'), mk('c2', 'cargo'), mk('c3', 'cargo'), mk('f1'), mk('f2')], ctxFor({ MEERKAT_JOBS: '4' }), { log: () => {}, keepGoing: true, parallel: 4 })
    expect(s.cargoPeak).toBe(1)
    expect(s.peak).toBeGreaterThan(1) // free checks still overlapped the cargo one
  })
})

describe('gate cache parity', () => {
  const BIN = resolve(__dirname, '../bin/meerkat.mjs')
  let demo = ''
  let logs = ''
  const git = (...a: string[]) => spawnSync('git', ['-C', demo, '-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' })
  const gate = () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), MEERKAT_LOG_DIR: logs }
    delete env.MEERKAT_JOBS
    const r = spawnSync('node', [BIN, 'gate', '--base', 'main'], { cwd: demo, encoding: 'utf8', env, timeout: 240000 })
    const line = (r.stdout.split('\n').find((l) => l.startsWith('MEERKAT gate:')) ?? 'NO SUMMARY: ' + r.stdout.slice(0, 600))
    return { out: r.stdout, code: r.status, blocking: Number(/MEERKAT gate: (\d+) blocking/.exec(line)?.[1] ?? NaN), line: line.replace(/, \d+(\.\d+)?m?s( \(status \d+[^)]*\))?$/, '') }
  }
  const cachedN = (t: string) => Number(/cache: (\d+) check/.exec(t)?.[1] ?? 0)

  beforeAll(() => {
    demo = mkdtempSync(join(tmpdir(), 'gpc-demo-'))
    logs = mkdtempSync(join(tmpdir(), 'gpc-logs-'))
    git('init', '-q', '-b', 'main')
    writeFileSync(join(demo, 'package.json'), '{"name":"demo","version":"1.0.0","type":"module"}\n')
    writeFileSync(join(demo, 'm.js'), 'export const f = (a, b) => a + b\n')
    git('add', '-A'); git('commit', '-qm', 'init'); git('checkout', '-qb', 'feat')
    writeFileSync(join(demo, 'a.js'), 'export const g = (x) => x * 2\n')
    git('add', '-A'); git('commit', '-qm', 'feat')
  }, 60000)
  afterAll(() => {
    rmSync(demo, { recursive: true, force: true })
    rmSync(logs, { recursive: true, force: true })
  })

  const parity = (label: string) => {
    const fresh = gate()
    const hit = gate()
    expect(cachedN(hit.out), `${label}: second run should reuse the cache`).toBeGreaterThan(0)
    expect(hit.code).toBe(fresh.code)
    expect(hit.blocking).toBe(fresh.blocking)
    expect(hit.line).toBe(fresh.line)
    return { fresh, hit }
  }

  test('passing fixture: a cache hit has the same exit code and blocking count as the fresh run', () => {
    parity('pass')
  }, 300000)

  test('failing fixture: a cache hit has the same exit code and blocking count as the fresh run', () => {
    // A merge-conflict marker and a private key block: whichever check catches it, the verdict must repeat from the cache.
    writeFileSync(join(demo, 'bad.js'), 'export const x = 1\n<<<<<<< HEAD\nexport const y = 2\n=======\nexport const y = 3\n>>>>>>> other\n')
    git('add', '-A'); git('commit', '-qm', 'bad')
    const { fresh } = parity('fail')
    expect(fresh.blocking).toBeGreaterThan(0)
    expect(fresh.code).not.toBe(0)
  }, 300000)
})

describe('gate cache entry rules', () => {
  const key = gateKey({ digest: 'd', tier: 'fast', version: 'v', checkId: 'c' })
  const fail = { id: 'c', kind: 'fail', detail: 'x', findings: [], files: ['a.js'], places: [{ file: 'a.js', line: 1, message: 'm' }] }
  test('a stored fail returns its places, so the blocking count is rebuilt the same', () => {
    const { cache } = updatedGateCache({ entries: {} }, [{ key, row: fail }])
    expect(gateCacheHit(cache, 'c', key)?.row.places).toEqual(fail.places)
  })
  test('an entry older than 6 hours is not served', () => {
    const { cache } = updatedGateCache({ entries: {} }, [{ key, row: fail }], new Date(Date.now() - 7 * 3600 * 1000))
    expect(gateCacheHit(cache, 'c', key)).toBeNull()
  })
  test('the file stays under 512 KB by dropping the oldest entries', () => {
    const big = Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, row: { id: `c${i}`, kind: 'fail', detail: 'd'.repeat(2000), findings: Array.from({ length: 200 }, () => ({ m: 'x'.repeat(40) })), files: [], places: [] } }))
    const { text, cache } = updatedGateCache({ entries: {} }, big)
    expect(text.length).toBeLessThanOrEqual(512 * 1024)
    expect(Object.keys(cache.entries).length).toBeGreaterThan(0)
  })
})
