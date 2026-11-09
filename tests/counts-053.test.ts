// One denominator: the progress line, the INCOMPLETE line and the verdict JSON all count the checks the run selected.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-counts053-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const cli = join(__dirname, '..', 'bin', 'meerkat.mjs')
const meerkat = (cwd: string, extra: Record<string, string>, ...args: string[]) => {
  const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), NO_COLOR: '1', ...extra } as NodeJS.ProcessEnv
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', timeout: 100_000 })
  return { code: r.status, out: r.stdout.replace(/\r/g, ''), err: r.stderr.replace(/\r/g, '') }
}
let dir: string
beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, '.gitignore', 'logs\n')
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'feat')
  put(dir, 'src/new.js', 'export const n = (a) => a + 2\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'branch')
})

describe('one check count everywhere', () => {
  test('progress total equals JSON checksTotal, and checksFinished equals the rows', () => {
    const r = meerkat(dir, {}, 'verdict', '--json')
    const doc = JSON.parse(r.out)
    expect(doc.checksTotal).toBe(doc.checks.length)
    expect(doc.checksFinished).toBe(doc.checksTotal)
    const totals = [...r.err.matchAll(/\[(?:done )?\d+\/(\d+)\]/g)].map((m) => Number(m[1]))
    expect(totals.length).toBeGreaterThan(0)
    expect(new Set(totals)).toEqual(new Set([doc.checksTotal]))
  })

  test('a cached second run keeps the same total in the progress line', () => {
    const a = JSON.parse(meerkat(dir, {}, 'verdict', '--json').out)
    const b = meerkat(dir, {}, 'verdict', '--json')
    const totals = [...b.err.matchAll(/\[(?:done )?\d+\/(\d+)\]/g)].map((m) => Number(m[1]))
    expect(JSON.parse(b.out).checksTotal).toBe(a.checksTotal)
    expect(totals.length).toBeGreaterThan(0)
    expect(new Set(totals)).toEqual(new Set([a.checksTotal]))
  })

  test('INCOMPLETE "of" total, progress total and JSON checksTotal are equal', () => {
    const full = JSON.parse(meerkat(dir, {}, 'verdict', '--json').out)
    const r = meerkat(dir, {}, 'verdict', '--no-cache', '--max-seconds', '1')
    const m = r.out.match(/INCOMPLETE (\d+) of (\d+) checks finished/)
    expect(m).not.toBeNull()
    expect(Number(m![2])).toBe(full.checksTotal)
    const totals = [...r.err.matchAll(/\[(?:done )?\d+\/(\d+)\]/g)].map((x) => Number(x[1]))
    expect(new Set(totals)).toEqual(new Set([Number(m![2])]))
  })
})
