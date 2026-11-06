import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { applyAccepted } from './accepted.mjs'
// @ts-expect-error plain .mjs module
import { buildFindings } from './findingsdoc.mjs'
// @ts-expect-error plain .mjs module
import { githubAnnotations, installHook, prComment, prePushBlock, removeHook } from './ci-output.mjs'
// @ts-expect-error plain .mjs module
import { suggestionsFor, suggestionsMarkdown } from './suggest.mjs'
// @ts-expect-error plain .mjs module
import { trendRows, trendText } from './trend.mjs'

describe('suggest', () => {
  const raw = 'Crate:     zstd-safe\nVersion:   7.3.0\nTitle: x\nID: RUSTSEC-2026-0001\nSolution: Upgrade to >=7.4.0\n'
  test('cargo-audit parsing', () => {
    const s = suggestionsFor({ check: 'cargo-audit', rawOutput: raw })
    expect(s).toHaveLength(1)
    expect(s[0].command).toBe('cargo update -p zstd-safe')
    expect(s[0].why).toContain('>=7.4.0')
  })
  test('fix hint fallback and markdown', () => {
    expect(suggestionsFor({ fix: 'npm audit fix' })[0].command).toBe('npm audit fix')
    expect(suggestionsFor({})).toEqual([])
    expect(suggestionsMarkdown({ findings: [{ title: 'T', file: 'a.js', line: 2, fix: 'x' }] })).toContain('Meerkat never runs these')
  })
})

describe('trend', () => {
  const history = {
    runs: [
      { runId: 'a', kind: 'fast', at: '1', ids: ['1', '2'], items: [{ id: '1', severity: 'high' }, { id: '2', severity: 'low' }] },
      { runId: 'b', kind: 'fast', at: '2', ids: ['2', '3'], items: [{ id: '2', severity: 'low' }, { id: '3', severity: 'low' }] },
    ],
  }
  test('fixedCount and newCount', () => {
    const rows = trendRows(history, { limit: 20 })
    expect(rows[0].runId).toBe('b')
    expect(rows[0].fixedCount).toBe(1)
    expect(rows[0].newCount).toBe(1)
    expect(rows[0].low).toBe(2)
    expect(trendText(rows).split('\n')).toHaveLength(2)
    expect(trendText([])).toContain('No history')
  })
})

describe('ci-output', () => {
  test('annotation escaping', () => {
    const [l] = githubAnnotations({ findings: [{ severity: 'high', file: 'a,b.js', line: 0, rule: 'r:1', message: '100% bad\nline2' }] })
    expect(l).toBe('::error file=a%2Cb.js,line=1,title=r%3A1::100%25 bad%0Aline2')
    expect(githubAnnotations({ findings: [{ severity: 'low', file: 'a', status: 'accepted', message: 'm' }] })).toEqual([])
  })
  test('prComment', () => {
    expect(prComment({ findings: [] })).toContain('found nothing new')
    expect(prComment({ findings: [{ severity: 'low', file: 'a', line: 1, message: 'm', rule: 'r' }] })).toContain('1 finding(s)')
  })
  test('install then remove leaves original', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-hook-'))
    const f = join(dir, 'pre-push')
    try {
      const orig = '#!/bin/sh\necho mine\n'
      writeFileSync(f, orig)
      expect(installHook(f, prePushBlock('meerkat run')).ok).toBe(true)
      expect(readFileSync(f, 'utf8')).toContain('meerkat run')
      expect(installHook(f, prePushBlock('meerkat run --x')).detail).toBe('replaced')
      expect(removeHook(f).ok).toBe(true)
      expect(readFileSync(f, 'utf8')).toBe(orig)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(existsSync(f)).toBe(false)
  })
})

describe('applyAccepted uses the ids findings.json lists', () => {
  const meta = { version: '1', runId: 'r', tier: 'fast', startedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-01T00:00:01.000Z', ms: 1 }
  const checks = [{ id: 'pii-in-logs', group: 'security', tier: 'fast', run: { script: 'x.mjs' } }]
  const make = () => ({ results: [{ id: 'pii-in-logs', status: 'FAIL', ms: 1, detail: 'd', suite: 'privacy', subs: [] }], sink: new Map([['pii-in-logs', { findings: [], output: 'index.js:2 logs "token", with no redaction nearby\n' }]]) })
  test('a finding read from check output is dismissed by its listed id', () => {
    const { results, sink } = make()
    const dir = mkdtempSync(join(tmpdir(), 'mk-acc-'))
    try {
      writeFileSync(join(dir, 'index.js'), 'x\ny\n')
      const doc = buildFindings({ results, checks, sink, appDir: dir, meta })
      expect(doc.findings).toHaveLength(1)
      const sets = { dismissed: new Map([[doc.findings[0].id, 'fixture']]), baseline: new Set() }
      const out = applyAccepted(results, sink, sets, doc.findings)
      expect(out).toHaveLength(1)
      expect(results[0].status).toBe('PASS')
      expect(buildFindings({ results, checks, sink, appDir: dir, meta }).findings).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('a check with an open finding stays FAIL', () => {
    const { results, sink } = make()
    const out = applyAccepted(results, sink, { dismissed: new Map(), baseline: new Set() }, [{ id: 'abc', check: 'pii-in-logs' }])
    expect(out).toEqual([])
    expect(results[0].status).toBe('FAIL')
  })
})
