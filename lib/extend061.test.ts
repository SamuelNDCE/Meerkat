import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { applyUpdate, defaultExec, runUpdateCommand, verifyInCopy } from './update.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { makeTrust } from './trust.mjs'

// Proves docs/extending.md: what a person adds (a check, a preset, a pack) lives outside Meerkat's own folder, so `meerkat update` does not touch it.
// The update runs through the real code (applyUpdate / runUpdateCommand in lib/update.mjs) against a LOCAL origin, so no network is used:
// every test name that updates says "local-origin". The release checksum lookup (the only other network use) is replaced by a stub.
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-ext061-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
const origin = join(root, 'origin')
let n = 0

// A tree snapshot (relative path -> file text) so "untouched" is a comparison and not a feeling.
function snapshot(dir: string, base = dir, out: Record<string, string> = {}) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) snapshot(p, base, out)
    else out[relative(base, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8')
  }
  return out
}

const WIP_SCAN = `import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const walk = (d) => readdirSync(d).flatMap((n) => (n === 'node_modules' || n.startsWith('.') ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const bad = walk(process.argv[2]).filter((f) => /\\.(js|ts|md)$/.test(f) && /WIP:/.test(readFileSync(f, 'utf8')))
if (bad.length) { console.log('WIP marker left in ' + bad[0]); process.exit(1) }
console.log('no WIP markers')
`
const WIP_CHECK = `export default [
  {
    id: 'no-wip-marker', group: 'functionality', tier: 'fast', lane: 'free', weight: 'tiny', title: 'No "WIP:" marker left in the code', estSeconds: 1,
    run: { cmd: 'node', args: ['.meerkat/checks/no-wip/scan.mjs', '{app}'], cwd: 'repo' },
    selfTest: { cmd: 'node', args: ['.meerkat/checks/no-wip/scan.mjs', '.meerkat/checks/no-wip/fixture'], cwd: 'repo', expectFail: true, expectMatch: 'WIP marker left in' },
  },
]
`
const packCheck = (id: string) => `import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export default [
  {
    id: '${id}', group: 'functionality', tier: 'fast', lane: 'free', weight: 'tiny', title: 'The project has an OWNERS file', estSeconds: 1,
    run: (ctx) => (existsSync(join(ctx.appDir, 'OWNERS')) ? { ok: true, detail: 'OWNERS found' } : { ok: false, detail: 'no OWNERS file at the project root' }),
    selfTest: () => (existsSync(join(mkdtempSync(join(tmpdir(), 'owners-')), 'OWNERS')) ? { ok: true, detail: 'unexpected' } : { ok: false, detail: 'no OWNERS file at the project root' }),
  },
]
`

interface World { home: string; logs: string; install: string; project: string }

// A fresh "installed Meerkat" (a clone of the local origin taken BEFORE the update commit), a fresh home with personal packs, and a project.
function world(configPacks: string[], extra: { extraChecks?: string[]; projectPack?: boolean } = {}): World {
  const dir = join(root, `w${n++}`)
  const home = join(dir, 'home')
  const logs = join(dir, 'logs')
  const install = join(dir, 'install')
  const project = join(dir, 'project')
  mkdirSync(logs, { recursive: true })
  git(dir, 'clone', '-q', origin, install)
  symlinkSync(join(REPO, 'node_modules'), join(install, 'node_modules'), 'junction')
  for (const pack of ['team', 'acme-crew', 'zz-shadow']) {
    mkdirSync(join(home, '.meerkat', 'packs', pack), { recursive: true })
    writeFileSync(join(home, '.meerkat', 'packs', pack, 'owners.mjs'), packCheck(`${pack}-owners`))
  }
  mkdirSync(join(project, '.meerkat', 'checks', 'no-wip', 'fixture'), { recursive: true })
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src', 'a.js'), 'console.log(1)\n')
  writeFileSync(join(project, '.meerkat', 'checks', 'no-wip', 'scan.mjs'), WIP_SCAN)
  writeFileSync(join(project, '.meerkat', 'checks', 'no-wip', 'fixture', 'bad.js'), '// WIP: remove before release\n')
  writeFileSync(join(project, '.meerkat', 'checks', 'no-wip.mjs'), WIP_CHECK)
  if (extra.projectPack) {
    mkdirSync(join(project, 'tools', 'checks'), { recursive: true })
    writeFileSync(join(project, 'tools', 'checks', 'owners.mjs'), packCheck('crew-owners'))
  }
  const config = { packs: configPacks, discover: false, ...(extra.extraChecks ? { extraChecks: extra.extraChecks } : {}), presets: { mine: { tier: 'fast', groups: ['functionality'], about: 'My own quick run' } } }
  writeFileSync(join(project, 'meerkat.config.json'), `${JSON.stringify(config, null, 2)}\n`)
  return { home, logs, install, project }
}

