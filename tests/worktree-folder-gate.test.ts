// Gating a git worktree as the folder (a .git FILE, not a directory) must come back with a verdict, and a gate that runs 0 checks must say
// which scope it used (the folder and what it compared with), not only "no check covers the changed files".
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { gateMain } from '../lib/gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-wtgate-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}

let main: string
let wt: string
beforeAll(() => {
  main = join(root, 'main')
  wt = join(root, 'wt')
  mkdirSync(main, { recursive: true })
  git(main, 'init', '-q', '-b', 'main')
  put(main, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus'], discover: false }))
  put(main, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(main, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(main, 'add', '-A')
  git(main, 'commit', '-q', '-m', 'clean')
  git(main, 'worktree', 'add', '-q', '-b', 'feat', wt)
  put(wt, 'NOTES.txt', 'only a note\n')
  git(wt, 'add', '-A')
  git(wt, 'commit', '-q', '-m', 'note')
})

async function gate(args: string[], cwd: string) {
  const lines: string[] = []
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
  const run = gateMain(args, { env, cwd, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
  const timer = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 60000))
  const code = await Promise.race([run, timer])
  return { code, text: lines.join('\n') }
}

describe('gate on a worktree folder', () => {
  test('returns a verdict, and a zero-check result names the folder and the scope it used', async () => {
    const r = await gate(['--app', wt, '--no-cache'], main)
    expect(r.code).not.toBe('timeout')
    expect(r.text).toMatch(/NO-RESULT|PASS|FAIL/)
    expect(r.text).toMatch(/no check covers the changed files/)
    expect(r.text).toMatch(/scope: changes since the merge-base with main/)
    expect(r.text).toContain('wt')
  }, 90000)
})
