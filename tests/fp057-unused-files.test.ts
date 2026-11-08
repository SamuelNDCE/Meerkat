// unused-files: a file imported only by a file that .meerkatignore keeps out of the report is still imported.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const unused = (files: Record<string, string>) => runCheck('thorough/refactor.mjs', 'unused-files', files, true)

describe('unused-files and files kept out of the scan', () => {
  test('a helper imported only by an ignored rule table is quiet', () => {
    const r = unused({
      '.meerkatignore': 'rules-*.mjs\n',
      'lib/helper.mjs': 'export const goodHelper = (x) => x + 1\n',
      'rules-a.mjs': "import { goodHelper } from './lib/helper.mjs'\nconsole.log(goodHelper(1))\n",
    })
    expect(r.out).not.toContain('lib/helper.mjs')
  })
  test('a file nothing imports still fails', () => {
    const r = unused({
      '.meerkatignore': 'rules-*.mjs\n',
      'lib/orphan.mjs': 'export const orphanHelper = (x) => x + 1\n',
      'rules-a.mjs': 'console.log(1)\n',
    })
    expect(r.code).toBe(1)
    expect(r.out).toContain('lib/orphan.mjs')
  })
})
