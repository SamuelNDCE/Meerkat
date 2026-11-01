import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// What `npm publish` would ship: the program and what self-test needs, never tests, build output or binaries (a real publish attempt once listed a
// 3 MB .pdb and an .exe from a fixture's target folder).
describe('the npm package contents', () => {
  const list = (): string[] => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const out = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: join(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' })
    return JSON.parse(out)[0].files.map((f: { path: string }) => f.path.split(String.fromCharCode(92)).join('/'))
  }
  test('has the commands and the fixtures self-test needs', () => {
    const files = list()
    for (const f of ['bin/meerkat.mjs', 'bin/meerkat-mcp.mjs', 'run.mjs', 'package.json', 'LICENSE', 'README.md', 'fixtures/tools/eslint/broken.js']) expect(files, f).toContain(f)
  })
  test('has no test files, build output, binaries or node_modules', () => {
    const bad = list().filter((f) => /[.]test[.](ts|mjs|js)$/.test(f) || /(^|[/])target[/]/.test(f) || /[.](exe|pdb|dll|o|rlib)$/.test(f) || /(^|[/])node_modules[/]/.test(f))
    expect(bad).toEqual([])
  })
  test('stays small', () => {
    expect(list().length).toBeLessThan(400)
  })
})
