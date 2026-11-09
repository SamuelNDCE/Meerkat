// meerkat handoff: a fixture branch with one bad file produces the handoff; --read prints the next command; the file is short and lives outside the repo.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { handoffLines, runHandoff } from './handoff.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-handoff-'))
const repo = join(root, 'app')
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' }
const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8', env })
const git = (...a: string[]) => {
  const r = sh('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a])
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const go = async (...argv: string[]) => {
  const o: string[] = []
  const e: string[] = []
  const t0 = Date.now()
  const code = await runHandoff(argv, { env, cwd: repo, out: (t: string) => o.push(t), err: (t: string) => e.push(t) })
  return { code, out: o.join('\n'), err: e.join('\n'), ms: Date.now() - t0 }
}

beforeAll(() => {
  sh('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'meerkat.config.json'), '{"packs":["security-plus"]}\n')
  writeFileSync(join(repo, 'a.js'), 'const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'db.js'), "const { Pool } = require('pg')\nconst db = new Pool()\ndb.query(`SELECT * FROM users WHERE id = ${req.params.id}`)\n")
  git('add', '-A')
  git('commit', '-q', '-m', 'add db')
}, 60000)
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe('handoffLines', () => {
  const base = { verdict: 'PASS', branch: 'b', commit: 'c', base: 'main', folder: '/x', open: 0, places: [], command: 'meerkat verdict /x --base main', when: 'now' }
  test('no findings: says None and stays short', () => {
    const l = handoffLines(base)
    expect(l.join('\n')).toContain('None.')
    expect(l.length).toBeLessThan(60)
  })
  test('lists only the first five and counts the rest', () => {
    const places = Array.from({ length: 9 }, (_, i) => ({ file: `f${i}.js`, line: i + 1, check: 'c', message: 'm'.repeat(500) }))
    const l = handoffLines({ ...base, verdict: 'FAIL 9 blocking in changed files', open: 9, places })
    expect(l.filter((x: string) => x.startsWith('- f'))).toHaveLength(5)
    expect(l.join('\n')).toContain('and 4 more')
    expect(l.length).toBeLessThan(60)
    expect(Math.max(...l.map((x: string) => x.length))).toBeLessThan(200)
  })
})

describe('meerkat handoff on a fixture branch', () => {
  test('writes the file outside the repo, under 60 lines, with verdict, findings, branch, commit and the next command; --read prints the command', async () => {
    const head = git('rev-parse', '--short=12', 'HEAD')
    const r = await go('--base', 'main')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^FAIL \d+ blocking in changed files/m)
    const file = /handoff: (\S+meerkat-handoff\.md)/.exec(r.out)?.[1] as string
    expect(file).toBeTruthy()
    expect(file.startsWith(repo.split('\\').join('/'))).toBe(false)
    expect(existsSync(join(repo, 'meerkat-handoff.md'))).toBe(false)
    const text = readFileSync(file, 'utf8')
    expect(text.split('\n').length).toBeLessThanOrEqual(60)
    expect(text).toContain('- verdict: FAIL')
    expect(text).toContain('- branch: feature')
    expect(text).toContain(`- commit: ${head}`)
    expect(text).toMatch(/- db\.js:3 sql-concat/)
    const next = /```\n(meerkat verdict [^\n]+)\n```/.exec(text)?.[1] as string
    expect(next).toContain('--base main')

    const read = await go('--read', file)
    expect(read.code).toBe(0)
    expect(read.out).toContain('branch: feature')
    expect(read.out).toContain(`next command: ${next}`)
    console.log('HANDOFF-LINES', text.split('\n').length, 'ms', r.ms)
  }, 120000)

  test('--out writes where told; --read of a missing or foreign file exits 2 with a reason', async () => {
    const out = join(root, 'chosen.md')
    const r = await go('--base', 'main', '--out', out)
    expect(r.code).toBe(0)
    expect(existsSync(out)).toBe(true)
    const miss = await go('--read', join(root, 'nope.md'))
    expect(miss.code).toBe(2)
    expect(miss.err).toContain('does not exist')
    writeFileSync(join(root, 'other.md'), '# something else\n')
    const other = await go('--read', join(root, 'other.md'))
    expect(other.code).toBe(2)
    expect(other.err).toContain('not a Meerkat handoff file')
    const badBase = await go('--base', 'no-such-ref')
    expect(badBase.code).toBe(2)
  }, 120000)
})
