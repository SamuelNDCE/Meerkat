import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { acceptedSets, allDismissals, applyAccepted, dismissalDoc, parseExpiry, saveAccepted, saveRepoDismissals, withDismissal } from './accepted.mjs'
// @ts-expect-error plain .mjs module
import { runExtra } from './extras-cli.mjs'
// @ts-expect-error plain .mjs module
import { buildFindings } from './findingsdoc.mjs'

const tmp = mkdtempSync(join(tmpdir(), 'meerkat-054b-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const emptyGlobal = join(tmp, 'global.gitconfig')
writeFileSync(emptyGlobal, '')
const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1', MEERKAT_LOG_DIR: join(tmp, 'logs') }
const repo = (name: string) => {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', dir], { env })
  return dir
}
const hookFile = (dir: string) => join(dir, '.git', 'hooks', 'pre-push')
const run = (args: string[], dir: string) => {
  const out: string[] = []
  const code = runExtra(args, { env, cwd: dir, out: (t: string) => out.push(t), err: (t: string) => out.push(t) })
  return { code, text: out.join('\n') }
}

describe('hook install --gate and remove', () => {
  test('default installs the whole-repo hook and says how to get the gate one', () => {
    const dir = repo('default')
    const r = run(['hook', 'install', dir], dir)
    expect(r.text).toContain('whole-repo hook')
    expect(r.text).toContain('--gate')
    const text = readFileSync(hookFile(dir), 'utf8')
    expect(text).toContain('--preset quick --ratchet')
    expect(text).not.toContain(' gate --app')
  })
  test('--gate installs a hook that gates the pushed commits against the upstream', () => {
    const dir = repo('gate')
    const r = run(['hook', 'install', '--gate', dir], dir)
    expect(r.text).toContain('GATE hook')
    const text = readFileSync(hookFile(dir), 'utf8')
    expect(text).toContain('gate --app')
    expect(text).toContain('--base "$(git rev-parse --abbrev-ref --symbolic-full-name')
    expect(text).toContain('origin/HEAD')
    expect(text).not.toContain('--ratchet')
  })
  test('install then remove leaves no file when none existed', () => {
    const dir = repo('none')
    run(['hook', 'install', dir], dir)
    expect(existsSync(hookFile(dir))).toBe(true)
    run(['hook', 'remove', dir], dir)
    expect(existsSync(hookFile(dir))).toBe(false)
  })
  test('a pre-existing hook is restored byte for byte, with or without a final newline', () => {
    for (const [name, orig] of [['nl', '#!/bin/sh\necho mine\n'], ['nonl', '#!/bin/sh\necho mine']]) {
      const dir = repo(`pre-${name}`)
      writeFileSync(hookFile(dir), orig)
      run(['hook', 'install', dir], dir)
      expect(readFileSync(hookFile(dir), 'utf8')).toContain('meerkat pre-push')
      run(['hook', 'remove', dir], dir)
      expect(readFileSync(hookFile(dir), 'utf8')).toBe(orig)
    }
  })
})

describe('inline meerkat-ignore in findings', () => {
  const meta = { version: '1', runId: 'r', tier: 'fast', startedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-01T00:00:01.000Z', ms: 1 }
  const checks = [{ id: 'pii-in-logs', group: 'security', tier: 'fast', run: { script: 'x.mjs' } }]
  const build = (files: Record<string, string>, output: string) => {
    const dir = mkdtempSync(join(tmp, 'ign-'))
    for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t)
    const results = [{ id: 'pii-in-logs', status: 'FAIL', ms: 1, detail: 'd', suite: 'privacy', subs: [] }]
    return buildFindings({ results, checks, sink: new Map([['pii-in-logs', { findings: [], output }]]), appDir: dir, meta })
  }
  const out = 'a.js:2 logs "token", with no redaction nearby\n'
  test('without a directive the finding is reported', () => {
    expect(build({ 'a.js': 'x\ny\n' }, out).findings).toHaveLength(1)
  })
  test('same line and next line suppress', () => {
    expect(build({ 'a.js': 'x\ny // meerkat-ignore pii-in-logs test data\n' }, out).findings).toHaveLength(0)
    const next = build({ 'a.js': '// meerkat-ignore pii-in-logs test data\ny\n' }, out)
    expect(next.findings).toHaveLength(0)
    expect(next.inlineIgnoredChecks).toContain('pii-in-logs')
  })
  test('a missing reason is reported and does not suppress', () => {
    const doc = build({ 'a.js': 'x\ny // meerkat-ignore pii-in-logs\n' }, out)
    expect(doc.findings.map((f: { rule: string }) => f.rule)).toContain('ignore-missing-reason')
    expect(doc.findings.some((f: { check: string }) => f.check === 'pii-in-logs')).toBe(true)
  })
  test('a wrong check id does not suppress', () => {
    expect(build({ 'a.js': 'x\ny // meerkat-ignore other-check because\n' }, out).findings).toHaveLength(1)
  })
})

describe('dismissal expiry and the repo file', () => {
  const projectPath = () => repo(`proj-${Math.random().toString(36).slice(2)}`)
  test('parseExpiry takes days or a date and rejects junk', () => {
    expect(parseExpiry('30d', new Date('2026-11-01T00:00:00Z'))).toBe('2026-12-01')
    expect(parseExpiry('2027-01-15')).toBe('2027-01-15')
    expect(() => parseExpiry('soon')).toThrow()
    expect(() => parseExpiry('2027-02-31')).toThrow()
  })
  test('a past expiry stops suppressing and says so when the finding returns', () => {
    const p = projectPath()
    saveAccepted('dismissed', env, p, dismissalDoc(withDismissal([], { id: 'f1', reason: 'old', expires: '2020-01-01' })))
    const sets = acceptedSets({ env, projectPath: p })
    expect(sets.dismissed.has('f1')).toBe(false)
    expect(sets.expired.get('f1')).toBe('2020-01-01')
    const results = [{ id: 'c', status: 'FAIL', detail: 'bad' }]
    applyAccepted(results, new Map(), sets, [{ id: 'f1', check: 'c' }])
    expect(results[0].status).toBe('FAIL')
    expect(results[0].detail).toContain('dismissal expired on 2020-01-01')
  })
  test('a future expiry still suppresses', () => {
    const p = projectPath()
    saveAccepted('dismissed', env, p, dismissalDoc(withDismissal([], { id: 'f2', reason: 'ok', expires: '2999-01-01' })))
    expect(acceptedSets({ env, projectPath: p }).dismissed.has('f2')).toBe(true)
  })
  test('the reader accepts home and repo files, neither wins', () => {
    const p = projectPath()
    saveAccepted('dismissed', env, p, dismissalDoc(withDismissal([], { id: 'h1', reason: 'home' })))
    saveRepoDismissals(p, withDismissal([], { id: 'r1', reason: 'repo' }))
    expect(existsSync(join(p, '.meerkat-dismissed.json'))).toBe(true)
    const sets = acceptedSets({ env, projectPath: p })
    expect([...sets.dismissed.keys()].sort()).toEqual(['h1', 'r1'])
    // the same id expired in home but active in repo stays active
    saveAccepted('dismissed', env, p, dismissalDoc(withDismissal([], { id: 'r1', reason: 'home', expires: '2020-01-01' })))
    expect(acceptedSets({ env, projectPath: p }).dismissed.get('r1')).toBe('repo')
    expect(allDismissals(env, p).find((d: { id: string }) => d.id === 'r1').source).toBe('repo')
  })
  test('meerkat dismissals lists active and expired with reason, expiry and source', () => {
    const p = projectPath()
    saveAccepted('dismissed', env, p, dismissalDoc(withDismissal([], { id: 'e1', reason: 'stale thing', expires: '2020-01-01' })))
    saveRepoDismissals(p, withDismissal([], { id: 'a1', reason: 'shared thing', expires: '2999-01-01' }))
    const r = run(['dismissals', p], p)
    expect(r.text).toMatch(/EXPIRED\s+e1.*stale thing.*expired on 2020-01-01.*\[home\]/)
    expect(r.text).toMatch(/ACTIVE\s+a1.*shared thing.*expires 2999-01-01.*\[repo\]/)
  })
})
