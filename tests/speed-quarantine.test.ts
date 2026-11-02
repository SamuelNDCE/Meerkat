// Window checks found in a project are left out of full and thorough, and come back with release, --include windows or MEERKAT_WINDOWS=1.
// Quarantined quality rules are hidden by default and shown again with MEERKAT_FINDINGS=all; security rules are never quarantined.
import { describe, expect, test } from 'vitest'
import { resolvePreset } from '../lib/presets.mjs'
import { QUARANTINED } from '../lib/quarantine.mjs'
import { applyRollup, isHiddenByDefault, isQuarantined, showAll } from '../lib/rollup.mjs'
import { fingerprint } from '../lib/findings.mjs'
import { selectChecks } from '../lib/runner.mjs'

const mk = (id: string, extra = {}) => ({ id, tier: 'thorough', group: 'functionality', lane: 'free', ...extra })
const checks: any[] = [mk('lint'), mk('found-desktop-electron-test', { found: true, lane: 'windows' }), mk('found-unit', { found: true })]
const ids = (r: any) => r.run.map((c: any) => c.id)
const base = { tier: 'thorough', only: [], mode: 'all', changedFiles: null }

describe('window checks by preset', () => {
  test('full and thorough carry windows: false, the others stay true', () => {
    for (const n of ['full', 'thorough']) expect(resolvePreset(n).preset.windows).toBe(false)
    for (const n of ['release', 'ui', 'ui-fast', 'app', 'app-fast', 'quick']) expect(resolvePreset(n).preset.windows).toBe(true)
    expect(resolvePreset('mine', { mine: { tier: 'fast' } }).preset.windows).toBe(true)
  })
  test('skipped when windows is false, listed apart from the failures', () => {
    const r: any = selectChecks(checks, { ...base, windows: false })
    expect(ids(r)).toEqual(expect.arrayContaining(['lint', 'found-unit']))
    expect(ids(r)).not.toContain('found-desktop-electron-test')
    expect(r.windowSkipped.map((c: any) => c.id)).toEqual(['found-desktop-electron-test'])
  })
  test('selected for release, ui (windows true), --include windows and MEERKAT_WINDOWS=1', () => {
    for (const w of [resolvePreset('release').preset.windows, resolvePreset('ui').preset.windows, true]) {
      expect(ids(selectChecks(checks, { ...base, windows: w }))).toContain('found-desktop-electron-test')
    }
    const r: any = selectChecks(checks, { ...base, include: ['windows'], windows: false })
    expect(ids(r)).toContain('found-desktop-electron-test')
    expect(r.windowSkipped).toEqual([])
  })
})

describe('quarantine', () => {
  const f = (rule: string, severity = 'medium') => ({ rule, check: rule, severity, file: 'a.js', title: rule, message: rule })
  test('a quarantined rule is hidden, a security rule never is', () => {
    expect(isQuarantined(f('empty-catch'))).toBe(true)
    expect(isHiddenByDefault(f('empty-catch'))).toBe(true)
    expect(isHiddenByDefault(f('js-eval'))).toBe(false)
    for (const id of QUARANTINED.keys()) expect(id).not.toMatch(/secret|inject|xss|csrf|auth|crypto|eval|cors|jwt/)
  })
  test('counted in hidden, and shown again with MEERKAT_FINDINGS=all', () => {
    const build = () => new Map<string, any>([['1', f('empty-catch')], ['2', f('js-eval', 'high')]])
    const m = build()
    const r = applyRollup(m, { all: false, fingerprint })
    expect([...m.keys()]).toEqual(['2'])
    expect(r.hidden).toEqual([{ rule: 'empty-catch', count: 1 }])
    expect(showAll({ MEERKAT_FINDINGS: 'all' })).toBe(true)
    const m2 = build()
    applyRollup(m2, { all: showAll({ MEERKAT_FINDINGS: 'all' }), fingerprint })
    expect(m2.size).toBe(2)
  })
})
