// tools/gen-accuracy-results.mjs turns a corpus run output into docs/accuracy-results.md; tested on a tiny fake run output.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FAKE = [
  'running node-api',
  'running node-api-clean',
  'OK   node-api:js-eval [risky-code] server.js:19 => risky-code/risky-call',
  'OK   node-api:js-empty-catch [empty-catch] server.js:63 => empty-catch/-',
  'MISS node-api:js-cors-wildcard [cors-wildcard] server.js:12 => ',
  'OK   node-api:js-sql-concat [sql-concat] server.js:33 => sql-concat/-',
  '',
].join('\n')

describe('tools/gen-accuracy-results.mjs', () => {
  test('summary numbers, tier table, and one defect row come from the run output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-genacc-'))
    const input = join(dir, 'run.txt')
    const out = join(dir, 'results.md')
    const readme = join(dir, 'readme.md')
    writeFileSync(input, FAKE)
    execFileSync(process.execPath, [join(root, 'tools', 'gen-accuracy-results.mjs'), input, '--out', out, '--readme', readme], { cwd: root, stdio: 'pipe' })
    const md = readFileSync(out, 'utf8')
    expect(md).toContain('- Planted defects: 4')
    expect(md).toContain('- Found by a check: 3 (75.0%)')
    expect(md).toContain('- Missed: 1')
    expect(md).toContain('1 clean twins were run')
    expect(md).toMatch(/\| critical \| 2 \| 2 \| 100\.0% \|/)
    expect(md).toMatch(/\| hard \| 1 \| 0 \| 0\.0% \|/)
    expect(md).toMatch(/\| `js-eval` \| critical \| [\w-]+ \| `risky-code` \| OK \|/)
    expect(md).toMatch(/\| `js-cors-wildcard` \| hard \| [\w-]+ \| `cors-wildcard` \| MISS \|/)
    const section = readFileSync(readme, 'utf8')
    expect(section).toContain('4 deliberately planted defects')
    expect(section).toContain('docs/accuracy-results.md')
    expect(section).toContain('not real-world accuracy')
  })
})
