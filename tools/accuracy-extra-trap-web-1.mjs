// False-alarm traps, part 1: web, API, auth and JavaScript/TypeScript. Every project here ends in -clean and holds code that LOOKS like a defect
// to a naive rule but is safe. A trap passes when its named check raises no bug-severity finding on it. Nothing here is a real vulnerability.
// In the text, § stands for a backtick, @{ for ${ and @ZWJ@ for a zero-width joiner (so this source needs no escaping).
// Trap: [file, check id, code]. Traps are grouped six to a project: trap-web-<group>-<n>-clean. TRAPS lists every trap for the verifier.

export const TRAPS = []
const fix = (s) => s.replaceAll('§', '`').replaceAll('@{', '${').replaceAll('@ZWJ@', String.fromCharCode(0x200d))

export const group = (ctx, out, name, traps, per = 6) => {
  for (let i = 0; i * per < traps.length; i++) {
    const project = `trap-web-${name}-${i + 1}-clean`
    const files = { ...ctx.tidy(project) }
    const slice = traps.slice(i * per, (i + 1) * per)
    if (slice.some(([f]) => /\.(m?[jt]sx?|cjs)$/.test(f))) files['package.json'] = ctx.pkg(project)
    for (const [file, check, code] of slice) {
      files[file] = [fix(code) + '\n']
      TRAPS.push({ project, file, check })
    }
    out[project] = { files }
  }
}

