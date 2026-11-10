// meerkat batch, fewer git calls: one diff per branch, refs resolved in one call, same answers as before; batch.log records every branch.
import * as cp from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { runBatch } from '../lib/batch.mjs'

// A fake spawn wrapper: counts every `git` spawn while `counter.on` is set.
const counter = vi.hoisted(() => ({ on: false, n: 0 }))
vi.mock('node:child_process', async (orig) => {
  const real: any = await orig()
  return {
    ...real,
    spawnSync: (cmd: string, ...rest: unknown[]) => {
      if (counter.on && cmd === 'git') counter.n += 1
      return real.spawnSync(cmd, ...rest)
    },
  }
})

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchfast-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = cp.spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
let dir: string
let n = 0
const branch = (name: string, files: Record<string, string>) => {
  git(dir, 'checkout', '-q', '-b', name, 'main')
  for (const [f, body] of Object.entries(files)) put(dir, f, body)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', name)
  git(dir, 'checkout', '-q', 'main')
}

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  for (let i = 1; i <= 12; i++) put(dir, `src/m${i}.js`, `export const m${i} = ${i}\n`)
  put(dir, 'src/shared.js', 'export const shared = 0\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (let i = 1; i <= 6; i++) branch(`clean-${i}`, { [`src/m${i}.js`]: `export const m${i} = 100\n` })
  branch('ok-1', { 'src/m7.js': 'export const m7 = 70\n' })
  branch('culprit', { 'src/bad.js': 'export const x = 1 // EVIL\n' })
  branch('shared-1', { 'src/shared.js': 'export const shared = 1\n' })
  branch('shared-2', { 'src/shared.js': 'export const shared = 2\n' })
  branch('ok-2', { 'src/m8.js': 'export const m8 = 80\n' })
  branch('big', { 'src/big.js': Array.from({ length: 100 }, (_, i) => `export const v${i} = ${i}\n`).join('') })
})

// Fails when src/bad.js holds EVIL, naming that file; passes otherwise.
const gate = async (checkout: string, o: { only?: string[] | null }) => {
  await new Promise((r) => setTimeout(r, 15))
  const bad = join(checkout, 'src', 'bad.js')
  if (existsSync(bad) && readFileSync(bad, 'utf8').includes('EVIL')) return { code: 1, verdict: 'FAIL', reason: 'FAIL', checks: [{ check: 'risky-code', status: 'fail', places: [{ file: 'src/bad.js', line: 1 }], detail: 'EVIL' }] }
  return { code: 0, verdict: 'PASS', reason: 'PASS', checks: o.only ? o.only.map((c) => ({ check: c, status: 'pass' })) : [] }
}
const batch = async (args: string[], extraEnv: Record<string, string> = {}) => {
  n += 1
  const logs = join(root, `logs-${n}`)
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs, ...extraEnv } as Record<string, string>
  const lines: string[] = []
  const code = await runBatch(['--base', 'main', '--app', dir, '--json', ...args], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate })
  return { code, doc: JSON.parse(lines.join('\n')), logs }
}

