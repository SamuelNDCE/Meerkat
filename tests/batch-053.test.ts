// meerkat batch: several branches gated together in one temporary checkout, the culprit found when the batch fails.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { exitCodeFor, parseBatchArgs, planBatch, runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batch053-'))
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
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs }
let dir: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  put(dir, 'src/two.js', 'export const two = (a) => a + 2\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  const branch = (name: string, edit: () => void) => {
    git(dir, 'checkout', '-q', '-b', name, 'main')
    edit()
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', name)
    git(dir, 'checkout', '-q', 'main')
  }
  branch('clean1', () => put(dir, 'src/ok.js', 'export const ok = (a) => a + 10\n'))
  branch('clean2', () => put(dir, 'src/two.js', 'export const two = (a) => a + 20\n'))
  branch('bad', () => put(dir, 'src/new.js', bug('newBug')))
  branch('conflict', () => put(dir, 'src/ok.js', 'export const ok = (a) => a + 99\n'))
})

// A fast fake gate for the logic tests: it looks at the files of the checkout it is given. src/new.js is the failing one.
const calls: Array<{ only: string[] | null; hasBad: boolean }> = []
const fakeGate = async (checkout: string, o: { only?: string[] | null }) => {
  const hasBad = existsSync(join(checkout, 'src', 'new.js'))
  calls.push({ only: o.only ?? null, hasBad })
  if (!hasBad) return { code: 0, verdict: 'PASS', checks: [], reason: 'PASS' }
  return { code: 1, verdict: 'FAIL', reason: 'FAIL 1 blocking', checks: [{ check: 'fake-sqli', status: 'fail', places: [{ file: 'src/new.js', line: 1 }], detail: 'sql built from a string' }] }
}
const noBaseFail = async () => false
const run = async (argv: string[], extra: Record<string, unknown> = {}) => {
  const lines: string[] = []
  const code = await runBatch(argv, { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate: fakeGate, devBaseline: noBaseFail, ...extra })
  return { code, lines }
}
const resultOf = (lines: string[]) => {
  const last = lines[lines.length - 1]
  const file = /result (.+)$/.exec(last)?.[1] ?? ''
  return { file, doc: file ? JSON.parse(readFileSync(file, 'utf8')) : null }
}

describe('pure helpers', () => {
  test('parseBatchArgs takes comma or space separated branches and rejects nonsense', () => {
    const o: any = parseBatchArgs(['--base', 'main', '--app', '.', 'a,b', 'c', '--dry-run', '--max-prs', '3'])
    expect(o.branches).toEqual(['a', 'b', 'c'])
    expect(o.dryRun).toBe(true)
    expect(o.maxPrs).toBe(3)
    expect((parseBatchArgs(['--base', 'main']) as any).error).toMatch(/at least one branch/)
    expect((parseBatchArgs(['--wat', 'a']) as any).error).toMatch(/unknown option/)
  })
  test('planBatch excludes unknown, too big and over-cap branches', () => {
    const p = planBatch([{ branch: 'a', sha: '1', lines: 10 }, { branch: 'b', sha: null, lines: null }, { branch: 'c', sha: '3', lines: 900 }, { branch: 'd', sha: '4', lines: 5 }], { maxLines: 800, maxPrs: 1 })
    expect(p.included.map((x: any) => x.branch)).toEqual(['a'])
    expect(p.excluded.map((x: any) => x.reason)).toEqual(['not found', 'too big (900 changed lines, limit 800)', 'too many branches in one batch (limit 1)'])
  })
  test('exitCodeFor never gives 0 for unknown, stale or empty', () => {
    expect(exitCodeFor([{ status: 'PASS' }, { status: 'MERGEABLE' }])).toBe(0)
    expect(exitCodeFor([{ status: 'PASS' }, { status: 'BLOCKED' }])).toBe(1)
    expect(exitCodeFor([{ status: 'PASS' }, { status: 'INCOMPLETE' }])).toBe(75)
    expect(exitCodeFor([{ status: 'PASS' }, { status: 'STALE' }])).toBe(4)
    expect(exitCodeFor([])).toBe(3)
  })
})

