// A limit written in a check is a hard ceiling: machine load and project size do not stretch it (rust-test ran to ~1424 s against its 1200 s limit).
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { effectiveTimeoutSeconds } from '../lib/timeouts.mjs'

describe('written time limits', () => {
  test('a written limit is not stretched by machine load', () => {
    const check = { id: 'rust-test', timeoutSeconds: 1200, estSeconds: 300, scale: 'crates' }
    expect(effectiveTimeoutSeconds(check, { load: 2, facts: { crates: 50 } })).toBe(1200)
  })
  test('a check with no written limit still scales with load', () => {
    const check = { id: 'x', estSeconds: 100 }
    expect(effectiveTimeoutSeconds(check, { load: 2 })).toBeGreaterThan(effectiveTimeoutSeconds(check, { load: 1 }))
  })
})
