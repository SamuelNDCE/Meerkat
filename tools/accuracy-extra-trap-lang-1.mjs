// False-alarm TRAPS, part 1: Python and JavaScript/TypeScript. Clean projects (names end in -clean) whose code LOOKS like a bug to a naive rule but
// is safe. No defect is planted, so the manifest has nothing to detect: a trap passes when its named check raises no bug-severity finding on
// that file. Each trap names the check id it is aimed at. The module also exports TRAPS (project, file, check, name) for tools that run each
// check on each trap project (docs/accuracy.md, "False-alarm traps"). Project names start with `trap-lang-`.
// Source text is written with § for a backtick and @{ for ${ so it can sit in a template literal.

const fix = (s) => s.replaceAll('§', '`').replaceAll('@{', '${')
export const TRAPS = []
const FILES = {}
const raw = String.raw

// add(project, check, name, file, text): one trap in its own file of the project.
const add = (project, check, name, file, text) => {
  FILES[project] ??= {}
  if (FILES[project][file]) throw new Error(`trap-lang: ${project}/${file} written twice`)
  FILES[project][file] = [fix(text).replace(/^\n/, '')]
  TRAPS.push({ project: `trap-lang-${project}-clean`, file, check, name })
}

// ------------------------------------------------------------------------------------------------------------------- Python
const P = 'python'
add(P, 'cp-python', 'popen-constant-command', 'app/gitinfo.py', raw`
import os


def head():
    return os.popen("git rev-parse --short HEAD").read().strip()
`)
add(P, 'cp-python', 'subprocess-constant-list', 'app/vcs.py', raw`
import subprocess


def status():
    return subprocess.run(["git", "status", "--short"], check=True, capture_output=True, text=True).stdout
`)
add(P, 'cp-python', 'marshal-shipped-constant', 'app/precompiled.py', raw`
import marshal

from ._blob import PRECOMPILED  # constant bytes written by our own build step


def load():
    return marshal.loads(PRECOMPILED)
`)
add(P, 'cp-python', 'shelve-own-cache', 'app/cache.py', raw`
import os
import shelve

CACHE_DIR = os.path.join(os.path.dirname(__file__), "_cache")


def open_cache():
    return shelve.open(os.path.join(CACHE_DIR, "own.db"))
`)
add(P, 'cp-python', 'shell-true-constant', 'app/clear.py', raw`
import subprocess


def clear_screen():
    subprocess.run("clear", shell=True, check=False)
`)
add(P, 'cp-python', 'os-system-constant-alias', 'app/term.py', raw`
from os import system


def bell():
    system("tput bel")
`)
add(P, 'cp-python', 'exec-constant-source', 'app/boot.py', raw`
NAMESPACE = {}


def boot():
    exec("import sys", NAMESPACE)
    return NAMESPACE
`)
add(P, 'cp-python', 'compile-constant-exec', 'app/tpl.py', raw`
CODE = compile("value = 1 + 1", "<constant>", "exec")
`)
add(P, 'cp-python', 'password-word-in-names-only', 'app/labels.py', raw`
password_label = "Password"
PASSWORD_MIN_LENGTH = 12
secret_question_text = "Name of your first pet"


def hint(password_hint=None):
    return password_hint
`)
add(P, 'cp-python', 'default-password-none', 'app/signin.py', raw`
import os


def login(user, password=None):
    password = password or os.environ["APP_PASSWORD"]
    return user, password
`)
add(P, 'cp-python', 'requests-timeout-next-line', 'app/client.py', raw`
import requests


def fetch(url):
    return requests.get(
        url,
        timeout=5,
    )
`)
add(P, 'cp-python', 'requests-timeout-via-kwargs', 'app/client2.py', raw`
import requests

OPTS = {"timeout": 5}


def fetch(url):
    return requests.get(url, **OPTS)
`)
add(P, 'cp-python', 'ssl-default-context', 'app/tls.py', raw`
import ssl

ctx = ssl.create_default_context()
ctx.minimum_version = ssl.TLSVersion.TLSv1_2
`)
add(P, 'cp-python', 'ssl-tls-client-protocol', 'app/tls2.py', raw`
import ssl

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.check_hostname = True
`)
add(P, 'cp-python', 'ftp-tls', 'app/ftp.py', raw`
import ftplib


def connect(host):
    return ftplib.FTP_TLS(host)
`)
add(P, 'cp-python', 'http-loopback-health', 'app/health.py', raw`
import requests


def alive():
    return requests.get("http://127.0.0.1:8080/health", timeout=2).ok
`)
add(P, 'cp-python', 'minidom-constant-document', 'app/dom.py', raw`
from xml.dom import minidom

EMPTY = minidom.parseString("<root/>")
`)
add(P, 'cp-python', 'tar-members-checked', 'app/untar.py', raw`
import os
import tarfile


def safe_members(tar, dest):
    root = os.path.realpath(dest)
    for m in tar.getmembers():
        if os.path.realpath(os.path.join(root, m.name)).startswith(root + os.sep):
            yield m


def unpack(path, dest):
    with tarfile.open(path) as tar:
        tar.extractall(dest, members=safe_members(tar, dest), filter="data")
`)
add(P, 'cp-python', 'torch-load-weights-only-multiline', 'app/model.py', raw`
import torch


def load(path):
    return torch.load(
        path,
        map_location="cpu",
        weights_only=True,
    )
`)
add(P, 'cp-python', 'trust-remote-code-false', 'app/hf.py', raw`
from transformers import AutoModel


def get(name):
    return AutoModel.from_pretrained(name, trust_remote_code=False)
`)
add(P, 'cp-python', 'paramiko-reject-policy', 'app/ssh.py', raw`
import paramiko


def client():
    c = paramiko.SSHClient()
    c.load_system_host_keys()
    c.set_missing_host_key_policy(paramiko.RejectPolicy())
    return c
`)
add(P, 'cp-python', 'snmp-community-from-env', 'app/snmp.py', raw`
import os

from pysnmp.hlapi import CommunityData

COMMUNITY = CommunityData(os.environ["SNMP_COMMUNITY"])
`)
add(P, 'cp-python', 'bind-loopback-and-doc-mention', 'app/serve.py', raw`
"""Dev server. It must never listen on 0.0.0.0, so the host below is loopback only."""
from flask import Flask

app = Flask(__name__)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)
`)
add(P, 'cp-python', 'jinja-select-autoescape', 'app/render.py', raw`
from jinja2 import Environment, select_autoescape

env = Environment(autoescape=select_autoescape(["html", "xml"]))
`)
add(P, 'cp-python', 'mark-safe-constant-markup', 'app/safe.py', raw`
from django.utils.safestring import mark_safe

LINE_BREAK = mark_safe("<br>")
`)
add(P, 'cp-python', 'allowed-hosts-named', 'app/settings.py', raw`
ALLOWED_HOSTS = ["example.com", "www.example.com", ".internal.example.com"]
DEBUG = False
`)
add(P, 'cp-python', 'csrf-exempt-signed-webhook', 'app/hooks.py', raw`
import hashlib
import hmac

from django.http import HttpResponse, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt

SECRET = b"loaded-at-startup-from-settings"


@csrf_exempt
def webhook(request):
    sent = request.headers.get("X-Signature", "")
    good = hmac.new(SECRET, request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sent, good):
        return HttpResponseForbidden()
    return HttpResponse("ok")
`)
add(P, 'cp-python', 'sql-constant-table-name', 'app/count.py', raw`
TABLE_NAME = "orders"


def count(cursor):
    cursor.execute("SELECT COUNT(*) FROM %s" % TABLE_NAME)
    return cursor.fetchone()[0]
`)
add(P, 'cp-python', 'flask-secret-from-secrets', 'app/key.py', raw`
import secrets

from flask import Flask

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
`)
add(P, 'cp-python', 'iv-from-urandom', 'app/iv.py', raw`
import os

IV_LENGTH = 16


def fresh_iv():
    return os.urandom(IV_LENGTH)
`)
add(P, 'cp-python', 'tmp-through-tempfile', 'app/scratch.py', raw`
import os
import tempfile


def scratch(name):
    return os.path.join(tempfile.gettempdir(), name)
`)
add(P, 'cp-python', 'mktemp-named-in-a-string', 'app/note.py', raw`
ADVICE = "do not call tempfile.mktemp(); use mkstemp()"
`)
add(P, 'cp-python', 'chmod-owner-only', 'app/perm.py', raw`
import os


def lock_down(path):
    os.chmod(path, 0o600)
`)
add(P, 'py-assert-in-prod', 'assert-static-table-consistency', 'app/registry.py', raw`
NAMES = ("a", "b", "c")
CODES = {"a": 1, "b": 2, "c": 3}

assert len(NAMES) == len(CODES)  # checked once at import, on constants
`)
add(P, 'py-bare-except', 'except-named-exceptions', 'app/errs.py', raw`
def parse(text):
    try:
        return int(text)
    except (ValueError, TypeError):
        return None
    except Exception:  # noqa: BLE001 - last resort, logged by the caller
        raise
`)
add(P, 'py-bare-except', 'bare-except-only-in-docstring', 'app/doc.py', raw`
def explain():
    """Never write a bare except: clause; always name the error."""
    return 1
`)
add(P, 'py-mutable-default', 'immutable-defaults', 'app/defaults.py', raw`
def f(items=None, flags=frozenset(), pair=(1, 2), name="x", n=0):
    items = [] if items is None else items
    return items, flags, pair, name, n
`)
add(P, 'pickle-load', 'pickle-bundled-fixed-path', 'app/vocab.py', raw`
import os
import pickle

HERE = os.path.dirname(__file__)


def vocab():
    with open(os.path.join(HERE, "data", "vocab.pkl"), "rb") as fh:
        return pickle.load(fh)
`)
add(P, 'random-seed-missing', 'seed-set-before-sampling', 'train/fit.py', raw`
import numpy as np
from sklearn.ensemble import RandomForestClassifier

np.random.seed(1234)


def fit(x, y):
    idx = np.random.permutation(len(x))
    return RandomForestClassifier(random_state=1234).fit(x[idx], y[idx])
`)
add(P, 'path-traversal-pattern', 'python-basename-then-join', 'app/files.py', raw`
import os

from flask import request, send_from_directory

BASE = os.path.join(os.path.dirname(__file__), "reports")


def download():
    name = os.path.basename(request.args["name"])
    return send_from_directory(BASE, name)
`)
add(P, 'open-redirect-pattern', 'python-redirect-allow-list', 'app/nav.py', raw`
from flask import redirect, request

ALLOWED = {"/home", "/settings", "/billing"}


def after_login():
    target = request.args.get("next", "/home")
    if target not in ALLOWED:
        target = "/home"
    return redirect(target)
`)
add(P, 'risky-code', 'md5-cache-key-not-security', 'app/cachekey.py', raw`
import hashlib


def cache_key(blob: bytes) -> str:
    # a cache key for dedupe, not a security control
    return hashlib.md5(blob, usedforsecurity=False).hexdigest()
`)
add(P, 'weak-crypto-modes', 'sha256-and-aes-gcm', 'app/seal.py', raw`
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def seal(key: bytes, data: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, data, hashlib.sha256(b"ctx").digest())
`)
add(P, 'xxe-and-deserialize', 'defusedxml-and-safe-yaml', 'app/parse.py', raw`
import json

import yaml
from defusedxml import ElementTree


def read_all(xml_text, yaml_text, json_text):
    return ElementTree.fromstring(xml_text), yaml.safe_load(yaml_text), json.loads(json_text)
`)
add(P, 'regex-dos', 'linear-separator-pattern', 'app/slug.py', raw`
import re

SLUG = re.compile(r"^(?:[a-z0-9]+-)*[a-z0-9]+$")
SHORT = re.compile(r"^(?:a{1,3}){1,3}$")
`)
add(P, 'error-leak', 'python-generic-error-body', 'app/errors.py', raw`
import logging

from flask import Flask, jsonify

app = Flask(__name__)
log = logging.getLogger(__name__)


@app.errorhandler(Exception)
def boom(exc):
    log.exception("unhandled error")  # the traceback stays in the server log
    return jsonify(error="internal error"), 500
`)
add(P, 'jwt-weak', 'jwt-header-peek-then-verify', 'app/token.py', raw`
import jwt

KEYS = {"k1": "loaded-from-the-keystore"}


def check(token):
    kid = jwt.get_unverified_header(token)["kid"]
    return jwt.decode(token, KEYS[kid], algorithms=["HS256"], audience="api")
`)
add(P, 'cors-wildcard', 'cors-star-public-font', 'app/fonts.py', raw`
from flask import Flask, send_from_directory

app = Flask(__name__)


@app.route("/fonts/<name>")
def font(name):
    resp = send_from_directory("fonts", name)
    # public font files carry no cookies and no credentials: any site may use them
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp
`)
add(P, 'debug-enabled', 'debug-from-environment-off-by-default', 'app/dbg.py', raw`
import os

DEBUG = os.environ.get("APP_DEBUG", "") == "1"
`)
add(P, 'hardcoded-ip', 'documentation-and-private-addresses', 'app/net.py', raw`
DOC_ADDRESSES = ["192.0.2.10", "198.51.100.7", "203.0.113.5"]  # RFC 5737 documentation ranges
LOOPBACK = "127.0.0.1"
PRIVATE = "10.0.0.5"
`)
add(P, 'pii-patterns-in-source', 'reserved-example-contact', 'app/contact.py', raw`
SUPPORT = "support@example.com"
PHONE_FORMAT_HELP = "Use the form +00 000 000 0000"
`)
add(P, 'credentials-in-urls', 'url-with-user-only', 'app/dsn.py', raw`
import os

DSN = "postgresql://appuser@db.internal.example/app"
PASSWORD = os.environ.get("DB_PASSWORD", "")
`)
add(P, 'sql-concat', 'python-order-by-allow-list', 'app/list.py', raw`
SORTABLE = {"name": "name", "created": "created_at"}


def listing(cursor, sort):
    col = SORTABLE.get(sort, "name")
    cursor.execute("SELECT id, name FROM users WHERE active = %s ORDER BY " + col, [True])
    return cursor.fetchall()
`)

