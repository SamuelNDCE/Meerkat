// Fixes for what the Plume project reported: fuse messages, staged-empty, unrecorded logs, findings --check names, .catch as handled,
// doctor and gate first lines, fuses set in a build hook, and the fuse state read from the built binary.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { gateMain } from '../lib/gate.mjs'
import { findingsCommand } from '../lib/findingscmd.mjs'
import { doctorText } from '../lib/doctor.mjs'
import { fuseBinaryCheck } from '../thorough/electron-fuse-binary.mjs'
import { runCheck } from './fp057-run'

const root = mkdtempSync(join(tmpdir(), 'meerkat-plume-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const repo = (name: string, files: Record<string, string> = { 'src/a.js': 'export const a = 1\n' }) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, f)), { recursive: true })
    writeFileSync(join(d, f), body)
  }
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'clean')
  return d
}
const gate = async (argv: string[], cwd: string, logs: string, extra: any = {}) => {
  const out: string[] = []
  const errs: string[] = []
  const code = await gateMain(argv, { cwd, log: (l: string) => out.push(l), err: (l: string) => errs.push(l), env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs }, ...extra })
  return { code, out, errs }
}
const electronPkg = (build: object) => JSON.stringify({ name: 'a', devDependencies: { electron: '41.0.0', 'electron-builder': '26.0.12' }, build: { appId: 'x', productName: 'A', copyright: 'c', ...build } })
const ep = (files: Record<string, string>) => {
  const d = mkdtempSync(join(root, 'ep-'))
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, f)), { recursive: true })
    writeFileSync(join(d, f), body)
  }
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'add', '-A')
  return d
}
const runEp = (d: string, id = 'ep-fuses-build') => {
  const r = spawnSync(process.execPath, ['thorough/electron-plus.mjs', id, '--root', d], { encoding: 'utf8', cwd: join(__dirname, '..') })
  return String(r.stdout)
}

describe('1. ep-fuses-build names the missing keys', () => {
  test('a package.json with only the three keys set is quiet about them and names the rest', () => {
    const d = ep({ 'package.json': electronPkg({ electronFuses: { onlyLoadAppFromAsar: true, enableCookieEncryption: true, enableEmbeddedAsarIntegrityValidation: true } }) })
    const out = runEp(d)
    expect(out).toMatch(/PASS ep-fuse-only-asar-unset/)
    expect(out).toMatch(/PASS ep-fuse-cookie-encryption-unset/)
    expect(out).toMatch(/PASS ep-fuse-asar-integrity-unset/)
    expect(out).toMatch(/MEERKAT-FINDING medium ep-fuse-run-as-node-unset package\.json:\d+ .*missing key: runAsNode\. Set it in build\.electronFuses.*afterPack/)
  })
  test('a package.json with no fuses names every key and the fix', () => {
    const d = ep({ 'package.json': electronPkg({}) })
    const out = runEp(d)
    expect(out).toMatch(/MEERKAT-FINDING info ep-fuses-not-configured .*no keys are set.*embeddedAsarIntegrityValidation.*onlyLoadAppFromAsar.*enableCookieEncryption.*afterPack/)
  })
})

describe('2. staged-empty is no result', () => {
  test('nothing staged: exit 3, status 204, the reason is the first line', async () => {
    const d = repo('staged')
    const r = await gate(['--staged'], d, join(root, 'logs-staged'))
    expect(r.code).toBe(3)
    expect(r.out[0]).toBe('NO-RESULT (status 204): nothing is staged, so the gate judged no files. next: git add the files, or run meerkat gate without --staged')
  })
})

describe('3. an unrecorded run says so first', () => {
  test('a log folder that is not writable: the first line says NOT RECORDED, the exit code follows the judgement', async () => {
    const d = repo('unrec')
    writeFileSync(join(d, 'src/a.js'), 'export const a = 2\n')
    const blocker = join(root, 'not-a-folder')
    writeFileSync(blocker, 'a file where the log folder should be')
    chmodSync(blocker, 0o444)
    const r = await gate([], d, join(blocker, 'logs'))
    expect(r.out[0]).toMatch(/^NOT RECORDED: this gate run was not saved, because the log folder .* is not writable, so meerkat last and findings will not show it/)
    expect([0, 1, 3]).toContain(r.code)
    chmodSync(blocker, 0o644)
  })
})

