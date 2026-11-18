// meerkat worktrees new: creates a worktree and records owner and purpose in the git dir; report shows them.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  base = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-wtowner-')))
  tmps.push(base)
  main = join(base, 'repo')
  git(base, 'init', '-q', '-b', 'main', 'repo')
  writeFileSync(join(main, 'a.txt'), 'x\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'init')
  git(main, 'worktree', 'add', '-q', '-b', 'old-b', p('wt-old'))
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

describe('worktrees new', () => {
  test('creates the worktree from the base and records owner and purpose outside the working tree', () => {
    const r = mk(main, 'worktrees', 'new', p('wt-new'), '--branch', 'feat-new', '--for', 'try the space view', '--by', 'agent-a', '--base', 'main')
    expect(r.code, r.err).toBe(0)
    expect(existsSync(join(p('wt-new'), 'a.txt'))).toBe(true)
    expect(git(p('wt-new'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat-new')
    const common = git(main, 'rev-parse', '--git-common-dir')
    const file = join(main, common, 'meerkat-worktree-owners.json')
    const text = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))
    expect(text).toContain('agent-a')
    expect(text).toContain('try the space view')
    expect(git(main, 'status', '--porcelain')).toBe('')
  })
  test('refuses an existing path and an existing branch', () => {
    mkdirSync(p('taken'))
    const a = mk(main, 'worktrees', 'new', p('taken'), '--branch', 'feat-x', '--for', 'x', '--base', 'main')
    expect(a.code).not.toBe(0)
    expect(a.err).toMatch(/exists/i)
    const b = mk(main, 'worktrees', 'new', p('wt-other'), '--branch', 'old-b', '--for', 'x', '--base', 'main')
    expect(b.code).not.toBe(0)
    expect(b.err).toMatch(/branch/i)
    expect(existsSync(p('wt-other'))).toBe(false)
  })
  test('needs --branch and --for', () => {
    const r = mk(main, 'worktrees', 'new', p('wt-z'), '--branch', 'feat-z', '--base', 'main')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/--for/)
  })
})

describe('worktrees report shows owners', () => {
  test('a recorded worktree shows owner and purpose, an unrecorded one says unknown owner', () => {
    const r = mk(main, 'worktrees', 'report', '--base', 'main')
    expect(r.code).toBe(0)
    const lines = r.out.split('\n')
    const rec = lines.find((l) => l.includes('wt-new')) ?? ''
    expect(rec).toContain('agent-a')
    expect(rec).toContain('try the space view')
    expect(rec).toMatch(/CLEAN-MERGED/)
    const unk = lines.find((l) => l.includes('wt-old')) ?? ''
    expect(unk).toContain('unknown owner')
    expect(unk).toMatch(/CLEAN-MERGED/)
  })
  test('--json carries owner and purpose', () => {
    const d = JSON.parse(mk(main, 'worktrees', 'report', '--base', 'main', '--json').out)
    const by = Object.fromEntries(d.worktrees.map((w: { path: string }) => [w.path.split(/[\\/]/).pop(), w]))
    expect(by['wt-new'].owner).toBe('agent-a')
    expect(by['wt-new'].purpose).toBe('try the space view')
    expect(by['wt-old'].owner).toBeNull()
  })
})
