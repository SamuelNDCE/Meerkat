// The answer is the first line: verdict starts with its verdict word and "judged N changed file(s)", gate's first stdout line carries the exit code and
// "(status N)", the "note: behind <base> by N commits" line follows (stdout, after the answer), and text and --json agree on the verdict and exit code.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-firstline-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') }
const cli = (args: string[], cwd: string) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd, env, encoding: 'utf8', timeout: 170_000 })
  return { code: r.status, out: String(r.stdout).split(/\r?\n/).filter(Boolean), err: String(r.stderr) }
}
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'dev')
  put(repo, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus'], disable: ['unused-files'], discover: false }))
  put(repo, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(repo, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/dev', 'HEAD')
  put(repo, 'src/one.js', 'export const one = 1\n')
  put(repo, 'src/two.js', 'export const two = 2\n')
  git(repo, 'add', 'src/one.js', 'src/two.js')
}, 60_000)

describe('the answer is the first line', () => {
  test('(a) verdict text: first stdout line starts with the verdict word and says how many files were judged', () => {
    const r = cli(['verdict', '--base', 'origin/dev'], repo)
    expect(r.out[0]).toMatch(/^(PASS|FAIL|INCOMPLETE|NO-RESULT|STALE)\b/)
    expect(r.out[0]).toMatch(/judged \d+ changed file\(s\)/)
  }, 180_000)
  test('(b) gate text: first stdout line carries the exit code and the status', () => {
    const r = cli(['gate', '--base', 'origin/dev'], repo)
    expect(r.out[0]).toContain('(status')
    expect(r.out[0]).toContain(`exit ${r.code}`)
  }, 180_000)
  test('(c) the base note still appears, after the answer', () => {
    for (const w of ['verdict', 'gate']) {
      const r = cli([w, '--base', 'origin/dev'], repo)
      const i = r.out.findIndex((l) => l.startsWith('note: behind origin/dev by'))
      expect(i).toBeGreaterThan(0)
    }
  }, 180_000)
  test('(d) text and --json report the same verdict word and exit code', () => {
    const t = cli(['verdict', '--base', 'origin/dev'], repo)
    const j = cli(['verdict', '--base', 'origin/dev', '--json'], repo)
    const doc = JSON.parse(j.out.join('\n'))
    expect(j.code).toBe(t.code)
    expect(doc.exitCode).toBe(t.code)
    expect(t.out[0].startsWith(doc.verdict)).toBe(true)
  }, 180_000)
})
