// The command line front door: planning (lib/cli.mjs), the menu's key handling (lib/menu.mjs), update (lib/update.mjs) and the bug report.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { findProject, helpText, listPresets, packAdd, packList, packRemove, planCommand, presetsText } from './cli.mjs'
import { buildBugReport } from './bugreport.mjs'
import { initialState, lineStep, listRunChecks, menuItems, menuStep, parseCheckList, parseKeys, renderPicker, saveProjectPreset, savePersonalPreset } from './menu.mjs'
import { applyUpdate, checkForUpdate, maybeAutoUpdate, runUpdateCommand } from './update.mjs'
import { readUserConfig, writeUserConfig } from './userconfig.mjs'

const cwd = resolve('/work/app')
const none = { user: {}, project: {} }
const plan = (argv: string[], extra: Record<string, unknown> = {}) => planCommand(argv, { cwd, env: {}, interactive: false, presets: none, ...extra })

describe('planCommand', () => {
  test('no words: the menu when interactive, help otherwise', () => {
    expect(plan([], { interactive: true })).toEqual({ kind: 'menu' })
    expect(plan([], { interactive: false })).toEqual({ kind: 'help' })
  })

  test.each(['verify', 'test', 'check'])('%s runs the quick preset on the current folder', (word) => {
    expect(plan([word])).toMatchObject({ kind: 'run', args: ['--app', cwd, '--preset', 'quick'] })
  })

  test.each(['this', 'here', '.'])('"%s" means the current folder', (where) => {
    expect(plan(['verify', where])).toMatchObject({ kind: 'run', args: ['--app', cwd, '--preset', 'quick'] })
  })

  test('a folder path is resolved against the current folder', () => {
    expect(plan(['verify', '../other'])).toMatchObject({ args: ['--app', resolve(cwd, '../other'), '--preset', 'quick'] })
    expect(plan(['full', 'sub/dir'])).toMatchObject({ args: ['--app', resolve(cwd, 'sub/dir'), '--preset', 'full'] })
  })

  test('every bundled preset works as the first word', () => {
    for (const name of ['quick', 'full', 'thorough', 'security', 'security-fast', 'ui', 'performance', 'refactor', 'functionality', 'ci', 'release']) {
      expect(plan([name])).toMatchObject({ kind: 'run', args: ['--app', cwd, '--preset', name] })
    }
    expect(plan(['security', 'here'])).toMatchObject({ args: ['--app', cwd, '--preset', 'security'] })
  })

  test('meerkat run <preset> [where]', () => {
    expect(plan(['run', 'ci'])).toMatchObject({ args: ['--app', cwd, '--preset', 'ci'] })
    expect(plan(['run', 'ui', './x'])).toMatchObject({ args: ['--app', resolve(cwd, 'x'), '--preset', 'ui'] })
    expect(plan(['run'])).toMatchObject({ kind: 'error' })
    expect(plan(['run', 'nonsense'])).toMatchObject({ kind: 'error' })
  })

  test('extra flags pass through untouched', () => {
    expect(plan(['quick', '--keep-going', '--ui'])).toMatchObject({ args: ['--app', cwd, '--preset', 'quick', '--keep-going', '--ui'] })
    expect(plan(['verify', './x', '--include', 'ai', '--only', 'a,b'])).toMatchObject({ args: ['--app', resolve(cwd, 'x'), '--preset', 'quick', '--include', 'ai', '--only', 'a,b'] })
  })

  test('personal and project presets work as the first word', () => {
    const presets = { user: { mine: { tier: 'fast', groups: ['ui'] } }, project: { 'before-release': { tier: 'thorough', groups: [] } } }
    expect(plan(['mine'], { presets })).toMatchObject({ kind: 'run', args: ['--app', cwd, '--preset', 'mine'] })
    expect(plan(['before-release', 'here'], { presets })).toMatchObject({ kind: 'run', args: ['--app', cwd, '--preset', 'before-release'] })
    expect(plan(['mine'])).toMatchObject({ kind: 'error' })
  })

  test('the look-at-results commands', () => {
    expect(plan(['last'])).toEqual({ kind: 'last', args: ['--last'] })
    expect(plan(['why', 'secret-scan'])).toEqual({ kind: 'why', args: ['--why', 'secret-scan'] })
    expect(plan(['why'])).toMatchObject({ kind: 'error' })
    expect(plan(['logs'])).toEqual({ kind: 'logs', args: ['--logs'] })
  })

  test('list, self-test and init carry the app folder', () => {
    expect(plan(['list'])).toMatchObject({ kind: 'list', args: ['--app', cwd, '--list'] })
    expect(plan(['self-test', './x'])).toMatchObject({ kind: 'self-test', args: ['--app', resolve(cwd, 'x'), '--self-test'] })
    expect(plan(['init'])).toMatchObject({ kind: 'init', args: ['--app', cwd, '--init'] })
  })

  test('help, version, presets, bug', () => {
    for (const w of ['help', '-h', '--help']) expect(plan([w])).toEqual({ kind: 'help' })
    for (const w of ['--version', '-v']) expect(plan([w])).toEqual({ kind: 'version' })
    expect(plan(['presets'])).toEqual({ kind: 'presets' })
    expect(plan(['bug'])).toEqual({ kind: 'bug' })
  })

  test('update commands', () => {
    expect(plan(['update'])).toEqual({ kind: 'update', action: 'apply', yes: false })
    expect(plan(['update', '--yes'])).toEqual({ kind: 'update', action: 'apply', yes: true })
    expect(plan(['update', '--check'])).toEqual({ kind: 'update', action: 'check', yes: false })
    for (const m of ['auto', 'notify', 'off']) expect(plan(['update', m])).toEqual({ kind: 'update', action: 'set', mode: m })
    expect(plan(['update', 'status'])).toEqual({ kind: 'update', action: 'status' })
    expect(plan(['update', 'sometimes'])).toMatchObject({ kind: 'error' })
  })

  test('pack commands', () => {
    expect(plan(['pack', 'add', 'p'])).toEqual({ kind: 'pack', action: 'add', folder: resolve(cwd, 'p') })
    expect(plan(['pack', 'remove', 'p'])).toEqual({ kind: 'pack', action: 'remove', folder: resolve(cwd, 'p') })
    expect(plan(['pack', 'list'])).toEqual({ kind: 'pack', action: 'list' })
    expect(plan(['pack', 'add'])).toMatchObject({ kind: 'error' })
    expect(plan(['pack'])).toMatchObject({ kind: 'error' })
  })

  test('an unknown command lists the commands and the presets', () => {
    const r = plan(['frobnicate']) as { kind: string; message: string }
    expect(r.kind).toBe('error')
    expect(r.message).toContain('frobnicate')
    expect(r.message).toContain('verify')
    expect(r.message).toContain('security-fast')
  })

  test('the plain-English text never uses em dashes', () => {
    expect(helpText(none)).not.toContain('—')
    expect(presetsText(none)).not.toContain('—')
  })

  test('listPresets says where each preset comes from', () => {
    const rows = listPresets({ user: { mine: { tier: 'fast', groups: ['ui'], about: 'x' } }, project: { quick: { tier: 'thorough', groups: [] } } })
    expect(rows.find((r) => r.name === 'mine')).toMatchObject({ source: 'personal', tier: 'fast', kinds: ['ui'] })
    expect(rows.find((r) => r.name === 'quick')).toMatchObject({ source: 'project', tier: 'thorough' })
    expect(rows.find((r) => r.name === 'ci')).toMatchObject({ source: 'bundled' })
  })
})

