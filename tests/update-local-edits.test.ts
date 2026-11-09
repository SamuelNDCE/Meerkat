import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { applyUpdate, runUpdateCommand, verifyInCopy } from '../lib/update.mjs'

// Scenario test for the smart update when the user has edited Meerkat's own files. No network: two local git repos stand in for
// upstream (an origin) and the user's install (a clone of it). The files are Meerkat's own tracked files, so the self-test that
// the update runs in its temporary copy is the real one.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-localedits-'))
const logDir = join(root, 'logs')
const savedLogEnv = process.env.MEERKAT_LOG_DIR
afterAll(() => {
  if (savedLogEnv === undefined) delete process.env.MEERKAT_LOG_DIR
  else process.env.MEERKAT_LOG_DIR = savedLogEnv
  rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8')
const write = (dir: string, f: string, text: string) => {
  mkdirSync(dirname(join(dir, f)), { recursive: true })
  writeFileSync(join(dir, f), text)
}

// A fingerprint of everything a user could lose: HEAD, git status, and the bytes of every tracked file plus every untracked one.
function fingerprint(dir: string) {
  const files = git(dir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean).sort()
  const h = createHash('sha256')
  h.update(git(dir, 'rev-parse', 'HEAD'))
  h.update(git(dir, 'status', '--porcelain'))
  for (const f of files) {
    h.update(f)
    if (existsSync(join(dir, f))) h.update(readFileSync(join(dir, f)))
  }
  return h.digest('hex')
}

let base = '' // origin at v1
beforeAll(() => {
  base = join(root, 'base')
  // The committed files of this checkout, byte for byte (LF, no autocrlf), as upstream v1.
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '-q', '--no-hardlinks', REPO, base])
  git(base, 'remote', 'remove', 'origin')
  git(base, 'branch', '-m', 'main')
}, 120000)

