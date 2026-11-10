// 0.9.8 verdict capabilities: --format markdown, --format github, --since, --explain, --strict and "schema": 1 in the JSON. Every test runs the real CLI
// on a fixture repo; the default output and exit codes are checked too.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-verdict098-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), NO_COLOR: '1' } as NodeJS.ProcessEnv
const cli = join(__dirname, '..', 'bin', 'meerkat.mjs')
const meerkat = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', timeout: 170_000 })
  return { code: r.status, out: r.stdout.replace(/\r/g, ''), err: r.stderr.replace(/\r/g, '') }
}
let dir: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/old.js', bug('oldBug'))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'clean')
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 2\n')
  git(dir, 'commit', '-q', '-am', 'clean change')
  git(dir, 'checkout', '-q', 'main')
  git(dir, 'checkout', '-q', '-b', 'feature')
  put(dir, 'src/new.js', bug('newBug'))
  put(dir, 'src/second.js', bug('secondBug'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'branch')
})

describe('default output is unchanged', () => {
  test('FAIL line, pre-existing line, exit 1; PASS on a clean branch, exit 0', () => {
    const bad = meerkat(dir, 'verdict', '--base', 'main')
    expect(bad.out.split('\n')[0]).toMatch(/^FAIL 2 new blocking findings in 2 files \(status 422\)\. Next: fix /)
    expect(bad.out).toContain('pre-existing: 1 (not in this diff, does not block)')
    expect(bad.code).toBe(1)
    git(dir, 'checkout', '-q', 'clean')
    const ok = meerkat(dir, 'verdict', '--base', 'main')
    expect(ok.out.split('\n')[0]).toMatch(/^PASS \(status 200\): nothing new blocks/)
    expect(ok.code).toBe(0)
    git(dir, 'checkout', '-q', 'feature')
  }, 180_000)
})

describe('--format markdown', () => {
  test('verdict line, one table of new blocking findings, pre-existing count, exact re-run command', () => {
    const r = meerkat(dir, 'verdict', '--base', 'main', '--format', 'markdown')
    expect(r.code).toBe(1)
    const lines = r.out.split('\n')
    expect(lines[0]).toMatch(/^\*\*Meerkat verdict: FAIL 2 new blocking findings in 2 files \(status 422\)\. Next: /)
    expect(lines.filter((l) => l.startsWith('| File'))).toHaveLength(1)
    expect(r.out).toMatch(/\| src\/new\.js \| 1 \| sql-concat \| /)
    expect(r.out).toMatch(/\| src\/second\.js \| 1 \| sql-concat \| /)
    expect(r.out).not.toContain('src/old.js')
    expect(r.out).toContain('Pre-existing findings (not in this diff, do not block): 1')
    expect(r.out).toContain('Re-run:\n\n```\nmeerkat verdict --base main --format markdown\n```')
  }, 180_000)
  test('a pass has no table', () => {
    git(dir, 'checkout', '-q', 'clean')
    const r = meerkat(dir, 'verdict', '--base', 'main', '--format', 'markdown')
    git(dir, 'checkout', '-q', 'feature')
    expect(r.code).toBe(0)
    expect(r.out).toContain('**Meerkat verdict: PASS (status 200): nothing new blocks')
    expect(r.out).not.toContain('| File')
  }, 180_000)
})

