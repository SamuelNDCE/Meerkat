// The config checks (thorough/config.mjs): each check must fail on its own fixture with a "found N" line, pass on a clean folder,
// honour the allow file, and the config pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/config.mjs'
const ALL = ['yaml-valid', 'toml-valid', 'gitattributes-eol', 'gitignored-but-tracked', 'compose-hygiene', 'ci-timeouts', 'ci-node-version-pinned', 'node-engines', 'tsconfig-strict']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code and printed output (0 clean, 1 findings, 75 not run, anything else is a crash).
function runCheck(args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// One small project with a safe shape of every file the checks read. It is a git repository, because gitignored-but-tracked needs one.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-config-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0",\n  "engines": { "node": ">=20" }\n}\n')
  put('.nvmrc', '20\n')
  put('.gitignore', 'node_modules/\n.env\n')
  put('config.toml', '[tool]\nname = "clean"\n')
  put('docker-compose.yml', 'services:\n  db:\n    image: postgres:16.4\n    environment:\n      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n    ports:\n      - "127.0.0.1:5432:5432"\n')
  put('.github/workflows/ci.yml', 'name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n')
  put('src/index.ts', 'export const a: number = 1\n')
  put('tsconfig.json', '{\n  // strict on\n  "compilerOptions": { "strict": true }\n}\n')
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  return dir
}

describe('config checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem with a found line`, () => {
      const r = runCheck([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('config checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      const r = runCheck([check, '--root', dir])
      expect(r.code).toBe(0)
    })
  }
})

describe('config checks honour the allow file', () => {
  test('a file named in .meerkat-config-allow is not reported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-config-allow-'))
    made.push(dir)
    writeFileSync(join(dir, 'ci.yml'), 'name: ci\njobs:\n\tbuild: 1\n')
    writeFileSync(join(dir, '.meerkat-config-allow'), '# accepted for the demo\nyaml-valid ci.yml\n')
    expect(runCheck(['yaml-valid', '--root', dir]).code).toBe(0)
  })
})

describe('the config pack', () => {
  test('loads 9 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'config'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(9)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
