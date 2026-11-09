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
  const d = repo('gate-fx', { 'package.json': '{"name":"fx","version":"1.0.0","private":true}', 'a.js': 'export const a = 1\n', 'quick.js': "console.log('ok')\n", 'nap.js': 'setTimeout(() => {}, 120000)\n', 'meerkat.config.json': config })
  put(d, 'a.js', 'export const a = 2\n')

  test('one line per check start and finish, a still-running line, and a blocking count when the run is stopped', () => {
    const r = cli(['gate', '--no-cache', '--max-seconds', '30'], d)
    expect(r.err).toMatch(/\[\d+\/\d+\] quick \.\.\.\r?\n/)
    expect(r.err).toMatch(/\[done \d+\/\d+\] quick \.\.\. \d+\.\ds/)
    expect(r.err).toMatch(/running: nap \(\d+s\)/)
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
    put(root, 'hold.js', 'setTimeout(() => {}, 120000)\n')
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

describe('meerkat test-run', () => {
  const fake = [
    "const a = process.argv.slice(2).join(' ')",
    "if (a.includes('hangs')) { setInterval(() => {}, 1000) }",
    "else if (a.includes('fails')) { console.log(' FAIL  fails.test.ts > it breaks'); console.log(' Tests  1 failed | 1 passed | 1 skipped (3)'); process.exit(1) }",
    "else { console.log(' Tests  2 passed | 1 skipped (3)'); process.exit(0) }",
  ].join('\n') + '\n'
  const d = repo('testrun-fx', {
    'package.json': '{"name":"fx","version":"1.0.0","private":true}',
    'meerkat.config.json': JSON.stringify({ packs: [], commands: { test: 'node vitest-fake.mjs' } }),
    'vitest-fake.mjs': fake,
    'passes.test.ts': '',
    'fails.test.ts': '',
    'hangs.test.ts': '',
  })
  test('a passing file gives one PASS line', () => {
    const r = cli(['test-run', 'passes.test.ts'], d)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/PASS: 2 passed, 0 failed, 1 skipped in \d+\.\ds/)
  })
  test('a failing file gives FAIL, the failing names and a log path', () => {
    const r = cli(['test-run', 'fails.test.ts'], d)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAIL: 1 passed, 1 failed, 1 skipped|FAIL: 0 passed, 1 failed/)
    expect(r.out).toContain('fails.test.ts > it breaks')
    expect(r.out).toMatch(/log: .*test-run-\d+\.log/)
  })
  test('a hanging file is killed at --timeout 2 and reported as a timeout', () => {
    const t0 = Date.now()
    const r = cli(['test-run', 'hangs.test.ts', '--timeout', '2'], d)
    expect(r.code).toBe(124)
    expect(r.out).toMatch(/TIMEOUT: hangs\.test\.ts did not finish in 2s, .*killed/)
    expect(Date.now() - t0).toBeLessThan(30000)
  })
  test('a runner that cannot take one file is refused', () => {
    const x = repo('testrun-refuse', { 'meerkat.config.json': JSON.stringify({ packs: [], commands: { test: 'make check' } }), 'a.test.ts': '' })
    const r = cli(['test-run', 'a.test.ts'], x)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/not vitest, jest, cargo test or pytest/)
  })
})

