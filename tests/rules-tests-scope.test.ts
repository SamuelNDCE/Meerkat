// The rule tables skip test code when a check scans the project (scanRules), but a caller that names its files itself, such as the mutation checks that
// read the tests on purpose, must still get findings from those files.
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { evaluate } from '../thorough/rules.mjs'

const rule = { id: 'no-debugger', title: 'a debugger statement is left in', ext: ['ts'], re: /\bdebugger\b/, bad: 'debugger', good: 'ok' }
const read = () => 'debugger\n'

describe('evaluate and test files', () => {
  test('an explicit list of test files is still scanned', () => {
    expect(evaluate('.', [rule], { files: ['src/a.test.ts'], read }).found.length).toBe(1)
  })
  test('skipTests leaves test files, tests.rs and probe scripts out', () => {
    for (const f of ['src/a.test.ts', 'tests/b.ts', 'src/probe-x.ts']) expect(evaluate('.', [rule], { files: [f], skipTests: true, read }).found.length, f).toBe(0)
  })
  test('skipTests still scans shipped code', () => {
    expect(evaluate('.', [rule], { files: ['src/app.ts'], skipTests: true, read }).found.length).toBe(1)
  })
})
