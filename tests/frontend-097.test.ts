// Meerkat 0.9.7: `meerkat frontend` runs typecheck, test and build from the commands block, writes frontend.json, and the gate reads it.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { frontendGateLine, parseFrontendArgs, runFrontend, testCommandFor } from '../lib/frontend.mjs'
// @ts-expect-error plain .mjs module
import { gateMain } from '../lib/gate.mjs'
// @ts-expect-error plain .mjs module
import { latestRunDirForFolder } from '../lib/runlog.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-097f-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const COMMANDS = {
  typecheck: 'node -e "process.exit(0)"',
  test: 'node check.js {files}',
  build: 'node -e "setTimeout(function(){},30000)"',
}
function fixture(name: string, commands: Record<string, string> = COMMANDS) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'check.js', "var bad = process.argv.slice(2).filter(function (f) { return f.indexOf('bad') >= 0 })\nif (bad.length) { console.error('FAIL ' + bad.join(',')); process.exit(3) }\nconsole.log('ok')\n")
  put(dir, 'src/good.test.js', 'export const a = 1\n')
  put(dir, 'src/bad.test.js', 'export const b = 2\n')
  put(dir, 'meerkat.config.json', JSON.stringify({ commands }))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  const logs = join(root, `${name}-logs`)
  return { dir, env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_TRUST_PROJECT: '1', MEERKAT_FRONTEND_TIMEOUT_S: '2' } as NodeJS.ProcessEnv }
}
const run = async (dir: string, env: NodeJS.ProcessEnv, argv: string[]) => {
  const lines: string[] = []
  const errs: string[] = []
  const code = await runFrontend(argv, { env, cwd: dir, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) })
  return { code, lines, errs }
}

describe('meerkat frontend', () => {
  const fx = fixture('main')
  test('runs typecheck, test and build in order; frontend.json has pass, fail and timeout', async () => {
    const t0 = Date.now()
    const r = await run(fx.dir, fx.env, ['--app', fx.dir, '--files', 'src/good.test.js,src/bad.test.js'])
    expect(Date.now() - t0).toBeLessThan(20000)
    expect(r.code).toBe(1)
    expect(r.lines.filter((l) => /^frontend (typecheck|test|build): start/.test(l)).length).toBe(3)
    expect(r.lines.some((l) => /^frontend test: fail, exit 3, [\d.]+ s$/.test(l))).toBe(true)
    const dir = latestRunDirForFolder(fx.env, fx.dir, { preset: 'frontend' })
    expect(dir).toBeTruthy()
    const doc = JSON.parse(readFileSync(join(dir, 'frontend.json'), 'utf8'))
    expect(doc.steps.map((s: any) => [s.key, s.status])).toEqual([['typecheck', 'pass'], ['test', 'fail'], ['build', 'timeout']])
    expect(doc.steps[0].exitCode).toBe(0)
    expect(doc.steps[1].exitCode).toBe(3)
    expect(doc.steps[1].tail).toContain('FAIL src/bad.test.js')
    expect(doc.steps[2].exitCode).toBeNull()
    expect(doc.steps[2].durationSeconds).toBeGreaterThanOrEqual(2)
    expect(doc.steps[2].durationSeconds).toBeLessThan(10)
    expect(doc.commit).toBe(git(fx.dir, 'rev-parse', 'HEAD'))
    expect(doc.steps[1].command).toContain('"src/good.test.js" "src/bad.test.js"')
    console.log(JSON.stringify(doc, null, 2))
  }, 30000)

  test('the gate reports the front-end line from the same file', async () => {
    const lines: string[] = []
    await gateMain(['--app', fx.dir, '--against', 'HEAD', '--no-cache'], { env: fx.env, cwd: fx.dir, log: (l: string) => lines.push(l), err: () => {} })
    expect(lines.some((l) => l.startsWith('front-end: FAIL (typecheck pass, test fail, build timeout)'))).toBe(true)
    console.log(lines.filter((l) => l.startsWith('front-end:')).join('\n'))
  }, 120000)

  test('a stale file (another commit) is refused with the reason', () => {
    put(fx.dir, 'src/more.js', 'export const c = 3\n')
    git(fx.dir, 'add', '-A')
    git(fx.dir, 'commit', '-q', '-m', 'second')
    const line = frontendGateLine(fx.env, fx.dir, fx.dir)
    expect(line).toMatch(/^front-end: results refused, frontend\.json is from commit [0-9a-f]{12} but HEAD is [0-9a-f]{12}; run meerkat frontend again$/)
    console.log(line)
  })

  test('no frontend run yet: the gate adds no line', () => {
    const other = fixture('nofile')
    expect(frontendGateLine(other.env, other.dir, other.dir)).toBeNull()
  })
})

describe('skips, trust and arguments', () => {
  test('missing keys are skipped with a line saying so, and all-pass exits 0', async () => {
    const fx = fixture('skips', { typecheck: 'node -e "process.exit(0)"' })
    const r = await run(fx.dir, fx.env, ['--app', fx.dir])
    expect(r.code).toBe(0)
    expect(r.lines).toContain('frontend test: skipped, the config defines no commands.test')
    expect(r.lines).toContain('frontend build: skipped, the config defines no commands.build')
    const dir = latestRunDirForFolder(fx.env, fx.dir, { preset: 'frontend' })
    expect(JSON.parse(readFileSync(join(dir, 'frontend.json'), 'utf8')).steps.map((s: any) => s.status)).toEqual(['pass', 'skipped', 'skipped'])
  })

  test('an untrusted config runs nothing, says so, and still writes the file', async () => {
    const fx = fixture('untrusted')
    const home = join(root, 'no-trust-home')
    const env = { ...fx.env, MEERKAT_TRUST_PROJECT: '0', MEERKAT_HOME: home, XDG_CONFIG_HOME: home, APPDATA: home }
    const r = await run(fx.dir, env, ['--app', fx.dir])
    expect(r.code).toBe(2)
    expect(r.errs[0]).toMatch(/^NOT RUN \(status 400\): .* is not trusted yet, so its commands did not run\. next: meerkat trust --app /)
    const dir = latestRunDirForFolder(env, fx.dir, { preset: 'frontend' })
    expect(JSON.parse(readFileSync(join(dir, 'frontend.json'), 'utf8')).steps.map((s: any) => s.status)).toEqual(['untrusted', 'untrusted', 'untrusted'])
  })

  test('{files} handling', () => {
    expect(testCommandFor('npm test', ['a.ts']).cmd).toBe('npm test')
    expect(testCommandFor('vitest run {files}', ['a.test.ts', 'b c.test.ts']).cmd).toBe('vitest run "a.test.ts" "b c.test.ts"')
    // A source file with no test file is left out, and when nothing is left the step is skipped (not a pass).
    expect(testCommandFor('vitest run {files}', ['a.ts']).skip).toMatch(/no test file/)
    expect(testCommandFor('vitest run {files}', []).cmd).toBe('vitest run')
    expect(testCommandFor('vitest run {files}', ['a";rm -rf x.test.ts']).skip).toMatch(/no test file/)
  })

  test('arguments', async () => {
    expect(parseFrontendArgs(['--app', 'x', '--files', 'a,b']).files).toEqual(['a', 'b'])
    expect(parseFrontendArgs(['--nope']).errors.length).toBe(1)
    const r = await runFrontend(['--app', join(root, 'does-not-exist')], { env: process.env, cwd: root, out: () => {}, err: () => {} })
    expect(r).toBe(2)
    expect(existsSync(root)).toBe(true)
  })
})
