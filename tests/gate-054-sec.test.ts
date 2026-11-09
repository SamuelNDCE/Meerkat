// 0.5.4: the --staged snapshot never writes through a link; expired dismissals show in a real run; an all-inline-ignored check passes in run and gate.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { dismissalDoc, saveAccepted, withDismissal } from '../lib/accepted.mjs'
import { gateMain, stagedSnapshot } from '../lib/gate.mjs'

const NL = String.fromCharCode(10)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'meerkat-gate054sec-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.symlinks=true', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const SQL = 'export function find(db, name) { return db.query("SELECT * FROM users WHERE name = " + name) }\n'
const repo = (name: string, src: string) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus'], disable: ['unused-files'], discover: false }))
  put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(d, 'src/bug.js', src)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  return d
}
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs }
const runCli = (d: string) => spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', d, '--only', 'sql-concat', '--plain', '--no-cache'], { encoding: 'utf8', env, timeout: 120000 })

const canLink = (() => {
  try {
    mkdirSync(join(root, 'lt'), { recursive: true })
    writeFileSync(join(root, 'lt', 'a'), 'x')
    symlinkSync(join(root, 'lt', 'a'), join(root, 'lt', 'l'))
    return true
  } catch {
    return false
  }
})()

describe('staged snapshot and links', () => {
  test.skipIf(!canLink)('a link in HEAD replaced by a file in the index is not written through', () => {
    const d = repo('link', 'export const a = 1\n')
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'ORIGINAL')
    git(d, 'rm', '-q', '--cached', 'src/bug.js')
    rmSync(join(d, 'src/bug.js'))
    symlinkSync(outside, join(d, 'src/bug.js'))
    git(d, 'add', 'src/bug.js')
    git(d, 'commit', '-q', '-m', 'bug.js becomes a link')
    // stage a regular file at the path of the committed link
    const blob = spawnSync('git', ['-C', d, 'hash-object', '-w', '--stdin'], { input: 'export const evil = 1\n', encoding: 'utf8' }).stdout.trim()
    git(d, 'update-index', '--add', '--cacheinfo', `100644,${blob},src/bug.js`)
    const snap = stagedSnapshot(d, d, ['src/bug.js'])
    snap?.done()
    expect(readFileSync(outside, 'utf8')).toBe('ORIGINAL')
  })
  test.skipIf(!canLink)('a staged file under a folder that is a link refuses the snapshot', () => {
    const d = repo('linkdir', 'export const a = 1\n')
    const outsideDir = join(root, 'outdir')
    mkdirSync(outsideDir, { recursive: true })
    git(d, 'rm', '-q', '-r', '--cached', 'src')
    rmSync(join(d, 'src'), { recursive: true })
    symlinkSync(outsideDir, join(d, 'src'), 'junction')
    git(d, 'add', 'src')
    git(d, 'commit', '-q', '-m', 'src becomes a link')
    const blob = spawnSync('git', ['-C', d, 'hash-object', '-w', '--stdin'], { input: 'x\n', encoding: 'utf8' }).stdout.trim()
    git(d, 'update-index', '--add', '--cacheinfo', `100644,${blob},src/evil.js`)
    const snap = stagedSnapshot(d, d, ['src/evil.js'])
    snap?.done()
    expect(readdirSync(outsideDir)).toEqual([])
  })
})

describe('real CLI wiring', () => {
  test('run: an expired dismissal says so when its finding comes back', () => {
    const d = repo('expired', SQL)
    const first = runCli(d)
    expect(first.stdout).toMatch(/FAIL\s+sql-concat/)
    const runs = join(logs, 'runs')
    const newest = readdirSync(runs).filter((n) => n.includes('expired')).sort().pop() as string
    const doc = JSON.parse(readFileSync(join(runs, newest, 'findings.json'), 'utf8'))
    const id = doc.findings.find((f: any) => f.check === 'sql-concat').id
    saveAccepted('dismissed', env, d, dismissalDoc(withDismissal([], { id, reason: 'old', expires: '2020-01-01' })))
    const second = runCli(d)
    expect(second.stdout).toContain('dismissal expired on 2020-01-01')
  }, 240000)
  test('run and gate: a check whose every finding is inline-ignored passes', async () => {
    const d = repo('ignored', SQL.replace(NL, ' // meerkat-ignore sql-concat constants only, reviewed' + NL))
    const r = runCli(d)
    expect(r.stdout).not.toMatch(/FAIL\s+sql-concat/)
    expect(r.stdout).toMatch(/1 passed, 0 failed/)
    put(d, 'src/bug.js', SQL.replace(NL, ' // meerkat-ignore sql-concat constants only, reviewed' + NL) + '// touched' + NL)
    const lines: string[] = []
    const code = await gateMain(['--no-cache', '--json', '--app', d], { env, cwd: d, log: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
    const j = JSON.parse(lines.join(NL))
    expect(j.rows.find((x: any) => x.id === 'sql-concat').kind).toBe('pass')
    expect(j.rows.filter((x: any) => x.kind === 'fail' || x.kind === 'crash').map((x: any) => x.id + ':' + x.detail)).toEqual([])
    expect(code).toBe(0)
  }, 240000)
})
