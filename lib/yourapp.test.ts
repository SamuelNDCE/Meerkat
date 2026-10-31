// Checks that are yours: config-defined checks, origin tags, the commands (new, edit, remove, mine, try), recommend, the tip line
// and the menu screens. Every test uses a temp project and a temp user config (MEERKAT_USER_CONFIG): the real ~/.meerkat.json is never touched.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { planCommand } from './cli.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { execute } from './commands.mjs'
import { applyConfig, readConfig } from './config.mjs'
import { commandText, isOwn, originLabel, splitCommand, validateCustomChecks, validateEntry, validateSuites } from './customchecks.mjs'
import { loadProject, checkListText, checkRow } from './projectchecks.mjs'
import { recommend, tipLine } from './recommend.mjs'
import { finalReport } from './report.mjs'
import { initialState, menuItems, menuStep, suitePickerItems } from './menu.mjs'
import { setProjectSuites, suiteIdOf, suiteInfo } from './suites.mjs'
import { enrichResults } from './subchecks.mjs'
import { checkDetailLines, checkItems, ideaItems, listStep, renderDetailScreen, yourAppMenuItems } from './yourappscreen.mjs'
import { mineRows } from './yourapp.mjs'

let dir = ''
let userFile = ''
let env: Record<string, string> = {}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-yours-'))
  userFile = join(dir, 'home', '.meerkat.json')
  mkdirSync(join(dir, 'home'), { recursive: true })
  mkdirSync(join(dir, 'app'), { recursive: true })
  env = { ...process.env, MEERKAT_USER_CONFIG: userFile, MEERKAT_NO_TIP: '1' } as Record<string, string>
  delete env.MEERKAT_NO_PROJECT_CODE
})
afterEach(() => {
  setProjectSuites([])
  rmSync(dir, { recursive: true, force: true })
})

