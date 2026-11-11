// meerkat claim / claims / release / worktrees (lib/claims.mjs) against a throwaway repo with two worktrees.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { overlaps, normalizePath } from '../lib/claims.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-claims-'))); tmps.push(d); return d }
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
function mk(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

let main = ''
let wtA = ''
let wtB = ''
let claimsFile = ''

beforeAll(() => {
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
  wtA = join(base, 'wt-a')
  wtB = join(base, 'wt-b')
  git(main, 'worktree', 'add', '-q', '-b', 'feat-a', wtA)
  git(main, 'worktree', 'add', '-q', '-b', 'feat-b', wtB)
  claimsFile = join(main, '.git', 'meerkat-claims.json')
})

afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

describe('overlap rule', () => {
  test('(f) nested paths overlap in both directions, siblings with a shared prefix do not', () => {
    expect(overlaps('a/b', 'a')).toBe(true)
    expect(overlaps('a', 'a/b')).toBe(true)
    expect(overlaps('a/b', 'a/b/c')).toBe(true)
    expect(overlaps('a/b/c', 'a/b')).toBe(true)
    expect(overlaps('a-b', 'a')).toBe(false)
    expect(overlaps('a', 'a-b')).toBe(false)
    expect(overlaps('a/bc', 'a/b')).toBe(false)
    expect(overlaps('a.txt', 'a')).toBe(false)
    expect(overlaps('x/y', 'x/z')).toBe(false)
    expect(overlaps('.', 'anything/deep')).toBe(true)
  })
  test('(f) paths are normalised to forward slashes and repo-relative; outside paths are rejected', () => {
    expect(normalizePath('lib\\sub\\', main, main)).toBe('lib/sub')
    expect(normalizePath('./lib/x.mjs', main, main)).toBe('lib/x.mjs')
    expect(normalizePath('../x', main, main)).toBeNull()
    expect(normalizePath(join(main, 'src', 'a.js'), wtA, main)).toBe('src/a.js')
  })
})

describe('claims', () => {
  test('(a) a conflicting claim from another name is refused with exit 1 and the fix line; claims are shared across worktrees', () => {
    const first = mk(wtA, 'claim', 'src/api', '--by', 'agent-a', '--ttl', '2h')
    expect(first.code).toBe(0)
    expect(existsSync(claimsFile)).toBe(true)
    expect(existsSync(join(wtA, 'meerkat-claims.json'))).toBe(false)
    const second = mk(wtB, 'claim', 'src/api/routes.js', '--by', 'agent-b')
    expect(second.code).toBe(1)
    expect(second.err).toMatch(/claimed by agent-a until \d{4}-\d\d-\d\dT\S+\. Wait, or ask them to: meerkat release src\/api/)
    expect(second.err).toMatch(/left/)
    expect(mk(wtB, 'claim', 'src/api-v2', '--by', 'agent-b').code).toBe(0)
  })
  test('usage errors exit 2', () => {
    expect(mk(wtA, 'claim', 'x').code).toBe(2)
    expect(mk(wtA, 'claim', '--by', 'n').code).toBe(2)
    expect(mk(wtA, 'claim', 'x', '--by', 'n', '--ttl', 'soon').code).toBe(2)
    expect(mk(wtA, 'claim', '../outside', '--by', 'n').code).toBe(2)
  })
  test('(b) the same name can extend its own claim', () => {
    const before = JSON.parse(readFileSync(claimsFile, 'utf8')).claims.find((c: { owner: string }) => c.owner === 'agent-a')
    expect(mk(wtA, 'claim', 'src/api', 'src/api/deep', '--by', 'agent-a', '--ttl', '6h').code).toBe(0)
    const after = JSON.parse(readFileSync(claimsFile, 'utf8')).claims.filter((c: { owner: string }) => c.owner === 'agent-a')
    expect(after).toHaveLength(1)
    expect(after[0].paths).toEqual(['src/api', 'src/api/deep'])
    expect(after[0].expires).toBeGreaterThan(before.expires)
  })
  test('claims lists owner, paths, branch, worktree and time left, from any worktree', () => {
    const r = mk(wtB, 'claims')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/agent-a: src\/api, src\/api\/deep \(feat-a, .*wt-a, \d+h \d+m left\)/)
    const j = JSON.parse(mk(wtB, 'claims', '--json').out)
    expect(j.claims.map((c: { owner: string }) => c.owner).sort()).toEqual(['agent-a', 'agent-b'])
  })
  test('(c) an expired claim is removed on read and listed as expired', () => {
    const d = JSON.parse(readFileSync(claimsFile, 'utf8'))
    d.claims.push({ owner: 'ghost', paths: ['old/dir'], branch: 'x', worktree: wtA, created: 1, expires: Date.now() - 1000 })
    writeFileSync(claimsFile, JSON.stringify(d))
    const r = mk(wtA, 'claims')
    expect(r.out).toContain('ghost: old/dir (expired, removed)')
    expect(JSON.parse(readFileSync(claimsFile, 'utf8')).claims.some((c: { owner: string }) => c.owner === 'ghost')).toBe(false)
    expect(mk(wtA, 'claims').out).not.toContain('ghost')
  })
  test('an expired claim does not block another name', () => {
    const d = JSON.parse(readFileSync(claimsFile, 'utf8'))
    d.claims.push({ owner: 'ghost', paths: ['stale'], branch: 'x', worktree: wtA, created: 1, expires: Date.now() - 1000 })
    writeFileSync(claimsFile, JSON.stringify(d))
    expect(mk(wtB, 'claim', 'stale/file', '--by', 'agent-b').code).toBe(0)
  })
  test('a stale lock (older than 60 seconds) is removed', () => {
    const lock = `${claimsFile}.lock`
    writeFileSync(lock, 'old')
    const past = new Date(Date.now() - 120000)
    utimesSync(lock, past, past)
    expect(mk(wtA, 'claims').code).toBe(0)
    expect(existsSync(lock)).toBe(false)
  })
  test('(d) release by another name without --force is refused; --force and the owner both work', () => {
    const refused = mk(wtB, 'release', 'src/api', '--by', 'agent-b')
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('claimed by agent-a')
    expect(refused.err).toContain('--force')
    expect(mk(wtA, 'claims').out).toContain('agent-a: src/api')
    expect(mk(wtB, 'release', 'src/api', '--by', 'agent-b', '--force').code).toBe(0)
    expect(mk(wtA, 'release', 'src/api/deep', '--by', 'agent-a').code).toBe(0)
    expect(mk(wtA, 'claims').out).not.toContain('agent-a')
  })
})

