// Rust (and Python skip) rule false positives from docs/issues.md 13a-13d, 13f, 13m, 11e: each has a quiet case and a real case that must still fire.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { RS } from '../thorough/rules-code-patterns.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-rust-plus.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
beforeAll(() => {
  process.env.MEERKAT_FINDINGS = 'all'
})

// Runs one script check on a folder holding one file; returns the exit code (0 clean, 1 findings).
function scriptCheck(script: string, check: string, file: string, body: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-vrr-'))
  made.push(dir)
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
  try {
    execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

const ALL: any[] = [...(RS as any[]), ...(Object.values(CHECK_TABLES).flat() as any[])]
function hits(id: string, text: string, file = 'src/lib.rs'): number {
  const rule = ALL.find((r) => r.id === id)
  const store: Record<string, string> = { [file]: text }
  return evaluate('.', [rule], { files: [file], read: (f: string) => store[f] ?? '' }).hits.length
}

describe('13a unsafe-rust: the SAFETY comment block directly above counts', () => {
  const run = (body: string) => scriptCheck('thorough/hygiene.mjs', 'unsafe-rust', 'src/a.rs', body)
  test('a long multi-line SAFETY comment is quiet', () => {
    expect(run('fn f() {\n    // SAFETY: the pointer comes from a live Box\n    // and nothing else holds it.\n    // More detail line three.\n    // More detail line four.\n    // More detail line five.\n    // More detail line six.\n    unsafe { x() }\n}\n')).toBe(0)
  })
  test('no comment is still flagged', () => {
    expect(run('fn f() {\n    let a = 1;\n    unsafe { x() }\n}\n')).toBe(1)
  })
})

describe('13b mem::forget with an ownership comment', () => {
  test('quiet with a comment saying ownership moved', () => {
    expect(hits('rs-forget-uninitialized', 'fn f() {\n    // Ownership handed over to the C side, which frees it.\n    mem::forget(buf);\n}\n')).toBe(0)
  })
  test('bare mem::forget still fires', () => {
    expect(hits('rs-forget-uninitialized', 'fn f() {\n    mem::forget(buf);\n}\n')).toBeGreaterThan(0)
  })
  test('mem::uninitialized still fires even with a comment', () => {
    expect(hits('rs-forget-uninitialized', 'fn f() {\n    // ownership moved\n    let x = mem::uninitialized();\n}\n')).toBeGreaterThan(0)
  })
})

describe('13c from_raw_parts with a SAFETY note naming the length source', () => {
  test('quiet', () => {
    expect(hits('rsafe-from-raw-parts-no-len-check', 'fn f() {\n    // SAFETY: len is the byte count the kernel wrote into buf.\n    let s = unsafe { slice::from_raw_parts(ptr, len) };\n}\n')).toBe(0)
  })
  test('no note still fires', () => {
    expect(hits('rsafe-from-raw-parts-no-len-check', 'fn f() {\n    let s = unsafe { slice::from_raw_parts(ptr, len) };\n}\n')).toBeGreaterThan(0)
  })
})

describe('13d unreachable! and assert! with a comment above', () => {
  test('unreachable! with a stated invariant is quiet', () => {
    expect(hits('rerr-unreachable-in-library', 'fn f(v: u8) {\n    match v {\n        // The parser only yields 0 or 1, so other values cannot occur.\n        _ => unreachable!("bad"),\n    }\n}\n')).toBe(0)
  })
  test('bare unreachable! still fires', () => {
    expect(hits('rerr-unreachable-in-library', 'fn f(v: u8) {\n    match v {\n        _ => unreachable!("bad"),\n    }\n}\n')).toBeGreaterThan(0)
  })
  test('assert! with a guard-purpose comment is quiet', () => {
    expect(hits('rerr-assert-in-library', 'fn f(n: usize) {\n    // Deliberate guard: a zero size would divide by zero below.\n    assert!(n > 0);\n}\n')).toBe(0)
  })
  test('bare assert! still fires', () => {
    expect(hits('rerr-assert-in-library', 'fn f(n: usize) {\n    assert!(n > 0);\n}\n')).toBeGreaterThan(0)
  })
})

describe('13f debug-leftovers skips doc comments', () => {
  const run = (body: string) => scriptCheck('thorough/quality.mjs', 'debug-leftovers', 'src/lib.rs', body)
  test('todo!() in //! and /// is quiet', () => {
    expect(run('//! Example: `todo!()` stands in for code.\n/// Use `unimplemented!()` or todo!() here.\nfn f() {}\n')).toBe(0)
  })
  test('todo!() in code still fires', () => {
    expect(run('fn f() {\n    todo!()\n}\n')).toBe(1)
  })
})

describe('13m skipped-tests: #[ignore = "reason"]', () => {
  const run = (body: string) => scriptCheck('thorough/quality.mjs', 'skipped-tests', 'src/lib.rs', body)
  test('with a reason is quiet', () => {
    expect(run('#[test]\n#[ignore = "needs a GPU"]\nfn t() {}\n')).toBe(0)
  })
  test('bare #[ignore] still fires', () => {
    expect(run('#[test]\n#[ignore]\nfn t() {}\n')).toBe(1)
  })
})

describe('11e skipped-tests: conditional skip with a reason', () => {
  const run = (body: string) => scriptCheck('thorough/quality.mjs', 'skipped-tests', 'tests/test_a.py', body)
  test('skipUnless(cond, REASON) is quiet', () => {
    expect(run('import unittest\n\n@unittest.skipUnless(HAVE_TZ, REASON)\nclass T(unittest.TestCase):\n    pass\n')).toBe(0)
  })
  test('skipIf(cond, "reason") with a call in the condition is quiet', () => {
    expect(run('@unittest.skipIf(os.environ.get("CI", ""), "no display in CI")\ndef test_x():\n    pass\n')).toBe(0)
  })
  test('bare @unittest.skip still fires', () => {
    expect(run('@unittest.skip\ndef test_x():\n    pass\n')).toBe(1)
  })
  test('skipUnless with no reason still fires', () => {
    expect(run('@unittest.skipUnless(os.environ.get("A", "b"))\ndef test_x():\n    pass\n')).toBe(1)
  })
})
