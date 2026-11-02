import { constants } from 'node:os'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { defaultParallel, lowerPriority, priorityProblem } from '../lib/priority.mjs'

describe('lowerPriority', () => {
  test('lowers to below normal by default', () => {
    const calls: number[][] = []
    const note = lowerPriority({}, (pid: number, level: number) => calls.push([pid, level]))
    expect(calls).toEqual([[0, constants.priority.PRIORITY_BELOW_NORMAL]])
    expect(note).toContain('below normal')
  })
  test('idle goes lower, normal leaves it alone', () => {
    const calls: number[][] = []
    lowerPriority({ MEERKAT_PRIORITY: 'idle' }, (pid: number, level: number) => calls.push([pid, level]))
    expect(calls[0][1]).toBe(constants.priority.PRIORITY_LOW)
    expect(lowerPriority({ MEERKAT_PRIORITY: 'normal' }, () => { throw new Error('must not be called') })).toBeNull()
  })
  test('a refusal (locked-down container) is not an error', () => {
    expect(lowerPriority({}, () => { throw new Error('EPERM') })).toBeNull()
  })
})

describe('priorityProblem', () => {
  test('known values, in any case, and an unset value are fine', () => {
    for (const v of [undefined, '', 'normal', 'low', 'idle', 'Normal', 'IDLE']) expect(priorityProblem(v), String(v)).toBeNull()
  })
  test('a typo or an unsupported value is a sentence, not a silent default', () => {
    expect(priorityProblem('hgih')).toContain('unknown priority')
    expect(priorityProblem('high')).toContain('normal, low, idle')
  })
})

describe('defaultParallel', () => {
  test('half the cores on a person\'s PC, between 2 and 8', () => {
    expect(defaultParallel(12, {})).toBe(6)
    expect(defaultParallel(2, {})).toBe(2)
    expect(defaultParallel(32, {})).toBe(8)
  })
  test('all but one on CI or at normal priority', () => {
    expect(defaultParallel(12, { CI: 'true' })).toBe(11)
    expect(defaultParallel(12, { MEERKAT_PRIORITY: 'normal' })).toBe(11)
  })
  test('CI=false or CI=0 is not a CI runner, and the priority name is not case sensitive', () => {
    expect(defaultParallel(12, { CI: 'false' })).toBe(6)
    expect(defaultParallel(12, { CI: '0' })).toBe(6)
    expect(defaultParallel(12, { CI: '' })).toBe(6)
    expect(defaultParallel(12, { MEERKAT_PRIORITY: 'Normal' })).toBe(11)
  })
  test('MEERKAT_PARALLEL wins', () => {
    expect(defaultParallel(12, { MEERKAT_PARALLEL: '3', CI: 'true' })).toBe(3)
    expect(defaultParallel(12, { MEERKAT_PARALLEL: 'banana' })).toBe(6)
  })
})