const app = () => join(dir, 'app')
const write = (rel: string, text: string) => {
  const file = join(app(), rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const e2e = { id: 'e2e', title: 'End-to-end tests', cmd: 'npm', args: ['run', 'test:e2e'], suite: 'my-app', group: 'functionality', tier: 'thorough' }

async function cmd(argv: string[], extra: Record<string, unknown> = {}) {
  const outs: string[] = []
  const errs: string[] = []
  const plan = planCommand(argv, { cwd: app(), env, presets: { user: {}, project: {} } } as any)
  if (plan.kind !== 'noun') return { plan, code: -1, out: '', err: '' }
  const code = await execute(plan as any, { out: (t: string) => outs.push(t), err: (t: string) => errs.push(t), env, cwd: app(), interactive: false, ...extra } as any)
  return { plan, code, out: outs.join('\n'), err: errs.join('\n') }
}

describe('the command line of a check', () => {
  test('is split quote-aware into a program and arguments', () => {
    expect(splitCommand('npm run test:e2e')).toEqual({ ok: true, cmd: 'npm', args: ['run', 'test:e2e'] })
    expect(splitCommand('node scripts/x.mjs --name "two words" \'a b\'')).toEqual({ ok: true, cmd: 'node', args: ['scripts/x.mjs', '--name', 'two words', 'a b'] })
    expect(commandText('node', ['a b', 'c'])).toBe('node "a b" c')
  })
  test.each(['npm test; rm -rf /', 'a | b', 'a && b', 'a > out', 'a < in', 'echo `x`', 'echo $(x)', 'a %PATH%', '', '   ', 'npm "unclosed', '/bin/sh -c x', '../x/run', 'C:\\x\\run.exe'])('refuses %j', (line) => {
    expect(splitCommand(line).ok).toBe(false)
  })
})

describe('config validation (customChecks, suites)', () => {
  test('accepts a complete entry and fills the defaults', () => {
    const v = validateEntry({ ...e2e, cwd: 'web', timeoutSeconds: 600, weight: 'heavy', needs: ['npm'], install: 'install Node.js' })
    expect(v.error).toBeUndefined()
    expect(v.entry).toMatchObject({ id: 'e2e', cwd: 'web', weight: 'heavy', needs: ['npm'] })
    const d = validateEntry({ id: 'smoke', cmd: 'node', args: ['x.mjs'] })
    expect(d.entry).toMatchObject({ title: 'smoke', suite: 'my-app', group: 'functionality', tier: 'thorough' })
  })
  test.each([
    [{ ...e2e, id: 'Bad Id' }, 'kebab'],
    [{ ...e2e, cmd: 'npm run' }, 'cmd'],
    [{ ...e2e, cmd: 'a;b' }, 'cmd'],
    [{ ...e2e, cmd: '/usr/bin/x' }, 'cmd'],
    [{ ...e2e, cmd: '../x' }, 'cmd'],
    [{ ...e2e, args: 'run' }, 'args'],
    [{ ...e2e, args: [1] }, 'args'],
    [{ ...e2e, args: ['a;b'] }, 'shell'],
    [{ ...e2e, args: ['$(x)'] }, 'shell'],
    [{ ...e2e, suite: 'My App' }, 'suite'],
    [{ ...e2e, group: 'speed' }, 'group'],
    [{ ...e2e, tier: 'slow' }, 'tier'],
    [{ ...e2e, cwd: '../x' }, 'cwd'],
    [{ ...e2e, cwd: '/abs' }, 'cwd'],
    [{ ...e2e, timeoutSeconds: 0 }, 'timeoutSeconds'],
    [{ ...e2e, timeoutSeconds: 99999 }, 'timeoutSeconds'],
    [{ ...e2e, weight: 'huge' }, 'weight'],
    [{ ...e2e, needs: [1] }, 'needs'],
    [{ ...e2e, title: 'x'.repeat(121) }, 'title'],
    ['nope', 'object'],
  ])('rejects %j', (bad, word) => {
    const v = validateEntry(bad as any)
    expect(v.error).toContain(word)
  })
  test('ids are unique across every pack, bad entries are skipped with a note, unknown keys are noted', () => {
    const known = new Set(['secret-scan'])
    const r = validateCustomChecks([{ ...e2e, color: 'red' }, { ...e2e }, { ...e2e, id: 'secret-scan' }, { ...e2e, id: 'ok-two', cmd: 'x y' }, { ...e2e, id: 'ok-three' }], { known })
    expect(r.entries.map((x) => x.id)).toEqual(['e2e', 'ok-three'])
    expect(r.notes.join('\n')).toMatch(/"color" is not a known key/)
    expect(r.notes.filter((n) => /skipped/.test(n))).toHaveLength(3)
    expect(validateCustomChecks('nope', {}).notes[0]).toMatch(/must be a list/)
  })
  test('project suites: names, labels, defaults', () => {
    const r = validateSuites({ 'my-app': { label: 'My app', purpose: 'Mine.' }, 'Bad Name': {}, secrets: {}, plain: {}, odd: { size: 1 } })
    expect(r.list.map((x) => x.id)).toEqual(['my-app', 'plain', 'odd'])
    expect(r.list[1]).toMatchObject({ label: 'Plain', purpose: expect.any(String) })
    expect(r.notes.join('\n')).toMatch(/Bad Name/)
    expect(r.notes.join('\n')).toMatch(/own suites/)
  })
  test('readConfig keeps customChecks and suites; a wrong shape is a note, not a crash', () => {
    write('meerkat.config.json', JSON.stringify({ packs: [], customChecks: [e2e], suites: { 'my-app': { label: 'My app' } } }))
    const ok = readConfig(join(app(), 'meerkat.config.json'))
    expect(ok.config.customChecks).toHaveLength(1)
    write('meerkat.config.json', JSON.stringify({ packs: [], customChecks: 'x', suites: [] }))
    const bad = readConfig(join(app(), 'meerkat.config.json'))
    expect(bad.config.customChecks).toEqual([])
    expect(bad.notes).toHaveLength(2)
  })
})

describe('origin', () => {
  test('bundled packs are bundled; personal packs, customChecks, .meerkat/checks and extraChecks are tagged', async () => {
    write('.meerkat/checks/mine.mjs', "export default [{ id: 'my-js', group: 'functionality', tier: 'fast', lane: 'free', title: 'Mine', run: () => ({ ok: true, detail: 'x' }) }]\n")
    write('tools/extra/x.mjs', "export default [{ id: 'extra-one', group: 'functionality', tier: 'fast', lane: 'free', title: 'Extra', run: () => ({ ok: true, detail: 'x' }) }]\n")
    const file = join(app(), 'meerkat.config.json')
    const config = { packs: ['security'], extraChecks: ['tools/extra'], customChecks: [e2e], suites: { 'my-app': { label: 'My app', purpose: 'The app.' } }, disable: [], override: {}, presets: {} }
    const r = await applyConfig([], config as any, { file, projectDir: app(), personalChecks: [{ id: 'perso', cmd: 'node', args: ['-v'], suite: 'my-app' }] })
    const by = (id: string) => r.checks.find((c: any) => c.id === id) as any
    expect(by('secret-scan').origin).toBe('bundled')
    expect(by('my-js')).toMatchObject({ origin: 'project', source: '.meerkat/checks/mine.mjs' })
    expect(by('extra-one').origin).toBe('project')
    expect(by('e2e')).toMatchObject({ origin: 'project', suite: 'my-app', run: { cmd: 'npm', args: ['run', 'test:e2e'] }, needs: ['npm'], lane: 'free', custom: true })
    expect(by('perso').origin).toBe('personal')
    expect(suiteInfo('my-app')).toMatchObject({ label: 'My app', purpose: 'The app.', project: true })
    expect(suiteIdOf(by('e2e'))).toBe('my-app')
    expect(originLabel('personal')).toBe('yours')
    expect(originLabel('project')).toBe('project')
    expect(originLabel('bundled')).toBe('')
    expect(r.checks.filter(isOwn).map((c: any) => c.id).sort()).toEqual(['e2e', 'extra-one', 'my-js', 'perso'])
  })
  test('MEERKAT_NO_PROJECT_CODE: config-defined checks are listed, project code is never imported', async () => {
    write('.meerkat/checks/boom.mjs', "throw new Error('imported!')\n")
    write('tools/extra/boom.mjs', "throw new Error('imported!')\n")
    write('meerkat.config.json', JSON.stringify({ packs: [], extraChecks: ['tools/extra'], customChecks: [e2e] }))
    const p = await loadProject(app(), { env: { ...env, MEERKAT_NO_PROJECT_CODE: '1' } })
    expect(p.checks.map((c: any) => c.id)).toEqual(['e2e'])
    expect(p.notes.join('\n')).not.toMatch(/imported|boom/)
    const full = await loadProject(app(), { env })
    expect(full.checks.some((c: any) => c.id.startsWith('bad-check-file'))).toBe(true) // it IS imported when allowed
  })
  test('a custom check with a bundled id is refused, not swapped in', async () => {
    write('meerkat.config.json', JSON.stringify({ packs: ['security'], customChecks: [{ ...e2e, id: 'secret-scan' }] }))
    const p = await loadProject(app(), { env })
    expect(p.checks.filter((c: any) => c.id === 'secret-scan')).toHaveLength(1)
    expect((p.checks.find((c: any) => c.id === 'secret-scan') as any).origin).toBe('bundled')
    expect(p.notes.join('\n')).toMatch(/already used by another check/)
  })
  test('check list rows and text carry the origin; the end summary says how many are yours', async () => {
    write('meerkat.config.json', JSON.stringify({ packs: ['security'], customChecks: [e2e] }))
    const p = await loadProject(app(), { env })
    const rows = p.checks.map(checkRow)
    expect(rows.find((r: any) => r.id === 'e2e')).toMatchObject({ origin: 'project', suite: 'my-app' })
    expect(rows.find((r: any) => r.id === 'secret-scan').origin).toBe('bundled')
    expect(checkListText(rows)).toMatch(/^\s+e2e\s+project /m)
    expect(checkListText(rows)).toContain('my-app')
    const results = [{ id: 'e2e', status: 'PASS', ms: 5 }, { id: 'secret-scan', status: 'PASS', ms: 5 }]
    const text = finalReport({ results, tier: 'fast', totalMs: 10, checks: p.checks }).join('\n')
    expect(text).toContain('2 checks')
    expect(text).toContain('1 of them yours')
    const plain = finalReport({ results: [results[1]], tier: 'fast', totalMs: 10, checks: p.checks }).join('\n')
    expect(plain).not.toContain('of them yours')
    expect(enrichResults(results, p.checks).map((r: any) => r.origin)).toEqual(['project', 'bundled'])
  })
})

describe('meerkat check new / edit / remove / mine / try', () => {
  test('new writes the project config (a new file keeps the default packs), and refuses what is wrong', async () => {
    write('package.json', '{}')
    const dry = await cmd(['check', 'new', '--id', 'e2e', '--cmd', 'npm run test:e2e', '--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('Dry run')
    expect(() => readFileSync(join(app(), 'meerkat.config.json'))).toThrow()
    const noYes = await cmd(['check', 'new', '--id', 'e2e', '--cmd', 'npm run test:e2e'])
    expect(noYes.code).toBe(2)
    expect(noYes.err).toContain('--yes')
    const r = await cmd(['check', 'new', '--id', 'e2e', '--cmd', 'npm run test:e2e', '--title', 'End-to-end', '--yes', '--json'])
    expect(r.code).toBe(0)
    const written = JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8'))
    expect(written.packs).toEqual(expect.arrayContaining(['security', 'hygiene']))
    expect(written.customChecks).toEqual([expect.objectContaining({ id: 'e2e', title: 'End-to-end', cmd: 'npm', args: ['run', 'test:e2e'], suite: 'my-app' })])
    expect((await cmd(['check', 'new', '--id', 'e2e', '--cmd', 'node x', '--yes'])).err).toMatch(/already used/)
    expect((await cmd(['check', 'new', '--id', 'x', '--cmd', 'npm test; ls', '--yes'])).code).toBe(2)
    expect((await cmd(['check', 'new', '--id', 'secret-scan', '--cmd', 'node x', '--yes'])).code).toBe(2)
    expect((await cmd(['check', 'new', '--id', 'y', '--cmd', 'node x', '--group', 'nope', '--yes'])).code).toBe(2)
  })
  test('new keeps other keys and the line endings of an existing config, personal goes to the user file', async () => {
    const crlf = JSON.stringify({ packs: ['security'], budget: { cpu: 2 }, presets: { mine: { tier: 'fast' } } }, null, 2).replace(/\n/g, '\r\n') + '\r\n'
    write('meerkat.config.json', crlf)
    expect((await cmd(['check', 'new', '--id', 'smoke', '--cmd', 'node scripts/smoke.mjs', '--yes'])).code).toBe(0)
    const text = readFileSync(join(app(), 'meerkat.config.json'), 'utf8')
    expect(text).toContain('\r\n')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    const raw = JSON.parse(text)
    expect(raw.budget).toEqual({ cpu: 2 })
    expect(raw.presets).toEqual({ mine: { tier: 'fast' } })
    expect(raw.customChecks).toHaveLength(1)
    const p = await cmd(['check', 'new', '--id', 'perso', '--cmd', 'node -v', '--personal', '--yes'])
    expect(p.code).toBe(0)
    expect(JSON.parse(readFileSync(userFile, 'utf8')).customChecks[0].id).toBe('perso')
    const mine = await cmd(['check', 'mine', '--json'])
    const rows = JSON.parse(mine.out)
    expect(rows.map((r: any) => [r.id, r.origin])).toEqual([['smoke', 'project'], ['perso', 'personal']])
    expect(rows[0]).toMatchObject({ editable: true, installed: true, command: 'node scripts/smoke.mjs' })
    expect(rows[0].where).toContain('meerkat.config.json')
    expect(rows[1].where).toContain('.meerkat.json')
    expect((await cmd(['check', 'mine'])).out).toContain('smoke')
  })
  test('mine says when a program is missing', async () => {
    write('meerkat.config.json', JSON.stringify({ packs: [], customChecks: [{ id: 'nope', cmd: 'no-such-program-xyz', args: [] }] }))
    const rows = mineRows(await loadProject(app(), { env }), { env })
    expect(rows[0]).toMatchObject({ installed: false, missing: ['no-such-program-xyz'] })
  })
  test('edit changes one entry; remove needs --yes, only yours, never a bundled check', async () => {
    write('meerkat.config.json', JSON.stringify({ packs: ['security'], customChecks: [e2e, { id: 'other-one', cmd: 'node', args: ['x'] }] }, null, 2))
    expect((await cmd(['check', 'edit', 'e2e', '--title', 'E2E', '--tier', 'fast', '--cmd', 'npm run e2e', '--yes'])).code).toBe(0)
    const list = JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks
    expect(list[0]).toMatchObject({ id: 'e2e', title: 'E2E', tier: 'fast', cmd: 'npm', args: ['run', 'e2e'] })
    expect(list).toHaveLength(2)
    expect((await cmd(['check', 'edit', 'e2e', '--tier', 'slow', '--yes'])).code).toBe(2)
    expect((await cmd(['check', 'edit', 'e2e'])).code).toBe(2) // nothing to ask, nothing said
    const bundled = await cmd(['check', 'remove', 'secret-scan', '--yes'])
    expect(bundled.code).toBe(2)
    expect(bundled.err).toMatch(/bundled/)
    expect((await cmd(['check', 'remove', 'ghost', '--yes'])).code).toBe(2)
    expect((await cmd(['check', 'remove', 'e2e'])).code).toBe(2)
    expect((await cmd(['check', 'remove', 'e2e', '--dry-run'])).out).toContain('Dry run')
    expect(JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks).toHaveLength(2)
    expect((await cmd(['check', 'remove', 'e2e', '--yes'])).code).toBe(0)
    expect(JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks.map((c: any) => c.id)).toEqual(['other-one'])
    expect((await cmd(['check', 'remove', 'other-one', '--yes'])).code).toBe(0)
    expect(JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks).toBeUndefined()
  })
  test('interactive: new asks for the fields and edit keeps what Enter keeps', async () => {
    const answers = ['perf', 'Perf test', 'node perf.mjs', '', 'performance', 'fast', 'y']
    const asked: string[] = []
    const ask = async (q: string) => (asked.push(q), answers.shift() ?? '')
    write('meerkat.config.json', JSON.stringify({ packs: [] }))
    expect((await cmd(['check', 'new'], { interactive: true, ask })).code).toBe(0)
    expect(asked[0]).toMatch(/^Id/)
    const list = JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks
    expect(list[0]).toMatchObject({ id: 'perf', title: 'Perf test', cmd: 'node', args: ['perf.mjs'], suite: 'my-app', group: 'performance', tier: 'fast' })
    const more = ['', '', '', '', 'thorough', 'y']
    expect((await cmd(['check', 'edit', 'perf'], { interactive: true, ask: async () => more.shift() ?? '' })).code).toBe(0)
    expect(JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks[0]).toMatchObject({ title: 'Perf test', tier: 'thorough', cmd: 'node' })
  })
  test('try is a normal run of just that check', () => {
    const plan = planCommand(['check', 'try', 'e2e'], { cwd: app(), env, presets: { user: {}, project: {} } } as any) as any
    expect(plan.kind).toBe('run')
    expect(plan.args).toEqual(expect.arrayContaining(['--only', 'e2e']))
    expect((planCommand(['check', 'try'], { cwd: app(), env, presets: { user: {}, project: {} } } as any) as any).kind).toBe('error')
  })
  test('a custom check really runs: the exit code decides, 75 is NOT RUN, and the result says whose it is', () => {
    const node = (code: number) => ({ cmd: 'node', args: ['-e', `process.exit(${code})`] })
    write('meerkat.config.json', JSON.stringify({ packs: [], customChecks: [{ id: 'ok-one', ...node(0) }, { id: 'not-run', ...node(75) }, { id: 'bad-one', ...node(1) }] }))
    const home = join(dir, 'home')
    const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), '--app', app(), '--only', 'ok-one,not-run,bad-one', '--all', '--json-stdout', '--no-color'], { encoding: 'utf8', env: { ...env, HOME: home, USERPROFILE: home, MEERKAT_LOG_DIR: join(dir, 'logs'), MEERKAT_PLAIN: '1' }, timeout: 60000 })
    const out = JSON.parse(r.stdout)
    const by = Object.fromEntries(out.results.map((x: any) => [x.id, x]))
    expect(by['ok-one']).toMatchObject({ status: 'PASS', origin: 'project', suite: 'my-app' })
    expect(by['not-run'].status).toBe('NOT RUN')
    expect(by['bad-one'].status).toBe('FAIL')
    expect(r.status).toBe(1)
    expect(out.suites.map((s: any) => s.id)).toContain('my-app')
  })
})

describe('meerkat recommend', () => {
  const fixture = () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest run', 'test:e2e': 'playwright test', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'vite build', start: 'node .', dev: 'vite' } }))
    write('playwright.config.ts', 'export default {}\n')
    write('Makefile', 'test:\n\techo hi\nlint:\n\techo lint\n')
    write('pytest.ini', '[pytest]\n')
    write('docker-compose.yml', 'services: {}\n')
    write('.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - run: npm ci\n      - run: npm run coverage\n      - run: echo hi && echo there\n')
  }
  test('finds what the project can already run, skips Cargo and Go, never start or dev', () => {
    fixture()
    const r = recommend(app())
    const cmds = r.ideas.map((i) => commandText(i.cmd, i.args))
    expect(cmds).toEqual(expect.arrayContaining(['npm test', 'npm run test:e2e', 'npm run lint', 'npm run typecheck', 'npm run build', 'make test', 'make lint', 'pytest', 'docker compose config --quiet', 'npm run coverage']))
    expect(cmds.join('|')).not.toMatch(/start|dev|playwright|npm ci/)
    for (const i of r.ideas) expect(i).toMatchObject({ id: expect.stringMatching(/^app-/), title: expect.any(String), why: expect.any(String) })
    write('Cargo.toml', '[package]\nname="x"\n')
    write('go.mod', 'module x\n')
    expect(recommend(app()).ideas.map((i) => i.cmd)).not.toContain('cargo')
  })
  test('a command a check already runs is not proposed again, and neither is a taken id', () => {
    fixture()
    const covered = [{ id: 'unit-tests', run: { cmd: 'npm', args: ['test'] } }, { id: 'app-lint', run: { cmd: 'node', args: ['x'] } }, { id: 'lintish', run: { cmd: 'pnpm', args: ['run', 'typecheck'] } }]
    const r = recommend(app(), { checks: covered })
    const cmds = r.ideas.map((i) => commandText(i.cmd, i.args))
    expect(cmds).not.toContain('npm test')
    expect(cmds).not.toContain('npm run lint') // its id is taken
    expect(cmds).not.toContain('npm run typecheck') // the same script by another package manager
    expect(cmds).toContain('npm run build')
    expect(r.covered).toBeGreaterThanOrEqual(3)
  })
  test('looking writes nothing and runs nothing; --add needs --yes or an answer; --add all and --personal work', async () => {
    fixture()
    const before = readFileSync(join(app(), 'package.json'), 'utf8')
    const look = await cmd(['recommend', '--json'])
    expect(look.code).toBe(0)
    expect(JSON.parse(look.out).ideas.length).toBeGreaterThan(3)
    expect(() => readFileSync(join(app(), 'meerkat.config.json'))).toThrow()
    expect(() => readFileSync(userFile)).toThrow()
    expect((await cmd(['recommend', '--add', 'app-test', '--dry-run'])).out).toContain('Dry run')
    expect(() => readFileSync(join(app(), 'meerkat.config.json'))).toThrow()
    expect((await cmd(['recommend', '--add', 'app-test'])).code).toBe(2)
    expect((await cmd(['recommend', '--add', 'no-such-idea', '--yes'])).code).toBe(2)
    expect((await cmd(['recommend', '--add', 'app-test', '--yes'])).code).toBe(0)
    expect(JSON.parse(readFileSync(join(app(), 'meerkat.config.json'), 'utf8')).customChecks.map((c: any) => c.id)).toEqual(['app-test'])
    expect((await cmd(['recommend', '--add', 'all', '--personal', '--yes'])).code).toBe(0)
    const personal = JSON.parse(readFileSync(userFile, 'utf8')).customChecks.map((c: any) => c.id)
    expect(personal).not.toContain('app-test') // it is already a check of the project
    expect(personal.length).toBeGreaterThan(3)
    expect(readFileSync(join(app(), 'package.json'), 'utf8')).toBe(before)
  })
  test('doctor and the menu hint: the idea count', async () => {
    fixture()
    const { doctorReport, doctorText } = await import('./doctor.mjs')
    const r = await doctorReport(app(), { env, home: dir })
    expect(r.ideas).toBeGreaterThan(3)
    expect(doctorText(r)).toContain('meerkat recommend')
  })
})

