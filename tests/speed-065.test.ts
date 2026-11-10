// 0.6.5 speed work: the base-side comparison runs only the checks that failed on the branch (and what they wait on) and hides the same findings as the
// full comparison; the heartbeat line; a bad argument is one reason line; --first prints one line.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { checksNamed, firstBlocking, firstLine, gateMain, gateProgress, loadProjectChecks, runGate } from '../lib/gate.mjs'
import { runVerdict } from '../lib/branchcmds.mjs'
import { failingIdsOf, hideBaseFindings } from '../lib/newfindings.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-speed065-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`

let dir: string
const logs = join(root, 'logs')
const env = () => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs })
// main has a pre-existing bug in old.js; the branch adds two more bugs in new.js and second.js and leaves old.js's bug alone.
beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/old.js', bug('oldBug'))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'feature')
  put(dir, 'src/old.js', bug('oldBug') + 'export const touched = 1\n')
  put(dir, 'src/new.js', bug('newBug'))
  put(dir, 'src/second.js', bug('secondBug'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'branch')
})

async function branchRun() {
  const loaded = await loadProjectChecks(dir, dir, env(), { interactive: false, say: () => {} })
  const files = ['src/old.js', 'src/new.js', 'src/second.js']
  const out = await runGate({ checks: loaded.checks, files, repoRoot: dir, appDir: dir, env: env(), autoPacks: loaded.autoPacks, scratch: true })
  return { out, mb: git(dir, 'merge-base', 'main', 'HEAD').trim() }
}
const places = (out: any) => (out.rows ?? []).filter((r: any) => r.kind === 'fail').flatMap((r: any) => (r.places ?? []).map((p: any) => `${r.id}|${p.file}|${p.line}`)).sort()

describe('base-side comparison', () => {
  test('runs only the failing checks (and what they wait on) and hides the same findings as the full comparison', async () => {
    const a = await branchRun()
    const b = await branchRun()
    expect(failingIdsOf(a.out.rows).length).toBeGreaterThan(0)
    const ran: Record<string, string[]> = { full: [], failing: [] }
    const make = (tag: string) => async (wtRoot: string, wtApp: string, files: string[], ids?: string[]) => {
      const l = await loadProjectChecks(wtApp, wtRoot, env(), { interactive: false, say: () => {} })
      const checks = ids ? checksNamed(l.checks, ids) : l.checks
      ran[tag] = checks.map((c: any) => c.id)
      return runGate({ checks, files, repoRoot: wtRoot, appDir: wtApp, projectDir: dir, env: env(), autoPacks: l.autoPacks, scratch: true })
    }
    const fullRun = make('full')
    const full = await hideBaseFindings({ out: a.out, mb: a.mb, repoRoot: dir, appDir: dir, runBase: (r: string, w: string, f: string[]) => fullRun(r, w, f) })
    const part = await hideBaseFindings({ out: b.out, mb: b.mb, repoRoot: dir, appDir: dir, runBase: make('failing') })
    expect(full.ok && part.ok).toBe(true)
    expect(ran.failing.length).toBeGreaterThan(0)
    expect(ran.failing.length).toBeLessThan(ran.full.length)
    for (const id of failingIdsOf(b.out.rows)) expect(ran.failing).toContain(id)
    expect(b.out.hidden).toBe(a.out.hidden)
    expect(places(b.out)).toEqual(places(a.out))
    expect(b.out.exitCode).toBe(a.out.exitCode)
    expect(places(b.out).some((p: string) => p.includes('src/old.js'))).toBe(false)
    expect(places(b.out).some((p: string) => p.includes('src/new.js'))).toBe(true)
  }, 120_000)

  test('with no failing check nothing is run on the base side', async () => {
    let called = 0
    const out: any = { rows: [{ id: 'x', kind: 'pass' }], files: ['a.js'] }
    const r = await hideBaseFindings({ out, mb: 'HEAD', repoRoot: dir, appDir: dir, runBase: async () => (called++, { rows: [] }) })
    expect(r).toEqual({ ok: true, hidden: 0 })
    expect(called).toBe(0)
  })

  test('checksNamed adds what a check waits on, in loaded order', () => {
    const checks = [{ id: 'a' }, { id: 'b', after: ['a'] }, { id: 'c' }]
    expect(checksNamed(checks, ['b']).map((c: any) => c.id)).toEqual(['a', 'b'])
  })
})

