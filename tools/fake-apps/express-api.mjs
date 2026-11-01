// (a) A Node/Express-style web API: login route, SQL query, cookie, config file, test suite.
// The 'express' module is a small local stand-in (src/express.js) so the project needs no install and no network.
import { baseline, json, readme } from './kit.mjs'

const pkg = json({ name: 'shop-api', version: '1.0.0', private: true, engines: { node: '>=20' }, license: 'MIT', type: 'module', repository: { type: 'git', url: 'https://example.invalid/shop-api.git' }, scripts: { test: 'node --test tests/' } })

const express = `// A tiny stand-in for express so the fixture runs with no install.
export default function express() {
  const routes = []
  const app = { routes, post: (p, h) => routes.push(['POST', p, h]), get: (p, h) => routes.push(['GET', p, h]), listen: () => {} }
  return app
}
`

const clean = {
  'package.json': pkg,
  ...baseline({ test: 'npm test', ignore: 'node_modules/\n' }),
  'package-lock.json': json({ name: 'shop-api', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'shop-api', version: '1.0.0', license: 'MIT', engines: { node: '>=20' } } } }),
  'README.md': readme('shop-api', 'A small orders API.', 'npm ci', 'node src/server.js', 'npm test'),
  '.env.example': 'SESSION_SECRET=\nDB_URL=\n',
  'config/default.json': json({ port: 3000, sessionTtlSeconds: 3600 }),
  'src/express.js': express,
  'src/db.js': `// Parameterised queries only: the value never becomes part of the SQL text.
export function findUser(db, id) {
  return db.query('SELECT id, name FROM users WHERE id = $1', [id])
}
`,
  'src/headers.js': `// A simple rateLimit per client address.
export function rateLimit(max = 100) {
  const seen = new Map()
  return (ip) => {
    const n = (seen.get(ip) ?? 0) + 1
    seen.set(ip, n)
    return n <= max
  }
}
`,
  'src/server.js': `import express from './express.js'
import { findUser } from './db.js'
import { rateLimit } from './headers.js'

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}


export function createApp(db, secret = process.env.SESSION_SECRET) {
  const app = express()
  app.disable('x-powered-by')
  const allow = rateLimit()
  app.post('/login', async (req, res) => {
    if (!allow(req.ip)) return res.status(429).json({ error: 'slow down' })
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)
    const user = await findUser(db, req.body.id)
    if (!user) return res.status(401).json({ error: 'bad login' })
    res.cookie('sid', secret ? 'signed' : 'none', { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 3600000 })
    return res.json({ ok: true })
  })
  return app
}
`,
  'tests/login.test.js': `import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/server.js'

test('login route is registered', () => {
  const app = createApp({ query: async () => null }, 'x')
  assert.equal(app.routes[0][1], '/login')
})
`,
}

const defective = {
  ...clean,
  'src/db.js': `// BUG: the id is glued into the SQL text.
export function findUser(db, id) {
  return db.query('SELECT id, name FROM users WHERE id = ' + id)
}
`,
  'src/server.js': clean['src/server.js'].replace("{ httpOnly: true, secure: true, sameSite: 'strict', maxAge: 3600000 }", "{ sameSite: 'none', maxAge: 3600000 }"),
  'config/production.json': json({ db: { password: 'hunter2hunter2xyz' }, awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE' }),
}

export default {
  name: 'express-api',
  clean,
  defective,
  // Each planted defect: the rule id that must report it, the file, the lowest acceptable severity.
  defects: [
    { check: 'sql-concat', file: 'src/db.js', severity: 'high' },
    { check: 'cookie-flags', file: 'src/server.js', severity: 'high' },
    { check: 'wh-headers', rule: 'cookie-samesite-none-no-secure', file: 'src/server.js', severity: 'high' },
    { check: 'secret-scan', file: 'config/production.json', severity: 'critical' },
    { check: 'secrets-plus', rule: 'generic-keyword-secret', file: 'config/production.json', severity: 'critical' },
  ],
}
