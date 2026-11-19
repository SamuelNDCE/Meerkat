// Regression (29an): the gate returned PASS while a check row was fail. The batch must not report PASS for that branch.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'

test('a PASS gate with a failing check row is not a batch PASS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-failclosed-'))
  try {
    const dir = join(root, 'repo')
    mkdirSync(dir, { recursive: true })
    const git = (...a: string[]) => {
      const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
      if (r.status !== 0) throw new Error(r.stderr)
    }
    git('init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'a.js'), 'x=1\n')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'feat')
    writeFileSync(join(dir, 'b.js'), 'y=2\n')
    git('add', '-A'); git('commit', '-q', '-m', 'feat')
    git('checkout', '-q', 'main')
    const lines: string[] = []
    const code = await runBatch(['--base', 'main', '--app', dir, 'feat'], {
      env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') },
      cwd: dir,
      out: (t: string) => lines.push(t),
      err: () => {},
      gate: async () => ({ code: 0, verdict: 'PASS', reason: 'PASS', checks: [{ check: 'rust-test', status: 'fail', detail: 'test failed', places: [] }] }),
      devBaseline: async () => false,
    })
    expect(code).not.toBe(0)
    expect(lines.join('\n')).not.toMatch(/^feat .*\bPASS\b/m)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}, 120000)
