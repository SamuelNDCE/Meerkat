// The health checks (thorough/health.mjs): each check must fail on its own fixture, pass on a clean folder, and the health pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/health.mjs'
const ALL = [
  'sync-fs-in-handlers',
  'json-parse-in-loop',
  'regex-in-loop',
  'dom-query-in-loop',
  'large-inline-assets',
  'unoptimised-images',
  'duplicate-dependencies',
  'wildcard-versions',
  'dependency-count',
  'dev-deps-in-prod',
  'deprecated-apis',
  'node-version-mismatch',
  'lockfile-in-sync',
  'unused-dependencies-quick',
]

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

// One small application with clean code and a consistent manifest.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-health-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0",\n  "private": true,\n  "dependencies": {}\n}\n')
  put('src/add.js', 'export function add(a, b) {\n\treturn a + b\n}\n')
  put('src/server.js', "import { add } from '../add.js'\nconst total = [1, 2].reduce((s, n) => add(s, n), 0)\nexport default total\n")
  return dir
}

describe('health checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('health checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('the health pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'health'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
