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
