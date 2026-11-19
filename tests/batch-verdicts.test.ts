// meerkat batch: a failing batch with no single culprit gets a verdict (pre-existing or interaction), and the run limit names what it did not check.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchverd-'))
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
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
let dir: string
const names = Array.from({ length: 15 }, (_, i) => `b${String(i + 1).padStart(2, '0')}`)

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'src/base.js', 'export const base = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const n of names) {
    git(dir, 'checkout', '-q', '-b', n, 'main')
    put(dir, `src/${n}.js`, `export const ${n} = 1\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', n)
    git(dir, 'checkout', '-q', 'main')
  }
})

const resultOf = (lines: string[]) => JSON.parse(readFileSync(/result (.+)$/.exec(lines[lines.length - 1])![1], 'utf8'))
const failRow = (file: string | null) => ({ check: 'combo', status: 'fail', places: file ? [{ file, line: 1 }] : [], detail: 'combined failure' })
// Fails only when ALL the named src files are present together; the failing places name every one of them.
const needGate = (need: string[], calls: number[] = []) => async (checkout: string) => {
  calls.push(1)
  const all = need.every((f) => existsSync(join(checkout, 'src', f)))
  return all ? { code: 1, verdict: 'FAIL', reason: 'FAIL 1 blocking', checks: [{ check: 'combo', status: 'fail', places: need.map((f) => ({ file: `src/${f}`, line: 1 })), detail: 'combined failure' }] } : { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
}
const run = async (branches: string[], gate: any, devBaseline: any, extraEnv: Record<string, string> = {}) => {
  const lines: string[] = []
  const code = await runBatch(['--base', 'main', '--app', dir, ...branches], { env: { ...env, ...extraEnv }, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate, devBaseline })
  return { code, lines }
}

describe('no single culprit: pre-existing or interaction', () => {
  test('two branches fail only together: line 1 says interaction and names the pair', async () => {
    const r = await run(['b01', 'b02', 'b03', 'b04'], needGate(['b02.js', 'b04.js']), async () => false)
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^interaction: combo fails only when these branches are combined/)
    expect(r.lines[0]).toContain('b02')
    expect(r.lines[0]).toContain('b04')
    expect(r.lines[0]).not.toContain('b01')
    const doc = resultOf(r.lines)
    expect(doc.interaction).toMatchObject({ check: 'combo', branches: ['b02', 'b04'] })
  })

  test('the pair search stops after 10 extra gate runs and says no pair was found', async () => {
    const calls: number[] = []
    // Fails only with five branches together, so no pair reproduces it.
    const r = await run(['b01', 'b02', 'b03', 'b04', 'b05'], needGate(['b01.js', 'b02.js', 'b03.js', 'b04.js', 'b05.js'], calls), async () => false, { MEERKAT_BATCH_MAX_RUNS: '50' })
    expect(r.lines[0]).toMatch(/^interaction: combo fails only when these branches are combined/)
    expect(r.lines[0]).toMatch(/no pair/)
    // 1 batch gate + 5 alone + at most 10 pair runs
    expect(calls.length).toBeLessThanOrEqual(1 + 5 + 10)
  })

  test('the check also fails on the base: line 1 says pre-existing and names the base', async () => {
    const r = await run(['b01', 'b02', 'b03'], needGate(['b01.js', 'b03.js']), async () => true)
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^pre-existing: combo also fails on main, so the batch did not cause it/)
  })
})

describe('the run limit names what it did not check', () => {
  test('15 branches, MEERKAT_BATCH_MAX_RUNS=2: line 1 names the unchecked branches and the result is INCOMPLETE', async () => {
    // The failing place names no file, so no branch can be ruled out by path and every one needs its own run.
    const gate = async (checkout: string) => (existsSync(join(checkout, 'src', 'b15.js')) && existsSync(join(checkout, 'src', 'b01.js')) ? { code: 1, verdict: 'FAIL', reason: 'FAIL', checks: [failRow(null)] } : { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] })
    const r = await run(names, gate, async () => false, { MEERKAT_BATCH_MAX_RUNS: '2' })
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^INCOMPLETE: gate run limit reached \(2, MEERKAT_BATCH_MAX_RUNS\)/)
    expect(r.lines[0]).toMatch(/not checked/)
    expect(r.lines[0]).toMatch(/b0[2-9]/)
    expect(r.lines[0]).toMatch(/and \d+ more/)
    const doc = resultOf(r.lines)
    expect(doc.uncheckedBranches).toContain('b15')
  })
})
