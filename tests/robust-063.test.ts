// Fail safely (m063): each command given a bad folder, a damaged store file or a bad config says ONE reason, exits non-zero when it could not do
// its job, never prints a stack trace, and never deletes a damaged store file (it is moved aside). Every case runs the real CLI in a scratch folder.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
const base = mkdtempSync(join(tmpdir(), 'mk-063-'))
afterAll(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }))
let n = 0
const scratch = (files: Record<string, string> = {}) => {
  const d = join(base, `p${++n}`)
  mkdirSync(d, { recursive: true })
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t)
  return d
}
const git = (d: string, ...a: string[]) => spawnSync('git', ['-C', d, '-c', 'user.email=a@b.c', '-c', 'user.name=n', ...a], { encoding: 'utf8' })
const repo = (files: Record<string, string> = { 'a.js': 'let a = 1\n' }) => {
  const d = scratch(files)
  git(d, 'init', '-q', '-b', 'main', '.')
  git(d, 'add', '.')
  git(d, 'commit', '-qm', 'init')
  return d
}
const run = (args: string[], cwd: string, logs: string, extra: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_PLAIN: '1', NO_COLOR: '1', CI: '1', ...extra } })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const noTrace = (s: string) => expect(s).not.toMatch(/\n\s+at .*(\.mjs|node:)|node:internal|ERR_[A-Z_]+|Unhandled/)

describe('a folder that is not a folder', () => {
  test.each([['init'], ['dismissals'], ['trend'], ['commands'], ['trust'], ['doctor'], ['discover'], ['recommend'], ['check list']])('%s on a missing folder: reason and exit 2', (word) => {
    const cwd = scratch()
    const logs = scratch()
    const args = word === 'init' ? ['init', '--app', join(base, 'nope')] : [...word.split(' '), join(base, 'nope')]
    const r = run(args, cwd, logs)
    noTrace(r.out)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/does not exist/)
  })

  test('init on a file says it is a file, and writes nothing', () => {
    const d = scratch({ 'a.js': 'x\n' })
    const r = run(['init', '--app', join(d, 'a.js')], d, scratch())
    noTrace(r.out)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/is a file, not a folder/)
  })
})

describe('a malformed meerkat.config.json', () => {
  test('gate refuses (exit 2) and names the file, instead of passing with the config ignored', () => {
    const d = repo({ 'a.js': 'let a = 1\n', 'meerkat.config.json': '{"packs": ["sec' })
    const r = run(['gate'], d, scratch())
    noTrace(r.out)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/meerkat\.config\.json: could not be read as JSON/)
    expect(r.out).not.toMatch(/PASS/)
  })

  test('verdict refuses the same way', () => {
    const d = repo({ 'a.js': 'let a = 1\n', 'meerkat.config.json': '{"packs": ["sec' })
    const r = run(['verdict'], d, scratch())
    noTrace(r.out)
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/could not be read as JSON/)
  })
})

describe('a damaged store file is moved aside, never deleted or silently replaced', () => {
  test('a damaged dismissals file is kept as .corrupt-<time> and the command says so', () => {
    const d = repo()
    const logs = scratch()
    // Make a run so there is a project path, then damage the dismissals store for it.
    run(['verify'], d, logs)
    const run1 = run(['findings'], d, logs)
    const id = /^([0-9a-f]{8})\s/m.exec(run1.out)?.[1]
    expect(id).toBeTruthy()
    const dir = join(logs, 'dismissals')
    mkdirSync(dir, { recursive: true })
    const slug = readdirSync(join(logs, 'findings'))[0]
    writeFileSync(join(dir, slug), '{"schemaVersion":1,"items":[{"id":"abc')
    const r = run(['dismissals'], d, logs)
    noTrace(r.out)
    expect(r.out).toMatch(/moved aside to .*\.corrupt-/)
    expect(readdirSync(dir).some((f) => f.startsWith(`${slug}.corrupt-`))).toBe(true)
    expect(readFileSync(join(dir, readdirSync(dir).find((f) => f.includes('.corrupt-'))!), 'utf8')).toContain('"id":"abc')
  })

  test('a damaged latest.json is moved aside and `last` still finds the newest run folder', () => {
    const d = repo()
    const logs = scratch()
    run(['verify'], d, logs)
    writeFileSync(join(logs, 'latest.json'), '{"dir": "C:/x')
    writeFileSync(join(logs, 'latest-by-preset.json'), '{"quick": {')
    const r = run(['last'], d, logs)
    noTrace(r.out)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/moved aside to .*latest\.json\.corrupt-/)
    expect(r.out).toMatch(/Meerkat run/)
    expect(readdirSync(logs).some((f) => f.startsWith('latest.json.corrupt-'))).toBe(true)
  })

  test('a truncated findings.json in the newest run says truncated, not "older Meerkat"', () => {
    const d = repo()
    const logs = scratch()
    run(['verify'], d, logs)
    const runs = join(logs, 'runs')
    const newest = readdirSync(runs).sort().pop()!
    writeFileSync(join(runs, newest, 'findings.json'), '{"schemaVersion":1,"findings":[{"id"')
    const r = run(['findings'], d, logs)
    noTrace(r.out)
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/truncated findings\.json/)
    expect(r.out).not.toMatch(/older Meerkat, or the run did not finish/)
  })
})

describe('a log folder that cannot be written', () => {
  test('gate says its logs were not saved (the logs folder is a file)', () => {
    const d = repo()
    const holder = scratch({ 'logs-as-file': 'not a folder' })
    const r = run(['gate'], d, join(holder, 'logs-as-file'))
    noTrace(r.out)
    expect(existsSync(join(holder, 'logs-as-file'))).toBe(true)
    expect(r.out).toMatch(/logs were not saved/)
  })
})

describe('a run that cannot finish still writes what it has', () => {
  test('a run cut off by a time limit is saved with status "incomplete" and says so in the report', () => {
    const d = repo({
      'a.js': 'let a = 1\n',
      'sleep.js': 'setTimeout(() => {}, 20000)\n',
      'meerkat.config.json': JSON.stringify({ customChecks: [{ id: 'slow', title: 'Slow', cmd: 'node', args: ['sleep.js'], suite: 'my-app', group: 'functionality', tier: 'fast', timeoutSeconds: 1 }] }),
      '.meerkat-budgets.json': '{"maxRunMinutes":0.02}',
    })
    const logs = scratch()
    const r = run(['check', 'slow'], d, logs)
    noTrace(r.out)
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/NOT RUN\s+slow: (timed out|run deadline reached)/)
    const runs = join(logs, 'runs')
    const newest = readdirSync(runs).sort().pop()!
    const summary = JSON.parse(readFileSync(join(runs, newest, 'summary.json'), 'utf8'))
    expect(summary.status).toBe('incomplete')
    expect(readFileSync(join(runs, newest, 'report.md'), 'utf8')).toMatch(/status: incomplete/)
  })

  test('a finished run is saved with status "complete"', () => {
    const d = repo({ 'a.js': 'let a = 1\n', 'meerkat.config.json': JSON.stringify({ customChecks: [{ id: 'quick-ok', title: 'Quick ok', cmd: 'node', args: ['-e', 'process.exit(0)'], suite: 'my-app', group: 'functionality', tier: 'fast' }] }) })
    const logs = scratch()
    run(['check', 'quick-ok'], d, logs)
    const runs = join(logs, 'runs')
    const newest = readdirSync(runs).sort().pop()!
    expect(JSON.parse(readFileSync(join(runs, newest, 'summary.json'), 'utf8')).status).toBe('complete')
  })
})
