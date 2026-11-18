// meerkat space: one overview of worktrees, live runs, run store, disk and advice.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { diskFree } from '../lib/spaceview.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
let base = ''
let main = ''
let logs = ''
const mk = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, MEERKAT_LOG_DIR: logs, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-space-')))
  tmps.push(base)
  logs = join(base, 'logs')
  main = join(base, 'repo')
  git(base, 'init', '-q', '-b', 'main', 'repo')
  writeFileSync(join(main, 'a.txt'), 'x\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'init')
  git(main, 'worktree', 'add', '-q', '-b', 'm1', join(base, 'wt-m1'))
  git(main, 'worktree', 'add', '-q', '-b', 'm2', join(base, 'wt-m2'))
  // two run folders: one finished, one live (this test process pid)
  const runs = join(logs, 'runs')
  const fin = join(runs, '20260101-000000-proj')
  mkdirSync(fin, { recursive: true })
  writeFileSync(join(fin, 'summary.json'), JSON.stringify({ status: 'pass' }))
  writeFileSync(join(fin, 'run.json'), JSON.stringify({ runId: 'fin-1', pid: 999999, kind: 'gate', startedAt: new Date().toISOString() }))
  const live = join(runs, '20260102-000000-proj')
  mkdirSync(live, { recursive: true })
  writeFileSync(join(live, 'run.json'), JSON.stringify({ runId: 'live-1', pid: process.pid, kind: 'gate', startedAt: new Date().toISOString() }))
  expect(mk(main, 'worktrees', 'new', join(base, 'wt-owned'), '--branch', 'owned-b', '--for', 'space test', '--by', 'agent-s', '--base', 'main').code).toBe(0)
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

describe('meerkat space', () => {
  test('shows the sections in order, each with a summary line, plus advice', () => {
    const r = mk(main, 'space', '--root', main, '--base', 'main')
    expect(r.code, r.err).toBe(0)
    const heads = ['Worktrees', 'Live runs', 'Run store', 'Disk', 'Advice']
    const idx = heads.map((h) => r.out.indexOf(h))
    expect(idx.every((i) => i >= 0), r.out).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(r.out).toMatch(/Worktrees: 4 worktrees/)
    expect(r.out).toMatch(/Live runs: 1 live/)
    expect(r.out).toMatch(/Run store: 2 run folders/)
    expect(r.out).toContain('agent-s')
    expect(r.out).toContain('space test')
    expect(r.out).toContain('unknown owner')
    expect(r.out).toMatch(/3 clean merged worktrees/)
    expect(r.out).toContain('meerkat worktrees prune --yes')
  })
  test('--json has the same sections', () => {
    const d = JSON.parse(mk(main, 'space', '--root', main, '--base', 'main', '--json').out)
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['worktrees', 'liveRuns', 'runStore', 'disk', 'advice']))
    expect(d.liveRuns.count).toBe(1)
    expect(d.runStore.folders).toBe(2)
    expect(Array.isArray(d.advice)).toBe(true)
    expect(d.worktrees.rows.find((w: { owner: string | null }) => w.owner === 'agent-s')).toBeTruthy()
  })
  test('takes no action: the worktrees are still there afterwards', () => {
    mk(main, 'space', '--root', main, '--base', 'main')
    expect(git(main, 'worktree', 'list')).toContain('wt-m1')
  })
})

describe('free disk', () => {
  test('reads a real value for an existing folder', () => {
    const d = diskFree(base)
    expect(d.known).toBe(true)
    expect(d.free).toBeGreaterThan(0)
  })
  test('says unknown when the check hangs (a deliberately hanging script)', () => {
    const t = Date.now()
    const d = diskFree(base, { timeoutMs: 800, script: 'setInterval(()=>{},1000)' })
    expect(d.known).toBe(false)
    expect(d.why).toMatch(/no answer/)
    expect(Date.now() - t).toBeLessThan(5000)
  })
})
