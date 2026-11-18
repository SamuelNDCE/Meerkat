// A gate that hits its time cap must still leave a readable summary.json in its run folder: status "incomplete", the reason (the cap), and a non-zero exit code.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-capsum-'))
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    /* a stopped check can hold its folder for a moment on Windows */
  }
})
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

describe('a time cap still writes summary.json', () => {
  test('a slow check and a 2 second cap: incomplete summary naming the cap, non-zero exit', () => {
    const d = join(root, 'fx')
    const logs = join(root, 'logs')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    writeFileSync(join(d, 'package.json'), '{"name":"fx","version":"1.0.0","private":true}')
    writeFileSync(join(d, 'a.js'), 'export const a = 1\n')
    writeFileSync(join(d, 'nap.js'), 'setTimeout(() => {}, 60000)\n')
    writeFileSync(join(d, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 }] }))
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'base')
    git(d, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(d, 'a.js'), 'export const a = 2\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'change')
    const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: logs, MEERKAT_GATE_HEARTBEAT_MS: '500' } as NodeJS.ProcessEnv
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), 'gate', '--no-cache', '--base', 'main', '--max-seconds', '2'], { encoding: 'utf8', env, cwd: d, timeout: 120000 })
    expect(r.status, `${r.stdout}\n${r.stderr}`).not.toBe(0)
    const found: string[] = []
    const walk = (p: string) => {
      if (!existsSync(p)) return
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const q = join(p, e.name)
        if (e.isDirectory()) walk(q)
        else if (e.name === 'summary.json') found.push(q)
      }
    }
    walk(logs)
    expect(found.length, `no summary.json under ${logs}\n${r.stdout}\n${r.stderr}`).toBeGreaterThan(0)
    const doc = JSON.parse(readFileSync(found[found.length - 1], 'utf8'))
    expect(doc.status).toBe('incomplete')
    expect(String(doc.reason ?? '')).toMatch(/time limit|cap|deadline/i)
    expect(doc.exitCode).not.toBe(0)
  }, 150000)
})
