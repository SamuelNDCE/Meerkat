// telemetry-calls: a host under a name the standards keep for examples and tests is sample text, not a collector.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const tel = (body: string) => runCheck('thorough/privacy.mjs', 'telemetry-calls', { '.meerkat-budgets.json': '{"privacy":{"noTelemetry":true}}', 'src/a.js': body })

describe('telemetry-calls and reserved example hosts', () => {
  test('a .test host in a guard test string is quiet', () => {
    expect(tel("const url = 'https://collector.evil.test/upload'\n").code).toBe(0)
  })
  test('a .example host is quiet', () => {
    expect(tel("const url = 'https://collector.example/x'\n").code).toBe(0)
  })
  test('a real telemetry host still fails', () => {
    expect(tel("fetch('https://telemetry.acme.dev/collect', { method: 'POST' })\n").code).toBe(1)
  })
  test('a real host that merely contains the word test still fails', () => {
    expect(tel("fetch('https://collect.testing-corp.com/x')\n").code).toBe(1)
  })
})
