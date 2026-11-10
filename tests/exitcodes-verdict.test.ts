import { describe, expect, test } from 'vitest'
import { VERDICT_EXIT, VERDICT_EXIT_TABLE, exitName, verdictWord } from '../lib/exitcodes.mjs'

describe('verdict exit codes', () => {
  test('names and words follow the code', () => {
    expect(exitName(4)).toBe('STALE')
    expect(exitName(75)).toBe('INCOMPLETE')
    expect(exitName(3)).toBe('NO_RESULT')
    expect(verdictWord(3)).toBe('NO-RESULT')
    expect(verdictWord(4)).toBe('STALE')
    expect(verdictWord(75)).toBe('INCOMPLETE')
  })
  test('the table lists every code in VERDICT_EXIT exactly once', () => {
    const codes = VERDICT_EXIT_TABLE.map((r) => r.code).sort((a, b) => a - b)
    expect(codes).toEqual(Object.values(VERDICT_EXIT).sort((a, b) => a - b))
    expect(new Set(codes).size).toBe(codes.length)
    for (const r of VERDICT_EXIT_TABLE) expect(r.name).toBe(exitName(r.code))
  })
})
