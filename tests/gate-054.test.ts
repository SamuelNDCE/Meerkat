// 0.5.4 gate output: staged content, stale blockers, file:line, --format editor, the PASS line, the project-wide count, `run --preset`, quiet runs.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { editorLines, gateMain, gateText, placeLines } from '../lib/gate.mjs'
// @ts-expect-error plain JS module
import { planCommand } from '../lib/cli.mjs'

const NL = String.fromCharCode(10)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'meerkat-gate054-'))
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
const SQL = 'export function find(db, name) { return db.query("SELECT * FROM users WHERE name = " + name) }\n'
const repo = (name: string, packs = ['security-plus', 'repo', 'refactor']) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'meerkat.config.json', JSON.stringify({ packs, discover: false }))
  put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(d, 'src/index.js', "import './used.js'\n")
  put(d, 'src/used.js', 'export const used = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  return d
}
const logs = join(root, 'logs')
const env = () => ({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs })
async function gate(dir: string, args: string[]) {
  const lines: string[] = []
  const code = await gateMain(['--verbose', ...args, '--app', dir], { env: env(), cwd: dir, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
  return { code, text: lines.join(NL), lines }
}

describe('stale blocker (item 3)', () => {
  test('an old unused file does not block a change that does not touch it', async () => {
    const d = repo('stale')
    put(d, 'src/tag.js', 'export function tag() { return 1 }\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'tag, unused')
    put(d, 'src/used.js', 'export const used = 2\n')
    git(d, 'add', 'src/used.js')
    const r = await gate(d, ['--staged', '--no-cache', '--json'])
    const j = JSON.parse(r.text)
    expect(r.code).toBe(0)
    const unused = j.rows.find((x: any) => x.id === 'unused-files')
    expect(unused === undefined || unused.kind === 'wide' || unused.kind === 'pass', JSON.stringify(unused)).toBe(true)
  })
  test('when the change has its own unused file, only that one is listed as blocking; the old one is counted', async () => {
    const d = repo('stale2')
    put(d, 'src/tag.js', 'export function tag() { return 1 }\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'tag, unused')
    put(d, 'src/mine.js', 'export const mine = 1\n')
    git(d, 'add', 'src/mine.js')
    const r = await gate(d, ['--staged', '--no-cache'])
    expect(r.code).toBe(1)
    expect(r.text).toMatch(/src\/mine\.js/)
    expect(r.text).not.toMatch(/FAIL\s+unused-files\s+src\/tag\.js/)
    expect(r.text).toMatch(/1 more in files you did not change/)
  })
})

describe('staged content (item 4)', () => {
  test('--staged checks the staged version: removing the bug from the working tree does not hide it', async () => {
    const d = repo('staged')
    put(d, 'src/used.js', SQL)
    git(d, 'add', 'src/used.js')
    put(d, 'src/used.js', 'export const used = 1\n') // the working tree is clean again, the index is not
    const r = await gate(d, ['--staged', '--no-cache'])
    expect(r.code).toBe(1)
    expect(r.text).toMatch(/sql-concat/)
    expect(r.text).not.toMatch(/checks read the working tree/)
    expect(r.text).not.toMatch(/staged versions could not be exported/)
    // the temporary snapshot is gone and no worktree is left registered
    expect(git(d, 'worktree', 'list').split(NL).filter(Boolean).length).toBe(1)
  })
  test('the opposite: a bug only in the working tree is not blocked while the staged version is clean', async () => {
    const d = repo('staged2')
    put(d, 'src/used.js', 'export const used = 5\n')
    git(d, 'add', 'src/used.js')
    put(d, 'src/used.js', SQL)
    const r = await gate(d, ['--staged', '--no-cache'])
    expect(r.code).toBe(0)
  })
})

describe('file:line, editor format, PASS line, project-wide count (items 1, 5, 6)', () => {
  test('failures show file:line, or (no line) when the check does not know it', async () => {
    const d = repo('lines')
    put(d, 'src/bug.js', SQL)
    git(d, 'add', 'src/bug.js')
    const r = await gate(d, ['--staged', '--no-cache'])
    expect(r.text).toMatch(/src\/bug\.js:1 /)
    expect(r.text).toMatch(/src\/bug\.js \(no line\)/)
  })
  test('placeLines: line, no line, no file', () => {
    expect(placeLines({ places: [{ file: 'a.js', line: 3, message: 'm' }] })).toEqual(['    a.js:3  m'])
    expect(placeLines({ places: [{ file: 'a.js', line: 0, message: 'm' }] })).toEqual(['    a.js (no line)  m'])
    expect(placeLines({ places: [] })).toEqual(['    (no file, no line)'])
  })
  test('--format editor prints path:line:col: check: message and nothing else', async () => {
    const d = repo('editor')
    put(d, 'src/bug.js', SQL)
    git(d, 'add', 'src/bug.js')
    const r = await gate(d, ['--staged', '--no-cache', '--format', 'editor'])
    expect(r.code).toBe(1)
    expect(r.lines.length).toBeGreaterThan(0)
    for (const l of r.lines) expect(l).toMatch(/^[^:\s]+:\d+:\d+: [a-z0-9-]+: .+/)
    expect(r.lines.some((l) => /^src\/bug\.js:1:\d+: sql-concat: /.test(l))).toBe(true)
    expect(editorLines({ rows: [{ kind: 'pass', id: 'x' }] })).toEqual([])
  })
  test('a passing gate says so in one line', async () => {
    const d = repo('pass')
    put(d, 'src/used.js', 'export const used = 9\n')
    git(d, 'add', 'src/used.js')
    const r = await gate(d, ['--staged', '--no-cache'])
    expect(r.code).toBe(0)
    expect(r.text.split(NL).filter((l) => l.startsWith('PASS: '))).toEqual(['PASS: nothing blocking in 1 changed file(s)'])
  })
  test('project-wide items: full the first time, a count when unchanged, full again with --verbose', async () => {
    const d = repo('wide')
    put(d, 'src/used.js', 'export const used = 3\n')
    git(d, 'add', 'src/used.js')
    const first = await gate(d, ['--staged', '--no-cache'])
    expect(first.text).toMatch(/project-wide, not blocking \(\d+\)/)
    const second = await gate(d, ['--staged', '--no-cache'])
    expect(second.text).toMatch(/\d+ project-wide items, not blocking; "meerkat gate --verbose" lists them/)
    expect(second.text).not.toMatch(/package-fields:/)
    const third = await gate(d, ['--staged', '--no-cache', '--verbose'])
    expect(third.text).toMatch(/project-wide, not blocking \(\d+\)/)
  })
  test('gateText with showWide false folds the list into a count', () => {
    const out = { exitCode: 0, files: ['a.js'], skipped: [], rows: [{ kind: 'wide', id: 'lockfiles', detail: 'x' }, { kind: 'wide', id: 'node-engines', detail: 'y' }], note: '' }
    expect(gateText('gate', out, 'staged files', { verbose: true, showWide: false })).toMatch(/2 project-wide items, not blocking/)
    expect(gateText('gate', out, 'staged files', { verbose: true, showWide: true })).toMatch(/lockfiles: x/)
  })
})

describe('meerkat run --preset (item 7)', () => {
  const plan = (argv: string[]) => planCommand(argv, { cwd: root, env: {}, interactive: false, presets: {} })
  test('both forms work', () => {
    const a = plan(['run', 'quick'])
    const b = plan(['run', '--preset', 'quick'])
    expect(a).toMatchObject({ kind: 'run' })
    expect(b).toMatchObject({ kind: 'run' })
    expect(b.args).toEqual(a.args)
    expect(plan(['run', '--preset', 'quick', '--json']).args).toEqual(plan(['run', 'quick', '--json']).args)
  })
  test('the error names the right form', () => {
    for (const argv of [['run'], ['run', '--preset'], ['run', '--json']]) {
      const e = plan(argv)
      expect(e.kind).toBe('error')
      expect(e.message).toMatch(/meerkat run <preset>/)
    }
    expect(plan(['run', '--preset', 'nope']).kind).toBe('error')
  })
})

describe('quiet runs (item 8)', () => {
  test('run.mjs lists every check only with --verbose', () => {
    const d = repo('quiet', ['repo'])
    const run = (extra: string[]) => spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', d, '--preset', 'quick', '--plain', '--no-cache', ...extra], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' }, timeout: 120000 })
    const quiet = run([])
    const loud = run(['--verbose'])
    expect(existsSync(join(ROOT, 'run.mjs'))).toBe(true)
    expect(quiet.stdout).toMatch(/\d+ of \d+ checks passed \(--verbose lists every check/)
    expect(quiet.stdout.split(NL).length).toBeLessThan(loud.stdout.split(NL).length)
    expect(loud.stdout).not.toMatch(/checks passed \(--verbose lists every check/)
  }, 240000)
})
