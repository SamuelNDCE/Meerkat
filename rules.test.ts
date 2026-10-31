import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate, selfProve } from './thorough/rules.mjs'

const RULES = [
  { id: 'todo-word', title: 'a TODO word is left in', ext: ['js'], re: /\bTODO\b/, bad: '// TODO fix', good: '// done' },
  { id: 'py-only', title: 'a python-only rule', ext: ['py'], re: /print\(/, bad: 'print(1)', good: 'log(1)' },
]

describe('rules engine', () => {
  it('proves rules with bad and good samples and flags a broken rule', () => {
    expect(selfProve(RULES)).toEqual([])
    expect(selfProve([{ ...RULES[0], good: '// TODO' }]).join()).toMatch(/false positive/)
    expect(selfProve([{ ...RULES[0], bad: 'nothing' }]).join()).toMatch(/not found/)
    expect(selfProve([RULES[0], RULES[0]]).join()).toMatch(/duplicate/)
  })
  it('reports findings, passes clean rules and marks rules with no matching files as NA', () => {
    const d = mkdtempSync(join(tmpdir(), 'rules-'))
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'a.js'), 'x\n// TODO later\n')
    const r = evaluate(d, RULES, { files: ['src/a.js'], read: (f: string) => (f === 'src/a.js' ? 'x\n// TODO later\n' : '') })
    expect(r.found).toEqual([{ rule: 'todo-word', text: 'src/a.js:2 a TODO word is left in' }])
    expect(r.na).toEqual(['py-only'])
  })
})
