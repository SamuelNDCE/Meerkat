// meerkat gate and meerkat smoke. The fixture is a real git repository built in a temp folder (never committed): one clean commit, then a change.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { EXIT, classify, gateFiles, gateMain, gateText, parseGateArgs, runGate, runSmoke } from './gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-gatefix-'))
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
const repo = (name: string) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'src/a.js', 'export const a = 1\n')
  put(d, 'docs/readme.md', '# hi\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'clean')
  return d
}

const base = { group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1 }
const node = (code: string) => ({ cmd: process.execPath, args: ['-e', code] })
const jsOk = { ...base, id: 'js-ok', title: 'js ok', paths: ['src/**/*.js'], run: () => ({ ok: true, detail: 'fine' }) }
const docsOk = { ...base, id: 'docs-ok', title: 'docs ok', paths: ['docs/**'], run: () => ({ ok: true, detail: 'fine' }) }
const rustOk = { ...base, id: 'rust-ok', title: 'rust ok', paths: ['**/*.rs'], run: () => ({ ok: true, detail: 'fine' }) }
const findings = { ...base, id: 'js-finds', title: 'finds', paths: ['src/**'], run: node('console.log("src/a.js:1 a finding"); process.exit(1)') }
const crashes = { ...base, id: 'js-crash', title: 'crashes', paths: ['src/**'], run: node('throw new Error("boom")') }
const exits3 = { ...base, id: 'js-exit3', title: 'exits 3', paths: ['src/**'], run: node('process.exit(3)') }
const hangs = { ...base, id: 'js-hang', title: 'hangs', paths: ['src/**'], run: node('setInterval(() => process.stdout.write("."), 100)') }
const quiet = { log: () => {}, env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1' } }

let dir: string
beforeAll(() => {
  dir = repo('changed')
  put(dir, 'src/a.js', 'export const a = 2\n')
})

describe('which files changed', () => {
  test('default: merge-base with main, working tree and new files included, unchanged files left out', () => {
    put(dir, 'src/new.js', 'x\n')
    expect(gateFiles(dir, {}).files?.sort()).toEqual(['src/a.js', 'src/new.js'])
  })
  test('staged: only the index', () => {
    git(dir, 'add', 'src/a.js')
    expect(gateFiles(dir, { staged: true }).files).toEqual(['src/a.js'])
  })
  test('--base on a branch: what the branch changed since main, plus the working tree', () => {
    const d = repo('branch')
    git(d, 'checkout', '-q', '-b', 'feature')
    put(d, 'docs/new.md', 'n\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'doc')
    put(d, 'src/a.js', 'export const a = 9\n')
    expect(gateFiles(d, { base: 'main' }).files?.sort()).toEqual(['docs/new.md', 'src/a.js'])
    expect(gateFiles(d, {}).files?.sort()).toEqual(['docs/new.md', 'src/a.js'])
  })
  test('--against compares directly with a ref', () => {
    const d = repo('against')
    const first = git(d, 'rev-parse', 'HEAD').trim()
    put(d, 'docs/more.md', 'm\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'more')
    expect(gateFiles(d, { against: first }).files).toEqual(['docs/more.md'])
    expect(gateFiles(d, { against: 'HEAD' }).files).toEqual([])
  })
  test('unknown ref and a folder outside git are errors, not an empty list', () => {
    expect(gateFiles(dir, { base: 'no-such-ref' }).error).toMatch(/does not know that ref/)
    expect(gateFiles(dir, { against: 'no-such-ref' }).error).toMatch(/does not know that ref/)
    const plain = mkdtempSync(join(root, 'plain-'))
    expect(gateFiles(plain, {}).error).toMatch(/not inside a git work tree/)
  })
})

describe('meerkat gate', () => {
  test('runs only the checks whose paths match the changed files', async () => {
    const d = repo('only')
    put(d, 'src/a.js', 'export const a = 3\n')
    const files = gateFiles(d, {}).files!
    const out = await runGate({ checks: [jsOk, docsOk, rustOk], files, repoRoot: d, ...quiet })
    expect(out.ran).toEqual(['js-ok'])
    expect(out.skipped.sort()).toEqual(['docs-ok', 'rust-ok'])
    expect(out.exitCode).toBe(EXIT.pass)
  })
  test('a check that finds a problem fails the gate with 1', async () => {
    const out = await runGate({ checks: [jsOk, findings], files: ['src/a.js'], repoRoot: dir, ...quiet })
    expect(out.rows.find((r) => r.id === 'js-finds')?.kind).toBe('fail')
    expect(out.exitCode).toBe(EXIT.fail)
  })
  test('a check that crashes is reported as a tool failure, not as a finding', async () => {
    const out = await runGate({ checks: [jsOk, crashes, exits3], files: ['src/a.js'], repoRoot: dir, ...quiet })
    expect(out.rows.find((r) => r.id === 'js-crash')?.kind).toBe('crash')
    expect(out.rows.find((r) => r.id === 'js-exit3')?.kind).toBe('crash')
    expect(out.rows.find((r) => r.id === 'js-ok')?.kind).toBe('pass')
    expect(out.exitCode).toBe(EXIT.fail)
  })
  test('nothing changed passes with a note; no checks loaded is 75, not a pass', async () => {
    const none = await runGate({ checks: [jsOk], files: [], repoRoot: dir, ...quiet })
    expect(none.exitCode).toBe(EXIT.pass)
    expect(none.note).toMatch(/nothing changed/)
    const empty = await runGate({ checks: [], files: ['src/a.js'], repoRoot: dir, ...quiet })
    expect(empty.exitCode).toBe(EXIT.notRun)
  })
  test('a check that cannot run (exit 75) makes the gate exit 75', async () => {
    const missing = { ...base, id: 'js-missing', title: 'missing tool', paths: ['src/**'], run: node('process.exit(75)') }
    const out = await runGate({ checks: [missing], files: ['src/a.js'], repoRoot: dir, ...quiet })
    expect(out.rows[0].kind).toBe('notrun')
    expect(out.exitCode).toBe(EXIT.notRun)
  })
})

describe('meerkat smoke', () => {
  test('a finding in the project is not a tool failure', async () => {
    const out = await runSmoke({ checks: [jsOk, findings], files: ['src/a.js'], repoRoot: dir, seconds: 5, ...quiet })
    expect(out.exitCode).toBe(EXIT.pass)
  })
  test('a crash fails the smoke test', async () => {
    const out = await runSmoke({ checks: [jsOk, crashes], files: ['src/a.js'], repoRoot: dir, seconds: 5, ...quiet })
    expect(out.rows.find((r) => r.id === 'js-crash')?.kind).toBe('crash')
    expect(out.exitCode).toBe(EXIT.fail)
  })
  test('a check that hangs past the tiny timeout fails the smoke test', async () => {
    const t0 = Date.now()
    const out = await runSmoke({ checks: [hangs], files: ['src/a.js'], repoRoot: dir, seconds: 1, ...quiet })
    expect(out.rows[0].kind).toBe('hang')
    expect(out.exitCode).toBe(EXIT.fail)
    expect(Date.now() - t0).toBeLessThan(15000)
  })
  test('zero checks selected for a non-empty change fails; an empty change does not', async () => {
    const zero = await runSmoke({ checks: [docsOk, rustOk], files: ['src/a.js'], repoRoot: dir, ...quiet })
    expect(zero.exitCode).toBe(EXIT.fail)
    expect(zero.note).toMatch(/zero checks were selected/)
    const empty = await runSmoke({ checks: [docsOk], files: [], repoRoot: dir, ...quiet })
    expect(empty.exitCode).toBe(EXIT.pass)
  })
})

describe('the command', () => {
  test('arguments: conflicts and missing values are usage errors', () => {
    expect(parseGateArgs(['--staged', '--base', 'x']).errors.join()).toMatch(/--staged cannot/)
    expect(parseGateArgs(['--base', 'x', '--against', 'y']).errors.join()).toMatch(/cannot be used together/)
    expect(parseGateArgs(['--base']).errors.join()).toMatch(/needs a value/)
    expect(parseGateArgs(['--timeout', '2'], { smoke: true }).seconds).toBe(2)
    expect(parseGateArgs(['--timeout', '2']).errors.join()).toMatch(/unknown option/)
  })
  test('a folder can be given positionally to gate and smoke, and an unknown option names the valid ones', () => {
    expect(parseGateArgs(['.'], { smoke: true })).toMatchObject({ app: '.', errors: [] })
    expect(parseGateArgs(['../x', '--staged'])).toMatchObject({ app: '../x', staged: true, errors: [] })
    expect(parseGateArgs(['a', 'b']).errors.join()).toMatch(/only one folder/)
    const e = parseGateArgs(['--nope'], { smoke: true }).errors.join()
    expect(e).toMatch(/unknown option --nope/)
    expect(e).toContain('--staged')
    expect(e).toContain('--timeout')
  })
  test('gateMain returns 2 for bad usage and 75 outside a git repo', async () => {
    const out: string[] = []
    const io = { log: (l: string) => out.push(l), err: (l: string) => out.push(l) }
    expect(await gateMain(['--bogus'], io)).toBe(EXIT.usage)
    const plain = mkdtempSync(join(root, 'cmd-'))
    expect(await gateMain(['--app', plain], { ...io, env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1' } })).toBe(EXIT.notRun)
  })
  test('classify: exit 1 with findings is a fail, exit 1 with a stack trace is a crash', () => {
    expect(classify({ status: 'FAIL', exitCode: 1 }, 'src/a.js:1 problem')).toBe('fail')
    expect(classify({ status: 'FAIL', exitCode: 1 }, 'Error: x\n    at f (file.js:3:9)')).toBe('crash')
    expect(classify({ status: 'FAIL', exitCode: null }, '')).toBe('crash')
    expect(classify({ status: 'FAIL', broken: true }, '')).toBe('crash')
  })
})

describe('gate output says what to do', () => {
  test('a failed gate ends with a next-step line, and an empty staging area says how to stage', async () => {
    const failing = { id: 'x', kind: 'fail', detail: 'src/a.js:1 bad', findings: [] }
    const text = gateText('gate', { exitCode: EXIT.fail, files: ['src/a.js'], rows: [failing], skipped: [], note: '' }, 'staged files')
    expect(text).toMatch(/\nnext: fix the checks listed under "in the files you changed"/)
    const old = gateText('gate', { exitCode: EXIT.fail, files: ['src/a.js'], rows: [{ id: 'y', kind: 'fail', detail: 'no SECURITY.md', findings: [] }], skipped: [], note: '' }, 'staged files')
    expect(old).toMatch(/\nnext: no failure points into the files you changed/)
    expect(gateText('gate', { exitCode: EXIT.pass, files: [], rows: [], skipped: [], note: '' }, 'd')).not.toMatch(/next:/)
    const none = await runGate({ checks: [jsOk], files: [], repoRoot: dir, ...quiet })
    expect(none.note).toMatch(/git add/)
  })
})
