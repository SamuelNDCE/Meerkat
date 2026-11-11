// 0.8.2: per-branch memory. The CLI cases run the real bin/meerkat.mjs in a scratch git repository; the rest call lib/memorybranch.mjs directly.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { branchFile, readBranchRecord, recordBranchResult, runMemoryBranch, showText } from '../lib/memorybranch.mjs'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-082m-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: join(root, 'logs') } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return String(r.stdout).trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const cli = (args: string[], cwd: string) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), ...args], { encoding: 'utf8', env, cwd, timeout: 170000 })
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) }
}
const repo = (name: string) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
  put(d, 'a.js', 'export const a = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat/x')
  put(d, 'a.js', 'export const a = 2\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change a')
  return d
}
const run = (argv: string[], cwd: string, e: NodeJS.ProcessEnv = env) => {
  const out: string[] = []
  const err: string[] = []
  const code = runMemoryBranch(argv, { env: e, cwd, out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('verdict and top record into the branch memory; notes survive', () => {
  const d = repo('flow')

  test('a verdict run writes the record, --show prints it in one short block', () => {
    expect(cli(['memory-branch', '--show'], d).code).toBe(3)
    expect(cli(['memory-branch', '--show'], d).out).toMatch(/^NO-RECORD: nothing is remembered about branch feat\/x yet\. next:/)
    const v = cli(['verdict', '--base', 'main'], d)
    expect([0, 1]).toContain(v.code)
    const first = v.out.split('\n')[0].split(' ')[0]
    expect(v.err).not.toMatch(/branch memory was not saved/)
    const head = git(d, 'rev-parse', 'HEAD')
    const s = cli(['memory-branch', '--show'], d)
    expect(s.code).toBe(0)
    const lines = s.out.trim().split('\n')
    expect(lines.length).toBeLessThanOrEqual(6)
    expect(lines[0]).toBe('branch feat/x')
    expect(lines[1]).toContain(`verdict: ${first}`)
    expect(lines[1]).toContain(`commit ${head.slice(0, 10)}`)
    expect(lines[1]).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z .*by verdict\)/)
    expect(lines[2]).toMatch(/^open findings: \d+/)
    expect(lines[3]).toBe('notes: none')
  }, 120000)

  test('a note is stored with its commit and survives a second verdict run', () => {
    const head = git(d, 'rev-parse', 'HEAD')
    const n = cli(['memory-branch', '--note', `tests pass as of ${head.slice(0, 7)}`], d)
    expect(n.code).toBe(0)
    expect(n.out.trim()).toBe('noted on branch feat/x (1 note)')
    const again = cli(['verdict', '--base', 'main'], d)
    expect([0, 1]).toContain(again.code)
    const rec = JSON.parse(cli(['memory-branch', '--json'], d).out)
    expect(rec.notes).toHaveLength(1)
    expect(rec.notes[0].text).toBe(`tests pass as of ${head.slice(0, 7)}`)
    expect(rec.notes[0].commit).toBe(head)
    expect(rec.verdict.source).toBe('verdict')
    expect(rec.verdict.commit).toBe(head)
    const shown = cli(['memory-branch', '--show'], d).out
    expect(shown).toMatch(/notes \(1\):/)
    expect(shown).toContain(`@${head.slice(0, 7)}  tests pass as of ${head.slice(0, 7)}`)
  }, 150000)

  test('top records too (source top); the note is still there', () => {
    const t = cli(['top', '--base', 'main'], d)
    expect(t.code).toBe(0)
    const rec = JSON.parse(cli(['memory-branch', '--json'], d).out)
    expect(rec.verdict.source).toBe('top')
    expect(rec.notes).toHaveLength(1)
    expect(typeof rec.openFindings).toBe('number')
  }, 120000)

  test('another branch has its own record; --note and --show together add then print', () => {
    const r = run(['other/branch', '--note', 'not checked out here', '--show'], d)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^branch other\/branch\nverdict: none recorded yet/)
    expect(r.out).toContain('not checked out here')
    expect(JSON.parse(run(['--json'], d).out).branch).toBe('feat/x')
  })
})

