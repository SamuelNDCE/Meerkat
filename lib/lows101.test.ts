// Low-severity CLI fixes (m101): exit codes of hook, finding, dismiss, fix, gate, map and brief; the unknown-command list; state files under the data folder;
// `ps` marking other sessions; and ascending progress counters. Every test runs the real bin/meerkat.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { EXTRA_WORDS } from './extras-words.mjs'
// @ts-expect-error plain .mjs module
import { allWords } from './help.mjs'
// @ts-expect-error plain .mjs module
import { gateProgress } from './gate.mjs'

const ROOT = join(__dirname, '..')
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
const root = mkdtempSync(join(tmpdir(), 'meerkat-lows101-'))
const logs = join(root, 'logs')
const home = join(root, 'home')
const env = { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: logs, MEERKAT_HOME: join(root, 'mhome'), HOME: home, USERPROFILE: home, MEERKAT_NO_PROJECT_CODE: '1' }
const cli = (args: string[], cwd = root, extra: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd, env: { ...env, ...extra }, timeout: 120000 })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const gitq = (cwd: string, ...a: string[]) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })

const plain = join(root, 'plain') // not a git repository
const repo = join(root, 'repo')
beforeAll(() => {
  mkdirSync(home, { recursive: true })
  mkdirSync(plain, { recursive: true })
  mkdirSync(repo, { recursive: true })
  gitq(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"1.0.0"}\n')
  writeFileSync(join(repo, 'a.js'), 'console.log(1)\n')
  gitq(repo, 'add', '-A')
  gitq(repo, 'commit', '-q', '-m', 'init')
}, 60000)
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe('B11 hook', () => {
  test('an unknown action exits 2 with the usage line, in or out of a git repository', () => {
    for (const cwd of [repo, plain]) {
      const r = cli(['hook', '--bogus'], cwd)
      expect(r.code).toBe(2)
      expect(r.err).toContain('usage: meerkat hook')
    }
    expect(cli(['hook'], repo).code).toBe(2)
  })
})

describe('B12 not-found ids exit 2', () => {
  test('finding, dismiss and undismiss of an id that is not there', () => {
    // A saved run is needed so the id lookup is what fails, not the missing run.
    const run = cli(['run', 'quick', repo, '--plain'], root)
    expect([0, 1]).toContain(run.code)
    for (const args of [['finding', 'zzzzzzzz', '--app', repo], ['dismiss', 'zzzzzzzz', '--reason', 'x', '--app', repo], ['undismiss', 'zzzzzzzz', '--app', repo]]) {
      const r = cli(args, repo)
      expect(r.code, args.join(' ')).toBe(2)
    }
  }, 180000)
  test('the exit-code table in docs/reference.md names the rule', () => {
    const doc = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', join(ROOT, 'docs', 'reference.md')], { encoding: 'utf8' }).stdout
    expect(doc).toContain('Exit codes by situation')
  })
})

describe('B13 unknown command list', () => {
  test('every word the dispatcher accepts is in the list', () => {
    const r = cli(['run', 'nosuchpreset'])
    expect(r.code).toBe(2)
    const line = (r.err.match(/^Commands: (.*)$/m)?.[1] ?? '').split(', ')
    for (const w of [...EXTRA_WORDS, ...allWords()]) expect(line, w).toContain(w)
    for (const w of ['verdict', 'top', 'handoff', 'fix', 'frontend', 'dismiss', 'team', 'baseline']) expect(line).toContain(w)
  })
})

describe('B14 fix with nothing to fix', () => {
  test('no run for the folder is a usage-style error (2); a bad option stays 2', () => {
    expect(cli(['fix', '--nope'], repo).code).toBe(2)
  })
  test('every finding without a fix: exit 0 and the line "no automatic fix available"', () => {
    const app = join(root, 'fixapp')
    mkdirSync(app, { recursive: true })
    gitq(app, 'init', '-q', '-b', 'main')
    writeFileSync(join(app, 'meerkat.config.json'), '{"packs":["security-plus"]}\n')
    writeFileSync(join(app, 'db.js'), "const db = require('some-orm')\ndb.query(`SELECT * FROM users WHERE id = ${req.params.id}`)\n")
    gitq(app, 'add', '-A')
    gitq(app, 'commit', '-q', '-m', 'init')
    const scan = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', app, '--only', 'sql-concat', '--plain'], { encoding: 'utf8', env })
    expect(scan.stdout).toContain('findings: 1')
    const r = cli(['fix'], app)
    expect(r.code).toBe(0)
    expect(r.out).toContain('no automatic fix available')
    expect(cli(['fix', 'zzzzzzzz'], app).code).toBe(2)
  }, 180000)
})

