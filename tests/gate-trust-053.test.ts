// Meerkat 0.5.3, first batch: the gate adds every pack that applies (P1.1), a project's own code needs a one-time trust (P1.2), a
// self-test is never "the last run" (P1.5), and the gate prints failures plus one summary line by default (P3.11).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { gateMain, gateText, loadProjectChecks } from '../lib/gate.mjs'
// @ts-expect-error plain .mjs module
import { initConfig } from '../lib/init.mjs'
// @ts-expect-error plain .mjs module
import { applyConfig } from '../lib/config.mjs'
// @ts-expect-error plain .mjs module
import { hashFiles, makeTrust, projectCodeFiles, promptText, trustedFiles, trustFile } from '../lib/trust.mjs'
// @ts-expect-error plain .mjs module
import { latestRunDir, makeRunDir, usedRunLine, writeRunReport } from '../lib/runlog.mjs'
// @ts-expect-error plain .mjs module
import { findingsCommand } from '../lib/findingscmd.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-053a-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}

describe('P1.1 the gate adds every pack that applies', () => {
  test('after `meerkat init` (packs security + hygiene), a staged SQL concatenation is blocking', async () => {
    const dir = join(root, 'inited')
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
    put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
    expect(initConfig(dir).written).toBe(true)
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'clean')
    put(dir, 'src/bug.js', 'export function find(db, name) { return db.query("SELECT * FROM users WHERE name = " + name) }\n')
    git(dir, 'add', 'src/bug.js')
    const lines: string[] = []
    const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs-a') }
    const code = await gateMain(['--staged', '--no-cache', '--app', dir], { env, cwd: dir, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/FAIL\s+sql-concat \(1\)/)
  })
})

describe('P1.2 a project\'s own code needs a one-time trust', () => {
  const project = () => {
    const d = mkdtempSync(join(root, 'proj-'))
    put(d, 'mychecks/a.mjs', 'export default []\n')
    return d
  }
  const env = () => ({ ...process.env, MEERKAT_LOG_DIR: mkdtempSync(join(root, 'trust-')) }) as NodeJS.ProcessEnv
  const stub = async () => [{ id: 'mine', title: 'Mine', group: 'x', tier: 'fast', run: { cmd: 'node', args: ['-v'] } }]

  test('without a terminal nothing is asked and the code is refused, with a message', async () => {
    const d = project()
    const said: string[] = []
    const trust = makeTrust(env(), { interactive: false, say: (l: string) => said.push(l) })
    const applied = await applyConfig([], { packs: [], extraChecks: ['mychecks'] }, { file: join(d, 'meerkat.config.json'), projectDir: d, load: stub, trust })
    expect(applied.checks.some((c: any) => c.id === 'mine')).toBe(false)
    expect(said.join('\n')).toMatch(/NOT run|was NOT run/)
    expect(applied.notes.join('\n')).toMatch(/NOT run/)
  })
  test('with a terminal and a yes, the code runs, the answer is remembered, and a changed file asks again', async () => {
    const d = project()
    const e = env()
    const asked: string[] = []
    const yes = makeTrust(e, { interactive: true, ask: async (q: string) => (asked.push(q), 'y'), say: () => {} })
    const run = (trust: any) => applyConfig([], { packs: [], extraChecks: ['mychecks'] }, { file: join(d, 'meerkat.config.json'), projectDir: d, load: stub, trust })
    expect((await run(yes)).checks.some((c: any) => c.id === 'mine')).toBe(true)
    expect(asked.length).toBe(1)
    // remembered: a non-interactive run is now trusted
    expect((await run(makeTrust(e, { interactive: false, say: () => {} }))).checks.some((c: any) => c.id === 'mine')).toBe(true)
    expect(trustFile(e)).toContain('trust.json')
    // changed file: the record no longer matches, and with no terminal it is refused again
    put(d, 'mychecks/a.mjs', 'export default [] // changed\n')
    expect((await run(makeTrust(e, { interactive: false, say: () => {} }))).checks.some((c: any) => c.id === 'mine')).toBe(false)
  })
  test('answering no keeps the code out', async () => {
    const d = project()
    const trust = makeTrust(env(), { interactive: true, ask: async () => 'n', say: () => {} })
    const applied = await applyConfig([], { packs: [], extraChecks: ['mychecks'] }, { file: join(d, 'meerkat.config.json'), projectDir: d, load: stub, trust })
    expect(applied.checks.some((c: any) => c.id === 'mine')).toBe(false)
  })
})

