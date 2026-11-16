// A rust check that runs past its time limit is a FAIL (it blocks), not NOT RUN, and the summary line says how many checks did not run.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { countsLine, gateCounts, runGate } from '../lib/gate.mjs'
// @ts-expect-error plain JS module
import RUST from '../packs/rust/rust.mjs'

let root = ''
let logs = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rust-timeout-proj-'))
  logs = mkdtempSync(join(tmpdir(), 'rust-timeout-logs-'))
  writeFileSync(join(root, 'a.js'), 'export const a = 1\n')
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  rmSync(logs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// A fake check: a process that sleeps far past a one second limit. It is not a cargo run; `timeoutIsFail` is the flag the rust checks carry.
const sleeper = (extra: Record<string, unknown> = {}) => ({
  id: 'fake-slow', group: 'functionality', tier: 'fast', lane: 'free', title: 'fake slow check', estSeconds: 1, timeoutSeconds: 1, paths: ['**/*.js'],
  run: { cmd: process.execPath, args: ['-e', 'setTimeout(function () {}, 60000)'], cwd: 'repo' }, ...extra,
})
const gate = (checks: unknown[]) => runGate({ checks, files: ['a.js'], repoRoot: root, log: () => {}, env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs } })

describe('a rust check that times out', () => {
  test('the rust checks that build or test carry the flag', () => {
    for (const id of ['rust-test', 'rust-clippy', 'rust-build-release']) expect(RUST.find((c: any) => c.id === id).timeoutIsFail).toBe(true)
  })
  test('a limit timeout of a flagged check is FAIL and blocks the gate', async () => {
    const out = await gate([sleeper({ timeoutIsFail: true })])
    const row = out.rows[0]
    expect(row.kind).toBe('fail')
    expect(row.detail).toMatch(/^timed out after/)
    expect(gateCounts(out.rows).blocking).toBe(1)
    expect(out.exitCode).toBe(1)
  }, 30000)
  test('an unflagged check keeps the old reading: NOT RUN', async () => {
    const out = await gate([sleeper()])
    expect(['hang', 'notrun']).toContain(out.rows[0].kind)
    expect(out.exitCode).toBe(75)
  }, 30000)
})

describe('the summary line', () => {
  test('shows not run next to failed', () => {
    const rows = [{ id: 'a', kind: 'fail', places: [{ file: 'x', line: 1 }] }, { id: 'b', kind: 'notrun' }, { id: 'c', kind: 'pass' }]
    const line = countsLine(rows)
    expect(line).toMatch(/1 failed/)
    expect(line).toMatch(/1 not run/)
  })
})