describe('code-map queries', () => {
  const d = repo('mapq-fx', {
    'package.json': '{"name":"fx","version":"1.0.0","private":true,"type":"module"}',
    'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/lib/*"]}}}',
    'src/lib/util.js': 'export function computeTotal(a, b) {\n  return a + b\n}\nexport const other = 1\n',
    'src/app.js': "import { computeTotal } from './lib/util.js'\nimport { other } from '@lib/util.js'\n\nexport function run() {\n  return computeTotal(1, 2) + other\n}\n",
    'src/second.js': "import { computeTotal } from './lib/util.js'\n// computeTotal(9, 9) in a comment is not a call\nexport const v = computeTotal(3, 4)\n",
    'tests/util.test.js': "import { computeTotal } from '../src/lib/util.js'\nconsole.log(computeTotal(1, 1))\n",
    'tests/app.test.js': "// covers src/app.js by name\nconsole.log('app')\n",
  })
  test('who-calls lists file:line of each call site, not the declaration, import or comment', () => {
    const r = cli(['who-calls', 'computeTotal'], d)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/3 call sites of computeTotal/)
    expect(r.out).toMatch(/src\/app\.js:5/)
    expect(r.out).toMatch(/src\/second\.js:3/)
    expect(r.out).toMatch(/tests\/util\.test\.js:2/)
    expect(r.out).not.toMatch(/src\/lib\/util\.js:1/)
    expect(r.out).not.toMatch(/second\.js:2/)
  })
  test('who-calls not found says what was searched', () => {
    const r = cli(['who-calls', 'nothingHere'], d)
    expect(r.code).toBe(75)
    expect(r.out).toMatch(/no call of nothingHere\( found\. Searched the text of \d+ mapped files/)
  })
  test('deps lists the resolved imports, and the alias used', () => {
    const r = cli(['deps', 'src/app.js'], d)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/src\/app\.js imports 2 project files/)
    expect(r.out).toMatch(/\.\/lib\/util\.js\s+src\/lib\/util\.js/)
    expect(r.out).toMatch(/@lib\/util\.js\s+src\/lib\/util\.js\s+alias/)
    expect(cli(['deps', 'nope.js'], d).out).toMatch(/not in the code map\. Searched \d+ mapped files/)
  })
  test('tests-for lists the test that imports the file and the one that names it', () => {
    const u = cli(['tests-for', 'src/lib/util.js'], d)
    expect(u.code).toBe(0)
    expect(u.out).toMatch(/tests\/util\.test\.js\s+1\s+imports it/)
    const a = cli(['tests-for', 'src/app.js'], d)
    expect(a.out).toMatch(/tests\/app\.test\.js\s+1\s+names it/)
    const none = cli(['tests-for', 'src/second.js'], d)
    expect(none.code).toBe(75)
    expect(none.out).toMatch(/no test imports or names src\/second\.js\. Searched \d+ test files/)
  })
})


describe('an early stop is never a pass', () => {
  test('verdict and top say INCOMPLETE and exit non-zero when --max-seconds cuts the run', () => {
    const d = join(root, 'gate-fx')
    const v = cli(['verdict', '--max-seconds', '30', '--base', 'main'], d)
    expect(v.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished, \d+ blocking so far \(not a pass\)/)
    expect(v.out).not.toMatch(/^PASS/m)
    expect(v.code).toBe(75)
    const t = cli(['top', '--max-seconds', '30', '--base', 'main'], d)
    expect(t.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished/)
    expect(t.code).not.toBe(0)
  }, 240000)
})

describe('the verdict time limit keeps partial results', () => {
  test('a sleeping check and a 3 s limit print INCOMPLETE with counts and exit 75, not NO-RESULT alone', () => {
    const d = join(root, 'gate-fx')
    const v = cli(['verdict', '--base', 'main'], d, { MEERKAT_VERDICT_TIMEOUT_S: '30' })
    expect(v.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished, \d+ blocking so far \(not a pass\)/)
    expect(v.out).not.toMatch(/NO-RESULT/)
    expect(v.code).toBe(75)
    const t = cli(['top', '--base', 'main'], d, { MEERKAT_VERDICT_TIMEOUT_S: '30' })
    expect(t.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished/)
    expect(t.code).toBe(75)
  }, 90000)
})