describe('the tip line', () => {
  test('shown once, only with no checks of your own, never in json, quiet, plain or CI output', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }))
    const base = { dir: app(), checks: [], env: {} }
    expect(tipLine(base)).toBe('Tip: meerkat recommend (2 tests this project could run)')
    expect(tipLine({ ...base, quiet: true })).toBeNull()
    expect(tipLine({ ...base, json: true })).toBeNull()
    expect(tipLine({ ...base, plain: true })).toBeNull()
    expect(tipLine({ ...base, env: { CI: 'true' } })).toBeNull()
    expect(tipLine({ ...base, env: { MEERKAT_NO_TIP: '1' } })).toBeNull()
    expect(tipLine({ ...base, checks: [{ id: 'e2e', origin: 'project' }] as any })).toBeNull()
    expect(tipLine({ ...base, checks: [{ id: 'p', origin: 'personal' }] as any })).toBeNull()
    expect(tipLine({ ...base, checks: [{ id: 'bundled-one', origin: 'bundled', run: { cmd: 'npm', args: ['test'] } }, { id: 'l', origin: 'bundled', run: { cmd: 'npm', args: ['run', 'lint'] } }] as any })).toBeNull() // all covered
    rmSync(join(app(), 'package.json'))
    expect(tipLine(base)).toBeNull()
  })
})

