// dead-code: a name used only by a file that .meerkatignore keeps out of the report is still used.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const dead = (files: Record<string, string>) => runCheck('thorough/refactor.mjs', 'dead-code', files, true)

describe('dead-code and files kept out of the scan', () => {
  test('a helper imported only by an ignored rule table is quiet', () => {
    const r = dead({
      '.meerkatignore': 'rules-*.mjs\n',
      'lib/helper.mjs': 'export const goodHelper = (x) => x + 1\n',
      'lib/other.mjs': 'export const other = 1\nconsole.log(other)\n',
      'rules-a.mjs': "import { goodHelper } from './lib/helper.mjs'\nconsole.log(goodHelper(1))\n",
    })
    expect(r.out).not.toContain('goodHelper')
    expect(r.code).toBe(0)
  })
  test('a helper nothing imports still fails, even with an ignore file', () => {
    const r = dead({
      '.meerkatignore': 'rules-*.mjs\n',
      'lib/helper.mjs': 'export const orphanHelper = (x) => x + 1\n',
      'rules-a.mjs': 'console.log(1)\n',
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('orphanHelper')
  })
})
