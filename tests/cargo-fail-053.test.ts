// A cargo test failure is a failing check named by its test, not a crash (the NeuralVault agents-page case).
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { classify } from '../lib/gate.mjs'

describe('cargo test output', () => {
  test('a test that failed is fail, even when it panicked', () => {
    const out = "test a::b ... FAILED\n  thread 'a::b' panicked at src/x.rs:1020:5:\ntest result: FAILED. 3208 passed; 1 failed;"
    expect(classify({ status: 'FAIL', exitCode: 101 }, out)).toBe('fail')
  })
  test('a runner crash with no test summary is still a crash', () => {
    expect(classify({ status: 'FAIL', exitCode: 101 }, "thread 'main' panicked at src/main.rs:3:5")).toBe('crash')
  })
})
