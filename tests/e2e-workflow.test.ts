import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { gateText } from '../lib/gate.mjs'

describe('gateText names the failures that point into the changed files', () => {
  const rows = [
    { id: 'sql-concat', kind: 'fail', detail: 'src/routes/users.ts:8 builds an SQL statement by joining text and values together  [full output: C:/x/sql-concat.log]', findings: [] },
    { id: 'license', kind: 'fail', detail: 'package.json has no "license" field', findings: [] },
    { id: 'markers', kind: 'pass', detail: 'markers: none', findings: [] },
  ]
  test('lists only the rows whose first line starts with a changed file', () => {
    const text = gateText('gate', { files: ['src/routes/users.ts'], rows, skipped: [], note: '', exitCode: 1, logDir: 'C:/logs/g' }, 'staged files')
    expect(text).toContain('in the files you changed (1 check(s)):')
    expect(text).toContain('  sql-concat: src/routes/users.ts:8 builds an SQL statement by joining text and values together')
    expect(text).not.toMatch(/ {2}license: /)
    expect(text.split('in the files you changed')[1]).not.toContain('full output')
  })
  test('prints no such section when nothing points into the changed files', () => {
    const text = gateText('gate', { files: ['docs/a.md'], rows, skipped: [], note: '', exitCode: 1, logDir: 'C:/logs/g' }, 'staged files')
    expect(text).not.toContain('in the files you changed')
  })
})
