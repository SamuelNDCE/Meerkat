// meerkat guide: every guideline fires on a bad change and stays quiet on a good one; --json and --explain behave; advisory output never changes an exit code.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runGuide } from '../lib/guidecmd.mjs'
// @ts-expect-error plain .mjs module
import { GUIDELINES } from '../lib/guidelines.mjs'
// @ts-expect-error plain .mjs module
import { makeRunDir } from '../lib/runlog.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bin = resolve(here, '..', 'bin', 'meerkat.mjs')
const root = mkdtempSync(join(tmpdir(), 'meerkat-guide-'))
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' }
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
const sh = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { encoding: 'utf8', env, cwd })
const git = (repo: string, ...a: string[]) => {
  const r = sh('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a])
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
}
type Files = Record<string, string>
const put = (repo: string, files: Files) => {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true })
    writeFileSync(join(repo, f), text)
  }
}
// A repo with a base commit on main, then a feature branch whose one commit holds `change` (message `msg`).
function fixture(change: Files, msg = 'add the parser for widget input', extra: Files = {}) {
  const repo = join(root, `r${++n}`)
  mkdirSync(repo)
  sh('git', ['init', '-q', '-b', 'main', repo])
  put(repo, { 'meerkat.config.json': '{"packs":[]}\n', 'README.md': '# app\n', 'keep.txt': 'x\n', ...extra })
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'initial commit of the app')
  git(repo, 'checkout', '-q', '-b', 'feature')
  put(repo, change)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', msg)
  return repo
}
async function guide(repo: string, ...args: string[]) {
  const o: string[] = []
  const e: string[] = []
  const code = await runGuide([repo, '--base', 'main', ...args], { env, cwd: repo, out: (t: string) => o.push(t), err: (t: string) => e.push(t) })
  return { code, out: o.join('\n'), err: e.join('\n') }
}
const statusOf = async (repo: string, id: string, ...args: string[]) => {
  const r = await guide(repo, '--json', ...args)
  expect(r.code).toBe(0)
  const g = JSON.parse(r.out).guidelines.find((x: { id: string }) => x.id === id)
  expect(g, id).toBeTruthy()
  return g.status as string
}
const many = (k: number): Files => Object.fromEntries(Array.from({ length: k }, (_, i) => [`f/${i}.txt`, `${i}\n`]))
// Built from pieces so this test file holds none of the patterns it plants.
const token = ['gh', 'p_', 'a'.repeat(36)].join('')
const homePath = ['C:', 'Users', 'someone', 'proj'].join('\\')

describe('each guideline fires on a bad change and stays quiet on a good one', () => {
  test('g-small-change', async () => {
    expect(await statusOf(fixture(many(16)), 'g-small-change')).toBe('ADVISORY')
    expect(await statusOf(fixture(many(2)), 'g-small-change')).toBe('PASS')
    expect(await statusOf(fixture({ 'big.txt': 'line\n'.repeat(900) }), 'g-small-change')).toBe('ADVISORY')
  })
  test('g-tests-with-code', async () => {
    expect(await statusOf(fixture({ 'lib/a.mjs': 'export const a = 1\n' }), 'g-tests-with-code')).toBe('ADVISORY')
    expect(await statusOf(fixture({ 'lib/a.mjs': 'export const a = 1\n', 'lib/a.test.ts': 'export {}\n' }), 'g-tests-with-code')).toBe('PASS')
  })
  test('g-no-secrets', async () => {
    expect(await statusOf(fixture({ 'conf.txt': `value ${token}\n` }), 'g-no-secrets')).toBe('ADVISORY')
    expect(await statusOf(fixture({ 'conf.txt': 'value from the environment\n' }), 'g-no-secrets')).toBe('PASS')
  })
  test('g-no-machine-paths', async () => {
    expect(await statusOf(fixture({ 'conf.txt': `path ${homePath}\n` }), 'g-no-machine-paths')).toBe('ADVISORY')
    expect(await statusOf(fixture({ 'conf.txt': 'path ./data\n' }), 'g-no-machine-paths')).toBe('PASS')
  })
  test('g-commit-message', async () => {
    for (const bad of ['wip', 'wip: more', 'fix stuff now', 'update']) expect(await statusOf(fixture({ 'a.txt': 'a\n' }, bad), 'g-commit-message'), bad).toBe('ADVISORY')
    expect(await statusOf(fixture({ 'a.txt': 'a\n' }, 'add the widget parser'), 'g-commit-message')).toBe('PASS')
  })
  test('g-verify-before-done', async () => {
    const bad = fixture({ 'a.txt': 'a\n' })
    expect(await statusOf(bad, 'g-verify-before-done')).toBe('ADVISORY')
    const good = fixture({ 'a.txt': 'a\n' })
    // the edit happened a minute ago; the recorded run is newer
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(good, 'a.txt'), past, past)
    expect(makeRunDir(env, 'run', new Date(), undefined, good, 'gate')).toBeTruthy()
    expect(await statusOf(good, 'g-verify-before-done')).toBe('PASS')
    // an edit after the run makes it stale again
    const later = new Date(Date.now() + 600_000)
    utimesSync(join(good, 'a.txt'), later, later)
    expect(await statusOf(good, 'g-verify-before-done')).toBe('ADVISORY')
  })
  test('g-no-generated-edits', async () => {
    const base: Files = { 'out.js': '// generated by tools/gen.mjs\nexport const x = 1\n', 'tools/gen.mjs': 'export {}\n' }
    const edited = fixture({ 'out.js': '// generated by tools/gen.mjs\nexport const x = 2\n' }, 'edit the output', base)
    expect(await statusOf(edited, 'g-no-generated-edits')).toBe('ADVISORY')
    const both = fixture({ 'out.js': '// generated by tools/gen.mjs\nexport const x = 2\n', 'tools/gen.mjs': 'export const y = 1\n' }, 'change the generator', base)
    expect(await statusOf(both, 'g-no-generated-edits')).toBe('PASS')
  })
  test('g-docs-with-behaviour', async () => {
    const cli: Files = { 'lib/cli.mjs': 'export const x = 1\n' }
    expect(await statusOf(fixture({ 'lib/cli.mjs': 'export const x = 2\n' }, 'change cli', cli), 'g-docs-with-behaviour')).toBe('ADVISORY')
    expect(await statusOf(fixture({ 'lib/cli.mjs': 'export const x = 2\n', 'docs/cli.md': 'x is 2\n' }, 'change cli', cli), 'g-docs-with-behaviour')).toBe('PASS')
    expect(await statusOf(fixture({ 'a.txt': 'a\n' }), 'g-docs-with-behaviour')).toBe('NOT CHECKED')
  })
  test('a guideline turned off in meerkat.config.json is NOT CHECKED with the reason', async () => {
    const repo = fixture({ 'a.txt': 'a\n' }, 'wip', {})
    put(repo, { 'meerkat.config.json': '{"packs":[],"guidelines":{"disable":["g-commit-message"]}}\n' })
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'turn one guideline off for this project')
    const r = await guide(repo, '--json')
    const g = JSON.parse(r.out).guidelines.find((x: { id: string }) => x.id === 'g-commit-message')
    expect(g.status).toBe('NOT CHECKED')
    expect(g.detail).toContain('guidelines.disable')
  })
})

