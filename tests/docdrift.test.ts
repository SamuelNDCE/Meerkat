// The doc-drift checks (thorough/doc-drift.mjs): each fails on its own fixture, passes on a clean folder, and finds the drift planted in a small project.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ALL = ['doc-drift-flags', 'doc-drift-env', 'doc-drift-paths', 'doc-drift-counts', 'doc-drift-commands']
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function run(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['thorough/doc-drift.mjs', ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-docdrift-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

const PKG = '{"name":"demo","bin":{"demo":"cli.js"},"scripts":{"test":"vitest","build":"tsc"}}\n'
const CLEAN = {
  'package.json': PKG,
  'cli.js': "if (a === '--real') run(process.env.DEMO_REAL)\n",
  'lib/real.mjs': '1\n',
  'packs/a/a.js': '1\n',
  'packs/b/b.js': '1\n',
  'README.md': '# Demo\n\n```sh\ndemo --real\nnpm run build\nnode cli.js\n```\n\nSet the environment variable `DEMO_REAL`. See `lib/real.mjs` and `https://example.org/x/y.md`.\n\nThere are two bundled packs in `packs/`.\n\nIt has two options:\n\n- one\n- two\n\n```json\n{"a": 1}\n```\n',
}

describe('doc-drift checks fail on their own fixture, for the right reason', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const r = run([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/README\.md:\d+ /)
    })
  }
})

describe('doc-drift checks pass on a project whose docs agree with its code', () => {
  const dir = project(CLEAN)
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      const r = run([check, '--root', dir])
      expect(r.code, r.out).toBe(0)
    })
  }
})

describe('doc-drift checks name the doc line, the place checked and the difference', () => {
  test('flags', () => {
    const dir = project({ ...CLEAN, 'README.md': '# Demo\n\nText.\n\n```sh\ndemo --ghost\ngit commit --amend\n```\n\nUse `--phantom` to go.\n' })
    const r = run(['doc-drift-flags', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/README\.md:6 documents --ghost, but no source file defines it \(checked: \d+ tracked code/)
    expect(r.out).toMatch(/README\.md:10 documents --phantom/)
    expect(r.out).not.toMatch(/--amend/)
  })
  test('flags: a flag that only a test file mentions is not defined', () => {
    const dir = project({ ...CLEAN, 'tests/x.test.js': "'--ghost'\n", 'README.md': '# Demo\n\n```sh\ndemo --ghost\n```\n' })
    expect(run(['doc-drift-flags', '--root', dir]).code).toBe(1)
  })
  test('env', () => {
    const dir = project({ ...CLEAN, 'README.md': '# Demo\n\n```sh\nexport DEMO_GONE=1\nexport DEMO_REAL=2\n```\n\nThe variable `NODE_ENV` is not ours.\n' })
    const r = run(['doc-drift-env', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/README\.md:4 documents the environment variable DEMO_GONE/)
    expect(r.out).not.toMatch(/DEMO_REAL|NODE_ENV/)
  })
  test("paths: only paths under the project's own folders count", () => {
    const dir = project({ ...CLEAN, 'README.md': '# Demo\n\nSee `lib/gone.mjs`, `lib/real.mjs`, `findings.json`, `~/.demo/x.json` and `other/dir/file.md`.\n' })
    const r = run(['doc-drift-paths', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/README\.md:3 points at lib\/gone\.mjs, which does not exist/)
    expect(r.out).not.toMatch(/findings\.json|\.demo|other\/dir/)
  })
  test('counts: a list and a folder', () => {
    const dir = project({ ...CLEAN, 'README.md': '# Demo\n\nThere are five bundled packs in `packs/`.\n\nIt has four steps:\n\n1. a\n2. b\n3. c\n' })
    const r = run(['doc-drift-counts', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/README\.md:3 says five bundled packs|README\.md:3 says five packs/)
    expect(r.out).toMatch(/packs\/ holds 2/)
    expect(r.out).toMatch(/README\.md:5 says four steps, but the list under it has 3 items/)
  })
  test('commands: quotes, scripts, files and json', () => {
    const dir = project({ ...CLEAN, 'README.md': "# Demo\n\n```sh\nnpm run nope\nnode gone.js\necho 'oops\ncd x && \n```\n\n```json\n{\"a\": }\n```\n" })
    const r = run(['doc-drift-commands', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/README\.md:4 runs npm script "nope"/)
    expect(r.out).toMatch(/README\.md:5 runs node gone\.js/)
    expect(r.out).toMatch(/README\.md:6 shows a command that does not parse.*unclosed single quote/)
    expect(r.out).toMatch(/README\.md:7 shows a command that does not parse.*operator at the end/)
    expect(r.out).toMatch(/README\.md:10 has a json example that does not parse/)
  })
  test('the allow file silences a name that is documented on purpose', () => {
    const dir = project({ ...CLEAN, '.meerkat-docdrift-allow': '# other tool\n--ghost\n', 'README.md': '# Demo\n\n```sh\ndemo --ghost\n```\n' })
    expect(run(['doc-drift-flags', '--root', dir]).code).toBe(0)
  })
})

describe('the doc-drift pack', () => {
  test('loads its checks, each with a selfTest and an expectMatch that its output matches', async () => {
    const checks = (await loadChecks(join(ROOT, 'packs', 'doc-drift'))) as any[]
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
    for (const c of checks) {
      expect(c.selfTest.expectFail, c.id).toBe(true)
      expect(run([c.id, '--fixtures']).out, c.id).toMatch(new RegExp(c.selfTest.expectMatch))
    }
  })
})