describe('the verdict time limit default', () => {
  test('1500 seconds with nothing set, MEERKAT_VERDICT_TIMEOUT_S overrides it', async () => {
    // @ts-expect-error plain .mjs module
    const { HARD_SECONDS } = await import('./branchcmds.mjs')
    expect(HARD_SECONDS({})).toBe(1500)
    expect(HARD_SECONDS({ MEERKAT_VERDICT_TIMEOUT_S: '900' })).toBe(900)
    expect(HARD_SECONDS({ MEERKAT_VERDICT_TIMEOUT_S: 'x' })).toBe(1500)
  })
})

describe('the cargo lock wait limit', () => {
  test('a waiter with a 3 s limit gives up with exit 75 and names the holder, its command and how long it held', async () => {
    const { spawn, spawnSync: sp } = await import('node:child_process')
    const lockDir = join(root, 'limit.lock')
    const e = { ...env, MEERKAT_CARGO_LOCK_DIR: lockDir } as NodeJS.ProcessEnv
    const script = join(ROOT, 'lib', 'cargo-lock-run.mjs')
    put(root, 'hold2.js', 'setTimeout(() => {}, 120000)\n')
    const holder = spawn(process.execPath, [script, process.execPath, join(root, 'hold2.js')], { env: e, stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const t0 = Date.now()
      const w = sp(process.execPath, [script, process.execPath, join(root, 'quick.js')], { env: { ...e, MEERKAT_LOCK_MAX_WAIT: '3' }, encoding: 'utf8', timeout: 30000 })
      expect(w.status).toBe(75)
      expect(Date.now() - t0).toBeLessThan(15000)
      expect(String(w.stderr)).toMatch(/gave up after \d+ s \(limit 3 s.*\): the lock is still held by process \d+ running .*hold2\.js, held for \d+ s/)
      expect(String(w.stdout)).toMatch(/NOT RUN: waited 3 s/)
    } finally {
      holder.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }, 60000)
})

describe('a stop lists every blocking place', () => {
  test('a blocking check and a sleeping one: INCOMPLETE with the file:line, not NO-RESULT', () => {
    const config = JSON.stringify({ packs: [], discover: false, customChecks: [
      { id: 'blocker', title: 'Blocker', cmd: 'node', args: ['blocker.js'], tier: 'fast' },
      { id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 },
    ] })
    const d = repo('stop-fx', { 'package.json': '{"name":"fx","version":"1.0.0","private":true}', 'a.js': 'export const a = 1\n', 'blocker.js': "console.log('a.js:1: bad thing here'); process.exit(1)\n", 'nap.js': 'setTimeout(() => {}, 120000)\n', 'meerkat.config.json': config })
    put(d, 'a.js', 'export const a = 2\n')
    const v = cli(['verdict', '--base', 'main'], d, { MEERKAT_VERDICT_TIMEOUT_S: '30' })
    expect(v.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished, \d+ blocking so far/)
    expect(v.out).toMatch(/a\.js:1 blocker: bad thing here/)
    expect(v.out).not.toMatch(/NO-RESULT/)
    expect(v.err).toMatch(/running: nap \(\d+s\)/)
    expect(v.code).toBe(75)
  }, 90000)
})

describe('map queries read the working tree', () => {
  test('a file added on a branch after the map was saved is found by tests-for, and a stale saved map is named', () => {
    const d = repo('mapq-branch', {
      'package.json': '{"name":"fx","version":"1.0.0","private":true,"type":"module"}',
      'src/a.js': 'export function a() {}\n',
      'tests/a.test.js': "import { a } from '../src/a.js'\na()\n",
    })
    const first = cli(['map', '--quiet'], d)
    expect(first.code).toBe(0)
    git(d, 'checkout', '-q', '-b', 'feat')
    put(d, 'src/b.js', 'export function b() { return 1 }\n')
    put(d, 'tests/b.test.js', "import { b } from '../src/b.js'\nb()\n")
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'feat')
    const r = cli(['tests-for', 'src/b.js'], d)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/tests\/b\.test\.js\s+1\s+imports it/)
    expect(r.err).toMatch(/map: the last saved map is from commit [0-9a-f]{9}, HEAD is [0-9a-f]{9}, \d+ files? differ/)
    const w = cli(['who-calls', 'b'], d)
    expect(w.out).toMatch(/tests\/b\.test\.js:2/)
  }, 60000)
})

