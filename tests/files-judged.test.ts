// The verdict says which files it read: filesJudged, filesNoCheck, "judged N changed file(s)" before "Next:", and zero files is NO_RESULT, not a pass.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runVerdict } from '../lib/branchcmds.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-fjudged-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
// One pack, and the three checks that read Markdown switched off, so a .md file is covered by no check's path rule.
const CONFIG = JSON.stringify({ packs: ['security-plus'], disable: ['local-links', 'markdown-anchors', 'links', 'unused-files'], discover: false })
const repo = (name: string) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'meerkat.config.json', CONFIG)
  put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(d, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  return d
}
const run = async (argv: string[], where: string) => {
  const lines: string[] = []
  const code = await runVerdict(argv, { env, cwd: where, memory: false, out: (t: string) => lines.push(t), err: () => {} })
  return { code, lines }
}
const json = async (argv: string[], where: string) => {
  const r = await run([...argv, '--json'], where)
  return { code: r.code, doc: JSON.parse(r.lines.join('\n')) }
}

let two: string
let none: string
let staged: string

beforeAll(() => {
  two = repo('two')
  git(two, 'checkout', '-q', '-b', 'feat')
  put(two, 'src/b.js', 'export const b = (a) => a * 2\n')
  put(two, 'NOTES.md', '# notes\n')
  git(two, 'add', '-A')
  git(two, 'commit', '-q', '-m', 'two files')

  none = repo('none')
  git(none, 'checkout', '-q', '-b', 'feat')

  staged = repo('staged')
  git(staged, 'checkout', '-q', '-b', 'feat')
  put(staged, 'src/s.js', bug('s'))
  git(staged, 'add', 'src/s.js')
  put(staged, 'src/s.js', 'export const s = (a) => a\n') // the saved copy is clean; the staged copy has the finding
})

describe('(a) two changed files', () => {
  test('the text says judged 2 before Next, and the JSON counts 2', async () => {
    const t = await run(['--base', 'main'], two)
    expect(t.code).toBe(0)
    expect(t.lines[0]).toMatch(/^PASS \(status 200\): nothing new blocks.* judged 2 changed file\(s\)(; \d+ matched no check)?\. Next: nothing to fix$/)
    expect(t.lines[0].indexOf('judged 2')).toBeLessThan(t.lines[0].indexOf('Next:'))
    const j = await json(['--base', 'main'], two)
    expect(j.doc.filesJudged.count).toBe(2)
    expect(j.doc.filesJudged.files).toEqual(['NOTES.md', 'src/b.js'])
    expect(j.doc.headline).toBe(t.lines[0])
  })
})

describe('(b) a changed file no check covers', () => {
  test('NOTES.md is in filesNoCheck and the text says matched no check', async () => {
    const t = await run(['--base', 'main'], two)
    expect(t.lines[0]).toMatch(/matched no check\. Next:/)
    const j = await json(['--base', 'main'], two)
    expect(j.doc.filesNoCheck.files).toContain('NOTES.md')
    expect(j.doc.filesNoCheck.files).not.toContain('src/b.js')
    expect(j.doc.filesNoCheck.count).toBe(j.doc.filesNoCheck.files.length)
    const md = await run(['--base', 'main', '--format', 'markdown'], two)
    expect(md.lines.join('\n')).toMatch(/judged 2 changed file\(s\)/)
    expect(md.lines.join('\n')).toMatch(/matched no check/)
  })
})

describe('(c) no changed files', () => {
  test('exit 3, status 204, and the line says it is not a pass', async () => {
    const t = await run(['--base', 'main'], none)
    expect(t.code).toBe(3)
    expect(t.lines[0]).toMatch(/^NO-RESULT \(status 204\): judged 0 changed files: nothing to judge \(not a pass\)\. Next:/)
    const j = await json(['--base', 'main'], none)
    expect(j.code).toBe(3)
    expect(j.doc.status).toBe(204)
    expect(j.doc.exitName).toBe('NO_RESULT')
    expect(j.doc.filesJudged).toEqual({ count: 0, files: [] })
    expect(j.doc.filesNoCheck).toEqual({ count: 0, files: [] })
  })
})

describe('(d) staged files', () => {
  test('a staged file with a finding and a clean saved copy is reported as blocking', async () => {
    const r = await json(['--staged'], staged)
    expect(r.code).toBe(1)
    expect(r.doc.blocking).toBeGreaterThan(0)
    expect(r.doc.filesJudged.files).toEqual(['src/s.js'])
    expect(r.doc.blocks.some((b: { file: string }) => b.file === 'src/s.js')).toBe(true)
  })
})
