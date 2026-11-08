// The release scripts in tools/release/: changelog gate, pack file-list gate, fix-needs-a-test gate, audit judging, the tarball install test and the
// upgrade test. The two smoke tests run against tiny fake packages built in a temp folder, so no network and no real Meerkat scan is needed.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { checkChangelog } from '../tools/release/changelog-check.mjs'
// @ts-expect-error plain JS module
import { run } from '../tools/release/common.mjs'
// @ts-expect-error plain JS module
import { fixesWithoutTests, parseLog } from '../tools/release/fix-tests.mjs'
// @ts-expect-error plain JS module
import { judgeAudit } from '../tools/release/gate.mjs'
// @ts-expect-error plain JS module
import { checkPackList, packPaths } from '../tools/release/pack-list.mjs'
// @ts-expect-error plain JS module
import { tarballSmoke } from '../tools/release/tarball-smoke.mjs'
// @ts-expect-error plain JS module
import { snapshotState, stateDiff, upgradeSmoke } from '../tools/release/upgrade-smoke.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'release-tools-test-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const GOOD_LOG = '# Changelog\n\n## Unreleased\n\n- a\n\n## 1.2.0 (2026-11-06)\n\n- b\n\n## 1.1.0 - 2026-10-01\n\n- c\n'

describe('changelog check', () => {
  test('a good changelog passes', () => {
    expect(checkChangelog(GOOD_LOG, '1.2.0').problems).toEqual([])
  })
  test('a missing Unreleased section fails', () => {
    expect(checkChangelog('## 1.2.0 (2026-11-06)\n', '1.2.0').problems.join()).toMatch(/Unreleased/)
  })
  test('a version heading without a date, or with an impossible date, fails', () => {
    expect(checkChangelog('## Unreleased\n\n## 1.2.0\n', '1.2.0').problems.join()).toMatch(/no real date/)
    expect(checkChangelog('## Unreleased\n\n## 1.2.0 (2026-13-45)\n', '1.2.0').problems.join()).toMatch(/no real date/)
  })
  test('the newest version heading must equal package.json', () => {
    expect(checkChangelog(GOOD_LOG, '1.3.0').problems.join()).toMatch(/newest version heading is 1\.2\.0 but package\.json says 1\.3\.0/)
  })
  test('a changelog with no version heading fails', () => {
    expect(checkChangelog('## Unreleased\n\n- a\n', '1.0.0').problems.join()).toMatch(/no version heading/)
  })
  test('a second Unreleased heading is a warning, not a failure', () => {
    const r = checkChangelog(`${GOOD_LOG}\n## Unreleased\n`, '1.2.0')
    expect(r.problems).toEqual([])
    expect(r.warnings.join()).toMatch(/2 "## Unreleased"/)
  })
  test("this repository's own changelog passes", () => {
    const r = run(process.execPath, [join(repo, 'tools', 'release', 'changelog-check.mjs')])
    expect(r.code, r.stdout).toBe(0)
  })
})

describe('pack file-list gate', () => {
  const ok = ['package.json', 'README.md', 'LICENSE', 'bin/meerkat.mjs', 'lib/a.mjs', 'fixtures/x/planted.js', 'examples/app/fixtures/y.txt', '.env.example']
  test('the expected files pass', () => {
    // .env.example sits at the top level, which is outside the expected files: it must fail on that rule, so drop it from the pass list
    expect(checkPackList(ok.filter((p) => p !== '.env.example'))).toEqual([])
  })
  test('an .env file fails', () => {
    expect(checkPackList(['package.json', 'lib/.env']).join()).toMatch(/secret-looking/)
    expect(checkPackList(['package.json', 'lib/.env.production']).join()).toMatch(/secret-looking/)
  })
  test('.env.example is allowed inside a folder that ships', () => {
    expect(checkPackList(['package.json', 'examples/app/.env.example'])).toEqual([])
  })
  test('key, certificate and credential file names fail', () => {
    for (const p of ['lib/server.pem', 'lib/id_rsa', 'lib/private.key', 'lib/.npmrc', 'lib/credentials.json', 'packs/secrets.yml']) {
      expect(checkPackList(['package.json', p]).join(), p).toMatch(/secret-looking/)
    }
  })
  test('a test file fails, wherever it is', () => {
    expect(checkPackList(['package.json', 'lib/a.test.ts']).join()).toMatch(/test file/)
    expect(checkPackList(['package.json', 'lib/tests/a.mjs']).join()).toMatch(/test file/)
  })
  test('a fixture outside the declared fixture folders fails', () => {
    expect(checkPackList(['package.json', 'lib/fixtures/bad.js']).join()).toMatch(/fixture outside/)
    expect(checkPackList(['package.json', 'packs/__fixtures__/bad.js']).join()).toMatch(/fixture outside/)
  })
  test('a file outside the expected folders fails', () => {
    expect(checkPackList(['package.json', 'docs/guide.md']).join()).toMatch(/outside the expected folders/)
    expect(checkPackList(['package.json', 'notes.txt']).join()).toMatch(/outside the expected folders/)
  })
  test('the workflow profiles folder is allowed', () => {
    expect(checkPackList(['package.json', 'profiles/solo.json', 'profiles/team.json'])).toEqual([])
  })
  test('an empty tarball fails', () => {
    expect(checkPackList([]).join()).toMatch(/empty/)
  })
  test('windows separators are read as folders', () => {
    expect(checkPackList(['package.json', 'lib\\a.test.ts']).join()).toMatch(/test file/)
  })
  test("this repository's real tarball passes", () => {
    const { paths, error } = packPaths(repo)
    expect(error).toBeUndefined()
    expect(paths.length).toBeGreaterThan(50)
    expect(checkPackList(paths)).toEqual([])
  }, 120000)
})

