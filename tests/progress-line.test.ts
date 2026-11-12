// The gate prints a summary line on stderr (percent, counts, elapsed, ETA, what runs); stdout line 1 stays the answer.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-pline-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1', MEERKAT_GATE_HEARTBEAT_MS: '300' }
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const mk = (id: string, ms: number) => ({ id, title: id, cmd: 'node', args: ['sleep.js', String(ms)], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [mk('alpha', 700), mk('beta', 1200), mk('gamma', 1700)] }))
  writeFileSync(join(repo, 'sleep.js'), 'setTimeout(function () {}, Number(process.argv[2]))\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 2\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
}, 60_000)

describe('progress summary line', () => {
  test('stderr has the summary line with a percent, and stdout line 1 is still the answer', () => {
    const r = spawnSync(process.execPath, [bin, 'verdict', '--base', 'main', '--no-input', '--only-checks', 'alpha,beta,gamma'], { cwd: repo, env: { ...env, MEERKAT_JOBS: '1' }, encoding: 'utf8', timeout: 120_000 })
    const err = String(r.stderr)
    const out = String(r.stdout)
    expect(err, err).toMatch(/^\[\d+% \d+\/3 \| [^\]|]+ elapsed \| (ETA ~[^\]]+|ETA unknown)\] running: \S+ \(since [^)]+\)/m)
    expect(err).toMatch(/^\[done \d+\/3\] alpha \.\.\./m) // the per-check line is unchanged
    expect(err).toMatch(/\[100% 3\/3 \|/)
    const first = out.split(/\r?\n/)[0]
    expect(first.trim().length).toBeGreaterThan(0)
    expect(first).not.toMatch(/^\[\d+%/)
    expect(out).not.toMatch(/^\[\d+% /m)
  }, 130_000)
})
