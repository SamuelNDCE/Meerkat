// pii-patterns-in-source: a placeholder such as a@b.com or 1.2.3.4 is not a person's data.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const pii = (body: string) => runCheck('thorough/privacy.mjs', 'pii-patterns-in-source', { 'src/a.js': body })

describe('pii-patterns-in-source and placeholders', () => {
  test('a one-letter placeholder email is quiet', () => {
    expect(pii('const e = "a@b.com"\nconst f = "x@y.co"\n').code).toBe(0)
  })
  test('the counting-up example IP and the 192.0.0.0 range are quiet', () => {
    expect(pii('const ip = "1.2.3.4"\nconst net = "192.0.0.0"\n').code).toBe(0)
  })
  test('a real-looking email still fails', () => {
    expect(pii('const e = "jane.smith@gmail.com"\n').code).toBe(1)
  })
  test('a short local part at a real domain still fails', () => {
    expect(pii('const e = "j@gmail.com"\n').code).toBe(1)
  })
  test('a real public IP still fails', () => {
    expect(pii('const ip = "8.8.4.4"\n').code).toBe(1)
  })
})
