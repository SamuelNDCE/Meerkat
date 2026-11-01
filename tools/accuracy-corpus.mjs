// The accuracy corpus: small, realistic KNOWN-BAD projects with every planted defect written down, so a rule that stops catching its defect
// (a false negative) is caught by a test. The mirror image of tools/compat-fixtures.mjs, whose projects are clean (false positives).
//   node tools/accuracy-corpus.mjs --out <dir>            write the projects and <dir>/planted.json
//   node tools/accuracy-corpus.mjs --run [--out <dir>]    also run every pack on every project, print the recall table, and
//                                                         refresh the generated block in docs/accuracy.md (--no-docs to skip that)
//   node tools/accuracy-corpus.mjs --run --discover       also print, for each planted defect, what the run reported at its place
// Each defect sits on its own line of otherwise clean code; the manifest says suite, check, rule, file and line. Secrets are built at
// runtime from random parts, so this source never contains a real-looking secret.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

// ---------- random-looking secrets, assembled at runtime ----------
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const R = rng(20261031)
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const UPNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const HEX = '0123456789abcdef'
const tok = (n, alphabet = ALNUM) => Array.from({ length: n }, () => alphabet[Math.floor(R() * alphabet.length)]).join('')
const S = {
  awsId: ['AK', 'IA', tok(16, UPNUM)].join(''),
  awsSecret: tok(40),
  ghPat: ['gh', 'p_', tok(36)].join(''),
  stripe: ['sk', '_live_', tok(24)].join(''),
  slack: ['xo', 'xb-', tok(11, '0123456789'), '-', tok(12, '0123456789'), '-', tok(24)].join(''),
  google: ['AI', 'za', tok(35)].join(''),
  sendgrid: ['S', 'G.', tok(22), '.', tok(43)].join(''),
  npm: ['np', 'm_', tok(36)].join(''),
  shopify: ['shp', 'at_', tok(32, HEX)].join(''),
  twilio: ['S', 'K', tok(32, HEX)].join(''),
  telegram: [tok(9, '0123456789'), ':', tok(35)].join(''),
  discord: ['https://discord', '.com/api/webhooks/', tok(18, '0123456789'), '/', tok(68)].join(''),
  dbPass: tok(16),
  jwt: ['eyJ', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJ', tok(60), '.', tok(43)].join(''),
  pemBody: Array.from({ length: 6 }, () => tok(64, ALNUM + '+/')).join('\n'),
}
const pem = () => ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ') + '\n' + S.pemBody + '\n' + ['-----END', 'RSA PRIVATE KEY-----'].join(' ')

// ---------- how a project is written down ----------
// A file is an array of items: a plain line, or d(key, description, line) for a line that carries a planted defect.
const d = (key, desc, text) => ({ key, desc, text })
// A defect that is the ABSENCE of something (no licence, no HSTS header): file is where it would be reported ('' = anywhere).
const a = (key, desc, file = '') => ({ key, desc, file })

const MIT = `MIT License

Copyright (c) 2026 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`
const readme = (name) => `# ${name}

A small service used to exercise Meerkat. It has a real purpose, an install step and a usage step.

## Install

Run the install command for your platform, then build once.

## Usage

Start the service and open the local address it prints.

## Licence

MIT, see LICENSE.
`
const SECURITY = '# Security policy\n\nPlease report a security problem privately by email to security@example.com. Do not open a public issue.\n'
const tidy = (name, gi = 'node_modules\n.env\ndist\ncoverage\n') => ({ LICENSE: [MIT], 'README.md': [readme(name)], '.gitignore': [gi], 'SECURITY.md': [SECURITY], '.editorconfig': ['root = true\n\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n'] })
const pkg = (name, extra = {}) => [JSON.stringify({ name, version: '1.2.0', description: `${name} service`, license: 'MIT', private: true, engines: { node: '>=20' }, ...extra }, null, 2)]

// ---------- the projects ----------
// EXPECT: defect key -> 'check' or 'check/rule' ('a|b' lists alternative checks that may report it). Written from reviewing a real run.
const EXPECT = {}
// EXPECT-BEGIN
Object.assign(EXPECT, {
  'js-cors-wildcard': 'cors-wildcard',
  'js-exec-concat': 'cp-js|risky-code',
  'js-eval': 'risky-code|cp-js',
  'js-open-redirect': 'open-redirect-pattern',
  'js-path-traversal': 'path-traversal-pattern',
  'js-sql-concat': 'sql-concat',
  'js-md5-password': 'weak-crypto-modes|risky-code',
  'js-cookie-flags': 'cookie-flags',
  'js-jwt-none': 'jwt-weak',
  'js-aes-ecb': 'weak-crypto-modes',
  'js-unhandled-promise': 'js-unhandled-promise',
  'js-empty-catch': 'empty-catch',
  'js-error-leak': 'error-leak',
  'js-hardcoded-ip': 'hardcoded-ip',
  'js-loose-equality': 'js-eqeqeq',
  'js-await-in-loop': 'js-await-in-loop',
  'js-regex-dos': 'regex-dos',
  'js-sync-fs-handler': 'sync-fs-in-handlers',
  'js-math-random-token': 'weak-crypto-modes|risky-code',
  'js-debug-leftover': 'debug-leftovers',
  'js-proto-pollution': 'js-prototype-pollution',
  'js-innerhtml': 'risky-code|cp-js',
  'js-focused-test': 'focused-tests',
  'js-skipped-test': 'skipped-tests',
  'ts-ignore': 'ts-ignore-comments',
  'py-shell-true': 'risky-code|cp-python',
  'py-pickle': 'pickle-load|risky-code|cp-python',
  'py-yaml-load': 'risky-code|cp-python',
  'py-verify-false': 'risky-code|cp-python',
  'py-no-timeout': 'cp-python/py-requests-no-timeout',
  'py-bare-except': 'py-bare-except',
  'py-mutable-default': 'py-mutable-default',
  'py-assert-prod': 'py-assert-in-prod',
  'py-md5': 'risky-code|cp-python|weak-crypto-modes',
  'py-mktemp': 'cp-python/py-mktemp-race',
  'py-os-system': 'risky-code|cp-python',
  'py-sql-fstring': 'sql-concat|cp-python',
  'py-random-token': 'risky-code|cp-python|weak-crypto-modes',
  'py-flask-debug': 'debug-enabled|cp-python',
  'go-defer-loop': 'go-defer-in-loop',
  'go-ignored-error': 'go-ignored-errors',
  'go-insecure-tls': 'risky-code|cp-go',
  'go-sql-concat': 'cp-go/go-sql-built-string',
  'go-exec-shell': 'cp-go/go-shell-dash-c',
  'go-md5': 'cp-go/go-md4-md5-sha1',
  'go-listen-no-timeouts': 'cp-go/go-default-listen-no-timeouts',
  'rust-wildcard-dep': 'rp-cargo/rcargo-wildcard-version|wildcard-versions',
  'rust-unsafe-no-safety': 'cp-rust/rs-unsafe-no-safety|unsafe-rust',
  'rust-unwrap-lib': 'cp-rust/rs-unwrap-in-library',
  'rust-blocking-async': 'rp-async/rasync-blocking-thread-sleep',
  'rust-blocking-fs-async': 'rp-async/rasync-blocking-fs',
  'rust-todo-macro': 'rust-todo-macros',
  'rust-transmute': 'cp-rust/rs-transmute',
  'java-runtime-exec': 'cp-java/java-runtime-exec-variable',
  'java-md5': 'cp-java/java-weak-digest',
  'java-deserialize': 'cp-java/java-object-stream-read',
  'java-sql-concat': 'cp-java/java-statement-concat',
  'java-empty-catch': 'empty-catch',
  'java-util-random': 'cp-java',
  'cs-binaryformatter': 'cp-dotnet-php-ruby/cs-binary-formatter',
  'cs-md5': 'cp-dotnet-php-ruby/cs-weak-hash',
  'cs-process-start': 'cp-dotnet-php-ruby',
  'cs-sql-concat': 'cp-dotnet-php-ruby/cs-sql-concat',
  'cs-cert-callback': 'cp-dotnet-php-ruby/cs-accept-any-certificate',
  'php-eval': 'cp-dotnet-php-ruby/php-eval-assert',
  'php-sql-concat': 'cp-dotnet-php-ruby/php-sql-concat',
  'php-unserialize': 'cp-dotnet-php-ruby/php-unserialize-variable',
  'php-md5-password': 'weak-crypto-modes|cp-dotnet-php-ruby',
  'php-include-var': 'cp-dotnet-php-ruby/php-include-variable',
  'php-system': 'cp-dotnet-php-ruby',
  'rb-eval': 'cp-dotnet-php-ruby/rb-eval-params',
  'rb-system-interp': 'cp-dotnet-php-ruby/rb-system-interpolation',
  'rb-marshal-load': 'cp-dotnet-php-ruby/rb-marshal-load',
  'rb-yaml-load': 'cp-dotnet-php-ruby|xxe-and-deserialize',
  'rb-md5': 'cp-dotnet-php-ruby|weak-crypto-modes',
  'rb-send-param': 'cp-dotnet-php-ruby',
  'docker-latest-tag': 'docker-base-pinning',
  'docker-curl-pipe': 'ip-docker/docker-curl-pipe-shell',
  'docker-env-secret': 'ip-docker/docker-secret-in-env',
  'docker-add-http': 'ip-docker/docker-add-from-url',
  'docker-chmod-777': 'ip-docker/docker-chmod-world-writable',
  'docker-user-root': 'ip-docker/docker-user-root-last',
  'k8s-host-network': 'ip-k8s/k8s-host-network',
  'k8s-host-pid': 'ip-k8s/k8s-host-pid',
  'k8s-latest-image': 'ip-k8s/k8s-image-latest',
  'k8s-privileged': 'ip-k8s/k8s-privileged',
  'k8s-priv-escalation': 'ip-k8s/k8s-priv-escalation-true',
  'k8s-run-as-root': 'ip-k8s/k8s-run-as-user-zero',
  'k8s-inline-secret': 'ip-k8s/k8s-secret-literal-env',
  'k8s-docker-sock': 'ip-k8s/k8s-host-path-docker-socket',
  'tf-open-ssh': 'ip-terraform-compose/tf-sg-open-22',
  'tf-public-bucket': 'ip-terraform-compose/tf-s3-public-acl',
  'tf-db-public': 'ip-terraform-compose/tf-rds-public',
  'tf-db-unencrypted': 'ip-terraform-compose/tf-rds-unencrypted',
  'tf-hardcoded-password': 'ip-terraform-compose|secrets-plus',
  'tf-iam-star': 'ip-terraform-compose/tf-iam-wildcard-action',
  'compose-latest': 'compose-hygiene|ip-terraform-compose',
  'compose-password': 'compose-hygiene|secrets-plus',
  'compose-db-port': 'compose-hygiene|ip-terraform-compose',
  'compose-privileged': 'compose-hygiene|ip-terraform-compose',
  'compose-host-network': 'compose-hygiene|ip-terraform-compose',
  'compose-docker-sock': 'ip-terraform-compose|compose-hygiene',
  'gha-pr-target': 'ip-gha/gha-pull-request-target-trigger',
  'gha-write-all': 'ip-gha/gha-permissions-write-all',
  'gha-checkout-pr-head': 'ip-gha/gha-prt-checkout-pr-head',
  'gha-unpinned-action': 'workflow-security|ip-gha|github-actions-reusable',
  'gha-untrusted-input': 'ip-gha/gha-inject-issue-text-run',
  'gha-curl-bash': 'ip-gha/gha-curl-pipe-shell',
  'gitlab-image-latest': 'gitlab-ci-images',
  'helm-password': 'helm-values-secrets|secrets-plus',
  'el-node-integration': 'electron-node-integration',
  'el-context-isolation': 'electron-context-isolation',
  'el-web-security': 'electron-web-security',
  'el-insecure-content': 'electron-web-security|ep-window',
  'el-sandbox-off': 'ep-window/ep-sandbox-off',
  'el-remote-module': 'electron-remote-module',
  'el-remote-url': 'ep-window/ep-load-url-http',
  'el-devtools-open': 'electron-devtools-prod',
  'el-open-external-var': 'electron-open-external',
  'el-ipc-no-sender': 'electron-ipc-validation|ep-ipc-preload',
  'el-updater-http': 'electron-updater-https',
  'el-expose-ipcrenderer': 'electron-preload-exposure',
  'html-no-lang': 'html-structure|ui-static',
  'html-no-viewport': 'meta-seo|html-structure|ui-static',
  'html-http-css': 'wh-html/stylesheet-over-http|mixed-content',
  'html-sri-missing': 'sri-missing',
  'html-img-no-alt': 'image-alt-quality|ui-static|html-valid-basics',
  'html-inline-handler': 'inline-event-handlers',
  'html-blank-no-rel': 'target-blank-noopener',
  'html-link-text': 'link-text',
  'html-iframe-no-title': 'iframe-title',
  'html-input-no-label': 'ui-static|html-valid-basics',
  'html-duplicate-id': 'duplicate-ids',
  'html-table-no-th': 'table-headers',
  'html-video-no-captions': 'media-captions',
  'html-tabindex-positive': 'ui-static|html-valid-basics',
  'html-http-link-mixed': 'mixed-content',
  'css-outline-none': 'focus-visible',
  'css-low-contrast': 'css-contrast',
  'nginx-old-tls': 'wh-headers/tls-protocol-legacy',
  'nginx-csp-unsafe-inline': 'wh-headers/csp-unsafe-inline-script',
  'nginx-cors-star': 'wh-headers',
  'headers-hsts': 'wh-headers/hsts-missing',
  'headers-xfo': 'wh-headers/xfo-missing',
  'headers-nosniff': 'wh-headers/xcto-missing',
  'headers-referrer': 'wh-headers/referrer-policy-missing',
  'pkg-postinstall-curl': 'install-scripts',
  'pkg-wildcard': 'wildcard-versions',
  'pkg-latest': 'wildcard-versions|dependency-pinning',
  'pkg-http-tarball': 'wh-supply|dependency-pinning',
  'pkg-git-http': 'wh-supply|dependency-pinning',
  'pkg-dev-in-prod': 'dev-deps-in-prod',
  'lock-http-resolved': 'wh-supply/lockfile-resolved-over-http',
  'npmrc-token': 'secrets-plus/npmrc-auth-token',
  'npmrc-strict-ssl': 'wh-supply|secrets-plus',
  'req-unpinned': 'dependency-pinning',
  'repo-no-license': 'license',
  'repo-no-security-policy': 'security-policy',
  'repo-no-gitignore': 'gitignore-essentials',
  'repo-readme-thin': 'readme-sections|readme-install-usage',
  'repo-no-ci': 'ci-present',
  'csv-ragged': 'csv-consistent',
  'md-heading-skip': 'markdown-headings',
  'md-broken-anchor': 'markdown-anchors',
  'md-typo': 'spell-common-typos',
  'md-unclosed-fence': 'markdown-code-fences',
  'changelog-format': 'changelog-format',
  'json-dup-key': 'json-duplicate-keys',
  'json-invalid': 'json-valid',
  'toml-invalid': 'toml-valid',
  'yaml-invalid': 'yaml-valid',
  'conflict-marker': 'conflict-markers',
  'trailing-ws': 'trailing-whitespace',
  'unicode-control': 'unicode-control-chars',
  'makefile-spaces': 'makefile-tabs',
  'ml-no-seed': 'random-seed-missing',
  'env-tracked': 'sensitive-files|secrets-plus',
  'sec-aws-id': 'secrets-plus/aws-access-key-id',
  'sec-aws-secret': 'secrets-plus/aws-secret-access-key',
  'sec-github-pat': 'secrets-plus/github-pat-classic',
  'sec-stripe': 'secrets-plus/stripe-live-secret-key',
  'sec-slack': 'secrets-plus/slack-bot-token',
  'sec-google': 'secrets-plus/gcp-api-key',
  'sec-sendgrid': 'secrets-plus/sendgrid-api-key',
  'sec-npm': 'secrets-plus/npm-access-token',
  'sec-shopify': 'secrets-plus/shopify-access-token',
  'sec-twilio': 'secrets-plus/twilio-api-key-sid',
  'sec-telegram': 'secrets-plus',
  'sec-discord': 'secrets-plus/discord-webhook-url',
  'sec-jwt': 'secrets-plus/jwt-literal',
  'sec-db-url': 'secrets-plus/postgres-url-password',
  'sec-password-literal': 'secrets-plus',
  'sec-private-key': 'secrets-plus',
  'sec-script-token': 'secrets-plus/github-app-server-token',
  'sec-py-secret': 'secrets-plus/aws-session-key-id',
  'hist-secret-committed': 'git-history-secrets',
  'hist-long-subject': 'commit-message-format',
  'hist-vague-subject': 'commit-message-format',
  'publish-env': 'wh-publish-root/env-file-present',
  'publish-git': 'wh-publish-root/git-dir-in-publish',
  'publish-sql': 'wh-publish-root/database-dump-in-public',
})
// EXPECT-END

const PROJECTS = {}

PROJECTS['node-api'] = {
  files: {
    ...tidy('node-api'),
    'package.json': pkg('node-api', { main: 'server.js', scripts: { start: 'node server.js', test: 'node --test' }, dependencies: { express: '4.19.2', cors: '2.8.5', jsonwebtoken: '9.0.2' } }),
    'server.js': [
      "'use strict'",
      "const express = require('express')",
      "const cors = require('cors')",
      "const cp = require('child_process')",
      "const crypto = require('crypto')",
      "const fs = require('fs')",
      "const path = require('path')",
      "const jwt = require('jsonwebtoken')",
      "const db = require('./lib/db')",
      'const app = express()',
      'app.use(express.json())',
      d('js-cors-wildcard', 'CORS allows every origin together with credentials', "app.use(cors({ origin: '*', credentials: true }))"),
      '',
      "app.get('/ping', (req, res) => {",
      d('js-exec-concat', 'child_process.exec with a shell string built from a query parameter', "  cp.exec('ping -c 1 ' + req.query.host, (err, out) => res.send(out))"),
      '})',
      '',
      "app.post('/calc', (req, res) => {",
      d('js-eval', 'eval of a request body field', '  const result = eval(req.body.expression)'),
      '  res.json({ result })',
      '})',
      '',
      "app.get('/go', (req, res) => {",
      d('js-open-redirect', 'redirect to a user supplied address', '  res.redirect(req.query.next)'),
      '})',
      '',
      "app.get('/files/:name', (req, res) => {",
      d('js-path-traversal', 'file path built from a URL parameter', "  const body = fs.readFileSync(path.join(__dirname, 'uploads', req.params.name))"),
      '  res.send(body)',
      '})',
      '',
      "app.post('/users/find', async (req, res) => {",
      d('js-sql-concat', 'SQL text built by concatenating request input', `  const rows = await db.query("SELECT * FROM users WHERE name = '" + req.body.name + "'")`),
      '  res.json(rows)',
      '})',
      '',
      "app.post('/login', async (req, res) => {",
      d('js-md5-password', 'password hashed with MD5', "  const digest = crypto.createHash('md5').update(req.body.password).digest('hex')"),
      '  const user = await db.findByDigest(digest)',
      d('js-cookie-flags', 'session cookie set without httpOnly, secure or sameSite', "  res.cookie('sid', user.sid)"),
      '  res.json({ ok: true })',
      '})',
      '',
      'function sign(payload) {',
      d('js-jwt-none', 'JWT signed with the none algorithm', "  return jwt.sign(payload, null, { algorithm: 'none' })"),
      '}',
      '',
      'function encrypt(buf, key) {',
      d('js-aes-ecb', 'AES in ECB mode', "  const c = crypto.createCipheriv('aes-128-ecb', key, null)"),
      '  return Buffer.concat([c.update(buf), c.final()])',
      '}',
      '',
      'function load(id) {',
      "  return fetch('https://internal.example.com/users/' + id).then((r) => r.json())",
      '}',
      "app.get('/users/:id', (req, res) => {",
      d('js-unhandled-promise', 'a promise chain with no catch', '  load(req.params.id).then((u) => res.json(u))'),
      '})',
      '',
      'function parseBody(raw) {',
      '  try {',
      '    return JSON.parse(raw)',
      d('js-empty-catch', 'an empty catch block that swallows the error', '  } catch (e) {}'),
      '  return null',
      '}',
      '',
      "app.get('/boom', (req, res) => {",
      '  try {',
      '    sign({})',
      '  } catch (err) {',
      d('js-error-leak', 'the stack trace is sent to the client', '    res.status(500).send(err.stack)'),
      '  }',
      '})',
      '',
      d('js-hardcoded-ip', 'a public IP address written into the source', "const REDIS_HOST = '52.14.201.77'"),
      '',
      'function role(user) {',
      d('js-loose-equality', 'loose equality on a role string', "  if (user.role == 'admin') return 'all'"),
      "  return 'none'",
      '}',
      '',
      'async function loadAll(ids) {',
      '  const out = []',
      '  for (const id of ids) {',
      d('js-await-in-loop', 'await inside a loop, so the requests run one by one', '    out.push(await load(id))'),
      '  }',
      '  return out',
      '}',
      '',
      'function isSlug(text) {',
      d('js-regex-dos', 'a regular expression with nested quantifiers', '  return /^(\\w+\\s?)+$/.test(text)'),
      '}',
      '',
      "app.get('/config', (req, res) => {",
      d('js-sync-fs-handler', 'a blocking file read inside a request handler', "  const raw = fs.readFileSync('/etc/app/config.json', 'utf8')"),
      '  res.type(\'json\').send(raw)',
      '})',
      '',
      "app.post('/token', (req, res) => {",
      d('js-math-random-token', 'a session token made with Math.random', '  const token = Math.random().toString(36).slice(2)'),
      '  res.json({ token })',
      '})',
      '',
      'function logUser(user) {',
      d('js-debug-leftover', 'a debugger statement left in the code', '  debugger'),
      '  return user',
      '}',
      '',
      'module.exports = { app, parseBody, loadAll, isSlug, logUser, encrypt, role, REDIS_HOST }',
      '',
    ],
    'lib/db.js': ["'use strict'", 'const rows = []', "module.exports = { query: async () => rows, findByDigest: async () => ({ sid: 'one' }) }", ''],
    'lib/merge.js': [
      "'use strict'",
      'function merge(target, source) {',
      '  for (const key in source) {',
      "    if (typeof source[key] === 'object' && source[key] !== null) {",
      d('js-proto-pollution', 'a recursive merge that copies __proto__ keys', '      merge((target[key] = target[key] || {}), source[key])'),
      '    } else {',
      '      target[key] = source[key]',
      '    }',
      '  }',
      '  return target',
      '}',
      'module.exports = { merge }',
      '',
    ],
    'public/app.js': [
      "'use strict'",
      "const out = document.getElementById('out')",
      d('js-innerhtml', 'innerHTML set from the URL hash', 'out.innerHTML = decodeURIComponent(location.hash.slice(1))'),
      '',
    ],
    'test/server.test.js': [
      "const test = require('node:test')",
      "const assert = require('node:assert')",
      "const { isSlug } = require('../server')",
      d('js-focused-test', 'a focused test that silently disables the rest', "test.only('accepts a slug', () => { assert.ok(isSlug('a b')) })"),
      d('js-skipped-test', 'a skipped test left behind', "test.skip('rejects an empty slug', () => { assert.ok(!isSlug('')) })"),
      '',
    ],
    'src/util.ts': [
      d('ts-ignore', 'a @ts-ignore comment hiding a type error', '// @ts-ignore'),
      'export const count: number = JSON.parse(localStorage.getItem("n") ?? "0")',
      '',
    ],
  },
}

PROJECTS['py-service'] = {
  files: {
    ...tidy('py-service', '__pycache__/\n*.pyc\n.venv/\n.env\n'),
    'pyproject.toml': ['[project]\nname = "py-service"\nversion = "0.3.0"\nrequires-python = ">=3.10"\nlicense = { text = "MIT" }\ndependencies = ["flask==3.0.3", "requests==2.32.3", "pyyaml==6.0.2"]\n'],
    'app.py': [
      'import hashlib',
      'import os',
      'import pickle',
      'import random',
      'import subprocess',
      'import tempfile',
      '',
      'import requests',
      'import yaml',
      'from flask import Flask, request',
      '',
      'app = Flask(__name__)',
      '',
      '',
      "@app.route('/run')",
      'def run():',
      "    cmd = request.args.get('cmd')",
      d('py-shell-true', 'subprocess with shell=True and request input', '    out = subprocess.run(cmd, shell=True, capture_output=True)'),
      '    return out.stdout',
      '',
      '',
      "@app.route('/load', methods=['POST'])",
      'def load():',
      d('py-pickle', 'pickle.loads on request data', '    obj = pickle.loads(request.data)'),
      '    return str(obj)',
      '',
      '',
      "@app.route('/cfg', methods=['POST'])",
      'def cfg():',
      d('py-yaml-load', 'yaml.load without a safe loader', '    data = yaml.load(request.data)'),
      '    return str(data)',
      '',
      '',
      'def fetch(url):',
      d('py-verify-false', 'TLS certificate checking turned off', '    return requests.get(url, verify=False, timeout=5)'),
      '',
      '',
      'def ping(url):',
      d('py-no-timeout', 'an HTTP request with no timeout', '    return requests.get(url)'),
      '',
      '',
      'def safe_int(text):',
      '    try:',
      '        return int(text)',
      d('py-bare-except', 'a bare except that hides every error', '    except:'),
      '        return 0',
      '',
      '',
      d('py-mutable-default', 'a mutable default argument', 'def collect(item, bucket=[]):'),
      '    bucket.append(item)',
      '    return bucket',
      '',
      '',
      'def delete(user, name):',
      d('py-assert-prod', 'authorisation checked with assert, which is removed under -O', '    assert user.is_admin'),
      "    os.remove(os.path.join('/srv/files', name))",
      '',
      '',
      'def fingerprint(text):',
      d('py-md5', 'MD5 used to hash a value', '    return hashlib.md5(text.encode()).hexdigest()'),
      '',
      '',
      'def scratch():',
      d('py-mktemp', 'tempfile.mktemp is racy', '    return tempfile.mktemp()'),
      '',
      '',
      'def cleanup(path):',
      d('py-os-system', 'os.system with a path from the caller', "    os.system('rm -rf ' + path)"),
      '',
      '',
      'def find(cursor, name):',
      d('py-sql-fstring', 'SQL built with an f-string', "    cursor.execute(f\"SELECT * FROM users WHERE name = '{name}'\")"),
      '',
      '',
      'def reset_token():',
      d('py-random-token', 'a password reset token from the random module', '    return str(random.randint(100000, 999999))'),
      '',
      '',
      "if __name__ == '__main__':",
      d('py-flask-debug', 'Flask debug mode on', "    app.run(host='0.0.0.0', debug=True)"),
      '',
    ],
  },
}

PROJECTS['native-langs'] = {
  files: {
    ...tidy('native-langs', 'target/\nbin/\nobj/\nvendor/\n.env\n'),
    'go/go.mod': ['module example.com/native/go\n\ngo 1.22\n'],
    'go/main.go': [
      'package main',
      '',
      'import (',
      '\t"crypto/md5"',
      '\t"crypto/tls"',
      '\t"database/sql"',
      '\t"net/http"',
      '\t"os"',
      '\t"os/exec"',
      ')',
      '',
      'func clean(paths []string) {',
      '\tfor _, p := range paths {',
      '\t\tf, _ := os.Open(p)',
      d('go-defer-loop', 'defer inside a loop keeps every file open', '\t\tdefer f.Close()'),
      '\t}',
      d('go-ignored-error', 'the error from os.Remove is thrown away', '\t_ = os.Remove("/tmp/lock")'),
      '}',
      '',
      'func client() *http.Client {',
      d('go-insecure-tls', 'TLS verification disabled', '\treturn &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}'),
      '}',
      '',
      'func find(db *sql.DB, name string) {',
      d('go-sql-concat', 'SQL built by string concatenation', '\trows, _ := db.Query("SELECT id FROM users WHERE name = \'" + name + "\'")'),
      '\t_ = rows',
      '}',
      '',
      'func run(cmd string) ([]byte, error) {',
      d('go-exec-shell', 'a shell started with a caller supplied command', '\treturn exec.Command("sh", "-c", cmd).Output()'),
      '}',
      '',
      'func sum(b []byte) [16]byte {',
      d('go-md5', 'MD5 used for hashing', '\treturn md5.Sum(b)'),
      '}',
      '',
      'func main() {',
      d('go-listen-no-timeouts', 'http.ListenAndServe with no server timeouts', '\t_ = http.ListenAndServe(":8080", nil)'),
      '}',
      '',
    ],
    'rust/Cargo.toml': [
      '[package]\nname = "native-rust"\nversion = "0.4.0"\nedition = "2021"\nlicense = "MIT"\ndescription = "A small library"\n\n[dependencies]',
      d('rust-wildcard-dep', 'a dependency with a wildcard version', 'serde = "*"'),
      'tokio = { version = "1.38", features = ["rt", "time"] }',
      '',
    ],
    'rust/src/lib.rs': [
      'use std::sync::Mutex;',
      '',
      'pub fn first(values: &[u8]) -> u8 {',
      '    let ptr = values.as_ptr();',
      d('rust-unsafe-no-safety', 'an unsafe block with no SAFETY comment', '    unsafe { *ptr }'),
      '}',
      '',
      'pub fn parse(text: &str) -> u32 {',
      d('rust-unwrap-lib', 'unwrap in library code', '    text.trim().parse::<u32>().unwrap()'),
      '}',
      '',
      'pub async fn wait_then_read() -> String {',
      d('rust-blocking-async', 'a blocking sleep inside an async function', '    std::thread::sleep(std::time::Duration::from_secs(2));'),
      d('rust-blocking-fs-async', 'a blocking file read inside an async function', '    std::fs::read_to_string("state.json").unwrap_or_default()'),
      '}',
      '',
      'pub fn later() {',
      d('rust-todo-macro', 'todo! left in the code', '    todo!()'),
      '}',
      '',
      'pub fn bits(x: u32) -> f32 {',
      d('rust-transmute', 'mem::transmute between number types', '    unsafe { std::mem::transmute::<u32, f32>(x) }'),
      '}',
      '',
      'pub static STATE: Mutex<Vec<u8>> = Mutex::new(Vec::new());',
      '',
    ],
    'java/src/Report.java': [
      'import java.io.ObjectInputStream;',
      'import java.io.InputStream;',
      'import java.security.MessageDigest;',
      'import java.sql.Connection;',
      'import java.sql.Statement;',
      'import java.util.Random;',
      '',
      'public class Report {',
      '    String run(String dir) throws Exception {',
      d('java-runtime-exec', 'Runtime.exec with a concatenated command', '        Process p = Runtime.getRuntime().exec("ls " + dir);'),
      '        return new String(p.getInputStream().readAllBytes());',
      '    }',
      '',
      '    byte[] digest(byte[] data) throws Exception {',
      d('java-md5', 'MD5 digest', '        return MessageDigest.getInstance("MD5").digest(data);'),
      '    }',
      '',
      '    Object read(InputStream in) throws Exception {',
      d('java-deserialize', 'ObjectInputStream on untrusted input', '        return new ObjectInputStream(in).readObject();'),
      '    }',
      '',
      '    void find(Connection c, String name) throws Exception {',
      '        Statement st = c.createStatement();',
      d('java-sql-concat', 'SQL built by concatenation', '        st.executeQuery("SELECT * FROM users WHERE name = \'" + name + "\'");'),
      '    }',
      '',
      '    void quiet() {',
      '        try {',
      '            run("/");',
      d('java-empty-catch', 'an empty catch block', '        } catch (Exception e) { }'),
      '    }',
      '',
      '    int token() {',
      d('java-util-random', 'java.util.Random used for a token', '        return new Random().nextInt();'),
      '    }',
      '}',
      '',
    ],
    'dotnet/Reports.cs': [
      'using System.Data.SqlClient;',
      'using System.Diagnostics;',
      'using System.Net;',
      'using System.Runtime.Serialization.Formatters.Binary;',
      'using System.Security.Cryptography;',
      '',
      'public class Reports',
      '{',
      '    public object Read(System.IO.Stream s)',
      '    {',
      d('cs-binaryformatter', 'BinaryFormatter on untrusted data', '        return new BinaryFormatter().Deserialize(s);'),
      '    }',
      '',
      '    public byte[] Hash(byte[] b)',
      '    {',
      d('cs-md5', 'MD5 hashing', '        return MD5.Create().ComputeHash(b);'),
      '    }',
      '',
      '    public void Open(string name)',
      '    {',
      d('cs-process-start', 'Process.Start with a concatenated command', '        Process.Start("cmd.exe", "/c type " + name);'),
      '    }',
      '',
      '    public SqlCommand Find(SqlConnection c, string name)',
      '    {',
      d('cs-sql-concat', 'SQL built by concatenation', '        return new SqlCommand("SELECT * FROM Users WHERE Name = \'" + name + "\'", c);'),
      '    }',
      '',
      '    public void Trust()',
      '    {',
      d('cs-cert-callback', 'certificate validation always returns true', '        ServicePointManager.ServerCertificateValidationCallback = (s, c, ch, e) => true;'),
      '    }',
      '}',
      '',
    ],
    'php/index.php': [
      '<?php',
      d('php-eval', 'eval of a query parameter', "eval($_GET['code']);"),
      d('php-sql-concat', 'SQL built from a query parameter', "$rows = mysqli_query($conn, \"SELECT * FROM posts WHERE id = \" . $_GET['id']);"),
      d('php-unserialize', 'unserialize on a cookie', "$prefs = unserialize($_COOKIE['prefs']);"),
      d('php-md5-password', 'password hashed with md5', "$hash = md5($_POST['password']);"),
      d('php-include-var', 'include of a request supplied file', "include $_GET['page'] . '.php';"),
      d('php-system', 'system() with request input', "system('convert ' . $_GET['file'] . ' out.png');"),
      '',
    ],
    'ruby/app.rb': [
      "require 'digest'",
      "require 'yaml'",
      '',
      'class ReportsController < ApplicationController',
      '  def run',
      d('rb-eval', 'eval of a request parameter', '    eval(params[:code])'),
      d('rb-system-interp', 'system with an interpolated parameter', '    system("ls #{params[:dir]}")'),
      '  end',
      '',
      '  def load',
      d('rb-marshal-load', 'Marshal.load on request data', '    Marshal.load(request.body.read)'),
      d('rb-yaml-load', 'YAML.load on request data', '    YAML.load(params[:doc])'),
      '  end',
      '',
      '  def digest(text)',
      d('rb-md5', 'MD5 digest', '    Digest::MD5.hexdigest(text)'),
      '  end',
      '',
      '  def show',
      d('rb-send-param', 'send with a request supplied method name', '    send(params[:action_name])'),
      '  end',
      'end',
      '',
    ],
  },
}

PROJECTS['infra-stack'] = {
  files: {
    ...tidy('infra-stack', '.terraform/\n*.tfstate\n.env\n'),
    Dockerfile: [
      d('docker-latest-tag', 'the base image is the moving latest tag', 'FROM node:latest'),
      'WORKDIR /app',
      d('docker-curl-pipe', 'an install script piped into a shell', 'RUN curl -sSL https://get.example.dev/install.sh | sh'),
      d('docker-env-secret', 'a secret baked into an ENV line', `ENV PAYMENT_API_KEY=${S.stripe}`),
      d('docker-add-http', 'ADD of a remote http URL', 'ADD http://downloads.example.com/tool.tar.gz /opt/'),
      d('docker-chmod-777', 'world writable application folder', 'RUN chmod -R 777 /app'),
      'COPY package.json .',
      'RUN npm ci --omit=dev',
      'COPY . .',
      'EXPOSE 3000',
      d('docker-user-root', 'the image ends running as root', 'USER root'),
      'CMD ["node", "server.js"]',
      '',
    ],
    'k8s/deployment.yaml': [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      'spec:',
      '  replicas: 2',
      '  selector:',
      '    matchLabels: { app: web }',
      '  template:',
      '    metadata:',
      '      labels: { app: web }',
      '    spec:',
      d('k8s-host-network', 'the pod shares the node network', '      hostNetwork: true'),
      d('k8s-host-pid', 'the pod shares the node process list', '      hostPID: true'),
      '      containers:',
      '        - name: web',
      d('k8s-latest-image', 'an image with the latest tag', '          image: registry.example.com/web:latest'),
      '          ports:',
      '            - containerPort: 3000',
      '          securityContext:',
      d('k8s-privileged', 'a privileged container', '            privileged: true'),
      d('k8s-priv-escalation', 'privilege escalation allowed', '            allowPrivilegeEscalation: true'),
      d('k8s-run-as-root', 'runs as user 0', '            runAsUser: 0'),
      '          volumeMounts:',
      '            - name: docker',
      '              mountPath: /var/run/docker.sock',
      '          env:',
      '            - name: DB_PASSWORD',
      d('k8s-inline-secret', 'a password written in the manifest', `              value: "${S.dbPass}"`),
      '      volumes:',
      '        - name: docker',
      '          hostPath:',
      d('k8s-docker-sock', 'the Docker socket mounted from the host', '            path: /var/run/docker.sock'),
      '',
    ],
    'terraform/main.tf': [
      'terraform {',
      '  required_version = ">= 1.6"',
      '}',
      '',
      'resource "aws_security_group" "web" {',
      '  name = "web"',
      '  ingress {',
      '    from_port   = 22',
      '    to_port     = 22',
      '    protocol    = "tcp"',
      d('tf-open-ssh', 'SSH open to the whole internet', '    cidr_blocks = ["0.0.0.0/0"]'),
      '  }',
      '}',
      '',
      'resource "aws_s3_bucket_acl" "assets" {',
      '  bucket = aws_s3_bucket.assets.id',
      d('tf-public-bucket', 'a public-read bucket', '  acl    = "public-read"'),
      '}',
      '',
      'resource "aws_db_instance" "main" {',
      '  engine              = "postgres"',
      '  instance_class      = "db.t3.micro"',
      d('tf-db-public', 'a publicly accessible database', '  publicly_accessible = true'),
      d('tf-db-unencrypted', 'storage not encrypted', '  storage_encrypted   = false'),
      `  username            = "admin"`,
      d('tf-hardcoded-password', 'a database password written in the file', `  password            = "${S.dbPass}"`),
      '}',
      '',
      'data "aws_iam_policy_document" "all" {',
      '  statement {',
      d('tf-iam-star', 'an IAM statement allowing every action', '    actions   = ["*"]'),
      '    resources = ["*"]',
      '  }',
      '}',
      '',
    ],
    'docker-compose.yml': [
      'services:',
      '  db:',
      d('compose-latest', 'database image with the latest tag', '    image: postgres:latest'),
      '    environment:',
      d('compose-password', 'database password in the compose file', `      POSTGRES_PASSWORD: ${S.dbPass}`),
      '    ports:',
      d('compose-db-port', 'database port published to every interface', '      - "5432:5432"'),
      '  agent:',
      '    image: example/agent:1.4.2',
      d('compose-privileged', 'a privileged service', '    privileged: true'),
      d('compose-host-network', 'host network mode', '    network_mode: host'),
      '    volumes:',
      d('compose-docker-sock', 'the Docker socket mounted into a service', '      - /var/run/docker.sock:/var/run/docker.sock'),
      '',
    ],
    '.github/workflows/pr.yml': [
      'name: pr-check',
      'on:',
      d('gha-pr-target', 'pull_request_target trigger on code from forks', '  pull_request_target:'),
      '    types: [opened, synchronize]',
      d('gha-write-all', 'the workflow token has write-all', 'permissions: write-all'),
      'jobs:',
      '  check:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      d('gha-checkout-pr-head', 'checks out the pull request head in a privileged workflow', '          ref: ${{ github.event.pull_request.head.sha }}'),
      d('gha-unpinned-action', 'a third party action pinned to a branch', '      - uses: some-org/deploy-action@main'),
      '      - name: Announce',
      d('gha-untrusted-input', 'untrusted pull request title expanded inside run:', '        run: echo "Checking ${{ github.event.pull_request.title }}"'),
      '      - name: Install tool',
      d('gha-curl-bash', 'a remote script piped into bash', '        run: curl -fsSL https://tools.example.com/install.sh | bash'),
      '',
    ],
    '.gitlab-ci.yml': [
      'stages: [build]',
      'build:',
      '  stage: build',
      d('gitlab-image-latest', 'a job image with the latest tag', '  image: docker:latest'),
      '  services:',
      '    - docker:dind',
      '  script:',
      '    - docker build -t app .',
      '',
    ],
    'helm/values.yaml': [
      'replicaCount: 2',
      'image:',
      '  repository: registry.example.com/web',
      '  tag: "1.4.2"',
      'database:',
      '  user: app',
      d('helm-password', 'a database password in the chart values', `  password: "${S.dbPass}"`),
      '',
    ],
  },
}

PROJECTS['electron-desktop'] = {
  files: {
    ...tidy('electron-desktop', 'node_modules\ndist\nout\n.env\n'),
    'package.json': pkg('electron-desktop', { main: 'main.js', scripts: { start: 'electron .' }, devDependencies: { electron: '31.2.0' } }),
    'main.js': [
      "'use strict'",
      "const { app, BrowserWindow, ipcMain, shell } = require('electron')",
      "const { autoUpdater } = require('electron-updater')",
      "const fs = require('fs')",
      "const path = require('path')",
      '',
      "ipcMain.handle('open-link', (event, url) => {",
      d('el-open-external-var', 'shell.openExternal with a value from the renderer', '  return shell.openExternal(url)'),
      '})',
      '',
      "ipcMain.handle('read-file', async (event, file) => {",
      d('el-ipc-no-sender', 'an IPC handler that reads any file and never checks the sender', "  return fs.promises.readFile(file, 'utf8')"),
      '})',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'function createWindow() {',
      '  const win = new BrowserWindow({',
      '    width: 1100,',
      '    height: 760,',
      '    webPreferences: {',
      "      preload: path.join(__dirname, 'preload.js'),",
      d('el-node-integration', 'nodeIntegration enabled in the renderer', '      nodeIntegration: true,'),
      d('el-context-isolation', 'contextIsolation disabled', '      contextIsolation: false,'),
      d('el-web-security', 'webSecurity disabled', '      webSecurity: false,'),
      d('el-insecure-content', 'insecure content allowed', '      allowRunningInsecureContent: true,'),
      d('el-sandbox-off', 'renderer sandbox disabled', '      sandbox: false,'),
      d('el-remote-module', 'the remote module enabled', '      enableRemoteModule: true,'),
      '    },',
      '  })',
      d('el-remote-url', 'the window loads a remote page over plain http', "  win.loadURL('http://app.example.com/start')"),
      d('el-devtools-open', 'DevTools opened unconditionally', '  win.webContents.openDevTools()'),
      '}',
      '',
      'app.whenReady().then(() => {',
      d('el-updater-http', 'auto update feed over plain http', "  autoUpdater.setFeedURL({ provider: 'generic', url: 'http://updates.example.com/stable' })"),
      '  createWindow()',
      '})',
      '',
    ],
    'preload.js': [
      "'use strict'",
      "const { contextBridge, ipcRenderer } = require('electron')",
      d('el-expose-ipcrenderer', 'the whole ipcRenderer exposed to the page', "contextBridge.exposeInMainWorld('bridge', { ipcRenderer })"),
      '',
    ],
    'index.html': ['<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8"><title>Desktop</title></head>', '<body><main><h1>Desktop</h1></main><script src="renderer.js"></script></body>', '</html>', ''],
    'renderer.js': ["'use strict'", "document.title = 'Desktop'", ''],
  },
}

PROJECTS['web-frontend'] = {
  files: {
    ...tidy('web-frontend', 'node_modules\n.env\n'),
    'public/index.html': [
      '<!doctype html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <title>Plant shop</title>',
      d('html-http-css', 'a stylesheet loaded over plain http', '  <link rel="stylesheet" href="http://static.example.com/theme.css">'),
      '  <link rel="stylesheet" href="style.css">',
      d('html-sri-missing', 'a CDN script with no integrity attribute', '  <script src="https://cdn.example.net/lib/chart.min.js"></script>'),
      '</head>',
      '<body>',
      '  <main>',
      '    <h1>Plant shop</h1>',
      d('html-img-no-alt', 'an image with no alt text', '    <img src="monstera.jpg" width="320" height="240">'),
      d('html-inline-handler', 'an inline onclick handler', '    <button id="buy" onclick="buy()">Buy</button>'),
      d('html-blank-no-rel', 'target _blank without rel noopener', '    <a href="https://partner.example.org/" target="_blank">Our partner</a>'),
      d('html-link-text', 'link text that says nothing', '    <a href="/guide.html">click here</a>'),
      d('html-iframe-no-title', 'an iframe with no title', '    <iframe src="https://maps.example.org/embed"></iframe>'),
      d('html-input-no-label', 'a form field with no label', '    <input type="text" name="q">'),
      d('html-duplicate-id', 'the same id used twice', '    <p id="note">First</p>\n    <p id="note">Second</p>'),
      d('html-table-no-th', 'a data table with no header cells', '    <table><tr><td>Fern</td><td>12</td></tr></table>'),
      d('html-video-no-captions', 'a video with no captions track', '    <video src="tour.mp4" controls></video>'),
      d('html-tabindex-positive', 'a positive tabindex', '    <div tabindex="3">Skip me</div>'),
      d('html-http-link-mixed', 'an http image on an https page', '    <img src="http://img.example.com/banner.png" alt="Banner" width="600" height="200">'),
      '  </main>',
      '</body>',
      '</html>',
      '',
    ],
    'public/style.css': [
      'body { font-family: system-ui, sans-serif; margin: 0; }',
      d('css-outline-none', 'focus outline removed with no replacement', 'a:focus, button:focus { outline: none; }'),
      d('css-low-contrast', 'pale grey text on white', '.muted { color: #cccccc; background: #ffffff; }'),
      '',
    ],
    'deploy/nginx.conf': [
      'server {',
      '  listen 443 ssl;',
      '  server_name shop.example.com;',
      d('nginx-old-tls', 'TLS 1.0 and 1.1 still enabled', '  ssl_protocols TLSv1 TLSv1.1 TLSv1.2;'),
      d('nginx-csp-unsafe-inline', 'a CSP that allows unsafe-inline scripts', `  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'";`),
      d('nginx-cors-star', 'every origin allowed', '  add_header Access-Control-Allow-Origin "*";'),
      '  location / {',
      '    root /var/www/shop;',
      '  }',
      '}',
      '',
    ],
    'public/.env': [d('publish-env', 'an .env file inside the published folder', `API_TOKEN=${S.ghPat}`), ''],
    'public/.git/config': [d('publish-git', 'a .git folder inside the published folder', '[core]\n\trepositoryformatversion = 0'), ''],
    'public/backup.sql': [d('publish-sql', 'a database dump inside the published folder', "INSERT INTO users VALUES (1, 'dana@example.com', 'x');"), ''],
  },
  absent: [
    a('html-no-lang', 'the html element has no lang attribute', 'public/index.html'),
    a('html-no-viewport', 'no viewport meta tag, so mobile scaling breaks', 'public/index.html'),
    a('headers-hsts', 'the server config sets no Strict-Transport-Security header', 'deploy/nginx.conf'),
    a('headers-xfo', 'the server config sets no X-Frame-Options or frame-ancestors', 'deploy/nginx.conf'),
    a('headers-nosniff', 'the server config sets no X-Content-Type-Options', 'deploy/nginx.conf'),
    a('headers-referrer', 'the server config sets no Referrer-Policy', 'deploy/nginx.conf'),
  ],
}

PROJECTS['package-hygiene'] = {
  files: {
    // No LICENSE, no SECURITY.md, no .gitignore, a README with no install or usage: planted on purpose.
    'README.md': ['# package-hygiene\n\nA tool.\n'],
    'package.json': [
      '{',
      '  "name": "package-hygiene",',
      '  "version": "0.4.1",',
      '  "private": true,',
      '  "main": "index.js",',
      '  "scripts": {',
      d('pkg-postinstall-curl', 'an install script that downloads and runs code', '    "postinstall": "curl -s https://setup.example.dev/run.sh | sh",'),
      '    "start": "node index.js"',
      '  },',
      '  "dependencies": {',
      d('pkg-wildcard', 'a dependency pinned to *', '    "left-pad": "*",'),
      d('pkg-latest', 'a dependency pinned to latest', '    "lodash": "latest",'),
      d('pkg-http-tarball', 'a dependency fetched over plain http', '    "legacy-widget": "http://files.example.com/widget-1.0.0.tgz",'),
      d('pkg-git-http', 'a dependency from an unauthenticated git URL', '    "shared-ui": "git+http://git.example.com/ui.git",'),
      d('pkg-dev-in-prod', 'a test framework listed as a runtime dependency', '    "jest": "^29.7.0",'),
      '    "express": "^4.19.2"',
      '  }',
      '}',
      '',
    ],
    'package-lock.json': [
      '{',
      '  "name": "package-hygiene",',
      '  "version": "0.4.1",',
      '  "lockfileVersion": 3,',
      '  "requires": true,',
      '  "packages": {',
      '    "": { "name": "package-hygiene", "version": "0.4.1", "dependencies": { "express": "^4.19.2" } },',
      '    "node_modules/express": {',
      '      "version": "4.19.2",',
      d('lock-http-resolved', 'a lockfile entry fetched over plain http', '      "resolved": "http://registry.npmjs.org/express/-/express-4.19.2.tgz",'),
      '      "license": "MIT"',
      '    }',
      '  }',
      '}',
      '',
    ],
    '.npmrc': [d('npmrc-token', 'an npm auth token written in .npmrc', `//registry.npmjs.org/:_authToken=${S.npm}`), d('npmrc-strict-ssl', 'TLS checking disabled for the registry', 'strict-ssl=false'), ''],
    'requirements.txt': [d('req-unpinned', 'an unpinned Python dependency', 'requests'), 'flask==3.0.3', ''],
    'index.js': ["'use strict'", "console.log('hello')", ''],
    'src/a.js': ["'use strict'", 'module.exports = (n) => n + 1', ''],
    'src/b.js': ["'use strict'", 'module.exports = (n) => n * 2', ''],
    'src/c.js': ["'use strict'", 'module.exports = (n) => n - 1', ''],
    '.DS_Store': ['x'],
  },
  absent: [
    a('repo-no-license', 'the repository has no licence file'),
    a('repo-no-security-policy', 'the repository has no security policy'),
    a('repo-no-gitignore', 'the repository has no .gitignore with the usual entries'),
    a('repo-readme-thin', 'the README has no install or usage section'),
    a('repo-no-ci', 'the repository has no continuous integration config'),
  ],
}

PROJECTS['data-docs'] = {
  files: {
    ...tidy('data-docs', '.env\n__pycache__/\n'),
    'notebooks/analysis.ipynb': [
      JSON.stringify(
        {
          cells: [
            { cell_type: 'code', execution_count: 3, metadata: {}, source: ['!pip install pandas\n', `API_KEY = "${S.google}"\n`, 'df = load("/Users/dana/Desktop/data.csv")'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['rows: 20481\n'] }] },
          ],
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5,
        },
        null,
        1,
      ),
    ],
    'data/export.csv': ['id,name,score', '1,alpha,0.4', '2,beta', d('csv-ragged', 'a row with a different number of columns than the header', '3,gamma,0.9,extra'), ''],
    'docs/guide.md': [
      '# Guide',
      '',
      d('md-heading-skip', 'a heading level that jumps from 1 to 3', '### Details'),
      '',
      d('md-broken-anchor', 'a link to a heading that does not exist', 'See [setup](#no-such-heading) for the steps.'),
      d('md-typo', 'common misspellings', 'We recieve the data and seperate it into parts.'),
      d('md-unclosed-fence', 'a code fence that is never closed', '```bash\nnpm install'),
      '',
    ],
    'CHANGELOG.md': ['# Changelog', '', d('changelog-format', 'a changelog entry with no version heading or date', 'fixed some things'), ''],
    'config/app.json': ['{', '  "name": "data-docs",', d('json-dup-key', 'the same key twice in a JSON object', '  "name": "data-docs-copy",'), '  "port": 8080', '}', ''],
    'config/broken.json': [d('json-invalid', 'a JSON file that does not parse', '{ "a": 1, }'), ''],
    'config/settings.toml': ['[server]', d('toml-invalid', 'a TOML file that does not parse', 'port = = 80'), ''],
    'config/ci.yaml': ['jobs:', d('yaml-invalid', 'a YAML file that does not parse', '  build: [unclosed'), ''],
    'src/merge.js': ['<<<<<<< HEAD', d('conflict-marker', 'an unresolved merge conflict marker', 'const mode = "a"'), '=======', 'const mode = "b"', '>>>>>>> feature', ''],
    'src/spacing.js': [d('trailing-ws', 'trailing whitespace', 'const answer = 42;   '), ''],
    'src/bidi.js': [d('unicode-control', 'a hidden bidirectional control character in source', "const access = 'user\u202E'"), ''],
    Makefile: ['build:', d('makefile-spaces', 'a Makefile recipe indented with spaces', '    echo building'), ''],
    'train.py': [
      'import numpy as np',
      'from sklearn.ensemble import RandomForestClassifier',
      '',
      d('ml-no-seed', 'a random split and model with no seed set', 'idx = np.random.permutation(1000)'),
      'model = RandomForestClassifier(n_estimators=50)',
      'model.fit(idx.reshape(-1, 1), idx % 2)',
      '',
    ],
    'model.pkl': ['not really a model but tracked like one'],
    '.env.production': [d('env-tracked', 'a production .env file committed to git', `DATABASE_URL=postgres://app:${S.dbPass}@db.internal:5432/app`), `STRIPE_KEY=${S.stripe}`, ''],
  },
}

