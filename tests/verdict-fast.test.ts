// `meerkat verdict` skips the work that cannot change the answer, and the answer stays the same:
// (a) the findings are identical with the cache on and off, (b) a changed file is judged again (not served from the cache),
// (c) a base result is worked out once per base commit and reused by another branch cut from it, (d) a planted finding on the head is reported as new.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-ignore: plain ES module
import { hideBaseFindings } from '../lib/newfindings.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-vfast-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return String(r.stdout).trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
let logs = 0
const cli = (args: string[], cwd: string, home: string) => {
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: home }
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 170_000, maxBuffer: 64 << 20 })
  return { code: r.status, json: JSON.parse(String(r.stdout)) }
}
const freshHome = () => join(root, `home-${logs++}`)
// The answer without timings, run-folder paths or cache flags.
const answer = (j: any) => ({ verdict: j.verdict, exitCode: j.exitCode, blocking: j.blocking, preExisting: j.preExisting, blocks: j.blocks, filesJudged: j.filesJudged, baseState: j.baseState, checks: j.checks.map((c: any) => ({ check: c.check, status: c.status, places: c.places })) })

let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'dev')
  put(repo, 'meerkat.config.json', JSON.stringify({ packs: ['security'], discover: false, disable: ['typos', 'yamllint', 'shellcheck', 'hadolint', 'actionlint', 'eslint', 'prettier'] }))
  put(repo, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(repo, 'src/legacy.js', 'export function legacy(s) {\n  return eval(s)\n}\n')
  put(repo, 'src/a.js', 'export const a = (x) => x + 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
  git(repo, 'checkout', '-q', '-b', 'feat')
  put(repo, 'src/a.js', 'export const a = (x) => x + 1\nexport const b = 2\n')
  git(repo, 'commit', '-q', '-am', 'feat')
}, 60_000)

const VERDICT = ['verdict', '--base', 'origin/dev', '--json', '--only-checks', 'risky-code,secrets-in-source']

describe('verdict: same answer, less work', () => {
  test('(a) the findings are identical with the cache on (cold, then warm) and off', () => {
    const home = freshHome()
    const cold = cli(VERDICT, repo, home)
    const warm = cli(VERDICT, repo, home)
    const off = cli([...VERDICT, '--no-cache'], repo, freshHome())
    expect(answer(warm.json)).toEqual(answer(cold.json))
    expect(answer(off.json)).toEqual(answer(cold.json))
    expect(cold.json.preExisting).toBeGreaterThan(0) // the eval on the base is listed as pre-existing, not as a block
    expect(cold.json.blocking).toBe(0)
    expect(warm.json.checks.every((c: any) => c.cached)).toBe(true)
    expect(off.json.checks.some((c: any) => c.cached)).toBe(false)
  }, 300_000)

  test('(b) a changed file is judged again, not served from the cache', () => {
    const home = freshHome()
    cli(VERDICT, repo, home)
    const same = cli(VERDICT, repo, home)
    expect(same.json.checks.every((c: any) => c.cached)).toBe(true)
    put(repo, 'src/a.js', 'export const a = (x) => x + 1\nexport const b = 2\nexport const c = (s) => eval(s)\n')
    git(repo, 'commit', '-q', '-am', 'edit')
    const edited = cli(VERDICT, repo, home)
    expect(edited.json.checks.some((c: any) => !c.cached)).toBe(true)
    expect(edited.json.checks.find((c: any) => c.check === 'risky-code')?.cached).toBe(false)
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')
  }, 300_000)

  test('(d) a planted finding on the head is reported as new, and the cache does not hide it', () => {
    const home = freshHome()
    cli(VERDICT, repo, home) // warms the base result
    git(repo, 'checkout', '-q', '-b', 'planted')
    put(repo, 'src/new.js', 'export const run = (s) => eval(s)\n')
    git(repo, 'add', 'src/new.js')
    git(repo, 'commit', '-q', '-m', 'planted')
    const warm = cli(VERDICT, repo, home)
    const off = cli([...VERDICT, '--no-cache'], repo, freshHome())
    expect(warm.json.blocking).toBeGreaterThan(0)
    expect(warm.json.verdict).toBe('FAIL')
    expect(JSON.stringify(warm.json.blocks)).toContain('src/new.js')
    expect(answer(warm.json)).toEqual(answer(off.json))
    git(repo, 'checkout', '-q', 'feat')
  }, 300_000)
})

