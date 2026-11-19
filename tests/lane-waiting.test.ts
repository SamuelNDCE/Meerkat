// A cargo-lane step that waited for the machine-wide lock reports the wait (seconds) on its row and is not a failure for waiting.
// Uses a fake runCommand standing in for the lane wrapper plus a fake cargo: no real cargo runs.
import { existsSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { runOne, waitedSecondsOf, waitingNote } from '../lib/runner.mjs'

const check = { id: 'rust-check', group: 'functionality', tier: 'fast', lane: 'cargo', title: 'fake cargo', estSeconds: 1, run: { cmd: 'cargo', args: ['check'], cwd: 'repo' } }
const ctxWith = (r: Record<string, unknown>) => ({
  timeoutScale: 1, repoRoot: process.cwd(), appDir: process.cwd(), env: { ...process.env, MEERKAT_CARGO_LOCK: '' }, platform: process.platform, exists: existsSync,
  changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null,
  runCommand: async () => ({ code: 0, output: '', killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0, ...r }),
})
const waitLines = (n: number) => `wait started: the lock at /x: held by process 9 (cargo build), you have waited 0 s\nwait ended: got the lock after ${n} s\n`

describe('lane wait is reported, not a failure', () => {
  test('a command that passed after a long wait is PASS and the row carries the seconds waited', async () => {
    const res = await runOne(check, ctxWith({ code: 0, output: `${waitLines(42)}Finished dev profile\n` }))
    expect(res.status).toBe('PASS')
    expect(res.waitedSeconds).toBe(42)
  })
  test('a command that failed after the wait is still FAIL and still carries the wait', async () => {
    const res = await runOne(check, ctxWith({ code: 101, output: `${waitLines(30)}test a::b ... FAILED\n` }))
    expect(res.status).toBe('FAIL')
    expect(res.waitedSeconds).toBe(30)
  })
  test('no wait line means no waitedSeconds on the row', async () => {
    const res = await runOne(check, ctxWith({ code: 0, output: 'Finished\n' }))
    expect(res.status).toBe('PASS')
    expect(res.waitedSeconds).toBeUndefined()
  })
  test('a wrapper that prints "waited N s" is read too', () => {
    expect(waitedSecondsOf('lock script: waited 17 s\nbuilding')).toBe(17)
    expect(waitedSecondsOf('nothing here')).toBe(0)
  })
  test('the done line says WAITING Ns then the status above a small threshold, and nothing below it', () => {
    expect(waitingNote({ status: 'PASS', waitedSeconds: 42 })).toBe('WAITING 42s then PASS')
    expect(waitingNote({ status: 'FAIL', waitedSeconds: 30 })).toBe('WAITING 30s then FAIL')
    expect(waitingNote({ status: 'PASS', waitedSeconds: 1 })).toBe('')
    expect(waitingNote({ status: 'PASS' })).toBe('')
  })
})
