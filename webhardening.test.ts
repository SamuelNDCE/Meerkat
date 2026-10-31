// The web-hardening checks (thorough/web-hardening.mjs, tables in thorough/rules-web-hardening.mjs): each check must fail on its own
// fixture with a "found N" line, pass on a clean folder, every rule must prove itself, and the web-hardening pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { HEADERS, HTML, PUBLISH, SUPPLY } from './thorough/rules-web-hardening.mjs'
// @ts-expect-error plain JS module
import { hitsIn, selfProve } from './thorough/web-hardening.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/web-hardening.mjs'
const ALL = ['wh-headers', 'wh-html', 'wh-publish-root', 'wh-supply']

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

// A small, well-configured site: every header rule that applies is satisfied, the markup is clean, nothing is published by mistake.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-webhardening-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put('nginx.conf', [
    'server {',
    '  listen 443 ssl http2;',
    '  server_name example.com;',
    '  server_tokens off;',
    '  ssl_protocols TLSv1.2 TLSv1.3;',
    '  ssl_prefer_server_ciphers on;',
    '  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256;',
    '  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
    '  add_header X-Frame-Options "DENY" always;',
    '  add_header X-Content-Type-Options "nosniff" always;',
    '  add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '  add_header Permissions-Policy "camera=(), microphone=()" always;',
    '  add_header Content-Security-Policy "default-src \'self\'; script-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'none\'" always;',
    '  add_header Cross-Origin-Opener-Policy "same-origin" always;',
    '  add_header Cross-Origin-Embedder-Policy "require-corp" always;',
    '  add_header Cross-Origin-Resource-Policy "same-origin" always;',
    '}',
    '',
  ].join('\n'))
  put('index.html', [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Clean</title>',
    '</head>',
    '<body>',
    '<h1>Clean</h1>',
    '<h2>Section</h2>',
    '<p><a href="/about">About</a></p>',
    '</body>',
    '</html>',
    '',
  ].join('\n'))
  return dir
}

describe('web-hardening checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const { code, out } = runCheck([check, '--fixtures'])
      expect(code).toBe(1)
      expect(out).toMatch(/found \d+/)
    })
  }
})

describe('web-hardening checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean and prints PASS sub-check lines`, () => {
      const { code, out } = runCheck([check, '--root', dir])
      expect(code).toBe(0)
      expect(out).toMatch(/MEERKAT-SUB (PASS|NA) /)
      expect(out).not.toMatch(/MEERKAT-SUB FAIL /)
    })
  }
  test('headers that do not apply report NA, never FAIL', () => {
    const { out } = runCheck(['wh-supply', '--root', dir])
    expect(out).toMatch(/MEERKAT-SUB NA lockfile-entry-no-integrity/)
  })
})

describe('the rule tables', () => {
  test('every table proves every rule (bad sample found, good sample not)', () => {
    for (const table of [HEADERS, HTML, PUBLISH, SUPPLY]) expect(selfProve(table)).toEqual([])
  })
  test('there are at least 90 rules across the four checks', () => {
    expect(HEADERS.length + HTML.length + PUBLISH.length + SUPPLY.length).toBeGreaterThanOrEqual(90)
  })
  test('the vulnerable-library table cites its advisory (jQuery 3.5.0 blog post)', () => {
    const rule = SUPPLY.find((r: { id: string }) => r.id === 'vendored-jquery-below-3-5')
    expect(rule).toBeDefined()
  })
})

describe('regular expressions stay linear on hostile input', () => {
  test('every rule finishes a 400 KB adversarial line in well under 5 seconds', () => {
    const hostile = ' '.repeat(100000) + 'a'.repeat(100000) + '<input type="password"'.repeat(5000) + 'max-age='.repeat(5000) + '\u0000'.repeat(1000)
    const tables = [HEADERS, HTML, PUBLISH, SUPPLY]
    const started = Date.now()
    for (const table of tables) {
      for (const rule of table) {
        if (rule.path) rule.path.test(hostile)
        else hitsIn(rule, rule.sample ?? 'x.txt', hostile)
      }
    }
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('the web-hardening pack', () => {
  test('loads 4 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'web-hardening'))
    expect(checks.filter((c: { id: string }) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(4)
    expect(checks.map((c: { id: string }) => c.id).sort()).toEqual([...ALL].sort())
  })
})


describe('regressions found in review', () => {
  const headerRun = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-wh-review-'))
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b)
    try {
      return execFileSync(process.execPath, ['thorough/web-hardening.mjs', 'wh-headers', '--root', dir], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
    } catch (e: any) {
      return String(e.stdout ?? '')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  test('a header set in nginx.conf is not reported missing for server.js, and helmet() counts', () => {
    const hsts = 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
    const out = headerRun({ 'nginx.conf': 'server {\n listen 443 ssl;\n ' + hsts + '\n}\n', 'server.js': 'const app = express()\napp.use(x)\n' })
    expect(out).not.toMatch(/FAIL hsts-missing/)
    const helmetOut = headerRun({ 'server.js': 'const app = express()\napp.use(helmet())\n' })
    expect(helmetOut).not.toMatch(/FAIL (hsts|xfo|xcto|referrer-policy)-missing/)
    expect(headerRun({ 'server.js': 'const app = express()\napp.use(x)\n' })).toMatch(/FAIL hsts-missing/)
  })
  test('an unquoted type=password input is found, a marquee-component element is not a marquee', () => {
    const rule = (id: string): any => [...HTML].find((r: any) => r.id === id)
    expect(rule('password-input-no-autocomplete').test('<input name="p" type=password>')).toBe(true)
    expect(rule('marquee-or-blink').test('<marquee-component></marquee-component>')).toBe(false)
    expect(rule('marquee-or-blink').test('<marquee>x</marquee>')).toBe(true)
  })
  test('the private-key rule ignores public keys', () => {
    const r: any = [...PUBLISH].find((x: any) => x.id === 'private-key-file')
    expect(r.path.test('certs/server.key') && !r.notIn.test('certs/server.key')).toBe(true)
    expect(r.notIn.test('scripts/backup-public-key.pem')).toBe(true)
  })
})

