// The supply-chain checks (thorough/sec-supply.mjs) and the security-plus pack: each check must fail on its own fixture,
// pass on a clean repository, and the git checks must refuse a folder that is not a repository.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/sec-supply.mjs'
const IDS = ['git-history-secrets', 'env-files-in-history', 'install-scripts', 'typosquat-names', 'docker-base-pinning', 'actions-secrets-echo', 'requirements-hashes', 'lockfile-registry-hosts']
const GIT_IDS = ['git-history-secrets', 'env-files-in-history']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, 75 cannot run, anything else is a crash).
function exitCodeOf(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, '-c', 'user.name=meerkat', '-c', 'user.email=meerkat@example.invalid', ...args], { stdio: 'pipe' })
}

function plainFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-supply-plain-'))
  made.push(dir)
  writeFileSync(join(dir, 'index.js'), 'console.log(1)\n')
  return dir
}

// A small repository with every file the checks read, all of it clean, committed so the history and tracked-file checks see it.
function cleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-supply-clean-'))
  made.push(dir)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'clean', version: '1.0.0', dependencies: { express: '4.19.2' } }) + '\n',
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/express': { version: '4.19.2', resolved: 'https://registry.npmjs.org/express/-/express-4.19.2.tgz' } } }) + '\n',
    Dockerfile: 'FROM node:20.11.1-alpine\nWORKDIR /app\nUSER node\nCMD ["node", "index.js"]\n',
    '.github/workflows/ci.yml': 'name: ci\non: push\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "build"\n',
    'requirements.txt': 'requests==2.31.0\n',
    'Cargo.toml': '[package]\nname = "clean"\nversion = "1.0.0"\n\n[dependencies]\nserde = "1"\n',
    'Cargo.lock': 'version = 3\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
    'index.js': 'console.log(1)\n',
  }
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  git(dir, ['init', '-q'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'clean'])
  return dir
}

const clean = cleanRepo()

describe('each supply check fails on its own fixture', () => {
  for (const id of IDS) {
    test(`${id} reports its deliberate problem`, () => {
      expect(exitCodeOf([id, '--fixtures'])).toBe(1)
    })
  }
})

describe('each supply check passes on a clean repository', () => {
  for (const id of IDS) {
    test(`${id} is clean`, () => {
      expect(exitCodeOf([id, '--root', clean])).toBe(0)
    })
  }
})

describe('the git checks refuse a folder that is not a repository', () => {
  for (const id of GIT_IDS) {
    test(`${id} exits 75 (not run), never a quiet pass`, () => {
      expect(exitCodeOf([id, '--root', plainFolder()])).toBe(75)
    })
  }
})

test('the security-plus pack loads with no bad-check-file entries from sec-supply.mjs', async () => {
  const checks = await loadChecks(join(ROOT, 'packs', 'security-plus'))
  const mine = checks.filter((c: any) => c.source === 'sec-supply.mjs')
  expect(mine.filter((c: any) => String(c.id).startsWith('bad-check-file'))).toEqual([])
  expect(mine.map((c: any) => c.id).sort()).toEqual([...IDS].sort())
})
