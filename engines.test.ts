// The engines checks (thorough/engines.mjs): each check must fail on its own fixture with a "found N" line, pass as not applicable on a plain
// folder, honour .meerkat-engines-allow, and the engines pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/engines.mjs'
const ALL = [
  'unity-meta-files',
  'unity-gitignore',
  'unity-serialization',
  'unity-large-assets',
  'unity-script-hazards',
  'godot-project',
  'godot-script-hazards',
  'unreal-hygiene',
  'shopify-theme-basics',
  'liquid-hygiene',
  'shopify-secrets',
  'wordpress-hygiene',
  'wordpress-config',
  'static-site-generator',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 pass, 1 findings, 75 not run, anything else a crash) and its output.
function runCheck(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// A folder with the given files (path to text), removed after the run.
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-engines-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// A plain Node project: none of the fourteen applies, so each check must say "not applicable" and pass.
const plain = () => folder({ 'package.json': '{\n  "name": "plain",\n  "version": "1.0.0"\n}\n', 'README.md': '# Plain\n', 'src/add.js': 'export const add = (a, b) => a + b\n' })

describe('engines checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem with a found line`, () => {
      const r = runCheck([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('engines checks pass as not applicable on a plain folder', () => {
  const dir = plain()
  for (const check of ALL) {
    test(`${check} is not applicable`, () => {
      const r = runCheck([check, '--root', dir])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/not applicable/)
    })
  }
})

describe('the allow file', () => {
  test('an accepted finding passes, named by check id and path', () => {
    const dir = folder({
      'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.1f1\n',
      'Assets/Player.cs': 'class Player {}\n',
      '.meerkat-engines-allow': '# accepted for this fixture\nunity-meta-files Assets/Player.cs\n',
    })
    made.push(dir)
    expect(runCheck(['unity-meta-files', '--root', dir]).code).toBe(0)
  })
})

describe('the engines pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'engines'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
