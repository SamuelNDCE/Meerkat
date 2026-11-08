// 0.6.2: gate progress on stderr. Every case runs the real CLI (bin/meerkat.mjs) in a scratch git repository.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-062-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_GATE_HEARTBEAT_MS: '500' } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const cli = (args: string[], cwd?: string, extra: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd, timeout: 170000 })
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) }
}
const repo = (name: string, files: Record<string, string>) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  for (const [f, b] of Object.entries(files)) put(d, f, b)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  return d
}

describe('gate prints progress', () => {
  const config = JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'quick', title: 'Quick', cmd: 'node', args: ['quick.js'], tier: 'fast' }, { id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 }] })
  const d = repo('gate-fx', { 'package.json': '{"name":"fx","version":"1.0.0","private":true}', 'a.js': 'export const a = 1\n', 'quick.js': "console.log('ok')\n", 'nap.js': 'setTimeout(() => {}, 20000)\n', 'meerkat.config.json': config })
  put(d, 'a.js', 'export const a = 2\n')

  test('one line per check start and finish, a still-running line, and a blocking count when the run is stopped', () => {
    const r = cli(['gate', '--no-cache', '--max-seconds', '3'], d)
    expect(r.err).toMatch(/\[\d+\/\d+\] quick \.\.\.\r?\n/)
    expect(r.err).toMatch(/\[\d+\/\d+\] quick \.\.\. \d+\.\ds/)
    expect(r.err).toMatch(/still running after \d+s: nap/)
    expect(r.err).toMatch(/stopped early: \d+ blocking so far, \d+ of \d+ checks finished/)
    expect(r.out).toMatch(/MEERKAT gate: \d+ blocking/)
    expect(r.out).toMatch(/NOT RUN\s+nap/)
  }, 60000)

  test('--max-seconds needs a number', () => {
    const r = cli(['gate', '--max-seconds', 'x'], d)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/--max-seconds needs a number/)
  })
})

describe('meerkat lock status lists the waiters', () => {
  test('two waiters show with their commands and pids', async () => {
    const { spawn } = await import('node:child_process')
    const lockDir = join(root, 'cargo.lock')
    const e = { ...env, MEERKAT_CARGO_LOCK_DIR: lockDir, MEERKAT_LOCK_MAX_WAIT: '60' } as NodeJS.ProcessEnv
    const script = join(ROOT, 'lib', 'cargo-lock-run.mjs')
    put(root, 'hold.js', 'setTimeout(() => {}, 15000)\n')
    put(root, 'quick.js', "console.log('done')\n")
    const kids = [
      spawn(process.execPath, [script, process.execPath, join(root, 'hold.js')], { env: e, stdio: 'ignore' }),
    ]
    await new Promise((r) => setTimeout(r, 1500))
    kids.push(spawn(process.execPath, [script, process.execPath, join(root, 'quick.js'), 'first-waiter'], { env: e, stdio: 'ignore' }))
    await new Promise((r) => setTimeout(r, 700))
    kids.push(spawn(process.execPath, [script, process.execPath, join(root, 'quick.js'), 'second-waiter'], { env: e, stdio: 'ignore' }))
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const r = cli(['lock', 'status'], root, e)
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/holder: pid \d+/)
      expect(r.out).toMatch(/hold\.js/)
      expect(r.out).toMatch(/waiting \(2\)/)
      expect(r.out).toMatch(/pid \d+\s+waited \d+s\s+.*first-waiter/)
      expect(r.out).toMatch(/pid \d+\s+waited \d+s\s+.*second-waiter/)
      expect(r.out.indexOf('first-waiter')).toBeLessThan(r.out.indexOf('second-waiter'))
      const j = JSON.parse(cli(['lock', 'status', '--json'], root, e).out)
      expect(j.waiters).toHaveLength(2)
    } finally {
      for (const k of kids) k.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }, 60000)

  test('a free lock says so', () => {
    const r = cli(['lock', 'status'], root, { MEERKAT_CARGO_LOCK_DIR: join(root, 'nobody.lock') })
    expect(r.out).toMatch(/free/)
  })
})

describe('lock status is read-only and safe to print', () => {
  test('an ESC sequence in a waiter command is stripped and a stale waiter file is not deleted', () => {
    const lockDir = join(root, 'esc.lock')
    mkdirSync(lockDir + '.waiters', { recursive: true })
    const file = join(lockDir + '.waiters', `${process.pid}-abc123.json`)
    writeFileSync(file, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cmd: 'cargo \u001b[31mRED\u001b]0;title\u0007 ' + 'x'.repeat(400) }))
    const stale = join(lockDir + '.waiters', '99999999-dead01.json')
    writeFileSync(stale, JSON.stringify({ pid: 99999999, since: new Date().toISOString(), cmd: 'gone' }))
    const r = cli(['lock', 'status'], root, { MEERKAT_CARGO_LOCK_DIR: lockDir })
    expect(r.out).toContain('waiting (1)')
    expect(r.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    expect(r.out).toContain('RED')
    expect(r.out.split('\n').find((l) => l.includes('cargo'))!.length).toBeLessThan(260)
    expect(existsSync(stale)).toBe(true) // status never deletes
  })

  test('a symlinked waiters folder is refused and nothing outside it is touched', () => {
    const lockDir = join(root, 'link.lock')
    const outside = join(root, 'outside')
    mkdirSync(outside, { recursive: true })
    const victim = join(outside, '99999999-dead01.json')
    writeFileSync(victim, JSON.stringify({ pid: 99999999, since: new Date().toISOString(), cmd: 'x' }))
    const live = join(outside, `${process.pid}-live01.json`)
    writeFileSync(live, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cmd: 'should not be listed' }))
    symlinkSync(outside, lockDir + '.waiters', 'junction')
    const r = cli(['lock', 'status'], root, { MEERKAT_CARGO_LOCK_DIR: lockDir })
    expect(r.out).not.toContain('should not be listed')
    expect(r.out).toMatch(/free/)
    expect(existsSync(victim)).toBe(true)
    expect(existsSync(live)).toBe(true)
  })
})