// ------------------------------------------------------------------------------------------------------- JavaScript / TypeScript
const J = 'node'
add(J, 'cp-js', 'exec-constant-command', 'src/ver.js', raw`
const { exec } = require('child_process')

exec('git --version', (err, out) => console.log(out))
`)
add(J, 'cp-js', 'exec-alias-constant', 'src/alias.js', raw`
import { exec as run } from 'child_process'

run('node --version')
`)
add(J, 'cp-js', 'spawn-no-shell', 'src/spawn.js', raw`
const { spawn } = require('child_process')

spawn('git', ['log', '-1'], { shell: false })
`)
add(J, 'cp-js', 'require-literal-and-lazy-list', 'src/lazy.js', raw`
const fs = require('fs')
const lazy = () => require('./heavy-module.js')
module.exports = { fs, lazy }
`)
add(J, 'cp-js', 'fs-read-fixed-config', 'src/cfg.js', raw`
const fs = require('fs')
const path = require('path')

const text = fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8')
module.exports = JSON.parse(text)
`)
add(J, 'cp-js', 'buffer-alloc', 'src/buf.js', raw`
const b = Buffer.alloc(10)
const c = Buffer.from('abc')
module.exports = { b, c }
`)
add(J, 'cp-js', 'randombytes', 'src/rand.js', raw`
const crypto = require('crypto')

module.exports = () => crypto.randomBytes(16).toString('hex')
`)
add(J, 'cp-js', 'timing-safe-compare', 'src/cmp.js', raw`
const crypto = require('crypto')

module.exports = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
`)
add(J, 'cp-js', 'bounded-regex', 'src/re.js', raw`
const FLAGS = /^[a-z]{1,8}(?:-[a-z]{1,8}){0,3}$/
module.exports = FLAGS
`)
add(J, 'cp-js', 'handlebars-default-escape', 'src/hb.js', raw`
const Handlebars = require('handlebars')

module.exports = Handlebars.compile('<p>{{name}}</p>')
`)
add(J, 'cp-js', 'csrf-after-method-override', 'src/app.js', raw`
const express = require('express')
const methodOverride = require('method-override')
const csurf = require('csurf')

const app = express()
app.use(methodOverride('_method'))
app.use(csurf())
module.exports = app
`)
add(J, 'cp-js', 'vm-constant-script', 'src/vm.js', raw`
const vm = require('vm')

module.exports = vm.runInNewContext('1 + 1')
`)
add(J, 'cp-js', 'https-server', 'src/srv.js', raw`
const https = require('https')
const fs = require('fs')

https.createServer({ key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') }, (req, res) => res.end('ok'))
`)
add(J, 'cp-js', 'session-cookie-secure', 'src/session.js', raw`
const session = require('express-session')

module.exports = session({ secret: process.env.SESSION_SECRET, cookie: { secure: true, httpOnly: true, sameSite: 'lax' } })
`)
add(J, 'cp-js', 'helmet-default', 'src/helmet.js', raw`
const helmet = require('helmet')

module.exports = helmet()
`)
add(J, 'cp-js', 'postmessage-explicit-origin', 'src/pm.js', raw`
const PARENT = 'https://app.example.com'

module.exports = (win, data) => win.postMessage(data, PARENT)
`)
add(J, 'cp-js', 'write-owner-only-mode', 'src/mode.js', raw`
const fs = require('fs')

fs.writeFileSync('out.json', '{}', { mode: 0o600 })
`)
add(J, 'cp-js', 'tmpdir-join', 'src/tmp.js', raw`
const fs = require('fs')
const os = require('os')
const path = require('path')

fs.writeFileSync(path.join(os.tmpdir(), 'x.json'), '{}')
`)
add(J, 'cp-js', 'yaml-default-schema', 'src/yaml.js', raw`
const yaml = require('js-yaml')

module.exports = (s) => yaml.load(s)
`)
add(J, 'cp-js', 'settimeout-function', 'src/timer.js', raw`
function doIt() {}
setTimeout(doIt, 10)
setTimeout(() => doIt(), 20)
`)
add(J, 'cp-js', 'document-domain-read-only', 'src/dom.js', raw`
const here = document.domain
module.exports = here
`)
add(J, 'cp-js', 'unicode-escapes-visible', 'src/uni.js', raw`
const zeroWidth = '​'
const bidi = '‮'
module.exports = { zeroWidth, bidi }
`)
add(J, 'cp-js', 'secret-compare-of-public-ids', 'src/ids.js', raw`
module.exports = (a) => a.publicId === 'user-1'
`)
add(J, 'risky-code', 'innerhtml-constant-icon', 'src/ui.js', raw`
const ICON = '<svg width="8" height="8"><circle cx="4" cy="4" r="4"/></svg>'
document.getElementById('dot').innerHTML = ICON
document.getElementById('clear').innerHTML = ''
`)
add(J, 'risky-code', 'eval-word-in-comment-and-string', 'src/words.js', raw`
// never call eval(userInput); it is banned in this project
const ADVICE = 'do not use eval() or new Function()'
module.exports = ADVICE
`)
add(J, 'risky-code', 'plain-http-loopback-and-namespace', 'src/ns.js', raw`
const SVG_NS = 'http://www.w3.org/2000/svg'
module.exports = { SVG_NS }
`)
add(J, 'risky-code', 'md5-etag-content-hash', 'src/etag.js', raw`
const crypto = require('crypto')

module.exports = (body) => crypto.createHash('md5').update(body).digest('hex') // ETag for caching, not a secret
`)
add(J, 'js-prototype-pollution', 'object-create-null-map', 'src/map.js', raw`
const table = Object.create(null)
module.exports = (key, value) => { table[key] = value; return table }
`)
add(J, 'js-prototype-pollution', 'map-instead-of-object', 'src/map2.js', raw`
const table = new Map()
module.exports = (key, value) => table.set(key, value)
`)
add(J, 'js-eqeqeq', 'null-check-with-double-equals', 'src/eq.js', raw`
module.exports = (x) => x == null
`)
add(J, 'js-var-usage', 'var-word-in-text', 'src/var.js', raw`
const text = 'the word var appears only in this string'
module.exports = text
`)
add(J, 'js-unhandled-promise', 'then-with-catch', 'src/p.js', raw`
module.exports = () => fetch('/api').then((r) => r.json()).catch((e) => console.error(e))
`)
add(J, 'js-unhandled-promise', 'then-with-two-callbacks', 'src/p2.js', raw`
module.exports = () => fetch('/api').then((r) => r.json(), (e) => console.error(e))
`)
add(J, 'js-await-in-loop', 'ordered-awaits-required', 'src/order.js', raw`
async function sendInOrder(steps) {
  const results = []
  for (const step of steps) results.push(await step())
  return results
}
module.exports = sendInOrder
`)
add(J, 'empty-catch', 'catch-with-comment-and-rethrow', 'src/catch.js', raw`
try {
  JSON.parse(process.argv[2])
} catch (err) {
  console.error('bad json', err.message)
}
`)
add(J, 'sql-concat', 'node-placeholders', 'src/db.js', raw`
module.exports = (db, id) => db.query('SELECT * FROM users WHERE id = $1', [id])
`)
add(J, 'sql-concat', 'node-sql-string-in-docs-comment', 'src/db2.js', raw`
// Example of what NOT to write: "SELECT * FROM users WHERE id = " + id
module.exports = (db, id) => db.query('SELECT * FROM users WHERE id = ?', [id])
`)
add(J, 'path-traversal-pattern', 'node-basename-then-join', 'src/dl.js', raw`
const path = require('path')
const express = require('express')

const router = express.Router()
router.get('/report', (req, res) => {
  const name = path.basename(String(req.query.name))
  res.sendFile(path.join(__dirname, 'reports', name))
})
module.exports = router
`)
add(J, 'path-traversal-pattern', 'node-send-file-with-root-option', 'src/dl2.js', raw`
const express = require('express')

const router = express.Router()
router.get('/doc', (req, res) => res.sendFile('guide.pdf', { root: __dirname }))
module.exports = router
`)
add(J, 'open-redirect-pattern', 'node-redirect-constant', 'src/red.js', raw`
module.exports = (req, res) => res.redirect('/home')
`)
add(J, 'open-redirect-pattern', 'node-redirect-same-origin-check', 'src/red2.js', raw`
module.exports = (req, res) => {
  const next = String(req.query.next || '/')
  res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/')
}
`)
add(J, 'regex-dos', 'js-anchored-class-quantifier', 'src/re2.js', raw`
module.exports = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}$/
`)
add(J, 'weak-crypto-modes', 'node-createhash-sha256', 'src/hash.js', raw`
const crypto = require('crypto')

module.exports = (s) => crypto.createHash('sha256').update(s).digest('hex')
`)
add(J, 'weak-crypto-modes', 'node-aes-gcm-random-iv', 'src/aes.js', raw`
const crypto = require('crypto')

module.exports = (key, data) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()])
}
`)
add(J, 'jwt-weak', 'jwt-verify-with-algorithms', 'src/jwt.js', raw`
const jwt = require('jsonwebtoken')

module.exports = (token) => jwt.verify(token, process.env.JWT_KEY, { algorithms: ['HS256'] })
`)
add(J, 'cookie-flags', 'cookie-with-all-flags', 'src/cookie.js', raw`
module.exports = (res, sid) => res.cookie('sid', sid, { httpOnly: true, secure: true, sameSite: 'strict' })
`)
add(J, 'cors-wildcard', 'cors-origin-allow-list-callback', 'src/cors.js', raw`
const cors = require('cors')
const ALLOWED = new Set(['https://app.example.com'])

module.exports = cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED.has(origin)), credentials: true })
`)
add(J, 'debug-enabled', 'debug-off-in-production-config', 'src/conf.js', raw`
module.exports = { debug: process.env.NODE_ENV !== 'production' && process.env.DEBUG === '1' }
`)
add(J, 'debug-leftovers', 'console-in-cli-entry', 'bin/cli.js', raw`
#!/usr/bin/env node
process.stdout.write('ok\n')
`)
add(J, 'local-storage-pii', 'storage-theme-only', 'src/theme.js', raw`
localStorage.setItem('theme', 'dark')
sessionStorage.setItem('tab', '2')
`)
add(J, 'error-leak', 'node-generic-500', 'src/err.js', raw`
module.exports = (err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'internal error' })
}
`)
add(J, 'pagination-bounds', 'page-size-clamped', 'src/page.js', raw`
module.exports = (req) => Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)
`)
add(J, 'http-timeouts', 'fetch-with-abort-signal', 'src/fetch.js', raw`
module.exports = (url) => fetch(url, { signal: AbortSignal.timeout(5000) })
`)
add(J, 'pii-in-logs', 'log-ids-not-values', 'src/log.js', raw`
module.exports = (user) => console.log('login ok for user id', user.id)
`)
add(J, 'telemetry-calls', 'telemetry-word-in-name', 'src/tele.js', raw`
const telemetryEnabled = false
module.exports = { telemetryEnabled }
`)
add(J, 'cp-js', 'ts-hidden-chars-escaped', 'src/esc.ts', raw`
export const ZWSP: string = '​'
`)

