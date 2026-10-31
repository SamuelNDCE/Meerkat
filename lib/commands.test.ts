// Planning and doing the managing commands: check, preset, pack, run, doctor, mcp. Temp folders and fakes only.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { planCommand } from './cli.mjs'
import { execute } from './commands.mjs'
import { doctorReport } from './doctor.mjs'
import { mcpInstall, mcpStatus } from './mcpinstall.mjs'
import { listPacks, setPack } from './packs.mjs'
import { listRuns, openRun, runLog, showRun } from './runs.mjs'

const cwd = resolve('/work/app')
const none = { user: {}, project: {} }
const plan = (argv: string[]) => planCommand(argv, { cwd, env: {}, interactive: false, presets: none })

describe('planning the new commands', () => {
  test('check list / show / run only some', () => {
    expect(plan(['check', 'list'])).toMatchObject({ kind: 'noun', noun: 'check', verb: 'list', folder: cwd })
    expect(plan(['check', 'list', '--json'])).toMatchObject({ noun: 'check', verb: 'list', flags: { json: true } })
    expect(plan(['check', 'show', 'secret-scan'])).toMatchObject({ noun: 'check', verb: 'show', id: 'secret-scan' })
    expect(plan(['check', 'show'])).toMatchObject({ kind: 'error' })
    expect(plan(['check', 'a', 'b', './x'])).toMatchObject({ kind: 'run', args: ['--app', resolve(cwd, 'x'), '--only', 'a,b', '--all'], checks: ['a', 'b'] })
    expect(plan(['check', 'a'])).toMatchObject({ kind: 'run', args: ['--app', cwd, '--only', 'a', '--all'] })
    expect(plan(['check', 'list', '--bogus'])).toMatchObject({ kind: 'error' })
  })
  test('preset list / show / new / delete', () => {
    expect(plan(['preset'])).toMatchObject({ noun: 'preset', verb: 'list' })
    expect(plan(['preset', 'list', '--json'])).toMatchObject({ verb: 'list', flags: { json: true } })
    expect(plan(['preset', 'show', 'security'])).toMatchObject({ verb: 'show', name: 'security', folder: cwd })
    expect(plan(['preset', 'new', '--name', 'x', '--tier', 'fast', '--group', 'security,ui', '--personal'])).toMatchObject({ verb: 'new', flags: { name: 'x', tier: 'fast', group: 'security,ui', personal: true } })
    expect(plan(['preset', 'delete', 'x', '--yes'])).toMatchObject({ verb: 'delete', name: 'x', flags: { yes: true } })
    expect(plan(['preset', 'delete'])).toMatchObject({ kind: 'error' })
    expect(plan(['preset', 'nonsense'])).toMatchObject({ kind: 'error' })
  })
  test('pack list / enable / disable keep add and remove', () => {
    expect(plan(['pack', 'list'])).toEqual({ kind: 'pack', action: 'list' })
    expect(plan(['pack', 'list', '--json'])).toMatchObject({ noun: 'pack', verb: 'list', flags: { json: true } })
    expect(plan(['pack', 'enable', 'python', './p'])).toMatchObject({ verb: 'enable', name: 'python', folder: resolve(cwd, 'p') })
    expect(plan(['pack', 'disable', 'python', '--yes', '--dry-run'])).toMatchObject({ verb: 'disable', flags: { yes: true, dryRun: true } })
    expect(plan(['pack', 'enable'])).toMatchObject({ kind: 'error' })
    expect(plan(['pack', 'add', 'p'])).toMatchObject({ kind: 'pack', action: 'add' })
  })
  test('run list / show / log / open and the aliases', () => {
    expect(plan(['run', 'list'])).toMatchObject({ noun: 'run', verb: 'list' })
    expect(plan(['runs'])).toMatchObject({ noun: 'run', verb: 'list' })
    expect(plan(['run', 'show', 'abc'])).toMatchObject({ verb: 'show', id: 'abc' })
    expect(plan(['run', 'log', 'secret-scan', 'abc'])).toMatchObject({ verb: 'log', check: 'secret-scan', id: 'abc' })
    expect(plan(['run', 'log'])).toMatchObject({ kind: 'error' })
    expect(plan(['run', 'open'])).toMatchObject({ verb: 'open' })
    expect(plan(['last'])).toEqual({ kind: 'last', args: ['--last'] })
    expect(plan(['why', 'a'])).toMatchObject({ kind: 'why' })
    expect(plan(['log', 'a'])).toMatchObject({ kind: 'why', args: ['--why', 'a'] })
    expect(plan(['logs'])).toEqual({ kind: 'logs', args: ['--logs'] })
    expect(plan(['run', 'quick'])).toMatchObject({ kind: 'run' })
  })
  test('doctor, mcp, run flags', () => {
    expect(plan(['doctor', '--json'])).toMatchObject({ noun: 'doctor', folder: cwd, flags: { json: true } })
    expect(plan(['mcp', 'install', '--dry-run'])).toMatchObject({ noun: 'mcp', verb: 'install', flags: { dryRun: true } })
    expect(plan(['mcp', 'install', 'claude'])).toMatchObject({ verb: 'install' })
    expect(plan(['mcp', 'install', 'cursor'])).toMatchObject({ kind: 'error' })
    expect(plan(['mcp'])).toMatchObject({ verb: 'status' })
    expect(plan(['verify', '--json'])).toMatchObject({ kind: 'run', json: true, args: ['--app', cwd, '--preset', 'quick', '--json-stdout'] })
    expect(plan(['full', '-q', '--no-color'])).toMatchObject({ quiet: true, args: ['--app', cwd, '--preset', 'full', '--quiet', '--no-color'] })
    expect(plan(['full', '--group', 'security'])).toMatchObject({ args: ['--app', cwd, '--preset', 'full', '--group', 'security'] })
  })
})