describe('worktrees', () => {
  test('lists every worktree with branch, claims, uncommitted count and merged state', () => {
    mk(wtA, 'claim', 'docs', '--by', 'agent-a')
    const r = mk(main, 'worktrees')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/wt-a\s+\|\s+feat-a\s+\|\s+0 uncommitted\s+\|\s+clean, merged into origin\/main/)
    expect(r.out).toContain('claims: agent-a docs')
    expect(r.out).toMatch(/repo\s+\|\s+main\s+\|.*main checkout/)
    const j = JSON.parse(mk(main, 'worktrees', '--json').out)
    expect(j.worktrees).toHaveLength(3)
  })
  test('(e) close refuses an unmerged worktree, a dirty worktree and the main checkout; without --yes it only prints', () => {
    writeFileSync(join(wtB, 'new.txt'), 'work\n')
    git(wtB, 'add', 'new.txt')
    git(wtB, 'commit', '-q', '-m', 'unmerged work')
    const unmerged = mk(main, 'worktrees', 'close', wtB, '--yes')
    expect(unmerged.code).toBe(1)
    expect(unmerged.err).toContain('not merged into origin/main')
    expect(existsSync(wtB)).toBe(true)
    writeFileSync(join(wtA, 'dirty.txt'), 'x\n')
    writeFileSync(join(wtA, 'a.txt'), 'changed\n')
    const dirty = mk(main, 'worktrees', 'close', wtA, '--yes')
    expect(dirty.code).toBe(1)
    expect(dirty.err).toMatch(/\d+ uncommitted change/)
    expect(existsSync(wtA)).toBe(true)
    expect(mk(wtA, 'worktrees', 'close', main, '--yes').code).toBe(1)
    git(wtA, 'checkout', '-q', 'a.txt')
    rmSync(join(wtA, 'dirty.txt'))
    const dry = mk(main, 'worktrees', 'close', wtA)
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('would remove')
    expect(existsSync(wtA)).toBe(true)
  })
  test('close with --yes removes a clean, merged worktree and its claims', () => {
    const r = mk(main, 'worktrees', 'close', wtA, '--yes')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/removed worktree .*wt-a and 1 claim/)
    expect(existsSync(wtA)).toBe(false)
    expect(mk(main, 'claims').out).not.toContain('agent-a')
  })
  test('five writers at once do not corrupt the file', async () => {
    const run = (name: string) => new Promise<number | null>((res) => {
      const c = spawn(process.execPath, [BIN, 'claim', `p-${name}`, '--by', name], { cwd: main })
      c.on('close', res)
    })
    const codes = await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5'].map(run))
    expect(codes).toEqual([0, 0, 0, 0, 0])
    const owners = JSON.parse(readFileSync(claimsFile, 'utf8')).claims.map((c: { owner: string }) => c.owner)
    for (const n of ['w1', 'w2', 'w3', 'w4', 'w5']) expect(owners).toContain(n)
  })
})
