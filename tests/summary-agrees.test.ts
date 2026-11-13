// Issue 25b / 25g: the CLI verdict and the run's summary.json must come from one run and agree on the exit code and the blocking count.
// A real repo, a real branch, the real CLI. Red until the summary and the CLI share one count.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'meerkat.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'mk-summary-agrees-'))

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function runGate(cwd: string, state: string): Promise<{ code: number | null; stdout: string }> {
  const env = { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: join(state, 'logs'), MEERKAT_HOME: join(state, 'home'), MEERKAT_PROGRESS: '0' }
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, 'gate', '--no-input', '--base', 'main'], { cwd, env })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', () => {})
    child.on('close', (code) => done({ code, stdout }))
  })
}

// The newest run folder under the state folder that holds a summary.json.
function newestSummary(state: string): { dir: string; summary: any } | null {
  const runs = join(state, 'logs', 'runs')
  if (!existsSync(runs)) return null
  const dirs = readdirSync(runs).map((n) => join(runs, n)).filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'summary.json')))
  dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!dirs.length) return null
  return { dir: dirs[0], summary: JSON.parse(readFileSync(join(dirs[0], 'summary.json'), 'utf8')) }
}

// The CLI's "N blocking" count from its own summary line, e.g. "MEERKAT gate: 1 blocking, ...".
const cliBlocking = (stdout: string) => {
  const m = stdout.match(/(\d+) blocking/)
  return m ? Number(m[1]) : null
}

let repo: string
let state: string
let run: { code: number | null; stdout: string }
let summary: { dir: string; summary: any } | null

beforeAll(async () => {
  repo = join(ROOT, 'repo')
  state = join(ROOT, 'state')
  mkdirSync(repo, { recursive: true })
  mkdirSync(state, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  git(repo, 'config', 'user.name', 'test')
  // The eval() below is text written into a throwaway fixture repo, on purpose: it is the planted finding the gate must catch. It is never executed.
  // main has a pre-existing finding in old.js (not in the change).
  writeFileSync(join(repo, 'old.js'), 'module.exports = (s) => eval(s)\n')
  writeFileSync(join(repo, 'lib.js'), 'module.exports = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'checkout', '-q', '-b', 'feat')
  // The change adds a new finding in lib.js (the only changed file).
  writeFileSync(join(repo, 'lib.js'), 'module.exports = (s) => eval(s)\n')
  git(repo, 'commit', '-q', '-am', 'change')
  run = await runGate(repo, state)
  summary = newestSummary(state)
}, 240000)

afterAll(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows can keep a handle open for a moment; the temp folder is left for the OS.
  }
})

describe('the CLI verdict and summary.json come from one run (25b, 25g)', () => {
  it('the run wrote a summary.json', () => {
    expect(summary, 'no summary.json under the state folder').not.toBeNull()
  })

  it('summary.json exitCode equals the CLI exit code', () => {
    const msg = `exit code: CLI ${run.code}, summary.json ${summary?.summary.exitCode}`
    expect(summary!.summary.exitCode, msg).toBe(run.code)
  })

  it('summary.json names a blocking count, and it equals the CLI blocking count', () => {
    const fromCli = cliBlocking(run.stdout)
    const fromSummary = summary!.summary.blocking ?? summary!.summary.counts?.blocking ?? null
    const msg = `blocking: CLI ${fromCli}, summary.json ${fromSummary}`
    expect(fromCli, `the CLI printed no blocking count. ${msg}`).not.toBeNull()
    expect(fromSummary, msg).toBe(fromCli)
  })

  it('the summary headline and counts agree: failed in the headline equals counts.fail', () => {
    const head = String(summary!.summary.summary ?? '')
    const m = head.match(/(\d+) failed/)
    expect(m, `no "N failed" in the headline: ${head}`).not.toBeNull()
    expect(Number(m![1])).toBe(summary!.summary.counts?.fail)
  })
})