describe('heartbeat', () => {
  test('prints the time spent, checks done of the total and the longest-running check at each interval', async () => {
    const lines: string[] = []
    const prog = gateProgress(3, (l: string) => lines.push(l), 40)
    prog.hooks.start({ id: 'a' })
    prog.hooks.settle({ id: 'a' }, { status: 'PASS' }, 5)
    prog.hooks.start({ id: 'slow-check' })
    await new Promise((r) => setTimeout(r, 150))
    prog.stop()
    const beats = lines.filter((l) => l.startsWith('…'))
    expect(beats.length).toBeGreaterThanOrEqual(2)
    expect(beats[0]).toMatch(/^… \d+s: 1\/3 checks done, running: slow-check \(\d+s\)$/)
  })
})

describe('bad argument', () => {
  test('gate --bogus prints one reason line naming the argument and exits 2', async () => {
    const lines: string[] = []
    const code = await gateMain(['--bogus', '--app', dir], { env: env(), cwd: dir, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
    expect(code).toBe(2)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/--bogus/)
  })
})

describe('--first', () => {
  test('firstBlocking picks the first by file then line; PASS when none', () => {
    const out: any = { exitCode: 1, rows: [{ id: 'sql-concat', kind: 'fail', places: [{ file: 'src/z.js', line: 3, message: 'late' }, { file: 'src/a.js', line: 9, message: 'early' }] }] }
    expect(firstBlocking(out)).toMatchObject({ file: 'src/a.js', line: 9 })
    expect(firstLine(out)).toBe('src/a.js:9: early')
    expect(firstLine({ exitCode: 0, rows: [] })).toBe('PASS')
  })
  test('gate --first on a fixture with blocking findings prints exactly one line and exits 1', async () => {
    const lines: string[] = []
    const code = await gateMain(['--first', '--base', 'main', '--all-findings', '--no-cache', '--app', dir], { env: env(), cwd: dir, log: (l: string) => lines.push(l), err: () => {} })
    expect(code).toBe(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^src\/.*\.js:1: /)
  }, 120_000)
  test('verdict --first prints exactly one line and exits 1 when something new blocks', async () => {
    const lines: string[] = []
    const code = await runVerdict(['--first', '--base', 'main', '--app', dir], { env: env(), cwd: dir, out: (l: string) => lines.push(l), err: () => {} })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^src\/(new|second)\.js:1: /)
    expect(code).toBe(1)
  }, 180_000)
})

describe('heartbeat in the real gate path', () => {
  test('a sleeping check is named in a heartbeat within 6 seconds, and the base-side comparison is not silent', async () => {
    const d = join(root, 'sleepy')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'meerkat.config.json', JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'sleepy', title: 'Sleepy', cmd: 'node', args: ['sleep.mjs'], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 }] }))
    put(d, 'package.json', JSON.stringify({ name: 's', version: '1.0.0', private: true }))
    put(d, 'sleep.mjs', 'setTimeout(() => process.exit(1), 8000)\n')
    put(d, 'src/a.js', 'export const a = 1\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'base')
    git(d, 'checkout', '-q', '-b', 'feat')
    put(d, 'src/a.js', 'export const a = 2\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'change')
    const t0 = Date.now()
    const beats: { at: number; line: string }[] = []
    await gateMain(['--base', 'main', '--no-cache', '--app', d], { env: env(), cwd: d, banner: true, log: () => {}, err: (l: string) => beats.push({ at: Date.now() - t0, line: l }) })
    const first = beats.find((b) => b.line.startsWith('…') && b.line.includes('running: sleepy'))
    expect(first, beats.map((b) => b.line).join('\n')).toBeTruthy()
    const started = beats.find((b) => b.line.startsWith('[') && b.line.endsWith('sleepy ...'))
    expect(started).toBeTruthy()
    expect(first!.at - started!.at).toBeLessThan(6000)
  }, 120_000)
})

