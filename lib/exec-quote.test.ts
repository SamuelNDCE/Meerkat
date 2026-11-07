// quote(): the cmd.exe word quoting used when a command has to go through a shell on Windows. Asserts on the string, never runs cmd.exe.
import { describe, expect, test } from 'vitest'
import { quote } from './exec.mjs'

describe('quote for cmd.exe', () => {
  test('a plain path or word is unchanged', () => {
    expect(quote('C:/work/app/node_modules/.bin/tsc')).toBe('C:/work/app/node_modules/.bin/tsc')
    expect(quote('--flag=value')).toBe('--flag=value')
  })
  test('spaces get double quotes', () => {
    expect(quote('C:/Program Files/x')).toBe('"C:/Program Files/x"')
  })
  test('an embedded double quote is doubled, not backslash escaped', () => {
    expect(quote('a b"c')).toBe('"a b""c"')
    expect(quote('say "hi" now')).toBe('"say ""hi"" now"')
  })
  test('shell operators are only quoted', () => {
    expect(quote('a&b')).toBe('"a&b"')
    expect(quote('a^b')).toBe('"a^b"')
  })
  test('! is passed through (ignore globs), % is refused', () => {
    expect(quote('!node_modules/**')).toBe('!node_modules/**')
    expect(() => quote('%PATH%')).toThrow(/refusing/)
    expect(() => quote('50%')).toThrow(/refusing/)
  })
  test('a newline, carriage return or NUL is refused', () => {
    expect(() => quote('a\nb')).toThrow(/refusing/)
    expect(() => quote('a\r\nb')).toThrow(/refusing/)
    expect(() => quote('a\0b')).toThrow(/refusing/)
  })
})
