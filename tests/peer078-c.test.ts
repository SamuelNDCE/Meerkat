// 0.7.8: a stopped test run still prints a summary line with counts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { partialResults, runTestRun } from '../lib/testrun.mjs'

const dir = mkdtempSync(join(tmpdir(), 'meerkat-peer078c-'))
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands: { test: 'node vitest-fake.mjs' } }))
writeFileSync(join(dir, 'a.test.ts'), '')
writeFileSync(join(dir, 'vitest-fake.mjs'), "console.log(' ✓ one.test.ts (5 tests)')\nconsole.log(' ❯ two.test.ts (4 tests | 1 failed | 1 skipped)')\nsetInterval(() => {}, 1000)\n")

describe('partial test summary', () => {
  test('a run cut by the time limit prints a STOPPED line with passed, failed and skipped counts', async () => {
    const lines: string[] = []
    const code = await runTestRun(['a.test.ts', '--timeout', '2', '--folder', dir], { env: { ...process.env, MEERKAT_LOG_DIR: join(dir, 'logs') } as NodeJS.ProcessEnv, cwd: dir, out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
    expect(code).toBe(124)
    expect(lines.some((l) => /^TIMEOUT:/.test(l))).toBe(true)
    expect(lines.find((l) => l.startsWith('STOPPED:'))).toMatch(/^STOPPED: 7 passed, 1 failed, 1 skipped before it was cut by the time limit of 2s/)
  }, 60_000)
  test('counts per-test lines for cargo and file lines for jest when no totals were printed', () => {
    expect(partialResults('cargo', 'test a ... ok\ntest b ... FAILED\ntest c ... ignored\n')).toMatchObject({ pass: 1, fail: 1, skipped: 1 })
    expect(partialResults('jest', 'PASS a.test.js\nFAIL b.test.js\n')).toMatchObject({ pass: 1, fail: 1, from: 'files' })
    expect(partialResults('vitest', ' Tests  3 failed | 4 passed (7)\n')).toMatchObject({ pass: 4, fail: 3, from: 'totals' })
  })
})
