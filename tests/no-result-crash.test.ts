// A test-runner check whose process exits 0 without printing anything never reported a result: it is a crash row with a reason, not a pass.
// Checks that legitimately print nothing on success (formatters, linters, type checkers) do not set needsResult and stay passes.
import { existsSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { runOne } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { classify } from '../lib/gate.mjs'
// @ts-expect-error plain JS module
import rustChecks from '../packs/rust/rust.mjs'

const base = { id: 'fake-tests', group: 'functionality', tier: 'fast', lane: 'free', title: 'fake', estSeconds: 1, run: { cmd: 'fake-runner', args: [] } }
const needs = { ...base, needsResult: true }
const ctxWith = (r: Record<string, unknown>) => ({
  timeoutScale: 1, repoRoot: process.cwd(), appDir: process.cwd(), env: process.env, platform: process.platform, exists: existsSync,
  changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null,
  runCommand: async () => ({ code: 0, output: '', killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0, ...r }),
})

describe('exit 0 without a result', () => {
  test('exit 0 and no output is a crash row with a reason', async () => {
    const res = await runOne(needs, ctxWith({ code: 0, output: '' }))
    expect(res.status).toBe('FAIL')
    expect(res.detail).toMatch(/exited 0 without a result/)
    expect(classify(res, '')).toBe('crash')
  })
  test('whitespace-only output counts as no output', async () => {
    const res = await runOne(needs, ctxWith({ code: 0, output: '  \n\n' }))
    expect(classify(res, '')).toBe('crash')
  })
  test('exit 0 with a PASS line still passes', async () => {
    const res = await runOne(needs, ctxWith({ code: 0, output: 'PASS all 12 tests' }))
    expect(res.status).toBe('PASS')
  })
  test('exit 1 with no output stays a plain fail', async () => {
    const res = await runOne(needs, ctxWith({ code: 1, output: '' }))
    expect(res.status).toBe('FAIL')
    expect(res.detail).not.toMatch(/without a result/)
    expect(classify(res, '')).toBe('fail')
  })
  test('a check that may print nothing on success (no needsResult) stays a pass', async () => {
    const res = await runOne(base, ctxWith({ code: 0, output: '' }))
    expect(res.status).toBe('PASS')
  })
  test('the cargo test checks ask for a result', () => {
    const tests = (rustChecks as Array<{ id: string; needsResult?: boolean }>).filter((c) => /test/.test(c.id) && !/mutation/.test(c.id))
    expect(tests.length).toBeGreaterThan(0)
    for (const c of tests) expect(c.needsResult).toBe(true)
  })
})
