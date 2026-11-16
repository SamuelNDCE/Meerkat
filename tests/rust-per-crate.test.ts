// Rust per-crate tests: rust-test runs only the touched crates and their dependents (cargo -p), fails closed to the whole workspace when a
// changed file cannot be placed in a crate, and the full workspace test is a separate opt-in check that is not part of the per-change gate.
// No cargo runs here: a fake runner stands in for it (ctx.runCommand).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, runAll, selectChecks } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import RUST from '../packs/rust/rust.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })

function crate(root: string, name: string, deps: Record<string, string> = {}) {
  mkdirSync(join(root, name, 'src'), { recursive: true })
  const dep = Object.entries(deps).map(([n, p]) => `${n} = { path = "${p}" }`).join('\n')
  writeFileSync(join(root, name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[dependencies]\n${dep}\n`)
  writeFileSync(join(root, name, 'src', 'lib.rs'), '')
}
// three crates: base <- mid (depends on base), lone is independent
function ws() {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-rpc-')); made.push(root)
  writeFileSync(join(root, 'Cargo.toml'), '[workspace]\nmembers = ["base", "mid", "lone"]\n')
  crate(root, 'base')
  crate(root, 'mid', { base: '../base' })
  crate(root, 'lone')
  return root
}
const checkOf = (id: string) => ({ ...RUST.find((c: any) => c.id === id), needs: [] })
const ctxFor = (root: string, extra: Record<string, unknown> = {}) => ({
  timeoutScale: 1, repoRoot: root, appDir: root, tier: 'fast', env: { ...process.env, MEERKAT_HOME: root, MEERKAT_LOG_DIR: join(root, 'logs') },
  platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl(), ...extra,
})
const ok = { code: 0, output: 'ok', killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0 }
async function cargoArgsFor(root: string, changedFiles: string[], id = 'rust-test') {
  const calls: string[][] = []
  const runCommand = async (o: any) => { calls.push(o.args.slice(o.args.indexOf('cargo') + 1)); return ok }
  await runAll([checkOf(id)], ctxFor(root, { runCommand, changedFiles }), { log: () => {}, keepGoing: true, parallel: 1 })
  return calls
}

describe('rust-test runs per touched crate', () => {
  test('a change in one crate calls cargo with -p for that crate and its dependents, not --workspace', async () => {
    const calls = await cargoArgsFor(ws(), ['base/src/lib.rs'])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['test', '-p', 'base', '-p', 'mid'])
    expect(calls[0]).not.toContain('--workspace')
  })
  test('a change in a leaf crate runs only that crate', async () => {
    const calls = await cargoArgsFor(ws(), ['lone/src/lib.rs'])
    expect(calls[0]).toEqual(['test', '-p', 'lone'])
  })
  test('a changed Rust file that is in no crate fails closed to the whole workspace', async () => {
    const calls = await cargoArgsFor(ws(), ['stray/orphan.rs'])
    expect(calls[0]).toEqual(['test', '--workspace'])
  })
})

describe('the full workspace test is a separate check', () => {
  test('rust-test-workspace exists, runs the whole workspace and is never narrowed', async () => {
    const c = RUST.find((x: any) => x.id === 'rust-test-workspace')
    expect(c).toBeTruthy()
    expect(c.run.args).toEqual(['test', '--workspace'])
    expect(c.scopeArgs).toBeUndefined()
    const calls = await cargoArgsFor(ws(), ['base/src/lib.rs'], 'rust-test-workspace')
    expect(calls[0]).toEqual(['test', '--workspace'])
  })
  test('it is left out of the per-change gate by default and runs when asked', () => {
    const base = { tier: 'thorough', mode: 'all', changedFiles: ['base/src/lib.rs'] }
    const idsOf = (include: string[]) => selectChecks(RUST.map((c: any) => ({ ...c, needs: [] })), { ...base, include }).run.map((c: any) => c.id)
    expect(idsOf([])).not.toContain('rust-test-workspace')
    expect(idsOf([])).toContain('rust-test')
    expect(idsOf(['workspace-test'])).toContain('rust-test-workspace')
  })
})
