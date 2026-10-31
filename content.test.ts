// The content checks (thorough/content.mjs): each check must fail on its own fixture with a "found N" line, pass on a clean folder, and the content pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/content.mjs'
const ALL = [
  'markdown-headings',
  'markdown-code-fences',
  'markdown-anchors',
  'changelog-version-headings',
  'changelog-vs-version',
  'readme-install-usage',
  'i18n-keys-match',
  'i18n-placeholders',
  'json-duplicate-keys',
  'csv-consistent',
  'dead-assets',
  'large-json-or-data',
  'spell-common-typos',
  'unicode-control-chars',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, anything else is a crash) and its output.
function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return { code: 0, out: out.toString() }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// One small project with good content in every shape the checks look at.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-content-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('package.json', '{\n  "name": "clean",\n  "version": "1.0.0"\n}\n')
  put('CHANGELOG.md', '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- First release\n\n## 0.9.0\n\n- Early work\n')
  put(
    'README.md',
    '# Clean\n\nA small example tool that adds numbers together for a demo, so you can see how a project is laid out.\n\n## Install\n\nRun npm install in the folder.\n\n## Usage\n\nSee [install](#install) first, then call the add function from your code.\n',
  )
  put('docs/guide.md', '# Guide\n\n## Steps\n\n```js\nconst total = 1 + 2\n```\n\n```bash\necho done\n```\n\n```text\nplain output\n```\n')
  put('src/add.js', 'export function add(a, b) {\n\treturn a + b\n}\n')
  put('config.json', '{\n  "name": "clean",\n  "tags": ["a", "b"]\n}\n')
  put('data/rows.csv', 'name,count\nwidgets,4\ngears,9\n')
  put('locales/en.json', '{"greet": "Hello {name}", "bye": "Goodbye"}\n')
  put('locales/fr.json', '{"greet": "Bonjour {name}", "bye": "Au revoir"}\n')
  put('public/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n')
  put('index.html', '<!doctype html>\n<img src="logo.svg" alt="logo">\n')
  return dir
}

describe('content checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const r = run([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('content checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(run([check, '--root', dir]).code).toBe(0)
    })
  }
})

describe('the content pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'content'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
