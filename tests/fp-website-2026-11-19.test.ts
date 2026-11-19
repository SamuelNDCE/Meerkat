// False positives from the website session (2026-11-19): an IPv4-looking number in SVG path data or with a leading zero is not an address;
// a JSON-LD script tag set with dangerouslySetInnerHTML is serialised repo data, not an injection sink. The real cases still fail.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function run(script: string, check: string, files: Record<string, string>): number {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fpw-'))
  made.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  try {
    execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}
const ip = (files: Record<string, string>) => run('thorough/sec-code.mjs', 'hardcoded-ip', files)
const risky = (files: Record<string, string>) => run('thorough/static.mjs', 'risky-code', files)

test('hardcoded-ip: SVG path data and leading-zero octets are quiet, a real public address still fails', () => {
  expect(ip({ 'app/Footer.tsx': '<path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037" />\n' })).toBe(0)
  expect(ip({ 'app/Footer.tsx': 'const v = "3.03.078.078"\n' })).toBe(0)
  expect(ip({ 'src/config.js': "const API_HOST = '52.14.201.77'\n" })).toBe(1)
})

test('risky-code: a JSON-LD script tag with serialised data is quiet, a plain dangerouslySetInnerHTML still fails', () => {
  expect(risky({ 'app/page.tsx': '<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />\n' })).toBe(0)
  expect(risky({ 'app/page.tsx': '<div dangerouslySetInnerHTML={{ __html: userHtml }} />\n' })).toBe(1)
})
