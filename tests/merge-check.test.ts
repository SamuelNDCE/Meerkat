// meerkat merge-check: a CONFLICT or CLEAN verdict for a branch against a base, from git merge-tree, with no checkout and no gate run.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { CLI } from './smoke-helpers.mjs'

let repo = ''
const git = (...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const write = (name: string, text: string) => writeFileSync(join(repo, name), text)
const commitOn = (branch: string, name: string, text: string, msg: string) => {
  git('checkout', '-q', branch)
  write(name, text)
  git('add', name)
  git('commit', '-q', '-m', msg)
}
const run = (args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, 'merge-check', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', CI: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'meerkat-mergecheck-'))
  git('init', '-q', '-b', 'base')
  write('a.txt', 'one\ntwo\nthree\n')
  write('b.txt', 'alpha\nbeta\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('branch', 'other-file')
  git('branch', 'same-line-1')
  git('branch', 'same-line-2')
  git('branch', 'nochange')
  commitOn('other-file', 'b.txt', 'alpha\nbeta changed\n', 'edit b')
  commitOn('same-line-1', 'a.txt', 'one\nTWO ONE\nthree\n', 'edit a one')
  commitOn('same-line-2', 'a.txt', 'one\nTWO TWO\nthree\n', 'edit a two')
  git('checkout', '-q', 'base')
  // base moves on the same line as same-line-1
  write('a.txt', 'one\nTWO BASE\nthree\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'base edits a')
})
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('meerkat merge-check', () => {
  test('a branch that edits a different file is CLEAN with a tree id', () => {
    const r = run(['other-file', '--base', 'base'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/CLEAN/)
    expect(r.out).toMatch(/[0-9a-f]{40}/)
  })

  test('a branch editing the same line as the base is CONFLICT and lists the path', () => {
    const r = run(['same-line-1', '--base', 'base'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/CONFLICT/)
    expect(r.out).toContain('a.txt')
  })

  test('a branch with no changes is CLEAN', () => {
    const r = run(['nochange', '--base', 'base'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/CLEAN/)
  })

  test('an unknown ref is a clear error with exit 2', () => {
    const r = run(['no-such-branch', '--base', 'base'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('no-such-branch')
  })

  test('--json has a field per branch, and several branches each get a verdict', () => {
    const r = run(['other-file', 'same-line-1', 'nochange', '--base', 'base', '--json'])
    expect(r.code).toBe(1)
    const doc = JSON.parse(r.out)
    expect(doc.base).toBe('base')
    expect(doc.branches.map((b: { branch: string }) => b.branch)).toEqual(['other-file', 'same-line-1', 'nochange'])
    const by = Object.fromEntries(doc.branches.map((b: { branch: string }) => [b.branch, b]))
    expect(by['other-file'].verdict).toBe('CLEAN')
    expect(by['other-file'].tree).toMatch(/^[0-9a-f]{40,64}$/)
    expect(by['same-line-1'].verdict).toBe('CONFLICT')
    expect(by['same-line-1'].paths).toContain('a.txt')
    expect(by['same-line-1'].tree).toBeUndefined()
    expect(by.nochange.verdict).toBe('CLEAN')
  })

  test('two branches that edit the same line of one file conflict with each other when one is the base', () => {
    const r = run(['same-line-2', '--base', 'same-line-1'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.txt')
  })

  test('no branch given is a usage error', () => {
    expect(run([]).code).toBe(2)
  })

  test('it creates no ref', () => {
    const before = git('for-each-ref')
    run(['other-file', '--base', 'base'])
    expect(git('for-each-ref')).toBe(before)
  })
})
