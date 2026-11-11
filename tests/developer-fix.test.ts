// The three developer-flow problems a tester found: the scaffolded pack name must enable, and results are the first stdout line.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })))

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}

function world() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-devfix-')))
  tmps.push(base)
  const app = join(base, 'app')
  mkdirSync(app)
  git(app, 'init', '-q')
  writeFileSync(join(app, 'a.js'), 'console.log(1)\n')
  git(app, 'add', 'a.js')
  git(app, 'commit', '-qm', 'init')
  const env = { ...process.env, MEERKAT_USER_CONFIG: join(base, 'user.json'), MEERKAT_LOG_DIR: join(base, 'logs'), MEERKAT_TRUST_PROJECT: '1', NO_COLOR: '1', MEERKAT_PRIORITY: 'low' }
  const mk = (...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: app, env, encoding: 'utf8', timeout: 150000 })
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
  }
  return { base, app, mk }
}

describe('developer flow: scaffold, add, enable', () => {
  let w: ReturnType<typeof world>
  let packDir: string
  beforeAll(() => {
    w = world()
    packDir = join(w.base, 'my-packs', 'devadd-pack')
    mkdirSync(packDir, { recursive: true })
  })

  test('pack add of the pack folder itself, then enable with the printed name: exit 0', () => {
    const made = w.mk('new', 'check', 'demo-banned', '--pack', packDir)
    expect(made.code).toBe(0)
    const printed = /meerkat pack enable (\S+)/.exec(made.out)?.[1]
    expect(printed).toBe('devadd-pack')
    expect(existsSync(join(packDir, 'pack.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8')).pack).toBe(printed)
    const added = w.mk('pack', 'add', packDir)
    expect(added.code).toBe(0)
    const on = w.mk('pack', 'enable', printed as string)
    expect(on.err + on.out).not.toMatch(/No pack called/)
    expect(on.code).toBe(0)
  })

  test('pack add of the parent folder, as the scaffold prints, also works', () => {
    const w2 = world()
    const dir = join(w2.base, 'mine', 'other-pack')
    mkdirSync(dir, { recursive: true })
    expect(w2.mk('new', 'check', 'demo-banned', '--pack', dir).code).toBe(0)
    expect(w2.mk('pack', 'add', join(w2.base, 'mine')).code).toBe(0)
    expect(w2.mk('pack', 'enable', 'other-pack').code).toBe(0)
  })

  test('self-test --only prints its result on the first stdout line, the priority note is not on stdout', () => {
    const r = w.mk('self-test', '--only', 'demo-banned')
    expect(r.code).toBe(0)
    const first = r.out.split(/\r?\n/)[0]
    expect(first).toMatch(/^PASS \(status 200\): demo-banned/)
    expect(r.out).not.toMatch(/priority below normal/)
  })

  test('check try prints its reason on the first stdout line whenever it does not pass', () => {
    const ok = w.mk('check', 'try', 'demo-banned')
    expect(ok.out.split(/\r?\n/)[0]).toMatch(/^PASS \(status 200\): demo-banned/)
    const none = w.mk('check', 'try', 'no-such-check')
    expect(none.code).toBe(3)
    const first = none.out.split(/\r?\n/)[0]
    expect(first).toMatch(/^NO-RESULT \(status 404\): no-such-check is not a check Meerkat has loaded/)
    expect(first).toMatch(/next:/)
    const st = w.mk('self-test', '--only', 'no-such-check')
    expect(st.out.split(/\r?\n/)[0]).toMatch(/^NO-RESULT \(status 404\)/)
  })
})
