// When the log folder cannot be written, logs go to <OS temp>/meerkat-logs and the output names that folder (docs/issues.md 13).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { gateMain } from '../lib/gate.mjs'
import { fallbackLogRoot, logRoot } from '../lib/runlog.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-logfb-'))
const fakeTemp = join(root, 'temp')
const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
beforeAll(() => {
  mkdirSync(fakeTemp, { recursive: true })
  for (const k of Object.keys(saved)) process.env[k] = fakeTemp // os.tmpdir() reads these on every call
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
const BS = String.fromCharCode(92)
const fwd = (t: string) => t.split(BS).join('/')
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
// A log folder that cannot exist: a file sits where its parent should be.
const missing = () => {
  const blocker = join(root, 'a-file')
  writeFileSync(blocker, 'x')
  return join(blocker, 'logs')
}

describe('log folder fallback', () => {
  test('an unwritable folder falls back to <temp>/meerkat-logs; a writable one is kept', () => {
    // The fallback is per user (a hash of the home folder), so compare with fallbackLogRoot() and check its shape.
    expect(logRoot({ MEERKAT_LOG_DIR: missing() } as NodeJS.ProcessEnv)).toBe(fallbackLogRoot())
    expect(fallbackLogRoot()).toMatch(/meerkat-logs-/)
    const ok = join(root, 'fine', 'logs')
    expect(logRoot({ MEERKAT_LOG_DIR: ok } as NodeJS.ProcessEnv)).toBe(resolve(ok))
  })
  test('a gate run is recorded in the fallback folder and a note names both folders', async () => {
    const d = join(root, 'repo')
    mkdirSync(join(d, 'src'), { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    writeFileSync(join(d, 'meerkat.config.json'), JSON.stringify({ disable: ['unused-files'], discover: false }))
    writeFileSync(join(d, 'src/a.js'), 'export const a = 1\n')
    git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'clean')
    writeFileSync(join(d, 'src/a.js'), 'export const a = 2\n')
    const bad = missing()
    const out: string[] = []
    const errs: string[] = []
    await gateMain([], { cwd: d, log: (l: string) => out.push(l), err: (l: string) => errs.push(l), env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: bad } })
    const fallback = fwd(fallbackLogRoot())
    const all = fwd([...out, ...errs].join('\n'))
    expect(all).toContain(fallback)
    expect(all).toMatch(/not writable/)
    expect(all).toContain(fwd(bad))
    expect(existsSync(join(fallbackLogRoot(), 'runs'))).toBe(true)
    expect(out.join('\n')).not.toMatch(/^NOT RECORDED/m)
  }, 120000)
})
