// The repo-docs checks (thorough/repo-docs.mjs): each must fail on its own fixture, pass on one clean folder, and the repo pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/repo-docs.mjs'
const ALL = [
  'readme-sections',
  'security-policy',
  'contributing-file',
  'codeowners-valid',
  'gitignore-essentials',
  'editorconfig-present',
  'changelog-format',
  'license-matches',
  'ci-present',
  'dependency-updates-configured',
]

const CLEAN: Record<string, string> = {
  'README.md': '# Demo\n\nA small demo tool.\n\n## Install\n\nRun npm install.\n\n## Usage\n\nRun npm start.\n\n## License\n\nMIT, see LICENSE.\n',
  'SECURITY.md': '# Security\n\nTo report a vulnerability, email security@example.org.\n',
  'CONTRIBUTING.md': '# Contributing\n\nOpen an issue first.\n',
  '.gitignore': 'node_modules/\n.env\n.DS_Store\nThumbs.db\n',
  '.editorconfig': 'root = true\n',
  LICENSE: 'MIT License\n\nCopyright (c) 2026 Demo\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n',
  'package.json': '{"name":"demo","license":"MIT"}\n',
  'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## 1.0.0\n',
  CODEOWNERS: '* @example/team\n',
  '.github/workflows/ci.yml': 'name: ci\non: push\n',
  '.github/dependabot.yml': 'version: 2\n',
}

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

function folderOf(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-repodocs-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

describe('repo-docs checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('repo-docs checks pass on one clean folder', () => {
  const clean = folderOf(CLEAN)
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', clean])).toBe(0)
    })
  }
})

describe('the repo pack loads', () => {
  test('all ten checks load with no bad-check-file entries', async () => {
    // packs/repo/ may hold other files too, so this asserts that these ten are present rather than an exact list.
    const checks = await loadChecks(join(ROOT, 'packs', 'repo'))
    const ids = checks.map((c) => c.id)
    expect(ids.filter((id) => id.startsWith('bad-check-file'))).toEqual([])
    for (const id of ALL) expect(ids).toContain(id)
  })
})