describe('menu key handling', () => {
  test('parseKeys', () => {
    expect(parseKeys('\x1b[A\x1b[B')).toEqual(['up', 'down'])
    expect(parseKeys('j k\r')).toEqual(['j', 'space', 'k', 'enter'])
    expect(parseKeys('\x1b')).toEqual(['escape'])
    expect(parseKeys('\x03')).toEqual(['ctrl-c'])
    expect(parseKeys('\x1b[3~a')).toEqual(['a'])
  })

  const items = menuItems(none)
  test('the menu has the groups and items asked for', () => {
    const headings = items.filter((i) => i.kind === 'heading').map((i) => i.label)
    expect(headings).toEqual(['Everything', 'By kind', 'Combinations', 'More'])
    const labels = items.filter((i) => i.kind === 'item').map((i) => i.label)
    for (const l of ['quick', 'full', 'security-fast', 'refactor', 'app-fast', 'release', 'Choose checks one by one', 'Create a preset', 'See the last report', 'Read a log', 'Update Meerkat', 'Quit']) expect(labels).toContain(l)
  })

  test('a Mine group appears when there are personal or project presets', () => {
    const withMine = menuItems({ user: { mine: { tier: 'fast', groups: [] } }, project: {} })
    expect(withMine.filter((i) => i.kind === 'heading').map((i) => i.label)).toContain('Mine')
  })

  test('the cursor starts on the first item and skips headings', () => {
    const s = initialState(items)
    expect(items[s.cursor]).toMatchObject({ kind: 'item', label: 'quick' })
    let st = s
    for (let i = 0; i < 2; i++) st = menuStep(st, 'down').state
    expect(items[st.cursor].kind).toBe('item')
    expect(items[st.cursor].label).toBe('security-fast') // quick, full, then past the "By kind" heading
  })

  test('up wraps to the last item; j and k work like the arrows', () => {
    const s = initialState(items)
    const up = menuStep(s, 'up').state
    expect(items[up.cursor].label).toBe('Quit')
    expect(menuStep(s, 'j').state.cursor).toBe(menuStep(s, 'down').state.cursor)
    expect(menuStep(menuStep(s, 'down').state, 'k').state.cursor).toBe(s.cursor)
  })

  test('Enter chooses; q and Esc quit; Ctrl+C aborts', () => {
    const s = initialState(items)
    expect(menuStep(s, 'enter').action).toMatchObject({ type: 'choose', item: { label: 'quick', value: { type: 'preset', name: 'quick' } } })
    expect(menuStep(s, 'q').action).toEqual({ type: 'quit' })
    expect(menuStep(s, 'escape').action).toEqual({ type: 'quit' })
    expect(menuStep(s, 'ctrl-c').action).toEqual({ type: 'abort' })
  })

  test('a number jumps to that item', () => {
    const s = menuStep(initialState(items), '3').state
    expect(items[s.cursor].label).toBe('security-fast')
  })

  test('multi-select: Space toggles, Enter needs something ticked', () => {
    const multi = initialState([{ kind: 'heading', label: 'ui' }, { kind: 'item', label: 'a', value: 'a', checked: false }, { kind: 'item', label: 'b', value: 'b', checked: false }], { multi: true })
    expect(menuStep(multi, 'enter').action).toBeNull()
    let st = menuStep(multi, 'space').state
    st = menuStep(menuStep(st, 'down').state, 'space').state
    expect(menuStep(st, 'enter').action).toEqual({ type: 'submit', values: ['a', 'b'] })
    st = menuStep(st, 'space').state
    expect(menuStep(st, 'enter').action).toEqual({ type: 'submit', values: ['a'] })
  })

  test('lineStep builds a line', () => {
    let st = { text: '' }
    for (const k of ['m', 'y', 'space', 'x', 'backspace']) st = lineStep(st, k).state
    expect(st.text).toBe('my ')
    expect(lineStep(st, 'enter').action).toEqual({ type: 'submit', value: 'my ' })
    expect(lineStep(st, 'escape').action).toEqual({ type: 'quit' })
  })

  test('renderPicker cuts lines to the width and keeps the highlight in view', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ kind: 'item', label: `item-${i}-${'x'.repeat(60)}`, value: i, about: 'about it' }))
    let st = initialState(long)
    for (let i = 0; i < 30; i++) st = menuStep(st, 'down').state
    const lines = renderPicker(st, { title: 'MEERKAT', question: 'What would you like to run?', maxRows: 10, width: 30 })
    expect(lines.every((l) => l.text.length <= 29)).toBe(true)
    expect(lines.some((l) => l.style === 'cursor' && l.text.startsWith('> item-30'))).toBe(true)
    expect(lines.length).toBeLessThan(20)
    expect(lines[0].text).toBe('MEERKAT')
  })

  test('parseCheckList takes the first word of each check line', () => {
    const text = 'risky-code               security      fast      free      ~   1s  Risky calls\nnpm-audit-all  security  thorough  free  ~ 5s  audit\nwarning: something\n'
    expect(parseCheckList(text)).toEqual([
      { id: 'risky-code', kind: 'security', tier: 'fast' },
      { id: 'npm-audit-all', kind: 'security', tier: 'thorough' },
    ])
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-cli-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('saving presets', () => {
  test('a project preset is added without removing anything else, with 2-space indent', () => {
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ packs: ['rust'], presets: { old: { tier: 'fast' } }, disable: ['x'] }))
    const r = saveProjectPreset(dir, 'mine', { tier: 'fast', groups: ['ui'] })
    expect(r.ok).toBe(true)
    const text = readFileSync(join(dir, 'meerkat.config.json'), 'utf8')
    const back = JSON.parse(text)
    expect(back.packs).toEqual(['rust'])
    expect(back.disable).toEqual(['x'])
    expect(back.presets.old).toEqual({ tier: 'fast' })
    expect(back.presets.mine.groups).toEqual(['ui'])
    expect(text).toContain('\n  "packs"')
  })

  test('a config that is not valid JSON is left alone', () => {
    writeFileSync(join(dir, 'meerkat.config.json'), '{ nope')
    expect(saveProjectPreset(dir, 'mine', { tier: 'fast', groups: [] }).ok).toBe(false)
    expect(readFileSync(join(dir, 'meerkat.config.json'), 'utf8')).toBe('{ nope')
  })

  test('a personal preset goes into the user config and keeps other keys', () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'user.json') }
    writeUserConfig({ cargoLock: 'x', presets: { a: { tier: 'fast', groups: [] } } }, env)
    savePersonalPreset('b', { tier: 'thorough', groups: ['ui'] }, env)
    const c = readUserConfig(env)
    expect(c.cargoLock).toBe('x')
    expect(Object.keys(c.presets)).toEqual(['a', 'b'])
  })
})

