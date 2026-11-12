// A change whose judged files all match no check is NO-RESULT (status 204, exit 3), never a PASS. A binary file is not text: no check reads or flags it.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-nocheck-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') }
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string | Buffer) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 255, 254, 0, 7, 0x41, 0x4b, 0x49, 0x41])
const repo = (name: string, files: Record<string, string | Buffer>) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'feature')
  for (const [f, b] of Object.entries(files)) put(dir, f, b)
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'change')
  return dir
}
const verdict = (dir: string) => {
  const r = spawnSync(process.execPath, [bin, 'verdict', '--base', 'main'], { cwd: dir, env, encoding: 'utf8', timeout: 120_000 })
  return { code: r.status, first: String(r.stdout).split(/\r?\n/)[0] ?? '', all: String(r.stdout) }
}

describe('no check covers the changed files', () => {
  test('A: a text file no check covers is NO-RESULT 204, exit 3, with the matched-no-check line kept', () => {
    const v = verdict(repo('a', { 'notes.txt': 'just words\n' }))
    expect(v.first).toMatch(/^NO-RESULT \(status 204\): no check covers the changed files/)
    expect(v.first).toMatch(/Next:/)
    expect(v.all).toMatch(/matched no check \(1\): notes\.txt/)
    expect(v.code).toBe(3)
  })
  test('B: a binary file alone is NO-RESULT exit 3 and is not flagged', () => {
    const v = verdict(repo('b', { 'assets/logo.png': PNG }))
    expect(v.first).toMatch(/^NO-RESULT \(status 204\)/)
    expect(v.all).not.toMatch(/logo\.png:/)
    expect(v.code).toBe(3)
  })
  test('B2: a binary plus a covered clean text file gets the text file answer (PASS)', () => {
    const v = verdict(repo('b2', { 'assets/logo.png': PNG, 'src/more.js': 'export const b = 2\n' }))
    expect(v.first).toMatch(/^PASS/)
    expect(v.code).toBe(0)
  })
  test('B3: a binary plus a covered file with a finding is FAIL on the text file only', () => {
    const v = verdict(repo('b3', { 'assets/logo.png': PNG, 'src/leak.js': 'const awsKey = "AKIAIOSFODNN7EXAMPLE"\n' }))
    expect(v.first).toMatch(/^FAIL/)
    expect(v.all).not.toMatch(/logo\.png:/)
    expect(v.code).toBe(1)
  })
})
