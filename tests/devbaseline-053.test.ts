// Dev-baseline store: keyed by exact base sha, stored once, unknown never stored as pass.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { baseOf, baselineFile, devBaselineFor, readBaseline, writeBaseline } from '../lib/devbaseline.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'meerkat-devbase-')); made.push(d); return d }
const git = (d: string, ...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim()

function repo() {
  const d = tmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'a.txt'), '1')
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'one')
  const first = git(d, 'rev-parse', 'HEAD')
  writeFileSync(join(d, 'a.txt'), '2')
  git(d, 'commit', '-qam', 'two')
  const second = git(d, 'rev-parse', 'HEAD')
  return { d, first, second }
}

describe('devbaseline', () => {
  test('missing file: computed then stored, runChecks not called again', async () => {
    const { d, second } = repo(); const dataDir = tmp()
    let calls = 0
    const runChecks = async (ids: string[]) => { calls++; const r: any = { fails: [{ check: 'lint', file: 'a.js', line: 3 }] }; for (const i of ids) r[i] = i === 'lint' ? 'fail' : 'pass'; return r }
    const a = await devBaselineFor(d, 'HEAD', ['lint', 'types'], { dataDir, runChecks })
    expect(a.source).toBe('computed'); expect(a.sha).toBe(second); expect(a.checks.lint).toBe('fail'); expect(a.fails).toHaveLength(1)
    const b = await devBaselineFor(d, 'HEAD', ['lint', 'types'], { dataDir, runChecks })
    expect(b.source).toBe('stored'); expect(calls).toBe(1)
    // a new id only runs the missing one
    const seen: string[][] = []
    const c = await devBaselineFor(d, 'HEAD', ['lint', 'secrets'], { dataDir, runChecks: async (ids: string[]) => { seen.push(ids); return { secrets: 'pass', fails: [] } } })
    expect(seen).toEqual([['secrets']]); expect(c.source).toBe('computed'); expect(c.fails).toHaveLength(1)
  })

  test('a doc stored under a different sha is ignored and a new sha gets its own file', async () => {
    const { d, first, second } = repo(); const dataDir = tmp()
    const runChecks = async (ids: string[]) => { const r: any = { fails: [] }; for (const i of ids) r[i] = 'pass'; return r }
    await devBaselineFor(d, first, ['lint'], { dataDir, runChecks })
    const r = await devBaselineFor(d, second, ['lint'], { dataDir, runChecks })
    expect(r.source).toBe('computed')
    // copy first's doc to second's file name: baseSha mismatch must be rejected
    const f1 = baselineFile(dataDir, d.split(/[\\/]/).pop(), first)
    const fake = join(dataDir, 'x', `${second}.json`); mkdirSync(join(dataDir, 'x'))
    writeFileSync(fake, JSON.stringify({ schema: 1, baseSha: first, checks: { lint: 'pass' }, fails: [] }))
    expect(readBaseline(fake)).toBeNull()
    expect(readBaseline(f1)?.baseSha).toBe(first)
  })

  test('corrupt or missing file returns null without throwing', () => {
    const dir = tmp(); const f = join(dir, 'abc.json')
    expect(readBaseline(f)).toBeNull()
    writeFileSync(f, '{not json')
    expect(readBaseline(f)).toBeNull()
    writeFileSync(f, JSON.stringify({ schema: 2, baseSha: 'abc', checks: {}, fails: [] }))
    expect(readBaseline(f)).toBeNull()
  })

  test('unknown status is not stored as pass and is reported', async () => {
    const { d } = repo(); const dataDir = tmp()
    const runChecks = async () => ({ lint: 'unknown', types: 'pass', fails: [] })
    const r = await devBaselineFor(d, 'HEAD', ['lint', 'types'], { dataDir, runChecks })
    expect(r.unknownIds).toEqual(['lint']); expect(r.checks.lint).toBe('unknown')
    let again = 0
    const r2 = await devBaselineFor(d, 'HEAD', ['lint', 'types'], { dataDir, runChecks: async (ids: string[]) => { again = ids.length; return { lint: 'pass', fails: [] } } })
    expect(again).toBe(1); expect(r2.unknownIds).toEqual([]); expect(r2.checks.lint).toBe('pass')
  })

  test('atomic write leaves no temp file behind; baseOf handles bad refs', async () => {
    const dir = tmp(); const f = join(dir, 'sub', 'deadbeef.json')
    expect(writeBaseline(f, { schema: 1, baseSha: 'deadbeef', checks: {}, fails: [] })).toBe(true)
    expect(readdirSync(join(dir, 'sub'))).toEqual(['deadbeef.json'])
    expect(existsSync(f)).toBe(true)
    const { d } = repo()
    expect(baseOf(d, 'no-such-ref')).toBeNull()
    expect(baseOf(d, 'HEAD')).toMatch(/^[0-9a-f]{40}$/)
  })
})
