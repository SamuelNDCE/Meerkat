// Gate pool order: longest recorded time first, never-run checks first of all; checks no changed file can trigger are NOT APPLICABLE and never start;
// the job count (MEERKAT_JOBS) changes timing only.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS modules
import { runGate } from '../lib/gate.mjs'
// @ts-expect-error plain JS modules
import { gateTimesFile, orderLongestFirst, readGateTimes, updatedGateTimes } from '../lib/gateorder.mjs'
// @ts-expect-error plain JS modules
import { jobsFromEnv } from '../lib/runner.mjs'
// @ts-expect-error plain JS modules
import { settingsDigest } from '../lib/gatecache.mjs'

let root = ''
let logs = ''
let started: string[] = []
const base = { group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1 }
const mk = (id: string, paths: string[], extra: Record<string, unknown> = {}) => ({ ...base, id, title: id, paths, run: () => (started.push(id), { ok: true, detail: `${id} ok` }), ...extra })
const env = (extra: Record<string, string> = {}) => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs, ...extra }) as Record<string, string>
const quiet = (extra: Record<string, string> = {}) => ({ log: () => {}, env: env(extra) })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gate-order-proj-'))
  logs = mkdtempSync(join(tmpdir(), 'gate-order-logs-'))
  writeFileSync(join(root, 'a.js'), 'export const a = 1\n')
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  rmSync(logs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('order', () => {
  test('a never-run check goes first, then the longest recorded time, ties keep the written order', () => {
    const cs = [mk('slow', ['**']), mk('fast', ['**']), mk('never', ['**']), mk('mid', ['**']), mk('tie', ['**'])]
    const order = orderLongestFirst(cs, { slow: 5000, fast: 10, mid: 800, tie: 800 }).map((c: { id: string }) => c.id)
    expect(order).toEqual(['never', 'slow', 'mid', 'tie', 'fast'])
  })
  test('a check others wait on ranks by the chain behind it', () => {
    const cs = [mk('solo', ['**']), mk('build', ['**']), mk('tests', ['**'], { after: ['build'] })]
    const order = orderLongestFirst(cs, { solo: 1000, build: 100, tests: 2000 }).map((c: { id: string }) => c.id)
    expect(order.indexOf('build')).toBeLessThan(order.indexOf('solo'))
  })
  test('the history keeps only checks that ran to their end', () => {
    const old = { a: 5 }
    const next = JSON.parse(updatedGateTimes(old, [{ id: 'b', status: 'PASS', ms: 42.4 }, { id: 'c', status: 'NOT RUN', ms: 900 }, { id: 'd', status: 'FAIL', ms: 7 }]))
    expect(next.ms).toEqual({ a: 5, b: 42, d: 7 })
  })
  test('the gate starts a never-run check first, then the longest, with one job', async () => {
    const e = env({ MEERKAT_JOBS: '1' })
    // Seed the history the gate reads for this project, then run it.
    const file = gateTimesFile(e, root)
    const { mkdirSync, writeFileSync: w } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(file), { recursive: true })
    w(file, JSON.stringify({ schemaVersion: 1, ms: { quick: 5, long: 9000, medium: 400 } }))
    started = []
    await runGate({ checks: [mk('quick', ['**/*.js']), mk('medium', ['**/*.js']), mk('long', ['**/*.js']), mk('fresh', ['**/*.js'])], files: ['a.js'], repoRoot: root, log: () => {}, env: e })
    expect(started).toEqual(['fresh', 'long', 'medium', 'quick'])
    expect(readGateTimes(file).fresh).toBeGreaterThan(0)
  })
})

describe('not applicable', () => {
  test('a check whose file types match no changed file is recorded NOT APPLICABLE with the reason and never runs', async () => {
    started = []
    const out = await runGate({ checks: [mk('js-check', ['**/*.js']), mk('rust-check', ['**/*.rs'])], files: ['a.js'], repoRoot: root, ...quiet() })
    expect(started).toEqual(['js-check'])
    expect(out.skipped).toContain('rust-check')
    const na = out.notApplicable.find((x: { id: string }) => x.id === 'rust-check')
    expect(na.reason).toMatch(/^not applicable: none of the 1 changed file\(s\) match its file types \(\*\*\/\*\.rs\)/)
    // Not a pass: it has no row at all, and it is not in the list of checks that ran.
    expect(out.rows.map((r: { id: string }) => r.id)).toEqual(['js-check'])
    expect(out.ran).toEqual(['js-check'])
  })
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
  test('the output is identical with MEERKAT_JOBS=1 and the default', async () => {
    const checks = () => [mk('c1', ['**/*.js']), mk('c2', ['**']), mk('c3', ['**/*.js']), mk('c4', ['**/*.md']), { ...mk('c5', ['**']), run: () => ({ ok: false, detail: 'a.js:1 broken' }) }]
    const shape = (o: { rows: { id: string; kind: string; detail: string }[]; exitCode: number; skipped: string[]; ran: string[] }) => ({ exitCode: o.exitCode, ran: [...o.ran].sort(), skipped: [...o.skipped].sort(), rows: o.rows.map((r) => `${r.id}|${r.kind}|${r.detail}`) })
    const one = await runGate({ checks: checks(), files: ['a.js'], repoRoot: root, ...quiet({ MEERKAT_JOBS: '1' }) })
    const def = await runGate({ checks: checks(), files: ['a.js'], repoRoot: root, ...quiet() })
    expect(shape(one)).toEqual(shape(def))
  })
})
