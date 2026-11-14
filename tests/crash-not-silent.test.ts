// A check whose process dies (killed by a signal, a segfault exit code) is a crash row, never a plain pass, a plain fail or nothing.
import { existsSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { runOne } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { classify } from '../lib/gate.mjs'

const check = { id: 'fake-tests', group: 'functionality', tier: 'fast', lane: 'free', title: 'fake', estSeconds: 1, run: { cmd: 'fake-runner', args: [] } }
const ctxWith = (r: Record<string, unknown>) => ({
  timeoutScale: 1, repoRoot: process.cwd(), appDir: process.cwd(), env: process.env, platform: process.platform, exists: existsSync,
  changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null,
  runCommand: async () => ({ code: 1, output: '', killed: null, ms: 5, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0, ...r }),
})

describe('a dead check process is a crash, not silence', () => {
  test('killed by a signal (the exit code is mapped to 1) is a crash with a reason', async () => {
    const res = await runOne(check, ctxWith({ code: 1, signal: 'SIGSEGV', output: '' }))
    expect(res.status).not.toBe('PASS')
    expect(res.detail).toMatch(/SIGSEGV/)
    expect(classify(res, '')).toBe('crash')
  })
  test('exit 139 (a segfault) with no output is a crash with a reason', async () => {
    const res = await runOne(check, ctxWith({ code: 139, output: '' }))
    expect(res.status).toBe('FAIL')
    expect(res.detail.length).toBeGreaterThan(0)
    expect(classify(res, '')).toBe('crash')
  })
  test('a plain exit 1 with no crash signal stays a plain fail', async () => {
    const res = await runOne(check, ctxWith({ code: 1, output: 'FAIL something' }))
    expect(classify(res, 'FAIL something')).toBe('fail')
  })
})
