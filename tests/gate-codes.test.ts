// Every gate outcome has one exit code that names its cause, and the first stdout line says the code's status and reason (the same text is on stderr).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { EXIT, gateMain, gateOutcome, runGate } from '../lib/gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-gatecodes-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const repo = (name: string) => {
  const d = join(root, name)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  writeFileSync(join(d, 'src/a.js'), 'export const a = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'clean')
  return d
}
const run = async (argv: any, cwd: string, extra: Record<string, string> = {}) => {
  const out: string[] = []
  const errs: string[] = []
  const logs = mkdtempSync(join(root, 'logs-'))
  const code = await gateMain(argv, { cwd, log: (l: string) => out.push(l), err: (l: string) => errs.push(l), env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs, ...extra } })
  return { code, out, errs, logs }
}

describe('gate exit codes name their cause', () => {
  test('(a) an unknown --base is exit 3, status 404, on the first stdout line and on stderr', async () => {
    const d = repo('a')
    const r = await run(['--base', 'origin/main'], d)
    expect(r.code).toBe(3)
    expect(r.out[0]).toMatch(/^NO-RESULT \(status 404\): origin\/main is not a branch or commit in this repository\. next: pass --base/)
    expect(r.errs).toContain(r.out[0])
  })
  test('(b) a folder that is not a git repository is exit 2, status 400', async () => {
    const d = mkdtempSync(join(root, 'plain-'))
    const r = await run(['--app', d], d)
    expect(r.code).toBe(2)
    expect(r.out[0]).toMatch(/^USAGE \(status 400\): .* is not a git repository/)
    expect(r.errs).toContain(r.out[0])
  })
  test('(b2) a bad flag is exit 2, status 400', async () => {
    const r = await run(['--bogus'], root)
    expect(r.code).toBe(2)
    expect(r.out[0]).toMatch(/^USAGE \(status 400\)/)
    expect(r.errs).toContain(r.out[0])
  })
  test('(c) no checks loaded is exit 3, status 204, with the fix line', async () => {
    const out = await runGate({ checks: [], files: ['src/a.js'], repoRoot: root })
    const oc = gateOutcome(out)
    expect(oc).toMatchObject({ code: 3, status: 204, word: 'NO-RESULT' })
    expect(oc.next).toBe('run meerkat init, or add a pack to meerkat.config.json')
  })
  test('(c2) nothing changed is exit 3, status 204', async () => {
    const d = repo('c2')
    const r = await run([], d)
    expect(r.code).toBe(3)
    expect(r.out[0]).toMatch(/^NO-RESULT \(status 204\): nothing changed/)
  })
  test('(d) a planted finding in a changed file is exit 1, status 422', async () => {
    const d = repo('d')
    writeFileSync(join(d, 'src/a.js'), 'export const a = 1\neval(process.argv[2])\n')
    const r = await run([], d)
    expect(r.code).toBe(1)
    expect(r.out.join('\n').split('\n')[0]).toMatch(/^MEERKAT gate: [1-9]\d* blocking.*\(status 422\)$/)
  }, 120000)
  test('(e) a cargo lock wait is exit 75, status 423', () => {
    const rows = [{ kind: 'notrun', id: 'rust-test', detail: 'waited 900 s for the lock; held by process 360 running cargo test --workspace; lock at x; another job' }]
    expect(gateOutcome({ exitCode: EXIT.notRun, rows })).toMatchObject({ code: 75, status: 423, word: 'INCOMPLETE' })
  })
  test('(e2) the time limit is 124/408, an interruption 130/499, a crashed tool 1/503, an unsaved record 75/500', () => {
    expect(gateOutcome({ exitCode: 75, rows: [{ kind: 'notrun', id: 'x', detail: 'run deadline reached' }] })).toMatchObject({ code: 124, status: 408 })
    expect(gateOutcome({ exitCode: 75, rows: [{ kind: 'notrun', id: 'x', detail: 'interrupted by you' }] })).toMatchObject({ code: 130, status: 499 })
    expect(gateOutcome({ exitCode: 1, rows: [{ kind: 'crash', id: 'x', detail: 'boom' }] })).toMatchObject({ code: 1, status: 503, word: 'TOOL PROBLEM' })
    expect(gateOutcome({ exitCode: 75, rows: [{ kind: 'notrun', id: 'x', detail: 'tool missing' }] })).toMatchObject({ code: 1, status: 503, word: 'TOOL PROBLEM' })
    expect(gateOutcome({ exitCode: 75, rows: [] })).toMatchObject({ code: 75, status: 500 })
  })
  test('(f) an internal error is exit 70, status 500, one stdout line, the stack in a log file only', async () => {
    const r = await run(null, root)
    expect(r.code).toBe(70)
    expect(r.out).toHaveLength(1)
    expect(r.out[0]).toMatch(/^ERROR \(status 500\): Meerkat itself failed \(.+\)\. Details: .*gate-error-.*\.log/)
    expect(r.errs).toEqual(r.out)
    const file = readdirSync(r.logs).find((f) => f.startsWith('gate-error-'))
    expect(file && existsSync(join(r.logs, file))).toBeTruthy()
    expect(readFileSync(join(r.logs, file!), 'utf8')).toMatch(/\n\s+at /)
    expect(r.out[0]).not.toMatch(/\n\s+at /)
  })
})