describe('the base side is worked out once per base commit', () => {
  const mk = () => {
    const dir = join(root, `unit-${logs++}`)
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'dev')
    put(dir, 'a.js', 'one\nBAD old\nthree\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    return { dir, mb: git(dir, 'rev-parse', 'HEAD') }
  }
  const outOf = (extra: any[]) => ({ files: ['a.js'], rows: [{ id: 'c1', kind: 'fail', detail: 'x', places: [{ file: 'a.js', line: 2, message: 'bad' }, ...extra] }], exitCode: 1 })
  const cacheOf = (store: any) => ({ entries: store, env: {}, version: 'v1', maxAgeMs: 1e12, save: (fresh: any[]) => { for (const f of fresh) store[f.key] = { id: f.id, at: new Date().toISOString(), identities: f.identities } } })
  const fakeBase = (calls: string[]) => async (wt: string, _app: string, _files: string[], ids: string[]) => {
    calls.push(ids.join(','))
    return { rows: [{ id: 'c1', kind: 'fail', places: [{ file: 'a.js', line: 2, message: 'bad' }] }] }
  }

  test('(c) a second branch on the same base commit reuses the base result (one base run, same answer)', async () => {
    const { dir, mb } = mk()
    const store: any = {}
    const calls: string[] = []
    const branchOut = (n: number) => {
      git(dir, 'checkout', '-q', '-B', `b${n}`, mb)
      put(dir, 'a.js', `one\nBAD old\nthree\nfour${n}\n`)
      git(dir, 'commit', '-q', '-am', `b${n}`)
      return outOf([{ file: 'a.js', line: 4, message: 'new' }])
    }
    const plain = branchOut(1)
    const r1 = await hideBaseFindings({ out: structuredClone(plain), mb, repoRoot: dir, appDir: dir, runBase: fakeBase([]), baseCache: null })
    const o1: any = branchOut(1)
    await hideBaseFindings({ out: o1, mb, repoRoot: dir, appDir: dir, runBase: fakeBase(calls), baseCache: cacheOf(store) })
    const o2: any = branchOut(1) // another branch, same base commit and same changed file
    await hideBaseFindings({ out: o2, mb, repoRoot: dir, appDir: dir, runBase: fakeBase(calls), baseCache: cacheOf(store) })
    expect(r1.ok).toBe(true)
    expect(calls).toEqual(['c1']) // the second run served the base from the cache
    expect(o2.hidden).toBe(1)
    expect(o2.rows[0].places.map((p: any) => p.line)).toEqual([4]) // the pre-existing place is hidden, the new one stays
    expect(o2.rows[0].places).toEqual(o1.rows[0].places)
  }, 60_000)

  test('a check whose failing places are all on lines the branch touched is not run on the base at all', async () => {
    const { dir, mb } = mk()
    git(dir, 'checkout', '-q', '-b', 'edit')
    put(dir, 'a.js', 'one\nBAD changed\nthree\n')
    git(dir, 'commit', '-q', '-am', 'touch line 2')
    const calls: string[] = []
    const out: any = outOf([])
    await hideBaseFindings({ out, mb, repoRoot: dir, appDir: dir, runBase: fakeBase(calls), baseCache: cacheOf({}) })
    expect(calls).toEqual([])
    expect(out.rows[0].places.length).toBe(1)
  }, 60_000)
})