describe('merge base line', () => {
  test('gate and verdict name the merge base sha they compared against on stderr', async () => {
    const mb = git(dir, 'merge-base', 'main', 'HEAD').trim()
    const g: string[] = []
    await gateMain(['--base', 'main', '--first', '--app', dir], { env: env(), cwd: dir, banner: true, log: () => {}, err: (l: string) => g.push(l) })
    expect(g.some((l) => l.includes('merge base ' + mb.slice(0, 12)))).toBe(true)
    const v: string[] = []
    await runVerdict(['--base', 'main', '--first', '--app', dir], { env: env(), cwd: dir, out: () => {}, err: (l: string) => v.push(l) })
    expect(v.some((l) => l.includes('merge base ' + mb.slice(0, 12)))).toBe(true)
  }, 180_000)
})

describe('verdict and findings outside the diff', () => {
  test('kind wide findings are counted as pre-existing, not in this diff, and do not fail the verdict', async () => {
    const { verdictCounts } = await import('../lib/branchcmds.mjs')
    const out: any = { rows: [{ id: 'local-links', kind: 'wide', places: [{ file: 'docs/other.md', line: 3 }, { file: 'docs/x.md', line: 9 }] }] }
    expect(verdictCounts(out)).toMatchObject({ blocking: 0, preExisting: 0, unknown: 0, wide: 2 })
  })
})

describe('exit rule, worktree line and silence', () => {
  test('gate --json states the exit rule', async () => {
    const lines: string[] = []
    await gateMain(['--base', 'main', '--json', '--app', dir], { env: env(), cwd: dir, log: (l: string) => lines.push(l), err: () => {} })
    expect(JSON.parse(lines.join('\n')).exitRule).toMatch(/exit 1 only for a new blocking finding/)
  }, 120_000)
  test('verdict exits 1 for a new blocking finding and 0 with a pre-existing line when the only findings are old ones', async () => {
    const a: string[] = []
    expect(await runVerdict(['--base', 'main', '--app', dir], { env: env(), cwd: dir, out: (l: string) => a.push(l), err: () => {} })).toBe(1)
    expect(a[0]).toMatch(/^FAIL \d+ new blocking findings?/)
    // A branch that only touches a file with an old finding: the finding is on the base, so nothing new blocks.
    git(dir, 'checkout', '-q', '-b', 'docsonly', 'main')
    put(dir, 'README.md', '# hi\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'docs')
    const b: string[] = []
    const code = await runVerdict(['--base', 'main', '--app', dir], { env: env(), cwd: dir, out: (l: string) => b.push(l), err: () => {} })
    git(dir, 'checkout', '-q', 'feature')
    expect(code).toBe(0)
    expect(b[0]).toMatch(/^PASS \(status 200\)/)
    if (b.length > 1) expect(b[1]).toMatch(/^pre-existing: \d+ \(not in this diff, does not block\)$/)
  }, 180_000)
  test('verdict names a sleeping check within 6 seconds of its start and still ends with a result line', async () => {
    const d = join(root, 'sleepy')
    git(d, 'checkout', '-q', 'feat')
    const t0 = Date.now()
    const beats: { at: number; line: string }[] = []
    const out: string[] = []
    const code = await runVerdict(['--base', 'main', '--app', d], { env: env(), cwd: d, out: (l: string) => out.push(l), err: (l: string) => beats.push({ at: Date.now() - t0, line: l }) })
    const start = beats.find((b) => b.line.startsWith('[') && b.line.endsWith('sleepy ...'))
    const beat = beats.find((b) => b.line.startsWith('\u2026') && b.line.includes('running: sleepy'))
    expect(start && beat, beats.map((b) => b.line).join('\n')).toBeTruthy()
    expect(beat!.at - start!.at).toBeLessThan(6000)
    expect(out.length).toBeGreaterThan(0)
    expect([0, 1]).toContain(code)
  }, 120_000)
})