describe('4. findings --check takes the name the gate summary prints', () => {
  test('empty-catch in the FAIL summary is listed by findings --check empty-catch', async () => {
    const d = repo('fc')
    writeFileSync(join(d, 'src/a.js'), 'export function f() {\n  try { x() } catch (e) {}\n}\n')
    const logs = join(root, 'logs-fc')
    const g = await gate([], d, logs)
    expect(g.out.join('\n')).toMatch(/FAIL\s+empty-catch/)
    const out: string[] = []
    await findingsCommand({ noun: 'findings', flags: { check: 'empty-catch', app: d } }, { out: (l: string) => out.push(l), err: () => {}, cwd: d, env: { ...process.env, MEERKAT_LOG_DIR: logs } })
    expect(out.join('\n')).toMatch(/empty-catch\s+src\/a\.js:2/)
  })
})

describe('5. a .catch or a rejection handler counts as handled', () => {
  const code = (body: string) => `async function x() {\n  await y()\n}\nexport function go() {\n${body}\n}\n`
  for (const id of ['js-missing-await', 'js-unhandled-promise']) {
    test(`${id}: .catch(...) and .then(a, b) are quiet, a bare call is flagged`, () => {
      expect(runCheck('thorough/lang.mjs', id, { 'a.js': code('  x().catch((e) => log(e))') }).code).toBe(0)
      expect(runCheck('thorough/lang.mjs', id, { 'a.js': code('  x().then((a) => use(a), (b) => log(b))') }).code).toBe(0)
      expect(runCheck('thorough/lang.mjs', id, { 'a.js': code('  x()') }).code).toBe(1)
    })
  }
})

describe('a. doctor first line names the failing step', () => {
  test('a missing tool is named on line 1, then the folder', () => {
    const t = doctorText({ ideas: 0, folder: '/proj', configFile: null, quickChecks: 3, wouldRun: 2, notRun: [{ id: 'eslint', tools: ['eslint'], fix: 'npm i -D eslint' }], fallbacks: [], missingLine: null, packsOff: [], suggested: [], next: [], notes: [] })
    expect(t.split('\n')[0]).toBe('Meerkat doctor: NOT RUN eslint, it needs eslint. Folder: /proj')
  })
})

describe('b. one status and exit form on the counts line', () => {
  test('a finding: counts first, then (status 422, exit 1)', async () => {
    const d = repo('b')
    writeFileSync(join(d, 'src/a.js'), 'export const a = 1\neval(process.argv[2])\n')
    const r = await gate([], d, join(root, 'logs-b'))
    expect(r.code).toBe(1)
    const first = r.out[0].split('\n')[0]
    expect(first).toMatch(/^MEERKAT gate: \d+ blocking, .*scanned .*\(status 422, exit 1\)$/)
    expect(first).not.toMatch(/, exit 1,/)
  })
})

describe('c. gate --staged with nothing staged: the reason leads', () => {
  test('first stdout line is the reason, the folder line follows', async () => {
    const d = repo('c')
    const r = await gate(['--staged'], d, join(root, 'logs-c'), { banner: true })
    expect(r.code).toBe(3)
    expect(r.out[0]).toMatch(/^NO-RESULT \(status 204\): nothing is staged/)
    expect(r.out[1]).toMatch(/^folder: /)
  })
})

