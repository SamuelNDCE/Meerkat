// meerkat batch: a check whose tool crashed, hung or did not start is named (id and reason) in the result file and on the first line.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchcrash-'))
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

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'src/base.js', 'export const base = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const n of ['one', 'two']) {
    git(dir, 'checkout', '-q', '-b', n, 'main')
    put(dir, `src/${n}.js`, `export const ${n} = 1\n`)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', n)
    git(dir, 'checkout', '-q', 'main')
  }
})

const resultOf = (lines: string[]) => JSON.parse(readFileSync(/result (.+)$/.exec(lines[lines.length - 1])![1], 'utf8'))
const run = async (rows: any[]) => {
  const lines: string[] = []
  const gate = async () => ({ code: 75, verdict: 'INCOMPLETE', reason: `${rows.length} check(s) crashed or their tool failed`, checks: rows })
  const code = await runBatch(['--base', 'main', '--app', dir, 'one', 'two'], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate, devBaseline: async () => false })
  return { code, lines }
}

describe('crashed checks are named', () => {
  test('one crashed check: the JSON lists it with its reason and line 1 names its id', async () => {
    const r = await run([
      { check: 'actionlint', status: 'crash', detail: 'exit 127: actionlint is not installed', places: [] },
      { check: 'rust-test', status: 'pass', detail: '', places: [] },
    ])
    expect(r.code).toBe(75)
    const doc = resultOf(r.lines)
    expect(doc.crashedChecks).toEqual([{ id: 'actionlint', reason: 'exit 127: actionlint is not installed' }])
    expect(r.lines[0]).toContain('actionlint')
    expect(r.lines[0]).toMatch(/crashed/)
  })

  test('a hung check counts too, and a long list is cut at 5 with "and N more"', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ check: `tool-${i}`, status: i === 0 ? 'hang' : 'crash', detail: `boom ${i}`, places: [] }))
    const r = await run(rows)
    const doc = resultOf(r.lines)
    expect(doc.crashedChecks).toHaveLength(8)
    expect(doc.crashedChecks[0]).toEqual({ id: 'tool-0', reason: 'boom 0' })
    expect(r.lines[0]).toContain('tool-4')
    expect(r.lines[0]).not.toContain('tool-5')
    expect(r.lines[0]).toMatch(/and 3 more/)
  })

  test('no crash: crashedChecks is an empty list and no crash line is printed', async () => {
    const lines: string[] = []
    const code = await runBatch(['--base', 'main', '--app', dir, 'one'], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate: async () => ({ code: 0, verdict: 'PASS', checks: [], reason: 'PASS' }), devBaseline: async () => false })
    expect(code).toBe(0)
    expect(resultOf(lines).crashedChecks).toEqual([])
    expect(lines[0]).toMatch(/^one: /)
  })
})