describe('meerkat batch (fake gate, real git)', () => {
  test('two clean branches: batch passes, both PASS, exit 0, one gate run, result file parses', async () => {
    calls.length = 0
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'clean2'])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^clean1: PASS/)
    expect(r.lines[1]).toMatch(/^clean2: PASS/)
    expect(calls).toHaveLength(1)
    const { file, doc } = resultOf(r.lines)
    expect(existsSync(file)).toBe(true)
    expect(readdirSync(join(logs, 'batches')).some((f) => f.endsWith('.tmp'))).toBe(false)
    expect(doc.schema).toBe(1)
    expect(doc.exitCode).toBe(0)
    expect(doc.base.sha).toBe(git(dir, 'rev-parse', 'main'))
    expect(doc.batchHeadSha).toMatch(/^[0-9a-f]{40}$/)
    expect(doc.prs.map((p: any) => [p.branch, p.status, p.headSha])).toEqual([['clean1', 'PASS', git(dir, 'rev-parse', 'clean1')], ['clean2', 'PASS', git(dir, 'rev-parse', 'clean2')]])
  })

  test('a failing branch is the culprit (BLOCKED, file and line), the clean ones are MERGEABLE after a fresh gate, exit 1', async () => {
    calls.length = 0
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'bad', 'clean2'])
    expect(r.code).toBe(1)
    const byBranch = Object.fromEntries(r.lines.filter((l) => /^(clean1|bad|clean2):/.test(l)).map((l) => [l.split(':')[0], l]))
    expect(byBranch.bad).toMatch(/BLOCKED culprit: fake-sqli .* at src\/new\.js:1/)
    expect(byBranch.clean1).toMatch(/MERGEABLE/)
    expect(byBranch.clean2).toMatch(/MERGEABLE/)
    // batch gate + 1 alone (the two clean branches are skipped, see batch-speed) + 1 re-gate (the base check was the injected devBaseline, not a gate run)
    expect(calls.filter((c) => c.only === null)).toHaveLength(2)
    expect(calls.filter((c) => c.only !== null)).toHaveLength(1) // clean1 and clean2 changed nothing where the batch failed, so only bad is checked alone
    expect(calls[calls.length - 1].hasBad).toBe(false) // the final gate ran on a batch without the culprit
    const { doc } = resultOf(r.lines)
    const bad = doc.prs.find((p: any) => p.branch === 'bad')
    expect(bad.status).toBe('BLOCKED')
    expect(bad.culprit).toBe(true)
    expect(bad.failingChecks[0]).toMatchObject({ check: 'fake-sqli', file: 'src/new.js', line: 1, alsoFailsOnBase: false })
    expect(doc.exitCode).toBe(1)
  })

  test('a check that also fails on the base is pre-existing: DEV-RED, nobody is blamed, exit 75', async () => {
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'bad'], { devBaseline: async () => true })
    expect(r.code).toBe(75)
    expect(r.lines.some((l) => /DEV-RED/.test(l))).toBe(true)
    expect(r.lines.some((l) => /BLOCKED/.test(l))).toBe(false)
  })

  test('a branch that conflicts with an earlier one is EXCLUDED and the rest continue', async () => {
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'conflict', 'clean2'])
    expect(r.code).toBe(0)
    expect(r.lines.find((l) => l.startsWith('conflict:'))).toMatch(/^conflict: EXCLUDED CONFLICT/)
    expect(r.lines.find((l) => l.startsWith('clean2:'))).toMatch(/PASS/)
    const { doc } = resultOf(r.lines)
    expect(doc.prs.find((p: any) => p.branch === 'conflict').status).toBe('EXCLUDED')
  })

  test('a missing branch is EXCLUDED not found', async () => {
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'nope'])
    expect(r.lines.find((l) => l.startsWith('nope:'))).toBe('nope: EXCLUDED not found')
    expect(r.code).toBe(0)
  })

  test('--dry-run prints the plan, runs no gate, writes no result file, exits 3 when any branch is refused', async () => {
    calls.length = 0
    const before = existsSync(join(logs, 'batches')) ? readdirSync(join(logs, 'batches')).length : 0
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'conflict', 'nope', '--dry-run'])
    // A refused branch is never a clean plan: exit 3 even in a dry run, so a script cannot read it as success.
    expect(r.code).toBe(3)
    expect(calls).toHaveLength(0)
    expect(r.lines[0]).toMatch(/^PLAN /)
    expect(r.lines.join('\n')).toMatch(/clean1: would be merged/)
    expect(r.lines.join('\n')).toMatch(/conflict: EXCLUDED CONFLICT/)
    expect(r.lines.join('\n')).toMatch(/nope: EXCLUDED not found/)
    const after = existsSync(join(logs, 'batches')) ? readdirSync(join(logs, 'batches')).length : 0
    expect(after).toBe(before)
  })

  test('the gate run cap stops the search: INCOMPLETE, exit 75, never a pass', async () => {
    const r = await run(['--base', 'main', '--app', dir, 'clean1', 'bad', 'clean2'], { env: { ...env, MEERKAT_BATCH_MAX_RUNS: '1' } }) // 1: the batch gate uses the only run (the skipped clean branches no longer use one up)
    expect(r.code).toBe(75)
    expect(r.lines.some((l) => /gate run limit reached/.test(l))).toBe(true)
  })

  test('a gate that does not finish is INCOMPLETE (75)', async () => {
    const r = await run(['--base', 'main', '--app', dir, 'clean1'], { gate: async () => ({ code: 75, verdict: 'INCOMPLETE', checks: [], reason: 'timed out' }) })
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^clean1: INCOMPLETE/)
  })

  test('a branch whose head moves while the batch runs is STALE (4)', async () => {
    git(dir, 'checkout', '-q', '-b', 'mover', 'main')
    put(dir, 'src/mover.js', 'export const m = 1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'mover 1')
    git(dir, 'checkout', '-q', 'main')
    const movingGate = async (...a: any[]) => {
      git(dir, 'checkout', '-q', 'mover')
      put(dir, 'src/mover.js', 'export const m = 2\n')
      git(dir, 'commit', '-q', '-am', 'mover 2')
      git(dir, 'checkout', '-q', 'main')
      return (fakeGate as any)(...a)
    }
    const r = await run(['--base', 'main', '--app', dir, 'mover'], { gate: movingGate })
    expect(r.code).toBe(4)
    expect(r.lines[0]).toMatch(/^mover: STALE/)
  })

  test('the user checkout is untouched and no temporary worktree is left behind', () => {
    expect(git(dir, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(git(dir, 'status', '--porcelain')).toBe('')
  })
})

describe('meerkat batch (real verdict gate)', () => {
  test('one clean and one bad branch end to end: bad is BLOCKED, clean is MERGEABLE', async () => {
    const lines: string[] = []
    const code = await runBatch(['--base', 'main', '--app', dir, 'clean1', 'bad'], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, devBaseline: noBaseFail })
    expect(lines.find((l) => l.startsWith('bad:'))).toMatch(/^bad: BLOCKED culprit: .* at src\/new\.js:\d+/)
    expect(lines.find((l) => l.startsWith('clean1:'))).toMatch(/MERGEABLE/)
    expect(code).toBe(1)
  }, 100_000)
})