describe('the menu screens (pure)', () => {
  const rows = [
    { id: 'e2e', title: 'End-to-end tests', origin: 'project', label: 'project', suite: 'my-app', group: 'functionality', tier: 'thorough', where: 'meerkat.config.json (customChecks)', editable: true, command: 'npm run test:e2e', installed: true, missing: [] },
    { id: 'k6', title: 'Load', origin: 'personal', label: 'yours', suite: 'my-app', group: 'performance', tier: 'thorough', where: '~/.meerkat.json (customChecks)', editable: true, command: 'k6 run x.js', installed: false, missing: ['k6'] },
  ]
  test('the home menu gets a Your app section only when there is something for it', () => {
    expect(menuItems({}).some((i: any) => i.label === 'Your app')).toBe(false)
    expect(yourAppMenuItems({})).toEqual([])
    const items = menuItems({ yourApp: { checks: 2, ideas: 3 } }) as any[]
    const at = items.findIndex((i) => i.label === 'Your app')
    expect(at).toBeGreaterThan(0)
    expect(items.slice(at, at + 4).map((i) => i.label)).toEqual(['Your app', "Your app's checks (2)", 'Add a test for this app', 'Ideas (3)'])
    expect(items[at + 3].about).toContain('Add tests for this app (3 ideas)')
    expect(items.findIndex((i) => i.label === 'More')).toBeGreaterThan(at + 3)
    const onlyIdeas = yourAppMenuItems({ checks: 0, ideas: 1 }) as any[]
    expect(onlyIdeas.map((i) => i.label)).toEqual(['Your app', 'Add a test for this app', 'Ideas (1)'])
    expect(menuStep(initialState(items), 'down').state.cursor).toBeGreaterThan(0)
  })
  test('the list: origin tags, suite, last result; keys r e x a, Enter details, Esc back', () => {
    const last = new Map([['e2e', { status: 'PASS', ms: 84200 }]])
    const items = checkItems(rows as any, last as any) as any[]
    expect(items[0]).toMatchObject({ label: 'e2e', time: 'PASS 84.2s' })
    expect(items[0].about).toContain('project | my-app')
    expect(items[1]).toMatchObject({ time: 'not run yet' })
    expect(items[1].about).toContain('yours')
    expect(items[1].about).toContain('needs k6')
    const s0 = { items, cursor: 0, multi: false }
    expect(listStep(s0, 'down').state.cursor).toBe(1)
    expect(listStep(s0, 'r').action).toEqual({ type: 'run', item: items[0] })
    expect(listStep(s0, 'e').action?.type).toBe('edit')
    expect(listStep(s0, 'x').action?.type).toBe('remove')
    expect(listStep(s0, 'a').action).toEqual({ type: 'add' })
    expect(listStep(s0, 'enter').action?.type).toBe('open')
    expect(listStep(s0, 'escape').action).toEqual({ type: 'back' })
    expect(listStep(s0, 'ctrl-c').action).toEqual({ type: 'abort' })
    expect(listStep(s0, 'z').action).toBeNull()
  })
  test('ideas: a adds one, A adds all', () => {
    const ideas = [{ id: 'app-lint', title: 'Lint', cmd: 'npm', args: ['run', 'lint'], why: 'w', group: 'refactor', tier: 'fast' }]
    const items = ideaItems(ideas as any) as any[]
    expect(items[0].about).toBe('Lint: npm run lint')
    const s = { items, cursor: 0, multi: false }
    expect(listStep(s, 'a', 'ideas').action).toEqual({ type: 'add', item: items[0] })
    expect(listStep(s, 'A', 'ideas').action).toEqual({ type: 'addall' })
    expect(listStep(s, 'r', 'ideas').action).toBeNull()
  })
  test('details and the screens render without control characters and fit the width', () => {
    const evil = { ...rows[0], title: 'T\x1b[31mred', command: 'npm run x\x07' }
    const lines = checkDetailLines(evil as any, { status: 'FAIL', ms: 1200 } as any)
    expect(lines.join('\n')).toContain('FAIL 1.2s')
    expect(lines.join('\n')).not.toMatch(/\x1b|\x07/)
    const screen = renderDetailScreen(lines, { width: 60, rows: 20, project: 'C:\\x\\y' })
    expect(screen.every((l: any) => l.text.length <= 60)).toBe(true)
    expect(checkDetailLines(rows[1] as any, null).join('\n')).toContain('NOT FOUND: k6')
  })
  test('the two-level picker shows a project suite first, in its own section, tagged yours', () => {
    const picker = suitePickerItems([
      { id: 'secret-scan', suite: 'secrets', subs: 4, title: 'x' },
      { id: 'e2e', suite: 'my-app', subs: 1, title: 'End', origin: 'project', suiteLabel: 'My app', suitePurpose: 'The app.' },
    ] as any) as any[]
    expect(picker[0]).toMatchObject({ kind: 'heading', label: 'Your app' })
    expect(picker[1].label).toContain('My app')
    expect(picker[1].label).toContain('yours')
    expect(picker[1]).toMatchObject({ suite: 'my-app', value: 'my-app', about: 'The app.' })
    expect(picker.findIndex((i) => i.label === 'Security')).toBeGreaterThan(1)
  })
})

