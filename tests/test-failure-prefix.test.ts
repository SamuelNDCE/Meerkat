// Regression (29an): a rust-test FAIL whose detail says "ran only the crate(s) ...; test failed: ..." was treated as wide (not blocking).
import { expect, test } from 'vitest'
import { scopeToChanged } from '../lib/gate.mjs'

test('a failed test with a prefix before "test failed:" stays blocking when no file is in the change', () => {
  const rows = [{ id: 'rust-test', kind: 'fail', detail: 'rust-test ran only the crate(s) nv-agents, nv-audit; test failed: model_cmds::tests::every_source_file', places: [], files: ['packages/x/src/lib.rs'] }]
  scopeToChanged(rows, new Set(['src/other.js']))
  expect(rows[0].kind).toBe('fail')
})

test('a rust-test FAIL with no named file stays blocking when the change touches no file it names (29an)', () => {
  const rows = [{ id: 'rust-test', kind: 'fail', detail: 'rust-test ran only the crate(s) nv-sidecar (changed nv-sidecar)', places: [] }]
  scopeToChanged(rows, new Set(['src/other.js']))
  expect(rows[0].kind).toBe('fail')
})

test('a failing check whose places are all outside the change does not crash scoping (29an)', () => {
  const rows = [{ id: 'some-check', kind: 'fail', detail: 'something failed', places: [{ file: 'other/x.js', line: 3, message: 'bad' }], files: ['other/x.js'] }]
  expect(() => scopeToChanged(rows, new Set(['src/changed.js']))).not.toThrow()
})

test('a cargo compile error with a file location is a code failure, not a crash (29an)', async () => {
  const { classify } = await import('../lib/gate.mjs')
  const out = 'error: very complex type used. consider a type definition\n   --> packages/mcp/src/catalogue.rs:766:9\n'
  expect(classify({ exitCode: 101, status: 'FAIL' }, out)).toBe('fail')
  expect(classify({ exitCode: 101, status: 'FAIL' }, 'thread main panicked at x')).toBe('crash')
})