describe('packs', () => {
  test('add (absolute, no duplicates), list and remove', () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'user.json') }
    const packs = join(dir, 'my-packs')
    mkdirSync(join(packs, 'alpha'), { recursive: true })
    const home = join(dir, 'home')
    expect(packAdd(packs, env, home).ok).toBe(true)
    expect(packAdd(packs, env, home).text).toContain('already')
    expect((readUserConfig(env).packDirs as string[]).length).toBe(1)
    expect(packList(env, home)).toContain('alpha')
    expect(packAdd(join(dir, 'missing'), env, home).ok).toBe(false)
    expect(packRemove(packs, env, home).ok).toBe(true)
    expect(readUserConfig(env).packDirs).toBeUndefined()
    expect(packRemove(packs, env, home).ok).toBe(false)
  })
})

// ---------- update ----------

type Call = [string, string[]]
function fakeExec(answers: Record<string, string | Error>, calls: Call[] = []) {
  return (cmd: string, args: string[]) => {
    calls.push([cmd, args])
    const key = args.join(' ')
    for (const [k, v] of Object.entries(answers)) {
      if (key === k || key.startsWith(k)) {
        if (v instanceof Error) throw v
        return v
      }
    }
    throw new Error(`unexpected git ${key}`)
  }
}
const repo = resolve('/meerkat/clone')
const clone = { 'rev-parse --show-toplevel': `${repo}\n`, 'symbolic-ref': 'origin/main\n', 'fetch --quiet origin': '' }

