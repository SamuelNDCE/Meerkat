// Inheritance is decided from the APPROVED side: only a real, registered worktree of the approved repo inherits.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runTrust } from '../lib/trustcmd.mjs'
// @ts-expect-error plain .mjs module
import { runFrontend } from '../lib/frontend.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-trustharden-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const slash = (p: string) => p.split(String.fromCharCode(92)).join('/')
const COMMANDS = { typecheck: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'x\')"' }
let n = 0
function repo() {
  const dir = join(root, `repo${n++}`)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'package.json'), '{"name":"fx","private":true}')
  writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands: COMMANDS }))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}
function worktree(dir: string, name: string) {
  const wt = join(root, name)
  git(dir, 'worktree', 'add', '-q', '-b', `b-${name}`, wt)
  return wt
}
const env = { ...process.env, MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_TRUST_PROJECT: '0' } as NodeJS.ProcessEnv
async function trust(argv: string[], cwd = root) {
  const lines: string[] = []
  const errs: string[] = []
  const code = await runTrust(argv, { env, cwd, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t), isTTY: false })
  return { code, lines, errs, text: [...lines, ...errs].join('\n') }
}

describe('trust inheritance, hardened', () => {
  test('(a) a real worktree of the approved repo inherits, and the status line names its real path', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-a')
    expect((await trust(['--yes', main])).code).toBe(0)
    const s = await trust(['--status', wt])
    expect(s.code).toBe(0)
    expect(s.lines[0].startsWith(`TRUSTED (inherited from ${slash(main)}, registered worktree ${slash(realpathSync(wt))}): `)).toBe(true)
  })

  test('(b) a plain folder whose .git points at the approved common dir is NOT trusted; frontend refuses (exit 2) and runs nothing', async () => {
    const main = repo()
    await trust(['--yes', main])
    const fake = join(root, 'fake-b')
    mkdirSync(fake, { recursive: true })
    writeFileSync(join(fake, 'meerkat.config.json'), JSON.stringify({ commands: COMMANDS }))
    writeFileSync(join(fake, 'package.json'), '{"name":"evil","scripts":{"test":"echo pwned"}}')
    writeFileSync(join(fake, '.git'), `gitdir: ${slash(join(main, '.git'))}\n`)
    const s = await trust(['--status', fake])
    expect(s.code).toBe(1)
    expect(s.lines[0]).toMatch(/^NOT TRUSTED: /)
    expect(s.text).not.toContain('TRUSTED (inherited')
    const lines: string[] = []
    const errs: string[] = []
    const code = await runFrontend(['--app', fake], { env, cwd: root, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) })
    expect(code).toBe(2)
    expect(errs[0]).toBe(`NOT RUN (status 400): ${slash(fake)} is not trusted yet, so its commands did not run. next: meerkat trust --app '${slash(fake)}'`)
    expect(existsSync(join(fake, 'ran.txt'))).toBe(false)
  })

  test('(c) a worktree removed from the approved repo list stops inheriting', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-c')
    await trust(['--yes', main])
    expect((await trust(['--status', wt])).code).toBe(0)
    git(main, 'worktree', 'remove', '--force', wt)
    // Put a folder back at the same place with the same files and a .git file; git no longer lists it.
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, 'meerkat.config.json'), JSON.stringify({ commands: COMMANDS }))
    writeFileSync(join(wt, '.git'), `gitdir: ${slash(join(main, '.git', 'worktrees', 'wt-c'))}\n`)
    const s = await trust(['--status', wt])
    expect(s.code).toBe(1)
    expect(s.lines[0]).toMatch(/^NOT TRUSTED: /)
  })

  test('(d) trust --list shows the shared record', async () => {
    const main = repo()
    await trust(['--yes', main])
    const l = await trust(['--list'])
    expect(l.text).toMatch(/any worktree of .+ \(commands approved \d{4}-\d\d-\d\d/)
    expect(l.text).toContain(slash(realpathSync(join(main, '.git'))).split('/').slice(-2).join('/'))
  })

  test('(e) revoke from a worktree leaves the main checkout trusted; revoke from the main checkout removes the shared record', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-e')
    const wt2 = worktree(main, 'wt-e2')
    await trust(['--yes', main])
    const rw = await trust(['--revoke', wt])
    expect(rw.code).toBe(0)
    expect(rw.lines[0]).toMatch(/^trust revoked, ONLY this worktree's inheritance/)
    expect((await trust(['--status', wt])).code).toBe(1)
    expect((await trust(['--status', main])).code).toBe(0)
    expect((await trust(['--status', wt2])).code).toBe(0)
    const rm = await trust(['--revoke', main])
    expect(rm.lines[0]).toMatch(/^trust revoked, SHARED approval/)
    expect((await trust(['--status', wt2])).code).toBe(1)
    expect((await trust(['--list'])).text).not.toContain(`any worktree of ${slash(realpathSync(join(main, '.git')))} `)
  })
})
