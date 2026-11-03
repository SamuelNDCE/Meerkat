// False-alarm family A (risky-code, sql-concat, js-unhandled-promise, ip-gha, and the web-security checks of the trap corpus): each rule stops reporting the safe
// shape from a trap-web-*-clean project and still reports the planted defect next to it.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fpa-'))
  made.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}
function run(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', folder(files)], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}
const risky = (files: Record<string, string>) => run('thorough/static.mjs', 'risky-code', files).code
const sec = (check: string, files: Record<string, string>) => run('thorough/sec-code.mjs', check, files)
const sql = (src: string, name = 'a.js') => sec('sql-concat', { [name]: src }).code
const fired = (root: Record<string, string>, rule: string) => /FAIL/.test(run('thorough/infra-plus.mjs', 'ip-gha', root).out.split('\n').find((l) => l.includes('MEERKAT-SUB') && l.includes(rule)) ?? '')

describe('risky-code', () => {
  test('eval: a method named eval on another object is quiet, the global eval is not', () => {
    expect(risky({ 'a.js': "exports.incr = (redis, key) => redis.eval('return 1', 1, key)\n" })).toBe(0)
    expect(risky({ 'a.py': "def total(df):\n    return df.eval('price * quantity')\n" })).toBe(0)
    expect(risky({ 'a.js': 'const v = window.eval(userInput)\n' })).toBe(1)
    expect(risky({ 'a.js': 'const v = eval(userInput)\n' })).toBe(1)
  })
  test('new Function with only string literals is quiet, with request data it is not', () => {
    expect(risky({ 'a.js': "const add = new Function('a', 'b', 'return a + b')\n" })).toBe(0)
    expect(risky({ 'a.js': "const fn = new Function('a', req.body.code)\n" })).toBe(1)
  })
  test('insertAdjacentHTML of a text constant is quiet, of a variable it is not', () => {
    expect(risky({ 'a.js': "const ROW = '<li class=\"row\"></li>'\nexport function add(l) {\n  l.insertAdjacentHTML('beforeend', ROW)\n}\n" })).toBe(0)
    expect(risky({ 'a.js': "export function add(l, item) {\n  l.insertAdjacentHTML('beforeend', item)\n}\n" })).toBe(1)
  })
  test('dangerouslySetInnerHTML through DOMPurify is quiet, raw it is not', () => {
    expect(risky({ 'a.jsx': "export const N = ({ html }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />\n" })).toBe(0)
    expect(risky({ 'a.jsx': 'export const N = ({ comment }) => <div dangerouslySetInnerHTML={{ __html: comment.body }} />\n' })).toBe(1)
  })
  test('os.system with fixed text is quiet, with a built string it is not', () => {
    expect(risky({ 'a.py': "import os\ndef clear():\n    os.system('cls' if os.name == 'nt' else 'clear')\n" })).toBe(0)
    expect(risky({ 'a.py': "import os\ndef rm(path):\n    os.system('rm -rf ' + path)\n" })).toBe(1)
  })
  test('verify=False on a call that is not an HTTP request is quiet, on requests it is not', () => {
    expect(risky({ 'a.py': 'def run(checker):\n    return checker.run(verify=False)\n' })).toBe(0)
    expect(risky({ 'a.py': 'import requests\ndef g(url):\n    return requests.get(url, timeout=5, verify=False)\n' })).toBe(1)
    expect(risky({ 'a.py': 'import requests\ndef c():\n    s = requests.Session()\n    s.verify = False\n    return s\n' })).toBe(1)
    expect(risky({ 'a.py': 'import requests\ndef g(url):\n    return requests.get(\n        url,\n        verify=False,\n    )\n' })).toBe(1)
  })
  test('yaml CSafeLoader is quiet, the default loader is not', () => {
    expect(risky({ 'a.py': 'import yaml\ndef load(t):\n    return yaml.load(t, Loader=yaml.CSafeLoader)\n' })).toBe(0)
    expect(risky({ 'a.py': 'import yaml\ndef load(t):\n    return yaml.load(t)\n' })).toBe(1)
  })
  test('pickle after an HMAC comparison is quiet, bare pickle is not', () => {
    const ok = "import hashlib, hmac, pickle\ndef load(raw, key):\n    mac, body = raw[:32], raw[32:]\n    if not hmac.compare_digest(mac, hmac.new(key, body, hashlib.sha256).digest()):\n        raise ValueError('changed')\n    return pickle.loads(body)\n"
    expect(risky({ 'a.py': ok })).toBe(0)
    expect(risky({ 'a.py': 'import pickle\ndef load(blob):\n    return pickle.loads(blob)\n' })).toBe(1)
  })
  test('http://host.docker.internal and the sitemap namespace are quiet, another http address is not', () => {
    expect(risky({ 'a.js': "exports.API = 'http://host.docker.internal:8080/health'\n" })).toBe(0)
    expect(risky({ 'a.js': "exports.NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'\n" })).toBe(0)
    expect(risky({ 'a.js': "exports.API = 'http://api.shop.io/health'\n" })).toBe(1)
  })
  test('key: Math.random() is a list key, a token made with it is not', () => {
    expect(risky({ 'a.js': 'export function withKeys(items) {\n  return items.map((item) => ({ key: Math.random(), item }))\n}\n' })).toBe(0)
    expect(risky({ 'a.js': 'const token = Math.random().toString(36).slice(2)\n' })).toBe(1)
    expect(risky({ 'a.js': 'const apiKey = Math.random().toString(36)\n' })).toBe(1)
  })
})

describe('sql-concat', () => {
  test('a text constant in a template or an f-string is quiet, a request value is not', () => {
    expect(sql("const TABLE = 'orders'\nexports.count = (db) => db.query(`SELECT count(*) FROM ${TABLE}`)\n")).toBe(0)
    expect(sql("TABLE = 'audit_log'\n\ndef count(cur):\n    cur.execute(f'SELECT count(*) FROM {TABLE}')\n", 'a.py')).toBe(0)
    expect(sql('db.query(`SELECT * FROM users WHERE name = \'${req.body.name}\'`)\n')).toBe(1)
  })
  test('a lookup in a table of text is quiet, a lookup in a mutable object is not', () => {
    expect(sql("const SORT = { newest: 'created_at DESC', total: 'total DESC' }\nexports.list = (db, key) => db.query(`SELECT id FROM orders ORDER BY ${SORT[key] ?? SORT.newest}`)\n")).toBe(0)
    expect(sql('exports.list = (db, req) => db.query(`SELECT id FROM orders ORDER BY ${req.query.sort}`)\n')).toBe(1)
  })
  test('a placeholder list is quiet, a joined id list is not', () => {
    expect(sql("exports.byIds = (db, ids) => {\n  const marks = ids.map(() => '?').join(',')\n  return db.query('SELECT id FROM posts WHERE id IN (' + marks + ')', ids)\n}\n")).toBe(0)
    expect(sql("exports.byIds = (db, ids) => db.query('SELECT id FROM posts WHERE id IN (' + ids.join(',') + ')')\n")).toBe(1)
  })
  test('a number from Date.now() is quiet, a request value is not', () => {
    expect(sql("exports.purge = (db) => db.query('DELETE FROM sessions WHERE expires_at < ' + Date.now())\n")).toBe(0)
    expect(sql("exports.get = (db, req) => db.query('SELECT * FROM orders WHERE id = ' + req.query.id)\n")).toBe(1)
  })
  test('a tagged template is quiet, an untagged one is not', () => {
    expect(sql('export const recent = (days) => prisma.$queryRaw`SELECT id FROM "Order" WHERE n > ${days}`\n', 'a.ts')).toBe(0)
    expect(sql('export const recent = (days) => prisma.$queryRawUnsafe(`SELECT id FROM "Order" WHERE n > ${days}`)\n', 'a.ts')).toBe(1)
  })
  test('a help sentence is quiet, a mixed-case statement with a star is not', () => {
    expect(sql("exports.hint = (names) => 'Select a file from the list: ' + names.join(', ')\n")).toBe(0)
    expect(sql("exports.q = (db, id) => db.query('Select * from users where id = ' + id)\n")).toBe(1)
  })
})

describe('web-security checks', () => {
  test('cookie-flags: options held in a constant count', () => {
    expect(sec('cookie-flags', { 'a.js': "const OPTS = { httpOnly: true, secure: true, sameSite: 'strict' }\nmodule.exports = (res, sid) => {\n  res.cookie('sid', sid, OPTS)\n}\n" }).code).toBe(0)
    expect(sec('cookie-flags', { 'a.js': "const OPTS = { path: '/' }\nmodule.exports = (res, sid) => {\n  res.cookie('sid', sid, OPTS)\n}\n" }).code).toBe(1)
  })
  test('hardcoded-ip: public DNS resolvers are quiet, a server address is not', () => {
    expect(sec('hardcoded-ip', { 'a.js': "const DNS = ['1.1.1.1', '9.9.9.9']\n" }).code).toBe(0)
    expect(sec('hardcoded-ip', { 'a.js': "const REDIS_HOST = '52.14.201.77'\n" }).code).toBe(1)
  })
  test('debug-enabled: NODE_ENV in docker-compose.override.yml is info, in docker-compose.yml it fails', () => {
    const y = 'services:\n  web:\n    environment:\n      NODE_ENV: development\n'
    const a = sec('debug-enabled', { 'docker-compose.override.yml': y })
    expect(a.code).toBe(0)
    expect(a.out).toMatch(/MEERKAT-FINDING info debug-enabled/)
    expect(sec('debug-enabled', { 'docker-compose.yml': y }).code).toBe(1)
  })
  test('local-storage-pii: a setting about email or tokens is quiet, the value is not', () => {
    for (const k of ['emailDigestFrequency', 'passwordHintShown', 'tokenizerMode']) expect(run('thorough/privacy.mjs', 'local-storage-pii', { 'a.js': `localStorage.setItem('${k}', v)\n` }).code).toBe(0)
    for (const k of ['authToken', 'userEmail', 'jwt', 'savedPassword']) expect(run('thorough/privacy.mjs', 'local-storage-pii', { 'a.js': `localStorage.setItem('${k}', v)\n` }).code).toBe(1)
  })
  test('open-redirect-pattern: a path-only regex, a route table and the own pathname are quiet', () => {
    expect(sec('open-redirect-pattern', { 'a.js': "exports.after = (req, res) => {\n  const next = String(req.query.next || '/')\n  if (!/^\\/[^/\\\\]/.test(next)) return res.redirect('/')\n  res.redirect(next)\n}\n" }).code).toBe(0)
    expect(sec('open-redirect-pattern', { 'a.js': "const ROUTES = { orders: '/account/orders' }\nexports.go = (req, res) => res.redirect(ROUTES[req.query.page] || '/')\n" }).code).toBe(0)
    expect(sec('open-redirect-pattern', { 'a.js': "export function go(n) {\n  const p = new URLSearchParams(location.search)\n  location.href = location.pathname + '?' + p.toString()\n}\n" }).code).toBe(0)
    expect(sec('open-redirect-pattern', { 'a.js': 'exports.go = (req, res) => res.redirect(req.query.next)\n' }).code).toBe(1)
    expect(sec('open-redirect-pattern', { 'a.js': "const ROUTES = { orders: '/account/orders' }\nexports.go = (req, res) => res.redirect(req.query.next || ROUTES.orders)\n" }).code).toBe(1)
  })
  test('path-traversal-pattern: a document table and a strict id pattern are quiet, a raw name is not', () => {
    expect(sec('path-traversal-pattern', { 'a.js': "const fs = require('fs')\nconst DOCS = { terms: './legal/terms.pdf' }\nexports.doc = (req, res) => {\n  fs.createReadStream(DOCS[req.query.doc]).pipe(res)\n}\n" }).code).toBe(0)
    const uuid = "const fs = require('fs')\nconst UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/\nexports.avatar = (req, res) => {\n  if (!UUID.test(req.params.id)) return res.sendStatus(400)\n  fs.createReadStream('./avatars/' + req.params.id + '.png').pipe(res)\n}\n"
    expect(sec('path-traversal-pattern', { 'a.js': uuid }).code).toBe(0)
    expect(sec('path-traversal-pattern', { 'a.js': uuid.replace('[0-9a-f]{12}', '.*') }).code).toBe(1)
    expect(sec('path-traversal-pattern', { 'a.js': "const fs = require('fs')\nexports.f = (req, res) => fs.createReadStream('./up/' + req.query.name).pipe(res)\n" }).code).toBe(1)
  })
  test('regex-dos: (ab|a)+ is quiet, (a|aa)+ is not', () => {
    expect(sec('regex-dos', { 'a.js': 'const RUN = /^(?:ab|a)+$/\n' }).code).toBe(0)
    expect(sec('regex-dos', { 'a.js': 'const RUN = /^(?:a|aa)+$/\n' }).code).toBe(1)
    expect(sec('regex-dos', { 'a.js': 'const RUN = /^(a+)+$/\n' }).code).toBe(1)
  })
  test('weak-crypto-modes: a comment about passwords above MD5 is quiet, MD5 of a password is not', () => {
    expect(sec('weak-crypto-modes', { 'a.js': "const crypto = require('crypto')\n// Passwords were once stored with MD5 and are now migrated to bcrypt at login.\nexports.sum = (buf) => crypto.createHash('md5').update(buf).digest('hex')\n" }).code).toBe(0)
    expect(sec('weak-crypto-modes', { 'a.js': "const crypto = require('crypto')\nexports.h = (password) => crypto.createHash('md5').update(password).digest('hex')\n" }).code).toBe(1)
  })
})

describe('js-unhandled-promise', () => {
  const lang = (files: Record<string, string>) => run('thorough/lang.mjs', 'js-unhandled-promise', files).code
  test('ipcMain.handle registration is quiet even when handle is an async helper elsewhere', () => {
    const lib = { 'lib.js': 'exports.handle = async (x) => x\n' }
    expect(lang({ ...lib, 'main.js': "const { ipcMain } = require('electron')\nipcMain.handle('ping', () => 1)\n" })).toBe(0)
    expect(lang({ ...lib, 'main.js': "const { handle } = require('./lib')\nhandle(1)\n" })).toBe(1)
  })
  test('a synchronous method of the same name cancels the async function name', () => {
    const a = 'exports.save = async (x) => x\n'
    expect(lang({ 'a.js': a, 'store.js': 'class Store {\n  save(x) {\n    return x\n  }\n}\nconst s = new Store()\ns.save(1)\n' })).toBe(0)
    expect(lang({ 'a.js': a, 'b.js': "const { save } = require('./a')\nsave(1)\n" })).toBe(1)
  })
})

describe('ip-gha gha-contents-write', () => {
  const wf = (on: string, perms: string, step: string) => `name: release\n${on}${perms}jobs:\n  publish:\n    runs-on: ubuntu-24.04\n${perms ? '' : '    permissions:\n      contents: write\n'}    steps:\n      - run: ${step}\n`
  test('a tag-gated job that runs gh release create is credited', () => {
    expect(fired({ '.github/workflows/r.yml': wf('on:\n  push:\n    tags: ["v*"]\n', '', 'gh release create "$GITHUB_REF_NAME" --generate-notes') }, 'gha-contents-write')).toBe(false)
  })
  test('the same write permission without a release command, or without a tag gate, still fires', () => {
    expect(fired({ '.github/workflows/r.yml': wf('on:\n  push:\n    tags: ["v*"]\n', '', 'echo hi') }, 'gha-contents-write')).toBe(true)
    expect(fired({ '.github/workflows/r.yml': wf('on: push\n', '', 'gh release create x') }, 'gha-contents-write')).toBe(true)
  })
})

describe('guards bound to the value they protect', () => {
  const uuid = "const fs = require('fs')\nconst UUID = /^[0-9a-f]{8}-[0-9a-f]{4}$/\nexports.a = (req, res) => {\n  if (!UUID.test(req.params.id)) return res.sendStatus(400)\n  fs.createReadStream('./av/' + req.params.id + '.png').pipe(res)\n}\n"
  test('path-traversal: the strict test must be on the same value and end the handler', () => {
    expect(sec('path-traversal-pattern', { 'a.js': uuid }).code).toBe(0)
    // tests another value than the one read
    expect(sec('path-traversal-pattern', { 'a.js': uuid.replace('fs.createReadStream(\'./av/\' + req.params.id', "fs.createReadStream('./av/' + req.query.name") }).code).toBe(1)
    // the test is there but nothing happens on failure
    expect(sec('path-traversal-pattern', { 'a.js': uuid.replace('return res.sendStatus(400)', 'console.log(1)') }).code).toBe(1)
    // only a nearby, unconnected test call
    expect(sec('path-traversal-pattern', { 'a.js': uuid.replace('if (!UUID.test(req.params.id)) return res.sendStatus(400)', 'const ok = UUID.test(req.params.id)') }).code).toBe(1)
  })
  const pk = (guard: string, load = 'pickle.loads(body)') => `import hashlib, hmac, pickle\ndef load(raw, key):\n    mac, body = raw[:32], raw[32:]\n${guard}\n    return ${load}\n`
  const good = "    if not hmac.compare_digest(mac, hmac.new(key, body, hashlib.sha256).digest()):\n        raise ValueError('changed')"
  test('pickle: the HMAC must cover the unpickled variable and a failure must raise or return', () => {
    expect(risky({ 'a.py': pk(good) })).toBe(0)
    expect(risky({ 'a.py': pk(good, 'pickle.loads(raw)') })).toBe(1)
    expect(risky({ 'a.py': pk("    if not hmac.compare_digest(mac, hmac.new(key, body, hashlib.sha256).digest()):\n        print('bad')") })).toBe(1)
    expect(risky({ 'a.py': pk("    hmac.compare_digest(mac, hmac.new(key, body, hashlib.sha256).digest())") })).toBe(1)
  })
  test('dangerouslySetInnerHTML: the sanitiser call must be the whole value', () => {
    expect(risky({ 'a.jsx': 'export const N = ({ h }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(h) }} />\n' })).toBe(0)
    expect(risky({ 'a.jsx': 'export const N = ({ h, x }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(h) + x }} />\n' })).toBe(1)
    expect(risky({ 'a.jsx': 'export const N = ({ h, x }) => <div dangerouslySetInnerHTML={{ __html: sanitize(h).concat(x) }} />\n' })).toBe(1)
  })
  const wf = (on: string, extra = '') => `name: r\n${on}jobs:\n  publish:\n    runs-on: ubuntu-24.04\n${extra}    permissions:\n      contents: write\n    steps:\n      - run: gh release create v1\n`
  test('gha-contents-write: the tag gate must be under push, a release trigger, or an if: on the job', () => {
    const f = (y: string) => fired({ '.github/workflows/r.yml': y }, 'gha-contents-write')
    expect(f(wf('on:\n  push:\n    tags: ["v*"]\n'))).toBe(false)
    expect(f(wf('on:\n  release:\n    types: [published]\n'))).toBe(false)
    expect(f(wf('on: push\n', "    if: startsWith(github.ref, 'refs/tags/')\n"))).toBe(false)
    // a tags: key under another trigger, or a matrix key, is no gate
    expect(f(wf('on:\n  workflow_dispatch:\n    inputs:\n      tags:\n        description: x\n'))).toBe(true)
    expect(f(wf('on:\n  pull_request:\n    tags: ["v*"]\n'))).toBe(true)
    expect(f(wf('on: push\n', '    strategy:\n      matrix:\n        tags: [a]\n'))).toBe(true)
  })
})
