// The compatibility matrix, fast version: every check runs through the real runner on a few small clean projects (tools/compat-fixtures.mjs).
// A check must not crash, hang or fail on a clean project, and must say "not applicable" (a PASS) when it has nothing to look at.
// The whole matrix, with every project type, is `node tools/compat-matrix.mjs`; see docs/compatibility.md.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { analyse, allCheckIds, runMatrix } from '../tools/compat-matrix.mjs'
import { makeFixtures } from '../tools/compat-fixtures.mjs'
import { notApplicable } from './applies.mjs'

const FAST = ['node-cli', 'python-lib', 'static-site', 'empty-git-repo', 'not-a-git-folder', 'electron-app']
let work = ''

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'meerkat-compat-test-'))
})
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('check ids', () => {
  test('are unique across every pack', async () => {
    const defs = await allCheckIds()
    const seen = new Map<string, string>()
    for (const d of defs) {
      expect(seen.has(d.id), `${d.id} is in both ${seen.get(d.id)} and ${d.pack}`).toBe(false)
      seen.set(d.id, d.pack)
    }
    expect(defs.some((d) => d.id.startsWith('bad-check-file'))).toBe(false)
  })
})

describe('the fast compatibility matrix', () => {
  for (const name of FAST) {
    test(
      `${name}: no crash, no hang, no false fail`,
      async () => {
        const res = await runMatrix({ names: [name], dir: join(work, 'projects'), work: join(work, `aux-${name}`), timeoutSeconds: 60, overallSeconds: 55 })
        const a = analyse(res)
        expect(res.rows.length, 'the run produced results').toBeGreaterThan(100)
        expect(a.crashes.map((r: { id: string; crash: string; reason: string }) => `${r.id}: ${r.crash}: ${r.reason}`)).toEqual([])
        expect(a.falseFails.map((r: { id: string; reason: string }) => `${r.id}: ${r.reason}`)).toEqual([])
        expect(a.badNotRun.map((r: { id: string; reason: string }) => `${r.id}: ${r.reason}`)).toEqual([])
      },
      60_000,
    )
  }
})

describe('not applicable', () => {
  const ctxFor = (dir: string) => ({ repoRoot: dir, appDir: dir })
  test('a check about files the folder does not have passes with a note, one that has them runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-applies-'))
    try {
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'main.go'), 'package main\n')
      const check = (globs: string[]) => ({ appliesTo: globs, run: { cmd: 'x', cwd: 'repo' } })
      expect(notApplicable(check(['**/*.go']), ctxFor(dir))).toBeNull()
      expect(notApplicable(check(['**/*.rs']), ctxFor(dir))).toMatch(/^not applicable/)
      expect(notApplicable({ run: { cmd: 'x', cwd: 'repo' } }, ctxFor(dir))).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a Go check passes on a project with no Go files, even with the tool missing', async () => {
    const made = makeFixtures(join(work, 'na'), ['node-cli'])
    const { loadChecks } = await import('./load-checks.mjs')
    const { runOne } = await import('./runner.mjs')
    const { MEERKAT_DIR } = await import('./paths.mjs')
    const checks = await loadChecks(join(MEERKAT_DIR, 'packs', 'go'))
    for (const c of checks) {
      const r = await runOne(c, { repoRoot: made['node-cli'], appDir: made['node-cli'], env: { ...process.env, PATH: '' }, platform: process.platform, exists: () => false })
      expect(r.status, c.id).toBe('PASS')
      expect(r.detail, c.id).toMatch(/not applicable/)
    }
  })
})