export function projects(ctx) {
  TRAPS.length = 0
  const out = {}
  const g = (name, traps, per) => group(ctx, out, name, traps, per)

  g('cors', [
    ['src/cors/public-read.js', 'cors-wildcard', "const cors = require('cors')\n// Public read-only catalogue: no cookies, no credentials, so any site may read it.\nmodule.exports = cors({ origin: '*', credentials: false })"],
    ['src/cors/fastify-public.js', 'cors-wildcard', "module.exports = (fastify) => {\n  fastify.register(require('@fastify/cors'), { origin: true, methods: ['GET'] })\n}"],
    ['src/cors/allowlist-reflect.js', 'cors-wildcard', "const ALLOWED = new Set(['https://shop.harbourside.dev', 'https://admin.harbourside.dev'])\nmodule.exports = (req, res, next) => {\n  const origin = req.headers.origin\n  if (ALLOWED.has(origin)) {\n    res.setHeader('Access-Control-Allow-Origin', origin)\n    res.setHeader('Vary', 'Origin')\n  }\n  next()\n}"],
    ['src/cors/font-headers.js', 'cors-wildcard', "// Web fonts are static files with no user data; fonts need a wildcard to load from the CDN.\nmodule.exports = (req, res, next) => {\n  if (req.path.endsWith('.woff2')) res.setHeader('Access-Control-Allow-Origin', '*')\n  next()\n}"],
    ['src/cors/express-list.js', 'cors-wildcard', "const cors = require('cors')\nmodule.exports = cors({ origin: ['https://app.harbourside.dev', 'https://www.harbourside.dev'], credentials: true })"],
    ['src/cors/origin-fn.js', 'cors-wildcard', "const allowedOrigins = require('./allowed-origins')\nmodule.exports = {\n  origin(origin, cb) {\n    cb(null, allowedOrigins.includes(origin))\n  },\n  credentials: true,\n}"],
    ['src/cors/koa-allowlist.js', 'cors-wildcard', "const WHITELIST = ['https://shop.harbourside.dev']\nmodule.exports = async (ctx, next) => {\n  const origin = ctx.request.header.origin\n  if (WHITELIST.includes(origin)) ctx.set('Access-Control-Allow-Origin', origin)\n  await next()\n}"],
    ['src/cors/health-wildcard.js', 'cors-wildcard', "// Status page widget: returns {ok:true} only, never reads a cookie.\nmodule.exports = (req, res) => {\n  res.set('Access-Control-Allow-Origin', '*')\n  res.json({ ok: true })\n}"],
  ])

  g('cookies', [
    ['src/cookies/theme.js', 'cookie-flags', "// The theme choice is not secret, so the page script may read it.\nmodule.exports = (res, theme) => {\n  res.cookie('theme', theme, { httpOnly: false, secure: true, sameSite: 'lax', maxAge: 31536000000 })\n}"],
    ['src/cookies/clear.js', 'cookie-flags', "module.exports = (res) => {\n  res.clearCookie('sid')\n  res.clearCookie('csrf')\n  res.sendStatus(204)\n}"],
    ['src/cookies/shared-options.js', 'cookie-flags', "const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' }\nmodule.exports = (res, sid) => {\n  res.cookie('sid', sid, COOKIE_OPTIONS)\n}"],
    ['src/cookies/py_cookie.py', 'cookie-flags', "def login(response, sid):\n    response.set_cookie('sid', sid, httponly=True, secure=True, samesite='Lax', max_age=3600)\n    return response"],
    ['src/cookies/koa-cookie.js', 'cookie-flags', "module.exports = async (ctx) => {\n  ctx.cookies.set('cart', ctx.state.cartId, {\n    httpOnly: true,\n    secure: true,\n    sameSite: 'lax',\n  })\n  ctx.status = 204\n}"],
    ['src/cookies/header-string.js', 'cookie-flags', "module.exports = (res, sid) => {\n  res.setHeader('Set-Cookie', §sid=@{sid}; HttpOnly; Secure; SameSite=Strict; Path=/§)\n}"],
    ['src/cookies/session-lib.js', 'cookie-flags', "const session = require('express-session')\nmodule.exports = session({ secret: process.env.SESSION_SECRET, cookie: { httpOnly: true, secure: true, sameSite: 'lax' } })"],
    ['src/cookies/read-only.js', 'cookie-flags', "module.exports = (req) => {\n  const raw = req.headers.cookie || ''\n  return raw.split(';').map((c) => c.trim()).filter((c) => c.startsWith('theme='))\n}"],
  ])

  g('jwt', [
    ['src/auth/secret-env.js', 'jwt-weak', "const JWT_SECRET = process.env.JWT_SECRET\nif (!JWT_SECRET) throw new Error('JWT_SECRET must be set')\nmodule.exports = { JWT_SECRET }"],
    ['src/auth/expiry-reader.js', 'jwt-weak', "// Reads only the expiry time to decide when to refresh in the browser; the server checks the signature.\nconst jwt = require('jsonwebtoken')\nexports.expiresInMs = (token) => (jwt.decode(token).exp * 1000) - Date.now()"],
    ['src/auth/verify-hs256.js', 'jwt-weak', "const jwt = require('jsonwebtoken')\nexports.check = (token, secret) => jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'harbourside' })"],
    ['src/auth/verify-rs256.ts', 'jwt-weak', "import jwt from 'jsonwebtoken'\nimport { readFileSync } from 'node:fs'\nconst publicKey = readFileSync(process.env.JWT_PUBLIC_KEY_PATH as string)\nexport const verify = (token: string) => jwt.verify(token, publicKey, { algorithms: ['RS256'] })"],
    ['src/auth/reject-none.js', 'jwt-weak', "exports.assertHeader = (header) => {\n  if (header.alg === 'none') throw new Error('unsigned tokens are refused')\n  return header\n}"],
    ['src/auth/py_verify.py', 'jwt-weak', "import jwt\n\ndef check(token, key):\n    return jwt.decode(token, key, algorithms=['HS256'], options={'verify_signature': True})"],
    ['src/auth/sign-key-file.js', 'jwt-weak', "const fs = require('fs')\nconst jwt = require('jsonwebtoken')\nconst key = fs.readFileSync(process.env.SIGNING_KEY_FILE)\nexports.sign = (claims) => jwt.sign(claims, key, { algorithm: 'RS256', expiresIn: '15m' })"],
    ['src/auth/tokenizer-lexer.js', 'jwt-weak', "// A parser token, not a login token.\nconst tokenSecretWords = ['secret', 'password']\nexports.isSecretWord = (word) => tokenSecretWords.includes(word)"],
  ])

  g('crypto', [
    ['src/crypto/etag.js', 'weak-crypto-modes', "const crypto = require('crypto')\n// Content fingerprint for the ETag header, not a security control.\nexports.etag = (body) => crypto.createHash('md5').update(body).digest('hex')"],
    ['src/crypto/jitter.js', 'weak-crypto-modes', "// Spreads retries so clients do not all return at once.\nexports.retryDelayMs = (attempt) => 1000 * 2 ** attempt + Math.floor(Math.random() * 250)"],
    ['src/crypto/gcm.js', 'weak-crypto-modes', "const crypto = require('crypto')\nexports.seal = (text) => {\n  const iv = crypto.randomBytes(12)\n  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_KEY, 'hex'), iv)\n  return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])\n}"],
    ['src/crypto/request-id.js', 'weak-crypto-modes', "const crypto = require('crypto')\nexports.requestId = () => crypto.randomUUID()"],
    ['src/crypto/greeting.js', 'weak-crypto-modes', "const GREETINGS = ['Hello', 'Welcome back', 'Good to see you']\nexports.pick = () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]"],
    ['src/crypto/shard.py', 'weak-crypto-modes', "import hashlib\n\ndef shard_for(filename, shards=16):\n    digest = hashlib.md5(filename.encode(), usedforsecurity=False).hexdigest()\n    return int(digest, 16) % shards"],
    ['src/crypto/py_pick.py', 'weak-crypto-modes', "import random\n\ndef sample_rows(rows, n):\n    return random.sample(rows, min(n, len(rows)))"],
    ['src/crypto/hash-password.js', 'weak-crypto-modes', "const bcrypt = require('bcrypt')\nexports.hashPassword = (password) => bcrypt.hash(password, 12)"],
    ['src/crypto/legacy-note.js', 'weak-crypto-modes', "const crypto = require('crypto')\n// Passwords were once stored with MD5 and are now migrated to bcrypt at login.\nexports.fileChecksum = (buf) => crypto.createHash('md5').update(buf).digest('hex')"],
    ['src/crypto/session-token.js', 'weak-crypto-modes', "const crypto = require('crypto')\nexports.newSessionToken = () => crypto.randomBytes(32).toString('base64url')"],
    ['src/crypto/git-sha1.js', 'weak-crypto-modes', "const crypto = require('crypto')\n// Git names a blob by sha1 of a header and its content; this mirrors that for a local index.\nexports.blobId = (content) => crypto.createHash('sha1').update(§blob @{content.length}\\0§).update(content).digest('hex')"],
    ['src/crypto/animation.js', 'weak-crypto-modes', "exports.stagger = (i) => i * 40 + Math.random() * 20"],
    ['src/crypto/key-from-env.js', 'weak-crypto-modes', "exports.dataKey = () => {\n  const hex = process.env.DATA_KEY\n  if (!hex || hex.length !== 64) throw new Error('DATA_KEY must be 32 bytes of hex')\n  return Buffer.from(hex, 'hex')\n}"],
  ])

  g('sql', [
    ['src/db/count.js', 'sql-concat', "const TABLE = 'orders'\nexports.count = (db) => db.query(§SELECT count(*) FROM @{TABLE}§)"],
    ['src/db/order-by.js', 'sql-concat', "const SORT = { newest: 'created_at DESC', total: 'total DESC' }\nexports.list = (db, key) => db.query(§SELECT id, total FROM orders ORDER BY @{SORT[key] ?? SORT.newest}§)"],
    ['src/db/in-list.js', 'sql-concat', "exports.byIds = (db, ids) => {\n  const marks = ids.map(() => '?').join(',')\n  return db.query('SELECT id, title FROM posts WHERE id IN (' + marks + ')', ids)\n}"],
    ['src/db/prose.js', 'sql-concat', "exports.hint = (names) => 'Select a file from the list: ' + names.join(', ')"],
    ['src/db/param-pg.js', 'sql-concat', "exports.byId = (db, id) => db.query('SELECT id, email FROM users WHERE id = $1', [id])"],
    ['src/db/py_params.py', 'sql-concat', "def by_id(cur, uid):\n    cur.execute('SELECT id, name FROM users WHERE id = %s', (uid,))\n    return cur.fetchone()"],
    ['src/db/py_table.py', 'sql-concat', "TABLE = 'audit_log'\n\ndef count(cur):\n    cur.execute(f'SELECT count(*) FROM {TABLE}')\n    return cur.fetchone()[0]"],
    ['src/db/knex-where.js', 'sql-concat', "exports.byEmail = (knex, email) => knex.whereRaw('lower(email) = ?', [email.toLowerCase()])"],
    ['src/db/purge.js', 'sql-concat', "exports.purge = (db) => db.query('DELETE FROM sessions WHERE expires_at < ' + Date.now())"],
    ['src/db/ddl.js', 'sql-concat', "exports.up = (db) => db.query('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id)')"],
    ['src/db/help-text.js', 'sql-concat', "module.exports = 'Use SELECT * FROM orders to list every order, then press q to quit.'"],
    ['src/db/prisma.ts', 'sql-concat', "import { PrismaClient } from '@prisma/client'\nconst prisma = new PrismaClient()\nexport const recent = (days: number) => prisma.$queryRaw§SELECT id FROM \"Order\" WHERE created_at > now() - make_interval(days => @{days})§"],
    ['src/db/cte.js', 'sql-concat', "const LATEST = §\n  WITH latest AS (SELECT user_id, max(created_at) AS at FROM orders GROUP BY user_id)\n  SELECT * FROM latest\n§\nexports.latest = (db) => db.query(LATEST)"],
    ['src/db/limit-int.js', 'sql-concat', "exports.page = (db, page) => db.query('SELECT id FROM posts ORDER BY id LIMIT 20 OFFSET $1', [Math.max(0, Number(page) | 0) * 20])"],
  ])

  g('paths', [
    ['src/files/static-index.js', 'path-traversal-pattern', "const path = require('path')\nconst PUBLIC = path.join(__dirname, '..', 'public')\nexports.index = (req, res) => res.sendFile(path.join(PUBLIC, 'index.html'))"],
    ['src/files/basename.js', 'path-traversal-pattern', "const fs = require('fs')\nconst path = require('path')\nexports.read = (req, cb) => fs.readFile(path.join('./reports', path.basename(req.params.name)), cb)"],
    ['src/files/resolve-check.js', 'path-traversal-pattern', "const fs = require('fs')\nconst path = require('path')\nconst BASE = path.resolve('./exports')\nexports.read = (req, res) => {\n  const full = path.resolve(BASE, req.query.f)\n  if (!full.startsWith(BASE + path.sep)) return res.sendStatus(403)\n  fs.createReadStream(full).pipe(res)\n}"],
    ['src/files/lookup-map.js', 'path-traversal-pattern', "const fs = require('fs')\nconst DOCS = { terms: './legal/terms.pdf', privacy: './legal/privacy.pdf' }\nexports.doc = (req, res) => {\n  const file = DOCS[req.query.doc]\n  if (!file) return res.sendStatus(404)\n  fs.createReadStream(DOCS[req.query.doc]).pipe(res)\n}"],
    ['src/files/uuid-check.js', 'path-traversal-pattern', "const fs = require('fs')\nconst UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/\nexports.avatar = (req, res) => {\n  if (!UUID.test(req.params.id)) return res.sendStatus(400)\n  fs.createReadStream('./avatars/' + req.params.id + '.png').pipe(res)\n}"],
    ['src/files/random-name.js', 'path-traversal-pattern', "const fs = require('fs')\nconst crypto = require('crypto')\nexports.save = (req) => {\n  const name = crypto.randomUUID()\n  fs.writeFileSync('uploads/' + name, req.body.data)\n  return name\n}"],
    ['src/files/py_secure.py', 'path-traversal-pattern', "from flask import request, send_from_directory\nfrom werkzeug.utils import secure_filename\n\ndef download():\n    name = secure_filename(request.args['f'])\n    return send_from_directory('exports', name)"],
    ['src/files/go_base.go', 'path-traversal-pattern', "package files\n\nimport (\n\t\"net/http\"\n\t\"path/filepath\"\n)\n\nfunc Serve(w http.ResponseWriter, r *http.Request) {\n\thttp.ServeFile(w, r, filepath.Join(\"exports\", filepath.Base(r.URL.Query().Get(\"f\"))))\n}"],
    ['src/files/cli-read.js', 'path-traversal-pattern', "const fs = require('fs')\nconst file = process.argv[2]\nif (file) console.log(fs.readFileSync(file, 'utf8'))"],
  ])

  g('redirects', [
    ['src/auth/login-next.js', 'open-redirect-pattern', "exports.requireLogin = (req, res) => res.redirect('/login?next=' + encodeURIComponent(req.originalUrl))"],
    ['src/auth/allowed-hosts.js', 'open-redirect-pattern', "const ALLOWED_HOSTS = new Set(['harbourside.dev', 'www.harbourside.dev'])\nexports.after = (req, res) => {\n  const url = new URL(req.query.next, 'https://harbourside.dev')\n  if (!ALLOWED_HOSTS.has(url.host)) return res.redirect('/')\n  res.redirect(url.href)\n}"],
    ['src/auth/relative-regex.js', 'open-redirect-pattern', "exports.after = (req, res) => {\n  const next = String(req.query.next || '/')\n  if (!/^\\/[^/\\\\]/.test(next)) return res.redirect('/')\n  res.redirect(next)\n}"],
    ['src/auth/route-table.js', 'open-redirect-pattern', "const ROUTES = { orders: '/account/orders', profile: '/account/profile' }\nexports.go = (req, res) => res.redirect(ROUTES[req.query.page] || '/')"],
    ['src/auth/py_safe_redirect.py', 'open-redirect-pattern', "from urllib.parse import urlparse\nfrom flask import redirect, request, url_for\n\ndef after_login():\n    target = request.args.get('next', '')\n    if urlparse(target).netloc:\n        return redirect(url_for('index'))\n    return redirect(url_for('account'))"],
    ['src/web/client-nav.js', 'open-redirect-pattern', "export function goHome() {\n  window.location.href = '/dashboard'\n}"],
    ['src/web/paginate.js', 'open-redirect-pattern', "export function goToPage(n) {\n  const p = new URLSearchParams(location.search)\n  p.set('page', String(n))\n  location.href = location.pathname + '?' + p.toString()\n}"],
    ['src/auth/referer-back.js', 'open-redirect-pattern', "exports.back = (req, res) => res.redirect(req.get('Referrer') || '/')"],
  ])

  g('regex', [
    ['src/validate/ipv4.js', 'regex-dos', "const IPV4 = /^(\\d{1,3}\\.){3}\\d{1,3}$/\nexports.isIp = (s) => IPV4.test(s)"],
    ['src/validate/slug.js', 'regex-dos', "const SLUG = /^(?:[a-z0-9]+-)*[a-z0-9]+$/\nexports.isSlug = (s) => s.length < 100 && SLUG.test(s)"],
    ['src/validate/alt.js', 'regex-dos', "const TAG = /^(a|b)+$/\nexports.ok = (s) => TAG.test(s)"],
    ['src/validate/prefix-alt.js', 'regex-dos', "// ab and a cannot overlap: after an a the next character decides, so this runs in linear time.\nconst RUN = /^(?:ab|a)+$/\nexports.ok = (s) => RUN.test(s)"],
    ['src/validate/csv-line.js', 'regex-dos', "const LIST = /^\\w+(?:\\s*,\\s*\\w+)*$/\nexports.isList = (s) => s.length < 200 && LIST.test(s)"],
    ['src/validate/version.py', 'regex-dos', "import re\n\nVERSION = re.compile(r'^(\\d+\\.)+\\d+$')\n\ndef ok(s):\n    return bool(VERSION.match(s))"],
  ])

  g('xml-ip-url', [
    ['src/import/feed-safe.js', 'xxe-and-deserialize', "const libxml = require('libxmljs')\nexports.parse = (xml) => libxml.parseXml(xml, { noent: false, nonet: true })"],
    ['src/import/py_xml.py', 'xxe-and-deserialize', "from lxml import etree\n\nPARSER = etree.XMLParser(resolve_entities=False, no_network=True)\n\ndef parse(data):\n    return etree.fromstring(data, PARSER)"],
    ['src/import/cache-php.php', 'xxe-and-deserialize', "<?php\n// The blob is our own cache file, written by this application.\nfunction readCache(string $blob) {\n    return unserialize($blob, ['allowed_classes' => false]);\n}"],
    ['src/net/private-ranges.js', 'hardcoded-ip', "exports.PRIVATE = ['10.0.0.0', '192.168.0.1', '172.16.0.1', '127.0.0.1', '0.0.0.0']"],
    ['src/net/doc-ranges.js', 'hardcoded-ip', "// RFC 5737 documentation addresses, used in the examples of the help screen.\nexports.EXAMPLE = ['203.0.113.7', '198.51.100.20', '192.0.2.1']"],
    ['src/net/version-ip.js', 'hardcoded-ip', "exports.agentVersion = '1.20.4.7' // version of the agent build"],
    ['src/net/metadata.js', 'hardcoded-ip', "exports.METADATA = 'http://169.254.169.254/latest/meta-data/' // link-local instance metadata"],
    ['src/net/resolver.js', 'hardcoded-ip', "const DNS_FALLBACKS = ['1.1.1.1', '9.9.9.9']\nexports.dns = () => DNS_FALLBACKS"],
    ['src/db/url-placeholder.js', 'credentials-in-urls', "exports.EXAMPLE = 'postgres://user:password@localhost:5432/app' // shown in the setup help"],
    ['src/db/url-template.js', 'credentials-in-urls', "exports.url = (u, p) => §postgres://@{u}:@{p}@db.internal:5432/app§"],
    ['src/db/git-ssh.js', 'credentials-in-urls', "exports.REPO = 'git@github.com:harbourside/shop.git'"],
    ['src/db/scoped-pkg.js', 'credentials-in-urls', "exports.PKG = 'https://registry.npmjs.org/@harbourside/ui/-/ui-1.2.0.tgz'"],
    ['src/db/url-env.js', 'credentials-in-urls', "const { Pool } = require('pg')\nmodule.exports = new Pool({ connectionString: process.env.DATABASE_URL })"],
  ])

  g('logs', [
    ['src/log/redacted.js', 'pii-in-logs', "exports.requestReset = (user) => {\n  console.log('reset requested for', redact(user.email))\n}"],
    ['src/log/masked.js', 'pii-in-logs', "exports.charge = (card) => {\n  console.info('charging card', maskCard(card.number))\n}"],
    ['src/log/counts.js', 'pii-in-logs', "exports.report = (emailCount, sent) => {\n  console.log('emails queued', emailCount, 'sent', sent)\n}"],
    ['src/log/tokens-used.js', 'pii-in-logs', "exports.usage = (tokensUsed) => {\n  console.log('model tokens used', tokensUsed)\n}"],
    ['src/log/field-names.js', 'pii-in-logs', "exports.validate = (body) => {\n  if (!body.email) console.warn('missing email field')\n  if (!body.password) console.warn('missing password field')\n}"],
    ['src/log/heap.js', 'pii-in-logs', "exports.dump = (heapAddress) => {\n  console.debug('heap address', heapAddress)\n}"],
    ['src/log/phoneme.js', 'pii-in-logs', "exports.speak = (phonemeCount) => {\n  console.log('phonemes', phonemeCount)\n}"],
    ['src/log/policy.js', 'pii-in-logs', "exports.boot = (cfg) => {\n  console.log('minimum length', cfg.passwordMinLength)\n}"],
    ['src/log/py_tokens.py', 'pii-in-logs', "def report(tokens_used):\n    print('model tokens used', tokens_used)"],
    ['src/log/go_tokens.go', 'pii-in-logs', "package logx\n\nimport \"fmt\"\n\nfunc Report(tokensUsed int) {\n\tfmt.Println(\"tokens used\", tokensUsed)\n}"],
    ['src/log/hashed.js', 'pii-in-logs', "const crypto = require('crypto')\nexports.seen = (user) => {\n  const hash = crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 8)\n  console.log('user seen', hash)\n}"],
    ['src/log/user-id.js', 'pii-in-logs', "exports.login = (user) => {\n  console.log('login', user.id)\n}"],
    ['src/web/storage-theme.js', 'local-storage-pii', "export function saveTheme(t) {\n  localStorage.setItem('theme', t)\n}"],
    ['src/web/storage-tokenizer.js', 'local-storage-pii', "export function saveMode(m) {\n  localStorage.setItem('tokenizerMode', m)\n}"],
    ['src/web/storage-email-pref.js', 'local-storage-pii', "export function saveDigest(freq) {\n  localStorage.setItem('emailDigestFrequency', freq)\n}"],
    ['src/web/storage-hint.js', 'local-storage-pii', "export function hintShown() {\n  sessionStorage.setItem('passwordHintShown', 'true')\n}"],
    ['src/web/storage-draft.js', 'local-storage-pii', "export function keepDraft(id, text) {\n  localStorage.setItem(§draft-@{id}§, text)\n}"],
  ])

  g('risky', [
    ['src/lua/redis-eval.js', 'risky-code', "exports.incr = (redis, key) => redis.eval('return redis.call(\"INCR\", KEYS[1])', 1, key)"],
    ['src/lua/py_eval.py', 'risky-code', "def total(df):\n    return df.eval('price * quantity')"],
    ['src/web/new-function.js', 'risky-code', "// A fixed adder; the body is a literal, not text from a user.\nconst add = new Function('a', 'b', 'return a + b')\nexports.add = add"],
    ['src/web/sanitized-html.js', 'risky-code', "import DOMPurify from 'dompurify'\nexport function show(el, html) {\n  el.innerHTML = DOMPurify.sanitize(html)\n}"],
    ['src/web/clear-html.js', 'risky-code', "export function clear(el) {\n  el.innerHTML = ''\n}"],
    ['src/web/template-const.js', 'risky-code', "const ROW = '<li class=\"row\"></li>'\nexport function addRow(list) {\n  list.insertAdjacentHTML('beforeend', ROW)\n}"],
    ['src/web/react-safe.jsx', 'risky-code', "import DOMPurify from 'dompurify'\nexport const Note = ({ html }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />"],
    ['src/web/text-content.js', 'risky-code', "export function label(el, text) {\n  el.textContent = text\n}"],
    ['src/ops/git-version.js', 'risky-code', "const child_process = require('child_process')\nexports.version = () => child_process.execSync('git rev-parse ' + 'HEAD').toString().trim()"],
    ['src/ops/clear_screen.py', 'risky-code', "import os\n\ndef clear():\n    os.system('cls' if os.name == 'nt' else 'clear')"],
    ['src/ops/py_yaml.py', 'risky-code', "import yaml\n\ndef load(text):\n    return yaml.load(text, Loader=yaml.CSafeLoader)"],
    ['src/ops/dry_run.py', 'risky-code', "def run(checker):\n    return checker.run(verify=False)  # skips the slow upload step, not TLS"],
    ['src/ops/react-key.js', 'risky-code', "export function withKeys(items) {\n  return items.map((item) => ({ key: Math.random(), item }))\n}"],
    ['src/ops/sitemap.js', 'risky-code', "exports.NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'"],
    ['src/ops/soap-ns.js', 'risky-code', "exports.ENVELOPE = 'http://schemas.xmlsoap.org/soap/envelope/'"],
    ['src/ops/docker-host.js', 'risky-code', "exports.API = 'http://host.docker.internal:8080/health'"],
    ['src/ops/localhost.js', 'risky-code', "exports.API = 'http://localhost:3000/health'"],
    ['src/ops/md5-info.py', 'risky-code', "import hashlib\n\ndef dedupe_key(data):\n    return hashlib.md5(data, usedforsecurity=False).hexdigest()  # duplicate detection only"],
    ['src/ops/sha-256.js', 'risky-code', "const crypto = require('crypto')\nexports.id = (s) => crypto.createHash('sha256').update(s).digest('hex')"],
    ['src/ops/py_pickle.py', 'risky-code', "import hashlib, hmac, pickle\n\ndef load_cache(path, key):\n    raw = open(path, 'rb').read()\n    mac, body = raw[:32], raw[32:]\n    if not hmac.compare_digest(mac, hmac.new(key, body, hashlib.sha256).digest()):\n        raise ValueError('cache file was changed')\n    return pickle.loads(body)"],
  ])

  g('misc-web', [
    ['src/server/debug-env.py', 'debug-enabled', "import os\n\nDEBUG = os.environ.get('DEBUG', 'False') == 'True'"],
    ['src/server/flask-run.py', 'debug-enabled', "from app import app\n\nif __name__ == '__main__':\n    app.run(host='127.0.0.1', debug=False)"],
    ['docker-compose.override.yml', 'debug-enabled', "services:\n  web:\n    environment:\n      NODE_ENV: development\n    volumes:\n      - ./src:/app/src"],
    ['src/server/devtools-guard.js', 'debug-enabled', "const { app, BrowserWindow } = require('electron')\nexports.open = () => new BrowserWindow({ webPreferences: { devtools: !app.isPackaged } })"],
    ['public/links.html', 'target-blank-noopener', "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Links</title></head>\n<body>\n<a href=\"https://example.org/docs\" target=\"_blank\" rel=\"noopener noreferrer\">Docs</a>\n<a\n  href=\"https://example.org/help\"\n  target=\"_blank\"\n  rel=\"noopener\"\n>Help</a>\n</body></html>"],
    ['public/cdn.html', 'sri-missing', "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Shop</title>\n<script src=\"/static/app.js\"></script>\n<script src=\"https://cdn.jsdelivr.net/npm/htmx.org@1.9.12/dist/htmx.min.js\"\n  integrity=\"sha384-qbtRIzm7WIhyF1ed6Q1GGHzFtX3gIUjJZ1gFCWxH3mYQ5wYyKqVXtVnfwJxYQ9tv\"\n  crossorigin=\"anonymous\"></script>\n</head><body></body></html>"],
    ['public/svg-ns.html', 'mixed-content', "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Icon</title></head>\n<body><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" role=\"img\" aria-label=\"ok\"><circle cx=\"8\" cy=\"8\" r=\"6\"/></svg></body></html>"],
    ['src/ui/emoji.js', 'cp-js', "// A family emoji is joined with zero-width joiners on purpose.\nexports.FAMILY = '👨@ZWJ@👩@ZWJ@👧'"],
  ])

  return { projects: out, expect: {} }
}
