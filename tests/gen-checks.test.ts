// tools/gen-checks.mjs rewrites the generated blocks in docs/checks.md; a committed copy must already match what it writes.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('tools/gen-checks.mjs', () => {
  test('running it leaves docs/checks.md unchanged, and its headings nest one level at a time', () => {
    const before = readFileSync(join(root, 'docs', 'checks.md'), 'utf8')
    execFileSync(process.execPath, [join(root, 'tools', 'gen-checks.mjs')], { cwd: root, stdio: 'pipe' })
    const after = readFileSync(join(root, 'docs', 'checks.md'), 'utf8')
    expect(after).toBe(before)
    const levels = after.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => l.indexOf(' '))
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
  })
})
