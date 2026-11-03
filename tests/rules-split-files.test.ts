// Shapes the text checks used to miss because the dangerous line and the thing that makes it dangerous sit in different places: a constant
// defined in one file and used in another, a helper that a caller passes request data to, a guard that is only imported, a tag that runs
// over several lines. Each case has a bad project (the check must report the named file and line) and a safe twin (it must stay silent).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-split-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
function run(script: string, check: string, dir: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough', `${script}.mjs`), check, '--root', dir], { encoding: 'utf8', env: { ...process.env, MEERKAT_FINDINGS: 'all' } })
  return { code: r.status, out: r.stdout }
}

type Case = { name: string; script: string; check: string; bad: Record<string, string>; good: Record<string, string>; hit: string }
const cases: Case[] = [
  { name: 'cors options with credentials switched on in another file', script: 'sec-code', check: 'cors-wildcard', hit: 'cors.js:1',
    bad: { 'cors.js': 'exports.opts = { origin: true }\n', 'server.js': "const { opts } = require('./cors')\nopts.credentials = true\n" },
    good: { 'cors.js': "exports.opts = { origin: ['https://a.example'] }\n", 'server.js': "const { opts } = require('./cors')\nopts.credentials = true\n" } },
  { name: 'Allow-Origin taken from a helper that echoes the Origin', script: 'sec-code', check: 'cors-wildcard', hit: 'mw.js:2',
    bad: { 'origin.js': "exports.pick = (req) => req.get('origin')\n", 'mw.js': "const { pick } = require('./origin')\nmodule.exports = (req, res) => res.setHeader('Access-Control-Allow-Origin', pick(req))\n" },
    good: { 'origin.js': "const ok = ['https://a.example']\nexports.pick = (req) => (ok.includes(req.get('origin')) ? req.get('origin') : ok[0])\n", 'mw.js': "const { pick } = require('./origin')\nmodule.exports = (req, res) => res.setHeader('Access-Control-Allow-Origin', pick(req))\n" } },
  { name: 'python bracket-style star origin with credentials', script: 'sec-code', check: 'cors-wildcard', hit: 'cors.py:3',
    bad: { 'cors.py': "def add(resp):\n    resp.headers['Access-Control-Allow-Credentials'] = 'true'\n    resp.headers['Access-Control-Allow-Origin'] = '*'\n    return resp\n" },
    good: { 'cors.py': "def add(resp):\n    resp.headers['Access-Control-Allow-Credentials'] = 'true'\n    resp.headers['Access-Control-Allow-Origin'] = 'https://a.example'\n    return resp\n" } },
  { name: 'accepted algorithm list with none, used by verify elsewhere', script: 'sec-code', check: 'jwt-weak', hit: 'config.js:1',
    bad: { 'config.js': "exports.jwtAlgorithms = ['HS256', 'none']\n", 'v.js': "const { jwtAlgorithms } = require('./config')\njwt.verify(t, s, { algorithms: jwtAlgorithms })\n" },
    good: { 'config.js': "exports.jwtAlgorithms = ['HS256']\n", 'v.js': "const { jwtAlgorithms } = require('./config')\njwt.verify(t, s, { algorithms: jwtAlgorithms })\n" } },
  { name: 'signing secret that falls back to a typed default', script: 'sec-code', check: 'jwt-weak', hit: 'secret.js:1',
    bad: { 'secret.js': "exports.jwtSecret = process.env.JWT_SECRET || 'changeme-dev-secret'\n" },
    good: { 'secret.js': "exports.jwtSecret = process.env.JWT_SECRET\nif (!exports.jwtSecret) throw new Error('JWT_SECRET is required')\n" } },
  { name: 'file read in a helper that a route calls with the request path', script: 'sec-code', check: 'path-traversal-pattern', hit: 'up.js:3',
    bad: { 'up.js': "const fs = require('fs')\nconst path = require('path')\nexports.read = (name) => fs.readFileSync(path.join('/srv', name))\n", 'r.js': "const { read } = require('./up')\napp.get('/f', (req, res) => res.send(read(req.query.f)))\n" },
    good: { 'up.js': "const fs = require('fs')\nconst path = require('path')\nexports.read = (name) => fs.readFileSync(path.join('/srv', path.basename(name)))\n", 'r.js': "const { read } = require('./up')\napp.get('/f', (req, res) => res.send(read(req.query.f)))\n" } },
  { name: 'python helper reached with request data, safe_join only imported', script: 'sec-code', check: 'path-traversal-pattern', hit: 'st.py:6',
    bad: { 'st.py': 'import os\nfrom flask import send_file\nfrom werkzeug.utils import safe_join\n\ndef serve(name):\n    return send_file(os.path.join("/srv", name))\n', 'v.py': 'from st import serve\n\ndef dl(request):\n    return serve(request.args["f"])\n' },
    good: { 'st.py': 'import os\nfrom flask import send_file\nfrom werkzeug.utils import safe_join\n\ndef serve(name):\n    return send_file(safe_join("/srv", name))\n', 'v.py': 'from st import serve\n\ndef dl(request):\n    return serve(request.args["f"])\n' } },
  { name: 'go ReadFile with the query value, filepath.Base only named', script: 'sec-code', check: 'path-traversal-pattern', hit: 'h.go:6',
    bad: { 'h.go': 'package web\n\nimport "os"\n\nfunc Serve(w W, r *http.Request) {\n\td, _ := os.ReadFile(r.URL.Query().Get("file"))\n}\n\nvar _ = filepath.Base\n' },
    good: { 'h.go': 'package web\n\nimport "os"\n\nfunc Serve(w W, r *http.Request) {\n\td, _ := os.ReadFile(filepath.Join("/srv", filepath.Base(r.URL.Query().Get("file"))))\n}\n' } },
  { name: 'redirect in a helper that a route calls with the query value', script: 'sec-code', check: 'open-redirect-pattern', hit: 'nav.js:1',
    bad: { 'nav.js': 'exports.go = (res, to) => res.redirect(to)\n', 'l.js': "const { go } = require('./nav')\napp.post('/l', (req, res) => go(res, req.query.next))\n" },
    good: { 'nav.js': "exports.go = (res, to) => res.redirect(to.startsWith('/') ? to : '/')\n", 'l.js': "const { go } = require('./nav')\napp.post('/l', (req, res) => go(res, req.query.next))\n" } },
  { name: 'redirect to a value kept in the session from the request', script: 'sec-code', check: 'open-redirect-pattern', hit: 'cb.js:3',
    bad: { 'cb.js': 'app.get("/cb", (req, res) => {\n  const to = req.session.returnTo\n  res.redirect(to)\n})\n' },
    good: { 'cb.js': 'app.get("/cb", (req, res) => {\n  const to = "/home"\n  res.redirect(to)\n})\n' } },
  { name: 'SQL text grown with += from request data', script: 'sec-code', check: 'sql-concat', hit: 'o.js:3',
    bad: { 'o.js': "let q = 'select * from orders where id = '\n\nq += req.query.id\nrun(q)\n" },
    good: { 'o.js': "const q = 'select * from orders where id = $1'\nrun(q, [req.query.id])\n" } },
  { name: 'nested-repeat pattern held in a constant and compiled elsewhere', script: 'sec-code', check: 'regex-dos', hit: 'p.js:1',
    bad: { 'p.js': "exports.NAME = '^(\\\\w+\\\\s?)*$'\n", 'v.js': "const { NAME } = require('./p')\nexports.ok = (s) => new RegExp(NAME).test(s)\n" },
    good: { 'p.js': "exports.NAME = '^[\\\\w ]{1,64}$'\n", 'v.js': "const { NAME } = require('./p')\nexports.ok = (s) => new RegExp(NAME).test(s)\n" } },
  { name: 'ECB cipher name in a constants file', script: 'sec-code', check: 'weak-crypto-modes', hit: 'c.js:1',
    bad: { 'c.js': "exports.CIPHER = 'aes-128-ecb'\n", 's.js': "const { CIPHER } = require('./c')\nconst c = crypto.createCipheriv(CIPHER, key, null)\n" },
    good: { 'c.js': "exports.CIPHER = 'aes-256-gcm'\n", 's.js': "const { CIPHER } = require('./c')\nconst c = crypto.createCipheriv(CIPHER, key, iv)\n" } },
  { name: 'fixed key constant used by a decipher in another file', script: 'sec-code', check: 'weak-crypto-modes', hit: 'k.js:1',
    bad: { 'k.js': "exports.KEY = Buffer.from('0123456789abcdef0123456789abcdef')\n", 'v.js': "const { KEY } = require('./k')\nconst c = crypto.createDecipheriv('aes-256-cbc', KEY, iv)\n" },
    good: { 'k.js': "exports.KEY = Buffer.from(process.env.APP_KEY || '', 'hex')\n", 'v.js': "const { KEY } = require('./k')\nconst c = crypto.createDecipheriv('aes-256-cbc', KEY, iv)\n" } },
  { name: 'caddy CSP with unsafe-inline', script: 'web-hardening', check: 'wh-headers', hit: 'Caddyfile:2',
    bad: { Caddyfile: 'example.com {\n  header Content-Security-Policy "script-src \'self\' \'unsafe-inline\'"\n}\n' },
    good: { Caddyfile: 'example.com {\n  header Content-Security-Policy "script-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'none\'"\n  header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"\n  header X-Frame-Options "DENY"\n  header X-Content-Type-Options "nosniff"\n  header Referrer-Policy "no-referrer"\n  header Permissions-Policy "camera=()"\n  header Cross-Origin-Opener-Policy "same-origin"\n  header Cross-Origin-Embedder-Policy "require-corp"\n  header Cross-Origin-Resource-Policy "same-origin"\n}\n' } },
  { name: 'x-powered-by switched on, httpOnly false, helmet protections off', script: 'web-hardening', check: 'wh-headers', hit: 'srv.js:5',
    bad: { 'srv.js': "const express = require('express')\nconst app = express()\napp.enable('x-powered-by')\napp.use(session({ cookie: {\n  httpOnly: false,\n} }))\napp.use(helmet({ hsts: false }))\n" },
    good: { 'srv.js': "const express = require('express')\nconst app = express()\napp.disable('x-powered-by')\napp.use(session({ cookie: {\n  httpOnly: true,\n} }))\napp.use(helmet({ hsts: true }))\n" } },
  { name: 'iframe whose tag runs over several lines and has no sandbox', script: 'web-hardening', check: 'wh-html', hit: 'p.html:2',
    bad: { 'p.html': '<main>\n<iframe\n  src="https://w.example/x"\n  title="W"\n></iframe>\n</main>\n' },
    good: { 'p.html': '<main>\n<iframe\n  src="https://w.example/x"\n  title="W"\n  sandbox="allow-scripts"\n></iframe>\n</main>\n' } },
  { name: 'source map file in a published folder', script: 'web-hardening', check: 'wh-publish-root', hit: 'public/app.js.map',
    bad: { 'public/app.js.map': '{}\n', 'public/app.js': 'x\n' },
    good: { 'public/app.js': 'x\n' } },
  { name: 'strict-ssl switched off with spaces around the equals sign', script: 'web-hardening', check: 'wh-supply', hit: '.npmrc:1',
    bad: { '.npmrc': 'strict-ssl = false\n' },
    good: { '.npmrc': 'strict-ssl = true\n' } },
  { name: 'open-ended and x-range dependency versions', script: 'health', check: 'wildcard-versions', hit: 'package.json',
    bad: { 'package.json': '{"name":"x","private":true,"dependencies":{"a":">=1.0.0","b":"1.x"}}\n' },
    good: { 'package.json': '{"name":"x","private":true,"dependencies":{"a":"^1.0.0","b":"1.2.3","c":">=1.0.0 <2.0.0"}}\n' } },
  { name: 'positive tabindex written with single quotes', script: 'hygiene', check: 'ui-static', hit: 'p.html:2',
    bad: { 'p.html': "<html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>t</title></head><body>\n<div tabindex='3'>x</div>\n</body></html>\n" },
    good: { 'p.html': "<html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width\"><title>t</title></head><body>\n<div tabindex='0'>x</div>\n</body></html>\n" } },
  { name: 'script loaded over http on a page with no https link', script: 'a11y', check: 'mixed-content', hit: 'p.html:2',
    bad: { 'p.html': '<body>\n<script src="http://cdn.example.com/lib.js"></script>\n</body>\n' },
    good: { 'p.html': '<body>\n<script src="https://cdn.example.com/lib.js"></script>\n</body>\n' } },
  { name: 'Go call whose only result is its error, assigned to _', script: 'lang', check: 'go-ignored-errors', hit: 'r.go:4',
    bad: { 'r.go': 'package main\n\nfunc rotate(a, b string) {\n\t_ = os.Rename(a, b)\n}\n' },
    good: { 'r.go': 'package main\n\nfunc rotate(a, b string) error {\n\treturn os.Rename(a, b)\n}\n' } },
  { name: 'recursive merge helper over Object.keys that never skips the prototype keys', script: 'lang', check: 'js-prototype-pollution', hit: 'merge.js:',
    bad: { 'merge.js': "exports.merge = (target, src) => {\n  for (const key of Object.keys(src)) {\n    target[key] = src[key]\n  }\n  return target\n}\n", 'settings.js': "const { merge } = require('./merge')\nmodule.exports = (app) => app.put('/s', (req, res) => res.json(merge({}, req.body)))\n" },
    good: { 'merge.js': "exports.merge = (target, src) => {\n  for (const key of Object.keys(src)) {\n    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue\n    target[key] = src[key]\n  }\n  return target\n}\n" } },
  { name: 'async helper from another file called without await or catch', script: 'lang', check: 'js-unhandled-promise', hit: 'signup.js:3',
    bad: { 'mailer.js': "exports.sendWelcome = async (to) => {\n  return to\n}\n", 'signup.js': "const { sendWelcome } = require('./mailer')\nmodule.exports = (app) => app.post('/s', (req, res) => {\n  sendWelcome(req.body.email)\n  res.sendStatus(201)\n})\n" },
    good: { 'mailer.js': "exports.sendWelcome = async (to) => {\n  return to\n}\n", 'signup.js': "const { sendWelcome } = require('./mailer')\nmodule.exports = (app) => app.post('/s', async (req, res) => {\n  await sendWelcome(req.body.email)\n  sendWelcome(req.body.email).catch((e) => console.error(e))\n  res.sendStatus(201)\n})\n" } },
  { name: 'a call to a plain (non-async) function is not a floating promise', script: 'lang', check: 'js-unhandled-promise', hit: 'b.js:2',
    bad: { 'a.js': "exports.save = async (x) => x\n", 'b.js': "const { save } = require('./a')\nsave(1)\n" },
    good: { 'a.js': "exports.save = (x) => x\nexports.other = async (x) => x\n", 'b.js': "const { save } = require('./a')\nsave(1)\n" } },
  { name: 'helper that returns err.stack and a handler that sends its result', script: 'api', check: 'error-leak', hit: 'errors.js:1',
    bad: { 'errors.js': 'exports.describe = (err) => err.stack\n', 'r.js': "const { describe } = require('./errors')\napp.get('/r', (req, res) => {\n  try { run() } catch (err) { res.status(500).send(describe(err)) }\n})\n" },
    good: { 'errors.js': "exports.describe = () => 'internal error'\n", 'r.js': "const { describe } = require('./errors')\napp.get('/r', (req, res) => {\n  try { run() } catch (err) { res.status(500).send(describe(err)) }\n})\n" } },
  { name: 'error-detail helper whose result goes into a json body, versus only into a log line', script: 'api', check: 'error-leak', hit: 'errors.js:1',
    bad: { 'errors.js': 'exports.describe = (err) => err.message\n', 'r.js': "const { describe } = require('./errors')\nfunction f(err) { return res.json({ error: describe(err) }) }\n" },
    good: { 'errors.js': 'exports.describe = (err) => err.message\n', 'r.js': "const { describe } = require('./errors')\nfunction f(err) { console.error(describe(err)) }\n" } },
  { name: 'options dict with verify False unpacked into requests calls elsewhere', script: 'static', check: 'risky-code', hit: 'opts.py:1',
    bad: { 'opts.py': "TLS = {'verify': False, 'timeout': 5}\n", 'fetch.py': 'import requests\nfrom opts import TLS\nrequests.get(url, **TLS)\n' },
    good: { 'opts.py': "TLS = {'verify': False, 'timeout': 5}\n", 'fetch.py': 'import requests\nfrom opts import TLS\nrequests.get(url, timeout=5)\n' } },
  { name: 'requests Session built in one file and used without a timeout in another', script: 'code-patterns', check: 'cp-python', hit: 'prices.py:4',
    bad: { 'client.py': 'import requests\n\nsession = requests.Session()\n', 'prices.py': "from client import session\n\ndef price(sku):\n    return session.get('https://p.example.com/' + sku).json()\n" },
    good: { 'client.py': 'import requests\n\nsession = requests.Session()\n', 'prices.py': "from client import session\n\ndef price(sku):\n    return session.get('https://p.example.com/' + sku, timeout=5).json()\n" } },
  { name: 'helper with a blocking readFileSync called from a request handler in another file', script: 'health', check: 'sync-fs-in-handlers', hit: 'store.js:2',
    bad: { 'store.js': "const fs = require('fs')\nexports.load = (id) => JSON.parse(fs.readFileSync('data/' + id + '.json', 'utf8'))\n", 'items.js': "const { load } = require('./store')\nmodule.exports = (app) => app.get('/i/:id', (req, res) => res.json(load(req.params.id)))\n" },
    good: { 'store.js': "const fs = require('fs')\nexports.load = async (id) => JSON.parse(await fs.promises.readFile('data/' + id + '.json', 'utf8'))\n", 'items.js': "const { load } = require('./store')\nmodule.exports = (app) => app.get('/i/:id', async (req, res) => res.json(await load(req.params.id)))\n" } },
  { name: 'blocking helper only called at start-up, not from a handler', script: 'health', check: 'sync-fs-in-handlers', hit: 'store.js:2',
    bad: { 'store.js': "const fs = require('fs')\nexports.load = (id) => JSON.parse(fs.readFileSync('data/' + id + '.json', 'utf8'))\n", 'items.js': "const { load } = require('./store')\nmodule.exports = (app) => app.get('/i/:id', (req, res) => res.json(load(req.params.id)))\n" },
    good: { 'store.js': "const fs = require('fs')\nexports.load = (id) => JSON.parse(fs.readFileSync('data/' + id + '.json', 'utf8'))\n", 'boot.js': "const { load } = require('./store')\nconst cfg = load('config')\nmodule.exports = cfg\n" } },
]

describe('checks that follow a value or a helper across files', () => {
  for (const c of cases) {
    test(`${c.check}: ${c.name}`, () => {
      const bad = run(c.script, c.check, project(c.bad))
      expect(bad.out).toContain(c.hit)
      expect(bad.code).toBe(1)
      const good = run(c.script, c.check, project(c.good))
      expect(good.out).not.toContain(c.hit)
    })
  }
})
