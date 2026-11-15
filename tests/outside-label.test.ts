// A failed check whose places are all in files the change did not touch is labelled "outside the change (not blocking)" on stderr,
// not "base side" or "change side"; a failure inside the change keeps its normal label.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'meerkat-outside-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1', MEERKAT_GATE_HEARTBEAT_MS: '300' } as NodeJS.ProcessEnv
let repo = ''
beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  const mk = (id: string, file: string) => ({ id, title: id, cmd: 'node', args: ['complain.js', file], tier: 'fast', group: 'functionality', cwd: '.', timeoutSeconds: 60 })
  writeFileSync(join(repo, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [mk('far-away', 'old.js'), mk('in-change', 'ok.js')] }))
  writeFileSync(join(repo, 'complain.js'), 'console.log(process.argv[2] + ":1: something is wrong")\nprocess.exit(1)\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  writeFileSync(join(repo, 'old.js'), 'export const old = 1\n')
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  writeFileSync(join(repo, 'ok.js'), 'export const ok = (a) => a + 2\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change')
}, 60_000)

describe('outside-the-change label', () => {
  test('a failure only in an unchanged file says outside the change, not a side', () => {
    const r = spawnSync(process.execPath, [bin, 'verdict', '--base', 'main', '--no-input', '--only-checks', 'far-away'], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 })
    const err = String(r.stderr)
    const line = err.split(/\r?\n/).find((l) => /far-away \.\.\. /.test(l) && /\[done/.test(l))
    expect(line, err).toBeTruthy()
    expect(line).toMatch(/outside the change \(not blocking\)/)
    expect(err).not.toMatch(/change side|base side/)
  }, 130_000)
  test('a failure in a changed file keeps its normal label', () => {
    const r = spawnSync(process.execPath, [bin, 'verdict', '--base', 'main', '--no-input', '--only-checks', 'in-change'], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 })
    const err = String(r.stderr)
    const line = err.split(/\r?\n/).find((l) => /in-change \.\.\. /.test(l) && /\[done/.test(l))
    expect(line, err).toBeTruthy()
    expect(line).not.toMatch(/outside the change/)
  }, 130_000)
})