describe('fix commits need a test', () => {
  const commits = [
    { sha: 'a1', subject: 'fix parser crash', files: ['lib/p.mjs'] },
    { sha: 'b2', subject: 'Fix: quoting', files: ['lib/q.mjs', 'tests/q.test.ts'] },
    { sha: 'c3', subject: 'add feature', files: ['lib/f.mjs'] },
    { sha: 'd4', subject: 'fixes the header', files: ['README.md'] },
    { sha: 'e5', subject: 'prefix fix', files: ['lib/x.mjs'] },
  ]
  test('only fix commits with no test file are listed', () => {
    expect(fixesWithoutTests(commits).map((c: { sha: string }) => c.sha)).toEqual(['a1', 'd4'])
  })
  test('parseLog reads the git log format', () => {
    const out = '\x1eaaa\x1ffix one\nlib/a.mjs\ntests/a.test.ts\n\x1ebbb\x1fadd two\nlib/b.mjs\n'
    expect(parseLog(out)).toEqual([
      { sha: 'aaa', subject: 'fix one', files: ['lib/a.mjs', 'tests/a.test.ts'] },
      { sha: 'bbb', subject: 'add two', files: ['lib/b.mjs'] },
    ])
  })
  test('on a real git history: a warning by default, a failure with --strict', () => {
    const dir = join(scratch, 'git-fix')
    mkdirSync(dir, { recursive: true })
    const git = (...a: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd: dir })
    git('init', '-q', '.')
    writeFileSync(join(dir, 'a.js'), '1\n')
    git('add', 'a.js')
    git('commit', '-q', '-m', 'first')
    git('tag', 'v1.0.0')
    writeFileSync(join(dir, 'a.js'), '2\n')
    git('commit', '-q', '-am', 'fix the thing')
    const script = join(repo, 'tools', 'release', 'fix-tests.mjs')
    const warn = run(process.execPath, [script, '--root', dir])
    expect(warn.code, warn.stdout).toBe(0)
    expect(warn.stdout).toMatch(/warning: \w+ fix the thing/)
    const strict = run(process.execPath, [script, '--root', dir, '--strict'])
    expect(strict.code).toBe(1)
    expect(strict.stdout).toMatch(/FAIL: \w+ fix the thing/)
    mkdirSync(join(dir, 'tests'))
    writeFileSync(join(dir, 'tests', 'a.test.js'), 'x\n')
    git('add', 'tests')
    git('commit', '-q', '-m', 'fix the thing again, with a test')
    writeFileSync(join(dir, 'a.js'), '3\n')
    git('commit', '-q', '-am', 'tidy')
    const both = run(process.execPath, [script, '--root', dir, '--strict'])
    expect(both.stdout).toMatch(/2 start with "fix", 1 of those/)
  })
})

describe('audit judging', () => {
  test('exit 0 passes', () => expect(judgeAudit({ code: 0, stdout: '', stderr: '' }).status).toBe('pass'))
  test('advisories at or above the threshold fail', () => {
    expect(judgeAudit({ code: 1, stdout: '1 high severity vulnerability', stderr: '' }).status).toBe('fail')
  })
  test('an unreachable registry is not run, never a pass', () => {
    expect(judgeAudit({ code: 1, stdout: '', stderr: 'npm error code ENOTFOUND' }).status).toBe('notrun')
    expect(judgeAudit({ code: 1, stdout: '', stderr: 'npm error audit endpoint returned an error' }).status).toBe('notrun')
    expect(judgeAudit({ code: 127, stdout: '', stderr: 'spawn npm ENOENT' }).status).toBe('notrun')
  })
})

// A tiny stand-in for the real package: a bin that answers --version, writes a run, a baseline, and prints saved dismissals.
const FAKE_BIN = (version: string, readsDismissals: boolean) => `import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const [cmd, ...rest] = process.argv.slice(2)
const state = join(homedir(), '.meerkat')
if (cmd === '--version') console.log('${version}')
else if (cmd === '--help') console.log('meerkat fake help')
else if (cmd === 'fake-scan') {
  mkdirSync(join(state, 'logs', 'runs', 'run-1'), { recursive: true })
  writeFileSync(join(state, 'logs', 'runs', 'run-1', 'findings.json'), '{"findings":[]}')
  console.log('MEERKAT fake: 3 passed, 0 failed')
} else if (cmd === 'baseline') {
  mkdirSync(join(state, 'baselines'), { recursive: true })
  writeFileSync(join(state, 'baselines', 'x.json'), '{"schemaVersion":1,"items":[]}')
  console.log('Baseline saved')
} else if (cmd === 'last') console.log('last run: run-1')
else if (cmd === 'dismissals') {
  const dir = join(state, 'dismissals')
  ${readsDismissals ? "for (const f of readdirSync(dir)) console.log(readFileSync(join(dir, f), 'utf8'))" : "console.log('none')"}
} else { console.error('unknown ' + cmd); process.exit(2) }
`

