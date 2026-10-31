// The quality checks (thorough/quality.mjs): each check must fail on its own fixture, pass on a clean folder, and the quality pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/quality.mjs'
const ALL = ['trailing-whitespace', 'final-newline', 'indent-consistency', 'line-length', 'debug-leftovers', 'skipped-tests', 'focused-tests', 'empty-catch', 'test-presence', 'duplicate-test-names', 'semver-valid', 'shell-hygiene', 'makefile-tabs', 'todo-hygiene']

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

// One small project with good code in every shape the checks look at.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-quality-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0"\n}\n')
  put('CHANGELOG.md', '# Changelog\n\n## [1.0.0]\n\n- First release\n')
  put('README.md', '# Clean\n\nA small example.\n')
  put('src/add.js', 'export function add(a, b) {\n\treturn a + b\n}\n')
  put('src/add.test.js', "import { add } from '../add.js'\n\ntest('adds two numbers', () => {\n\tif (add(1, 2) !== 3) throw new Error('bad')\n})\n")
  put('scripts/run.sh', '#!/usr/bin/env bash\nset -euo pipefail\necho ok\n')
  put('Makefile', '.PHONY: all clean test\n\nall:\n\tnode src/add.js\n\nclean:\n\trm -f out\n\ntest:\n\tnode --test\n')
  return dir
}

describe('quality checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('quality checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('the quality pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'quality'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
