// 0.5.6 daily-use fixes: run identity (two projects with one folder name), a gate that saves a run, the ID column, summary first.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { planCommand } from './cli.mjs'
// @ts-expect-error plain .mjs module
import { findingsCommand, findingsTable } from './findingscmd.mjs'
// @ts-expect-error plain .mjs module
import { runExtra } from './extras-cli.mjs'
// @ts-expect-error plain .mjs module
import { saveFindings } from './findingsdoc.mjs'
// @ts-expect-error plain .mjs module
import { latestRunDir, makeRunDir, parseRunName, projectInfo, runProjectName } from './runlog.mjs'
// @ts-expect-error plain .mjs module
import { listRuns } from './runs.mjs'
// @ts-expect-error plain .mjs module
import { gateJson, gateText, runGate } from './gate.mjs'
// @ts-expect-error plain .mjs module
import { summaryLines } from './failsummary.mjs'

const made: string[] = []
const tmp = (p = 'meerkat-d056-') => {
  const d = mkdtempSync(join(tmpdir(), p))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const check = { id: 'risky', group: 'security', tier: 'fast', lane: 'free', title: 'Risky', pack: 'security', origin: 'bundled', run: { cmd: 'node', args: ['x'] } }
const failing = { id: 'risky', status: 'FAIL', ms: 5, detail: 'failed', suite: 'risky-calls', subs: [], logFile: null }

// Saves a real run for a project folder, the way a run does, in the run store of `env`.
function saveRunFor(env: any, appDir: string, message: string, label: string | null = null) {
  const dir = makeRunDir(env, 'fast', new Date(), undefined, appDir, label)!
  const sink = new Map([['risky', { findings: [{ severity: 'high', rule: 'r', file: 'src/a.js', line: 1, message }], output: '' }]])
  const saved = saveFindings({ dir, results: [failing], checks: [check], sink, appDir, env, version: '1.0.0', tier: 'fast', startedAtMs: Date.now(), ms: 10, note: () => {} })
  return { dir, saved }
}
const read = (env: any, cwd: string, argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const plan = planCommand(argv, { cwd, env })
  const code = plan.kind === 'noun' ? findingsCommand(plan, { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env, cwd }) : -1
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('run identity: two projects with one folder name', () => {
  const logs = tmp()
  const env = { ...process.env, MEERKAT_LOG_DIR: logs }
  const a = join(tmp(), 'repo')
  const b = join(tmp(), 'repo')
  put(a, 'src/a.js', 'a\n')
  put(b, 'src/a.js', 'b\n')
  const ra = saveRunFor(env, a, 'finding of project A')
  const rb = saveRunFor(env, b, 'finding of project B')

  test('the run folder name holds the basename and a hash of the full path, and the two differ', () => {
    const na = ra.dir.split('/').pop()
    const nb = rb.dir.split('/').pop()
    expect(na).not.toBe(nb)
    expect(parseRunName(na).project).toBe(projectInfo(a).id)
    expect(projectInfo(a).id).toMatch(/^repo-[0-9a-f]{6}$/)
    expect(runProjectName(parseRunName(na).project)).toBe('repo')
  })
  test('latestRunDir of a folder is that folder run, never the newest of any project', () => {
    expect(latestRunDir(env, a)).toBe(ra.dir)
    expect(latestRunDir(env, b)).toBe(rb.dir)
  })
  test('findings reads its own project', () => {
    expect(read(env, a, ['findings']).out).toContain('finding of project A')
    expect(read(env, a, ['findings']).out).not.toContain('project B')
    expect(read(env, b, ['findings']).out).toContain('finding of project B')
    expect(read(env, b, ['findings', '--app', a]).out).toContain('finding of project A')
  })
  test('finding, dismiss and undismiss act on the run of this folder', () => {
    const idB = rb.saved.doc.findings[0].id
    expect(read(env, b, ['finding', idB.slice(0, 8)]).code).toBe(0)
    expect(read(env, a, ['finding', idB.slice(0, 8)]).code).toBe(1) // that id is not in A's run
    const out: string[] = []
    const err: string[] = []
    const code = runExtra(['dismiss', idB.slice(0, 8), '--reason', 'test'], { env, cwd: b, out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
    expect(code).toBe(0)
    expect(out.join('\n')).toContain(rb.dir.split('/').pop())
    const out2: string[] = []
    expect(runExtra(['undismiss', idB.slice(0, 8)], { env, cwd: b, out: (t: string) => out2.push(t), err: () => {} })).toBe(0)
  })
  test('dismiss takes an optional run after the id', () => {
    const idA = ra.saved.doc.findings[0].id
    const name = ra.dir.split('/').pop()!
    const out: string[] = []
    // run from B's folder, naming A's run: it reads A's run, not B's
    expect(runExtra(['dismiss', idA.slice(0, 8), name, '--reason', 'named run'], { env, cwd: b, out: (t: string) => out.push(t), err: () => {} })).toBe(0)
    expect(out.join('\n')).toContain(name)
    runExtra(['undismiss', idA.slice(0, 8), name], { env, cwd: b, out: () => {}, err: () => {} })
  })
  test('run list defaults to this folder', () => {
    expect(listRuns(env, { folder: a }).map((r: any) => r.dir)).toEqual([ra.dir])
    expect(listRuns(env, {}).length).toBe(2)
  })
})

describe('the findings table has an ID column', () => {
  test('header and a short id that still resolves by prefix', () => {
    const t = findingsTable([{ id: 'abcdef0123456789', severity: 'high', rule: 'r', check: 'c', file: 'a.js', line: 3, message: 'm', status: 'new' }])
    expect(t.split('\n')[0]).toMatch(/^ID\s+SEVERITY\s+RULE\s+WHERE\s+WHAT\s+STATUS$/)
    expect(t.split('\n')[1]).toMatch(/^abcdef01\s+high/)
  })
})

describe('summary first', () => {
  test('500 findings give a summary under 2 KB', () => {
    const lines = summaryLines({ checks: [{ id: 'line-length', count: 480 }, { id: 'a', count: 15 }, { id: 'b', count: 5 }], runFolder: '/logs/runs/x' })
    const text = lines.join('\n')
    expect(text.length).toBeLessThan(2048)
    expect(lines[0]).toBe('summary: 500 blocking finding(s) in 3 failed check(s)')
    expect(text).toContain('line-length (480)')
    expect(text).toContain('/logs/runs/x')
  })
  test('the gate text starts with the summary and is cut unless --full; the json is compact', () => {
    const places = Array.from({ length: 500 }, (_, i) => ({ file: `src/f${i}.js`, line: 1, col: 0, message: 'line is 200 characters long' }))
    const rows = [{ id: 'line-length', kind: 'fail', detail: 'src/f0.js:1 too long', ms: 1, findings: places, places, files: ['src/f0.js'] }]
    const out: any = { exitCode: 1, files: ['src/f0.js'], rows, ran: ['line-length'], skipped: [], note: '', logDir: '/logs/runs/x', runDir: '/logs/runs/x', ms: 100 }
    const text = gateText('gate', out, 'changed files')
    expect(text.split('\n')[2]).toMatch(/^summary: 500 blocking/)
    expect(text.length).toBeLessThan(2048)
    const j = gateJson('gate', 'changed files', out)
    expect(JSON.stringify(j).length).toBeLessThan(2048)
    expect(j.status).toBe('failed')
    expect(j.blocking).toBe(500)
    expect(j.rows[0].findings).toBeUndefined()
    expect(gateJson('gate', 'x', out, true).rows[0].findings.length).toBe(500)
  })
})

describe('a gate saves a run', () => {
  const git = (dir: string, ...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  test('gate, then findings, finding and dismiss work on it', async () => {
    const logs = tmp()
    const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' }
    const d = join(tmp(), 'gated')
    put(d, 'src/a.js', 'export const a = 1\n')
    git(d, 'init', '-q', '-b', 'main')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'clean')
    put(d, 'src/a.js', 'export const a = 2\n')
    const finds = { group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, id: 'js-finds', title: 'finds', paths: ['src/**'], run: { cmd: process.execPath, args: ['-e', 'console.log("src/a.js:1 a gate finding"); process.exit(1)'] } }
    const out = await runGate({ checks: [finds], files: ['src/a.js'], repoRoot: d, log: () => {}, env })
    expect(out.exitCode).toBe(1)
    expect(out.runId).toBeTruthy()
    expect(existsSync(join(out.runDir, 'findings.json'))).toBe(true)
    expect(existsSync(join(out.runDir, 'summary.json'))).toBe(true)
    expect(readdirSync(join(logs, 'runs'))).toContain(out.runId)
    const listed = read(env, d, ['findings'])
    expect(listed.code).toBe(0)
    expect(listed.out).toContain('a gate finding')
    const id = listed.out.split('\n').find((l: string) => l.includes('a gate finding'))!.trim().split(/\s+/)[0]
    expect(id).toMatch(/^[0-9a-f]{8}$/)
    expect(read(env, d, ['finding', id]).code).toBe(0)
    const say: string[] = []
    expect(runExtra(['dismiss', id, '--reason', 'known'], { env, cwd: d, out: (t: string) => say.push(t), err: (t: string) => say.push(t) })).toBe(0)
  })
})
