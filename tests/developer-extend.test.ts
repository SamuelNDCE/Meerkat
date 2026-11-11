// meerkat new check / new pack (lib/newcmd.mjs) and docs/add-a-check.md, against throwaway projects.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { checkSource, fixtureSource, scannerSource } from '../lib/newcmd.mjs'
// @ts-expect-error plain JS module
import { loadChecks, validateCheck } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { knownCommands } from '../lib/cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-devext-')))
  tmps.push(d)
  return d
}
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })))

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

// A project plus an isolated home: the user config and the log folder live in the temp folder, never in the real home.
function world() {
  const base = tmp()
  const app = join(base, 'app')
  mkdirSync(app)
  git(app, 'init', '-q')
  writeFileSync(join(app, 'README.md'), 'hello\n')
  const userCfg = join(base, 'user.json')
  const env = { ...process.env, MEERKAT_USER_CONFIG: userCfg, MEERKAT_LOG_DIR: join(base, 'logs'), MEERKAT_TRUST_PROJECT: '1', NO_COLOR: '1' }
  const mk = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 150000 })
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
  }
  return { base, app, mk, userCfg }
}

describe('meerkat new check', () => {
  let w: ReturnType<typeof world>
  beforeAll(() => {
    w = world()
  })

  test('writes the check, a scanner and a broken fixture into a pack folder, and its self-test passes through the runner', () => {
    const packs = join(w.base, 'packs')
    const pack = join(packs, 'mypack')
    const r = w.mk(w.app, 'new', 'check', 'demo-banned', '--pack', pack)
    expect(r.code).toBe(0)
    expect(existsSync(join(pack, 'demo-banned.mjs'))).toBe(true)
    expect(existsSync(join(pack, 'demo-banned', 'scan.mjs'))).toBe(true)
    expect(readFileSync(join(pack, 'demo-banned', 'fixture', 'bad.js'), 'utf8')).toContain('legacyCall(')
    // it names the commands to run next
    expect(r.out).toContain('meerkat self-test --only demo-banned')
    expect(r.out).toContain('meerkat pack enable mypack')
    // load it the way a person would, then run its own self-test through the check runner
    expect(w.mk(w.app, 'pack', 'add', packs).code).toBe(0)
    expect(w.mk(w.app, 'pack', 'enable', 'mypack').code).toBe(0)
    const st = w.mk(w.app, 'self-test', '--only', 'demo-banned')
    expect(st.out).toMatch(/PASS\s+demo-banned/)
    expect(st.out).toContain('self-test: correctly failed')
    expect(st.code).toBe(0)
  })

  test('without --pack it writes into .meerkat/checks of the project and the self-test passes', () => {
    const x = world()
    const r = x.mk(x.app, 'new', 'check', 'no-old', '--ban', 'oldThing')
    expect(r.code).toBe(0)
    expect(existsSync(join(x.app, '.meerkat', 'checks', 'no-old.mjs'))).toBe(true)
    const st = x.mk(x.app, 'self-test', '--only', 'no-old')
    expect(st.out).toMatch(/PASS\s+no-old/)
    expect(st.code).toBe(0)
  })

  test('an id that already exists is refused: exit 2, one line, status 400, nothing overwritten', () => {
    const pack = join(w.base, 'packs', 'mypack')
    const file = join(pack, 'demo-banned.mjs')
    writeFileSync(file, `${readFileSync(file, 'utf8')}// edited by hand\n`)
    const before = readFileSync(file, 'utf8')
    const r = w.mk(w.app, 'new', 'check', 'demo-banned', '--pack', pack)
    expect(r.code).toBe(2)
    expect(r.out.trim().split('\n')).toHaveLength(1)
    expect(r.out).toMatch(/^USAGE \(status 400\): .*already exists, so nothing was written/)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  test('a bad id, a missing id and an unknown option are usage errors (exit 2)', () => {
    expect(w.mk(w.app, 'new', 'check', 'Bad_Id').code).toBe(2)
    expect(w.mk(w.app, 'new', 'check').code).toBe(2)
    expect(w.mk(w.app, 'new', 'check', 'fine-id', '--bogus').code).toBe(2)
    expect(w.mk(w.app, 'new', 'check', 'fine-id', '--ban', 'not a name').code).toBe(2)
    expect(w.mk(w.app, 'new', 'widget').code).toBe(2)
  })

  test('a pack that ships with Meerkat is not written into', () => {
    const r = w.mk(w.app, 'new', 'check', 'x-thing', '--pack', 'hygiene')
    expect(r.code).toBe(2)
    expect(r.out).toContain('ships with Meerkat')
  })
})

describe('meerkat new pack', () => {
  test('creates a loadable pack whose example check shows up in the check list and in the gate', () => {
    const w = world()
    const parent = join(w.base, 'my-packs')
    const r = w.mk(w.app, 'new', 'pack', 'team', '--dir', parent)
    expect(r.code).toBe(0)
    const dir = join(parent, 'team')
    expect(JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')).pack).toBe('team')
    expect(r.out).toContain(dir)
    expect(r.out).toContain(`meerkat pack add ${parent}`)
    expect(r.out).toContain('meerkat pack enable team')
    const id = 'team-no-legacycall'
    expect(existsSync(join(dir, `${id}.mjs`))).toBe(true)
    // load it
    expect(w.mk(w.app, 'pack', 'add', parent).code).toBe(0)
    expect(w.mk(w.app, 'pack', 'enable', 'team').code).toBe(0)
    const list = w.mk(w.app, 'check', 'list', '--json')
    expect(list.code).toBe(0)
    expect(list.out).toContain(id)
    // the gate: a branch that adds a call to the banned function fails on the pack's check
    git(w.app, 'add', '-A')
    git(w.app, 'commit', '-qm', 'base')
    writeFileSync(join(w.app, 'a.js'), "legacyCall('x')\n")
    git(w.app, 'add', 'a.js')
    git(w.app, 'commit', '-qm', 'adds a banned call')
    const gate = w.mk(w.app, 'gate', '--base', 'HEAD~1')
    expect(gate.code).toBe(1)
    expect(gate.out).toMatch(new RegExp(`FAIL\\s+${id}`))
    // and the pack's own self-test passes
    expect(w.mk(w.app, 'self-test', '--only', id).code).toBe(0)
  }, 180000)

  test('refuses an existing folder and a name that ships with Meerkat (exit 2)', () => {
    const w = world()
    const parent = join(w.base, 'p')
    expect(w.mk(w.app, 'new', 'pack', 'mine', '--dir', parent).code).toBe(0)
    const again = w.mk(w.app, 'new', 'pack', 'mine', '--dir', parent)
    expect(again.code).toBe(2)
    expect(again.out).toMatch(/^USAGE \(status 400\): .*already exists/)
    const shipped = w.mk(w.app, 'new', 'pack', 'hygiene', '--dir', parent)
    expect(shipped.code).toBe(2)
    expect(shipped.out).toContain('ships with Meerkat')
    expect(existsSync(join(parent, 'hygiene'))).toBe(false)
  })
})

describe('docs/add-a-check.md', () => {
  const guide = readFileSync(join(ROOT, 'docs', 'add-a-check.md'), 'utf8').replace(/\r\n/g, '\n')
  const blockAfter = (marker: string) => {
    const i = guide.indexOf(marker)
    expect(i).toBeGreaterThan(-1)
    const start = guide.indexOf('```js\n', i) + '```js\n'.length
    return guide.slice(start, guide.indexOf('```', start))
  }

  test("the guide's example is exactly what meerkat new check writes", () => {
    expect(blockAfter('`.meerkat/checks/no-legacy-call.mjs`:')).toBe(checkSource('no-legacy-call', 'legacyCall'))
    expect(blockAfter('## 4. The rule')).toBe(scannerSource())
    expect(blockAfter('is one deliberately broken file:')).toBe(fixtureSource('legacyCall'))
  })

  test("the guide's check, copied into a check file, is accepted by the loader and passes its own self-test", async () => {
    const w = world()
    const dir = join(w.app, '.meerkat', 'checks')
    mkdirSync(join(dir, 'no-legacy-call', 'fixture'), { recursive: true })
    writeFileSync(join(dir, 'no-legacy-call.mjs'), blockAfter('`.meerkat/checks/no-legacy-call.mjs`:'))
    writeFileSync(join(dir, 'no-legacy-call', 'scan.mjs'), blockAfter('## 4. The rule'))
    writeFileSync(join(dir, 'no-legacy-call', 'fixture', 'bad.js'), blockAfter('is one deliberately broken file:'))
    const loaded = await loadChecks(dir)
    expect(loaded.map((c: { id: string }) => c.id)).toEqual(['no-legacy-call'])
    expect(validateCheck(loaded[0])).toBeNull()
    expect(loaded[0].selfTest.expectMatch).toBeTruthy()
    const st = w.mk(w.app, 'self-test', '--only', 'no-legacy-call')
    expect(st.out).toMatch(/PASS\s+no-legacy-call/)
    expect(pathToFileURL(dir).href).toBeTruthy()
  })

  test('every meerkat command in a code block of the guide is a real command', () => {
    const known = new Set(knownCommands())
    // lines inside plain ``` fences (the ```js blocks are code, not commands)
    const lines: string[] = []
    let fence: string | null = null
    for (const l of guide.split('\n')) {
      if (l.startsWith('```')) fence = fence === null ? l.slice(3) : null
      else if (fence === '' && l.startsWith('meerkat ')) lines.push(l)
    }
    expect(lines.length).toBeGreaterThan(6)
    for (const l of lines) expect(known.has(l.split(/\s+/)[1]), l).toBe(true)
  })

  test('no em dashes', () => {
    expect(guide).not.toContain('—')
  })
})
