// 0.7.8 peer fixes: verdict heartbeat from the start, behind-base count first, folder line first (gate and brief).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBrief } from '../lib/brief.mjs'
import { runTop, runVerdict } from '../lib/branchcmds.mjs'
import { gateMain } from '../lib/gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-peer078-'))
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
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') } as NodeJS.ProcessEnv
let repo: string
let wt: string

beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  put(repo, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(repo, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(repo, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'branch', 'old')
  for (let i = 0; i < 25; i++) {
    put(repo, 'src/n.js', `export const n = ${i}\n`)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', `main ${i}`)
  }
  git(repo, 'checkout', '-q', 'old')
  put(repo, 'src/ok.js', 'export const ok = (a) => a + 2\n')
  git(repo, 'commit', '-q', '-am', 'change')
  git(repo, 'checkout', '-q', 'main')
  wt = join(root, 'wt')
  git(repo, 'worktree', 'add', '-q', wt, 'old')
})

describe('behind-base count', () => {
  test('top prints it as its first line on stderr; verdict prints it AFTER the headline (more than 20 adds the rebase warning)', async () => {
    const warn = 'note: behind main by 25 commits (more than 20: rebase before trusting this verdict)'
    const errs: string[] = []
    await runTop(['--base', 'main'], { env, cwd: wt, out: () => {}, err: (t: string) => errs.push(t) })
    expect(errs[0]).toBe(warn)
    const outs: string[] = []
    const verr: string[] = []
    await runVerdict(['--base', 'main'], { env, cwd: wt, out: (t: string) => outs.push(t), err: (t: string) => verr.push(t) })
    expect(outs[0]).not.toMatch(/^note:/)
    expect(outs).toContain(warn)
    expect(verr).not.toContain(warn)
  }, 180_000)
  test('gate prints it after the answer, on stdout, and says nothing alarming under 20', async () => {
    const logs: string[] = []
    await gateMain(['--base', 'main', '--app', wt], { env, cwd: wt, log: (t: string) => logs.push(t), err: () => {}, banner: true })
    expect(logs[0]).not.toMatch(/^note:/)
    expect(logs.some((l) => /^note: behind main by 25 commits \(more than 20/.test(l))).toBe(true)
  }, 180_000)
})

describe('verdict heartbeat from the start', () => {
  test('a slow first check still prints a heartbeat within 6 seconds of the start', async () => {
    const packs = join(root, 'slowrepo')
    mkdirSync(packs, { recursive: true })
    git(packs, 'init', '-q', '-b', 'main')
    put(packs, 'meerkat.config.json', JSON.stringify({ packs: ['repo'], disable: ['unused-files'], discover: false }))
    put(packs, 'package.json', JSON.stringify({ name: 'sl', version: '1.0.0', private: true }))
    put(packs, 'a.js', 'export const a = 1\n')
    git(packs, 'add', '-A')
    git(packs, 'commit', '-q', '-m', 'base')
    git(packs, 'checkout', '-q', '-b', 'feat')
    put(packs, 'a.js', 'export const a = 2\n')
    git(packs, 'commit', '-q', '-am', 'c')
    const t0 = Date.now()
    const beats: number[] = []
    const errs: string[] = []
    // The first check is held back: the heartbeat interval is 1 s here, so the first beat must come long before 6 s.
    await runVerdict(['--base', 'main'], { env: { ...env, MEERKAT_GATE_HEARTBEAT_MS: '1000' } as NodeJS.ProcessEnv, cwd: packs, out: () => {}, err: (t: string) => (errs.push(t), /^…/.test(t) && beats.push(Date.now() - t0)) })
    expect(beats.length).toBeGreaterThan(0)
    expect(beats[0]).toBeLessThan(6000)
    expect(errs.some((l) => /^… \d+s: (loading map and checks|running checks|base comparison)/.test(l))).toBe(true)
  }, 180_000)
})

describe('folder line first', () => {
  test('gate on a worktree path prints folder | branch | worktree after the answer line', async () => {
    const lines: string[] = []
    await gateMain(['--base', 'main', '--app', wt], { env, cwd: wt, log: (l: string) => lines.push(l), err: () => {}, banner: true })
    expect(lines[0]).toMatch(/\(status \d+[^)]*\)/) // "(status 422, exit 1)" since 0.5.4 // the answer is first; the folder line follows the outcome (changed before 0.5.6)
    expect(lines).toContain(`folder: ${wt} | branch old | git worktree`)
  }, 180_000)
  test('brief on a worktree path prints it first, also with --ref; --json carries a folder field', () => {
    const out: string[] = []
    runBrief(['src/ok.js', '--app', wt], { env, cwd: wt, out: (l: string) => out.push(l), err: () => {} })
    expect(out.join('\n').split('\n')[0]).toBe(`folder: ${wt} | branch old | git worktree`)
    const refd: string[] = []
    runBrief(['src/ok.js', '--app', wt, '--ref', 'main'], { env, cwd: wt, out: (l: string) => refd.push(l), err: () => {} })
    expect(refd.join('\n').split('\n')[0]).toBe(`folder: ${wt} | branch old | git worktree`)
    const js: string[] = []
    runBrief(['src/ok.js', '--app', wt, '--json'], { env, cwd: wt, out: (l: string) => js.push(l), err: () => {} })
    expect(JSON.parse(js.join('\n')).folder).toBe(wt)
  }, 180_000)
})
