// verdict and gate print the same "behind <ref> by N commits" number for the same worktree (docs/issues.md 14e).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { behindLine, commitsBehind } from '../lib/gate.mjs'
import * as branchcmds from '../lib/branchcmds.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-behind-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') }
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
// main has 3 commits the feature branch lacks; the feature branch has one change of its own.
let n = 0
const fixture = () => {
  const d = join(root, 'repo' + n++)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  writeFileSync(join(d, 'meerkat.config.json'), JSON.stringify({ disable: ['unused-files'], discover: false }))
  writeFileSync(join(d, 'src/a.js'), 'export const a = 1\n')
  git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feature')
  writeFileSync(join(d, 'src/a.js'), 'export const a = 2\n')
  git(d, 'commit', '-q', '-am', 'feature change')
  git(d, 'checkout', '-q', 'main')
  for (let i = 0; i < 3; i++) { writeFileSync(join(d, `m${i}.txt`), String(i)); git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', `main ${i}`) }
  git(d, 'checkout', '-q', 'feature')
  return d
}
const behindOf = (text: string) => /behind main by (\d+) commits/.exec(text)?.[1]

describe('behind count', () => {
  test('both commands use one function', () => {
    expect(branchcmds.commitsBehind).toBe(commitsBehind)
  })
  test('behindLine and commitsBehind agree for a branch 3 commits behind', () => {
    const d = fixture()
    expect(commitsBehind(d, 'main')).toBe(3)
    expect(behindLine(d, { ref: 'main' })).toBe('note: behind main by 3 commits')
  })
  test('verdict and gate print the same number, 3', () => {
    const d = fixture()
    const run = (cmd: string) => { const r = spawnSync(process.execPath, [bin, cmd, '--base', 'main'], { cwd: d, env, encoding: 'utf8', timeout: 120_000 }); return `${r.stdout}\n${r.stderr}` }
    expect(behindOf(run('gate'))).toBe('3')
    expect(behindOf(run('verdict'))).toBe('3')
  }, 240000)
})