describe('update', () => {
  test('not a git clone', () => {
    const exec = fakeExec({ 'rev-parse --show-toplevel': new Error('not a git repository') })
    expect(checkForUpdate({ repoDir: repo, exec })).toEqual({ ok: false, reason: 'not a git clone, update it the way you installed it' })
  })

  test('a folder inside someone else\'s repository is not a clone of its own', () => {
    const exec = fakeExec({ 'rev-parse --show-toplevel': `${resolve('/elsewhere')}\n` })
    expect(checkForUpdate({ repoDir: repo, exec }).ok).toBe(false)
  })

  test('up to date', () => {
    const exec = fakeExec({ ...clone, 'rev-list --count': '0\n', 'show origin/main:package.json': '{"version":"0.1.0"}' })
    expect(checkForUpdate({ repoDir: repo, exec })).toMatchObject({ ok: true, behind: 0, commits: [] })
  })

  test('behind, with commit subjects and the remote version, and only one fetch', () => {
    const calls: Call[] = []
    const exec = fakeExec({ ...clone, 'rev-list --count': '2\n', 'log --format=%s': 'Add menu\nFix bug\n', 'show origin/main:package.json': '{"version":"0.2.0"}' }, calls)
    const r = checkForUpdate({ repoDir: repo, exec })
    expect(r).toMatchObject({ ok: true, behind: 2, commits: ['Add menu', 'Fix bug'], version: '0.2.0' })
    expect(calls.filter(([, a]) => a[0] === 'fetch').length).toBe(1)
  })

  test('at most 15 commit subjects', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`).join('\n')
    const exec = fakeExec({ ...clone, 'rev-list --count': '40\n', 'log --format=%s': many, 'show': '{}' })
    expect((checkForUpdate({ repoDir: repo, exec }) as { commits: string[] }).commits.length).toBe(15)
  })

  test('falls back to origin/main when origin has no default branch recorded', () => {
    const calls: Call[] = []
    const exec = fakeExec({ 'rev-parse --show-toplevel': `${repo}\n`, 'symbolic-ref': new Error('no'), 'fetch --quiet origin': '', 'rev-list --count': '0\n', show: '{}' }, calls)
    checkForUpdate({ repoDir: repo, exec })
    expect(calls.some(([, a]) => a.includes('HEAD..origin/main'))).toBe(true)
  })

  test('a dirty tree is refused', () => {
    const exec = fakeExec({ ...clone, 'status --porcelain': ' M run.mjs\n' })
    const r = applyUpdate({ repoDir: repo, exec })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toContain('changes')
  })

  test('a non-fast-forward is refused and nothing is merged', () => {
    const calls: Call[] = []
    const exec = fakeExec({ ...clone, 'status --porcelain': '', 'merge-base --is-ancestor': new Error('exit 1') }, calls)
    expect(applyUpdate({ repoDir: repo, exec }).ok).toBe(false)
    expect(calls.some(([, a]) => a[0] === 'merge')).toBe(false)
  })

  test('a clean fast-forward is applied with --ff-only', () => {
    const calls: Call[] = []
    let merged = false
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, args])
      const key = args.join(' ')
      if (key === 'merge --ff-only origin/main') {
        merged = true
        return ''
      }
      if (key === 'show HEAD:package.json') return JSON.stringify({ version: merged ? '0.2.0' : '0.1.0' })
      return fakeExec({ ...clone, 'status --porcelain': '', 'merge-base --is-ancestor': '' })(cmd, args)
    }
    expect(applyUpdate({ repoDir: repo, exec })).toEqual({ ok: true, from: '0.1.0', to: '0.2.0' })
    expect(merged).toBe(true)
  })

  test('mode off never calls exec', () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'u.json') }
    const calls: Call[] = []
    const r = maybeAutoUpdate({ repoDir: repo, exec: fakeExec({}, calls), env, home: dir })
    expect(r).toMatchObject({ ran: false })
    expect(calls.length).toBe(0)
    expect(readUserConfig(env).lastUpdateCheck).toBeUndefined()
  })

  test('notify checks at most once every 24 hours and only prints', () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'u.json') }
    writeUserConfig({ updates: 'notify' }, env)
    const calls: Call[] = []
    const exec = fakeExec({ ...clone, 'rev-list --count': '3\n', 'log --format=%s': 'a\nb\nc', 'show origin/main:package.json': '{"version":"0.3.0"}' }, calls)
    const printed: string[] = []
    const t0 = Date.parse('2026-10-31T10:00:00Z')
    expect(maybeAutoUpdate({ repoDir: repo, exec, env, now: t0, print: (l: string) => printed.push(l) })).toMatchObject({ ran: true, notified: true })
    expect(printed.length).toBe(1)
    expect(printed[0]).toContain('meerkat update')
    const after = calls.length
    expect(maybeAutoUpdate({ repoDir: repo, exec, env, now: t0 + 23 * 3600e3, print: (l: string) => printed.push(l) })).toMatchObject({ ran: false })
    expect(calls.length).toBe(after)
    expect(calls.some(([, a]) => a[0] === 'merge')).toBe(false)
    expect(maybeAutoUpdate({ repoDir: repo, exec, env, now: t0 + 25 * 3600e3, print: (l: string) => printed.push(l) })).toMatchObject({ ran: true })
    expect(calls.length).toBeGreaterThan(after)
  })

  test('auto applies a clean fast-forward and says what changed; a failed check is silent', () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'u.json') }
    writeUserConfig({ updates: 'auto' }, env)
    let merged = false
    const base = fakeExec({ ...clone, 'rev-list --count': '1\n', 'log --format=%s': 'Faster start', 'status --porcelain': '', 'merge-base --is-ancestor': '' })
    const exec = (cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.startsWith('merge --ff-only')) return ((merged = true), '')
      if (key.startsWith('show')) return JSON.stringify({ version: merged || key.startsWith('show origin') ? '0.2.0' : '0.1.0' })
      return base(cmd, args)
    }
    const printed: string[] = []
    const r = maybeAutoUpdate({ repoDir: repo, exec, env, now: Date.now(), print: (l: string) => printed.push(l) })
    expect(merged).toBe(true)
    expect(r.applied).toMatchObject({ ok: true })
    expect(printed[0]).toContain('Faster start')

    const env2 = { MEERKAT_USER_CONFIG: join(dir, 'u2.json') }
    writeUserConfig({ updates: 'auto' }, env2)
    const boom = () => {
      throw new Error('network down')
    }
    const quiet: string[] = []
    expect(() => maybeAutoUpdate({ repoDir: repo, exec: boom, env: env2, print: (l: string) => quiet.push(l) })).not.toThrow()
    expect(quiet).toEqual([])
  })

  test('meerkat update --check shows commits and changes nothing; mode and status commands', async () => {
    const env = { MEERKAT_USER_CONFIG: join(dir, 'u.json') }
    const calls: Call[] = []
    const exec = fakeExec({ ...clone, 'rev-list --count': '1\n', 'log --format=%s': 'New thing', 'show origin/main:package.json': '{"version":"0.2.0"}' }, calls)
    let text = ''
    const stdout = { write: (t: string) => ((text += t), true) }
    const code = await runUpdateCommand({ kind: 'update', action: 'check', yes: false }, { repoDir: repo, exec, env, stdout: stdout as never, home: dir })
    expect(code).toBe(0)
    expect(text).toContain('New thing')
    expect(calls.some(([, a]) => a[0] === 'merge')).toBe(false)
    text = ''
    await runUpdateCommand({ kind: 'update', action: 'set', mode: 'notify' }, { repoDir: repo, env, stdout: stdout as never, home: dir })
    expect(readUserConfig(env).updates).toBe('notify')
    expect(text).toContain('notify')
    text = ''
    await runUpdateCommand({ kind: 'update', action: 'status' }, { repoDir: repo, env, stdout: stdout as never, home: dir })
    expect(text).toContain('Update mode: notify')
  })
})

// ---------- bug report ----------

function fakeRun(root: string, logs: Record<string, string>, results: Array<Record<string, unknown>>) {
  const runDir = join(root, 'runs', '20261031-000000-fast')
  mkdirSync(runDir, { recursive: true })
  const withLogs = results.map((r) => ({ ...r, logFile: join(runDir, `${r.id}.log`) }))
  for (const [id, text] of Object.entries(logs)) writeFileSync(join(runDir, `${id}.log`), text)
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ argv: ['--app', 'x', '--preset', 'quick'], summary: 'MEERKAT fast: 1 passed, 2 failed', exitCode: 1, results: withLogs }))
  writeFileSync(join(root, 'latest.json'), JSON.stringify({ dir: runDir }))
}

describe('buildBugReport', () => {
  test('no run gives the no-run message and the issue line', () => {
    const md = buildBugReport({ env: { MEERKAT_LOG_DIR: join(dir, 'empty') } })
    expect(md).toContain('No run has been saved yet')
    expect(md.trimEnd().endsWith('Open an issue at https://github.com/SamuelNDCE/Meerkat/issues/new and paste this in.')).toBe(true)
    expect(md).toContain('Node:')
  })

  test('a normal log tail is included; a log with a key is left out', () => {
    const fakeKey = 'AKIA' + 'IOSFODNN7EXAMPLE'
    fakeRun(
      dir,
      { good: `${Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')}\nthe real problem is here\n`, bad: `starting\nkey = ${fakeKey}\n` },
      [
        { id: 'good', status: 'FAIL', detail: 'good: it broke' },
        { id: 'bad', status: 'FAIL', detail: 'bad: it broke too' },
        { id: 'skipped', status: 'NOT RUN', detail: 'skipped: needs a window' },
        { id: 'fine', status: 'PASS' },
      ],
    )
    const md = buildBugReport({ env: { MEERKAT_LOG_DIR: dir } })
    expect(md).toContain('the real problem is here')
    expect(md).not.toContain('line 5\n')
    expect(md).not.toContain(fakeKey)
    expect(md).toContain('(log left out: it looks like it contains a secret)')
    expect(md).toContain('skipped: NOT RUN: skipped: needs a window')
    expect(md).not.toContain('- fine')
  })

  test('listRunChecks puts failed and NOT RUN first', () => {
    fakeRun(dir, {}, [{ id: 'a', status: 'PASS', ms: 10 }, { id: 'b', status: 'NOT RUN' }, { id: 'c', status: 'FAIL', ms: 2500 }])
    const list = listRunChecks(join(dir, 'runs', '20261031-000000-fast'))
    expect(list.map((c) => c.id)).toEqual(['c', 'b', 'a'])
    expect(list[0].time).toBe('2.5s')
  })
})

