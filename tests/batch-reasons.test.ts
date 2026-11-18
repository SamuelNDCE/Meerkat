// batch exit 3 names each branch that was not judged and why; a batch stopped by the run limit still writes a verdict per branch.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchreasons-'))
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
const envFor = (extra: Record<string, string> = {}) => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, `logs${(n += 1)}`), ...extra })

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'src/base.js', 'export const base = 1\n')
  put(dir, 'src/shared.js', 'export const shared = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const b of ['feat-a', 'feat-b', 'feat-c']) {
    git(dir, 'checkout', '-q', '-b', b, 'main')
    put(dir, `src/${b}.js`, b === 'feat-b' ? 'export const planted = 1 // PLANTED\n' : `export const ${b.replace('-', '_')} = 1\n`)
    if (b === 'feat-c') put(dir, 'src/shared.js', 'export const shared = 3\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', b)
    git(dir, 'checkout', '-q', 'main')
  }
  // the base moves on and touches the same file as feat-c
  put(dir, 'src/shared.js', 'export const shared = 2\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base moves')
})

const gate = async (checkout: string) =>
  existsSync(join(checkout, 'src', 'feat-b.js'))
    ? { code: 1, verdict: 'FAIL', reason: 'FAIL 1 blocking', checks: [{ check: 'planted', status: 'fail', places: [{ file: 'src/feat-b.js', line: 1 }], detail: 'planted finding' }] }
    : { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
const run = async (argv: string[], extra: Record<string, string> = {}) => {
  const lines: string[] = []
  const env = envFor(extra)
  const code = await runBatch(['--base', 'main', '--app', dir, ...argv], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate, devBaseline: async () => false })
  return { code, lines, env }
}

describe('batch exit 3 and the stopped path', () => {
  test('a dry run with a branch that conflicts with the base exits 3 and names it with the conflict reason', async () => {
    const r = await run(['--dry-run', 'feat-a', 'feat-b', 'feat-c'])
    expect(r.code).toBe(3)
    const text = r.lines.join('\n')
    expect(text).toMatch(/feat-c[^\n]*conflict/i)
    expect(text).toMatch(/exit 3[^\n]*feat-c/i)
  })

  test('a run limit that stops after the first branch writes a verdict per branch in summary.json and line 1 says stopped', async () => {
    const r = await run(['--split', 'feat-a', 'feat-b'], { MEERKAT_BATCH_MAX_RUNS: '1' })
    expect(r.lines[0]).toMatch(/stopped/i)
    const folder = /logs (.+?)(?: \||$)/.exec(r.lines[0])![1]
    const doc = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'))
    expect(doc.branches.map((b: any) => b.branch)).toEqual(['feat-a', 'feat-b'])
    for (const b of doc.branches) {
      expect(['PASS', 'FAIL', 'NO-RESULT']).toContain(b.verdict)
      if (b.verdict === 'NO-RESULT') expect(b.reason).toMatch(/run limit/)
    }
    expect(doc.stopped).toMatchObject({ reason: expect.stringMatching(/run limit/) })
  })

  test('a run limit that judges the first branch keeps its verdict and the rest read NO-RESULT with the reason', async () => {
    const r = await run(['--split', 'feat-a', 'feat-b'], { MEERKAT_BATCH_MAX_RUNS: '2' })
    expect(r.lines[0]).toMatch(/stopped/i)
    const folder = /logs (.+?)(?: \||$)/.exec(r.lines[0])![1]
    const doc = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8'))
    const by = Object.fromEntries(doc.branches.map((b: any) => [b.branch, b]))
    expect(by['feat-a'].verdict).toBe('PASS')
    expect(by['feat-b'].verdict).toBe('NO-RESULT')
    expect(by['feat-b'].reason).toMatch(/run limit/)
  })
})