describe('a cargo lock wait is WAITING, not NO-RESULT', () => {
  test('a held lock and a 3 s limit: verdict, top and gate print WAITING and exit 75', async () => {
    const { spawn } = await import('node:child_process')
    const lockDir = join(root, 'waiting.lock')
    const e = { MEERKAT_CARGO_LOCK_DIR: lockDir, MEERKAT_LOCK_MAX_WAIT: '3' } as NodeJS.ProcessEnv
    const d = repo('waiting-fx', {
      'meerkat.config.json': JSON.stringify({ packs: ['rust'], discover: false }),
      'Cargo.toml': '[package]\nname = "fx"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn a() -> u32 { 1 }\n',
    })
    put(d, 'src/lib.rs', 'pub fn a() -> u32 { 2 }\n')
    put(root, 'hold3.js', 'setTimeout(() => {}, 60000)\n')
    const holder = spawn(process.execPath, [join(ROOT, 'lib', 'cargo-lock-run.mjs'), process.execPath, join(root, 'hold3.js')], { env: { ...env, ...e }, stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 1500))
    try {
      for (const word of ['verdict', 'top', 'gate']) {
        const r = cli([word, '--base', 'main'], d, e)
        expect(r.out, word).toMatch(/WAITING: cargo lock held by pid \d+ \(.*hold3\.js\), waited \d+s, limit 3s; not a result/)
        expect(r.out, word).not.toMatch(/NO-RESULT/)
        // gate exits 1 instead when another check in the pack found a real blocking finding; verdict and top put the lock wait first
        if (word === 'gate') expect([1, 75]).toContain(r.code)
        else expect(r.code, word).toBe(75)
      }
    } finally {
      holder.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }, 180000)
})

describe('the give-up line is safe to print', () => {
  test('an owner file with an ESC sequence and a non-integer pid prints no raw ESC and pid ?', async () => {
    const { spawnSync: sp } = await import('node:child_process')
    const lockDir = join(root, 'evil.lock')
    mkdirSync(lockDir, { recursive: true })
    // pid 0 counts as alive to process.kill (it signals the group), so the lock is held, and 0 is not a positive integer: it must print as ?
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 0, since: new Date().toISOString(), cmd: 'evil \u001b[31mRED\u001b]0;x\u0007 end' }))
    const w = sp(process.execPath, [join(ROOT, 'lib', 'cargo-lock-run.mjs'), process.execPath, join(root, 'quick.js')], { env: { ...env, MEERKAT_CARGO_LOCK_DIR: lockDir, MEERKAT_LOCK_MAX_WAIT: '2' }, encoding: 'utf8', timeout: 30000 })
    const all = String(w.stdout) + String(w.stderr)
    expect(w.status).toBe(75)
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    expect(all).toMatch(/held by process \? running evil/)
  }, 60000)
})

describe('INCOMPLETE names what did not run and labels unclassified findings', () => {
  test('a run stopped before the base comparison lists the unfinished checks and the findings are unclassified', () => {
    const d = join(root, 'stop-fx')
    const v = cli(['verdict', '--base', 'main'], d, { MEERKAT_VERDICT_TIMEOUT_S: '30' })
    expect(v.code).toBe(75)
    expect(v.out).toMatch(/INCOMPLETE \d+ of \d+ checks finished/)
    expect(v.out).toMatch(/not run \(\d+\): .*nap/)
    expect(v.out).toMatch(/unclassified \(base comparison did not finish\)/)
    expect(v.out.indexOf('unclassified')).toBeLessThan(v.out.indexOf('blocker: bad thing here'))
  }, 90000)
})
