// A worktree of a trusted repo inherits the approval when its commands block is byte-identical; clearer refusal and approval messages.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runTrust } from '../lib/trustcmd.mjs'
// @ts-expect-error plain .mjs module
import { runFrontend } from '../lib/frontend.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-trustcarry-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const slash = (p: string) => p.split(String.fromCharCode(92)).join('/')
const COMMANDS = { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' }
let n = 0
function repo(commands: Record<string, string> = COMMANDS) {
  const dir = join(root, `repo${n++}`)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'package.json'), '{"name":"fx","private":true}')
  writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands }))
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

describe('worktree trust carry', () => {
  test('(a) approve in the main checkout; the worktree is TRUSTED (inherited) with exit 0', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-a')
    expect((await trust(['--yes', main])).code).toBe(0)
    const s = await trust(['--status', wt])
    expect(s.code).toBe(0)
    expect(s.lines[0].startsWith(`TRUSTED (inherited from ${slash(main)}, registered worktree `)).toBe(true)
  })

  test('(b) a changed commands block in the worktree is NOT TRUSTED, with before/after, exit 1', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-b')
    await trust(['--yes', main])
    writeFileSync(join(wt, 'meerkat.config.json'), JSON.stringify({ commands: { ...COMMANDS, test: 'node -e "process.exit(1)"' } }))
    const s = await trust(['--status', wt])
    expect(s.code).toBe(1)
    expect(s.lines[0]).toMatch(/^NOT TRUSTED: /)
    expect(s.text).toContain('test: before')
    expect(s.text).toContain('test: after')
    expect(s.text).toContain('process.exit(1)')
  })

  test('(c) two different repositories with the same commands do not inherit each other', async () => {
    const a = repo()
    const b = repo()
    await trust(['--yes', a])
    const s = await trust(['--status', b])
    expect(s.code).toBe(1)
    expect(s.lines[0]).toMatch(/^NOT TRUSTED: /)
    expect(s.text).not.toContain('inherited')
  })

  test('revoking in the worktree takes the shared approval back', async () => {
    const main = repo()
    const wt = worktree(main, 'wt-r')
    await trust(['--yes', main])
    expect((await trust(['--revoke', wt])).code).toBe(0)
    expect((await trust(['--status', wt])).code).toBe(1)
    // The main checkout keeps its own record; revoking there too ends every inheritance.
    expect((await trust(['--status', main])).code).toBe(0)
    expect((await trust(['--revoke', main])).code).toBe(0)
    expect((await trust(['--status', wt])).code).toBe(1)
  })

  test('(d) frontend in an untrusted folder exits 2, names the folder first, and runs nothing', async () => {
    const dir = repo({ typecheck: 'node -e "require(\'fs\').writeFileSync(\'ran.txt\',\'x\')"' })
    const lines: string[] = []
    const errs: string[] = []
    const code = await runFrontend(['--app', dir], { env, cwd: root, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) })
    expect(code).toBe(2)
    expect(errs[0]).toBe(`NOT RUN (status 400): ${slash(dir)} is not trusted yet, so its commands did not run. next: meerkat trust --app '${slash(dir)}'`)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(dir, 'ran.txt'))).toBe(false)
  })

  test('(e) trust --yes says what is approved first and ends with the count', async () => {
    const dir = repo()
    const t = await trust(['--yes', dir])
    expect(t.code).toBe(0)
    expect(t.lines[0]).toBe(`meerkat trust will approve 2 command(s) for ${slash(dir)}, which run through a shell:`)
    expect(t.lines[t.lines.length - 1]).toBe(`approved 2 command(s) for ${slash(dir)}`)
  })
})
