// Stuck detection, kill escalation and the run deadline, through the real runner with tiny node fixtures.
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createControl, runAll } from './runner.mjs'
import { idleKillText } from './timeouts.mjs'

const dir = mkdtempSync(join(tmpdir(), 'meerkat-control-'))
const script = (name: string, body: string) => {
  const file = join(dir, name)
  writeFileSync(file, body)
  return file
}
const ctxFor = () => ({ timeoutScale: 1, repoRoot: dir, appDir: dir, tier: 'fast', env: process.env, platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl() })
const check = (id: string, file: string, extra: Record<string, unknown> = {}) => ({ id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 5, run: { cmd: 'node', args: [file] }, ...extra })

describe('stuck detection and run control', () => {
  test('a script that prints nothing is stopped after its idle limit, with the exact message', async () => {
    const hang = script('hang.mjs', 'setInterval(() => {}, 1000)\n')
    const results = await runAll([check('hang', hang, { idleKillSeconds: 2 })], ctxFor(), { log: () => {} })
    expect(results[0].status).toBe('FAIL')
    expect(results[0].detail?.startsWith(idleKillText(2))).toBe(true)
    expect(results[0].ms).toBeLessThan(15_000)
  }, 30_000)

  test('a child that ignores SIGTERM is force-killed, so the run still completes', async () => {
    const stubborn = script('stubborn.mjs', "process.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n")
    const started = Date.now()
    const results = await runAll([check('stubborn', stubborn, { idleKillSeconds: 1 })], ctxFor(), { log: () => {} })
    expect(results[0].status).toBe('FAIL')
    expect(results[0].detail).toContain('probably stuck')
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 30_000)

  test('the run deadline stops the checks still running and marks them NOT RUN', async () => {
    const hang = script('forever.mjs', 'setInterval(() => {}, 1000)\n')
    const started = Date.now()
    const results = await runAll([check('forever', hang, { estSeconds: 600 })], ctxFor(), { log: () => {}, deadlineMs: 1000 })
    expect(results[0].status).toBe('NOT RUN')
    expect(results[0].detail).toMatch(/^run deadline reached after /)
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 30_000)
})