const env = (w: World, trust = false) => ({ ...process.env, HOME: w.home, USERPROFILE: w.home, MEERKAT_LOG_DIR: w.logs, MEERKAT_USER_CONFIG: join(w.home, '.meerkat.json'), CI: '1', NO_COLOR: '1', ...(trust ? { MEERKAT_TRUST_PROJECT: '1' } : { MEERKAT_TRUST_PROJECT: '' }) })
// The real CLI of the installed copy, run in a scratch project.
const cli = (w: World, args: string[], trust = false) => {
  const r = spawnSync(process.execPath, [join(w.install, 'run.mjs'), '--app', w.project, ...args, '--plain'], { encoding: 'utf8', env: env(w, trust), timeout: 90000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const exec = (c: string, a: string[], o: { cwd?: string } = {}) => defaultExec(c, a, o) // not defaultExec itself, so the heavy self-test copy is not started
const logDirOf = (w: World) => w.logs
const quickVerify = (a: any) => verifyInCopy({ ...a, steps: [{ name: '--help', args: ['bin/meerkat.mjs', '--help'], timeoutMs: 60000 }] })

beforeAll(() => {
  git(root, 'clone', '-q', '--local', REPO, origin) // the committed state of this checkout stands in for "Meerkat on GitHub"
  // The newer Meerkat: one lib file and one pack file changed in a harmless way, and a NEW bundled pack that happens to share a name with a personal one.
  appendFileSync(join(origin, 'lib', 'glob.mjs'), '\n// update marker\n')
  const packFile = readdirSync(join(origin, 'packs', 'hygiene')).find((f) => f.endsWith('.mjs'))!
  appendFileSync(join(origin, 'packs', 'hygiene', packFile), '\n// update marker\n')
  mkdirSync(join(origin, 'packs', 'zz-shadow'), { recursive: true })
  writeFileSync(join(origin, 'packs', 'zz-shadow', 'shadow.mjs'), packCheck('zz-shadow-bundled'))
  git(origin, 'add', 'lib/glob.mjs', `packs/hygiene/${packFile}`, 'packs/zz-shadow/shadow.mjs')
  git(origin, 'commit', '-q', '-m', 'newer meerkat')
}, 120000)

// The origin was cloned from the checkout, so "before the update" needs the installs to be at the commit BEFORE the marker commit.
function installBeforeUpdate(w: World) {
  git(w.install, 'reset', '-q', '--hard', 'HEAD~1')
}
const update = (w: World) => applyUpdate({ repoDir: w.install, exec, verify: quickVerify, logDir: logDirOf(w), now: Date.UTC(2026, 10, 8) }) as Record<string, any>
const fetchOrigin = (w: World) => git(w.install, 'fetch', '-q', 'origin')

describe('extending Meerkat and updating it (docs/extending.md)', () => {
  test('local-origin update: a custom check, a personal pack and a custom preset still run, and the project and home are byte for byte unchanged', () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    const before = cli(w, ['--preset', 'mine'], true)
    expect(before.out).toMatch(/\[PASS {3}\] no-wip-marker/)
    expect(before.out).toMatch(/\[FAIL {3}\] team-owners/) // the project has no OWNERS file: a real, expected failure
    expect(before.out).toContain('2 of them your own')
    const projectBefore = snapshot(w.project)
    const homeBefore = snapshot(w.home)
    fetchOrigin(w)
    const r = update(w)
    expect(r).toMatchObject({ ok: true })
    expect(readFileSync(join(w.install, 'lib', 'glob.mjs'), 'utf8')).toContain('// update marker') // Meerkat's own code really was replaced
    expect(snapshot(w.project)).toEqual(projectBefore)
    expect(snapshot(w.home)).toEqual(homeBefore)
    const after = cli(w, ['--preset', 'mine'], true)
    expect(after.out).toMatch(/\[PASS {3}\] no-wip-marker/)
    expect(after.out).toMatch(/\[FAIL {3}\] team-owners/)
    expect(after.out).toContain('2 of them your own')
  }, 180000)

  test('local-origin update: a custom check proves itself with --self-test before and after the update', () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    const run = () => cli(w, ['--self-test', '--only', 'no-wip-marker,team-owners'], true).out
    expect(run()).toMatch(/2 passed, 0 failed/)
    fetchOrigin(w)
    expect(update(w)).toMatchObject({ ok: true })
    expect(run()).toMatch(/2 passed, 0 failed/)
  }, 180000)

  test('local-origin update: trust given to the project before the update is still honoured after it (no prompt, code still runs)', async () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    const e = { MEERKAT_LOG_DIR: w.logs }
    const ask = makeTrust(e, { interactive: true, ask: async () => 'y', say: () => {} })
    expect(await ask({ projectDir: w.project, where: w.project, extraChecks: [] })).toMatchObject({ trusted: true })
    expect(cli(w, ['--preset', 'mine']).out).toMatch(/\[PASS {3}\] no-wip-marker/) // no MEERKAT_TRUST_PROJECT: the saved trust is what lets it run
    fetchOrigin(w)
    expect(update(w)).toMatchObject({ ok: true })
    const after = cli(w, ['--preset', 'mine'])
    expect(after.out).toMatch(/\[PASS {3}\] no-wip-marker/)
    expect(after.out).not.toContain('have not been trusted yet')
  }, 180000)

  test('local-origin update: a user who edited the same lines of a Meerkat file gets the documented refusal and a saved patch, never a silent loss', () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    appendFileSync(join(w.install, 'lib', 'glob.mjs'), '\n// my local edit\n')
    fetchOrigin(w)
    let said = ''
    const stdout = { write: (t: string) => { said += t; return true }, isTTY: false }
    const stdin = { isTTY: false }
    process.env.MEERKAT_LOG_DIR = w.logs // lib/update.mjs puts saved patches under the log folder
    const code = runUpdateCommandSync(w, { action: 'apply', yes: true }, stdout, stdin)
    return code.then((c: number) => {
      expect(c).toBe(1)
      expect(said).toContain('Not updated: you have changes that cannot be combined automatically with this update (the same lines changed on both sides), so it was not updated:')
      expect(said).toContain('  lib/glob.mjs')
      expect(said).toContain('Your changes are saved in:')
      expect(readFileSync(join(w.install, 'lib', 'glob.mjs'), 'utf8')).toContain('// my local edit') // the edit is still there
      expect(readFileSync(join(w.install, 'lib', 'glob.mjs'), 'utf8')).not.toContain('// update marker')
      const patchDir = join(logDirOf(w), 'update-patches')
      const patches = readdirSync(patchDir)
      expect(patches.length).toBe(1)
      expect(readFileSync(join(patchDir, patches[0]), 'utf8')).toContain('+// my local edit')
    })
  }, 180000)

  test('local-origin update: an edit to a Meerkat file the update does not change is kept, a patch is saved, and the custom check still runs', () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    appendFileSync(join(w.install, 'lib', 'eta.mjs'), '\n// my local edit\n')
    fetchOrigin(w)
    const r = update(w)
    expect(r).toMatchObject({ ok: true, kept: 1 })
    expect(existsSync(r.patch)).toBe(true)
    expect(readFileSync(join(w.install, 'lib', 'eta.mjs'), 'utf8')).toContain('// my local edit')
    expect(readFileSync(join(w.install, 'lib', 'glob.mjs'), 'utf8')).toContain('// update marker')
    expect(cli(w, ['--preset', 'mine'], true).out).toMatch(/\[PASS {3}\] no-wip-marker/)
  }, 180000)

  test('local-origin update: a heavily modified install (commits of its own on a branch) keeps those commits and every extension keeps working', () => {
    const w = world(['team'])
    installBeforeUpdate(w)
    git(w.install, 'checkout', '-q', '-b', 'my-fork')
    appendFileSync(join(w.install, 'lib', 'eta.mjs'), '\n// fork change\n')
    git(w.install, 'commit', '-q', '-am', 'my fork change')
    const forkHead = git(w.install, 'rev-parse', 'HEAD').trim()
    fetchOrigin(w)
    const r = update(w)
    expect(r.ok).toBe(true)
    expect(r.switchedFrom).toBe('my-fork')
    expect(git(w.install, 'rev-parse', 'my-fork').trim()).toBe(forkHead) // the fork's commit is still on its branch
    expect(cli(w, ['--preset', 'mine'], true).out).toMatch(/\[PASS {3}\] no-wip-marker/)
  }, 180000)

  test('local-origin update: a pack the user renamed (personal pack acme-crew, and a pack folder inside the project) keeps working because the update never touches home or project', () => {
    const w = world(['acme-crew'], { extraChecks: ['tools/checks'], projectPack: true })
    installBeforeUpdate(w)
    const ids = (out: string) => out.split('\n').filter((l) => /^(acme-crew-owners|crew-owners|no-wip-marker)\b/.test(l)).map((l) => l.split(/\s+/)[0]).sort()
    const list = () => cli(w, ['--list'], true).out
    expect(ids(list())).toEqual(['acme-crew-owners', 'crew-owners', 'no-wip-marker'])
    const projectBefore = snapshot(w.project)
    const homeBefore = snapshot(w.home)
    fetchOrigin(w)
    expect(update(w)).toMatchObject({ ok: true })
    expect(ids(list())).toEqual(['acme-crew-owners', 'crew-owners', 'no-wip-marker'])
    expect(snapshot(w.project)).toEqual(projectBefore)
    expect(snapshot(w.home)).toEqual(homeBefore)
  }, 180000)

  test('local-origin update: GAP FIXED, a new bundled pack with the name of a personal pack is announced in a config note and not dropped silently', () => {
    const w = world(['zz-shadow'])
    installBeforeUpdate(w)
    const before = cli(w, ['--preset', 'mine'], true).out
    expect(before).toMatch(/\[FAIL {3}\] zz-shadow-owners/)
    expect(before).not.toContain('is ignored')
    fetchOrigin(w)
    expect(update(w)).toMatchObject({ ok: true })
    const after = cli(w, ['--preset', 'mine'], true).out
    expect(after).toMatch(/\[FAIL {3}\] zz-shadow-bundled/)
    expect(after).not.toContain('zz-shadow-owners')
    expect(after).toContain('pack "zz-shadow": a bundled pack with this name is used; your pack at')
    expect(after).toContain('is ignored. Rename your pack folder')
  }, 180000)

  test('without trust a project check is left out loudly, and the message is the one docs/extending.md quotes', () => {
    const w = world(['team'])
    const out = cli(w, ['--preset', 'mine']).out
    expect(out).toContain("this project's own check code was NOT run: 1 file(s) (extraChecks or .meerkat/checks) have not been trusted yet, and without a terminal Meerkat will not ask.")
    expect(out).not.toMatch(/no-wip-marker/)
  }, 60000)
})

// runUpdateCommand with the pieces a test must replace: the exec that does not start the heavy self-test copy, the stubbed checksum lookup, and the scratch home.
function runUpdateCommandSync(w: World, plan: Record<string, unknown>, stdout: any, stdin: any) {
  return runUpdateCommand(plan, { repoDir: w.install, exec, releaseCheck: async () => ({ ok: true }), env: env(w), stdin, stdout, home: w.home }) as Promise<number>
}
