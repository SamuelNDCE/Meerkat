// Cross-tool confirmation (lib/confirm.mjs): the same problem seen by two checks is one finding; anything uncertain is left alone.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { confirmFindings } from '../lib/confirm.mjs'

let n = 0
const f = (over: Record<string, unknown>) => {
  const id = `id${++n}`
  return { id, severity: 'medium', suite: 'x', check: 'a', rule: null, file: 'src/a.js', line: 10, lines: [10], occurrences: 1, message: 'm', confidence: 'medium', ...over }
}
const run = (list: any[]) => {
  const map = new Map(list.map((x) => [x.id, x]))
  const r = confirmFindings(map)
  return { out: [...map.values()], merged: r.merged }
}

describe('what merges', () => {
  test('the same secret from gitleaks-secrets and secret-scan is one high-confidence finding', () => {
    const a = f({ check: 'gitleaks-secrets', suite: 'secrets', rule: 'aws-access-token', file: 'cfg.py', line: 1, severity: 'critical', message: 'Identified AWS credentials (value not shown)' })
    const b = f({ check: 'secret-scan', suite: 'secrets', rule: 'aws-access-key', file: 'cfg.py', line: 2, severity: 'high', message: 'AWS key' })
    const { out, merged } = run([a, b])
    expect(out).toHaveLength(1)
    expect(merged).toBe(1)
    expect(out[0]).toMatchObject({ check: 'gitleaks-secrets', severity: 'critical', confirmations: 2, confidence: 'high', confirmedBy: ['gitleaks-secrets', 'secret-scan'] })
    expect(out[0].alsoReportedBy).toEqual([{ check: 'secret-scan', rule: 'aws-access-key' }])
  })

  test('the same advisory from osv-scan and advisories merges, keeping the highest severity and the tool evidence', () => {
    const a = f({ check: 'osv-scan', rule: 'ghsa-xvch-5gv4-984h', file: 'package-lock.json', line: 0, severity: 'high', message: 'minimist@1.2.5 (npm) is vulnerable: GHSA-xvch-5gv4-984h; fixed in 1.2.6' })
    const b = f({ check: 'advisories', rule: 'npm-audit', file: 'package-lock.json', line: 0, severity: 'medium', message: 'minimist@1.2.5 CVE-2021-44906 aka GHSA-xvch-5gv4-984h prototype pollution' })
    const { out } = run([b, a])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ check: 'osv-scan', severity: 'high', confirmations: 2 })
  })

  test('an advisory for a different package never merges', () => {
    const a = f({ check: 'osv-scan', message: 'minimist@1.2.5 GHSA-aaaa-bbbb-cccc' })
    const b = f({ check: 'advisories', message: 'lodash@1.0.0 GHSA-aaaa-bbbb-cccc' })
    expect(run([a, b]).out).toHaveLength(2)
  })

  test('the same code issue class within 3 lines merges across tools', () => {
    const a = f({ check: 'semgrep-security', rule: 'lang-security-detect-child-process', line: 20, severity: 'high' })
    const b = f({ check: 'code-patterns', rule: 'command-injection', line: 22, severity: 'medium' })
    const { out } = run([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].confirmations).toBe(2)
  })

  test('the same check repeating one identity folds into one finding with an occurrence count, without confirmation', () => {
    const a = f({ check: 'osv-scan', rule: 'ghsa-xvch-5gv4-984h', message: 'minimist@1.2.5 GHSA-xvch-5gv4-984h' })
    const b = f({ check: 'osv-scan', rule: 'ghsa-xvch-5gv4-984h', file: 'web/package-lock.json', message: 'minimist@1.2.5 GHSA-xvch-5gv4-984h' })
    const { out, merged } = run([a, b])
    expect(out).toHaveLength(1)
    expect(merged).toBe(1)
    expect(out[0].occurrences).toBe(2)
    expect(out[0].confirmations).toBeUndefined()
    expect(out[0].confidence).toBe('medium')
  })
})

describe('what never merges', () => {
  test('two different classes on the same line', () => {
    const a = f({ check: 'semgrep-security', rule: 'sql-concat', line: 5 })
    const b = f({ check: 'code-patterns', rule: 'innerhtml-assign', line: 5 })
    expect(run([a, b]).out).toHaveLength(2)
  })

  test('the same class 10 lines apart', () => {
    const a = f({ check: 'semgrep-security', rule: 'command-injection', line: 5 })
    const b = f({ check: 'code-patterns', rule: 'command-injection', line: 15 })
    expect(run([a, b]).out).toHaveLength(2)
  })

  test('a secret 3 lines away is not the same secret', () => {
    const a = f({ check: 'gitleaks-secrets', rule: 'aws-access-token', file: 'c.py', line: 1 })
    const b = f({ check: 'secret-scan', rule: 'aws-access-key', file: 'c.py', line: 4 })
    expect(run([a, b]).out).toHaveLength(2)
  })

  test('an unknown rule id never merges with another tool', () => {
    const a = f({ check: 'semgrep-security', rule: 'some-new-rule', line: 5 })
    const b = f({ check: 'code-patterns', rule: 'some-new-rule', line: 5 })
    const { out, merged } = run([a, b])
    expect(out).toHaveLength(2)
    expect(merged).toBe(0)
  })

  test('a finding seen by one tool is untouched', () => {
    const a = f({ check: 'semgrep-security', rule: 'xss-thing', line: 5 })
    const copy = JSON.stringify(a)
    const { out } = run([a, f({ check: 'x', rule: 'sql-concat', file: 'other.js' })])
    expect(JSON.stringify(out[0])).toBe(copy)
    expect(out[0].confirmations).toBeUndefined()
  })
})
