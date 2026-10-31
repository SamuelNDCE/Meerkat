// The a11y checks (thorough/a11y.mjs) and their pack: each check must fail on its own fixture, pass on a clean folder, and the pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/a11y.mjs'
const ALL = ['aria-valid', 'link-text', 'focus-visible', 'zoom-allowed', 'reduced-motion', 'iframe-title', 'table-headers', 'image-alt-quality', 'media-captions', 'sri-missing', 'mixed-content', 'render-blocking']

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

// A small page and stylesheet that every check accepts.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-a11y-'))
  made.push(dir)
  mkdirSync(join(dir, 'css'), { recursive: true })
  writeFileSync(
    join(dir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Clean sample page for checks</title>',
      '<link rel="canonical" href="https://example.com/">',
      '<link rel="stylesheet" href="css/style.css">',
      '<script src="app.js" defer></script>',
      '</head>',
      '<body>',
      '<main>',
      '<h1>Welcome</h1>',
      '<p><a href="/about">About the team</a></p>',
      '<img src="cat.png" width="200" height="120" alt="A tabby cat asleep on a windowsill">',
      '<table><tr><th scope="col">Name</th><th scope="col">Role</th></tr></table>',
      '<iframe src="/map.html" title="Office map"></iframe>',
      '<video src="intro.mp4" controls><track kind="captions" src="intro.vtt"></video>',
      '<button type="button">Save</button>',
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(dir, 'css', 'style.css'),
    [
      'body { color: #222222; background: #ffffff; }',
      'button:focus-visible { outline: 2px solid #005fcc; }',
      '.card { transition: color 0.2s; }',
      '@media (prefers-reduced-motion: reduce) { .card { transition: none; } }',
      '',
    ].join('\n'),
  )
  return dir
}

describe('a11y checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('a11y checks pass on a clean folder', () => {
  for (const check of ALL) {
    test(`${check} is clean on a good page and stylesheet`, () => {
      expect(exitCodeOf([check, '--root', cleanFolder()])).toBe(0)
    })
  }
})

describe('the a11y pack loads', () => {
  test('all twelve checks load with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'a11y'))
    const ids = checks.map((c: { id: string }) => c.id)
    expect(ids.filter((id: string) => id.startsWith('bad-check-file'))).toEqual([])
    expect(ids.sort()).toEqual([...ALL].sort())
  })
})
