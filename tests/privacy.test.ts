// The privacy checks (thorough/privacy.mjs): each check must fail on its own fixture, pass on a clean folder, and the privacy pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/privacy.mjs'
const ALL = [
  'third-party-trackers',
  'analytics-consent',
  'pii-in-logs',
  'pii-patterns-in-source',
  'telemetry-calls',
  'telemetry-disclosure',
  'privacy-policy-file',
  'external-fonts-cdn',
  'geolocation-and-media-requests',
  'local-storage-pii',
  'notice-file',
  'lockfile-licenses',
  'license-header-consistency',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 pass, 1 findings, anything else is a crash).
function exitCodeOf(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

// One small permissive project with nothing private in it: no trackers, no personal data, no permission prompts.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-privacy-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0",\n  "license": "MIT",\n  "main": "src/add.js"\n}\n')
  put('LICENSE', 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n')
  put('README.md', '# Clean\n\nA small example.\n')
  put('src/add.js', 'export function add(a, b) {\n\treturn a + b\n}\n')
  return dir
}

describe('privacy checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('privacy checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('the privacy pack', () => {
  test('loads 13 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'privacy'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(13)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
