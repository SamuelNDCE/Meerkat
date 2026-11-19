// Regression (29an): the verdict's time limit ignored MEERKAT_GATE_MAX_SECONDS and used its 1500 s default, so a 2700 s setting was cut at 25 minutes.
import { expect, test } from 'vitest'
import { HARD_SECONDS, DEFAULT_VERDICT_SECONDS } from '../lib/branchcmds.mjs'

test('MEERKAT_GATE_MAX_SECONDS sets the verdict limit when the verdict one is not set', () => {
  expect(HARD_SECONDS({ MEERKAT_GATE_MAX_SECONDS: '2700' })).toBe(2700)
  expect(HARD_SECONDS({ MEERKAT_VERDICT_TIMEOUT_S: '900', MEERKAT_GATE_MAX_SECONDS: '2700' })).toBe(900)
  expect(HARD_SECONDS({})).toBe(DEFAULT_VERDICT_SECONDS)
})