PROJECTS['secrets-history'] = {
  files: {
    ...tidy('secrets-history', 'node_modules\n'),
    'src/config.js': [
      "'use strict'",
      d('sec-aws-id', 'an AWS access key id in source', `const AWS_ACCESS_KEY_ID = '${S.awsId}'`),
      d('sec-aws-secret', 'an AWS secret access key in source', `const AWS_SECRET_ACCESS_KEY = '${S.awsSecret}'`),
      d('sec-github-pat', 'a GitHub personal access token', `const GITHUB_TOKEN = '${S.ghPat}'`),
      d('sec-stripe', 'a live Stripe secret key', `const STRIPE_SECRET = '${S.stripe}'`),
      d('sec-slack', 'a Slack bot token', `const SLACK_BOT = '${S.slack}'`),
      d('sec-google', 'a Google API key', `const MAPS_KEY = '${S.google}'`),
      d('sec-sendgrid', 'a SendGrid API key', `const MAIL_KEY = '${S.sendgrid}'`),
      d('sec-npm', 'an npm access token', `const NPM_TOKEN = '${S.npm}'`),
      d('sec-shopify', 'a Shopify admin API token', `const SHOP_TOKEN = '${S.shopify}'`),
      d('sec-twilio', 'a Twilio API key', `const TWILIO_KEY = '${S.twilio}'`),
      d('sec-telegram', 'a Telegram bot token', `const BOT_TOKEN = '${S.telegram}'`),
      d('sec-discord', 'a Discord webhook URL', `const HOOK = '${S.discord}'`),
      d('sec-jwt', 'a signed JWT written into the source', `const SERVICE_JWT = '${S.jwt}'`),
      d('sec-db-url', 'a database URL with a password', `const DB_URL = 'postgres://admin:${S.dbPass}@db.internal.example.com:5432/app'`),
      d('sec-password-literal', 'a password assigned to a variable', `const ADMIN_PASSWORD = '${tok(14)}!9'`),
      'module.exports = { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN, STRIPE_SECRET, SLACK_BOT, MAPS_KEY, MAIL_KEY, NPM_TOKEN, SHOP_TOKEN, TWILIO_KEY, BOT_TOKEN, HOOK, SERVICE_JWT, DB_URL, ADMIN_PASSWORD }',
      '',
    ],
    'certs/server.key': [d('sec-private-key', 'a private key file committed to the repository', pem()), ''],
    'scripts/deploy.sh': ['#!/bin/sh', 'set -eu', d('sec-script-token', 'a token passed on a command line in a script', `curl -H "Authorization: Bearer ${S.ghPat.replace('ghp_', 'ghs_')}" https://api.example.com/deploy`), ''],
    'src/app.py': ['import boto3', '', d('sec-py-secret', 'a cloud secret in Python source', `client = boto3.client("s3", aws_access_key_id="${S.awsId.replace('AKIA', 'ASIA')}", aws_secret_access_key="${tok(40)}")`), ''],
  },
  history: [
    { msg: 'Add the deploy environment file for the staging cluster so the release pipeline can read the database settings from one place', files: { 'deploy.env': `DB_PASSWORD=${tok(18)}\nSTRIPE_KEY=${['sk', '_live_', tok(24)].join('')}\n` }, planted: [{ key: 'hist-secret-committed', desc: 'a live key committed to history', file: '' }] },
    { msg: 'remove the env file again', remove: ['deploy.env'] },
    { msg: 'wip', files: { 'notes.txt': 'scratch\n' } },
    { msg: 'Fix a bug', files: { 'notes.txt': 'scratch two\n' } },
  ],
  absent: [a('hist-long-subject', 'a commit subject longer than 72 characters'), a('hist-vague-subject', 'commit messages such as wip with no meaning')],
}

