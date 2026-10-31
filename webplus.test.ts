// The web-plus checks (thorough/web-plus.mjs): each check must fail on its own fixture with a "found N" line, pass on a clean folder, and the web-plus pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/web-plus.mjs'
const ALL = ['html-valid-basics', 'duplicate-ids', 'inline-event-handlers', 'target-blank-noopener', 'csp-present', 'image-dimensions', 'robots-sitemap', 'manifest-valid', 'css-important-overuse']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, anything else is a crash) and its printed output.
function runCheck(args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// One small site with good markup in every shape the checks look at.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-webplus-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('index.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
    '<title>Clean</title>',
    '<link rel="stylesheet" href="app.css">',
    '<link rel="manifest" href="site.webmanifest">',
    '</head>',
    '<body>',
    '<main>',
    '<h1>Clean</h1>',
    '<img src="logo.svg" alt="Logo" width="10" height="10">',
    '<a href="https://example.com/" target="_blank" rel="noopener">Example</a>',
    '<button type="button" id="go">Go</button>',
    '</main>',
    '<script src="app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'))
  put('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n')
  put('app.css', '.card {\n  color: #222;\n}\n')
  put('app.js', 'document.getElementById("go")?.addEventListener("click", () => {})\n')
  put('robots.txt', 'User-agent: *\nAllow: /\n')
  put('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n')
  put('site.webmanifest', '{\n  "name": "Clean",\n  "icons": [{ "src": "logo.svg", "sizes": "any", "type": "image/svg+xml" }],\n  "start_url": "/"\n}\n')
  return dir
}

describe('web-plus checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const { code, out } = runCheck([check, '--fixtures'])
      expect(code).toBe(1)
      expect(out).toMatch(/found \d+/)
    })
  }
})

describe('web-plus checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(runCheck([check, '--root', dir]).code).toBe(0)
    })
  }
})

describe('the web-plus pack', () => {
  test('loads 9 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'web-plus'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(9)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
