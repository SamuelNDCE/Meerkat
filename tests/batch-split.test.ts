// meerkat batch --split: the union is gated once; when it fails the branches are bisected until each one has a verdict.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { parseBatchArgs, runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchsplit-'))
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
const envFor = () => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, `logs${(n += 1)}`) })

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'src/base.js', 'export const base = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const b of ['feat-a', 'feat-b', 'feat-c']) {
    git(dir, 'checkout', '-q', '-b', b, 'main')
    put(dir, `src/${b}.js`, b === 'feat-b' ? 'export const planted = 1 // PLANTED\n' : `export const ${b.replace('-', '_')} = 1\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', b)
    git(dir, 'checkout', '-q', 'main')
  }
})

// Fails (one finding) when feat-b is in the checkout.
const calls: string[] = []
const gate = async (checkout: string) => {
  calls.push(checkout)
  const bad = existsSync(join(checkout, 'src', 'feat-b.js'))
  return bad ? { code: 1, verdict: 'FAIL', reason: 'FAIL 1 blocking', checks: [{ check: 'planted', status: 'fail', places: [{ file: 'src/feat-b.js', line: 1 }], detail: 'planted finding' }] } : { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
}
const run = async (argv: string[], g: any = gate) => {
  const lines: string[] = []
  calls.length = 0
  const env = envFor()
  const code = await runBatch(['--base', 'main', '--app', dir, ...argv], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate: g, devBaseline: async () => false })
  return { code, lines, env }
}

describe('batch --split', () => {
  test('parseBatchArgs accepts --split', () => {
    expect(parseBatchArgs(['--base', 'main', '--split', 'a', 'b'])).toMatchObject({ split: true, branches: ['a', 'b'] })
    expect(parseBatchArgs(['--base', 'main', 'a'])).toMatchObject({ split: false })
  })

  test('a verdict per branch: the planted branch FAILs, the others PASS, line 1 has the format', async () => {
    const r = await run(['--split', 'feat-a', 'feat-b', 'feat-c'])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^BATCH FAIL base [0-9a-f]{12} \| blocking 1 \| logs .+/)
    const row = (b: string) => r.lines.find((l) => l.startsWith(`${b} `)) ?? ''
    expect(row('feat-a')).toMatch(/^feat-a [0-9a-f]{12} PASS 0 /)
    expect(row('feat-c')).toMatch(/^feat-c [0-9a-f]{12} PASS 0 /)
    expect(row('feat-b')).toMatch(/^feat-b [0-9a-f]{12} FAIL 1 planted branch-only/)
    // union once, then bisect: at most ceil(log2 N) + 1 extra runs
    expect(calls.length - 1).toBeLessThanOrEqual(Math.ceil(Math.log2(3)) + 1)
  })

  test('summary.json in the logs folder has the same counts as line 1', async () => {
    const r = await run(['--split', 'feat-a', 'feat-b', 'feat-c'])
    const folder = /logs (.+)$/.exec(r.lines[0])![1]
    const sum = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'))
    expect(sum.verdict).toBe('FAIL')
    expect(sum.blocking).toBe(1)
    expect(sum.branches.map((b: any) => b.verdict)).toEqual(['PASS', 'FAIL', 'PASS'])
    expect(sum.branches.reduce((s: number, b: any) => s + b.blocking, 0)).toBe(sum.blocking)
  })

  test('a passing union is one gate run and every branch is PASS', async () => {
    const r = await run(['--split', 'feat-a', 'feat-c'])
    expect(r.code).toBe(0)
    expect(r.lines[0]).toMatch(/^BATCH PASS base [0-9a-f]{12} \| blocking 0 \| logs /)
    expect(calls.length).toBe(1)
    expect(r.lines.filter((l) => / PASS 0 /.test(l)).length).toBe(2)
  })

  test('a repeat run reuses cached results for identical file contents', async () => {
    const env = envFor()
    const go = async () => {
      calls.length = 0
      const lines: string[] = []
      await runBatch(['--base', 'main', '--app', dir, '--split', 'feat-a', 'feat-b', 'feat-c'], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate, devBaseline: async () => false })
      return { lines, n: calls.length }
    }
    const first = await go()
    const second = await go()
    expect(first.n).toBeGreaterThan(1)
    expect(second.n).toBe(0)
    expect(second.lines[0]).toMatch(/^BATCH FAIL .*blocking 1/)
  })
})
