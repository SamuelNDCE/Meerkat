// Checks that only compare a project with Meerkat's own default limits are advice until the project writes a budgets file (lib/runner.mjs).
// The end-to-end behavior (pass as advisory without the file, fail with it) is covered by running Meerkat on a project, as in docs/commands.md.
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { ADVISORY_WITHOUT_BUDGETS } from '../lib/runner.mjs'

describe('advisory checks without a budgets file', () => {
  test('the size and shape checks are advisory', () => {
    for (const id of ['line-length', 'long-functions', 'deep-nesting', 'many-parameters', 'cyclomatic-complexity']) expect(ADVISORY_WITHOUT_BUDGETS.has(id), id).toBe(true)
  })
  test('security checks and history facts never are', () => {
    for (const id of ['secret-scan', 'secrets-plus', 'risky-code', 'commit-message-format', 'changelog-updated']) expect(ADVISORY_WITHOUT_BUDGETS.has(id), id).toBe(false)
  })
})