describe('P1.2 follow-ups: same file list as the loader, import closure, safe prompt', () => {
  test('a .git*.mjs check file is in the trusted list, because the loader imports it', () => {
    const d = mkdtempSync(join(root, 'dot-'))
    put(d, 'mychecks/.gitsneaky.mjs', 'export default []\n')
    put(d, 'mychecks/a.mjs', 'export default []\n')
    const files = projectCodeFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] }).map((f: string) => basename(f))
    expect(files).toEqual(['.gitsneaky.mjs', 'a.mjs'])
  })
  test('changing a helper that a check imports changes the hash, so trust is invalidated', () => {
    const d = mkdtempSync(join(root, 'imp-'))
    put(d, 'mychecks/a.mjs', "import { h } from '../helpers/h.js'\nexport default []\n")
    put(d, 'helpers/h.js', "import './deep.js'\nexport const h = 1\n")
    put(d, 'helpers/deep.js', 'export const d = 1\n')
    const files = projectCodeFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] })
    const before = hashFiles(files, d)
    put(d, 'helpers/deep.js', 'export const d = 2 // changed\n')
    expect(hashFiles(files, d)).not.toBe(before)
  })
  test('a sibling reached only by a non-literal dynamic import still changes the hash when it changes', () => {
    const d = mkdtempSync(join(root, 'dyn-'))
    put(d, 'package.json', '{}')
    put(d, 'mychecks/a.mjs', 'const n = "side"; export default (await import("./" + n + ".txt.mjs"), [])' + String.fromCharCode(10))
    put(d, 'mychecks/side.txt.mjs', 'export const x = 1' + String.fromCharCode(10))
    const args = { projectDir: d, where: d, extraChecks: ['mychecks'] }
    const before = hashFiles(trustedFiles(args).files, d)
    put(d, 'mychecks/side.txt.mjs', 'export const x = 2' + String.fromCharCode(10))
    expect(hashFiles(trustedFiles(args).files, d)).not.toBe(before)
    const mid = hashFiles(trustedFiles(args).files, d)
    put(d, 'package.json', '{"a":1}')
    expect(hashFiles(trustedFiles(args).files, d)).not.toBe(mid)
  })
  test('a symlinked folder inside a check folder refuses trust (and a loop does not hang)', () => {
    const d = mkdtempSync(join(root, 'loop-'))
    put(d, 'mychecks/a.mjs', 'export default []')
    put(d, 'outside/secret.txt', 'x')
    try {
      symlinkSync(join(d, 'mychecks'), join(d, 'mychecks', 'self'), 'junction')
      symlinkSync(join(d, 'outside'), join(d, 'mychecks', 'out'), 'junction')
    } catch {
      return // this machine may not allow links: nothing to test
    }
    const r = trustedFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] })
    expect(r.refuse).toMatch(/symlinked folder/)
    expect(r.files).toEqual([])
  })
  test('a cap hit refuses trust and names the cap', async () => {
    const d = mkdtempSync(join(root, 'cap-'))
    for (let i = 0; i < 4; i++) put(d, 'mychecks/f' + i + '.mjs', 'export default []')
    expect(trustedFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] }, { maxFiles: 2 }).refuse).toMatch(/file count cap/)
    expect(trustedFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] }, { maxBytes: 10 }).refuse).toMatch(/size cap/)
    const said: string[] = []
    const t = await makeTrust({ ...process.env, MEERKAT_LOG_DIR: join(d, 'l') } as any, { interactive: true, ask: async () => 'y', say: (l: string) => said.push(l), caps: { maxFiles: 2 } })({ projectDir: d, where: d, extraChecks: ['mychecks'] })
    expect(t.trusted).toBe(false)
    expect(said.join(' ')).toMatch(/file count cap/)
  })
  test('a node_modules inside a check folder refuses trust', () => {
    const d = mkdtempSync(join(root, 'nm-'))
    put(d, 'mychecks/a.mjs', 'export default []')
    put(d, 'mychecks/node_modules/p/index.js', 'x')
    expect(trustedFiles({ projectDir: d, where: d, extraChecks: ['mychecks'] }).refuse).toMatch(/node_modules/)
  })
  test('the prompt strips escape sequences from file names and the project path', () => {
    const t = promptText(['/p/evil\u001b[2Jname.mjs'], '/p\u001b]0;x\u0007')
    expect(t).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/)
    expect(t).toContain('evil')
  })
})

