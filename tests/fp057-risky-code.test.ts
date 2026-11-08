// risky-code: a comment line that names a banned call, and a SHA-1 cut to a short folder id, are not risks.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const risky = (name: string, body: string) => runCheck('thorough/static.mjs', 'risky-code', { [name]: body })
// A line starting with / after a name makes the scanner unsure whether it reads a division or a regex, so it cannot confirm the comments in the file.
const UNSURE = 'const total = base\n  / count / 2\n'

describe('risky-code and comments or short ids', () => {
  test('a comment naming dangerouslySetInnerHTML is quiet even when the file could not be read with certainty', () => {
    expect(risky('a.tsx', `${UNSURE}// Nothing here uses dangerouslySetInnerHTML.\nexport const A = () => <p>{total}</p>\n`).code).toBe(0)
  })
  test('real dangerouslySetInnerHTML in the same unsure file still fails', () => {
    expect(risky('a.tsx', `${UNSURE}export const A = ({ html }) => <p dangerouslySetInnerHTML={{ __html: html }} />\n`).code).toBe(1)
  })
  test('a SHA-1 cut to 6 hex characters to name a folder is quiet', () => {
    expect(risky('a.mjs', "import { createHash } from 'node:crypto'\nexport const folderId = (p) => createHash('sha1').update(p).digest('hex').slice(0, 6)\n").code).toBe(0)
  })
  test('a full-length SHA-1 digest still fails', () => {
    expect(risky('a.mjs', "import { createHash } from 'node:crypto'\nexport const h = (p) => createHash('sha1').update(p).digest('hex')\n").code).toBe(1)
  })
  test('a SHA-1 cut short next to a password still fails', () => {
    expect(risky('a.mjs', "import { createHash } from 'node:crypto'\nconst password = readPassword()\nexport const h = createHash('sha1').update(password).digest('hex').slice(0, 6)\n").code).toBe(1)
  })
})