describe('markdown hardening', () => {
  test('a message with a pipe, markup, html and a backtick run renders as escaped plain text; the re-run command keeps its fence', async () => {
    const { cell, fenced, markdownBody } = await import('../lib/verdict-out.mjs')
    const msg = 'a | b *bold* <script>alert(1)</script> [x](http://e) ``` `` # h'
    const c = cell(msg)
    expect(c).not.toMatch(/(^|[^\\])\|/)
    expect(c).toContain('\\|')
    expect(c).toContain('\\<script\\>')
    expect(c).toContain('\\*bold\\*')
    expect(c).toContain('\\[x\\]\\(http://e\\)')
    expect(c).not.toMatch(/(^|[^\\])`/)
    const rerun = 'meerkat verdict --base "a```b"'
    expect(fenced(rerun)).toEqual(['````', rerun, '````'])
    const body = markdownBody({ line: 'FAIL 1 blocking in changed files', places: [{ file: 'a|b.js', line: 2, check: 'c', message: msg }], pre: 0, rerun })
    expect(body.filter((l) => l.startsWith('| ') && !l.startsWith('| File') && !l.startsWith('| ---'))).toHaveLength(1)
    expect(body.join('\n')).toContain('````\n' + rerun + '\n````')
  })
})

describe('--format github', () => {
  test('stdout carries only ::error and ::notice lines', () => {
    const r = meerkat(dir, 'verdict', '--base', 'main', '--format', 'github')
    expect(r.code).toBe(1)
    const lines = r.out.trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^::error file=src\/new\.js,line=1,title=sql-concat[^:]*::/)
    expect(lines[1]).toMatch(/^::error file=src\/second\.js,line=1,title=sql-concat[^:]*::/)
    expect(lines.some((l) => /^::error::FAIL 2 new blocking findings in 2 files \(status 422\)/.test(l))).toBe(true)
    expect(lines[3]).toMatch(/^::notice::base [0-9a-f]{12} \(main\)$/)
    for (const l of lines) expect(l).toMatch(/^::(error|notice)/)
  }, 180_000)
})

describe('--since', () => {
  test('is --base plus the range it compared', () => {
    const r = meerkat(dir, 'verdict', '--since', 'main')
    expect(r.code).toBe(1)
    expect(r.out.split('\n')[0]).toMatch(/^FAIL 2 new blocking findings in 2 files \(status 422\)\. Next: fix /)
    expect(r.out).toContain('compared main..HEAD: 1 commit')
    expect(r.out).toContain('pre-existing: 1 (not in this diff, does not block)')
  }, 180_000)
  test('both --since and --base is a usage error, exit 2', () => {
    const r = meerkat(dir, 'verdict', '--since', 'main', '--base', 'main')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/^NO-RESULT(?: \(status \d+\))?: --since and --base/)
  }, 60_000)
})

describe('--strict', () => {
  test('pre-existing findings block; the line says STRICT', () => {
    git(dir, 'checkout', '-q', 'clean')
    const normal = meerkat(dir, 'verdict', '--base', 'main')
    const strict = meerkat(dir, 'verdict', '--base', 'main', '--strict')
    git(dir, 'checkout', '-q', 'feature')
    expect(normal.code).toBe(0)
    expect(strict.code).toBe(1)
    expect(strict.out.split('\n')[0]).toMatch(/^FAIL STRICT 1 new blocking finding in 1 file \(strict: pre-existing findings count\) \(status 422\)\. Next: /)
  }, 180_000)
})

describe('--json schema', () => {
  test('"schema": 1 is the first key', () => {
    const r = meerkat(dir, 'verdict', '--base', 'main', '--json')
    const doc = JSON.parse(r.out)
    expect(Object.keys(doc)[0]).toBe('schema')
    expect(doc.schema).toBe(1)
    expect(doc.verdict).toBe('FAIL')
    expect(doc.exitCode).toBe(1)
  }, 180_000)
  test('a no-result JSON carries it too', () => {
    const doc = JSON.parse(meerkat(dir, 'verdict', '--base', 'nope-ref', '--json').out)
    expect(doc.schema).toBe(1)
    expect(doc.verdict).toBe('NO-RESULT')
  }, 60_000)
})

describe('--explain', () => {
  test('one block for one finding, by id prefix, with the dismiss command', () => {
    meerkat(dir, 'run', 'quick', '--no-input')
    const list = JSON.parse(meerkat(dir, 'findings', '--json').out)
    const f = list.findings.find((x: any) => x.check === 'sql-concat')
    expect(f).toBeTruthy()
    const r = meerkat(dir, 'verdict', '--explain', f.id.slice(0, 8))
    expect(r.code).toBe(0)
    expect(r.out).toContain(`finding ${f.id}`)
    expect(r.out).toMatch(/^check:   sql-concat/m)
    expect(r.out).toMatch(/^where:   src\/\w+\.js:1$/m)
    expect(r.out).toMatch(/^why:     \S/m)
    expect(r.out).toMatch(/^fix:     \S/m)
    expect(r.out).toContain(`meerkat dismiss ${f.id} --reason`)
    expect(r.out.trim().split('\n').length).toBeLessThanOrEqual(8)
  }, 180_000)
  test('an unknown id is NO-RESULT, exit 1; no id is exit 2', () => {
    const r = meerkat(dir, 'verdict', '--explain', 'zzzzzzzz')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/^NO-RESULT(?: \(status \d+\))?: No open finding with id zzzzzzzz/)
    expect(meerkat(dir, 'verdict', '--explain').code).toBe(2)
  }, 60_000)
})

