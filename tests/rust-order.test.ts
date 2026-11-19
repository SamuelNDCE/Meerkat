// The Rust checks run in this order on the cargo lane: compile check, then clippy, then tests. A compile error shows up first.
// A fake runner stands in for cargo (ctx.runCommand), so no cargo runs here.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, orderForSpeed, runAll } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { orderLongestFirst } from '../lib/gateorder.mjs'
// @ts-expect-error plain JS module
import RUST from '../packs/rust/rust.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const checkOf = (id: string) => ({ ...RUST.find((c: any) => c.id === id), needs: [] })
const IDS = ['rust-test', 'rust-clippy', 'rust-check']
const ctxFor = (root: string, extra: Record<string, unknown> = {}) => ({
  timeoutScale: 1, repoRoot: root, appDir: root, tier: 'fast', env: { ...process.env, MEERKAT_HOME: root, MEERKAT_LOG_DIR: join(root, 'logs') },
  platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl(), ...extra,
})
const fakeResult = (code: number, output: string) => ({ code, output, killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0 })
const verb = (args: string[]) => args.find((a) => ['check', 'clippy', 'test'].includes(a)) ?? args.join(' ')
const dir = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `meerkat-rorder-${tag}-`)); made.push(d); writeFileSync(join(d, 'Cargo.toml'), '[workspace]\nmembers = []\n'); return d }

describe('rust check order', () => {
  test('the pack has a compile check that runs cargo check', () => {
    const c = RUST.find((x: any) => x.id === 'rust-check')
    expect(c.run.args[0]).toBe('check')
  })
  test('the speed order puts the compile check, then clippy, then tests', () => {
    expect(orderForSpeed(IDS.map(checkOf)).map((c: any) => c.id)).toEqual(['rust-check', 'rust-clippy', 'rust-test'])
  })
  test('the gate order does the same, whatever times were recorded', () => {
    const ms = { 'rust-test': 900000, 'rust-clippy': 1000, 'rust-check': 10 }
    expect(orderLongestFirst(IDS.map(checkOf), ms).map((c: any) => c.id)).toEqual(['rust-check', 'rust-clippy', 'rust-test'])
  })
  test('the runner starts them as check, clippy, test on the one cargo lane', async () => {
    const calls: string[] = []
    const runCommand = async (o: any) => { calls.push(verb(o.args)); return fakeResult(0, '') }
    await runAll(orderForSpeed(IDS.map(checkOf)), ctxFor(dir('a'), { runCommand }), { log: () => {}, keepGoing: true, parallel: 4 })
    expect(calls).toEqual(['check', 'clippy', 'test'])
  })
  test('clippy findings do not stop the tests (the order is soft, not a pass requirement)', async () => {
    const calls: string[] = []
    const runCommand = async (o: any) => { calls.push(verb(o.args)); return fakeResult(verb(o.args) === 'clippy' ? 1 : 0, '') }
    await runAll(orderForSpeed(IDS.map(checkOf)), ctxFor(dir('b'), { runCommand }), { log: () => {}, keepGoing: true, parallel: 4 })
    expect(calls).toEqual(['check', 'clippy', 'test'])
  })
  test('a compile error in the compile check stops clippy and the tests at once', async () => {
    const calls: string[] = []
    const out = 'error[E0308]: mismatched types\nerror: could not compile `nv-llm` (lib) due to 6 previous errors'
    const runCommand = async (o: any) => { calls.push(verb(o.args)); return fakeResult(101, out) }
    const results = await runAll(orderForSpeed(IDS.map(checkOf)), ctxFor(dir('c'), { runCommand }), { log: () => {}, keepGoing: true, parallel: 4 })
    expect(calls).toEqual(['check'])
    expect(results.find((r: any) => r.id === 'rust-check').status).toBe('FAIL')
  })
})
