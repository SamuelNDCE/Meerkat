// summary.json always carries the blockingFindings array (empty when nothing blocks), and every entry says onBase: true, false or null.
// A real repo, a real branch, the real CLI.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'meerkat.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'mk-summary-fields-'))

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function runGate(cwd: string, state: string, extra: string[] = [], more: Record<string, string> = {}): Promise<number | null> {
  const env = { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: join(state, 'logs'), MEERKAT_HOME: join(state, 'home'), MEERKAT_PROGRESS: '0', ...more }
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, 'gate', '--no-input', '--base', 'main', ...extra], { cwd, env })
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.on('close', (code) => done(code))
  })
}

function newestSummary(state: string): any {
  const runs = join(state, 'logs', 'runs')
  if (!existsSync(runs)) return null
  const dirs = readdirSync(runs).map((n) => join(runs, n)).filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'summary.json')))
  dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return dirs.length ? JSON.parse(readFileSync(join(dirs[0], 'summary.json'), 'utf8')) : null
}

function makeRepo(name: string, changed: string): string {
  const repo = join(ROOT, name)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  git(repo, 'config', 'user.name', 'test')
  // The eval() below is text in a throwaway fixture repo: the planted finding the gate must catch. It is never executed.
  writeFileSync(join(repo, 'lib.js'), 'module.exports = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'checkout', '-q', '-b', 'feat')
  writeFileSync(join(repo, 'lib.js'), changed)
  git(repo, 'commit', '-q', '-am', 'change')
  return repo
}

const NL = String.fromCharCode(10)
const BAD ='module.exports = (s) => eval(s)\n'
const CLEAN = 'module.exports = 2\n'
const runs: Record<string, any> = {}

beforeAll(async () => {
  const cases: Array<[string, string, string[], Record<string, string>]> = [
    ['new', BAD, [], {}],
    ['allfindings', BAD, ['--all-findings'], {}],
    ['unfinished', BAD, [], { MEERKAT_TEST_BASE_UNFINISHED: '1' }],
    ['clean', CLEAN, [], {}],
  ]
  for (const [name, body, extra, env] of cases) {
    const repo = makeRepo(name, body)
    const state = join(ROOT, `state-${name}`)
    mkdirSync(state, { recursive: true })
    await runGate(repo, state, extra, env)
    runs[name] = newestSummary(state)
  }
  runs.stopped = await stoppedRun()
}, 600000)

// A verdict stopped at its time limit: one check has already failed, another sleeps past the limit.
async function stoppedRun(): Promise<any> {
  const d = join(ROOT, 'stopped')
  const state = join(ROOT, 'state-stopped')
  mkdirSync(d, { recursive: true })
  mkdirSync(state, { recursive: true })
  const flag = join(ROOT, 'stopped.sleep').replaceAll(String.fromCharCode(92), '/')
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'config', 'user.email', 'test@example.invalid')
  git(d, 'config', 'user.name', 'test')
  writeFileSync(join(d, 'package.json'), '{"name":"fx","version":"1.0.0","private":true}')
  writeFileSync(join(d, 'a.js'), ['export const a = 1', ''].join(NL))
  writeFileSync(join(d, 'bad.js'), ["console.log('a.js:1:1 planted problem'); process.exit(1)", ''].join(NL))
  writeFileSync(join(d, 'nap.js'), [`if (require('fs').existsSync(${JSON.stringify(flag)})) setTimeout(() => {}, 120000)`, ''].join(NL))
  writeFileSync(join(d, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [
    { id: 'bad', title: 'Bad', cmd: 'node', args: ['bad.js'], tier: 'fast', timeoutSeconds: 60 },
    { id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 },
  ] }))
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  writeFileSync(join(d, 'a.js'), ['export const a = 2', ''].join(NL))
  git(d, 'commit', '-q', '-am', 'change')
  writeFileSync(flag, 'x')
  const env = { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: join(state, 'logs'), MEERKAT_HOME: join(state, 'home'), MEERKAT_PROGRESS: '0', MEERKAT_NO_PROJECT_CODE: '', MEERKAT_GATE_HEARTBEAT_MS: '500', MEERKAT_VERDICT_TIMEOUT_S: '30' }
  spawnSync(process.execPath, [BIN, 'verdict', '--base', 'main', '--max-seconds', '3'], { encoding: 'utf8', env, cwd: d, timeout: 170000 })
  return newestSummary(state)
}

afterAll(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows can keep a handle open for a moment; the temp folder is left for the OS.
  }
})

describe('summary.json blockingFindings and onBase', () => {
  for (const name of ['new', 'allfindings', 'unfinished']) {
    it(`${name}: every blocking finding has onBase true, false or null`, () => {
      const s = runs[name]
      expect(s, 'no summary.json').not.toBeNull()
      expect(Array.isArray(s.blockingFindings), 'no blockingFindings array').toBe(true)
      expect(s.blockingFindings.length).toBeGreaterThan(0)
      for (const f of s.blockingFindings) expect([true, false, null], JSON.stringify(f)).toContain(f.onBase)
    })
  }
  it('unfinished base comparison gives onBase null, a finished one gives false', () => {
    for (const f of runs.unfinished.blockingFindings) expect(f.onBase).toBeNull()
    for (const f of runs.new.blockingFindings) expect(f.onBase).toBe(false)
  })
  it('a run stopped at its time limit still lists its blocking findings with onBase', () => {
    const s = runs.stopped
    expect(s, 'no summary.json').not.toBeNull()
    expect(Array.isArray(s.blockingFindings), 'no blockingFindings array').toBe(true)
    expect(s.blockingFindings.length).toBeGreaterThan(0)
    for (const f of s.blockingFindings) expect([true, false, null], JSON.stringify(f)).toContain(f.onBase)
  })
  it('a run with no blocking finding still has blockingFindings, as an empty array', () => {
    const s = runs.clean
    expect(s, 'no summary.json').not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(s, 'blockingFindings'), 'key missing').toBe(true)
    expect(s.blockingFindings).toEqual([])
    expect(s.blocking).toBe(0)
  })
})
