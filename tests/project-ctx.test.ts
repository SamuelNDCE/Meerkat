// The shared taint helpers (thorough/project-ctx.mjs). A parameter name that is not an identifier must not crash a check.
import { describe, expect, test } from 'vitest'
import { wordRe } from '../thorough/project-ctx.mjs'

describe('wordRe', () => {
  test('matches a whole identifier', () => {
    expect(wordRe('user').test('const x = user.id')).toBe(true)
    expect(wordRe('user').test('const x = username')).toBe(false)
  })

  test('a parameter name with regex metacharacters never throws (a stray "(" once crashed the whole check)', () => {
    expect(() => wordRe('(')).not.toThrow()
    expect(wordRe('(').test('f(a)')).toBe(true)
    expect(() => wordRe('a|b')).not.toThrow()
    expect(wordRe('a.b').test('a.b')).toBe(true)
    expect(wordRe('a.b').test('axb')).toBe(false)
  })
})
