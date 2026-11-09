import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { ignoredBy, missingReasons, parseIgnores } from './inline-ignore.mjs'

describe('inline meerkat-ignore comments', () => {
  test('same line suppresses', () => {
    const ig = parseIgnores('const x = eval(y) // meerkat-ignore no-eval trusted input\n')
    expect(ignoredBy(ig, { check: 'no-eval', line: 1 })).toBeTruthy()
  })
  test('next line suppresses, two lines later does not', () => {
    const ig = parseIgnores('# meerkat-ignore hardcoded-secret test fixture\nkey = "abc"\nother = 1\n')
    expect(ignoredBy(ig, { check: 'hardcoded-secret', line: 2 })).toBeTruthy()
    expect(ignoredBy(ig, { check: 'hardcoded-secret', line: 3 })).toBeNull()
  })
  test('html comment form, rule id also matches', () => {
    const ig = parseIgnores('<!-- meerkat-ignore img-alt decorative image -->\n<img src=a>')
    expect(ig[0]).toMatchObject({ id: 'img-alt', reason: 'decorative image' })
    expect(ignoredBy(ig, { check: 'a11y', rule: 'img-alt', line: 2 })).toBeTruthy()
  })
  test('a missing reason suppresses nothing and is reported', () => {
    const ig = parseIgnores('foo() // meerkat-ignore no-eval\n')
    expect(ignoredBy(ig, { check: 'no-eval', line: 1 })).toBeNull()
    expect(missingReasons(ig)).toHaveLength(1)
  })
  test('a wrong check id does not suppress', () => {
    const ig = parseIgnores('foo() // meerkat-ignore other-check because\n')
    expect(ignoredBy(ig, { check: 'no-eval', line: 1 })).toBeNull()
  })
})
