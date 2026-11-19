// An INCOMPLETE verdict still states how many changed files it judged on line 1 (docs/issues.md 14f).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { headline, verdictHead } from '../lib/verdict-report.mjs'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-incjudged-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_GATE_HEARTBEAT_MS: '500' } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}

describe('INCOMPLETE line 1 carries the judged count', () => {
  test('headline() with a judged count on an INCOMPLETE run', () => {
    expect(headline({ kind: 'INCOMPLETE', status: 408, reason: 'time-limit', judged: { count: 2, noCheck: 0 } })).toMatch(/judged 2 changed file\(s\)\./)
    expect(verdictHead({ code: 75, incompleteCode: 75, status: 408, incompleteReason: 'time-limit', failCount: 0, report: { files: [], notFinished: null, toolProblems: [] }, judged: { count: 3, noCheck: 0 } })).toMatch(/judged 3 changed file\(s\)\./)
  })
  test('a verdict stopped at its time limit (a sleeping check) says "judged 1 changed file(s)" on line 1', () => {
    const d = join(root, 'fx')
    const flag = join(root, 'fx.sleep').replaceAll(String.fromCharCode(92), '/')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
    put(d, 'a.js', 'export const a = 1\n')
    put(d, 'nap.js', `if (require('fs').existsSync(${JSON.stringify(flag)})) setTimeout(() => {}, 120000)\n`)
    put(d, 'meerkat.config.json', JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 }] }))
    git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'base')
    git(d, 'checkout', '-q', '-b', 'feat')
    put(d, 'a.js', 'export const a = 2\n')
    git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'change a')
    writeFileSync(flag, 'x')
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), 'verdict', '--base', 'main', '--max-seconds', '3'], { encoding: 'utf8', env: { ...env, MEERKAT_VERDICT_TIMEOUT_S: '30' }, cwd: d, timeout: 170000 })
    const first = String(r.stdout).split(/\r?\n/)[0]
    expect(first).toMatch(/^INCOMPLETE /)
    expect(first).toMatch(/judged 1 changed file\(s\)/)
  }, 180000)
})
