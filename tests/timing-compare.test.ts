// js-timing-unsafe-compare: comparing a secret with === leaks it by timing. Two shapes found on NeuralVault are not that: a confirm field next to a password in a form, and a "signature"
// that is a fingerprint kept in UI state. Real secret compares must still be reported.
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { CHECK_TABLES } from '../thorough/rules-code-patterns.mjs'

const rule = (Object.values(CHECK_TABLES) as any[][]).flat().find((r) => r.id === 'js-timing-unsafe-compare')
const hit = (line: string): boolean => Boolean(rule.test(line, { file: 'a.ts', lines: [line], index: 0, text: line }))

describe('js-timing-unsafe-compare', () => {
  test('a confirm field next to a password is not a secret compare', () => {
    expect(hit('if (password !== confirm) {')).toBe(false)
    expect(hit('if (confirmPassword === password) {')).toBe(false)
    expect(hit('if (newPassword !== repeatPassword) return')).toBe(false)
  })
  test('a signature kept as UI state is not a secret compare', () => {
    expect(hit('} else if (seenSignature !== signature) {')).toBe(false)
  })
  test('each comparison is judged on its own: a confirm check beside a real compare still reports', () => {
    expect(hit('if (password !== confirm || apiKey === provided) return')).toBe(true)
    expect(hit('if (seenSignature !== signature && secret === given) return')).toBe(true)
  })
  test('a stored value is never a confirm pair, and "verify" counts only as verifyPassword or passwordVerify', () => {
    expect(hit('if (password === storedPassword) login()')).toBe(true)
    expect(hit('if (password !== passwordHash) fail()')).toBe(true)
    expect(hit('if (password === verifiedToken) go()')).toBe(true)
    expect(hit('if (password !== verifyPassword) return')).toBe(false)
  })
  test('only a state-prefixed signature is UI state; other signature compares report', () => {
    expect(hit('if (signature !== calculatedSignature) reject()')).toBe(true)
    expect(hit('if (signature === receivedSignature) ok()')).toBe(true)
    expect(hit('if (lastSignature !== signature) update()')).toBe(false)
  })
  test('real secret compares are still reported', () => {
    for (const l of ['if (req.authToken === expected) ok()', 'if (signature !== expectedSignature) reject()', 'if (webhookSignature === header) ok()', 'if (apiKey === req.headers.key) ok()', 'if (hmac !== digest) fail()', 'if (password === stored) login()'])
      expect(hit(l), l).toBe(true)
  })
})
