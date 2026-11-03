// Grown planted defects, hard and extreme, part 3: sign-in, token, key and browser-trust settings that are only unsafe because of what a second
// or third file does with them (a middleware, a constants file, a server bootstrap). The planted line is the unsafe setting or call; the
// "-clean" twin has the same files written safely and must not be reported. Keys and projects are prefixed `grow-hard-`.
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
    ['auth-fastify-hook-decode', 'jwt-weak', 'a Fastify hook in a plugin file reads the user from jwt.decode, the server file registers it and the admin route file trusts request.user', {
      'src/plugins/auth-hook.js': ["const jwt = require('jsonwebtoken')", 'module.exports = async function authHook(request) {', "  const raw = String(request.headers.authorization || '').slice(7)", ['  request.user = jwt.decode(raw)', '  request.user = jwt.verify(raw, process.env.JWT_SECRET, { algorithms: ["HS256"] })', 'x'], '}'],
      'src/server.js': ["const fastify = require('fastify')()", "fastify.addHook('onRequest', require('./plugins/auth-hook'))", "fastify.register(require('./routes/admin'))"],
      'src/routes/admin.js': ["module.exports = async (app) => app.delete('/admin/users/:id', async (request, reply) => (request.user && request.user.role === 'admin' ? reply.code(204).send() : reply.code(403).send()))"],
    }], // tier: impact=critical difficulty=extreme
    ['auth-python-jwt-no-verify', 'jwt-weak', 'a Python auth helper decodes the token with signature checking turned off and the views trust the claims it returns', {
      'api/auth.py': ['import jwt', '', 'def current_user(token):', ['    return jwt.decode(token, options={"verify_signature": False})', '    return jwt.decode(token, SECRET, algorithms=["HS256"])', 'x']],
      'api/views.py': ['from api.auth import current_user', '', 'def delete_account(request):', "    user = current_user(request.headers['Authorization'])", "    return user['role'] == 'admin'"],
    }], // tier: impact=critical difficulty=hard
    ['auth-jwt-options-none', 'jwt-weak', 'verify options with the none algorithm are exported from one file and used by a token module in a second file called from a third', {
      'src/auth/options.js': [["exports.jwtAlgorithms = ['HS256', 'none']", "exports.jwtAlgorithms = ['HS256']", 'x']],
      'src/auth/tokens.js': ["const jwt = require('jsonwebtoken')", "const { jwtAlgorithms } = require('./options')", 'exports.check = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: jwtAlgorithms })'],
      'src/routes/me.js': ["const { check } = require('../auth/tokens')", "module.exports = (app) => app.get('/me', (req, res) => res.json(check(req.get('authorization'))))"],
    }], // tier: impact=critical difficulty=extreme
    ['auth-ecb-python-settings', 'weak-crypto-modes', 'a settings module picks ECB mode and a crypto helper in another file builds the cipher from it', {
      'vault/settings.py': ['from Crypto.Cipher import AES', '', ['MODE = AES.MODE_ECB', 'MODE = AES.MODE_GCM', 'x']],
      'vault/seal.py': ['from Crypto.Cipher import AES', 'from vault.settings import MODE', '', 'def seal(key, data):', '    return AES.new(key, MODE).encrypt(data)'],
    }], // tier: impact=high difficulty=hard
    ['auth-md5-password-lib', 'weak-crypto-modes|risky-code', 'the login route calls a shared password helper in another file that hashes with MD5', {
      'src/lib/passwords.js': ["const crypto = require('crypto')", ["exports.hash = (password) => crypto.createHash('md5').update(password).digest('hex')", "exports.hash = (password) => require('bcrypt').hashSync(password, 12)", 'x']],
      'src/routes/login.js': ["const { hash } = require('../lib/passwords')", "module.exports = (app) => app.post('/login', (req, res) => res.json({ ok: hash(req.body.password) === req.body.stored }))"],
    }], // tier: impact=high difficulty=hard
    ['auth-reset-token-random', 'weak-crypto-modes|risky-code', 'a token helper in one file makes reset tokens from Math.random and the password reset route in another file mails them', {
      'src/lib/tokens.js': [["exports.resetToken = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)", "exports.resetToken = () => require('crypto').randomBytes(24).toString('base64url')", 'x']],
      'src/routes/forgot.js': ["const { resetToken } = require('../lib/tokens')", "module.exports = (app) => app.post('/forgot', async (req, res) => { await mail(req.body.email, resetToken()); res.sendStatus(202) })"],
    }], // tier: impact=high difficulty=hard
    ['auth-java-random-token', 'cp-java/java-random-token-method|cp-java/java-random-secret|weak-crypto-modes', 'a Java token service builds session tokens from java.util.Random and the login controller in another file hands them out', {
      'src/main/java/app/auth/TokenService.java': ['package app.auth;', 'public class TokenService {', ['  String newToken() {\n    return new java.util.Random().nextInt() + "";\n  }', '  String newToken() {\n    return new java.security.SecureRandom().nextInt() + "";\n  }', 'x'], '}'],
      'src/main/java/app/web/LoginController.java': ['package app.web;', 'public class LoginController {', '  public String login() { return new app.auth.TokenService().newToken(); }', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-dotnet-jwt-validation-off', 'cp-dotnet-php-ruby/cs-jwt-check-off', 'an auth extension method turns signing-key validation off, Startup calls it and the controllers in a third file rely on the Authorize attribute', {
      'Extensions/AuthExtensions.cs': ['public static class AuthExtensions {', '  public static void AddAppAuth(this IServiceCollection s) {', '    var p = new TokenValidationParameters {', ['      ValidateIssuerSigningKey = false,', '      ValidateIssuerSigningKey = true,', 'x'], '      ValidateLifetime = true', '    };', '  }', '}'],
      'Startup.cs': ['public class Startup {', '  public void ConfigureServices(IServiceCollection services) { services.AddAppAuth(); }', '}'],
      'Controllers/AdminController.cs': ['[Authorize]', 'public class AdminController {', '  public object Users() { return Db.Users(); }', '}'],
    }], // tier: impact=critical difficulty=extreme
    ['auth-dotnet-antiforgery-ignored', 'cp-dotnet-php-ruby/cs-antiforgery-ignored', 'a base controller in one file ignores antiforgery tokens and the form controllers in other files inherit from it', {
      'Controllers/BaseController.cs': [['[IgnoreAntiforgeryToken]', '[ValidateAntiForgeryToken]', 'x'], 'public class BaseController {', '}'],
      'Controllers/TransferController.cs': ['public class TransferController : BaseController {', '  public object Post(decimal amount) { return Bank.Move(amount); }', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-rails-csrf-skipped', 'cp-dotnet-php-ruby/rb-csrf-skipped', 'a concern skips the CSRF check for every controller that includes it, and the settings controller in another file includes it', {
      'app/controllers/concerns/api_mode.rb': ['module ApiMode', '  extend ActiveSupport::Concern', '  included do', ['    skip_before_action :verify_authenticity_token', '    before_action :authenticate_user!', 'x'], '  end', 'end'],
      'app/controllers/settings_controller.rb': ['class SettingsController < ApplicationController', '  include ApiMode', '  def update', '    current_user.update(email: params[:email])', '  end', 'end'],
    }], // tier: impact=high difficulty=extreme
    ['auth-cors-java-base-class', 'cp-java/java-cors-any-origin|cors-wildcard', 'a base controller allows every origin and the account controller in another file extends it', {
      'src/main/java/app/web/BaseApi.java': ['package app.web;', ['@CrossOrigin(origins = "*")', '@CrossOrigin(origins = "https://app.example.dev")', 'x'], 'public class BaseApi {', '}'],
      'src/main/java/app/web/AccountApi.java': ['package app.web;', 'public class AccountApi extends BaseApi {', '  public Object me() { return "me"; }', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-cors-go-middleware-credentials', 'cp-go/go-cors-any-origin|cors-wildcard', 'a Go middleware allows every origin and a second file in the same package sets Allow-Credentials on the same responses', {
      'internal/web/cors.go': ['package web', '', 'import "net/http"', '', 'func withCORS(next http.Handler) http.Handler {', '\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {', ['\t\tw.Header().Set("Access-Control-Allow-Origin", "*")', '\t\tw.Header().Set("Access-Control-Allow-Origin", "https://app.example.dev")', 'x'], '\t\tnext.ServeHTTP(w, r)', '\t})', '}'],
      'internal/web/session.go': ['package web', '', 'import "net/http"', '', 'func session(w http.ResponseWriter, r *http.Request) {', '\tw.Header().Set("Access-Control-Allow-Credentials", "true")', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-cookie-go-helper', 'cp-go/go-cookie-not-secure|cookie-flags', 'a Go helper builds the session cookie with no Secure or HttpOnly flag and the login handler in another file uses it', {
      'internal/web/cookies.go': ['package web', '', 'import "net/http"', '', 'func sessionCookie(v string) http.Cookie {', ['\treturn http.Cookie{Name: "sid", Value: v}', '\treturn http.Cookie{Name: "sid", Value: v, Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode}', 'x'], '}'],
      'internal/web/login.go': ['package web', '', 'import "net/http"', '', 'func login(w http.ResponseWriter, r *http.Request) {', '\tc := sessionCookie("abc")', '\thttp.SetCookie(w, &c)', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-cookie-java-factory', 'cp-java/java-cookie-not-secure|cookie-flags', 'a cookie factory marks the session cookie not secure and the login servlet in another file uses it', {
      'src/main/java/app/web/Cookies.java': ['package app.web;', 'public class Cookies {', '  public static javax.servlet.http.Cookie session(String v) {', '    javax.servlet.http.Cookie cookie = new javax.servlet.http.Cookie("sid", v);', ['    cookie.setSecure(false);', '    cookie.setSecure(true);', 'x'], '    return cookie;', '  }', '}'],
      'src/main/java/app/web/LoginServlet.java': ['package app.web;', 'public class LoginServlet {', '  public void login(javax.servlet.http.HttpServletResponse res) { res.addCookie(Cookies.session("abc")); }', '}'],
    }], // tier: impact=high difficulty=hard
    ['auth-session-secure-false-config', 'cp-js/js-session-cookie-insecure|cookie-flags', 'the session cookie options in a config file allow plain http, the app file passes them to express-session and the login route relies on the session', {
      'src/config/session.js': [["exports.sessionCookie = { secure: false, httpOnly: true, sameSite: 'lax' }", "exports.sessionCookie = { secure: true, httpOnly: true, sameSite: 'lax' }", 'x']],
      'src/app.js': ["const session = require('express-session')", "const { sessionCookie } = require('./config/session')", "module.exports = (app) => app.use(session({ secret: process.env.SESSION_SECRET, cookie: sessionCookie }))"],
      'src/routes/login-session.js': ["module.exports = (app) => app.post('/login', (req, res) => { req.session.uid = req.body.uid; res.sendStatus(204) })"],
    }], // tier: impact=high difficulty=extreme
    ['auth-tls-env-bootstrap', 'risky-code', 'a bootstrap file switches off certificate checking for the whole process and the payment client in another file calls the gateway over https', {
      'src/bootstrap.js': [["process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'", "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'", 'x'], "require('./server')"],
      'src/payments/client.js': ["const https = require('https')", "exports.charge = (body) => https.request('https://api.paygate-eu.io/v2/charge', { method: 'POST' })"],
    }], // tier: impact=high difficulty=extreme
    ['auth-helmet-csp-config', 'cp-js/js-helmet-csp-off', 'a security config file turns the Helmet content security policy off and the server file applies it before the routes', {
      'src/config/security.js': [["exports.helmetOptions = { contentSecurityPolicy: false }", "exports.helmetOptions = { contentSecurityPolicy: true }", 'x']],
      'src/server.js': ["const helmet = require('helmet')", "const { helmetOptions } = require('./config/security')", "module.exports = (app) => app.use(helmet(helmetOptions))"],
    }], // tier: impact=high difficulty=hard
  ]
  return mk('trust', ctx, cases)
}