describe('the folder word: a pasted path or the name of a project', () => {
  const cwd2 = resolve('/work/here')
  test('a pasted path, with or without quotes, is used as it is', () => {
    expect(planCommand(['verify', '"C:\Users\me\my app"'], { cwd: cwd2, presets: {} })).toMatchObject({ args: expect.arrayContaining(['--app']) })
    expect(planCommand(['verify', '../other'], { cwd: cwd2, presets: {} })).toMatchObject({ args: ['--app', resolve(cwd2, '../other'), '--preset', 'quick'] })
  })
  test('a bare name is found in the current folder, its parent, or an added root; an unknown name says where it looked', () => {
    const exists = (p: string) => p.toLowerCase().endsWith('plume')
    const list = (d: string) => (d === resolve('/work') ? ['Plume', 'other'] : [])
    expect(findProject('plume', { cwd: cwd2, exists, list })).toMatchObject({ folder: resolve('/work', 'Plume') })
    const none = findProject('ghost', { cwd: cwd2, exists, list })
    expect(none.folder).toBeNull()
    expect(none.searched.length).toBeGreaterThan(1)
    expect(planCommand(['verify', 'ghost-project-name-xyz'], { cwd: cwd2, presets: {} })).toMatchObject({ kind: 'error' })
  })
  test('root commands and the help lead with commands', () => {
    expect(planCommand(['root', 'add', './dev'], { cwd: cwd2, presets: {} })).toMatchObject({ kind: 'root', action: 'add', folder: resolve(cwd2, 'dev') })
    expect(helpText({})).toContain('meerkat verify <folder>')
  })
})
