// The repo file checks (thorough/repo-files.mjs): each check fails on its own fixture, passes on a clean folder, and the pack loads.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/repo-files.mjs'
const ALL = [
  'generated-files-tracked',
  'case-conflicts',
  'long-paths',
  'reserved-names',
  'non-ascii-filenames',
  'symlinks-tracked',
  'exec-bits',
  'package-fields',
  'lockfile-sync',
  'deprecated-deps',
]
// Checks that read the git index: they pass with a note on a plain folder, so the clean-folder test gives them a repository.
const NEEDS_GIT = ['symlinks-tracked', 'exec-bits']

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
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-repofiles-'))
  made.push(dir)
  writeFileSync(join(dir, 'index.js'), 'console.log(1)\n')
  return dir
}

// A clean folder that is a git repository with one commit.
function cleanGitFolder(): string {
  const dir = cleanFolder()
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  return dir
}

describe('repo file checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('repo file checks pass on a clean folder', () => {
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      const dir = NEEDS_GIT.includes(check) ? cleanGitFolder() : cleanFolder()
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('repo pack', () => {
  test('the pack loads with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs/repo'))
    const mine = checks.filter((c: any) => c.source === 'repo-files.mjs')
    expect(mine.map((c: any) => c.id).sort()).toEqual([...ALL].sort())
    expect(checks.filter((c: any) => String(c.id).startsWith('bad-check-file-repo-files'))).toHaveLength(0)
  })
})
