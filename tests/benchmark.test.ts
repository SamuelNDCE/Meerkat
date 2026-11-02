// The ground-truth benchmark matcher (tools/benchmark.mjs), tested on a tiny fixture. No network, no clone, no Meerkat run.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs tool without types
import { classOf, matchFindings, summarize, unmatchedByRule } from '../tools/benchmark.mjs'

const expected = [
  { id: 'a', file: 'app/a.js', lines: [10, 12], class: 'code-injection' },
  { id: 'b', file: 'app/b.js', lines: [50, 50], class: 'open-redirect' },
  { id: 'c', file: 'server.js', lines: [1, 5], class: 'security-headers' },
  { id: 'd', file: 'app/d.js', lines: [3, 3], class: 'xss' },
]

describe('benchmark matcher', () => {
  test('classifies findings by rule and title', () => {
    expect(classOf({ check: 'risky-code', rule: 'risky-call', title: 'eval() runs text as code' })).toBe('code-injection')
    expect(classOf({ check: 'open-redirect-pattern', rule: null, title: 'sends people to an address' })).toBe('open-redirect')
    expect(classOf({ check: 'final-newline', rule: null, title: 'no final newline' })).toBeNull()
  })

  test('matches by file, class and a line window; a whole-file finding matches by file and class', () => {
    const findings = [
      { file: 'app/a.js', line: 16, check: 'risky-code', rule: 'risky-call', title: 'eval() runs text' }, // 4 lines past the range: inside +/-5
      { file: 'app/b.js', line: 60, check: 'open-redirect-pattern', rule: null, title: 'redirect' }, // 10 away: outside
      { file: './server.js', line: null, check: 'wh-headers', rule: 'hsts-missing', title: 'no HSTS' },
      { file: 'app/d.js', line: 3, check: 'final-newline', rule: null, title: 'no final newline' }, // right line, wrong class
    ]
    const r = matchFindings(expected, findings, 5)
    expect(r.found.map((m: any) => [m.expected.id, m.kind])).toEqual([['a', 'line'], ['c', 'file']])
    expect(r.missed.map((e: any) => e.id)).toEqual(['b', 'd'])
    expect(r.unmatched).toHaveLength(2)
  })

  test('uses every line of a finding and reports recall and unmatched counts by rule', () => {
    const findings = [
      { file: 'app/b.js', line: 1, lines: [1, 49], check: 'open-redirect-pattern', rule: null, title: 'redirect' },
      { file: 'x.js', line: 1, check: 'final-newline', rule: null, title: 'n' },
      { file: 'y.js', line: 2, check: 'final-newline', rule: null, title: 'n' },
    ]
    const s = summarize({ expected, lineWindow: 5 }, findings)
    expect(s.recall).toBeCloseTo(1 / 4)
    expect(s.byRule).toEqual([['final-newline/-', 2]])
    expect(unmatchedByRule([])).toEqual([])
  })
})
