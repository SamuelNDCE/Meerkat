// The guards around outside tools: a project that never chose eslint/prettier/stylelint rules is NOT RUN (exit 75), not judged by the tool's
// defaults; a command that could not reach its service is NOT RUN, not a failure; a skipped check in the results says what it was.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { buildResultsData } from '../lib/tui/results.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-guard-'))
  made.push(d)
  return d
}
const node = (args: string[], cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })

describe('offline-guard', () => {
  const guard = join(ROOT, 'thorough/offline-guard.mjs')
  const run = (script: string, pattern = 'cannot reach') => node([guard, '--offline', pattern, '--', process.execPath, '-e', script])
  test('a failure that matches the pattern is NOT RUN (75)', () => {
    const r = run('console.error("cannot reach the host"); process.exit(1)')
    expect(r.status).toBe(75)
    expect(r.stdout).toContain('NOT RUN')
  })
  test('a failure that does not match stays a failure (1)', () => {
    expect(run('console.error("a real problem"); process.exit(1)').status).toBe(1)
  })
  test('a pass stays a pass (0)', () => {
    expect(run('console.log("fine")').status).toBe(0)
  })
  test('a pass whose output mentions the pattern is still a pass', () => {
    expect(run('console.log("cannot reach nothing, all fine")').status).toBe(0)
  })
})

describe('config-guard', () => {
  const guard = join(ROOT, 'thorough/config-guard.mjs')
  test('an unknown tool is a usage error (2)', () => {
    expect(node([guard, '--bin', 'nope', '--', '.']).status).toBe(2)
  })
  test.each(['eslint', 'prettier', 'stylelint'])('%s in a folder with no configuration is NOT RUN or not installed (75)', (bin) => {
    const d = dir()
    writeFileSync(join(d, 'a.js'), 'var x = 1\n')
    const r = node([guard, '--bin', bin, '--root', d, '--', '.'], d)
    expect(r.status).toBe(75)
    expect(r.stdout).toContain('NOT RUN')
  })
})

describe('results: a check that did not run says what it is', () => {
  test('skipped, covered and turned-off checks carry their title', () => {
    const data = buildResultsData({
      summary: { results: [], selection: { skipped: ['a (no files changed in its paths)'], covered: ['b (by c)'], disabled: ['d'], titles: { a: 'Title A', b: 'Title B', d: 'Title D' } } },
    })
    const by = Object.fromEntries(data.checks.map((c: any) => [c.id, c]))
    expect(by.a.title).toBe('Title A')
    expect(by.b.title).toBe('Title B')
    expect(by.d.title).toBe('Title D')
    expect(by.a.status).toBe('NA')
  })
})
