// While a gate runs, <run folder>/progress.json says how far it is; at the end it says done.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-pfile-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs, MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1', MEERKAT_GATE_HEARTBEAT_MS: '300' }
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const mk = (id: string, ms: number) => ({ id, title: id, cmd: 'node', args: ['sleep.js', String(ms)], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [mk('alpha', 1500), mk('beta', 2500)] }))
  writeFileSync(join(repo, 'sleep.js'), 'setTimeout(function () {}, Number(process.argv[2]))\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 2\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
}, 60_000)

const progressFiles = () => {
  const runs = join(logs, 'runs')
  if (!existsSync(runs)) return []
  return readdirSync(runs)
    .map((n) => join(runs, n, 'progress.json'))
    .filter((f) => existsSync(f))
}

describe('progress.json', () => {
  test('exists and says running during a 2-check gate, and says done at the end', async () => {
    const child = spawn(process.execPath, [bin, 'verdict', '--base', 'main', '--no-input', '--only-checks', 'alpha,beta'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    let exited = false
    const exit = new Promise<void>((res) => child.on('exit', () => ((exited = true), res())))
    const seen: any[] = []
    const deadline = Date.now() + 60_000
    while (!exited && Date.now() < deadline) {
      for (const f of progressFiles()) {
        let text = ''
        try {
          text = readFileSync(f, 'utf8')
        } catch {
          continue // the file was being replaced; the next poll reads it
        }
        try {
          seen.push(JSON.parse(text))
        } catch (e) {
          throw new Error(`progress.json was not valid JSON while running: ${String(e)}`)
        }
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    await exit
    expect(seen.some((d) => d.state === 'running'), stderr).toBe(true)
    const mid = seen.find((d) => d.state === 'running')
    for (const k of ['state', 'percent', 'finished', 'total', 'running', 'elapsedSeconds', 'etaSeconds', 'updated']) expect(mid, k).toHaveProperty(k)
    expect(mid.total).toBe(2)
    expect(Array.isArray(mid.running)).toBe(true)
    const files = progressFiles()
    expect(files.length).toBe(1)
    const last = JSON.parse(readFileSync(files[0], 'utf8'))
    expect(last.state).toBe('done')
    expect(last.finished).toBe(2)
    expect(last.percent).toBe(100)
    expect(last.running).toEqual([])
    expect(Number.isNaN(Date.parse(last.updated))).toBe(false)
  }, 90_000)
})