describe('doing them', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meerkat-cmds-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const run = async (argv: string[], extra: Record<string, unknown> = {}) => {
    const o: string[] = []
    const e: string[] = []
    const env = { MEERKAT_USER_CONFIG: join(dir, 'user.json'), MEERKAT_LOG_DIR: join(dir, 'logs') }
    const p = planCommand(argv, { cwd: dir, env, interactive: false, presets: none })
    const code = await execute(p, { out: (t: string) => o.push(t), err: (t: string) => e.push(t), env, cwd: dir, interactive: false, presets: none, version: '9.9.9', ...extra })
    return { code, out: o.join('\n'), err: e.join('\n') }
  }

  test('check list --json has the documented fields; check show has needs and what runs', async () => {
    const r = await run(['check', 'list', '--json'])
    expect(r.code).toBe(0)
    const rows = JSON.parse(r.out)
    expect(rows.length).toBeGreaterThan(3)
    for (const k of ['id', 'kind', 'tier', 'lane', 'weight', 'seconds', 'title', 'optIn', 'pack']) expect(rows[0]).toHaveProperty(k)
    const s = await run(['check', 'show', rows[0].id, '--json'])
    const d = JSON.parse(s.out)
    expect(d).toHaveProperty('needs')
    expect(d.runs.text.length).toBeGreaterThan(0)
    expect((await run(['check', 'show', 'no-such-check'])).code).toBe(2)
  })
  test('preset list --json and preset show', async () => {
    const rows = JSON.parse((await run(['preset', 'list', '--json'])).out)
    expect(rows.map((r: { name: string }) => r.name)).toContain('security')
    const shown = JSON.parse((await run(['preset', 'show', 'ci', '--json'])).out)
    expect(shown.name).toBe('ci')
    expect(Array.isArray(shown.checks)).toBe(true)
    expect(typeof shown.estimateSeconds).toBe('number')
    expect((await run(['preset', 'show', 'nope'])).code).toBe(2)
  })
  test('preset new by options, dry run, duplicate, delete needs --yes', async () => {
    expect((await run(['preset', 'new', '--name', 'pre-push', '--tier', 'fast', '--group', 'security,ui', '--dry-run'])).out).toContain('Dry run')
    const made = await run(['preset', 'new', '--name', 'pre-push', '--tier', 'fast', '--group', 'security,ui', '--about', 'mine'])
    expect(made.code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'user.json'), 'utf8')).presets['pre-push']).toMatchObject({ tier: 'fast', groups: ['security', 'ui'], about: 'mine' })
    expect((await run(['preset', 'new', '--name', 'verify'])).code).toBe(2)
    expect((await run(['preset', 'new', '--name', 'bad name'])).code).toBe(2)
    expect((await run(['preset', 'new', '--name', 'z', '--tier', 'slow'])).code).toBe(2)
    expect((await run(['preset', 'new'])).code).toBe(2)
    // loaded presets come from the user file, so hand them over as the real program does
    const mine = { user: { 'pre-push': { tier: 'fast' } }, project: {} }
    expect((await run(['preset', 'delete', 'pre-push'], { presets: mine })).code).toBe(2)
    expect((await run(['preset', 'delete', 'pre-push', '--dry-run'], { presets: mine })).out).toContain('Dry run')
    expect((await run(['preset', 'delete', 'pre-push', '--yes'], { presets: mine })).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'user.json'), 'utf8')).presets).toBeUndefined()
    expect((await run(['preset', 'delete', 'security', '--yes'])).code).toBe(2)
  })
  test('pack enable and disable edit meerkat.config.json and keep the other keys', async () => {
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ disable: ['x'], packs: ['security'] }, null, 2))
    expect((await run(['pack', 'enable', 'python', '--dry-run'])).out).toContain('Dry run')
    expect(JSON.parse(readFileSync(join(dir, 'meerkat.config.json'), 'utf8')).packs).toEqual(['security'])
    const on = await run(['pack', 'enable', 'python'])
    expect(on.code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'meerkat.config.json'), 'utf8'))).toEqual({ disable: ['x'], packs: ['security', 'python'] })
    expect((await run(['pack', 'disable', 'python'])).code).toBe(2) // no terminal, no --yes
    expect((await run(['pack', 'disable', 'python', '--yes'])).code).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, 'meerkat.config.json'), 'utf8'))).toEqual({ disable: ['x'], packs: ['security'] })
    expect((await run(['pack', 'enable', 'no-such-pack'])).code).toBe(2)
    expect(readFileSync(join(dir, 'meerkat.config.json'), 'utf8').endsWith('\n')).toBe(true)
  })
  test('pack enable creates the config from the detected packs when there is none', () => {
    const r = setPack(dir, 'python', true, { env: {} })
    expect(r.ok).toBe(true)
    const made = JSON.parse(readFileSync(join(dir, 'meerkat.config.json'), 'utf8'))
    expect(made.packs).toEqual(expect.arrayContaining(['security', 'hygiene', 'python']))
  })
  test('pack list says which tools are found, with a fake finder', async () => {
    const none = await listPacks(dir, { env: {}, find: () => null })
    const some = await listPacks(dir, { env: {}, find: () => '/bin/x' })
    const py = none.packs.find((p: { name: string }) => p.name === 'python')
    expect(py.tools.length).toBeGreaterThan(0)
    expect(py.tools.every((t: { found: boolean }) => !t.found)).toBe(true)
    expect(some.packs.find((p: { name: string }) => p.name === 'python').tools.every((t: { found: boolean }) => t.found)).toBe(true)
    expect(none.packs.find((p: { name: string }) => p.name === 'hygiene').enabled).toBe(true)
  })
  test('doctor: exit 1 and the install line when a tool is missing, 0 when all are found', async () => {
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ packs: ['node'] }))
    const miss = await doctorReport(dir, { env: {}, find: () => null })
    expect(miss.notRun.length).toBeGreaterThan(0)
    expect(miss.notRun.some((n: { install: string | null }) => n.install && n.install.includes('npm i -D'))).toBe(true)
    expect(miss.wouldRun).toBe(miss.quickChecks - miss.notRun.length)
    const all = await doctorReport(dir, { env: {}, find: () => '/bin/x' })
    expect(all.notRun).toEqual([])
    const asCommand = await run(['doctor', '--json'], { find: () => null })
    expect(JSON.parse(asCommand.out)).toHaveProperty('next')
  })
  test('run list, show, log, open read the saved runs; a log path outside the log folder is refused', async () => {
    const logs = join(dir, 'logs')
    const a = join(logs, 'runs', '20260101-000000-fast')
    const b = join(logs, 'runs', '20260102-000000-fast')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })
    const outside = join(dir, 'outside.log')
    writeFileSync(outside, 'secret')
    writeFileSync(join(b, 'one.log'), 'check: one\n--- output ---\nline1\nline2\n')
    writeFileSync(join(a, 'summary.json'), JSON.stringify({ tier: 'fast', summary: 'old run', exitCode: 0, results: [] }))
    writeFileSync(join(b, 'summary.json'), JSON.stringify({ tier: 'fast', summary: 'new \x1b[31mrun', exitCode: 1, results: [{ id: 'one', status: 'FAIL', logFile: join(b, 'one.log') }, { id: 'two', status: 'FAIL', logFile: outside }] }))
    writeFileSync(join(b, 'report.md'), '# report\x1b[2J')
    writeFileSync(join(logs, 'latest.json'), JSON.stringify({ dir: b }))
    const env = { MEERKAT_LOG_DIR: logs }
    const list = listRuns(env)
    expect(list.map((r: { id: string }) => r.id)).toEqual(['20260102-000000-fast', '20260101-000000-fast'])
    expect(list[0].summary).not.toContain('\x1b')
    expect(showRun(env, undefined).text).not.toContain('')
    expect(showRun(env, '20260101', { json: true }).data.summary).toBe('old run')
    expect(showRun(env, '2026').ok).toBe(false)
    expect(showRun(env, '../etc').ok).toBe(false)
    expect(runLog(env, 'one', undefined).text).toContain('line2')
    expect(runLog(env, 'two', undefined).ok).toBe(false)
    expect(runLog(env, 'nope', undefined).ok).toBe(false)
    expect(String(openRun(env, undefined).dir).split('\\').join('/')).toBe(b.split('\\').join('/'))
    const viaCommand = await run(['run', 'list', '--json'])
    expect(viaCommand.code).toBe(0)
    expect(Array.isArray(JSON.parse(viaCommand.out))).toBe(true)
  })
})

