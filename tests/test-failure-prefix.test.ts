// Regression (29an): a rust-test FAIL whose detail says "ran only the crate(s) ...; test failed: ..." was treated as wide (not blocking).
import { expect, test } from 'vitest'
import { scopeToChanged } from '../lib/gate.mjs'

test('a failed test with a prefix before "test failed:" stays blocking when no file is in the change', () => {
  const rows = [{ id: 'rust-test', kind: 'fail', detail: 'rust-test ran only the crate(s) nv-agents, nv-audit; test failed: model_cmds::tests::every_source_file', places: [], files: ['packages/x/src/lib.rs'] }]
  scopeToChanged(rows, new Set(['src/other.js']))
  expect(rows[0].kind).toBe('fail')
})
