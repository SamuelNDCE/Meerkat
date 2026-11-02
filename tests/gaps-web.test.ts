// Detection gaps closed in the web-security and package checks. Every case has both sides: the planted shape now reports, and a
// similar clean shape does not (a rule that fires on safe code is worse than a gap).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { HEADERS, HTML, SUPPLY } from '../thorough/rules-web-hardening.mjs'
// @ts-expect-error plain JS module
import { hitsIn } from '../thorough/web-hardening.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// True when the rule reports the text as if it were the file at `path`.
const fires = (table: any[], id: string, path: string, text: string): boolean => {
  const rule = table.find((r: any) => r.id === id)
  expect(rule, id).toBeTruthy()
  const hits = hitsIn(rule, path, text)
  return Array.isArray(hits) && hits.length > 0
}

// Runs one thorough check over a folder holding the given files and returns its exit code (1 = findings).
function runCheck(script: string, check: string, files: Record<string, string>): number {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-gaps-web-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  try {
    execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

describe('wh-headers', () => {
  test('a Caddy CSP with unsafe-inline scripts reports, a strict one does not', () => {
    expect(fires(HEADERS, 'csp-unsafe-inline-script', 'Caddyfile', `example.com {\n  header Content-Security-Policy "script-src 'self' 'unsafe-inline'"\n}\n`)).toBe(true)
    expect(fires(HEADERS, 'csp-unsafe-inline-script', 'Caddyfile', `example.com {\n  header Content-Security-Policy "script-src 'self'"\n}\n`)).toBe(false)
  })

  test('helmet with HSTS or the CSP turned off reports, helmet with defaults does not', () => {
    expect(fires(HEADERS, 'helmet-hsts-off', 'src/server-helmet.js', 'app.use(helmet({ hsts: false }))\n')).toBe(true)
    expect(fires(HEADERS, 'helmet-hsts-off', 'src/server-helmet.js', 'app.use(helmet())\n')).toBe(false)
    expect(fires(HEADERS, 'helmet-hsts-off', 'src/server-helmet.js', 'app.use(helmet({ hsts: { maxAge: 31536000 } }))\n')).toBe(false)
    expect(fires(HEADERS, 'helmet-csp-off', 'src/server-helmet.js', 'app.use(helmet({ contentSecurityPolicy: false }))\n')).toBe(true)
    expect(fires(HEADERS, 'helmet-csp-off', 'src/server-helmet.js', 'app.use(helmet({ contentSecurityPolicy: { directives: {} } }))\n')).toBe(false)
    // A file that never mentions helmet is out of scope even with the same words.
    expect(fires(HEADERS, 'helmet-csp-off', 'src/other.js', 'const o = { contentSecurityPolicy: false }\n')).toBe(false)
  })

  test('a session cookie with httpOnly false reports, httpOnly true does not', () => {
    const base = (v: string) => `const session = require('express-session')\napp.use(session({\n  secret: s,\n  cookie: {\n    httpOnly: ${v},\n  },\n}))\n`
    expect(fires(HEADERS, 'session-cookie-no-httponly', 'src/server-cookie.js', base('false'))).toBe(true)
    expect(fires(HEADERS, 'session-cookie-no-httponly', 'src/server-cookie.js', base('true'))).toBe(false)
  })

  test('app.enable x-powered-by reports, disable and helmet do not', () => {
    const head = "const express = require('express')\nconst app = express()\n"
    expect(fires(HEADERS, 'express-x-powered-by-enabled', 'src/server-powered.js', `${head}app.enable('x-powered-by')\n`)).toBe(true)
    expect(fires(HEADERS, 'express-x-powered-by-enabled', 'src/server-powered.js', `${head}app.disable('x-powered-by')\n`)).toBe(false)
    expect(fires(HEADERS, 'express-x-powered-by-enabled', 'src/server-other.js', `${head}app.listen(3000)\n`)).toBe(false)
    expect(fires(HEADERS, 'express-x-powered-by-enabled', 'server.js', `${head}app.use(helmet())\n`)).toBe(false)
  })

  test('the request Origin echoed back reports, a fixed origin does not', () => {
    expect(fires(HEADERS, 'cors-reflects-request-origin', 'src/server-cors.js', "res.setHeader('Access-Control-Allow-Origin', req.headers.origin)\n")).toBe(true)
    expect(fires(HEADERS, 'cors-reflects-request-origin', 'src/server-cors.js', "res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')\n")).toBe(false)
  })
})

describe('wh-html and wh-publish-root', () => {
  test('an iframe with no sandbox over several lines reports, one with sandbox over several lines does not', () => {
    const bare = '<main>\n<iframe\n  src="https://widgets.example.com/x"\n  title="Widget"\n></iframe>\n</main>\n'
    const boxed = '<main>\n<iframe\n  src="https://widgets.example.com/x"\n  title="Widget"\n  sandbox="allow-scripts"\n></iframe>\n</main>\n'
    const rule = HTML.find((r: any) => r.id === 'iframe-no-sandbox')
    expect(hitsIn(rule, 'site/a.html', bare)).toEqual(['site/a.html:2'])
    expect(hitsIn(rule, 'site/a.html', boxed)).toEqual([])
  })

  test('a source map in a published folder reports, an ordinary json file does not', () => {
    const map = '{"version":3,"sources":["a.js"],"mappings":"AAAA"}\n'
    expect(fires(HTML, 'sourcemap-shipped', 'public/app.js.map', map)).toBe(true)
    expect(fires(HTML, 'sourcemap-shipped', 'public/app.js', 'console.log(1)\n')).toBe(false)
    expect(fires(HTML, 'sourcemap-shipped', 'public/data.map', '{"name":"x","tiles":[1,2]}\n')).toBe(false)
  })
})

describe('wh-supply', () => {
  test('strict-ssl off with spaces around = reports, strict-ssl true does not', () => {
    expect(fires(SUPPLY, 'npmrc-strict-ssl-off', 'pkgs/n/.npmrc', 'strict-ssl = false\n')).toBe(true)
    expect(fires(SUPPLY, 'npmrc-strict-ssl-off', 'pkgs/n/.npmrc', 'strict-ssl=false\n')).toBe(true)
    expect(fires(SUPPLY, 'npmrc-strict-ssl-off', 'pkgs/n/.npmrc', 'strict-ssl = true\n')).toBe(false)
  })
})

describe('wildcard-versions', () => {
  const pj = (range: string, section = 'dependencies') => ({ 'package.json': `{\n  "name": "p", "version": "1.0.0",\n  "${section}": {\n    "left": "${range}"\n  }\n}\n` })
  test('an open >= range and a 1.x range report', () => {
    expect(runCheck('thorough/health.mjs', 'wildcard-versions', pj('>=1.0.0'))).toBe(1)
    expect(runCheck('thorough/health.mjs', 'wildcard-versions', pj('1.x'))).toBe(1)
  })
  test('caret, tilde, exact, bounded and peer ranges do not', () => {
    for (const r of ['^1.2.3', '~1.2.3', '1.2.3', '>=1.0.0 <2.0.0']) expect(runCheck('thorough/health.mjs', 'wildcard-versions', pj(r))).toBe(0)
    expect(runCheck('thorough/health.mjs', 'wildcard-versions', pj('>=16', 'peerDependencies'))).toBe(0)
  })
})

describe('ui-static and mixed-content', () => {
  const page = (body: string) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>T</title>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`
  test('a positive tabindex in single quotes reports, tabindex 0 and -1 do not', () => {
    expect(runCheck('thorough/hygiene.mjs', 'ui-static', { 'site/t.html': page("<div tabindex='3'>x</div>") })).toBe(1)
    expect(runCheck('thorough/hygiene.mjs', 'ui-static', { 'site/t.html': page('<div tabindex="0">x</div><div tabindex=\'-1\'>y</div>') })).toBe(0)
  })
  test('a script over plain http reports, an https script and a localhost script do not', () => {
    expect(runCheck('thorough/a11y.mjs', 'mixed-content', { 'site/s.html': page('<script src="http://cdn.example.com/lib.js"></script>') })).toBe(1)
    expect(runCheck('thorough/a11y.mjs', 'mixed-content', { 'site/s.html': page('<script src="https://cdn.example.com/lib.js"></script>') })).toBe(0)
    expect(runCheck('thorough/a11y.mjs', 'mixed-content', { 'site/s.html': page('<script src="http://localhost:3000/lib.js"></script>') })).toBe(0)
  })
})