describe('B15 gate and map folders', () => {
  test('a folder that is not a git repository: said once, exit 2', () => {
    for (const w of ['gate', 'smoke']) {
      const r = cli([w], plain)
      expect(r.code).toBe(2)
      // The same line goes to stdout and stderr on purpose (lib/gate.mjs stop()): one distinct line, said once.
      expect(new Set(r.all.split('\n').filter((l) => l.includes('not a git repository'))).size).toBe(1)
    }
  })
  test('a missing folder says "folder does not exist", exit 2', () => {
    const r = cli(['gate', '--app', join(root, 'nope')])
    expect(r.code).toBe(2)
    expect(r.err).toContain('folder does not exist')
  })
  test('map takes a folder as a plain word', () => {
    const r = cli(['map', repo, '--check'], root)
    expect(r.out).not.toContain('unknown option')
    expect(r.err).not.toContain('unknown option')
    expect([0, 1]).toContain(r.code)
    expect(cli(['map', join(root, 'nope')]).code).toBe(2)
  })
})

describe('B16 brief targets', () => {
  test('a bare word says it is not a file (2); a missing file says file not found (2)', () => {
    const bare = cli(['brief', 'run'], repo)
    expect(bare.code).toBe(2)
    expect(bare.all).toContain('not a file: pass a path, or path#symbol')
    const missing = cli(['brief', 'nofile.js'], repo)
    expect(missing.code).toBe(2)
    expect(missing.all).toContain('file not found')
  })
})

describe('B18 state files stay in the data folder', () => {
  test('timings and history go under MEERKAT_LOG_DIR; nothing in HOME; no temp file left', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', repo, '--only', 'secret-scan', '--plain'], { encoding: 'utf8', env })
    expect([0, 1]).toContain(r.status)
    expect(existsSync(join(logs, 'timings.json'))).toBe(true)
    expect(existsSync(join(logs, 'history.json'))).toBe(true)
    expect(readdirSync(home).filter((f) => /^\.meerkat-(timings|history)/.test(f))).toEqual([])
    const left: string[] = []
    const walk = (d: string, depth = 0) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (depth < 3) walk(join(d, e.name), depth + 1)
        } else if (e.name.endsWith('.tmp')) left.push(join(d, e.name))
      }
    }
    walk(logs)
    expect(left).toEqual([])
  }, 180000)
})

describe('B19 ps marks other sessions', () => {
  test('a record from another data folder is labelled and not counted as stray', () => {
    const children = join(root, 'mhome', 'children')
    mkdirSync(children, { recursive: true })
    const slash = (p: string) => p.split(String.fromCharCode(92)).join('/')
    const mine = { pid: process.pid, ppid: 99999999, command: 'node mine.js', startedAt: Date.now(), runId: 'r1', logDir: slash(logs) }
    const other = { pid: process.ppid, ppid: 99999998, command: 'node other.js', startedAt: Date.now(), runId: 'r2', logDir: slash(join(root, 'elsewhere')) }
    writeFileSync(join(children, `${mine.pid}.json`), JSON.stringify(mine))
    writeFileSync(join(children, `${other.pid}.json`), JSON.stringify(other))
    const r = cli(['ps'])
    expect(r.code).toBe(0)
    const rows = r.out.split('\n')
    expect(rows.find((l) => l.includes('node other.js'))).toContain('[other session]')
    expect(rows.find((l) => l.includes('node mine.js'))).not.toContain('[other session]')
  })
})

describe('B20 progress counters ascend', () => {
  test('interleaved starts and finishes keep each counter ascending', () => {
    const lines: string[] = []
    const p = gateProgress(6, (l: string) => lines.push(l), 0)
    const checks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
    for (const c of checks) p.hooks.start(c)
    for (const c of [...checks].reverse()) p.hooks.settle(c, { status: 'PASS' }, 5)
    p.stop()
    const pick = (re: RegExp) => lines.map((l) => l.match(re)?.[1]).filter(Boolean).map(Number)
    expect(pick(/^\[(\d+)\/6\]/)).toEqual([1, 2, 3, 4, 5, 6])
    expect(pick(/^\[done (\d+)\/6\]/)).toEqual([1, 2, 3, 4, 5, 6])
  })
  test('the real gate prints ascending counters on stderr', () => {
    const feat = join(root, 'featrepo')
    mkdirSync(feat, { recursive: true })
    gitq(feat, 'init', '-q', '-b', 'main')
    writeFileSync(join(feat, 'package.json'), '{"name":"y","version":"1.0.0"}\n')
    writeFileSync(join(feat, 'a.js'), 'console.log(1)\n')
    gitq(feat, 'add', '-A')
    gitq(feat, 'commit', '-q', '-m', 'init')
    gitq(feat, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(feat, 'a.js'), 'console.log(2)\n')
    const r = cli(['gate', '--no-cache', '--no-input'], feat)
    const nums = (re: RegExp) => r.err.split('\n').map((l) => l.match(re)?.[1]).filter(Boolean).map(Number)
    const starts = nums(/^\[(\d+)\/\d+\]/)
    const dones = nums(/^\[done (\d+)\/\d+\]/)
    expect(starts.length).toBeGreaterThan(1)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(dones).toEqual([...dones].sort((a, b) => a - b))
  }, 240000)
})