// ---------- extra planted-defect modules ----------
// Every tools/accuracy-extra-*.mjs is loaded and may add projects. It exports `projects(ctx)` (sync or async) returning
//   { projects: { '<name>': { files, absent?, history? } }, expect: { '<defect key>': 'check/rule|alt-check' } }
// (a bare { '<name>': def } map is accepted too, then with no expect). The project shape is the one PROJECTS uses above.
// ctx = { d, a, tok, S, pem, tidy, pkg, readme, MIT, SECURITY, EXPECT, PROJECTS }. Defect keys must be unique across the whole corpus.
// Project names must not collide with built-in ones. With no such file the corpus is exactly the built-in one.
const EXTRA_CTX = { d, a, tok, S, pem, tidy, pkg, readme, MIT, SECURITY, EXPECT, PROJECTS }
for (const f of readdirSync(join(ROOT, 'tools')).filter((n) => /^accuracy-extra-.+\.mjs$/.test(n)).sort()) {
  const mod = await import(pathToFileURL(join(ROOT, 'tools', f)).href)
  if (typeof mod.projects !== 'function') throw new Error(`tools/${f} must export projects(ctx)`)
  const got = (await mod.projects(EXTRA_CTX)) ?? {}
  const defs = got.projects ?? got
  for (const [name, def] of Object.entries(defs)) {
    if (name === 'expect' && got.projects === undefined) continue
    if (PROJECTS[name]) throw new Error(`tools/${f}: project name ${name} already exists`)
    PROJECTS[name] = def
  }
  Object.assign(EXPECT, got.expect ?? {})
}

