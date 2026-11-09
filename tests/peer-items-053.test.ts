// 0.5.3 peer items: per-check rows, the verdict summary file, and the stale-base refusal helper.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { checkRows, writeVerdictSummary } from '../lib/verdict-extra.mjs'
import { commitsBehind } from '../lib/branchcmds.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'meerkat-peer-')); made.push(d); return d }
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim()

describe('checkRows', () => {
  test('one row per check with status, seconds and places', () => {
    const rows = checkRows({ rows: [{ id: 'cp-js', kind: 'fail', ms: 1500, places: [{ file: 'a.js', line: 3 }] }, { id: 'x', kind: 'pass', ms: 0 }] })
    expect(rows[0]).toEqual({ check: 'cp-js', status: 'fail', seconds: 1.5, cached: false, places: [{ file: 'a.js', line: 3 }] })
    expect(rows[1].places).toEqual([])
  })
})

describe('writeVerdictSummary', () => {
  test('writes the summary at a fixed path per repo and branch', () => {
    const dir = tmp()
    const file = writeVerdictSummary(dir, 'my repo', 'feat/x', { verdict: 'PASS', exitCode: 0 })
    expect(file).not.toBeNull()
    expect(file!.replace(/\\/g, '/')).toContain('/verdicts/my_repo-feat_x.json')
    expect(JSON.parse(readFileSync(file!, 'utf8'))).toEqual({ verdict: 'PASS', exitCode: 0 })
  })
})

describe('commitsBehind', () => {
  test('counts commits the base has that the branch does not, and null for an unknown ref', () => {
    const repo = tmp()
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one')
    git(repo, 'checkout', '-q', '-b', 'feat')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'f.txt'), 'x')
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-q', '-m', 'two')
    git(repo, 'checkout', '-q', 'feat')
    expect(commitsBehind(repo, 'main')).toBe(1)
    expect(commitsBehind(repo, 'no-such-ref')).toBeNull()
  })
})
