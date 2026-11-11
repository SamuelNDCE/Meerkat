// Trust UX: trust, --status, --revoke, --list, and one identical "not trusted" line in test, frontend and gate.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runTrust } from '../lib/trustcmd.mjs'
// @ts-expect-error plain .mjs module
import { notTrustedLine, runNamedCommand, trustCommand } from '../lib/repocommands.mjs'
// @ts-expect-error plain .mjs module
import { frontendGateLine, runFrontend } from '../lib/frontend.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-trustux-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const slash = (p: string) => p.split(String.fromCharCode(92)).join('/')
let n = 0
function fixture(commands: Record<string, string> = { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' }) {
  const dir = join(root, `fx${n++}`)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'package.json'), '{"name":"fx","private":true}')
  writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands }))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  const env = { ...process.env, MEERKAT_LOG_DIR: join(root, `logs${n}`), MEERKAT_TRUST_PROJECT: '0' } as NodeJS.ProcessEnv
  return { dir, env }
}
async function trust(argv: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const lines: string[] = []
  const errs: string[] = []
  const code = await runTrust(argv, { env, cwd, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t), isTTY: false })
  return { code, lines, errs, text: [...lines, ...errs].join('\n') }
}

describe('meerkat trust', () => {
  test('(a) --yes writes a record and status is TRUSTED, exit 0', async () => {
    const fx = fixture()
    const t = await trust(['--yes', fx.dir], fx.env, root)
    expect(t.code).toBe(0)
    expect(t.text).toContain('hash:')
    expect(t.lines.some((l) => /^trusted: .* To take the trust back: meerkat trust --revoke /.test(l))).toBe(true)
    const s = await trust(['--status', fx.dir], fx.env, root)
    expect(s.code).toBe(0)
    expect(s.lines[0]).toMatch(/^TRUSTED: /)
    const l = await trust(['--list'], fx.env, root)
    expect(l.lines.length).toBe(2) // the folder's own record plus the shared record (any worktree of ...)
    expect(l.lines[1]).toMatch(/^any worktree of /)
  })

  test('(b) editing the commands turns status into NOT TRUSTED with before and after, exit 1', async () => {
    const fx = fixture()
    await trust(['--yes', fx.dir], fx.env, root)
    writeFileSync(join(fx.dir, 'meerkat.config.json'), JSON.stringify({ commands: { test: 'node -e "process.exit(1)"', build: 'node -e "process.exit(0)"' } }))
    const s = await trust(['--status', fx.dir], fx.env, root)
    expect(s.code).toBe(1)
    expect(s.lines[0]).toMatch(/^NOT TRUSTED: .*changed since/)
    expect(s.text).toContain('test: before node -e "process.exit(0)"')
    expect(s.text).toContain('test: after  node -e "process.exit(1)"')
  })

  test('(c) revoking twice says already not trusted the second time, exit 0', async () => {
    const fx = fixture()
    await trust(['--yes', fx.dir], fx.env, root)
    const a = await trust(['--revoke', fx.dir], fx.env, root)
    expect(a.code).toBe(0)
    expect(a.text).toContain('trust revoked')
    const b = await trust(['--revoke', fx.dir], fx.env, root)
    expect(b.code).toBe(0)
    expect(b.text).toContain('already not trusted')
    expect((await trust(['--status', fx.dir], fx.env, root)).code).toBe(1)
  })

  test('(d) no terminal and no --yes refuses with status 400 and the fix line', async () => {
    const fx = fixture()
    const t = await trust([fx.dir], fx.env, root)
    expect(t.code).toBe(2)
    expect(t.errs).toContain(`run: ${trustCommand(slash(fx.dir), { yes: true })}`)
    expect((await trust(['--status', fx.dir], fx.env, root)).code).toBe(1)
  })

  test('status: NO COMMANDS, usage error, and the environment variable', async () => {
    const empty = fixture({})
    const e = await trust(['--status', empty.dir], empty.env, root)
    expect(e.code).toBe(0)
    expect(e.lines[0]).toMatch(/^NO COMMANDS/)
    expect((await trust(['--status', '--revoke'], empty.env, root)).code).toBe(2)
    const fx = fixture()
    const s = await trust(['--status', fx.dir], { ...fx.env, MEERKAT_TRUST_PROJECT: '1' }, root)
    expect(s.code).toBe(0)
    expect(s.text).toContain('trusted by environment variable MEERKAT_TRUST_PROJECT, not by a record')
  })

  test('(e) test, frontend and gate print the identical not-trusted line', async () => {
    const fx = fixture()
    const want = `not run: ${slash(fx.dir)} is not trusted yet. Run: ${trustCommand(slash(fx.dir))}`
    const errs1: string[] = []
    const c1 = runNamedCommand('test', ['--app', fx.dir], { env: fx.env, cwd: root, out: () => {}, err: (t: string) => errs1.push(t) })
    expect(c1).toBe(1)
    expect(errs1).toEqual([want])
    const errs2: string[] = []
    const c2 = await runFrontend(['--app', fx.dir], { env: fx.env, cwd: root, out: () => {}, err: (t: string) => errs2.push(t) })
    expect(c2).toBe(2)
    expect(errs2).toEqual([`NOT RUN (status 400): ${slash(fx.dir)} is not trusted yet, so its commands did not run. next: meerkat trust --app '${slash(fx.dir)}'`])
    expect(frontendGateLine(fx.env, fx.dir, fx.dir)).toBe(want)
  })

  test('the CLI process exits 2 for a bad flag and for the no-terminal refusal, with status 400 in the text', () => {
    const fx = fixture()
    const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
    const bad = spawnSync(process.execPath, [bin, 'trust', '--nope', fx.dir], { env: fx.env, encoding: 'utf8', stdin: 'ignore' } as any)
    expect(bad.status).toBe(2)
    const noTty = spawnSync(process.execPath, [bin, 'trust', fx.dir], { env: { ...fx.env, CI: '1' }, encoding: 'utf8', input: '' })
    expect(noTty.status).toBe(2)
    expect(noTty.stderr).toContain('status 400')
    expect(noTty.stderr).toContain('--yes')
  })

  test('the copy-paste fix line: a plain folder is quoted, an unsafe name gets no pasteable command', () => {
    expect(notTrustedLine({ dir: 'C:/x/a b' })).toBe("not run: C:/x/a b is not trusted yet. Run: meerkat trust 'C:/x/a b'")
    const bad = ["C:/x/a b'c$(x)", 'C:/x/a' + String.fromCharCode(0x2019) + 'b', 'C:/x/a`b', 'C:/x/a&b', 'C:/x/a|b', 'C:/x/a<b', 'C:/x/a>b', 'C:/x/a^b', 'C:/x/a%b', 'C:/x/a"b', 'C:/x/a!b', 'C:/x/a;b']
    for (const dir of bad) {
      const line = notTrustedLine({ dir })
      expect(line).toContain('copy this folder path and run meerkat trust on it yourself')
      expect(line.split(String.fromCharCode(10)).pop()).toBe(dir)
      expect(line).not.toMatch(/Run: meerkat trust/)
    }
  })
})
