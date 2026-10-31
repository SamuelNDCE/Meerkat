// The shared sandbox helper (thorough/sandbox.mjs): clean copies, scrubbed environment, no-shell runs with a tree-killing timeout, command detection, safe cleanup.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { cleanup, detectCommands, makeCleanCopy, runIn, safe, scrubbedEnv } from './thorough/sandbox.mjs'

const made: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-sbx-test-'))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) cleanup(d)
})
const put = (dir: string, name: string, body: string | Buffer = '') => {
  mkdirSync(join(dir, name, '..'), { recursive: true })
  writeFileSync(join(dir, name), body)
}
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore' })

describe('makeCleanCopy', () => {
  test('copies only git-tracked files', () => {
    const d = tmp()
    put(d, 'a.js', 'a')
    put(d, 'src/b.js', 'b')
    git(d, 'init', '-q')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'x')
    put(d, 'untracked.js', 'u')
    const c = makeCleanCopy(d)
    made.push(c.dir)
    expect(c.ok).toBe(true)
    expect(c.mode).toBe('git')
    expect(existsSync(join(c.dir, 'a.js'))).toBe(true)
    expect(readFileSync(join(c.dir, 'src/b.js'), 'utf8')).toBe('b')
    expect(existsSync(join(c.dir, 'untracked.js'))).toBe(false)
    expect(c.dir.startsWith(tmpdir())).toBe(true)
    cleanup(c.dir)
    expect(existsSync(c.dir)).toBe(false)
  })

  test('without git it walks and skips node_modules and build folders, and says so', () => {
    const d = tmp()
    put(d, 'a.js', 'a')
    put(d, 'node_modules/x/i.js', 'x')
    put(d, 'dist/o.js', 'o')
    put(d, '.venv/p.py', 'p')
    const c = makeCleanCopy(d)
    made.push(c.dir)
    expect(c.ok).toBe(true)
    expect(c.mode).toBe('walk')
    expect(c.note).toMatch(/not a git repository/)
    expect(existsSync(join(c.dir, 'a.js'))).toBe(true)
    expect(existsSync(join(c.dir, 'node_modules'))).toBe(false)
    expect(existsSync(join(c.dir, 'dist'))).toBe(false)
    expect(existsSync(join(c.dir, '.venv'))).toBe(false)
  })

  test('over the size cap: big files are skipped, and it is NOT RUN when it is still too big', () => {
    const d = tmp()
    put(d, 'small.txt', 'x'.repeat(100))
    put(d, 'big.bin', Buffer.alloc(2.5 * 1024 * 1024))
    const c = makeCleanCopy(d, { maxMb: 1 })
    made.push(c.dir)
    expect(c.ok).toBe(true)
    expect(c.skipped).toEqual(['big.bin'])
    expect(existsSync(join(c.dir, 'big.bin'))).toBe(false)
    const e = tmp()
    put(e, 'a.txt', 'x'.repeat(3000))
    put(e, 'b.txt', 'x'.repeat(3000))
    const r = makeCleanCopy(e, { maxMb: 0.001 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/more than the/)
  })

  test.skipIf(process.platform === 'win32')('keeps the executable bit', () => {
    const d = tmp()
    put(d, 'run.sh', '#!/bin/sh\n')
    execFileSync('chmod', ['755', join(d, 'run.sh')])
    const c = makeCleanCopy(d)
    made.push(c.dir)
    expect(statSync(join(c.dir, 'run.sh')).mode & 0o111).not.toBe(0)
  })
})

describe('scrubbedEnv', () => {
  test('never passes tokens, keys or cloud credentials, and points HOME at a temp folder', async () => {
    process.env.FAKE_TOKEN = 'secret-token-value'
    process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret'
    process.env.NPM_TOKEN = 'npm-secret'
    const env = scrubbedEnv({ EXTRA_OK: '1', 'bad key': 'x' })
    expect(Object.keys(env)).not.toContain('FAKE_TOKEN')
    expect(JSON.stringify(env)).not.toMatch(/secret-token-value|aws-secret|npm-secret/)
    expect(env.EXTRA_OK).toBe('1')
    expect(env['bad key']).toBeUndefined()
    expect(env.CI).toBe('1')
    expect(env.NO_COLOR).toBe('1')
    expect(env.DO_NOT_TRACK).toBe('1')
    expect(env.npm_config_update_notifier).toBe('false')
    expect(env.HOME.startsWith(tmpdir())).toBe(true)
    expect(env.USERPROFILE).toBe(env.HOME)
    const d = tmp()
    put(d, 'p.js', "console.log(JSON.stringify([process.env.FAKE_TOKEN ?? null, process.env.AWS_SECRET_ACCESS_KEY ?? null, process.env.NPM_TOKEN ?? null]))\n")
    const r = await runIn(d, 'node', ['p.js'], { env, timeoutMs: 20_000 })
    expect(r.code).toBe(0)
    expect(r.output.trim()).toBe('[null,null,null]')
    cleanup(env.HOME)
    delete process.env.FAKE_TOKEN
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.NPM_TOKEN
  })
})