describe('d. fuses set in a build hook, and read from the built binary', () => {
  // The reader runs the project's own @electron/fuses, so these tests run as a trusted project (MEERKAT_TRUST_PROJECT=1); the trust tests below cover the untrusted case.
  const TRUST = { MEERKAT_TRUST_PROJECT: '1' }
  const pkg = electronPkg({ electronFuses: { runAsNode: false } })
  test('a hook that sets grantFileProtocolExtraPrivileges with @electron/fuses is accepted', () => {
    const hook = "const { flipFuses, FuseV1Options } = require('@electron/fuses')\nexports.default = (c) => flipFuses(c.appOutDir, { [FuseV1Options.GrantFileProtocolExtraPrivileges]: false })\n"
    expect(runEp(ep({ 'package.json': pkg, 'build/fuses-afterpack.cjs': hook }))).toMatch(/PASS ep-fuse-file-protocol-unset/)
  })
  test('with neither the package.json nor a hook setting it, the finding stays', () => {
    expect(runEp(ep({ 'package.json': pkg }))).toMatch(/FAIL ep-fuse-file-protocol-unset/)
  })
  const stub = "const N = { RunAsNode: 0, EnableCookieEncryption: 1, EnableNodeOptionsEnvironmentVariable: 2, EnableNodeCliInspectArguments: 3, EnableEmbeddedAsarIntegrityValidation: 4, OnlyLoadAppFromAsar: 5, GrantFileProtocolExtraPrivileges: 7 }\nexports.FuseV1Options = N\nexports.getCurrentFuseWire = async (bin) => JSON.parse(require('fs').readFileSync(bin, 'utf8'))\n"
  const withBinary = (wire: object | null, withTool = true) => {
    const files: Record<string, string> = { 'package.json': pkg }
    if (wire) files['release/win-unpacked/Plume.exe'] = JSON.stringify(Object.fromEntries(Object.entries(wire).map(([k, v]) => [k, 48 + v])))
    if (withTool) files['node_modules/@electron/fuses/index.js'] = stub
    if (withTool) files['node_modules/@electron/fuses/package.json'] = '{"name":"@electron/fuses","main":"index.js"}'
    const d = mkdtempSync(join(root, 'bin-'))
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(d, f)), { recursive: true })
      writeFileSync(join(d, f), body)
    }
    return d
  }
  test('no built binary is NOT RUN (75), never a pass', () => {
    const r = fuseBinaryCheck(withBinary(null), TRUST)
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^NOT RUN: no built Electron app was found.*Run the build first/)
  })
  test('a binary path that does not exist is NOT RUN', () => {
    expect(fuseBinaryCheck(withBinary(null), { MEERKAT_ELECTRON_BINARY: 'release/nope.exe' }).code).toBe(75)
  })
  test('@electron/fuses missing from the project is NOT RUN (tool missing)', () => {
    const r = fuseBinaryCheck(withBinary({ 0: 0 }, false), TRUST)
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/tool missing/)
  })
  test('a key that is on in the binary is a finding that reports each fuse state', () => {
    const r = fuseBinaryCheck(withBinary({ 0: 0, 1: 1, 2: 0, 3: 0, 4: 1, 5: 1, 7: 1 }), TRUST)
    expect(r.code).toBe(1)
    const text = r.lines.join('\n')
    expect(text).toMatch(/GrantFileProtocolExtraPrivileges: on \(secure value: off\)/)
    expect(text).toMatch(/RunAsNode: off\n/)
    expect(text).toMatch(/MEERKAT-FINDING medium ep-fuse-binary-grant-file-protocol-extra-privileges .*:0 GrantFileProtocolExtraPrivileges is on/)
  })
  test('every fuse secure is a pass', () => {
    expect(fuseBinaryCheck(withBinary({ 0: 0, 1: 1, 2: 0, 3: 0, 4: 1, 5: 1, 7: 0 }), TRUST).code).toBe(0)
  })
  test('an untrusted folder is NOT RUN and never runs the project tool', () => {
    const r = fuseBinaryCheck(withBinary({ 0: 0, 1: 1, 2: 0, 3: 0, 4: 1, 5: 1, 7: 0 }), {})
    expect(r.code).toBe(75)
    expect(r.lines[0]).toMatch(/^NOT RUN: reading the binary runs @electron\/fuses .* not trusted/)
  })
  test('MEERKAT_NO_PROJECT_CODE keeps the reader from running even when trusted', () => {
    const r = fuseBinaryCheck(withBinary({ 0: 0, 1: 1, 2: 0, 3: 0, 4: 1, 5: 1, 7: 0 }), { MEERKAT_TRUST_PROJECT: '1', MEERKAT_NO_PROJECT_CODE: '1' })
    expect(r.code).toBe(75)
  })
})
