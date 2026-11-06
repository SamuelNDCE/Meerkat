// Runtime rules of rust-plus (panics, unwraps, blocking, spawning, channels, locks, swallowed errors) leave #[cfg(test)] modules and #[test]
// functions alone; documentation, Debug and readability rules still report there. The test scope is found by matching braces, not by file name.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { rustTestLines } from '../thorough/kit.mjs'
import { ASYNC, CHECK_TABLES, ERRORS, PERF_STYLE, RUNTIME_RULES, SAFETY } from '../thorough/rules-rust-plus.mjs'
import { evaluate } from '../thorough/rules.mjs'

// Pedantic rules are only evaluated with MEERKAT_FINDINGS=all.
process.env.MEERKAT_FINDINGS = 'all'
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const count = (table: any[], id: string, files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-testskip-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return evaluate(dir, table.filter((r) => r.id === id), { files: Object.keys(files) }).found.length
}
const ALL = Object.values(CHECK_TABLES).flat()
const inMod = (body: string) => `#[cfg(test)]\nmod tests {\n${body}\n}\n`

describe('rustTestLines (the test-scope helper)', () => {
  const src = [
    'pub fn real() {}', // 1
    '#[cfg(test)]', // 2
    'mod tests {', // 3
    '    fn nested() {', // 4
    '        if true { let a = 1; }', // 5
    '        let s = "}}} not a close";', // 6
    '        // } a comment brace', // 7
    "        let c = '}';", // 8
    '    }', // 9
    '}', // 10
    'pub fn after() { x.unwrap(); }', // 11
  ].join('\n')
  const inTest = rustTestLines('src/lib.rs', src)
  test('covers the whole module through nested braces, a brace in a string, in a comment and in a char literal', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(inTest(n)).toBe(true)
  })
  test('does not cover code before or after the module', () => {
    expect(inTest(1)).toBe(false)
    expect(inTest(11)).toBe(false)
  })
  test('a file with no cfg(test) module covers nothing', () => {
    expect(rustTestLines('src/lib.rs', 'fn a() {}\n')(1)).toBe(false)
  })
})

describe('runtime rules and test code', () => {
  test('every runtime rule id exists', () => {
    const ids = new Set(ALL.map((r) => r.id))
    for (const id of RUNTIME_RULES) expect(ids.has(id), id).toBe(true)
  })
  test('the same finding is reported in production code and not inside a #[cfg(test)] module', () => {
    for (const id of RUNTIME_RULES) {
      const rule = ALL.find((r) => r.id === id) as any
      const files = { 'src/lib.rs': rule.bad }
      expect(count(ALL, id, files), `${id} in production`).toBeGreaterThan(0)
      expect(count(ALL, id, { 'src/lib.rs': inMod(rule.bad) }), `${id} in cfg(test)`).toBe(0)
    }
  })
  test('a hand-written case: unwrap on a lock, production versus test module with nested braces', () => {
    const body = 'fn t() {\n    if true { let g = m.lock().unwrap(); }\n}'
    expect(count(ERRORS, 'rerr-lock-unwrap-poison', { 'src/lib.rs': `pub fn f() {\n${body}\n}\n` })).toBe(1)
    expect(count(ERRORS, 'rerr-lock-unwrap-poison', { 'src/lib.rs': inMod(body) })).toBe(0)
  })
  test('code after the test module is still scanned', () => {
    const files = { 'src/lib.rs': `${inMod('fn t() { let s = "}"; }')}\npub fn f() {\n    let g = m.lock().unwrap();\n}\n` }
    expect(count(ERRORS, 'rerr-lock-unwrap-poison', files)).toBe(1)
  })
  test('a #[test] function is skipped too', () => {
    expect(count(ASYNC, 'rasync-unbounded-channel', { 'src/lib.rs': '#[test]\nfn t() {\n    let (tx, rx) = mpsc::unbounded_channel();\n}\n' })).toBe(0)
  })
})

describe('documentation and unsafe-contract rules still report inside test code', () => {
  test('an undocumented unsafe fn in a cfg(test) module is reported', () => {
    const bad = (ALL.find((r) => r.id === 'rsafe-unsafe-fn-no-safety-doc') as any).bad
    expect(count(SAFETY, 'rsafe-unsafe-fn-no-safety-doc', { 'src/lib.rs': inMod(bad) })).toBeGreaterThan(0)
  })
  test('a readability rule (len compared to zero) is still reported in a cfg(test) module', () => {
    const bad = (PERF_STYLE.find((r) => r.id === 'rperf-len-compare-zero') as any).bad
    expect(count(PERF_STYLE, 'rperf-len-compare-zero', { 'src/lib.rs': inMod(bad) })).toBeGreaterThan(0)
  })
})