// ---------- writing the projects ----------
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=corpus@example.com', '-c', 'user.name=Corpus', '-c', 'core.autocrlf=false', '-c', 'core.excludesFile=', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe', windowsHide: true })

function lineCount(text) {
  return text.split('\n').length
}

// Writes one project and returns its planted defects. The line of a defect is where its text starts in the file.
function writeProject(root, name, def) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const planted = []
  const add = (key, desc, file, line) => {
    const exp = EXPECT[key] ?? ''
    const [first, ...alt] = exp.split('|')
    const [check = '', rule = ''] = first.split('/')
    planted.push({ id: `${name}:${key}`, key, project: name, suite: '', check, alt, rule, file, line, description: desc })
  }
  for (const [path, items] of Object.entries(def.files)) {
    const out = []
    let line = 1
    for (const it of items) {
      if (typeof it === 'string') {
        out.push(it)
        line += lineCount(it)
      } else {
        add(it.key, it.desc, path, line)
        out.push(it.text)
        line += lineCount(it.text)
      }
    }
    const abs = join(dir, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, out.join('\n'))
  }
  for (const x of def.absent ?? []) add(x.key, x.desc, x.file, 0)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Initial import')
  for (const h of def.history ?? []) {
    for (const [p, text] of Object.entries(h.files ?? {})) writeFileSync(join(dir, p), text)
    for (const p of h.remove ?? []) rmSync(join(dir, p), { force: true })
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', h.msg)
    for (const x of h.planted ?? []) add(x.key, x.desc, x.file, 0)
  }
  return { dir, planted }
}

