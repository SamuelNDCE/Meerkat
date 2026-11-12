// Rust budget (issues 14b, 14g, 18d): a compile error stops the other rust checks and is a TOOL PROBLEM, a rust check runs only the
// crates the change touches plus their direct dependents, and the progress line names the crate cargo is building.
// No cargo runs here: a fake runner stands in for it (ctx.runCommand).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, runAll } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { classify, gateOutcome } from '../lib/gate.mjs'
// @ts-expect-error plain JS module
import RUST, { scopeRustTest } from '../packs/rust/rust.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })

function crate(root: string, name: string, deps: Record<string, string> = {}) {
  mkdirSync(join(root, name, 'src'), { recursive: true })
  const dep = Object.entries(deps).map(([n, p]) => `${n} = { path = "${p}" }`).join('\n')
  writeFileSync(join(root, name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[dependencies]\n${dep}\n`)
  writeFileSync(join(root, name, 'src', 'lib.rs'), '')
}
// core <- app (depends on core) ; solo is independent ; far depends on app (a dependent of a dependent)
function ws() {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-rbudget-')); made.push(root)
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = ["core", "app", "solo", "far"]\n')
  crate(root, 'core')
  crate(root, 'app', { core: '../core' })
  crate(root, 'solo')
  crate(root, 'far', { app: '../app' })
  return root
}
const checkOf = (id: string) => ({ ...RUST.find((c: any) => c.id === id), needs: [] })
const ctxFor = (root: string, extra: Record<string, unknown> = {}) => ({
  timeoutScale: 1, repoRoot: root, appDir: root, tier: 'fast', env: { ...process.env, MEERKAT_HOME: root, MEERKAT_LOG_DIR: join(root, 'logs') },
  platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl(), ...extra,
})
const fakeResult = (code: number, output: string) => ({ code, output, killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0 })

describe('compile fail-fast (14g, 14b)', () => {
  test('a test target that does not compile stops the other rust checks and is a TOOL PROBLEM naming the crate and the first error', async () => {
    const root = ws()
    const calls: string[] = []
    const compileOutput = [
      '   Compiling nv-agents v0.1.0 (C:/x/nv-agents)',
      'error[E0432]: unresolved import `crate::phone_cmds`',
      ' --> src/lib.rs:1:5',
      'error: could not compile `nv-agents` (test "board_hostile_markdown") due to 1 previous error',
    ].join('\n')
    const runCommand = async (o: any) => {
      calls.push(`${o.cmd} ${o.args.join(' ')}`)
      o.onOutput?.(`${compileOutput}\n`)
      return fakeResult(101, compileOutput)
    }
    const results = await runAll([checkOf('rust-test'), checkOf('rust-clippy')], ctxFor(root, { runCommand }), { log: () => {}, keepGoing: true, parallel: 1 })
    expect(calls).toHaveLength(1) // the second rust check was never run
    const [t, c] = results
    expect(t.status).toBe('FAIL')
    expect(t.detail).toContain('nv-agents')
    expect(t.detail).toContain('unresolved import')
    expect(c.status).toBe('NOT RUN')
    expect(c.detail).toMatch(/compile error/)
    const rows = results.map((r: any) => ({ id: r.id, detail: r.detail, kind: classify(r, '') }))
    expect(rows[0].kind).toBe('crash')
    const oc = gateOutcome({ exitCode: 1, rows })
    expect(oc.code).toBe(1)
    expect(oc.status).toBe(503)
    expect(oc.word).toBe('TOOL PROBLEM')
    expect(oc.reason).toContain('nv-agents')
    expect(oc.reason).toContain('unresolved import')
  })
  test('output with no compile error leaves the second rust check running', async () => {
    const root = ws()
    const calls: string[] = []
    const runCommand = async (o: any) => { calls.push(o.args[0]); return fakeResult(0, 'ok') }
    const results = await runAll([checkOf('rust-test'), checkOf('rust-clippy')], ctxFor(root, { runCommand }), { log: () => {}, keepGoing: true, parallel: 1 })
    expect(calls).toHaveLength(2)
    expect(results.map((r: any) => r.status)).toEqual(['PASS', 'PASS'])
  })
})

describe('per-crate scope (14b)', () => {
  test('a change in core runs core and its direct dependent app, not solo and not the dependent of a dependent', () => {
    const r = scopeRustTest({ repoRoot: ws(), changedFiles: ['core/src/lib.rs'] })
    expect(r.args).toEqual(['test', '-p', 'app', '-p', 'core'])
    expect(r.note).toContain('core')
    expect(r.note).toContain('app')
    expect(r.note).not.toContain('solo')
  })
  test('a change in an independent crate runs only it', () => {
    expect(scopeRustTest({ repoRoot: ws(), changedFiles: ['solo/src/lib.rs'] }).args).toEqual(['test', '-p', 'solo'])
  })
  test('rust-clippy follows the same scope and keeps its own flags', () => {
    const c = checkOf('rust-clippy')
    const r = c.scopeArgs({ repoRoot: ws(), changedFiles: ['solo/src/lib.rs'] })
    expect(r.args).toEqual(['clippy', '-p', 'solo', '--all-targets', '--', '-D', 'warnings'])
  })
  test('a change outside any crate runs the whole workspace and says so', () => {
    const r = checkOf('rust-test').scopeArgs({ repoRoot: ws(), changedFiles: ['docs/readme.rs.txt', 'tools/script.py'] })
    expect(r.args).toBeUndefined()
    expect(r.note).toMatch(/whole workspace/)
  })
  test('the run uses the scoped arguments and names the crates in the result', async () => {
    const root = ws()
    let seen: string[] = []
    const runCommand = async (o: any) => { seen = o.args; return fakeResult(0, 'ok') }
    const [t] = await runAll([checkOf('rust-test')], ctxFor(root, { runCommand, changedFiles: ['core/src/lib.rs'] }), { log: () => {}, keepGoing: true, parallel: 1 })
    expect(seen.join(' ')).toContain('-p app -p core')
    expect(seen.join(' ')).not.toContain('--workspace')
    expect(t.detail).toContain('app, core')
  })
})

describe('per-crate progress (18d)', () => {
  test('three Compiling lines produce progress that names each crate', async () => {
    const root = ws()
    const seen: any[] = []
    const out = '   Compiling alpha v0.1.0 (C:/x/alpha)\n   Compiling beta v0.2.0\n   Compiling gamma v0.3.0 (C:/x/gamma)\n'
    const runCommand = async (o: any) => { o.onOutput?.(out); return fakeResult(0, out) }
    await runAll([checkOf('rust-test')], ctxFor(root, { runCommand }), { log: () => {}, keepGoing: true, parallel: 1, hooks: { progress: (_c: any, p: any) => seen.push(p) } })
    expect(seen.map((p) => p.crate)).toEqual(['alpha', 'beta', 'gamma'])
  })
})