describe('gate default preset (bugs)', () => {
  test('the default gate leaves out quick-only style checks such as markdownlint; --all keeps them', async () => {
    const d = mkdtempSync(join(root, 'preset-'))
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
    put(d, 'README.md', '# x\n')
    const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1' }
    const ids = async (all: boolean) => (await loadProjectChecks(d, d, env, { interactive: false, all })).checks.map((c: any) => c.id)
    const withAll = await ids(true)
    const byDefault = await ids(false)
    expect(withAll).toContain('markdownlint')
    expect(byDefault).not.toContain('markdownlint')
  })
})

describe('P1.5 a self-test is never the last run', () => {
  test('run a preset, then a self-test: latestRunDir and `finding` read the first run, and say which run they used', () => {
    const env = { MEERKAT_LOG_DIR: join(root, 'logs-runs') } as any
    const app = join(root, 'myapp')
    mkdirSync(app, { recursive: true })
    const report = (preset: string | null, runKey: string | null, stamp: Date) => {
      const dir = makeRunDir(env, 'fast', stamp, undefined, app, preset ?? 'quick')!
      writeRunReport({ dir, tier: 'fast', preset: preset ?? undefined, runKey, results: [{ id: 'lint', status: 'PASS', ms: 5 }], line: 'ok', exitCode: 0, ms: 10, env, appDir: app })
      return dir
    }
    const first = report('security', null, new Date(2026, 10, 1, 10, 0, 0))
    const second = report(null, 'self-test', new Date(2026, 10, 1, 10, 5, 0))
    expect(latestRunDir(env)).toBe(first)
    expect(latestRunDir(env)).not.toBe(second)
    expect(usedRunLine(first)).toMatch(/^using run .+ \(preset security\)$/)
    const errs: string[] = []
    const code = findingsCommand({ noun: 'finding', id: 'abcd', flags: {} }, { out: () => {}, err: (t: string) => errs.push(t), env })
    expect(code).toBe(2)
    expect(errs.join('\n')).toMatch(/No run has been saved for|20261101/) // read from another folder: it names that folder, never another project's run
    expect(errs.join('\n')).not.toContain(basename(second))
  })
})

describe('P3.11 gate output is failures plus one summary line by default', () => {
  const out = {
    exitCode: 1,
    files: ['a.js'],
    ran: ['p1', 'f1'],
    skipped: [],
    all: false,
    ms: 1000,
    rows: [
      { id: 'passing-check', kind: 'pass', detail: '', findings: [] },
      { id: 'failing-check', kind: 'fail', detail: 'a.js:1 bad', findings: [], files: ['a.js'] },
      { id: 'unconfigured-check', kind: 'skipped', detail: 'no config', findings: [] },
    ],
  }
  test('default lists the failure and the summary, not the passes', () => {
    const t = gateText('gate', out, 'staged files')
    expect(t).toContain('failing-check')
    expect(t).not.toMatch(/PASS\s+passing-check/)
    expect(t).not.toContain('unconfigured-check')
    expect(t).toMatch(/MEERKAT gate: 1 blocking, 0 pre-existing \(not in the change\), 1 passed, 0 not run, exit 1/)
    expect(gateText('gate', out, 'staged files', { verbose: true })).toMatch(/gate: 1 passed, 1 failed, 0 tool failure\(s\), 0 not run, 1 not configured, exit 1/)
  })
  test('--verbose (verbose: true) lists every check again', () => {
    const t = gateText('gate', { ...out, all: true }, 'staged files', { verbose: true })
    expect(t).toMatch(/PASS\s+passing-check/)
    expect(t).toMatch(/SKIPPED\s+unconfigured-check/)
  })
})