describe('runIn', () => {
  test('captures output and the exit code, and passes arguments without a shell', async () => {
    const d = tmp()
    put(d, 'p.js', 'console.log(JSON.stringify(process.argv.slice(2)));process.exit(3)\n')
    const r = await runIn(d, 'node', ['p.js', 'a&b;c|d', '$HOME', '"q"'], { timeoutMs: 20_000 })
    expect(r.code).toBe(3)
    expect(r.timedOut).toBe(false)
    expect(JSON.parse(r.output.trim())).toEqual(['a&b;c|d', '$HOME', '"q"'])
  })

  test('caps the output', async () => {
    const d = tmp()
    put(d, 'p.js', "process.stdout.write('x'.repeat(2_000_000))\n")
    const r = await runIn(d, 'node', ['p.js'], { maxOutputKb: 10, timeoutMs: 20_000 })
    expect(r.output.length).toBeLessThan(40_000)
  })

  test.skipIf(process.platform !== 'win32')('refuses shell metacharacters when a .cmd shim must go through cmd.exe', async () => {
    const d = tmp()
    const r = await runIn(d, 'npm', ['run', 'a&calc'], { timeoutMs: 20_000 })
    expect(r.code).toBe(127)
    expect(r.output).toMatch(/refused/)
  })

  test('the timeout kills the whole process tree', async () => {
    const d = tmp()
    put(d, 'child.js', "require('fs').writeFileSync('child.pid', String(process.pid));setInterval(() => {}, 1000)\n")
    put(d, 'parent.js', "require('child_process').spawn(process.execPath, ['child.js'], { stdio: 'ignore' });setInterval(() => {}, 1000)\n")
    const env = scrubbedEnv()
    made.push(env.HOME)
    const r = await runIn(d, 'node', ['parent.js'], { timeoutMs: 2500, env })
    expect(r.timedOut).toBe(true)
    expect(r.ms).toBeLessThan(10_000)
    const pid = Number(readFileSync(join(d, 'child.pid'), 'utf8'))
    expect(pid).toBeGreaterThan(0)
    await new Promise((res) => setTimeout(res, 1000))
    let alive = true
    try {
      process.kill(pid, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  }, 30_000)

  test('an unknown program is a clean failure, not a crash', async () => {
    const r = await runIn(tmp(), 'definitely-not-a-program-xyz', [], { timeoutMs: 5000 })
    expect(r.code).toBe(127)
  })
})

describe('cleanup', () => {
  test('refuses paths outside the temp folder and the temp folder itself', () => {
    expect(cleanup(process.cwd())).toBe(false)
    expect(cleanup(homedir())).toBe(false)
    expect(cleanup(tmpdir())).toBe(false)
    expect(cleanup('')).toBe(false)
    expect(existsSync(process.cwd())).toBe(true)
  })
  test('removes a temp directory, and a missing one counts as done', () => {
    const d = tmp()
    put(d, 'a/b.txt', 'x')
    expect(cleanup(d)).toBe(true)
    expect(existsSync(d)).toBe(false)
    expect(cleanup(d)).toBe(true)
  })
})

describe('detectCommands', () => {
  const proj = (files: Record<string, string>) => {
    const d = tmp()
    for (const [k, v] of Object.entries(files)) put(d, k, v)
    return detectCommands(d)
  }
  test('node: npm ci with a lockfile, npm install with dependencies only, scripts as npm commands', () => {
    const pkg = JSON.stringify({ scripts: { build: 'x', test: 'y', start: 'z', dev: 'w' }, dependencies: { a: '1' } })
    expect(proj({ 'package.json': pkg, 'package-lock.json': '{}' })).toMatchObject({ install: ['npm', 'ci'], build: ['npm', 'run', 'build'], test: ['npm', 'test'], start: ['npm', 'start'], dev: ['npm', 'run', 'dev'] })
    expect(proj({ 'package.json': pkg }).install).toEqual(['npm', 'install'])
    expect(proj({ 'package.json': JSON.stringify({ scripts: { test: 'node t.js' } }) }).install).toBeNull()
    expect(proj({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }).test).toBeNull()
  })
  test('python, go, rust, java, dotnet', () => {
    expect(proj({ 'pytest.ini': '[pytest]\n' }).test).toEqual(['python', '-m', 'pytest', '-q'])
    expect(proj({ 'pyproject.toml': '[tool.pytest.ini_options]\n' }).test).toEqual(['python', '-m', 'pytest', '-q'])
    expect(proj({ 'go.mod': 'module x\n' })).toMatchObject({ build: ['go', 'build', './...'], test: ['go', 'test', './...'] })
    expect(proj({ 'Cargo.toml': '[package]\n' })).toMatchObject({ build: ['cargo', 'build'], test: ['cargo', 'test'] })
    expect(proj({ 'pom.xml': '<project/>' }).build).toEqual(['mvn', '-q', '-DskipTests', 'package'])
    expect(proj({ 'App.csproj': '<Project/>' })).toMatchObject({ build: ['dotnet', 'build'], test: ['dotnet', 'test'] })
  })
  test('an empty folder detects nothing', () => {
    expect(proj({ 'README.md': 'hi' })).toMatchObject({ install: null, build: null, test: null, start: null })
  })
})

describe('safe', () => {
  test('removes control characters', () => {
    expect(safe('a\u001b[31mb\nc\u0000')).toBe('a?[31mb?c?')
  })
})
