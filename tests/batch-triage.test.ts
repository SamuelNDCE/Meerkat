// meerkat batch pre-triage: a branch that conflicts textually with the base is dropped before any gate run (git merge-tree), plain and --split.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'
import { triageAgainstBase, triageReason } from '../lib/mergecheck.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchtriage-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const commit = (dir: string, msg: string) => {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', msg)
}
let dir: string
let n = 0
const envFor = () => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, `logs${(n += 1)}`) })

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'src/shared.js', 'export const shared = 1\n')
  commit(dir, 'base')
  for (const b of ['feat-ok', 'feat-clash']) {
    git(dir, 'checkout', '-q', '-b', b, 'main')
    put(dir, b === 'feat-clash' ? 'src/shared.js' : `src/${b}.js`, b === 'feat-clash' ? 'export const shared = 2\n' : 'export const ok = 1\n')
    commit(dir, b)
    git(dir, 'checkout', '-q', 'main')
  }
  put(dir, 'src/shared.js', 'export const shared = 3\n') // trunk moved on the same line: feat-clash now conflicts with it
  commit(dir, 'trunk moves')
})

const calls: string[] = []
const gate = async (checkout: string) => {
  calls.push(checkout)
  return { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
}
const run = async (argv: string[]) => {
  const lines: string[] = []
  const errs: string[] = []
  calls.length = 0
  const code = await runBatch(['--base', 'main', '--app', dir, ...argv], { env: envFor(), cwd: dir, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t), gate, devBaseline: async () => false })
  return { code, lines, errs }
}

describe('triageAgainstBase', () => {
  const sha = (b: string) => git(dir, 'rev-parse', b)
  const items = () => [{ branch: 'feat-ok', sha: sha('feat-ok') }, { branch: 'feat-clash', sha: sha('feat-clash') }]

  test('splits clean from conflicting and names the conflicted path', () => {
    const t = triageAgainstBase(dir, sha('main'), items())
    expect(t.available).toBe(true)
    expect(t.clean.map((i: any) => i.branch)).toEqual(['feat-ok'])
    expect(t.conflicts.map((c: any) => c.item.branch)).toEqual(['feat-clash'])
    expect(t.conflicts[0].paths).toEqual(['src/shared.js'])
  })

  test('an old git (before 2.38) drops nothing and says why', () => {
    const t = triageAgainstBase(dir, sha('main'), items(), { versionText: 'git version 2.30.1' })
    expect(t.available).toBe(false)
    expect(t.clean).toHaveLength(2)
    expect(t.conflicts).toHaveLength(0)
    expect(t.note).toMatch(/pre-triage skipped: git 2\.30\.1 is older than 2\.38/)
  })

  test('triageReason starts with "conflicts with base" and caps the path list', () => {
    expect(triageReason(['a'])).toMatch(/^conflicts with base \(a\)/)
    expect(triageReason(['a', 'b', 'c', 'd', 'e'])).toMatch(/\(a, b, c and 2 more\)/)
  })
})

describe('batch pre-triage', () => {
  test('plain batch: the conflicting branch is NOT JUDGED with "conflicts with base" and costs no gate run', async () => {
    const r = await run(['feat-ok', 'feat-clash'])
    expect(calls).toHaveLength(1) // one union gate, for feat-ok only
    const text = r.lines.join('\n')
    expect(text).toMatch(/feat-clash[^\n]*conflicts with base/)
    expect(text).not.toMatch(/feat-ok[^\n]*conflicts with base/)
    expect(r.code).toBe(0)
  })

  test('only conflicting branches: nothing is gated and the answer is exit 3 NOT JUDGED', async () => {
    const r = await run(['feat-clash'])
    expect(calls).toHaveLength(0)
    expect(r.code).toBe(3)
    expect(r.lines.join('\n')).toMatch(/not judged.*feat-clash \(conflicts with base/)
  })

  test('--split: the conflicting branch is not gated and not bisected', async () => {
    const r = await run(['--split', 'feat-ok', 'feat-clash'])
    expect(calls).toHaveLength(1)
    const row = r.lines.find((l) => l.startsWith('feat-clash ')) ?? ''
    expect(row).toMatch(/NO-RESULT/)
    expect(row).toMatch(/conflicts with base/)
    const ok = r.lines.find((l) => l.startsWith('feat-ok ')) ?? ''
    expect(ok).toMatch(/PASS/)
  })
})
