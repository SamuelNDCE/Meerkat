// Issue 29q: one failed count per run. The summary text, counts.fail, the FAIL result rows and the printed headline give the same top-level
// number; sub-checks (the MEERKAT-SUB rules of one check) are counted apart and labelled as sub-checks. With a base, only the diff is judged.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-fc1-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const mkEnv = (name: string) => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, name, 'logs'), MEERKAT_HOME: join(root, name, 'home'), MEERKAT_PLAIN: '1', CI: '1' }) as NodeJS.ProcessEnv

function makeRepo(name: string, checks: any[], scripts: Record<string, string>, override: Record<string, any> = {}) {
  const repo = join(root, name, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: checks, override }))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'old.js'), 'export const old = 1\n')
  writeFileSync(join(repo, 'ok.js'), 'a1\nb2\nc3\n')
  for (const [f, body] of Object.entries(scripts)) writeFileSync(join(repo, f), body)
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'ok.js'), 'a1\nb2\nc4\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
  return repo
}
function runGate(name: string, repo: string, extra: string[] = []) {
  const r = spawnSync(process.execPath, [bin, 'gate', '--base', 'main', '--no-input', ...extra], { cwd: repo, env: mkEnv(name), encoding: 'utf8', timeout: 120_000 })
  const runs = join(root, name, 'logs', 'runs')
  const dirs = existsSync(runs) ? readdirSync(runs).filter((d) => existsSync(join(runs, d, 'summary.json'))) : []
  const summary = dirs.length ? JSON.parse(readFileSync(join(runs, dirs[dirs.length - 1], 'summary.json'), 'utf8')) : null
  return { out: String(r.stdout) + String(r.stderr), stdout: String(r.stdout), summary }
}

describe('one failed count per run', () => {
  let a: ReturnType<typeof runGate>
  beforeAll(() => {
    const mk = (id: string, script: string) => ({ id, title: id, cmd: 'node', args: [script, 'ok.js'], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
    const subs = 'for (const id of ["rule-a", "rule-b", "rule-c"]) console.log("MEERKAT-SUB FAIL " + id + " broken " + id)\nconsole.log("ok.js:3: something is wrong")\nprocess.exit(1)\n'
    const repo = makeRepo('one', [mk('three-subs', 'subs.js')], { 'subs.js': subs })
    a = runGate('one', repo)
  }, 150_000)

  test('a summary was written', () => {
    expect(a.summary, a.out).not.toBeNull()
  })
  // The bundled checks add their own failures to this small repo, so the number is read from the FAIL rows (top-level checks only) and every other place must match it.
  const failedRows = () => a.summary.results.filter((r: any) => r.status === 'FAIL').length
  test('the failing check is one failed row, not three (its sub-checks are not rows)', () => {
    expect(a.summary.results.filter((r: any) => r.id === 'three-subs' && r.status === 'FAIL').length).toBe(1)
    expect(failedRows()).toBeGreaterThanOrEqual(1)
  })
  test('counts.fail equals the FAIL rows', () => {
    expect(a.summary.counts.fail).toBe(failedRows())
  })
  test('the summary text says the same number', () => {
    expect(String(a.summary.summary)).toContain(`${failedRows()} failed`)
  })
  test('the printed headline gives the same failed count', () => {
    expect(a.stdout.split(String.fromCharCode(10))[0]).toContain(`${failedRows()} failed`)
  })
  test('sub-checks are counted separately and labelled as sub-checks', () => {
    expect(a.summary.counts.subFail).toBe(3)
    expect(a.stdout.split(String.fromCharCode(10))[0]).toContain('3 sub-checks failed')
    expect(String(a.summary.summary)).toContain('3 sub-checks failed')
    expect(String(a.summary.summary)).not.toContain(`${failedRows() + 3} failed`)
  })
})

describe('a base run judges only the diff', () => {
  let b: ReturnType<typeof runGate>
  beforeAll(() => {
    const mk = (id: string, ...files: string[]) => ({ id, title: id, cmd: 'node', args: ['complain.js', ...files], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
    const complain = 'process.argv.slice(2).forEach((f, i) => console.log(f + ":" + (i + 1) + ": something is wrong " + i))\nprocess.exit(1)\n'
    const repo = makeRepo('two', [mk('old-only', 'old.js'), mk('uses-changed', 'ok.js', 'ok.js', 'ok.js')], { 'complain.js': complain }, { 'old-only': { paths: ['old.js'] } })
    b = runGate('two', repo)
  }, 150_000)

  test('a finding only in an unchanged file is not a change failure', () => {
    expect((b.summary.blockingFindings ?? []).some((x: any) => x.file === 'old.js')).toBe(false)
    expect(b.summary.blocking).toBe(1)
  })
  test('the unchanged-file check is not counted as a failed check of the run', () => {
    expect(b.summary.results.filter((r: any) => r.id === 'old-only').length).toBe(0)
    expect(b.summary.counts.fail).toBe(b.summary.results.filter((r: any) => r.status === 'FAIL').length)
    expect(String(b.summary.summary)).toContain(`${b.summary.counts.fail} failed`)
  })
  test('the checks it ran are the diff-scoped set', () => {
    const ran = b.summary.results.map((r: any) => r.id)
    expect(ran).toContain('uses-changed')
    expect(ran).not.toContain('old-only')
  })
})
