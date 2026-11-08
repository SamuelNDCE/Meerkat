// The shell-quoting path on every platform (so the Linux CI job exercises it too): quote() is pure string work and must behave the same on Linux, macOS and Windows.
import { describe, expect, test } from 'vitest'
import { quote } from './exec.mjs'

describe('quote is platform independent', () => {
  test('a path with spaces is wrapped, a plain path is not', () => {
    expect(quote('/home/runner/work/my app/bin')).toBe('"/home/runner/work/my app/bin"')
    expect(quote('/usr/local/bin/node')).toBe('/usr/local/bin/node')
  })
  test('a double quote is doubled and a percent sign is refused, on any platform', () => {
    expect(quote('a b"c')).toBe('"a b""c"')
    expect(() => quote('$HOME%x')).toThrow(/refusing/)
  })
  test('a forward-slash glob with a leading ! is passed through', () => {
    expect(quote('!node_modules/**')).toBe('!node_modules/**')
  })
})
