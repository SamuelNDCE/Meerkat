// unicode-control-chars: the joiner inside an emoji, and test data files, are not hidden characters in code.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const ctl = (files: Record<string, string>) => runCheck('thorough/content.mjs', 'unicode-control-chars', files, true)
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'

describe('unicode-control-chars and legitimate uses', () => {
  test('a zero-width joiner between emoji is quiet', () => {
    expect(ctl({ 'a.test.ts': `const family = '${FAMILY}'\n` }).code).toBe(0)
  })
  test('a zero-width joiner between letters in code still fails', () => {
    const r = ctl({ 'a.ts': "const isAdmin\u200D = false\n" })
    expect(r.code).toBe(1)
    expect(r.out).toContain('U+200D')
  })
  test('a zero-width space between emoji still fails', () => {
    expect(ctl({ 'a.ts': `const x = '\u{1F468}\u200B\u{1F469}'\n` }).code).toBe(1)
  })
  test('a JSON sample inside a test corpus folder is quiet', () => {
    expect(ctl({ 'tests/guard_corpus/cases.json': '{"name": "a\u200Bb", "flip": "\u202Eabc"}\n' }).code).toBe(0)
  })
  test('the same JSON outside a test folder still fails', () => {
    expect(ctl({ 'config/cases.json': '{"name": "a\u200Bb"}\n' }).code).toBe(1)
  })
  test('a bidi override in a source file inside tests still fails', () => {
    expect(ctl({ 'tests/a.ts': "const access = 'user\u202E'\n" }).code).toBe(1)
  })
})
