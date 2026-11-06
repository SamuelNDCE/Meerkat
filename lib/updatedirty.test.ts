import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { applyUpdate, maybeAutoUpdate, updateNotice } from './update.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { writeUserConfig } from './userconfig.mjs'

// Real git, in a throwaway folder: an origin with a newer commit, and a clone that is behind it and has local changes.
const root = mkdtempSync(join(tmpdir(), 'meerkat-dirty-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
let n = 0
function setup() {
  const dir = join(root, `c${n++}`)
  const origin = join(dir, 'origin')
  const clone = join(dir, 'clone')
  mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-q', '-b', 'main')
  writeFileSync(join(origin, 'a.txt'), 'a1\n')
  writeFileSync(join(origin, 'b.txt'), 'b1\n')
  writeFileSync(join(origin, 'package.json'), '{"version":"0.4.0"}\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'first')
  git(dir, 'clone', '-q', origin, clone)
  writeFileSync(join(origin, 'b.txt'), 'b2\n')
  writeFileSync(join(origin, 'package.json'), '{"version":"0.5.0"}\n')
  git(origin, 'commit', '-q', '-am', 'second')
  git(clone, 'fetch', '-q', 'origin')
  return clone
}

describe('updating a folder that has local changes', () => {
  test('changes to files the update does not touch stay exactly as they are and the update proceeds', () => {
    const clone = setup()
    writeFileSync(join(clone, 'a.txt'), 'my edit\n')
    const r = applyUpdate({ repoDir: clone, logDir: join(root, 'logs') })
    expect(r).toMatchObject({ ok: true, from: '0.4.0', to: '0.5.0' })
    expect(readFileSync(join(clone, 'a.txt'), 'utf8')).toBe('my edit\n')
    expect(readFileSync(join(clone, 'b.txt'), 'utf8').trim()).toBe('b2')
  })

  test('a changed file the update also changes is refused, named alone, and left untouched', () => {
    const clone = setup()
    writeFileSync(join(clone, 'a.txt'), 'my edit\n')
    writeFileSync(join(clone, 'b.txt'), 'my other edit\n')
    const r = applyUpdate({ repoDir: clone, logDir: join(root, 'logs') }) as { ok: boolean; reason: string; files: string[] }
    expect(r.ok).toBe(false)
    expect(r.files).toEqual(['b.txt'])
    expect(r.reason).toContain('  b.txt')
    expect(r.reason).not.toContain('a.txt')
    expect(r.reason).toMatch(/diff/)
    expect(r.reason).toMatch(/commit/)
    expect(r.reason).toMatch(/stash/)
    expect(readFileSync(join(clone, 'b.txt'), 'utf8')).toBe('my other edit\n')
    expect(git(clone, 'stash', 'list')).toBe('')
  })
})

describe('the update notice with a dirty folder', () => {
  const env = { MEERKAT_USER_CONFIG: join(root, 'cfg.json') }
  beforeEach(() => writeUserConfig({ updates: 'auto', lastUpdateCheck: null, updateCache: null }, env))

  test('a refused update still leaves the notice showing', () => {
    const clone = setup()
    writeFileSync(join(clone, 'b.txt'), 'my edit\n')
    const printed: string[] = []
    const r = maybeAutoUpdate({ repoDir: clone, env, now: Date.now(), print: (l: string) => printed.push(l) })
    expect(r.applied).toMatchObject({ ok: false })
    expect(updateNotice({ current: '0.4.0', env })).toMatchObject({ latest: '0.5.0', current: '0.4.0' })
  })

  test('notify mode shows the notice for a dirty folder too', () => {
    const clone = setup()
    writeUserConfig({ updates: 'notify' }, env)
    writeFileSync(join(clone, 'a.txt'), 'my edit\n')
    maybeAutoUpdate({ repoDir: clone, env, now: Date.now(), print: () => {} })
    expect(updateNotice({ current: '0.4.0', env })?.latest).toBe('0.5.0')
  })
})
