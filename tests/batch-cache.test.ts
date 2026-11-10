// Dev-baseline cache: a base check that answered "notrun" (it could not judge a diff-less base) is stored as NO ANSWER for that base sha,
// is not re-run on a second batch on the same sha, and is never read as a pass. A changed base sha starts over.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch } from '../lib/batch.mjs'
import { baselineFile, devBaselineFor, readBaseline, writeBaseline } from '../lib/devbaseline.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-batchcache-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
let dir: string
let n = 0

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  for (const f of ['a', 'c']) writeFileSync(join(dir, `${f}.js`), `export const ${f} = 1\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  for (const f of ['a', 'c']) {
    git(dir, 'checkout', '-q', '-b', `feat-${f}`, 'main')
    writeFileSync(join(dir, `${f}.js`), `export const ${f} = 2\n`)
    git(dir, 'commit', '-q', '-a', '-m', f)
    git(dir, 'checkout', '-q', 'main')
  }
})

// c.js is bad. The strict run on the diff-less base answers with NO row for the check, i.e. "notrun".
const make = () => {
  const calls: Array<{ strict: boolean }> = []
  const gate = async (checkout: string, o: { only?: string[] | null; strict?: boolean }) => {
    calls.push({ strict: !!o.strict })
    if (o.strict) return { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
    const bad = readFileSync(join(checkout, 'c.js'), 'utf8').includes('= 2')
    if (!bad) return { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
    return { code: 1, verdict: 'FAIL', reason: 'FAIL', checks: [{ check: 'fake-risky', status: 'fail', places: [{ file: 'c.js', line: 1 }], detail: 'bad' }] }
  }
  return { gate, calls, baseRuns: () => calls.filter((c) => c.strict).length }
}
const batch = async (env: Record<string, string>, g: ReturnType<typeof make>) => {
  const lines: string[] = []
  const code = await runBatch(['--base', 'main', '--app', dir, '--json', 'feat-a', 'feat-c'], { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {}, gate: g.gate })
  return { code, doc: JSON.parse(lines.join('\n')) }
}
const freshEnv = () => {
  n += 1
  return { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, `data-${n}`) } as Record<string, string>
}

describe('batch dev-baseline cache', () => {
  test('(a) a stored notrun is never reused as a pass, and is not re-run; a stored unknown is re-run', async () => {
    const dataDir = join(root, 'store-a')
    const sha = git(dir, 'rev-parse', 'main')
    writeBaseline(baselineFile(dataDir, 'repo', sha), { schema: 1, baseSha: sha, checks: { x: 'notrun', y: 'unknown', z: 'pass' }, fails: [] })
    let asked: string[] | null = null
    const doc = await devBaselineFor(dir, 'main', ['x', 'y', 'z'], { dataDir, runChecks: async (ids: string[]) => { asked = ids; return { y: 'pass' } } })
    expect(asked).toEqual(['y']) // x (no answer) is not asked again, y (transient) is
    expect(doc.checks.x).toBe('notrun')
    expect(doc.unknownIds).toEqual(['x']) // no answer is never a pass
    expect(doc.checks.x).not.toBe('pass')
    // end to end: the base side has no answer, so the culprit is still blamed and nothing is called DEV-RED or passed because of it
    const env = freshEnv()
    const r = await batch(env, make())
    expect(r.doc.prs.find((p: any) => p.branch === 'feat-c')).toMatchObject({ status: 'BLOCKED', culprit: true })
    expect(r.doc.note ?? '').not.toMatch(/DEV-RED/)
    expect(readBaseline(baselineFile(env.MEERKAT_LOG_DIR, 'repo', r.doc.base.sha))?.checks['fake-risky']).toBe('notrun')
  })

  test('(b) a second batch on the same base sha reports hit true and runs zero base checks', async () => {
    const env = freshEnv()
    const first = make()
    const r1 = await batch(env, first)
    expect(r1.doc.devBaseline).toMatchObject({ hit: false })
    expect(first.baseRuns()).toBe(1)
    const second = make()
    const r2 = await batch(env, second)
    expect(r2.doc.devBaseline).toMatchObject({ hit: true, sha: r1.doc.base.sha })
    expect(second.baseRuns()).toBe(0)
    expect(r2.doc.prs.map((p: any) => [p.branch, p.status, p.culprit])).toEqual(r1.doc.prs.map((p: any) => [p.branch, p.status, p.culprit]))
    expect(r2.code).toBe(r1.code)
  })

  test('(c) a changed base sha invalidates the stored answer', async () => {
    const env = freshEnv()
    const r1 = await batch(env, make())
    expect(r1.doc.devBaseline.hit).toBe(false)
    git(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, 'unrelated.txt'), 'x\n')
    git(dir, 'add', 'unrelated.txt')
    git(dir, 'commit', '-q', '-m', 'move main')
    const g = make()
    const r2 = await batch(env, g)
    expect(r2.doc.base.sha).not.toBe(r1.doc.base.sha)
    expect(r2.doc.devBaseline.hit).toBe(false)
    expect(g.baseRuns()).toBe(1)
  })
})