describe('mcp install', () => {
  const found = () => 'C:/tools/claude.cmd'
  test('dry run prints the command and runs nothing', () => {
    const calls: string[][] = []
    const r = mcpInstall({ dryRun: true, runner: (c: string, a: string[]) => (calls.push([c, ...a]), { status: 0, stdout: '', stderr: '' }), find: found })
    expect(r.code).toBe(0)
    expect(r.text).toContain('claude mcp add --scope user meerkat -- node')
    expect(r.text).toContain('meerkat-mcp.mjs')
    expect(calls).toEqual([])
  })
  test('checks the list first, adds once, and says when it is already there', () => {
    const calls: string[][] = []
    let listed = 'other: node x'
    const runner = (c: string, a: string[]) => {
      calls.push([c, ...a])
      return { status: 0, stdout: a[1] === 'list' ? listed : '', stderr: '' }
    }
    const first = mcpInstall({ runner, find: found })
    expect(first.ok).toBe(true)
    expect(calls.map((c) => c.slice(1, 3).join(' '))).toEqual(['mcp list', 'mcp add'])
    expect(calls[1]).toEqual(expect.arrayContaining(['--scope', 'user', 'meerkat', '--']))
    listed = 'meerkat: node x - Connected'
    calls.length = 0
    const again = mcpInstall({ runner, find: found })
    expect(again.text).toContain('already registered')
    expect(calls.length).toBe(1)
  })
  test('no claude on the PATH, a failing add, and status', () => {
    expect(mcpInstall({ runner: () => ({ status: 0, stdout: '', stderr: '' }), find: () => null }).code).toBe(1)
    const fail = mcpInstall({ runner: (c: string, a: string[]) => ({ status: a[1] === 'list' ? 0 : 1, stdout: '', stderr: 'boom' }), find: found })
    expect(fail.ok).toBe(false)
    expect(fail.text).toContain('boom')
    expect(mcpStatus({ runner: () => ({ status: 0, stdout: 'meerkat: x', stderr: '' }), find: found }).registered).toBe(true)
    expect(mcpStatus({ runner: () => ({ status: 0, stdout: 'a: x', stderr: '' }), find: found }).registered).toBe(false)
  })
})
