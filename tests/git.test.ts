// The git checks (thorough/git.mjs): each check must fail on its own fixture, pass on a clean repository, report NOT RUN outside a repository, and the git pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/git.mjs'
const ALL = [
  'commit-message-format',
  'merge-commit-noise',
  'large-commits',
  'binary-in-history',
  'long-lived-branches',
  'branch-names',
  'tags-semver',
  'changelog-updated',
  'version-tag-match',
  'author-identity',
  'signed-commits-info',
  'gitmodules-pinned',
]
const LIMIT = 60_000

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code and printed output (0 clean, 1 findings, 75 NOT RUN).
function runCheck(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: LIMIT })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

// A throwaway repository on branch main, with a fixed identity and no signing.
function git(dir: string, args: string[], env: Record<string, string> = {}) {
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], {
    stdio: 'pipe',
    env: { ...process.env, ...env },
  })
}
function commit(dir: string, message: string, files: Record<string, string> = {}) {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '--allow-empty', '-m', message])
}
function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-git-test-'))
  made.push(dir)
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'pipe' })
  return dir
}

// One small repository with clean history in every shape the checks look at: a tag, a changelog kept current, a matching version.
function cleanRepo(): string {
  const dir = newRepo()
  commit(dir, 'Add the add helper', {
    'package.json': '{\n  "name": "clean",\n  "version": "1.0.0"\n}\n',
    'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- First release.\n',
    'src/add.js': 'export function add(a, b) {\n  return a + b\n}\n',
  })
  git(dir, ['tag', 'v1.0.0'])
  commit(dir, 'Add the subtract helper', {
    'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- First release.\n- Added subtract.\n',
    'src/sub.js': 'export function sub(a, b) {\n  return a - b\n}\n',
  })
  return dir
}

describe('git checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const { code, out } = runCheck([check, '--fixtures'])
      expect(code).toBe(1)
      expect(out).toMatch(/found \d+/)
    }, LIMIT)
  }
})

describe('git checks pass on a clean repository', () => {
  const dir = cleanRepo()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      const { code, out } = runCheck([check, '--root', dir])
      expect(code, out).toBe(0)
    }, LIMIT)
  }
})

describe('git checks outside a repository', () => {
  const plain = mkdtempSync(join(tmpdir(), 'meerkat-git-plain-'))
  made.push(plain)
  for (const check of ALL) {
    test(`${check} is NOT RUN, not a pass`, () => {
      const { code, out } = runCheck([check, '--root', plain])
      expect(code).toBe(75)
      expect(out).toContain('NOT RUN')
    }, LIMIT)
  }
})

describe('the git pack', () => {
  test('loads 12 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'git'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(12)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
