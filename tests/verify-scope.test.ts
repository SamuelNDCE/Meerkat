// `meerkat verify` is a whole-tree scan with no base: its JSON says "scope": "whole tree" and its text prints the scope on line 2, after the answer.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-vscope-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') }
const cli = (args: string[], cwd: string) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 170_000 })
  return { code: r.status, stdout: String(r.stdout), lines: String(r.stdout).split(/\r?\n/), err: String(r.stderr) }
}
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'dev')
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: ['security-plus'], disable: ['unused-files'], discover: false }))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
}, 60_000)

describe('verify names its scope', () => {
  test('--json carries "scope": "whole tree"', () => {
    const r = cli(['verify', '--json'], repo)
    const j = JSON.parse(r.stdout)
    expect(j.scope).toBe('whole tree')
  }, 180_000)
  test('text output prints the scope on line 2, after the answer on line 1', () => {
    const r = cli(['verify'], repo)
    expect(r.lines[1]).toBe('scope: whole tree (every check on every file; no base to compare with)')
    expect(r.lines[0]).not.toMatch(/^scope:/)
    expect(r.lines[0].trim().length).toBeGreaterThan(0)
  }, 180_000)
})
