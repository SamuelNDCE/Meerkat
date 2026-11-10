// --format markdown: file paths, messages and rerun commands are plain text, never markdown.
import { describe, expect, test } from 'vitest'
import { markdownReport } from '../lib/verdict-report.mjs'

const file = 'src/a*b`c.js'
const report = {
  blocks: [{ file, line: 3, rule: 'r_1', severity: 'error', message: 'bad | value *x*', check: 'chk', origin: 'new', rerun: 'meerkat gate --only chk --base fe`at|x' }],
  toolProblems: [],
  notRun: [],
  notFinished: { count: 0, total: 1, ids: [] },
  files: [file],
}
const md = markdownReport({ head: `FAIL 1 new blocking finding in 1 file (status 422). Next: fix ${file}:3`, report, pre: null, rerun: 'meerkat verdict --base fe`at|x' })
const text = md.join('\n')
const row = md.find((l) => l.startsWith('| src')) as string

describe('markdown output escapes its inputs', () => {
  test('the headline escapes * and ` in the path', () => {
    expect(md[0]).toContain('src/a\\*b\\`c.js:3')
    expect(md[0]).not.toMatch(/[^\\]\*b/)
  })
  test('the table row escapes the path and the | in the message', () => {
    expect(row).toContain('src/a\\*b\\`c.js')
    expect(row).toContain('bad \\| value \\*x\\*')
  })
  test('rerun commands sit in a code span longer than any backtick run inside, pipe escaped', () => {
    expect(row).toContain('`` meerkat gate --only chk --base fe`at\\|x ``')
    expect(text).toContain('Re-run:\n\n```\nmeerkat verdict --base fe`at|x\n```')
  })
  test('the row keeps exactly the seven table cells', () => {
    expect(row.replace(/\\\|/g, '').split('|').length).toBe(9)
  })
})
