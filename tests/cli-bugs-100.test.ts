// 1.0.0 CLI bug hunt (B1 to B10). Every test runs the real CLI (bin/meerkat.mjs) on a fixture repo.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-bugs100-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const cli = join(__dirname, '..', 'bin', 'meerkat.mjs')
const envFor = (logs: string) => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, logs), NO_COLOR: '1' }) as NodeJS.ProcessEnv
const meerkat = (cwd: string, logs: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: envFor(logs), encoding: 'utf8', timeout: 170_000 })
  return { code: r.status, out: r.stdout.replace(/\r/g, ''), err: r.stderr.replace(/\r/g, '') }
}
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : [])
let dir: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, '.gitignore', 'logs\n')
  put(dir, 'src/old.js', bug('oldBug'))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'feat')
  put(dir, 'src/new.js', bug('newBug'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'branch')
})

describe('B1 B2 B3: verdict --branches and the JSON schema', () => {
  test('--branches gives the plain verdict, prints the base line, and --json is one valid JSON document with schema 1', () => {
    const plain = meerkat(dir, 'logs-b1', 'verdict')
    expect(plain.out.split('\n')[0]).toBe('FAIL 1 blocking in changed files [422]')
    const batch = meerkat(dir, 'logs-b1', 'verdict', '--branches', 'feat')
    expect(batch.out.split('\n')[0]).toBe('feat: FAIL 1 blocking in changed files [422]')
    expect(batch.code).toBe(1)
    expect(batch.err).toMatch(/^feat: base [0-9a-f]{12} \(main\)$/m)
    const j = meerkat(dir, 'logs-b1', 'verdict', '--branches', 'feat', '--json')
    const doc = JSON.parse(j.out) // the whole of stdout, no `feat: ` prefix
    expect(doc).toMatchObject({ schema: 1, branch: 'feat', verdict: 'FAIL', blocking: 1, base: { ref: 'main' } })
    expect(j.code).toBe(1)
    const many = JSON.parse(meerkat(dir, 'logs-b1', 'verdict', '--branches', 'feat,nope', '--json').out)
    expect(many.map((d: { branch: string }) => d.branch)).toEqual(['feat', 'nope'])
    expect(many.every((d: { schema: number }) => d.schema === 1)).toBe(true)
  }, 180_000)
  test('plain verdict --json has schema 1, also when the branch has nothing to judge', () => {
    expect(JSON.parse(meerkat(dir, 'logs-b1', 'verdict', '--json').out).schema).toBe(1)
    git(dir, 'checkout', '-q', 'main')
    const same = meerkat(dir, 'logs-b1', 'verdict', '--json')
    git(dir, 'checkout', '-q', 'feat')
    expect(JSON.parse(same.out)).toMatchObject({ schema: 1, verdict: 'PASS' })
  }, 180_000)
})

describe('B4 B5: unknown options stop the small commands (exit 2, usage line, nothing written)', () => {
  test('baseline --bogus writes no baseline', () => {
    const r = meerkat(dir, 'logs-b4', 'baseline', '--bogus')
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/unknown option --bogus\nusage: meerkat baseline/)
    expect(walk(join(root, 'logs-b4')).some((f) => /baseline/i.test(f))).toBe(false)
  })
  test.each(['last', 'logs', 'commands', 'trend', 'suggest', 'pr-comment', 'describe', 'bug', 'ps'])('%s --bogus exits 2 with its usage line', (word) => {
    const r = meerkat(dir, 'logs-b5', word, '--bogus')
    expect(r.code).toBe(2)
    expect(r.err).toContain(`meerkat ${word}: unknown option --bogus`)
    expect(r.err).toContain('usage: meerkat')
    expect(r.out).toBe('')
  })
  test('the known options still work', () => {
    expect(meerkat(dir, 'logs-b5', 'commands', '--json').code).toBe(0)
    expect(meerkat(dir, 'logs-b5', 'ps', '--kill').code).toBe(0)
  })
})

describe('B6: --json on top and ps', () => {
  test('top --json prints JSON with schema 1; ps --json prints JSON', () => {
    const t = meerkat(dir, 'logs-b6', 'top', '--json')
    const doc = JSON.parse(t.out)
    expect(doc).toMatchObject({ schema: 1, blocking: 1 })
    expect(doc.findings[0]).toMatchObject({ file: 'src/new.js', check: 'sql-concat' })
    const p = meerkat(dir, 'logs-b6', 'ps', '--json')
    expect(Array.isArray(JSON.parse(p.out).processes)).toBe(true)
    expect(p.code).toBe(0)
  }, 180_000)
})

describe('B7 B8: verdict reuses the gate result cache for the same commit and base', () => {
  test('a second run is faster, the JSON is identical, and --first agrees', () => {
    const t0 = Date.now()
    const cold = meerkat(dir, 'logs-b7', 'verdict', '--json')
    const coldMs = Date.now() - t0
    const t1 = Date.now()
    const warm = meerkat(dir, 'logs-b7', 'verdict', '--json')
    const warmMs = Date.now() - t1
    expect(JSON.parse(cold.out)).toMatchObject({ verdict: 'FAIL', blocking: 1, preExisting: 1 })
    // The per-check rows carry wall time and the cached flag, which differ between a cold and a warm run; everything else must match.
    const stable = (o: string) => { const d = JSON.parse(o); d.checks = d.checks?.map(({ seconds, cached, ...rest }: any) => rest); return d }
    expect(stable(warm.out)).toEqual(stable(cold.out))
    expect(warm.code).toBe(cold.code)
    expect(warmMs).toBeLessThan(coldMs)
    const f0 = meerkat(dir, 'logs-b7', 'verdict', '--first', '--no-cache')
    const f1 = meerkat(dir, 'logs-b7', 'verdict', '--first')
    expect(f1.out).toBe(f0.out)
    expect(f1.out).toMatch(/^src\/new\.js:1: /)
  }, 180_000)
})

describe('B9: smoke counts what the gate counts', () => {
  test('one planted bug: 1 blocking and exit 1, like the gate', () => {
    const s = meerkat(dir, 'logs-b9', 'smoke')
    expect(s.out.split('\n')[0]).toMatch(/^MEERKAT smoke: 1 blocking,/)
    expect(s.code).toBe(1)
    const g = meerkat(dir, 'logs-b9', 'gate')
    expect(g.out).toMatch(/MEERKAT gate: 1 blocking/)
    expect(g.code).toBe(1)
  }, 180_000)
})

describe('B10: test without a configured test command', () => {
  test('one line, exit 2, nothing is run', () => {
    const r = meerkat(dir, 'logs-b10', 'test')
    expect(r.code).toBe(2)
    expect(r.out).toBe('')
    expect(r.err.trim().split('\n')).toHaveLength(1)
    expect(r.err).toMatch(/no test command is configured/)
    expect(r.err).toMatch(/commands.*test/)
  })
})