// ------------------------------------------------------------------------------------------------------- React / Next.js / mobile
const R = 'react'
add(R, 'cf-react', 'hooks-at-top-level', 'src/Counter.tsx', raw`
import { useState } from 'react'

export function Counter({ start }: { start: number }) {
  const [n, setN] = useState(start)
  if (n > 100) return null
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
`)
add(R, 'cf-react', 'hook-in-custom-hook', 'src/useThing.ts', raw`
import { useEffect, useState } from 'react'

export function useThing() {
  const [v, setV] = useState(0)
  useEffect(() => { setV(1) }, [])
  return v
}
`)
add(R, 'cf-react', 'href-hash-not-javascript', 'src/Link.tsx', raw`
export const Skip = () => <a href="#main">Skip to content</a>
`)
add(R, 'cf-react', 'javascript-word-in-text', 'src/Text.tsx', raw`
export const About = () => <p>We write JavaScript: links with javascript: urls are banned here.</p>
`)
add(R, 'cf-react', 'dangerous-html-sanitised', 'src/Safe.tsx', raw`
import DOMPurify from 'dompurify'

export const Safe = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
`)
add(R, 'cf-react', 'dangerous-html-constant-markup', 'src/Const.tsx', raw`
const SPINNER = '<svg width="8" height="8"><circle cx="4" cy="4" r="4"/></svg>'

export const Spin = () => <span dangerouslySetInnerHTML={{ __html: SPINNER }} />
`)
add(R, 'cf-react', 'target-blank-with-noopener', 'src/Ext.tsx', raw`
export const Ext = () => <a href="https://example.com" target="_blank" rel="noopener noreferrer">example</a>
`)
add(R, 'cf-next', 'public-env-var-not-a-secret', 'src/pub.ts', raw`
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
export const ANALYTICS_ID = process.env.NEXT_PUBLIC_ANALYTICS_ID
`)
add(R, 'cf-next', 'server-action-checks-session', 'app/actions.ts', raw`
'use server'

import { auth } from './auth'

export async function rename(formData: FormData) {
  const session = await auth()
  if (!session) throw new Error('not signed in')
  return String(formData.get('name')).slice(0, 80)
}
`)
add(R, 'cf-next', 'server-action-fixed-file', 'app/actions2.ts', raw`
'use server'

import { readFile } from 'node:fs/promises'
import { auth } from './auth'

export async function readme() {
  if (!(await auth())) throw new Error('not signed in')
  return readFile('./content/readme.txt', 'utf8')
}
`)
add(R, 'cf-mobile', 'asyncstorage-theme', 'src/store.ts', raw`
import AsyncStorage from '@react-native-async-storage/async-storage'

export const saveTheme = (t: string) => AsyncStorage.setItem('theme', t)
`)
add(R, 'cf-mobile', 'linking-checked-scheme', 'src/open.ts', raw`
import { Linking } from 'react-native'

export function openDocs(url: string) {
  if (new URL(url).protocol === 'https:') Linking.openURL(url)
}
`)
add(R, 'cf-mobile', 'webview-fixed-origin', 'src/Web.tsx', raw`
import { WebView } from 'react-native-webview'

export const Help = () => <WebView source={{ uri: 'https://help.example.com' }} originWhitelist={['https://help.example.com']} />
`)
add(R, 'inline-event-handlers', 'jsx-onclick-is-a-prop', 'src/Btn.tsx', raw`
export const Btn = ({ go }: { go: () => void }) => <button onClick={go}>Go</button>
`)
add(R, 'image-alt-quality', 'decorative-image-empty-alt', 'src/Hero.tsx', raw`
export const Hero = () => <img src="/divider.svg" alt="" role="presentation" />
`)
add(R, 'sri-missing', 'same-origin-script', 'public/index.html', raw`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>App</title></head>
<body><div id="root"></div><script src="/assets/main.js"></script></body>
</html>
`)