describe('base line, --timings, --rerun-failed, results line', () => {
  test('the base commit is named on stderr as base <sha12> (<ref>) and in the JSON', () => {
    const sha = git(dir, 'merge-base', 'main', 'HEAD').trim().slice(0, 12)
    const r = meerkat(dir, 'verdict', '--base', 'main')
    expect(r.err).toContain(`base ${sha} (main)`)
    expect(r.out.split('\n')[0]).toMatch(/^FAIL 2 new blocking findings in 2 files \(status 422\)\. Next: fix /)
    expect(r.out).toContain('pre-existing: 1 (not in this diff, does not block)')
    const doc = JSON.parse(meerkat(dir, 'verdict', '--base', 'main', '--json').out)
    expect(doc.base).toEqual({ sha, ref: 'main' })
  }, 180_000)

  test('--timings prints a table of at most 15 checks, slowest first, after the normal output', () => {
    const r = meerkat(dir, 'verdict', '--base', 'main', '--timings')
    const lines = r.out.trimEnd().split('\n')
    const at = lines.findIndex((l) => l.startsWith('timings: top'))
    expect(at).toBeGreaterThan(1)
    expect(lines[at + 1]).toMatch(/^check\s+seconds\s+status$/)
    const rows = lines.slice(at + 2)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(15)
    const secs = rows.map((l) => Number(l.trim().split(/\s+/).at(-2)))
    expect(secs).toEqual([...secs].sort((a, b) => b - a))
    expect(r.code).toBe(1)
  }, 180_000)

  test('--rerun-failed with no earlier run is NO-RESULT; after a run it runs only the failed checks and says so', () => {
    const fresh = { ...env, MEERKAT_LOG_DIR: join(root, 'logs-fresh') } as NodeJS.ProcessEnv
    const none = spawnSync(process.execPath, [cli, 'verdict', '--base', 'main', '--rerun-failed'], { cwd: dir, env: fresh, encoding: 'utf8' })
    expect(none.status).toBe(1)
    expect(none.stdout).toMatch(/^NO-RESULT(?: \(status \d+\))?: --rerun-failed found no earlier verdict run/)
    const first = meerkat(dir, 'verdict', '--base', 'main')
    expect(first.code).toBe(1)
    const again = meerkat(dir, 'verdict', '--base', 'main', '--rerun-failed')
    expect(again.out.split('\n')[0]).toBe('rerun-failed: ran only the 1 check(s) that failed last time: sql-concat')
    expect(again.out).toContain('FAIL 2 new blocking findings in 2 files')
    expect(again.err).toMatch(/running checks \(1 loaded\)/)
    expect(again.code).toBe(1)
  }, 240_000)

  test('a run prints a results line naming summary.json and findings.json that exist', () => {
    const r = meerkat(dir, 'run', 'quick', '--no-input')
    const m = /^results: (\S+\/summary\.json) (\S+\/findings\.json)$/m.exec(`${r.out}\n${r.err}`)
    expect(m).toBeTruthy()
    expect(existsSync(m![1])).toBe(true)
    expect(existsSync(m![2])).toBe(true)
  }, 180_000)
})

describe('usage and help', () => {
  test('a bad format and --json with --format are exit 2', () => {
    expect(meerkat(dir, 'verdict', '--format', 'xml').code).toBe(2)
    expect(meerkat(dir, 'verdict', '--format', 'github', '--json').code).toBe(2)
  }, 60_000)
  test('verdict --help lists every new option', () => {
    const r = meerkat(dir, 'verdict', '--help')
    for (const flag of ['--format', '--since', '--explain', '--strict', '--timings', '--rerun-failed']) expect(r.out).toContain(flag)
  }, 60_000)
})
