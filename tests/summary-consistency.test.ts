// Issue 29b / 29i: summary.json's counts.fail, its headline "N failed", its failed rows and its blocking list must agree.
// The fixture has a failure on an untouched line of a changed file ("inherited": hidden by the base comparison), one in an unchanged file, one on a changed line and one mixed.
// A failure in a file the change did not touch is labelled outside the change, never counted as blocking.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-sumcons-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1', CI: '1' } as NodeJS.ProcessEnv
let summary: any
let out = ''

beforeAll(() => {
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const mk = (id: string, ...files: string[]) => ({ id, title: id, cmd: 'node', args: ['complain.js', ...files], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [mk('in-change', 'ok.js', 'ok.js', 'ok.js'), mk('far-away', 'old.js'), mk('inherited', 'ok.js'), mk('mixed', 'ok.js', 'old.js', 'old.js')] }))
  writeFileSync(join(repo, 'complain.js'), 'process.argv.slice(2).forEach((f, i) => console.log(f + ":" + (i + 1) + ": something is wrong " + i))\nprocess.exit(1)\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'old.js'), 'export const old = 1\n')
  writeFileSync(join(repo, 'ok.js'), 'a1\nb2\nc3\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'ok.js'), 'a1\nb2\nc4\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
  const r = spawnSync(process.execPath, [bin, 'gate', '--base', 'main', '--no-input'], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 })
  out = String(r.stdout) + String(r.stderr)
  const runs = join(root, 'logs', 'runs')
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => existsSync(join(runs, d, 'summary.json'))) : []
  summary = dirs.length ? JSON.parse(readFileSync(join(runs, dirs[dirs.length - 1], 'summary.json'), 'utf8')) : null
}, 150_000)

describe('summary.json agrees with itself', () => {
  test('a summary was written', () => {
    expect(summary, out).not.toBeNull()
  })
  test('counts.fail equals the number of failed rows in results', () => {
    const failedRows = summary.results.filter((r: any) => r.status === 'FAIL').length
    expect(summary.counts.fail).toBe(failedRows)
  })
  test('the headline failed count equals counts.fail', () => {
    const m = String(summary.summary).match(/(\d+) failed/)
    expect(m, summary.summary).not.toBeNull()
    expect(Number(m![1])).toBe(summary.counts.fail)
  })
  test('every failed row is blocking (in blockingFindings) or marked outside the change', () => {
    const inList = new Set((summary.blockingFindings ?? []).map((b: any) => b.check))
    for (const r of summary.results.filter((x: any) => x.status === 'FAIL')) {
      const marked = r.blocking === false || r.outside === true || r.outsideChange === true || /outside the change/.test(String(r.detail ?? ''))
      expect(inList.has(r.id) || marked, `${r.id} is neither in blockingFindings nor marked outside the change: ${JSON.stringify(r)}`).toBe(true)
    }
  })
  test('a failure only in an unchanged file is not in blockingFindings', () => {
    expect((summary.blockingFindings ?? []).some((b: any) => b.check === 'far-away')).toBe(false)
  })
  test('blocking equals the length of blockingFindings', () => {
    expect(summary.blocking).toBe((summary.blockingFindings ?? []).length)
    expect(summary.counts.blocking).toBe(summary.blocking)
  })
})
