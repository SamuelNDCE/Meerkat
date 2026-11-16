// A long check (rust-test is the real case) must show progress while it runs, and when it hits its limit the result must say which check
// timed out and the other checks must still have run. Uses fake checks (a node script that sleeps and prints nothing), never cargo.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { loadProjectChecks, runGate } from '../lib/gate.mjs'
const root = mkdtempSync(join(tmpdir(), 'meerkat-rprog-'))
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  } catch {
    /* left to the OS */
  }
})
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1' } as Record<string, string>
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const base = { tier: 'fast', group: 'functionality', cwd: '.' }
  const checks = [
    { ...base, id: 'slow-rust', title: 'slow', cmd: 'node', args: ['sleep.js', '15000'], timeoutSeconds: 2 },
    { ...base, id: 'quick-one', title: 'quick', cmd: 'node', args: ['-e', 'process.exit(0)'], timeoutSeconds: 30 },
  ]
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: checks }))
  writeFileSync(join(repo, 'sleep.js'), 'setTimeout(function () {}, Number(process.argv[2]))\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'a.js'), 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
}, 60_000)

async function run(lines: string[]) {
  const loaded = await loadProjectChecks(repo, repo, env, { interactive: false, say: () => {} })
  const checks = loaded.checks.filter((c: any) => c.id === 'slow-rust' || c.id === 'quick-one')
  return runGate({ checks, files: ['a.js'], repoRoot: repo, appDir: repo, env, scratch: true, progress: (l: string) => lines.push(l), heartbeatMs: 400 })
}

describe('long check progress and limit (rust-test)', () => {
  test('(a) a heartbeat names the running check and its elapsed seconds', async () => {
    const lines: string[] = []
    await run(lines)
    expect(lines.join('\n')).toMatch(/running: slow-rust \(\d+s\)/)
  }, 40_000)

  test('(b) a check that hits its limit says which check timed out, and the other check still ran', async () => {
    const lines: string[] = []
    const out: any = await run(lines)
    const slow = out.rows.find((r: any) => r.id === 'slow-rust')
    const quick = out.rows.find((r: any) => r.id === 'quick-one')
    expect(quick?.kind, JSON.stringify(out.rows.map((r: any) => [r.id, r.kind, r.detail]))).toBe('pass')
    expect(['hang', 'notrun']).toContain(slow?.kind)
    expect(String(slow?.detail), 'detail: ' + slow?.detail).toMatch(/slow-rust/)
    expect(String(slow?.detail)).toMatch(/still ran/)
    expect(out.stoppedEarly).toBeFalsy()
  }, 40_000)
})
