// meerkat worktrees report / prune: verdicts per worktree and a prune that only removes finished ones.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
const mk = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

let base = ''
let main = ''
const p = (n: string) => join(base, n)

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-wtreport-')))
  tmps.push(base)
  main = join(base, 'repo')
  git(base, 'init', '-q', '-b', 'main', 'repo')
  writeFileSync(join(main, 'a.txt'), 'x\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'init')
  git(main, 'worktree', 'add', '-q', '-b', 'merged-b', p('wt-merged'))
  git(main, 'worktree', 'add', '-q', '-b', 'dirty-b', p('wt-dirty'))
  writeFileSync(join(p('wt-dirty'), 'new.txt'), 'u\n')
  git(main, 'worktree', 'add', '-q', '-b', 'unmerged-b', p('wt-unmerged'))
  writeFileSync(join(p('wt-unmerged'), 'u.txt'), 'u\n')
  git(p('wt-unmerged'), 'add', 'u.txt')
  git(p('wt-unmerged'), 'commit', '-q', '-m', 'work')
  git(main, 'worktree', 'add', '-q', '-b', 'gone-b', p('wt-gone'))
  rmSync(p('wt-gone'), { recursive: true, force: true })
  git(main, 'worktree', 'add', '-q', '-b', 'claimed-b', p('wt-claimed'))
  expect(mk(p('wt-claimed'), 'claim', 'some/path', '--by', 'bob').code).toBe(0)
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

const verdicts = (out: string) => {
  const m: Record<string, string> = {}
  for (const l of out.split('\n')) {
    for (const n of ['wt-merged', 'wt-dirty', 'wt-unmerged', 'wt-gone', 'wt-claimed']) {
      if (l.includes(n)) m[n] = (/(CLEAN-MERGED|CLEAN-UNMERGED|DIRTY|PRUNABLE|CLAIMED)/.exec(l) ?? [])[1] ?? ''
    }
  }
  return m
}

describe('worktrees report', () => {
  test('gives each worktree its verdict and a summary line first', () => {
    const r = mk(main, 'worktrees', 'report', '--base', 'main')
    expect(r.code).toBe(0)
    expect(r.out.split('\n')[0]).toMatch(/worktrees/i)
    expect(verdicts(r.out)).toEqual({
      'wt-merged': 'CLEAN-MERGED', 'wt-dirty': 'DIRTY', 'wt-unmerged': 'CLEAN-UNMERGED', 'wt-gone': 'PRUNABLE', 'wt-claimed': 'CLAIMED',
    })
  })
  test('--json lists the same verdicts', () => {
    const r = mk(main, 'worktrees', 'report', '--base', 'main', '--json')
    const d = JSON.parse(r.out)
    const by = Object.fromEntries(d.worktrees.map((w: { path: string; verdict: string }) => [w.path.split(/[\/]/).pop(), w.verdict]))
    expect(by['wt-merged']).toBe('CLEAN-MERGED')
    expect(by['wt-gone']).toBe('PRUNABLE')
    expect(by.repo).toBe('MAIN')
  })
  test('an unknown base branch is an error', () => {
    expect(mk(main, 'worktrees', 'report', '--base', 'nope-branch').code).toBe(1)
  })
})

describe('worktrees prune', () => {
  test('dry run (the default) removes nothing', () => {
    const r = mk(main, 'worktrees', 'prune', '--base', 'main')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/would remove/i)
    expect(existsSync(p('wt-merged'))).toBe(true)
    expect(git(main, 'worktree', 'list')).toContain('wt-gone')
  })
  test('--dry-run with --yes still removes nothing', () => {
    mk(main, 'worktrees', 'prune', '--base', 'main', '--dry-run', '--yes')
    expect(existsSync(p('wt-merged'))).toBe(true)
  })
  test('--yes removes only the clean merged and prunable ones', () => {
    const r = mk(main, 'worktrees', 'prune', '--base', 'main', '--yes')
    expect(r.code).toBe(0)
    expect(existsSync(p('wt-merged'))).toBe(false)
    expect(git(main, 'worktree', 'list')).not.toContain('wt-gone')
    for (const keep of ['wt-dirty', 'wt-unmerged', 'wt-claimed', 'repo']) {
      const dir = keep === 'repo' ? main : p(keep)
      expect(existsSync(dir)).toBe(true)
    }
    expect(existsSync(join(p('wt-dirty'), 'new.txt'))).toBe(true)
  })
})