// ------------------------------------------------------------------------------------------------------------------- Electron
const E = 'electron'
add(E, 'electron-node-integration', 'node-integration-false-explicit', 'main/win.js', raw`
const { BrowserWindow } = require('electron')

module.exports = () => new BrowserWindow({
  webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: __dirname + '/preload.js' },
})
`)
add(E, 'electron-context-isolation', 'isolation-on-with-comment-about-off', 'main/win2.js', raw`
const { BrowserWindow } = require('electron')

// contextIsolation: false is forbidden here, so it is left at its default (true)
module.exports = () => new BrowserWindow({ webPreferences: { preload: __dirname + '/preload.js' } })
`)
add(E, 'electron-web-security', 'web-security-default', 'main/win3.js', raw`
const { BrowserWindow } = require('electron')

module.exports = () => new BrowserWindow({ webPreferences: { webSecurity: true, allowRunningInsecureContent: false } })
`)
add(E, 'electron-devtools-prod', 'devtools-dev-only', 'main/dev.js', raw`
const { app } = require('electron')

module.exports = (win) => { if (!app.isPackaged) win.webContents.openDevTools() }
`)
add(E, 'electron-open-external', 'open-external-fixed-and-checked', 'main/ext.js', raw`
const { shell } = require('electron')

const OK = new Set(['https://example.com/docs', 'https://example.com/help'])
module.exports = {
  docs: () => shell.openExternal('https://example.com/docs'),
  link: (url) => { if (OK.has(url)) return shell.openExternal(url) },
}
`)
add(E, 'electron-preload-exposure', 'bridge-named-functions', 'main/preload.js', raw`
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  version: () => ipcRenderer.invoke('app:version'),
  save: (text) => ipcRenderer.invoke('doc:save', String(text).slice(0, 1e6)),
})
`)
add(E, 'electron-ipc-validation', 'ipc-fixed-file-and-validated-sender', 'main/ipc.js', raw`
const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('doc:read', (event) => {
  if (new URL(event.senderFrame.url).origin !== 'file://') throw new Error('bad sender')
  return fs.readFileSync(path.join(app.getPath('userData'), 'notes.txt'), 'utf8')
})
`)
add(E, 'electron-navigation-guards', 'window-with-guards', 'main/guard.js', raw`
const { BrowserWindow, shell } = require('electron')

module.exports = () => {
  const win = new BrowserWindow({ webPreferences: { sandbox: true } })
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://example.com/')) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return win
}
`)
add(E, 'electron-updater-https', 'updater-https-feed', 'main/update.js', raw`
const { autoUpdater } = require('electron')

autoUpdater.setFeedURL({ url: 'https://updates.example.com/app' })
`)
add(E, 'electron-remote-module', 'remote-word-in-comment', 'main/remote.js', raw`
// The remote module is not used: ipc handlers do the work instead.
module.exports = {}
`)
add(E, 'electron-csp-header', 'local-page-with-csp-meta', 'renderer/index.html', raw`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><title>App</title></head>
<body><script src="./app.js"></script></body>
</html>
`)
add(E, 'ep-window', 'window-sandbox-on', 'main/ep.js', raw`
const { BrowserWindow } = require('electron')

module.exports = () => new BrowserWindow({ webPreferences: { sandbox: true, nodeIntegrationInWorker: false, experimentalFeatures: false } })
`)

export function projects(ctx) {
  const { tidy, pkg } = ctx
  const out = {}
  for (const [name, files] of Object.entries(FILES)) {
    const base = { ...tidy(`trap-lang-${name}-clean`) }
    if (name === 'node' || name === 'react' || name === 'electron') base['package.json'] = pkg(`trap-lang-${name}-clean`)
    out[`trap-lang-${name}-clean`] = { files: { ...base, ...files } }
  }
  return { projects: out, expect: {} }
}
