// The packaging checks (thorough/packaging.mjs): each check must fail on its own fixture, pass on a clean folder, and the packaging pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/packaging.mjs'
const ALL = [
  'workspaces-resolve',
  'workspace-name-unique',
  'workspace-version-alignment',
  'workspace-internal-ranges',
  'workspace-cycles',
  'root-private',
  'npm-publish-files',
  'npm-entry-exist',
  'npm-pack-junk',
  'pypi-metadata',
  'pypi-entry-points',
  'crate-publish-ready',
  'version-sync',
  'provenance-hints',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean or not applicable, 1 findings, anything else is a crash).
function exitCodeOf(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

// One small publishable package with its own release workflow, done the right way.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-packaging-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0",\n  "main": "index.js",\n  "files": ["index.js"]\n}\n')
  put('index.js', 'module.exports = 1\n')
  put(
    '.github/workflows/release.yml',
    'name: release\non: push\npermissions:\n  id-token: write\n  contents: read\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish --provenance\n',
  )
  return dir
}

describe('packaging checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('packaging checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('the packaging pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'packaging'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