describe('the board', () => {
  test('a row of your own carries a small tag, a bundled row does not, and the row never grows past the width', async () => {
    const { createModel } = await import('./tui/model.mjs')
    const { renderLive } = await import('./tui/live.mjs')
    const mk = (id: string, origin: string) => ({ id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 5, origin, run: { cmd: 'node', args: [] }, source: 'x' })
    const model = createModel({ checks: [mk('secret-scan', 'bundled'), mk('e2e', 'project'), mk('a-very-long-check-id-of-mine', 'personal')] as any })
    const rows = model.snapshot(0)
    expect(rows.map((r: any) => r.origin)).toEqual(['bundled', 'project', 'personal'])
    const text = renderLive({ rows, started: 0, now: 1000, width: 110, color: false, grouped: false } as any)
    const lines = (Array.isArray(text) ? text : String(text).split('\n')).map((l: any) => (typeof l === 'string' ? l : l.text ?? ''))
    const find = (id: string) => lines.find((l: string) => /WAITING/.test(l) && l.includes(id.slice(0, 10))) ?? ''
    expect(find('e2e')).toMatch(/e2e\s+project/)
    expect(find('a-very-long-check-id-of-mine')).toContain('yours')
    expect(find('secret-scan')).not.toMatch(/yours|project/)
  })
})
