// meerkat batch speed: per-branch gates in a pool, branches the failure cannot involve are skipped, the base side is reused per base commit.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { batchJobs, failingFiles, poolMap, runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchspeed-'))
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
let dir: string
let n = 0

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  for (const f of ['a', 'b', 'c', 'd']) put(dir, `src/${f}.js`, `export const ${f} = 1\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const f of ['a', 'b', 'c', 'd']) {
    git(dir, 'checkout', '-q', '-b', `feat-${f}`, 'main')
    put(dir, `src/${f}.js`, `export const ${f} = 2\n`)
    git(dir, 'commit', '-q', '-a', '-m', f)
    git(dir, 'checkout', '-q', 'main')
  }
})

// src/c.js is the failing place. Records every call and how many ran at once.
const make = () => {
  const calls: Array<{ only: string[] | null; strict: boolean; hasBad: boolean }> = []
  let live = 0
  let peak = 0
  const gate = async (checkout: string, o: { only?: string[] | null; strict?: boolean }) => {
    live += 1
    peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 40))
    live -= 1
    const bad = existsSync(join(checkout, 'src', 'c.js')) && require('node:fs').readFileSync(join(checkout, 'src', 'c.js'), 'utf8').includes('= 2')
    calls.push({ only: o.only ?? null, strict: !!o.strict, hasBad: bad })
    if (!bad) return { code: 0, verdict: 'PASS', reason: 'PASS', checks: o.only ? o.only.map((c) => ({ check: c, status: 'pass' })) : [] }
    return { code: 1, verdict: 'FAIL', reason: 'FAIL', checks: [{ check: 'fake-risky', status: 'fail', places: [{ file: 'src/c.js', line: 1 }], detail: 'bad' }] }
  }
  return { gate, calls, peak: () => peak }
}
const run = async (jobs: string | undefined, extraArgs: string[] = ['feat-a', 'feat-b', 'feat-c', 'feat-d']) => {
  n += 1
  const logs = join(root, `logs-${n}`)
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs, ...(jobs ? { MEERKAT_JOBS: jobs } : {}) } as Record<string, string>
  if (!jobs) delete env.MEERKAT_JOBS
  return { logs, env }
}
const batch = async (env: Record<string, string>, g: ReturnType<typeof make>, args = ['feat-a', 'feat-b', 'feat-c', 'feat-d']) => {
  const lines: string[] = []
  const code = await runBatch(['--base', 'main', '--app', dir, '--json', ...args], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate: g.gate })
  return { code, doc: JSON.parse(lines.join('\n')) }
}

describe('batch speed', () => {
  test('helpers: poolMap keeps input order and the limit; batchJobs follows MEERKAT_JOBS and the cpu default', async () => {
    let live = 0
    let peak = 0
    const out = await poolMap([30, 5, 20, 1, 10], 2, async (ms: number) => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, ms))
      live -= 1
      return ms
    })
    expect(out).toEqual([30, 5, 20, 1, 10])
    expect(peak).toBe(2)
    expect(batchJobs({ MEERKAT_JOBS: '1' }, 16)).toBe(1)
    expect(batchJobs({}, 16)).toBe(8)
    expect(batchJobs({}, 2)).toBe(2)
    expect(batchJobs({}, 1)).toBe(2)
    expect(failingFiles({ checks: [{ status: 'fail', places: [{ file: 'x.js' }] }] }, 'app')?.has('app/x.js')).toBe(true)
    expect(failingFiles({ checks: [{ status: 'fail', places: [] }] })).toBeNull()
  })

  test('(a) the culprit and the statuses are the same with MEERKAT_JOBS=1 and with the default pool', async () => {
    const one = make()
    const def = make()
    const r1 = await batch((await run('1', [])).env, one)
    const r2 = await batch((await run(undefined, [])).env, def)
    const view = (d: any) => d.prs.map((p: any) => [p.branch, p.status, p.culprit])
    expect(view(r1.doc)).toEqual(view(r2.doc))
    expect(view(r1.doc).find((x: any) => x[0] === 'feat-c')).toEqual(['feat-c', 'BLOCKED', true])
    expect(r1.code).toBe(r2.code)
    expect(r1.doc.gateRuns).toBe(r2.doc.gateRuns)
    expect(one.peak()).toBe(1)
  })

  test('(b) a second batch on the same base reads the stored base side and does not re-run it', async () => {
    const { env } = await run(undefined, [])
    const first = make()
    const r1 = await batch(env, first)
    expect(r1.doc.devBaseline).toMatchObject({ hit: false, source: 'devbaseline' })
    const baseRuns1 = first.calls.filter((c) => c.strict).length
    expect(baseRuns1).toBe(1)
    const second = make()
    const r2 = await batch(env, second)
    expect(r2.doc.devBaseline).toMatchObject({ hit: true })
    expect(second.calls.filter((c) => c.strict)).toHaveLength(0)
    expect(r2.doc.prs.map((p: any) => [p.branch, p.status])).toEqual(r1.doc.prs.map((p: any) => [p.branch, p.status]))
  })

  test('(c) a branch whose changed files are not where the batch failed is skipped, with the reason in the JSON', async () => {
    const g = make()
    const { env } = await run(undefined, [])
    const { doc } = await batch(env, g)
    const alone = g.calls.filter((c) => c.only !== null && !c.strict)
    expect(alone).toHaveLength(1) // only feat-c
    expect(doc.perBranchSkipped.map((s: any) => s.branch).sort()).toEqual(['feat-a', 'feat-b', 'feat-d'])
    for (const p of doc.prs.filter((x: any) => x.branch !== 'feat-c')) {
      expect(p.skippedAlone).toBe(true)
      expect(p.reason).toMatch(/MERGEABLE-AFTER-RECHECK|not checked alone/)
    }
    expect(doc.perBranchSkipped[0].reason).toMatch(/none of its 1 changed file/)
    expect(doc.prs.find((p: any) => p.branch === 'feat-c').skippedAlone).toBe(false)
  })
})
