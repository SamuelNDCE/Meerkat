// thorough/rules.mjs evaluate(): a table of rules reads and splits each file once, not once per rule, and the hits are the same as before.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate } from '../thorough/rules.mjs'

const FILES: Record<string, string> = {
  'a.js': 'const x = 1\nTODO one\neval(y)\n',
  'b.js': 'debugger\nTODO two\n',
  'c.ts': 'TODO three\n',
}
const RULES = [
  { id: 'todo', title: 'a TODO is left in the code', ext: ['js', 'ts'], re: /TODO/, bad: 'TODO', good: 'ok' },
  { id: 'eval-call', title: 'eval is called on a value', ext: ['js'], re: /\beval\(/, bad: 'eval(x)', good: 'ok' },
  { id: 'debugger', title: 'a debugger statement is left in', ext: ['js'], re: /\bdebugger\b/, bad: 'debugger', good: 'ok' },
  { id: 'whole-eval', title: 'whole file mentions eval', ext: ['js'], whole: true, re: /eval/, bad: 'eval', good: 'ok' },
]

describe('evaluate reads each file once', () => {
  test('one read per file however many rules look at it, same hits', () => {
    const reads: string[] = []
    const files = Object.keys(FILES)
    const r = evaluate('/nowhere', RULES, { files, read: (f: string) => (reads.push(f), FILES[f]) })
    expect(reads.sort()).toEqual(['a.js', 'b.js', 'c.ts'])
    expect(r.found.map((x: any) => `${x.rule} ${x.text}`)).toEqual([
      'todo a.js:2 a TODO is left in the code',
      'todo b.js:2 a TODO is left in the code',
      'todo c.ts:1 a TODO is left in the code',
      'eval-call a.js:3 eval is called on a value',
      'debugger b.js:1 a debugger statement is left in',
      'whole-eval a.js:1 whole file mentions eval',
    ])
  })

  test('a guard that reads another file through project.read shares the same read', () => {
    const reads: string[] = []
    const rule = { id: 'sees-b', title: 'a.js exists next to b.js', ext: ['js'], test: (_l: string, ctx: any) => ctx.file === 'a.js' && ctx.index === 0 && ctx.project.read('b.js').includes('debugger'), bad: 'x', good: 'y' }
    const r = evaluate('/nowhere', [rule, RULES[2]], { files: ['a.js', 'b.js'], read: (f: string) => (reads.push(f), FILES[f]) })
    expect(r.found.length).toBe(2)
    expect(reads.filter((f) => f === 'b.js')).toHaveLength(1)
  })
})