describe('the guide command', () => {
  test('text output: every line names a rule id, and the guidelines list is complete', async () => {
    const r = await guide(fixture({ 'a.txt': 'a\n' }))
    expect(r.code).toBe(0)
    const lines = r.out.split('\n').slice(1) // the first line is the heading
    const ids = GUIDELINES.map((g: { id: string }) => g.id)
    expect(ids).toHaveLength(8)
    for (const l of lines.slice(0, -1)) expect(ids.some((id: string) => l.includes(id)), l).toBe(true)
    for (const id of ids) expect(r.out).toContain(id)
    expect(r.out).not.toContain('—')
  })
  test('--json is valid JSON with one entry per guideline', async () => {
    const r = await guide(fixture({ 'a.txt': 'a\n' }), '--json')
    const j = JSON.parse(r.out)
    expect(j.schema).toBe(1)
    expect(j.guidelines).toHaveLength(GUIDELINES.length)
    for (const g of j.guidelines) expect(['ADVISORY', 'PASS', 'NOT CHECKED']).toContain(g.status)
  })
  test('--explain prints rule, why and fix; an unknown id is exit 2 with a one-line message', async () => {
    const repo = fixture({ 'a.txt': 'a\n' })
    const ok = await guide(repo, '--explain', 'g-small-change')
    expect(ok.code).toBe(0)
    expect(ok.out).toMatch(/rule:[\s\S]*why:[\s\S]*fix:/)
    const bad = await guide(repo, '--explain', 'g-nope')
    expect(bad.code).toBe(2)
    expect(bad.err.trim().split('\n')).toHaveLength(1)
    expect((await guide(repo, '--bogus')).code).toBe(2)
  })
  test('outside a git repository nothing crashes: every guideline is NOT CHECKED and the exit code is 0', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    const r = await guide(plain, '--json')
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out).guidelines.every((g: { status: string }) => g.status === 'NOT CHECKED')).toBe(true)
  })
  test('the real binary dispatches guide', () => {
    const repo = fixture({ 'a.txt': 'a\n' })
    const r = sh('node', [bin, 'guide', repo, '--base', 'main'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('g-small-change')
  })
})

describe('advisory guidance never changes an exit code', () => {
  const gateCode = (repo: string) => {
    const r = sh('node', [bin, 'gate', '--base', 'main', '--app', repo, '--only-checks', 'secret-scan'], repo)
    return { code: r.status, summary: (r.stdout + r.stderr).split('\n').find((l) => l.startsWith('MEERKAT gate')) ?? '' }
  }
  test('meerkat gate on a fixture gives the same exit code before and after the guide ran, with advisories firing', async () => {
    const repo = fixture({ 'lib/a.mjs': 'export const a = 1\n' }, 'wip')
    const before = gateCode(repo)
    const g = JSON.parse((await guide(repo, '--json')).out)
    expect(g.advisory).toBeGreaterThan(0)
    const after = gateCode(repo)
    expect(after.code).toBe(before.code)
    expect(after.summary.replace(/[\d.]+s$/, '')).toBe(before.summary.replace(/[\d.]+s$/, ''))
  }, 120000)
  test('turning every guideline off does not change the gate exit code either', async () => {
    const repo = fixture({ 'lib/a.mjs': 'export const a = 1\n' }, 'wip')
    const loud = gateCode(repo)
    put(repo, { 'meerkat.config.json': JSON.stringify({ packs: [], guidelines: { disable: GUIDELINES.map((g: { id: string }) => g.id) } }) })
    const quiet = gateCode(repo)
    expect(quiet.code).toBe(loud.code)
  }, 120000)
  test('meerkat verdict gives the same exit code with and without advisories', async () => {
    const repo = fixture({ 'lib/a.mjs': 'export const a = 1\n' }, 'wip')
    const run = () => sh('node', [bin, 'verdict', repo, '--base', 'main'], repo).status
    const a = run()
    await guide(repo)
    expect(run()).toBe(a)
  }, 180000)
})
