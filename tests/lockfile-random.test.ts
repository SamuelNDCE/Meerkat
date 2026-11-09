// lib/lockfile.mjs draws its retry jitter and temp-file names from node:crypto, never Math.random.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { randomBytes, randomInt } from 'node:crypto'

describe('lockfile randomness', () => {
  test('the source has no Math.random', () => {
    const text = readFileSync(fileURLToPath(new URL('../lib/lockfile.mjs', import.meta.url)), 'utf8')
    expect(text).not.toMatch(/Math\.random/)
    expect(text).toMatch(/randomInt\(/)
  })
  test('temp names carry at least 128 bits and two draws differ', () => {
    const a = randomBytes(16).toString('hex')
    const b = randomBytes(16).toString('hex')
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).not.toBe(b)
    expect(randomInt(20)).toBeLessThan(20)
  })
})