function fakePackage(name: string, version: string, opts: { readsDismissals?: boolean; extraFile?: string } = {}) {
  const dir = join(scratch, name)
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'meerkat.mjs'), FAKE_BIN(version, opts.readsDismissals ?? true))
  writeFileSync(join(dir, 'README.md'), '# fake\n')
  writeFileSync(join(dir, 'LICENSE'), 'MIT\n')
  const files = ['bin/']
  if (opts.extraFile) {
    mkdirSync(join(dir, dirname(opts.extraFile)), { recursive: true })
    writeFileSync(join(dir, opts.extraFile), 'SECRET=1\n')
    files.push(opts.extraFile)
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@samuelndce/meerkat', version, type: 'module', bin: { meerkat: 'bin/meerkat.mjs' }, files }, null, 2))
  return dir
}

const tempFolders = () => readdirSync(tmpdir()).filter((n) => /^meerkat-(tarball|upgrade)-/.test(n))

describe('tarball smoke test', () => {
  test('a good package passes every step and leaves no temp folder', () => {
    const before = tempFolders()
    const lines: string[] = []
    const r = tarballSmoke({ root: fakePackage('fake-good', '3.1.4'), scanArgs: ['fake-scan', '{app}'], log: (s: string) => lines.push(s) })
    expect(r.ok, lines.join('\n')).toBe(true)
    expect(r.steps.length).toBeGreaterThanOrEqual(8)
    expect(tempFolders().sort()).toEqual(before.sort())
  }, 120000)

  test('a tarball carrying an .env file fails at the file-list step, and still cleans up', () => {
    const before = tempFolders()
    const r = tarballSmoke({ root: fakePackage('fake-env', '3.1.4', { extraFile: 'bin/.env' }), scanArgs: ['fake-scan', '{app}'], log: () => {} })
    expect(r.ok).toBe(false)
    expect(r.failed).toMatch(/allow rule/)
    expect(tempFolders().sort()).toEqual(before.sort())
  }, 120000)

  test('a bin that cannot run fails the version step', () => {
    const dir = fakePackage('fake-broken', '3.1.4')
    writeFileSync(join(dir, 'bin', 'meerkat.mjs'), 'throw new Error("boom")\n')
    const r = tarballSmoke({ root: dir, scanArgs: ['fake-scan', '{app}'], log: () => {} })
    expect(r.ok).toBe(false)
    expect(r.failed).toMatch(/--version/)
  }, 120000)
})

describe('upgrade smoke test', () => {
  test('without --previous it is not run, never a pass', () => {
    const r = upgradeSmoke({ log: () => {} })
    expect(r.ok).toBe(false)
    expect(r.notRun).toBe(true)
  })

  test('a fake previous version folder upgrades to a new one and the saved state survives and reads', () => {
    const before = tempFolders()
    const lines: string[] = []
    const r = upgradeSmoke({ previous: fakePackage('fake-prev', '1.0.0'), root: fakePackage('fake-new', '2.0.0'), scanArgs: ['fake-scan', '{app}'], log: (s: string) => lines.push(s) })
    expect(r.ok, lines.join('\n')).toBe(true)
    expect(lines.join('\n')).toMatch(/1\.0\.0 -> 2\.0\.0/)
    expect(tempFolders().sort()).toEqual(before.sort())
  }, 180000)

  test('a new version that cannot read the saved dismissals fails the read step', () => {
    const r = upgradeSmoke({ previous: fakePackage('fake-prev2', '1.0.0'), root: fakePackage('fake-new2', '2.0.0', { readsDismissals: false }), scanArgs: ['fake-scan', '{app}'], log: () => {} })
    expect(r.ok).toBe(false)
    expect(r.failed).toMatch(/reads the dismissals/)
  }, 180000)

  test('state snapshots notice a missing or changed file but not a new one', () => {
    expect(stateDiff({ a: '1', b: '2' }, { a: '1', b: '9', c: '3' })).toEqual({ missing: [], changed: ['b'] })
    expect(stateDiff({ a: '1' }, {})).toEqual({ missing: ['a'], changed: [] })
    const home = join(scratch, 'snap-home')
    mkdirSync(join(home, '.meerkat', 'baselines'), { recursive: true })
    writeFileSync(join(home, '.meerkat', 'baselines', 'x.json'), '{}')
    expect(Object.keys(snapshotState(home))).toEqual(['baselines/x.json'])
  })
})

describe('skills ship in the package', () => {
  test('skills/ is an expected folder and package.json files lists it', () => {
    expect(checkPackList(['package.json', 'skills/meerkat/SKILL.md'])).toEqual([])
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.files).toContain('skills/')
  })
})
