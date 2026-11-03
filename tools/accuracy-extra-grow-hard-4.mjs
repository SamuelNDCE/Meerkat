// Grown planted defects, hard and extreme, part 4: unsafe output, logging, redirects, transport and request handling that depend on a helper,
// a shared setting or a server action in another file. The planted line is the unsafe call or setting; the "-clean" twin has the same
// files written safely and must not be reported. Keys and projects are prefixed `grow-hard-`.
// A file line is a plain string (same in both projects) or [badLine, cleanLine, 'x'] ('x' marks the planted line).
// Case: [key, check id, description, { file: [lines] }]  // tier: impact=<critical|high|medium|low> difficulty=<easy|medium|hard|extreme>

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-hard-${fam}`) }
  const good = { ...tidy(`grow-hard-${fam}-clean`) }
  for (const [k, exp, desc, files] of cases) {
    expect[`grow-hard-${k}`] = exp
    for (const [file, lines] of Object.entries(files)) {
      bad[file] = [...lines.map((l) => (Array.isArray(l) ? (l[2] === 'x' ? d(`grow-hard-${k}`, desc, l[0]) : l[0]) : l)), '']
      good[file] = [...lines.map((l) => (Array.isArray(l) ? l[1] : l)), '']
    }
  }
  return { projects: { [`grow-hard-${fam}`]: { files: bad }, [`grow-hard-${fam}-clean`]: { files: good } }, expect }
}

export function projects(ctx) {
  const cases = [
    ['out-handlebars-noescape-mail', 'cp-js/js-template-no-escape', 'a mail helper compiles Handlebars with escaping off and a route in another file passes customer-typed fields to it', {
      'src/lib/mailer-render.js': ["const Handlebars = require('handlebars')", ['exports.render = (tpl, data) => Handlebars.compile(tpl, { noEscape: true })(data)', 'exports.render = (tpl, data) => Handlebars.compile(tpl)(data)', 'x']],
      'src/routes/contact.js': ["const { render } = require('../lib/mailer-render')", "module.exports = (app) => app.post('/contact', (req, res) => res.send(render('<p>{{name}}</p>', { name: req.body.name })))"],
    }], // tier: impact=high difficulty=hard
    ['out-jinja-autoescape-env', 'cp-python/py-jinja-autoescape-off', 'a template environment factory turns autoescape off and a view in another file renders request text through it', {
      'web/templates.py': ['from jinja2 import Environment, FileSystemLoader', '', 'def make_env():', ['    return Environment(loader=FileSystemLoader("templates"), autoescape=False)', '    return Environment(loader=FileSystemLoader("templates"), autoescape=True)', 'x']],
      'web/views.py': ['from web.templates import make_env', '', 'def greet(request):', "    return make_env().from_string('<p>{{ n }}</p>').render(n=request.args['name'])"],
    }], // tier: impact=high difficulty=hard
    ['out-django-mark-safe-tag', 'cp-python/py-django-mark-safe', 'a template tag helper marks a comment body safe and a view in another file passes user comments to it', {
      'blog/tags.py': ['from django.utils.safestring import mark_safe', '', 'def render_comment(body):', ['    return mark_safe(body)', '    return body', 'x']],
      'blog/views.py': ['from blog.tags import render_comment', '', 'def show(request):', "    return render_comment(request.POST['comment'])"],
    }], // tier: impact=high difficulty=hard
    ['out-django-allowed-hosts-prod', 'cp-python/py-django-allowed-hosts-star', 'a production settings file sets ALLOWED_HOSTS to a star and a deploy file in a third place imports it', {
      'proj/settings/base.py': ['DEBUG = False', 'SECRET_KEY_ENV = "DJANGO_SECRET"'],
      'proj/settings/prod.py': ['from proj.settings.base import *', '', ['ALLOWED_HOSTS = ["*"]', 'ALLOWED_HOSTS = ["shop.example.dev"]', 'x']],
      'proj/wsgi.py': ['import os', 'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings.prod")'],
    }], // tier: impact=high difficulty=extreme
    ['out-django-csrf-exempt-hook', 'cp-python/py-django-csrf-exempt', 'a webhook view is exempt from CSRF and the URL file in another file also routes the account update form to it', {
      'pay/views.py': ['from django.views.decorators.csrf import csrf_exempt', '', ['@csrf_exempt', '@require_POST', 'x'], 'def hook(request):', '    return None'],
      'pay/urls.py': ['from pay.views import hook', "urlpatterns = [('account/update', hook), ('pay/hook', hook)]"],
    }], // tier: impact=high difficulty=hard
    ['out-pii-log-audit-helper', 'pii-in-logs', 'an audit helper in one file logs the whole request body and the login route in another file calls it with the typed password', {
      'src/lib/audit.js': [["exports.record = (event, body) => console.log(event, body.email, body.password)", "exports.record = (event, body) => console.log(event, body.id)", 'x']],
      'src/routes/login-audit.js': ["const { record } = require('../lib/audit')", "module.exports = (app) => app.post('/login', (req, res) => { record('login', req.body); res.sendStatus(204) })"],
    }], // tier: impact=high difficulty=hard
    ['out-pii-log-python-token', 'pii-in-logs', 'a Python request hook in one module logs the bearer token that the auth module in another file reads', {
      'svc/hooks.py': ['import logging', 'log = logging.getLogger("svc")', '', 'def after_auth(token):', ['    log.info("auth ok token=%s", token)', '    log.info("auth ok")', 'x']],
      'svc/auth.py': ['from svc.hooks import after_auth', '', 'def authenticate(request):', "    token = request.headers['Authorization']", '    after_auth(token)'],
    }], // tier: impact=high difficulty=hard
    ['out-ls-token-store', 'local-storage-pii', 'a browser auth store keeps the access token in localStorage and the API client in another file reads it', {
      'src/web/auth-store.js': ['export function remember(tokens) {', ["  localStorage.setItem('access_token', tokens.access)", "  sessionStorage.setItem('ui_theme', tokens.theme)", 'x'], '}'],
      'src/web/api.js': ["export const authHeader = () => ({ Authorization: 'Bearer ' + localStorage.getItem('ui_theme') })"],
    }], // tier: impact=high difficulty=hard
    ['out-redirect-helper-python', 'open-redirect-pattern|cp-python/py-redirect', 'a login view hands the next query value to a helper in another file that redirects to it without a check', {
      'acct/views.py': ['from acct.nav import go_next', '', 'def login(request):', "    return go_next(request.args.get('next'))"],
      'acct/nav.py': ['from flask import redirect', '', 'def go_next(url):', ['    return redirect(url)', "    return redirect(url if url and url.startswith('/') and not url.startswith('//') else '/')", 'x']],
    }], // tier: impact=medium difficulty=hard
    ['out-regex-pattern-constant', 'regex-dos', 'a validator constant with a repeat inside a repeat is defined in one file and the signup route in another file tests the email field with it', {
      'src/validate/patterns.js': [["exports.EMAIL = /^([a-z0-9]+\\.?)+@example\\.dev$/", "exports.EMAIL = /^[a-z0-9.]{1,64}@example\\.dev$/", 'x']],
      'src/routes/signup-check.js': ["const { EMAIL } = require('../validate/patterns')", "module.exports = (app) => app.post('/signup', (req, res) => res.sendStatus(EMAIL.test(req.body.email) ? 204 : 422))"],
    }], // tier: impact=medium difficulty=hard
    ['out-tls-python-session-factory', 'risky-code|cp-python/py-ssl-unverified', 'an HTTP client factory in one module builds a session with certificate checks off and the payment module in another file uses it', {
      'pay/http.py': ['import requests', '', 'def client():', '    s = requests.Session()', ['    s.verify = False', '    s.verify = True', 'x'], '    return s'],
      'pay/charge.py': ['from pay.http import client', '', 'def charge(card, amount):', "    return client().post('https://api.paygate-eu.io/charge', json={'card': card, 'amount': amount}, timeout=5)"],
    }], // tier: impact=high difficulty=hard
    ['out-tls-java-trust-all', 'cp-java/java-trust-all-certificates', 'a trust manager class accepts every server certificate and the HTTP client config in another file installs it', {
      'src/main/java/app/net/TrustAll.java': ['package app.net;', 'public class TrustAll implements javax.net.ssl.X509TrustManager {', '  public void checkClientTrusted(java.security.cert.X509Certificate[] c, String a) {}', ['  public void checkServerTrusted(java.security.cert.X509Certificate[] c, String a) throws java.security.cert.CertificateException {}', '  public void checkServerTrusted(java.security.cert.X509Certificate[] c, String a) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException("untrusted"); }', 'x'], '  public java.security.cert.X509Certificate[] getAcceptedIssuers() { return null; }', '}'],
      'src/main/java/app/net/HttpConfig.java': ['package app.net;', 'public class HttpConfig {', '  public static Object[] managers() { return new Object[] { new TrustAll() }; }', '}'],
    }], // tier: impact=high difficulty=extreme
    ['out-tls-dotnet-handler', 'cp-dotnet-php-ruby/cs-accept-any-certificate', 'a handler factory in one file accepts any certificate and the API client in another file builds its HttpClient from it', {
      'Net/HandlerFactory.cs': ['public static class HandlerFactory {', '  public static System.Net.Http.HttpClientHandler Make() {', '    var h = new System.Net.Http.HttpClientHandler();', ['    h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true;', '    h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => e == System.Net.Security.SslPolicyErrors.None;', 'x'], '    return h;', '  }', '}'],
      'Net/ApiClient.cs': ['public class ApiClient {', '  readonly System.Net.Http.HttpClient http = new System.Net.Http.HttpClient(HandlerFactory.Make());', '}'],
    }], // tier: impact=high difficulty=hard
    ['out-php-curl-verify-helper', 'cp-dotnet-php-ruby/php-curl-verify-off', 'a PHP HTTP helper turns peer verification off and the billing page in another file fetches the invoice API through it', {
      'lib/http.php': ['<?php', 'function http_get($url) {', '    $c = curl_init($url);', ['    curl_setopt($c, CURLOPT_SSL_VERIFYPEER, false);', '    curl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);', 'x'], '    return curl_exec($c);', '}'],
      'public/billing.php': ['<?php', "require_once __DIR__ . '/../lib/http.php';", "echo http_get('https://api.billing.example.dev/invoices');"],
    }], // tier: impact=high difficulty=hard
    ['out-php-extract-bootstrap', 'cp-dotnet-php-ruby/php-extract-request', 'a bootstrap file extracts the query string into variables that the settings page in another file then trusts', {
      'lib/bootstrap.php': ['<?php', ['extract($_GET);', '$page = (int) ($_GET["page"] ?? 1);', 'x']],
      'public/settings.php': ['<?php', "require_once __DIR__ . '/../lib/bootstrap.php';", 'if (isset($is_admin)) { echo "admin"; }'],
    }], // tier: impact=high difficulty=extreme
    ['out-next-server-action-no-session', 'cf-next', 'a Next.js server action deletes a user with no session check, the auth helper in another file exists but is never called, and the middleware matcher skips the admin path', {
      'middleware.ts': ["export const config = { matcher: ['/dashboard/:path*'] }", "export function middleware() {}"],
      'lib/auth.ts': ["export async function auth() { return null }"],
      'app/admin/actions.ts': ["import { db } from '../../lib/db'", '', 'export async function deleteUser(formData) {', "  'use server'", ['  await db.users.delete({ id: formData.get("id") })', '  const { auth } = await import("../../lib/auth")\n  const session = await auth()\n  if (!session) throw new Error("forbidden")\n  await db.users.delete({ id: formData.get("id") })', 'x'], '}'],
    }], // tier: impact=critical difficulty=extreme
    ['out-next-server-action-file-read', 'cf-next', 'a Next.js server action reads a file whose name comes from the form, through a path built in the same action with no basename', {
      'lib/files.ts': ["export const UPLOADS = 'uploads'"],
      'app/files/actions.ts': ["import fs from 'node:fs/promises'", "import path from 'node:path'", "import { UPLOADS } from '../../lib/files'", '', 'export async function download(formData) {', "  'use server'", ['  return fs.readFile(path.join(UPLOADS, formData.get("name")))', '  return fs.readFile(path.join(UPLOADS, path.basename(String(formData.get("name")))))', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['out-proto-merge-helper', 'js-prototype-pollution', 'a settings route passes the request body to a merge helper in another file that copies every key onto the target', {
      'src/lib/merge.js': ['exports.merge = (target, source) => {', '  for (const key of Object.keys(source)) {', ['    if (typeof source[key] === "object") { target[key] = exports.merge(target[key] || {}, source[key]) } else { target[key] = source[key] }', '    if (key === "__proto__" || key === "constructor" || key === "prototype") continue\n    if (typeof source[key] === "object") { target[key] = exports.merge(target[key] || {}, source[key]) } else { target[key] = source[key] }', 'x'], '  }', '  return target', '}'],
      'src/routes/prefs.js': ["const { merge } = require('../lib/merge')", "const defaults = {}", "module.exports = (app) => app.put('/prefs', (req, res) => res.json(merge(defaults, req.body)))"],
    }], // tier: impact=critical difficulty=hard
    ['out-require-variable-plugin', 'cp-js/js-require-variable', 'a plugin name read from a request is loaded by a registry helper in another file with require', {
      'src/lib/registry.js': ['exports.load = (name) => {', ['  return require(name)', "  return require('./plugins/default')", 'x'], '}'],
      'src/routes/plugins.js': ["const { load } = require('../lib/registry')", "module.exports = (app) => app.post('/plugins/run', (req, res) => res.json(load(req.body.name)))"],
    }], // tier: impact=high difficulty=hard
  ]
  return mk('output', ctx, cases)
}
