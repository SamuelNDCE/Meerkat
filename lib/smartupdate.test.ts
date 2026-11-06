import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { applyUpdate, defaultExec, smartVerify, updatedText, verifyInCopy } from './update.mjs'

// Real git in throwaway folders. The "app" has a bin/meerkat.mjs whose self-test fails when flag.txt says "bad" or a.txt says "BREAK",
// so a test can make the new version bad, or make a local edit clash with the new version without touching the same file.
const root = mkdtempSync(join(tmpdir(), 'meerkat-smart-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
const BIN = `import { readFileSync } from 'node:fs'
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
if (process.argv[2] === 'self-test' && (read('flag.txt').includes('bad') || read('a.txt').includes('BREAK'))) { console.error('self-test: something is broken'); process.exit(1) }
console.log('ok')
`
let n = 0
function setup(newFlag = 'good\n') {
  const dir = join(root, `c${n++}`)
  const origin = join(dir, 'origin')
  const clone = join(dir, 'clone')
  const logDir = join(dir, 'logs')
  mkdirSync(join(origin, 'bin'), { recursive: true })
  git(origin, 'init', '-q', '-b', 'main')
  writeFileSync(join(origin, 'bin', 'meerkat.mjs'), BIN)
  writeFileSync(join(origin, 'a.txt'), 'a1\n')
  writeFileSync(join(origin, 'b.txt'), 'b1\n')
  writeFileSync(join(origin, 'flag.txt'), 'good\n')
  writeFileSync(join(origin, 'package.json'), '{"version":"0.4.0"}\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'first')
  git(dir, 'clone', '-q', origin, clone)
  writeFileSync(join(origin, 'b.txt'), 'b2\n')
  writeFileSync(join(origin, 'flag.txt'), newFlag)
  writeFileSync(join(origin, 'package.json'), '{"version":"0.5.0"}\n')
  git(origin, 'commit', '-q', '-am', 'second')
  git(clone, 'fetch', '-q', 'origin')
  return { clone, logDir, origin }
}
const update = (s: { clone: string; logDir: string }) => applyUpdate({ repoDir: s.clone, logDir: s.logDir, verify: verifyInCopy }) as Record<string, any>
const head = (dir: string) => git(dir, 'rev-parse', 'HEAD').trim()
const leftovers = (logDir: string) => (existsSync(join(logDir, 'update-verify')) ? readdirSync(join(logDir, 'update-verify')) : [])

describe('smart update', () => {
  test('a clean folder updates, and the temporary copy is removed', () => {
    const s = setup()
    const r = update(s)
    expect(r).toMatchObject({ ok: true, from: '0.4.0', to: '0.5.0' })
    expect(r.kept).toBeUndefined()
    expect(r.patch).toBeUndefined()
    expect(readFileSync(join(s.clone, 'b.txt'), 'utf8').trim()).toBe('b2')
    expect(leftovers(s.logDir)).toEqual([])
    expect(updatedText(r)).toBe('Updated from 0.4.0 to 0.5.0.')
  })

  test('a local edit to a file the update does not touch is kept byte for byte, and a patch of it is saved', () => {
    const s = setup()
    const mine = 'my edit\nsecond line, trailing space \n\n'
    writeFileSync(join(s.clone, 'a.txt'), mine)
    const r = update(s)
    expect(r).toMatchObject({ ok: true, from: '0.4.0', to: '0.5.0', kept: 1 })
    expect(readFileSync(join(s.clone, 'a.txt'), 'utf8')).toBe(mine)
    expect(readFileSync(join(s.clone, 'b.txt'), 'utf8').trim()).toBe('b2')
    expect(git(s.clone, 'status', '--porcelain', '--untracked-files=no')).toContain('M a.txt')
    expect(updatedText(r)).toMatch(/^Updated from 0\.4\.0 to 0\.5\.0\. Your 1 local change was kept\./)
    expect(updatedText(r)).toContain(r.patch)
    expect(leftovers(s.logDir)).toEqual([])
  })

  test('the saved patch exists, is named with the target version, and applies cleanly to the old version', () => {
    const s = setup()
    writeFileSync(join(s.clone, 'a.txt'), 'my edit\n')
    writeFileSync(join(s.clone, 'flag.txt.bak'), 'untracked, not part of the patch\n')
    const before = head(s.clone)
    const r = update(s)
    expect(r.ok).toBe(true)
    expect(existsSync(r.patch)).toBe(true)
    expect(basename(r.patch)).toMatch(/^\d{8}-\d{6}-to-0\.5\.0\.patch$/)
    const fresh = join(root, `fresh${n++}`)
    git(root, 'clone', '-q', s.clone, fresh)
    git(fresh, 'checkout', '-q', '--detach', before)
    git(fresh, 'apply', '--check', r.patch)
    git(fresh, 'apply', r.patch)
    expect(readFileSync(join(fresh, 'a.txt'), 'utf8')).toBe('my edit\n')
  })

  test('an edit to a file the update also changes is refused, the file is named, and nothing changes', () => {
    const s = setup()
    writeFileSync(join(s.clone, 'a.txt'), 'my a\n')
    writeFileSync(join(s.clone, 'b.txt'), 'my b\n')
    const before = head(s.clone)
    const r = update(s)
    expect(r.ok).toBe(false)
    expect(r.files).toEqual(['b.txt'])
    expect(r.reason).toContain('  b.txt')
    expect(r.reason).not.toContain('a.txt')
    expect(head(s.clone)).toBe(before)
    expect(readFileSync(join(s.clone, 'b.txt'), 'utf8')).toBe('my b\n')
    expect(readFileSync(join(s.clone, 'a.txt'), 'utf8')).toBe('my a\n')
    expect(existsSync(join(s.logDir, 'update-patches'))).toBe(false)
    expect(leftovers(s.logDir)).toEqual([])
  })

  test('a new version whose self-test fails leaves the folder unchanged, and the patch is still saved', () => {
    const s = setup('bad\n')
    writeFileSync(join(s.clone, 'a.txt'), 'my edit\n')
    const before = head(s.clone)
    const r = update(s)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/self-test/)
    expect(r.reason).toContain('something is broken')
    expect(r.reason).toMatch(/your folder was not changed/)
    expect(head(s.clone)).toBe(before)
    expect(readFileSync(join(s.clone, 'a.txt'), 'utf8')).toBe('my edit\n')
    expect(readFileSync(join(s.clone, 'flag.txt'), 'utf8')).toBe('good\n')
    expect(readFileSync(join(s.clone, 'b.txt'), 'utf8').trim()).toBe('b1')
    expect(existsSync(r.patch)).toBe(true)
    expect(leftovers(s.logDir)).toEqual([])
  })

  test('the copy carries the local edits: an edit that breaks the new version is caught there, not in the real folder', () => {
    const s = setup()
    writeFileSync(join(s.clone, 'a.txt'), 'BREAK\n')
    const before = head(s.clone)
    const r = update(s)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/self-test/)
    expect(head(s.clone)).toBe(before)
    expect(readFileSync(join(s.clone, 'a.txt'), 'utf8')).toBe('BREAK\n')
  })

  test('a copy that cannot be built stops the update and changes nothing', () => {
    const s = setup()
    const before = head(s.clone)
    const r = applyUpdate({ repoDir: s.clone, logDir: s.logDir, verify: (o: object) => verifyInCopy({ ...o, steps: [{ name: 'x', args: ['no-such-file.mjs'], timeoutMs: 20000 }] }) }) as Record<string, any>
    expect(r.ok).toBe(false)
    expect(head(s.clone)).toBe(before)
  })

  test('smartVerify is the real copy check only with the real git', () => {
    expect(smartVerify(() => '')).toBeNull()
    expect(typeof smartVerify(defaultExec)).toBe('function')
  })
})