let n = 0
function scenario(upstream: (origin: string) => void, autocrlf = 'false') {
  const dir = join(root, `s${n++}`)
  const origin = join(dir, 'origin')
  const clone = join(dir, 'clone')
  cpSync(base, origin, { recursive: true })
  git(dir, 'clone', '-q', '-c', `core.autocrlf=${autocrlf}`, '-c', `core.eol=${autocrlf === 'true' ? 'crlf' : 'lf'}`, origin, clone)
  upstream(origin)
  git(origin, 'add', '-A')
  git(origin, 'commit', '-q', '-m', 'v2')
  git(clone, 'fetch', '-q', 'origin')
  return { origin, clone }
}
const pkgVersion = (dir: string) => JSON.parse(read(dir, 'package.json')).version
const bump = (origin: string) => write(origin, 'package.json', read(origin, 'package.json').replace(/"version": "[^"]+"/, '"version": "9.9.9"'))

// Upstream v2: a file only upstream changed, a new file, a fix to a file the user never touches, and a change at the top of README.md.
function upstreamV2(origin: string) {
  bump(origin)
  appendFileSync(join(origin, 'llms.txt'), '\nUPSTREAM-ONLY-CHANGE\n')
  write(origin, 'docs/new-feature-from-upstream.md', 'a brand new file\n')
  write(origin, 'CONTRIBUTING.md', read(origin, 'CONTRIBUTING.md').replace('# Contributing to Meerkat', '# Contributing to Meerkat (fixed upstream)'))
  write(origin, 'README.md', read(origin, 'README.md').replace('# Meerkat', '# Meerkat UPSTREAM-TOP'))
}

const USER_BOTTOM = '\nUSER-EDIT-AT-THE-BOTTOM\n'
// Appends a line using the line ending the file already has (a Windows checkout holds CRLF).
const appendLine = (dir: string, f: string, line: string) => {
  const eol = read(dir, f).includes('\r\n') ? '\r\n' : '\n'
  appendFileSync(join(dir, f), `${eol}${line}${eol}`)
}
const userEditsThatDoNotConflict = (clone: string) => {
  appendLine(clone, 'README.md', 'USER-EDIT-AT-THE-BOTTOM') // a file upstream also changed, a different place
  appendLine(clone, 'LICENSE', 'USER-EDIT-IN-LICENSE') // a file upstream did not touch
}

describe('smart update with the user having edited Meerkat files', () => {
  test.each(['false', 'true'])('1+2: clean update keeps every user edit, brings every upstream change, and the self-test passes (core.autocrlf=%s)', (autocrlf) => {
    const { clone } = scenario(upstreamV2, autocrlf)
    userEditsThatDoNotConflict(clone)
    const r = applyUpdate({ repoDir: clone, logDir, verify: verifyInCopy }) as Record<string, any>
    expect(r.ok, r.reason).toBe(true)
    expect(r.to).toBe('9.9.9')
    expect(r.kept).toBe(2)
    expect(existsSync(r.patch)).toBe(true)
    // user edits survive, including the one in a file upstream changed too
    expect(read(clone, 'README.md')).toContain('USER-EDIT-AT-THE-BOTTOM')
    expect(read(clone, 'LICENSE')).toContain('USER-EDIT-IN-LICENSE')
    // upstream changes arrived, including the one in that same README
    expect(read(clone, 'README.md')).toContain('# Meerkat UPSTREAM-TOP')
    expect(read(clone, 'llms.txt')).toContain('UPSTREAM-ONLY-CHANGE')
    expect(read(clone, 'CONTRIBUTING.md')).toContain('(fixed upstream)')
    expect(read(clone, 'docs/new-feature-from-upstream.md')).toMatch(/^a brand new file\r?\n$/)
    expect(pkgVersion(clone)).toBe('9.9.9')
    // the user's edits are still uncommitted work on top of the new HEAD
    expect(git(clone, 'status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3)).sort()).toEqual(['LICENSE', 'README.md'])
    // and the updated install still works
    const out = execFileSync(process.execPath, ['bin/meerkat.mjs', 'self-test'], { cwd: clone, encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: join(root, 'selftest-logs') }, timeout: 300000 })
    expect(out).toMatch(/0 failed/)
  }, 240000)

  test('3: a real conflict refuses, overwrites nothing, saves the work as a patch that applies, and names the file and the patch', () => {
    const { clone } = scenario((origin) => {
      upstreamV2(origin)
      write(origin, 'SECURITY.md', read(origin, 'SECURITY.md').replace('# Security policy', '# Security policy (upstream wording)'))
    })
    userEditsThatDoNotConflict(clone)
    write(clone, 'SECURITY.md', read(clone, 'SECURITY.md').replace('# Security policy', '# Security policy (my wording)'))
    const before = fingerprint(clone)
    const mine = { readme: read(clone, 'README.md'), security: read(clone, 'SECURITY.md'), license: read(clone, 'LICENSE') }
    const r = applyUpdate({ repoDir: clone, logDir, verify: verifyInCopy }) as Record<string, any>
    expect(r.ok).toBe(false)
    expect(r.files).toEqual(['SECURITY.md'])
    expect(r.reason).toContain('SECURITY.md')
    expect(r.reason).not.toContain('README.md')
    expect(r.patch).toBeTruthy()
    expect(r.reason).toContain(r.patch)
    // nothing overwritten
    expect(fingerprint(clone)).toBe(before)
    expect(read(clone, 'README.md')).toBe(mine.readme)
    expect(read(clone, 'SECURITY.md')).toBe(mine.security)
    // the patch rebuilds the user's work on a fresh copy of what they had
    const fresh = join(root, `fresh${n++}`)
    git(root, 'clone', '-q', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', clone, fresh)
    git(fresh, 'apply', '--check', r.patch)
    git(fresh, 'apply', r.patch)
    expect(read(fresh, 'SECURITY.md')).toBe(mine.security)
    expect(read(fresh, 'README.md')).toBe(mine.readme)
    expect(read(fresh, 'LICENSE')).toBe(mine.license)
  }, 240000)

  test('3b: the same conflict through the command prints the file and the patch path', async () => {
    const { clone } = scenario((origin) => {
      upstreamV2(origin)
      write(origin, 'SECURITY.md', read(origin, 'SECURITY.md').replace('# Security policy', '# Security policy (upstream wording)'))
    })
    write(clone, 'SECURITY.md', read(clone, 'SECURITY.md').replace('# Security policy', '# Security policy (my wording)'))
    process.env.MEERKAT_LOG_DIR = logDir
    const lines: string[] = []
    const code = await runUpdateCommand({ action: 'update', yes: true }, { repoDir: clone, releaseCheck: async () => ({ ok: true }), env: { ...process.env, MEERKAT_USER_CONFIG: join(root, 'cfg.json') }, stdout: { write: (t: string) => lines.push(t) } as any })
    const text = lines.join('')
    expect(code).toBe(1)
    expect(text).toContain('SECURITY.md')
    expect(text).toMatch(/saved in: .*\.patch/)
  }, 240000)

  test('4: an update that fails verification leaves the folder untouched', () => {
    const { clone } = scenario((origin) => {
      upstreamV2(origin)
      const bin = read(origin, 'bin/meerkat.mjs')
      write(origin, 'bin/meerkat.mjs', bin.replace('#!/usr/bin/env node\n', "#!/usr/bin/env node\nif (process.argv[2] === 'self-test') { console.error('self-test: broken on purpose'); process.exit(1) }\n"))
    })
    userEditsThatDoNotConflict(clone)
    const before = fingerprint(clone)
    const r = applyUpdate({ repoDir: clone, logDir, verify: verifyInCopy }) as Record<string, any>
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('self-test')
    expect(r.reason).toContain('your folder was not changed')
    expect(fingerprint(clone)).toBe(before)
    expect(existsSync(r.patch)).toBe(true)
  }, 240000)

  test('5: running the update twice changes nothing the second time', async () => {
    const { clone } = scenario(upstreamV2)
    userEditsThatDoNotConflict(clone)
    const first = applyUpdate({ repoDir: clone, logDir, verify: verifyInCopy }) as Record<string, any>
    expect(first.ok, first.reason).toBe(true)
    const after = fingerprint(clone)
    const second = applyUpdate({ repoDir: clone, logDir, verify: verifyInCopy }) as Record<string, any>
    expect(second.ok, second.reason).toBe(true)
    expect(fingerprint(clone)).toBe(after)
    process.env.MEERKAT_LOG_DIR = logDir
    const lines: string[] = []
    const code = await runUpdateCommand({ action: 'update', yes: true }, { repoDir: clone, releaseCheck: async () => ({ ok: true }), env: { ...process.env, MEERKAT_USER_CONFIG: join(root, 'cfg2.json') }, stdout: { write: (t: string) => lines.push(t) } as any })
    expect(code).toBe(0)
    expect(lines.join('')).toContain('up to date')
    expect(fingerprint(clone)).toBe(after)
  }, 240000)
})