export function generateCorpus(out) {
  mkdirSync(out, { recursive: true })
  const projects = {}
  const planted = []
  for (const [name, def] of Object.entries(PROJECTS)) {
    const r = writeProject(out, name, def)
    projects[name] = r.dir
    planted.push(...r.planted)
  }
  return { projects, planted, out }
}

// The suite of a check, filled from the registry so the manifest agrees with the runner.
export async function withSuites(planted) {
  const { suiteIdOf } = await import(pathToFileURL(join(ROOT, 'lib', 'suites.mjs')).href)
  const { allCheckIds } = await import(pathToFileURL(join(ROOT, 'tools', 'compat-matrix.mjs')).href)
  const packOf = new Map((await allCheckIds()).map((c) => [c.id, c.pack]))
  return planted.map((p) => {
    let suite = 'other'
    try {
      suite = p.check ? suiteIdOf({ id: p.check, pack: packOf.get(p.check) }) : 'other'
    } catch {
      /* keep other */
    }
    return { ...p, suite }
  })
}

// ---------- running every pack on a project ----------
async function allPacks() {
  return readdirSync(join(ROOT, 'packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

export function runProject({ name, dir, work, timeoutSeconds = 60, overallSeconds = 100, packs }) {
  return new Promise((done) => {
    const cfg = join(work, `${name}.config.json`)
    writeFileSync(cfg, JSON.stringify({ packs, override: {} }, null, 2))
    const json = join(work, `${name}.result.json`)
    const logs = join(work, 'logs', name)
    mkdirSync(logs, { recursive: true })
    const env = { ...process.env, MEERKAT_PLAIN: '1', MEERKAT_LOG_DIR: logs, MEERKAT_TIMINGS: join(work, 'timings.json'), MEERKAT_STATUS: join(work, `${name}.status.json`), MEERKAT_HISTORY: join(work, 'history.json'), MEERKAT_USER_CONFIG: join(work, 'no-user-config.json'), MEERKAT_CHECK_TIMEOUT: String(timeoutSeconds) }
    const child = spawn(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--config', cfg, '--preset', 'full', '--plain', '--json', json], { cwd: ROOT, env, windowsHide: true })
    let outText = ''
    child.stdout.on('data', (b) => (outText += b))
    child.stderr.on('data', (b) => (outText += b))
    const killer = setTimeout(() => {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      } catch {
        /* ignore */
      }
      child.kill()
    }, overallSeconds * 1000)
    child.on('close', () => {
      clearTimeout(killer)
      let findings = null
      let summary = null
      let runDir = null
      try {
        const runs = join(logs, 'runs')
        const latest = readdirSync(runs).sort().pop()
        runDir = join(runs, latest)
        findings = JSON.parse(readFileSync(join(runDir, 'findings.json'), 'utf8'))
        summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
      } catch {
        /* no result */
      }
      done({ name, findings, summary, runDir, out: outText })
    })
  })
}

export async function runCorpus({ projects, work, concurrency = 4, overallSeconds, say = () => {} }) {
  mkdirSync(work, { recursive: true })
  const packs = await allPacks()
  const names = Object.keys(projects)
  const results = {}
  let next = 0
  async function worker() {
    while (next < names.length) {
      const name = names[next++]
      say(`running ${name}`)
      results[name] = await runProject({ name, dir: projects[name], work, packs, ...(overallSeconds ? { overallSeconds } : {}) })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker))
  return results
}

// ---------- judging ----------
const norm = (p) => String(p ?? '').split('\\').join('/')

// Where a finding says it is: the structured file and line, else the "path line N" / "path:N" the message carries (several checks only
// put the place in their text). Returns { files: [path], lines: [n] }.
export function placeOf(f) {
  const msg = String(f.message ?? '')
  const lines = f.line > 0 ? [f.line, ...(Array.isArray(f.lines) ? f.lines : [])] : [...msg.matchAll(/\bline (\d+)\b/gi)].map((m) => Number(m[1]))
  for (const m of msg.matchAll(/(?:^|[\s(])([\w.@/-]+\.[A-Za-z0-9]{1,6}):(\d+)\b/g)) lines.push(Number(m[2]))
  const files = f.file ? [norm(f.file)] : [...msg.matchAll(/(?:^|[\s(])([\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]{1,6})\b/g)].map((m) => m[1])
  return { files, lines }
}

// A defect is detected when a finding of the expected check (or an alternative) sits in the same file, its rule is the expected one or
// carries no rule id, and, for a defect on a line, it points at that line (one line of slack) or at no line at all (a file-level finding of
// the right check in the right file). A finding that names no file counts only when its rule is the expected rule.
export function isDetected(p, findings) {
  const checks = new Set([p.check, ...p.alt].filter(Boolean))
  return findings.some((f) => {
    if (!checks.has(f.check)) return false
    if (p.rule && f.rule && f.rule !== p.rule) return false
    const { files, lines } = placeOf(f)
    if (p.file) {
      if (files.length) {
        if (!files.some((x) => x === p.file || p.file.endsWith('/' + x) || x.endsWith('/' + p.file))) return false
      } else if (!(p.rule && f.rule === p.rule)) return false
    }
    if (p.line > 0 && lines.length) return lines.some((n) => Math.abs(n - p.line) <= 3)
    return true
  })
}

// The second channel: the check itself failed and its own output names the file (and the line, when it gives one). Some checks print
// several problems but only one reaches findings.json, so this says whether the CHECK saw the defect.
export function seenInCheckOutput(p, runDir) {
  if (!runDir || !p.check) return false
  for (const id of [p.check, ...p.alt].filter(Boolean)) {
    let text = ''
    try {
      text = readFileSync(join(runDir, id + '.log'), 'utf8')
    } catch {
      continue
    }
    if (!/^result:\s+FAIL/m.test(text)) continue
    if (!p.file) return true
    const out = text.slice(Math.max(0, text.indexOf('--- output ---')))
    for (const line of out.split('\n')) {
      if (!line.includes(p.file)) continue
      const nums = [...line.matchAll(/(?:\bline |:)(\d+)\b/g)].map((m) => Number(m[1]))
      if (p.line > 0 && nums.length) {
        if (nums.some((n) => Math.abs(n - p.line) <= 3)) return true
      } else return true
    }
  }
  return false
}

export function evaluate(planted, results) {
  const rows = planted.map((p) => {
    const r = results[p.project]
    const findings = r?.findings?.findings ?? []
    const inFindings = p.check ? isDetected(p, findings) : false
    const inOutput = inFindings || seenInCheckOutput(p, r?.runDir)
    return { ...p, ran: Boolean(r?.findings), inFindings, detected: inOutput }
  })
  const bySuite = {}
  for (const r of rows) {
    const s = (bySuite[r.suite] ??= { planted: 0, detected: 0, inFindings: 0 })
    s.planted++
    if (r.detected) s.detected++
    if (r.inFindings) s.inFindings++
  }
  for (const s of Object.values(bySuite)) {
    s.recall = s.planted ? s.detected / s.planted : 1
    s.findingsRecall = s.planted ? s.inFindings / s.planted : 1
  }
  const total = rows.length
  const hit = rows.filter((r) => r.detected).length
  const inF = rows.filter((r) => r.inFindings).length
  return { rows, bySuite, total, detected: hit, recall: total ? hit / total : 1, inFindings: inF, findingsRecall: total ? inF / total : 1, gaps: rows.filter((r) => !r.detected), lostFromFindings: rows.filter((r) => r.detected && !r.inFindings) }
}

export const percent = (x) => `${(x * 100).toFixed(1)}%`

export function recallTable(ev) {
  const lines = ['| Suite | Planted | Detected by a check | Recall | In findings.json | Findings recall |', '| --- | ---: | ---: | ---: | ---: | ---: |']
  for (const [suite, s] of Object.entries(ev.bySuite).sort((x, y) => x[0].localeCompare(y[0]))) lines.push(`| ${suite} | ${s.planted} | ${s.detected} | ${percent(s.recall)} | ${s.inFindings} | ${percent(s.findingsRecall)} |`)
  lines.push(`| **all** | ${ev.total} | ${ev.detected} | ${percent(ev.recall)} | ${ev.inFindings} | ${percent(ev.findingsRecall)} |`)
  return lines.join('\n')
}

export function gapList(ev) {
  if (!ev.gaps.length) return '_No gaps: every planted defect is detected._'
  return ev.gaps.map((g) => `- \`${g.project}\` ${g.file ? `\`${g.file}${g.line ? `:${g.line}` : ''}\`` : '(whole repository)'}: ${g.description} (expected \`${g.check || 'unassigned'}${g.rule ? `/${g.rule}` : ''}\`)`).join('\n')
}

// The recall floors a run must not fall under: each measured value rounded down to two decimals, never below 0.6.
export const THRESHOLDS_FILE = join(ROOT, 'docs', 'accuracy-thresholds.json')
const floor2 = (x) => Math.max(0.6, Math.floor(x * 100 + 1e-9) / 100)
export function thresholdsFrom(ev) {
  return {
    note: 'Minimum recall (planted defects detected by a check) a run of the accuracy corpus must reach. Rewrite with: node tools/accuracy-corpus.mjs --run --write-thresholds. Never below 0.6.',
    overall: floor2(ev.recall),
    findingsOverall: floor2(ev.findingsRecall),
    suites: Object.fromEntries(Object.entries(ev.bySuite).sort((x, y) => x[0].localeCompare(y[0])).map(([k, s]) => [k, floor2(s.recall)])),
  }
}

export const BEGIN = '<!-- accuracy:begin -->'
export const END = '<!-- accuracy:end -->'

export function updateDocs(ev, file = join(ROOT, 'docs', 'accuracy.md')) {
  if (!existsSync(file)) return false
  const text = readFileSync(file, 'utf8')
  const i = text.indexOf(BEGIN)
  const j = text.indexOf(END)
  if (i < 0 || j < i) return false
  const block = `${BEGIN}\n\nGenerated by \`node tools/accuracy-corpus.mjs --run\` on ${new Date().toISOString().slice(0, 10)}: ${ev.total} planted defects in ${new Set(ev.rows.map((r) => r.project)).size} projects, ${ev.detected} detected (${percent(ev.recall)}).\n\n${recallTable(ev)}\n\n### Known gaps\n\n${gapList(ev)}\n\n${END}`
  writeFileSync(file, text.slice(0, i) + block + text.slice(j + END.length))
  return true
}

// ---------- command line ----------
async function main() {
  const argv = process.argv.slice(2)
  const opt = (n) => {
    const i = argv.indexOf(n)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const out = resolve(opt('--out') ?? mkdtempSync(join(tmpdir(), 'meerkat-accuracy-')))
  const corpus = generateCorpus(out)
  corpus.planted = await withSuites(corpus.planted)
  writeFileSync(join(out, 'planted.json'), JSON.stringify(corpus.planted, null, 2))
  console.log(`wrote ${Object.keys(corpus.projects).length} projects and ${corpus.planted.length} planted defects to ${out}`)
  if (!argv.includes('--run')) return
  const results = await runCorpus({ projects: corpus.projects, work: join(out, '.work'), say: (m) => console.log(m) })
  const ev = evaluate(corpus.planted, results)
  console.log(`\n${recallTable(ev)}\n\nGaps:\n${gapList(ev)}`)
  if (argv.includes('--discover')) {
    for (const p of ev.rows) {
      const fs = (results[p.project]?.findings?.findings ?? []).filter((f) => (p.file ? norm(f.file) === p.file : true) && (p.line > 0 ? Math.abs(f.line - p.line) <= 1 : true))
      console.log(`${p.detected ? 'OK  ' : 'MISS'} ${p.project}:${p.key} [${p.check}${p.rule ? '/' + p.rule : ''}] ${p.file}:${p.line} => ${[...new Set(fs.map((f) => `${f.check}/${f.rule || '-'}`))].join(' ')}`)
    }
  }
  if (argv.includes('--write-thresholds')) {
    writeFileSync(THRESHOLDS_FILE, JSON.stringify(thresholdsFrom(ev), null, 2) + '\n')
    console.log('wrote docs/accuracy-thresholds.json')
  }
  if (!argv.includes('--no-docs')) console.log(updateDocs(ev) ? 'updated docs/accuracy.md' : 'docs/accuracy.md has no generated block')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
