// A worktree folder with another session's claim must survive `meerkat worktrees close` and `tools/worktrees.mjs close`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { claimProblem } from '../lib/claims.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const TOOL = join(ROOT, 'tools/worktrees.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-wtclaims-'))); tmps.push(d); return d }
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
const run = (script: string, cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const mk = (cwd: string, ...args: string[]) => run(BIN, cwd, ...args)

let main = ''
let wt = ''
let claimsFile = ''

// A fresh repo per test: a clean, merged worktree that someone may claim.
beforeEach(() => {
  const base = tmp()
  main = join(base, 'repo')
  const remote = join(base, 'remote.git')
  git(base, 'init', '-q', '-b', 'main', 'repo')
  writeFileSync(join(main, 'a.txt'), 'x\n')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'init')
  git(base, 'init', '-q', '--bare', remote)
  git(main, 'remote', 'add', 'origin', remote)
  git(main, 'push', '-q', 'origin', 'main')
  git(main, 'fetch', '-q', 'origin')
  wt = join(base, 'wt-a')
  git(main, 'worktree', 'add', '-q', '-b', 'feat-a', wt)
  claimsFile = join(main, '.git', 'meerkat-claims.json')
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

function expireClaims() {
  const d = JSON.parse(readFileSync(claimsFile, 'utf8'))
  for (const c of d.claims) c.expires = Date.now() - 60000
  writeFileSync(claimsFile, JSON.stringify(d))
}

describe('claimProblem (pure)', () => {
  const now = 1_000_000
  const live = [{ owner: 'bob', paths: ['src'], worktree: '/w/wt-a', expires: now + 3600000 }]
  test('names the owner and expiry when a live claim is on the folder', () => {
    const m = claimProblem('/w/wt-a', live, null, now)
    expect(m).toContain('bob')
    expect(m).toContain('1970-01-01T')
  })
  test('is case-insensitive and slash-insensitive on the folder', () => {
    expect(claimProblem(String.raw`\W\WT-A\ `.trim(), live, null, now)).toBeTruthy()
  })
  test('a claim whose worktree is another folder does not block', () => {
    expect(claimProblem('/w/wt-b', live, null, now)).toBeNull()
  })
  test('a claim path that resolves inside the folder blocks', () => {
    const inner = [{ owner: 'bob', paths: ['wt-a/src'], worktree: '/w', expires: now + 1000 }]
    expect(claimProblem('/w/wt-a', inner, null, now)).toContain('bob')
  })
  test('the matching owner passes, a different one does not', () => {
    expect(claimProblem('/w/wt-a', live, 'bob', now)).toBeNull()
    expect(claimProblem('/w/wt-a', live, 'eve', now)).toBeTruthy()
  })
  test('an expired claim is not a block', () => {
    expect(claimProblem('/w/wt-a', [{ ...live[0], expires: now - 1 }], null, now)).toBeNull()
  })
})

describe('meerkat worktrees close', () => {
  test('a claimed worktree survives close --yes (exit 1, folder and claim intact)', () => {
    expect(mk(wt, 'claim', 'docs', '--by', 'agent-a').code).toBe(0)
    const r = mk(main, 'worktrees', 'close', wt, '--yes')
    expect(r.code).toBe(1)
    expect(r.err).toContain('agent-a')
    expect(r.err).toMatch(/expires|until/)
    expect(existsSync(wt)).toBe(true)
    expect(readFileSync(claimsFile, 'utf8')).toContain('agent-a')
  })
  test('without --yes a claimed worktree is also refused', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    expect(mk(main, 'worktrees', 'close', wt).code).toBe(1)
  })
  test('--force-claimed with another owner is refused', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    const r = mk(main, 'worktrees', 'close', wt, '--yes', '--force-claimed', '--by', 'agent-b')
    expect(r.code).toBe(1)
    expect(existsSync(wt)).toBe(true)
  })
  test('--force-claimed without --by is refused', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    expect(mk(main, 'worktrees', 'close', wt, '--yes', '--force-claimed').code).toBe(1)
    expect(existsSync(wt)).toBe(true)
  })
  test('--force-claimed --by <owner> removes it', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    const r = mk(main, 'worktrees', 'close', wt, '--yes', '--force-claimed', '--by', 'agent-a')
    expect(r.code).toBe(0)
    expect(existsSync(wt)).toBe(false)
  })
  test('an expired claim does not block but is named in the output', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    expireClaims()
    const r = mk(main, 'worktrees', 'close', wt, '--yes')
    expect(r.code).toBe(0)
    expect(r.out + r.err).toContain('agent-a')
    expect(r.out + r.err).toMatch(/expired/)
    expect(existsSync(wt)).toBe(false)
  })
})

describe('tools/worktrees.mjs close', () => {
  test('refuses a claimed worktree (exit 1, folder intact)', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    const r = run(TOOL, main, 'close', '--yes', wt)
    expect(r.code).toBe(1)
    expect(r.out).toContain('agent-a')
    expect(existsSync(wt)).toBe(true)
  })
  test('--force-claimed --by <owner> removes it', () => {
    mk(wt, 'claim', 'docs', '--by', 'agent-a')
    const r = run(TOOL, main, 'close', '--yes', '--force-claimed', '--by', 'agent-a', wt)
    expect(r.code).toBe(0)
    expect(existsSync(wt)).toBe(false)
  })
  test('an unclaimed worktree is still removed', () => {
    expect(run(TOOL, main, 'close', '--yes', wt).code).toBe(0)
    expect(existsSync(wt)).toBe(false)
  })
})
