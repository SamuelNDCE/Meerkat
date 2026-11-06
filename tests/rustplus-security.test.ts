// Security hardening of the test-scope helpers: no RegExp built from an unvalidated module name, and no backtracking regex over blank lines.
import { describe, expect, test } from 'vitest'
import { cfgTestItems, testModuleFile } from '../thorough/rules-rust-plus.mjs'

const project = (files: Record<string, string>) => ({ files: Object.keys(files), read: (p: string) => files[p] })

describe('testModuleFile with hostile module names', () => {
  test('a name with regex metacharacters does not throw and does not match', () => {
    const p = project({ 'src/mod.rs': '#[cfg(test)]\nmod other;\n', 'src/a(b.rs': 'fn x() {}\n' })
    expect(() => testModuleFile(p, 'src/a(b.rs')).not.toThrow()
    expect(testModuleFile(p, 'src/a(b.rs')).toBe(false)
  })
  test('a name of .* does not match arbitrary declarations', () => {
    const p = project({ 'src/mod.rs': '#[cfg(test)]\nmod other;\n', 'src/.*.rs': 'fn x() {}\n' })
    expect(testModuleFile(p, 'src/.*.rs')).toBe(false)
  })
  test('a normal identifier still matches its cfg(test) declaration', () => {
    const p = project({ 'src/mod.rs': '#[cfg(test)]\nmod helpers;\n', 'src/helpers.rs': 'fn x() {}\n' })
    expect(testModuleFile(p, 'src/helpers.rs')).toBe(true)
  })
})

describe('cfgTestItems is linear', () => {
  const ctx = (text: string) => ({ lines: text.split('\n'), text, index: 0 })
  test('thousands of blank lines after #[cfg(test)] finish within 1 second', () => {
    const text = `#[cfg(test)]\n${'\n'.repeat(50000)}fn x() -> u8 { 1 }\n`
    const t = Date.now()
    const r = cfgTestItems(ctx(text))
    expect(Date.now() - t).toBeLessThan(1000)
    expect(r.length).toBe(1)
  })
  test('many blank/attribute lines with no item header stay fast', () => {
    const text = `#[cfg(test)]\n${'  \n#[a]\n'.repeat(20000)}use x;\n`
    const t = Date.now()
    expect(cfgTestItems(ctx(text))).toEqual([])
    expect(Date.now() - t).toBeLessThan(1000)
  })
  test('keeps the same ranges: attributes and blanks between, header up to the brace, semicolon stops', () => {
    const text = '#[cfg(test)]\n#[allow(dead_code)]\n\nmod t {\n  fn a() {}\n}\n#[cfg(test)]\nuse foo;\nfn z() {}\n'
    expect(cfgTestItems(ctx(text))).toEqual([[1, 6]])
  })
})