describe('batch fast', () => {
  test('(a) git spawns per branch: at most 2 (one diff, one merge), the rest is a fixed cost', async () => {
    const count = async (names: string[]) => {
      counter.n = 0
      counter.on = true
      const r = await batch(names)
      counter.on = false
      expect(r.doc.prs.every((p: any) => p.status === 'PASS')).toBe(true)
      return counter.n
    }
    const two = await count(['clean-1', 'clean-2'])
    const six = await count(['clean-1', 'clean-2', 'clean-3', 'clean-4', 'clean-5', 'clean-6'])
    expect((six - two) / 4).toBeLessThanOrEqual(2)
    expect(two).toBeLessThanOrEqual(2 * 2 + 10)
  })

  test('(b) a culprit, a conflict and a too-big branch give the same JSON answer as before', async () => {
    const r = await batch(['ok-1', 'culprit', 'shared-1', 'shared-2', 'big', 'ok-2', '--max-lines', '50'], { MEERKAT_JOBS: '2' })
    const view = r.doc.prs.map((p: any) => [p.branch, p.status, p.culprit, p.reason])
    expect(view).toEqual([
      ['ok-1', 'MERGEABLE', false, 'MERGEABLE-AFTER-RECHECK: the batch without the culprit passed a fresh gate'],
      ['culprit', 'BLOCKED', true, 'culprit: risky-code fails on this branch alone at src/bad.js:1: EVIL'],
      ['shared-1', 'MERGEABLE', false, 'MERGEABLE-AFTER-RECHECK: the batch without the culprit passed a fresh gate'],
      ['shared-2', 'EXCLUDED', false, expect.stringMatching(/^CONFLICT while merging into the batch/)],
      ['big', 'EXCLUDED', false, 'too big (100 changed lines, limit 50)'],
      ['ok-2', 'MERGEABLE', false, 'MERGEABLE-AFTER-RECHECK: the batch without the culprit passed a fresh gate'],
    ])
    expect(r.code).toBe(1)
    expect(r.doc.gateRuns).toBe(3)
    expect(r.doc.perBranchSkipped.map((s: any) => s.branch)).toEqual(['ok-1', 'shared-1', 'ok-2'])
    expect(r.doc.perBranchSkipped[0].reason).toBe('none of its 1 changed file(s) is where the batch failed (src/bad.js)')
  })

  test('(c) a branch above --max-lines is excluded with the same reason as before', async () => {
    const r = await batch(['clean-1', 'big', '--max-lines', '50'])
    const big = r.doc.prs.find((p: any) => p.branch === 'big')
    expect(big).toMatchObject({ status: 'EXCLUDED', reason: 'too big (100 changed lines, limit 50)' })
    expect(r.doc.prs.find((p: any) => p.branch === 'clean-1').status).toBe('PASS')
  })

  test('batch.log has a start and a finish line for every branch, and the summary matches the events', async () => {
    const r = await batch(['ok-1', 'culprit', 'shared-1', 'ok-2'], { MEERKAT_JOBS: '2' })
    const file = join(r.logs, 'batches', r.doc.batchId, 'batch.log')
    expect(existsSync(file)).toBe(true)
    const body = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^\S+ /, ''))
    for (const b of ['ok-1', 'culprit', 'shared-1', 'ok-2']) {
      expect(body.filter((l) => l.startsWith(`start ${b} `))).toHaveLength(1)
      expect(body.filter((l) => l.startsWith(`finish ${b} `))).toHaveLength(1)
    }
    expect(body.some((l) => l.startsWith('pool size=2'))).toBe(true)
    // replay the events: busy goes up on a pool start and down on a pool finish
    let busy = 0
    let max = 0
    let sum = 0
    const pool = new Set(body.filter((l) => /^start \S+ busy=/.test(l)).map((l) => l.split(' ')[1]))
    for (const l of body) {
      const m = /^(start|finish) (\S+)/.exec(l)
      if (!m || !pool.has(m[2])) continue
      if (m[1] === 'start') max = Math.max(max, ++busy)
      else {
        busy -= 1
        sum += Number(/seconds=([\d.]+)/.exec(l)?.[1])
      }
    }
    const s = body.find((l) => l.startsWith('summary '))!
    const num = (k: string) => Number(new RegExp(`${k}=([\\d.]+)`).exec(s)?.[1])
    expect(num('max-parallel')).toBe(max)
    expect(max).toBeLessThanOrEqual(2)
    expect(Math.abs(num('busy-slot-seconds') - sum)).toBeLessThan(0.05 * pool.size + 0.05)
    expect(Math.abs(num('idle-slot-seconds') + num('busy-slot-seconds') - 2 * num('pool-seconds'))).toBeLessThan(0.05)
  })
})
