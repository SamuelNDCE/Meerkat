// 28a: a gate on a large repo ran 30 minutes with no result and no progress. The run limit must bound the whole run (including the base comparison),
// and a check that runs past a heartbeat must be named with its elapsed seconds.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { keepNewOnly, loadProjectChecks, runGate } from '../lib/gate.mjs'
const root = mkdtempSync(join(tmpdir(), 'meerkat-bounded-'))
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  } catch {
    /* a stopped check can hold its folder for a moment on Windows; the temp folder is left to the OS */
  }
})
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1' } as Record<string, string>
let repo = ''
let mb = ''
const SLEEP_MS = 12_000
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const slow = { id: 'slow', title: 'slow', cmd: 'node', args: ['sleep.js', String(SLEEP_MS)], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 }
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [slow] }))
  writeFileSync(join(repo, 'sleep.js'), 'setTimeout(function () {}, Number(process.argv[2]))\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'a.js'), 'export const a = 1\nexport const b = 2\nexport const c = 3\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  mb = String(git('rev-parse', 'HEAD').stdout).trim()
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'a.js'), 'export const a = 10\nexport const b = 2\nexport const c = 3\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
}, 60_000)

describe('bounded run and progress (28a)', () => {
  test('(a) the base comparison obeys the run deadline and says so', async () => {
    // A finding on an untouched line of a file the base has: the base side must run the (slow) check again.
    const out: any = { exitCode: 1, files: ['a.js'], rows: [{ id: 'slow', kind: 'fail', detail: '', ms: 1, findings: [], places: [{ file: 'a.js', line: 3, message: 'x' }], files: ['a.js'] }] }
    const lines: string[] = []
    const t0 = Date.now()
    await keepNewOnly(out, { o: { base: 'main' }, changed: { mb, ref: 'main' }, repoRoot: repo, appDir: repo, env, tier: 'fast', err: (l: string) => lines.push(l), progress: (l: string) => lines.push(l), deadlineAt: Date.now() + 2000, heartbeatMs: 500 })
    const took = Date.now() - t0
    expect(took, `took ${took}ms, lines: ${lines.join(' | ')}`).toBeLessThan(8000)
    expect(out.baseState).toBe('unfinished')
    expect(lines.join('\n')).toMatch(/time limit was reached/)
  }, 30_000)

  test('(b) a check running past a heartbeat is named with its elapsed seconds', async () => {
    const loaded = await loadProjectChecks(repo, repo, env, { interactive: false, say: () => {} })
    const checks = loaded.checks.filter((c: any) => c.id === 'slow')
    const lines: string[] = []
    const t0 = Date.now()
    const out = await runGate({ checks, files: ['a.js'], repoRoot: repo, appDir: repo, env, scratch: true, progress: (l: string) => lines.push(l), heartbeatMs: 400, deadlineMs: 2500 })
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(lines.join('\n')).toMatch(/running: slow \(\d+s\)/)
    expect(out.stoppedEarly).toBe(true)
  }, 30_000)

  test('(c) the base side names its running check while the comparison runs', async () => {
    const out: any = { exitCode: 1, files: ['a.js'], rows: [{ id: 'slow', kind: 'fail', detail: '', ms: 1, findings: [], places: [{ file: 'a.js', line: 3, message: 'x' }], files: ['a.js'] }] }
    const lines: string[] = []
    await keepNewOnly(out, { o: { base: 'main' }, changed: { mb, ref: 'main' }, repoRoot: repo, appDir: repo, env, tier: 'fast', err: () => {}, progress: (l: string) => lines.push(l), deadlineAt: Date.now() + 2500, heartbeatMs: 400 })
    expect(lines.join('\n')).toMatch(/base side: .*running: slow \(\d+s\)/)
  }, 30_000)
})
