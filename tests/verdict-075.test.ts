// 0.7.5: verdict --branches (one line per branch).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runVerdict } from '../lib/branchcmds.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-verdict075-'))
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
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
let dir: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'clean')
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 2\n')
  git(dir, 'commit', '-q', '-am', 'clean change')
  git(dir, 'checkout', '-q', 'main')
  git(dir, 'checkout', '-q', '-b', 'bad')
  put(dir, 'src/new.js', bug('newBug'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'bad change')
})

const run = async (argv: string[], where = dir) => {
  const lines: string[] = []
  const errs: string[] = []
  const code = await runVerdict(argv, { env, cwd: where, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) })
  return { code, lines, errs }
}

describe('verdict --branches', () => {
  test('one prefixed line per branch, progress lines, a missing branch continues, exit 1 on a blocking branch', async () => {
    const r = await run(['--base', 'main', '--branches', 'clean,bad,nope'])
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0]).toBe('clean: PASS')
    expect(r.lines[1]).toMatch(/^bad: FAIL \d+ blocking in changed files$/)
    expect(r.lines[2]).toMatch(/^nope: NO-RESULT: git does not know the branch nope/)
    expect(r.errs.filter((l) => /^\[\d\/3\] /.test(l))).toEqual(['[1/3] clean ...', '[2/3] bad ...', '[3/3] nope ...'])
    expect(r.code).toBe(1)
  }, 180_000)

  test('repeated --branch, all clean or unreadable, exits 0', async () => {
    const r = await run(['--base', 'main', '--branch', 'clean', '--branch', 'nope'])
    expect(r.lines[0]).toBe('clean: PASS')
    expect(r.lines[1]).toMatch(/^nope: NO-RESULT/)
    expect(r.code).toBe(0)
  }, 180_000)
})

