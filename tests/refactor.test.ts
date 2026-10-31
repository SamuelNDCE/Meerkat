// The refactor checks (thorough/refactor.mjs): each check must fail on its own fixture, and the six new checks must pass on a clean folder.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/refactor.mjs'
const ALL = ['duplicate-code', 'dead-code', 'file-length', 'long-functions', 'deep-nesting', 'commented-out-code', 'many-parameters', 'unused-files', 'cyclomatic-complexity']
const NEW = ['long-functions', 'deep-nesting', 'commented-out-code', 'many-parameters', 'unused-files', 'cyclomatic-complexity']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, anything else is a crash).
function exitCodeOf(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-refactor-'))
  made.push(dir)
  writeFileSync(join(dir, 'index.js'), 'console.log(1)\n')
  return dir
}

describe('refactor checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('the new refactor checks pass on a clean folder', () => {
  for (const check of NEW) {
    test(`${check} is clean on a one-file folder`, () => {
      expect(exitCodeOf([check, '--root', cleanFolder()])).toBe(0)
    })
  }
})

// Regression: a one-line arrow with an expression body (no brace) was measured up to the next "{" in the file, so a 2-line helper
// was reported as a 600-line function (Plume, src/modules/pdfedit.js hasEdits). The class below is long, so the old scan would flag it.
describe('long-functions: expression arrows are not blocks', () => {
  test('a one-line arrow followed by a long class is not reported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-refactor-'))
    made.push(dir)
    const body = Array.from({ length: 90 }, () => '  total += 1').join('\n')
    writeFileSync(join(dir, 'helpers.js'), `export const hasEdits = (d) => isDirty(st(d))\nexport const finite = (n) => (Number.isFinite(n) ? n : 0)\n\nclass Editor {\n${body}\n}\n`)
    expect(exitCodeOf(['long-functions', '--root', dir])).toBe(0)
  })
})
