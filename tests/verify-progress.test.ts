// `meerkat verify` prints per-check progress on stderr ("[n/N] <id> running", "[done n/N] <id> <secs>s <status>"); stdout line 1 stays the answer.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { verifyProgress } from '../lib/verifyprogress.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-vprog-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1' }
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'dev')
  const mk = (id: string) => ({ id, title: id, cmd: 'node', args: ['-e', 'process.exit(0)'], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [mk('alpha'), mk('beta')] }))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
}, 60_000)

describe('verify progress', () => {
  test('a 2-check fixture prints start and done lines for both checks to stderr, and stdout line 1 is still the answer', () => {
    const r = spawnSync(process.execPath, [bin, 'verify', '--only', 'alpha', '--only', 'beta'], { cwd: repo, env, encoding: 'utf8', timeout: 170_000 })
    const err = String(r.stderr)
    const first = String(r.stdout).split(/\r?\n/)[0]
    for (const id of ['alpha', 'beta']) {
      expect(err, err).toMatch(new RegExp('^\\[\\d+/2\\] ' + id + ' running$', 'm'))
      expect(err, err).toMatch(new RegExp('^\\[done \\d+/2\\] ' + id + ' \\d+\\.\\ds PASS$', 'm'))
    }
    expect(first.trim().length).toBeGreaterThan(0)
    expect(first).not.toMatch(/^\[(done )?\d+\/\d+\]/)
    expect(String(r.stdout)).not.toMatch(/^\[(done )?\d+\/\d+\] \w+ running$/m)
  }, 180_000)
  test('the hooks count starts and finishes separately', () => {
    const lines: string[] = []
    const p = verifyProgress(2, (l: string) => lines.push(l))
    p.start({ id: 'a' })
    p.start({ id: 'b' })
    p.settle({ id: 'b' }, { status: 'FAIL' }, 1500)
    expect(lines).toEqual(['[1/2] a running', '[2/2] b running', '[done 1/2] b 1.5s FAIL'])
  })
})
