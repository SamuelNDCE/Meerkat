// The default view of a scan: size and complexity measures roll up to one finding per rule and file, pedantic style rules are counted and not listed,
// and security rules are never touched. MEERKAT_FINDINGS=all lists everything again.
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module
import { applyRollup, isHiddenByDefault, showAll } from '../lib/rollup.mjs'
// @ts-ignore plain .mjs module
import { fingerprint } from '../lib/findings.mjs'

const f = (rule: string, file: string, line: number, severity = 'info') => ({ id: `${rule}:${file}:${line}`, rule, check: rule, file, line, lines: [line], occurrences: 1, severity, title: `${rule} title`, message: `${rule} at ${line}` })
const map = (list: any[]) => new Map(list.map((x) => [x.id, x]))

describe('rollup', () => {
  test('forty long lines in one file become one finding that counts them', () => {
    const m = map(Array.from({ length: 40 }, (_, i) => f('line-length', 'a.ts', i + 1)))
    const r = applyRollup(m, { all: false, fingerprint })
    expect(m.size).toBe(1)
    const one = [...m.values()][0] as any
    expect(one.occurrences).toBe(40)
    expect(one.message).toContain('40 places')
    expect(r.rolled).toBe(39)
  })
  test('different files and different rules stay separate', () => {
    const m = map([f('line-length', 'a.ts', 1), f('line-length', 'a.ts', 2), f('line-length', 'b.ts', 1), f('long-functions', 'a.ts', 5), f('long-functions', 'a.ts', 9)])
    applyRollup(m, { all: false, fingerprint })
    expect(m.size).toBe(3)
  })
  test('pedantic Rust style and markup nitpicks are counted and hidden; the same rule at medium or a security rule is not', () => {
    const m = map([f('rapi-pub-fn-undocumented', 'a.rs', 1, 'low'), f('rapi-pub-fn-undocumented', 'a.rs', 2, 'low'), f('markdown-code-fences', 'a.md', 3, 'medium'), f('rerr-lock-unwrap-poison', 'a.rs', 4, 'medium'), f('jwt-weak', 'a.ts', 5, 'high'), f('pii-in-logs', 'b.ts', 6, 'high')])
    const r = applyRollup(m, { all: false, fingerprint })
    expect([...m.values()].map((x: any) => x.rule).sort()).toEqual(['jwt-weak', 'pii-in-logs', 'rerr-lock-unwrap-poison'])
    expect(r.hidden).toEqual([{ rule: 'rapi-pub-fn-undocumented', count: 2 }, { rule: 'markdown-code-fences', count: 1 }])
    expect(r.hiddenIds.size).toBe(3)
  })
  test('MEERKAT_FINDINGS=all keeps the style findings (the size measures still roll up)', () => {
    const m = map([f('rapi-pub-fn-undocumented', 'a.rs', 1, 'low'), f('line-length', 'a.ts', 1), f('line-length', 'a.ts', 2)])
    const r = applyRollup(m, { all: true, fingerprint })
    expect(m.size).toBe(2)
    expect(r.hidden).toEqual([])
    expect(showAll({ MEERKAT_FINDINGS: 'ALL' })).toBe(true)
    expect(showAll({})).toBe(false)
  })
  test('no security rule is ever hidden by default', () => {
    for (const rule of ['jwt-weak', 'cookie-flags', 'weak-crypto-modes', 'rsafe-env-set-var', 'rs-secret-logged', 'js-spawn-shell', 'secret-scan', 'rerr-lock-unwrap-poison']) {
      expect(isHiddenByDefault({ rule, severity: 'medium' })).toBe(false)
    }
    expect(isHiddenByDefault({ rule: 'rsafe-vec-set-len-no-capacity', severity: 'low' })).toBe(false)
  })
})
