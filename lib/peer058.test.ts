// Peer-requested features (0.5.8): brief --ref, worktree path banner, snippet-keyed allow entries, tool install hints. Real CLI in scratch git repos.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const bin = fileURLToPath(new URL('../bin/meerkat.mjs', import.meta.url))
let tmp: string
let app: string
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' })
const put = (rel: string, text: string, root = app) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const cli = (args: string[], cwd = tmp, extraEnv: Record<string, string> = {}) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd, env: { ...process.env, NO_COLOR: '1', CI: '1', MEERKAT_LOG_DIR: join(tmp, 'logs'), ...extraEnv } })

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-peer-'))
  app = join(tmp, 'app')
  put('package.json', '{"name":"fx"}\n')
  put('src/a.js', 'export const a = 1\n')
  git(app, ['init', '-q', '-b', 'main'])
  git(app, ['add', '-A'])
  git(app, ['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('brief --ref', () => {
  beforeEach(() => {
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('src/only-feat.js', 'export function onlyFeat() {\n  return 1\n}\n')
    put('src/use.js', "import { onlyFeat } from './only-feat.js'\nexport const x = () => onlyFeat()\n")
    git(app, ['add', '-A'])
    git(app, ['commit', '-q', '-m', 'feat'])
    git(app, ['checkout', '-q', 'main'])
  })
  test('without --ref the error names the ref that has the file; with --ref feat it is found and the ref is on the first line', () => {
    const no = cli(['brief', 'src/only-feat.js', '--app', app])
    expect(no.status).toBe(75)
    expect(no.stdout).toContain('checked out: main')
    expect(no.stdout).toContain('--ref feat')
    const yes = cli(['brief', 'src/only-feat.js#onlyFeat', '--app', app, '--ref', 'feat'])
    expect(yes.status).toBe(0)
    expect(yes.stdout.split('\n')[0]).toContain('ref feat')
    expect(yes.stdout).toContain('src/use.js')
    expect(cli(['brief', 'src/only-feat.js', '--app', app, '--ref', 'nope']).status).toBe(2)
    expect(cli(['brief', 'src/a.js', '--app', app, '--ref', 'feat', '--json']).stdout).toContain('"ref": "feat"')
    const wts = execFileSync('git', ['-C', app, 'worktree', 'list'], { encoding: 'utf8' }).trim().split('\n')
    expect(wts.length).toBe(1)
  })
})

describe('worktree paths', () => {
  test('gate <folder> and brief --app <folder> name the folder, the worktree branch and that it is a worktree', () => {
    git(app, ['branch', 'wt-branch'])
    const wt = join(tmp, 'wt')
    git(app, ['worktree', 'add', '-q', wt, 'wt-branch'])
    put('src/w.js', 'export const w = 1\n', wt)
    const g = cli(['gate', wt, '--no-input'])
    expect(g.stdout.split('\n')[0]).toContain(`folder: ${wt}`)
    expect(g.stdout.split('\n')[0]).toContain('branch wt-branch')
    expect(g.stdout.split('\n')[0]).toContain('git worktree')
    expect(g.stdout.split('\n')[0]).not.toContain('branch main')
    const b = cli(['brief', 'src/a.js', '--app', wt])
    expect(b.stdout.split('\n')[0]).toContain('branch wt-branch')
    expect(b.stdout.split('\n')[0]).toContain('git worktree')
    const main = cli(['brief', 'src/a.js', '--app', app])
    expect(main.stdout.split('\n')[0]).toContain('branch main')
    expect(main.stdout.split('\n')[0]).toContain('main checkout')
    const bj = JSON.parse(cli(['brief', 'src/a.js', '--app', wt, '--json']).stdout)
    expect(bj.checkout).toMatchObject({ branch: 'wt-branch', worktree: true })
    git(wt, ['checkout', '-q', '--detach'])
    expect(cli(['brief', 'src/a.js', '--app', wt]).stdout.split('\n')[0]).toContain('detached at')
  })
})

describe('snippet-keyed allow entries (real a11y rule through node lib/a11y.mjs)', () => {
  const script = fileURLToPath(new URL('./a11y.mjs', import.meta.url))
  const BTN = '<button class="x"><svg viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg></button>'
  const rule = (root: string) => spawnSync(process.execPath, [script, 'a11y-button-name', '--root', root], { encoding: 'utf8' })
  const commit = () => {
    git(app, ['add', '-A'])
    git(app, ['commit', '-q', '-m', 'x'])
  }
  test('a finding prints the exact snippet allow line; a snippet entry still suppresses it after the file gains 50 lines; line entries still work', () => {
    put('bar.html', `<div>\n${BTN}\n</div>\n`)
    commit()
    const first = rule(app)
    expect(first.status).toBe(1)
    const m = /add to \.meerkat-a11y-allow: (.+)$/m.exec(first.stdout)
    expect(m).not.toBeNull()
    expect(m![1]).toContain(`a11y-button-name bar.html | ${BTN}`)
    // paste the printed line, with a reason, as a person would
    put('.meerkat-a11y-allow', `${m![1].replace('# reason', '# icon button is labelled by the parent')}\n`)
    commit()
    expect(rule(app).status).toBe(0)
    // the file grows by 50 lines above the flagged one: the line number changes, the snippet does not
    put('bar.html', `${'<p>filler</p>\n'.repeat(50)}<div>\n${BTN}\n</div>\n`)
    commit()
    expect(rule(app).status).toBe(0)
    // a line-number entry for the OLD position no longer matches after the move (the failure this feature fixes), and a current one still works
    put('.meerkat-a11y-allow', 'a11y-button-name bar.html:52 # moved\n')
    commit()
    expect(rule(app).status).toBe(0)
    put('.meerkat-a11y-allow', 'a11y-button-name bar.html:2 # stale\n')
    commit()
    expect(rule(app).status).toBe(1)
    // a snippet that is not on the flagged line suppresses nothing
    put('.meerkat-a11y-allow', 'a11y-button-name bar.html | <button class="other"> # no\n')
    commit()
    expect(rule(app).status).toBe(1)
  })
})

describe('tool install hints', () => {
  test('each missing system tool gets a hint with the platform name and a command or URL, per platform', async () => {
    // @ts-expect-error plain .mjs module
    const { installHint } = await import('./installhints.mjs')
    for (const [platform, name] of [['win32', 'Windows'], ['darwin', 'macOS'], ['linux', 'Linux']]) {
      for (const bin of ['hadolint', 'actionlint']) {
        const h = installHint(bin, platform)
        expect(h).toContain(name)
        expect(h).toMatch(/https:\/\/|install /)
        expect(h).toContain(bin)
      }
    }
    expect(installHint('hadolint', 'win32')).toContain('scoop install hadolint')
    expect(installHint('actionlint', 'darwin')).toContain('brew install actionlint')
    expect(installHint('hadolint', 'linux')).toContain('https://github.com/hadolint/hadolint/releases')
    expect(installHint('hadolint', 'win32')).not.toContain('winget')
    expect(installHint('nope', 'linux')).toBeNull()
  })
  test('the real CLI (meerkat tools, empty PATH) prints a hint line naming this platform for hadolint and actionlint', () => {
    const empty = join(tmp, 'emptybin')
    mkdirSync(empty, { recursive: true })
    const r = cli(['tools'], tmp, { PATH: empty, Path: empty, HOME: tmp, USERPROFILE: tmp })
    const name = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
    expect(r.stdout).toMatch(new RegExp(`hint +hadolint on ${name}: .*(https://|install )`))
    expect(r.stdout).toMatch(new RegExp(`hint +actionlint on ${name}: .*(https://|install )`))
  })
})
