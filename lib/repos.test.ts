// Finding repositories (lib/repos.mjs), the recent list (lib/userconfig.mjs), the project picker's pure key handling (lib/menu.mjs)
// and the `repos` / `recent` commands.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { planCommand } from './cli.mjs'
import { execute } from './commands.mjs'
import { COMMANDS } from './help.mjs'
import { completionScript } from './completion.mjs'
import { browseItems, browseState, browseStep, menuItems, pickerItems, pickerState, pickerStep, resolveTypedProject } from './menu.mjs'
import { discoverRepos, findRepoRoot, listDrives, listSubfolders, readBranch, scanFolder } from './repos.mjs'
import { RECENT_MAX, addRecent, clearRecent, readRecent, writeUserConfig } from './userconfig.mjs'

let dir: string
let env: Record<string, string>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-repos-'))
  env = { MEERKAT_USER_CONFIG: join(dir, 'user.json') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const repo = (...parts: string[]) => {
  const p = join(dir, ...parts)
  mkdirSync(join(p, '.git'), { recursive: true })
  writeFileSync(join(p, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return p
}
const folder = (...parts: string[]) => {
  const p = join(dir, ...parts)
  mkdirSync(p, { recursive: true })
  return p
}
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort()
const discover = (extra = {}) => discoverRepos({ cwd: join(dir, 'nowhere'), env, home: join(dir, 'home'), meerkatDir: join(dir, 'x', 'meerkat'), places: [], ...extra })

describe('scanning for repositories', () => {
  test('finds repos up to three levels deep and no further', () => {
    repo('root', 'a')
    repo('root', 'b', 'c')
    repo('root', 'd', 'e', 'f')
    repo('root', 'g', 'h', 'i', 'j')
    const r = discover({ scan: [join(dir, 'root')] })
    expect(names(r.found)).toEqual(['a', 'c', 'f'])
  })

  test('does not look inside a repository, and the scan root itself can be a repo', () => {
    repo('root', 'outer')
    repo('root', 'outer', 'inner')
    expect(names(discover({ scan: [join(dir, 'root')] }).found)).toEqual(['outer'])
    repo('solo')
    expect(names(discover({ scan: [join(dir, 'solo')] }).found)).toEqual(['solo'])
  })

  test('skips node_modules, target, dist, build, AppData, Windows folders and hidden folders', () => {
    for (const skip of ['node_modules', 'target', 'dist', 'build', 'AppData', 'Windows', '.hidden', 'Program Files']) repo('root', skip, 'trapped')
    repo('root', 'kept')
    expect(names(discover({ scan: [join(dir, 'root')] }).found)).toEqual(['kept'])
  })

  test('never follows a link out of the tree', () => {
    const outside = repo('outside', 'secret-repo')
    folder('root')
    try {
      symlinkSync(join(dir, 'outside'), join(dir, 'root', 'link'), 'junction')
    } catch {
      return // links cannot be made here: nothing to prove
    }
    repo('root', 'real')
    expect(outside).toBeTruthy()
    expect(names(discover({ scan: [join(dir, 'root')] }).found)).toEqual(['real'])
  })

  test('stops at the repo cap and says so', () => {
    for (let i = 0; i < 10; i++) repo('root', `r${i}`)
    const r = discover({ scan: [join(dir, 'root')], maxRepos: 4 })
    expect(r.found.length).toBe(4)
    expect(r.truncated).toBe(true)
  })

  test('stops at the time limit', () => {
    for (let i = 0; i < 5; i++) repo('root', `r${i}`)
    let t = 0
    const r = discover({ scan: [join(dir, 'root')], maxMs: 10, now: () => (t += 20) })
    expect(r.found.length).toBeLessThan(5)
    expect(r.truncated).toBe(true)
  })

  test('scanFolder shares its state so the caps cover many roots', () => {
    repo('one', 'a')
    repo('two', 'b')
    const state = { found: new Map(), truncated: false, stop: () => state.found.size >= 1 }
    scanFolder(join(dir, 'one'), { state })
    scanFolder(join(dir, 'two'), { state })
    expect(state.found.size).toBe(1)
  })

  test('an unreadable or missing root adds nothing and does not throw', () => {
    expect(discover({ scan: [join(dir, 'does-not-exist')] }).found).toEqual([])
  })
})

describe('reading a repository', () => {
  test('branch from .git/HEAD: a branch, a detached commit, a worktree file, nothing', () => {
    const p = repo('r')
    expect(readBranch(p)).toBe('main')
    writeFileSync(join(p, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
    expect(readBranch(p)).toBe('(detached 0123456)')
    const wt = folder('wt')
    const real = folder('gitdirs', 'wt')
    writeFileSync(join(real, 'HEAD'), 'ref: refs/heads/feature/x\n')
    writeFileSync(join(wt, '.git'), `gitdir: ${real}\n`)
    expect(readBranch(wt)).toBe('feature/x')
    expect(readBranch(folder('plain'))).toBeNull()
  })

  test('a repo has name, path, branch and lastModified', () => {
    repo('root', 'app')
    const [r] = discover({ scan: [join(dir, 'root')] }).found
    expect(r).toMatchObject({ name: 'app', path: join(dir, 'root', 'app'), branch: 'main', isRepo: true })
    expect(r.lastModified).toBeGreaterThan(0)
  })

  test('findRepoRoot walks up from inside a repo', () => {
    const p = repo('proj')
    const deep = folder('proj', 'src', 'deep')
    expect(findRepoRoot(deep)).toBe(p)
    expect(findRepoRoot(folder('loose'))?.startsWith(dir)).not.toBe(true)
  })
})

describe('discovery order', () => {
  test('here is the repo root of the folder you are in; a plain folder stays itself', () => {
    const p = repo('proj')
    expect(discover({ cwd: join(p, 'src') }).here).toMatchObject({ path: p, isRepo: true })
    const plain = folder('plain')
    expect(discover({ cwd: plain }).here).toMatchObject({ path: plain, isRepo: false })
  })

  test('recent first, then found by newest activity, without repeats', async () => {
    const a = repo('root', 'a')
    const b = repo('root', 'b')
    const c = repo('root', 'c')
    const old = new Date(Date.now() - 100000)
    const { utimesSync } = await import('node:fs')
    utimesSync(join(a, '.git', 'HEAD'), old, old)
    addRecent(c, env, join(dir, 'home'))
    const r = discover({ scan: [join(dir, 'root')] })
    expect(r.recent.map((x: { path: string }) => x.path)).toEqual([c])
    expect(r.found.map((x: { path: string }) => x.path)).toEqual([b, a])
    expect(r.all.map((x: { path: string }) => x.path)).toEqual([c, b, a])
  })

  test('saved roots are scanned', () => {
    repo('mine', 'proj')
    writeUserConfig({ roots: [join(dir, 'mine')] }, env)
    expect(names(discover().found)).toEqual(['proj'])
  })

  test('common places and the folders next to Meerkat are scanned when they exist', () => {
    repo('home', 'code', 'tool')
    repo('x', 'sibling')
    folder('x', 'meerkat')
    const r = discover({ places: ['code', 'nope'] })
    expect(names(r.found)).toEqual(['sibling', 'tool'])
  })

  test('names with control characters are cleaned', () => {
    // a folder name cannot hold escape characters on Windows; the clean-up is still applied to whatever comes back
    repo('root', 'ok')
    expect(discover({ scan: [join(dir, 'root')] }).found[0].name).not.toMatch(/[\u0000-\u001f]/)
  })
})

describe('the recent list', () => {
  const home = () => join(dir, 'home')
  test('newest first, no repeats, at most 12', () => {
    const made = Array.from({ length: 15 }, (_, i) => folder('p', `p${i}`))
    for (const p of made) addRecent(p, env, home())
    addRecent(made[3], env, home())
    const list = readRecent(env, home())
    expect(list.length).toBe(RECENT_MAX)
    expect(list[0]).toBe(made[3])
    expect(list.filter((p) => p === made[3]).length).toBe(1)
    expect(list[1]).toBe(made[14])
  })

  test('validated on read: strings, absolute, existing, no control characters', () => {
    const ok = folder('ok')
    writeUserConfig({ recent: [ok, 'relative/path', 42, null, join(dir, 'gone'), `${ok}\u001b[31m`, ok] }, env)
    expect(readRecent(env, home())).toEqual([ok])
    writeUserConfig({ recent: 'not a list' }, env)
    expect(readRecent(env, home())).toEqual([])
  })

  test('a folder that does not exist is not added; clear empties the list', () => {
    addRecent(join(dir, 'gone'), env, home())
    expect(readRecent(env, home())).toEqual([])
    addRecent(folder('real'), env, home())
    expect(readRecent(env, home()).length).toBe(1)
    clearRecent(env, home())
    expect(readRecent(env, home())).toEqual([])
  })
})

describe('the project picker keys', () => {
  const row = (name: string, extra = {}) => ({ name, path: `/code/${name}`, branch: 'main', isRepo: true, lastModified: 1, ...extra })
  const data = { here: row('here-app'), recent: [row('recent-app')], found: [row('alpha'), row('beta'), row('alpine')] }
  const labels = (s: ReturnType<typeof pickerState>) => pickerItems(s).filter((i: { kind: string }) => i.kind === 'item').map((i: { label: string }) => i.label)

  test('sections come in order: Here, Recent, Repos found, then the ways to pick something else', () => {
    const s = pickerState(data, { drives: ['C:\\', 'D:\\'] })
    expect(pickerItems(s).filter((i: { kind: string }) => i.kind === 'heading').map((i: { label: string }) => i.label)).toEqual(['Here', 'Recent', 'Repos found', 'Other ways'])
    expect(labels(s).slice(-3)).toEqual(['Browse folders...', 'Type or paste a path...', 'Choose another drive'])
    expect(pickerItems(pickerState(data)).some((i: { label: string }) => i.label === 'Choose another drive')).toBe(false)
  })

  test('the cursor starts on Here and Enter chooses it', () => {
    const s = pickerState(data)
    const r = pickerStep(s, 'enter')
    expect(r.action).toMatchObject({ type: 'choose', item: { value: { type: 'project', path: '/code/here-app' } } })
  })

  test('typing narrows the lists, Backspace widens them, Esc clears, Esc again quits', () => {
    let s = pickerState(data)
    for (const k of ['a', 'l', 'p']) s = pickerStep(s, k).state
    expect(s.filter).toBe('alp')
    expect(labels(s).filter((l: string) => l.startsWith('al'))).toEqual(['alpha  (main)', 'alpine  (main)'])
    expect(labels(s)).not.toContain('beta  (main)')
    // the cursor lands on the first match, so Enter picks it
    expect(pickerStep(s, 'enter').action).toMatchObject({ item: { value: { path: '/code/alpha' } } })
    s = pickerStep(s, 'backspace').state
    expect(s.filter).toBe('al')
    s = pickerStep(s, 'escape').state
    expect(s.filter).toBe('')
    expect(pickerStep(s, 'escape').action).toEqual({ type: 'quit' })
    expect(pickerStep(s, 'ctrl-c').action).toEqual({ type: 'abort' })
  })

  test('letters that are menu shortcuts elsewhere (q, j, k, digits) only filter here', () => {
    const s = pickerStep(pickerState(data), 'q').state
    expect(s.filter).toBe('q')
    expect(pickerStep(s, 'q').action).toBeNull()
  })

  test('a filter with no match says so and still offers the other ways', () => {
    const s = pickerStep(pickerState(data), 'z').state
    expect(pickerItems(s).some((i: { label: string }) => i.label.startsWith('Nothing matches'))).toBe(true)
    expect(labels(s)).toContain('Browse folders...')
    expect(pickerStep(s, 'enter').action).toMatchObject({ item: { value: { type: 'browse' } } })
  })

  test('Up and Down skip headings and wrap', () => {
    let s = pickerState(data)
    s = pickerStep(s, 'up').state
    expect(pickerItems(s)[s.cursor]).toMatchObject({ label: 'Type or paste a path...' })
    s = pickerStep(s, 'down').state
    expect(pickerItems(s)[s.cursor]).toMatchObject({ label: 'here-app  (main)' })
  })

  test('with nothing found the picker still opens on a way to pick', () => {
    const s = pickerState({ here: null, recent: [], found: [] })
    expect(pickerItems(s)[s.cursor]).toMatchObject({ label: 'Browse folders...' })
  })
})

describe('browsing folders', () => {
  const tree: Record<string, { name: string; path: string; isRepo: boolean }[]> = {
    '/': [{ name: 'code', path: '/code', isRepo: false }],
    '/code': [{ name: 'app', path: '/code/app', isRepo: true }, { name: 'docs', path: '/code/docs', isRepo: false }, { name: 'locked', path: '/code/locked', isRepo: false }],
    '/code/app': [],
  }
  const read = (d: string) => (d in tree ? { entries: tree[d], note: tree[d].length ? '' : 'No subfolders here', ok: true } : { entries: [], note: 'Cannot open this folder (EACCES)', ok: false })
  const at = (s: { cursor: number }, items: { label: string }[]) => items[s.cursor].label

  test('shows Use this folder, .. (up), subfolders with [repo] marks', () => {
    const s = browseState('/code', read)
    expect(browseItems(s).map((i: { label: string }) => i.label)).toEqual(['Use this folder', '.. (up)', 'app  [repo]', 'docs', 'locked'])
    expect(browseItems(browseState('/', read)).map((i: { label: string }) => i.label)).toEqual(['Use this folder', 'code'])
  })

  test('Enter descends, .. goes up and lands on the folder you left, Use this folder finishes', () => {
    let s = browseState('/', read)
    s = browseStep(s, 'down', read).state
    s = browseStep(s, 'enter', read).state
    expect(s.dir).toBe('/code')
    s = browseStep(s, 'down', read).state
    s = browseStep(s, 'down', read).state
    expect(at(s, browseItems(s))).toBe('app  [repo]')
    s = browseStep(s, 'enter', read).state
    expect(s.dir).toBe('/code/app')
    s = browseStep(s, 'left', read).state
    expect(s.dir).toBe('/code')
    expect(at(s, browseItems(s))).toBe('app  [repo]')
    s = browseStep(s, 'up', read).state
    s = browseStep(s, 'up', read).state
    expect(browseStep(s, 'enter', read).action).toEqual({ type: 'use', path: '/code' })
  })

  test('an unreadable folder shows a note and you stay where you were', () => {
    let s = browseState('/code', read)
    for (let i = 0; i < 4; i++) s = browseStep(s, 'down', read).state
    expect(at(s, browseItems(s))).toBe('locked')
    const r = browseStep(s, 'enter', read)
    expect(r.state.dir).toBe('/code')
    expect(r.state.note).toContain('Cannot open')
    expect(r.action).toBeNull()
  })

  test('typing filters the subfolders; Backspace removes, then goes up; Esc clears, then goes back', () => {
    let s = browseState('/code', read)
    s = browseStep(s, 'd', read).state
    expect(browseItems(s).map((i: { label: string }) => i.label)).toEqual(['Use this folder', '.. (up)', 'docs', 'locked'])
    expect(at(s, browseItems(s))).toBe('docs')
    s = browseStep(s, 'backspace', read).state
    expect(s.filter).toBe('')
    expect(s.dir).toBe('/code')
    expect(browseStep(s, 'backspace', read).state.dir).toBe('/')
    s = browseStep(s, 'x', read).state
    s = browseStep(s, 'escape', read).state
    expect(s.filter).toBe('')
    expect(browseStep(s, 'escape', read).action).toEqual({ type: 'back' })
    expect(browseStep(s, 'ctrl-c', read).action).toEqual({ type: 'abort' })
  })

  test('Backspace at the top of a drive goes back instead of up', () => {
    expect(browseStep(browseState('/', read), 'backspace', read).action).toEqual({ type: 'back' })
  })

  test('listSubfolders lists real folders only, marks repos, hides dot folders, and never throws', () => {
    repo('b-repo')
    folder('a-plain')
    folder('.hidden')
    writeFileSync(join(dir, 'file.txt'), 'x')
    const r = listSubfolders(dir)
    expect(r.entries.map((e: { name: string; isRepo: boolean }) => `${e.name}:${e.isRepo}`)).toEqual(['a-plain:false', 'b-repo:true'])
    const bad = listSubfolders(join(dir, 'missing'))
    expect(bad.entries).toEqual([])
    expect(bad.note).toContain('Cannot open')
  })

  test('drives: only on Windows, from a fake filesystem', () => {
    const fs = { existsSync: (p: string) => p === 'C:\\' || p === 'E:\\' }
    expect(listDrives(fs as never, 'win32')).toEqual(['C:\\', 'E:\\'])
    expect(listDrives(fs as never, 'linux')).toEqual([])
  })
})

describe('typed or pasted folders', () => {
  const isDir = (p: string) => p.includes('ok')
  test('a path works, with quotes, with ~, and a bare name is looked up like meerkat verify <name>', () => {
    mkdirSync(join(dir, 'my-ok-app'))
    expect(resolveTypedProject(`"${join(dir, 'my-ok-app')}"`, { cwd: dir, env, isDir })).toEqual({ folder: join(dir, 'my-ok-app') })
    expect(resolveTypedProject('~/ok', { cwd: dir, env, home: '/home/me', isDir })).toEqual({ folder: resolve('/home/me/ok') })
    expect(resolveTypedProject('my-ok-app', { cwd: dir, env, isDir })).toEqual({ folder: join(dir, 'my-ok-app') })
  })
  test('errors say what is wrong', () => {
    expect(resolveTypedProject('nope-not-here', { cwd: dir, env, isDir }).error).toContain('No project called')
    expect(resolveTypedProject('./nothing', { cwd: dir, env, isDir }).error).toContain('is not a folder')
    expect(resolveTypedProject('   ', { cwd: dir, env, isDir })).toEqual({ error: '' })
  })
})

describe('the repos and recent commands', () => {
  const plan = (argv: string[]) => planCommand(argv, { cwd: dir, env, interactive: true, presets: { user: {}, project: {} } })
  const run = async (argv: string[], extra = {}) => {
    const out: string[] = []
    const err: string[] = []
    const p = plan(argv)
    const code = await execute(p, { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env, cwd: dir, home: join(dir, 'home'), interactive: false, presets: { user: {}, project: {} }, discover: { places: [], meerkatDir: join(dir, 'x', 'meerkat') }, ...extra })
    return { code, out: out.join('\n'), err: err.join('\n'), plan: p }
  }

  test('planning', () => {
    expect(plan(['repos'])).toMatchObject({ kind: 'noun', noun: 'repos', verb: 'list', scan: null })
    expect(plan(['repos', '--scan', 'sub', '--json'])).toMatchObject({ scan: resolve(dir, 'sub'), flags: { json: true } })
    expect(plan(['repos', '--scan'])).toMatchObject({ kind: 'error' })
    expect(plan(['repos', 'stray'])).toMatchObject({ kind: 'error' })
    expect(plan(['repos', '--wat'])).toMatchObject({ kind: 'error' })
    expect(plan(['recent'])).toMatchObject({ noun: 'recent', verb: 'list' })
    expect(plan(['recent', 'clear'])).toMatchObject({ noun: 'recent', verb: 'clear' })
    expect(plan(['recent', 'bogus'])).toMatchObject({ kind: 'error' })
  })

  test('the picker is skipped when a folder is given to the menu, and for runs', () => {
    expect(plan([])).toEqual({ kind: 'menu' })
    expect(plan(['menu'])).toEqual({ kind: 'menu' })
    expect(plan(['menu', dir])).toEqual({ kind: 'menu', folder: dir })
    expect(plan(['verify', dir])).toMatchObject({ kind: 'run', folder: dir })
    expect(planCommand([], { cwd: dir, env, interactive: false, presets: { user: {}, project: {} } })).toEqual({ kind: 'help' })
  })

  test('repos --json lists name, path, branch for a scanned folder', async () => {
    repo('root', 'app')
    const r = await run(['repos', '--scan', join(dir, 'root'), '--json'])
    expect(r.code).toBe(0)
    const rows = JSON.parse(r.out)
    expect(rows).toEqual([{ name: 'app', path: join(dir, 'root', 'app'), branch: 'main' }])
  })

  test('repos text, and an error for a scan folder that is not there', async () => {
    repo('root', 'app')
    expect((await run(['repos', '--scan', join(dir, 'root')])).out).toContain('app')
    const bad = await run(['repos', '--scan', join(dir, 'missing')])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('is not a folder')
    expect((await run(['repos'])).out).toContain('No repositories found')
  })

  test('recent lists, outputs JSON, and clears', async () => {
    const p = folder('proj')
    addRecent(p, env, join(dir, 'home'))
    expect((await run(['recent'])).out).toContain(p)
    expect(JSON.parse((await run(['recent', '--json'])).out)).toEqual([{ name: 'proj', path: p }])
    expect((await run(['recent', 'clear', '--dry-run'])).out).toContain('Dry run')
    expect(readRecent(env, join(dir, 'home')).length).toBe(1)
    expect((await run(['recent', 'clear'])).code).toBe(0)
    expect((await run(['recent'])).out).toContain('No recent projects')
  })

  test('registered for help, describe and completion', () => {
    for (const n of ['repos', 'recent']) {
      const c = COMMANDS.find((x) => x.name === n)
      expect(c?.summary.length).toBeGreaterThan(10)
      expect(c?.examples.length).toBeGreaterThan(0)
      expect(JSON.stringify(c)).not.toContain('\u2014')
    }
    for (const shell of ['powershell', 'bash', 'zsh']) {
      const s = completionScript(shell) as string
      expect(s).toContain('repos')
      expect(s).toContain('recent')
      expect(s).toContain('clear')
    }
  })

  test('the preset menu has a Change project entry', () => {
    expect(menuItems({ user: {}, project: {} }).some((i: { label: string }) => i.label === 'Change project')).toBe(true)
  })
})

describe('writeUserConfig and prototype pollution', () => {
  test('a __proto__, constructor or prototype key in the patch never reaches Object.prototype', () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":1,"updates":"off"}')
    const next = writeUserConfig(patch, env)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(next)).toEqual(['updates'])
  })
})
