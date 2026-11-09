// Items 3, 4 and 5 of 0.9.4 hygiene: the MCP server leaves with its client, the progress log, and memory bounds.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-094b-'))
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
const baseEnv = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') } as NodeJS.ProcessEnv
const cli = (args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), ...args], { encoding: 'utf8', env: { ...baseEnv, ...extra }, cwd, timeout: 120000 })
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) }
}

function repo(name: string, extraFiles = 0) {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
  put(d, 'a.js', 'export const a = 1\n')
  put(d, 'nap.js', 'setTimeout(() => {}, 20000)\n')
  put(d, 'meerkat.config.json', JSON.stringify({ packs: [], discover: false, disable: ['typos', 'yamllint', 'shellcheck', 'hadolint', 'actionlint', 'eslint', 'prettier'], customChecks: [{ id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 }] }))
  for (let i = 0; i < extraFiles; i++) put(d, `src/d${i % 50}/f${i}.js`, `export const v${i} = ${i}\n`)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  put(d, 'a.js', 'export const a = 2\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change')
  return d
}

describe('item 3: the MCP server exits with its client', () => {
  test('closing stdin ends the server within 3 seconds', () => {
    const r = spawnSync(process.execPath, [join(__dirname, 'hygiene-094.helper-mcp.mjs')], { encoding: 'utf8', timeout: 20000 })
    const ms = Number(String(r.stdout).trim())
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(ms).toBeLessThan(3000)
  }, 30000)
})

describe('item 4: the progress log', () => {
  test('a gate with a sleeping check writes progress lines and a last line that says why it stopped', () => {
    const d = repo('progress')
    const g = cli(['gate', '--no-cache', '--base', 'main', '--max-seconds', '4'], d, { MEERKAT_PROGRESS_MS: '500' })
    const runs = join(root, 'logs', 'runs')
    const dir = readdirSync(runs).map((n) => join(runs, n)).find((p) => existsSync(join(p, 'progress.log')))
    expect(dir, `gate output: ${g.out}${g.err}`).toBeTruthy()
    const lines = readFileSync(join(dir!, 'progress.log'), 'utf8').trim().split('\n')
    expect(lines.filter((l) => l.includes('[progress]')).length).toBeGreaterThanOrEqual(2)
    expect(lines.some((l) => /running=[^ ]*nap/.test(l))).toBe(true)
    expect(lines[lines.length - 1]).toMatch(/\[stop\] reason=time limit/)
    const shown = cli(['logs', basename(dir!)], d)
    expect(shown.out + shown.err).toContain('[stop] reason=time limit')
  }, 60000)
})

describe('item 5: memory bounds', () => {
  test('gate on a 2,500-file repository stays under 1 GB of RSS; 5 verdict runs in one process grow the heap by under 50 MB', () => {
    const d = repo('big', 2500)
    const run = (what: string) => {
      const r = spawnSync(process.execPath, ['--expose-gc', join(__dirname, 'hygiene-094.helper-mem.mjs'), what, d], { encoding: 'utf8', env: baseEnv, timeout: 240000 })
      const last = String(r.stdout).trim().split('\n').pop() ?? ''
      try {
        return JSON.parse(last)
      } catch {
        throw new Error(`${what}: no result. stdout=${r.stdout} stderr=${String(r.stderr).slice(0, 500)}`)
      }
    }
    const g = run('gate')
    expect(g.peakRssMB).toBeLessThan(1024)
    const v = run('verdict')
    expect(v.growthMB).toBeLessThan(50)
  }, 300000)
})