describe('writes are atomic and never lose a note', () => {
  test('feat/a and feat_a do not share a file', () => {
    const d = repo('slug')
    expect(branchFile(env, d, 'feat/a')).not.toBe(branchFile(env, d, 'feat_a'))
  })

  test('twelve processes adding notes at once: every note is there and the file is whole JSON', async () => {
    const d = repo('parallel')
    const jobs = Array.from({ length: 12 }, (_, i) =>
      new Promise<number | null>((done) => {
        const c = spawn(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), 'memory-branch', '--note', `note ${i}`], { env, cwd: d, stdio: 'ignore' })
        c.on('close', done)
      }),
    )
    const codes = await Promise.all(jobs)
    expect(codes.every((c) => c === 0)).toBe(true)
    const file = branchFile(env, d, 'feat/x')
    const rec = JSON.parse(readFileSync(file, 'utf8'))
    expect(rec.notes.map((n: { text: string }) => n.text).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `note ${i}`).sort())
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([])
  }, 120000)

  test('a damaged file is kept aside, a new record starts, and the caller is told', () => {
    const d = repo('damaged')
    const file = branchFile(env, d, 'feat/x')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{broken')
    expect(run([], d).code).toBe(2)
    expect(run([], d).err).toMatch(/could not be read.*next: remove that file/)
    const n = run(['--note', 'fresh start'], d)
    expect(n.code).toBe(0)
    expect(n.err).toMatch(/was damaged; it was kept as .*damaged-\d+/)
    expect(readdirSync(dirname(file)).some((f) => f.includes('.damaged-'))).toBe(true)
    expect(readBranchRecord(file).record.notes).toHaveLength(1)
  })
})

describe('usage and limits are never silent', () => {
  const d = repo('usage')
  test('bad options exit 2 with the usage line', () => {
    for (const bad of [['--nope'], ['--note'], ['--note', '   '], ['--app'], ['a', 'b']]) {
      const r = run(bad, d)
      expect(r.code, bad.join(' ')).toBe(2)
      expect(r.err).toMatch(/usage: meerkat memory-branch/)
    }
  })
  test('a note over the limit is refused with the size, and 50 notes keep the newest', () => {
    const big = run(['--note', 'x'.repeat(2001)], d)
    expect(big.code).toBe(2)
    expect(big.err).toMatch(/the note is 2001 characters; the limit is 2000/)
    for (let i = 0; i < 52; i++) expect(run(['--note', `n${i}`], d).code).toBe(0)
    const rec = JSON.parse(run(['--json'], d).out)
    expect(rec.notes).toHaveLength(50)
    expect(rec.notes[49].text).toBe('n51')
    expect(rec.notes[0].text).toBe('n2')
    expect(showText(rec)).toMatch(/\.\.\. 45 older/)
  })
  test('outside a git repository it says so, exit 2', () => {
    const plain = join(root, 'plain')
    mkdirSync(plain, { recursive: true })
    const r = run([], plain)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/not inside a git repository/)
  })
  test('a detached HEAD is remembered under its own name, and a failed write is a reason, not a throw', () => {
    const e = repo('detached')
    git(e, 'checkout', '-q', '--detach')
    const r = recordBranchResult({ env, repoRoot: e, source: 'verdict', line: 'PASS', exit: 0, commit: git(e, 'rev-parse', 'HEAD'), blocking: 0, preExisting: 0 })
    expect(r.ok).toBe(true)
    expect(JSON.parse(run(['--json'], e).out).branch).toMatch(/^\(detached [0-9a-f]+\)$/)
    const blocked = join(root, 'a-file')
    writeFileSync(blocked, 'x')
    const bad = recordBranchResult({ env: { ...env, MEERKAT_LOG_DIR: blocked }, repoRoot: e, source: 'verdict', line: 'PASS', exit: 0, commit: 'c', blocking: 0, preExisting: 0 })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBeTruthy()
    expect(existsSync(blocked)).toBe(true)
  })
})
