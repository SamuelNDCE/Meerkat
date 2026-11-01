// Rule tables for the web-hardening checks (thorough/web-hardening.mjs). Each entry is one sub-check.
//
// Fields:
//   id      kebab-case, unique across all four tables (becomes <suite>/<check>/<id>)
//   title   one plain sentence: what is wrong
//   files   RegExp on the path: which files the rule reads. No file matched = NA (not applicable here).
//   when    optional RegExp on the content: only files whose text matches count (keeps header rules to real server config)
//   notIn   optional RegExp on the path: files to skip
//   re      RegExp tested on each line (a line match is a finding at that line)
//   test    alternative to re: (line) => boolean
//   whole   (text, path) => boolean, true = finding (for rules that read a whole file, e.g. JSON)
//   lacks   RegExp that the file must contain; the file is a finding when it does not
//   path    RegExp on each path in the folder tree (a match is a finding). Used for publish-folder rules.
//   sample  file name the bad and good samples are judged as (must match `files`)
//   bad     text that MUST be a finding for this rule (selfProve)
//   good    text that MUST NOT be a finding (selfProve)
// Every rule is linear-time: no nested unbounded quantifiers, no backreferences inside repeats.

// ---------- wh-headers: HTTP headers and TLS settings in server, framework and hosting config ----------

// A file that really configures a web server or host (not a random .js file that happens to mention a header name).
const WEBCFG = /server\s*\{|location\s+[\/~=^]|<VirtualHost\b|RewriteEngine\b|\bOptions\s|\[\[headers\]\]|\[build\]|\bpublish\s*=|outputDirectory|"headers"\s*:|async headers\(|headers\s*\(\)|app\.use\(|express\(|add_header|Header\s+(always\s+)?set|setHeader\(|<system\.webServer>|^\/\*/m
const HDR = /(^|\/)(nginx[^\/]*\.conf|[^\/]*\.conf|\.htaccess|httpd[^\/]*|Caddyfile[^\/]*|web\.config|_headers|netlify\.toml|vercel\.json|staticwebapp\.config\.json|firebase\.json|wrangler\.toml|next\.config\.(m?js|ts)|server\.(m?js|ts)|app\.(m?js|ts))$/i
const NGINX = /(^|\/)nginx[^\/]*\.conf$/i
const APACHE = /(^|\/)(\.htaccess|httpd[^\/]*|[^\/]*\.conf)$/i
const CSP_LINE = /Content-Security-Policy/i
// A CSP directive value check on one line. The [^;'"]* runs are bounded by the separators, so they are linear.
const cspDirective = (line, name) => CSP_LINE.test(line) && new RegExp(`${name}[^;'"]*`, 'i').test(line)
const CODE = /\.(m?[jt]sx?|cjs|py|go|php|java|kt|cs|rb)$/i
const JSONISH = /\.(json|ya?ml|toml)$/i
const HSTS = /Strict-Transport-Security/i
const MAXAGE = /max-age\D{0,6}(\d{1,12})/i

export const HEADERS = [
  { id: 'hsts-missing', title: 'The server config sets no Strict-Transport-Security (HSTS) header', files: HDR, when: WEBCFG, lacks: HSTS, sample: 'nginx.conf',
    bad: 'server {\n  listen 443 ssl;\n}\n', good: 'server {\n  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n}\n' },
  { id: 'hsts-max-age-short', title: 'HSTS max-age is under 15768000 seconds (six months)', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => HSTS.test(l) && MAXAGE.test(l) && Number(MAXAGE.exec(l)[1]) < 15768000,
    bad: 'server {\n  add_header Strict-Transport-Security "max-age=3600" always;\n}\n', good: 'server {\n  add_header Strict-Transport-Security "max-age=31536000" always;\n}\n' },
  { id: 'hsts-no-include-subdomains', title: 'HSTS does not cover subdomains (no includeSubDomains)', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => HSTS.test(l) && !/includeSubDomains/i.test(l),
    bad: 'server {\n  add_header Strict-Transport-Security "max-age=31536000" always;\n}\n', good: 'server {\n  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n}\n' },
  { id: 'hsts-no-preload', title: 'HSTS has no preload directive (informational, preload list is opt-in)', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => HSTS.test(l) && !/preload/i.test(l),
    bad: 'server {\n  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n}\n', good: 'server {\n  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;\n}\n' },
  { id: 'xfo-missing', title: 'The config sets no X-Frame-Options header against clickjacking', files: HDR, when: WEBCFG, lacks: /X-Frame-Options/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header X-Frame-Options "DENY" always;\n}\n' },
  { id: 'xfo-allow-all', title: 'X-Frame-Options is set to ALLOWALL, which allows any site to frame the page', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => /X-Frame-Options/i.test(l) && /ALLOWALL/i.test(l),
    bad: 'server {\n  add_header X-Frame-Options "ALLOWALL";\n}\n', good: 'server {\n  add_header X-Frame-Options "SAMEORIGIN";\n}\n' },
  { id: 'frame-ancestors-missing', title: 'The Content-Security-Policy has no frame-ancestors directive', files: HDR, when: WEBCFG, lacks: /frame-ancestors/i, sample: 'nginx.conf',
    bad: 'server {\n  add_header Content-Security-Policy "default-src \'self\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "frame-ancestors \'none\'";\n}\n' },
  { id: 'xcto-missing', title: 'The config sets no X-Content-Type-Options header', files: HDR, when: WEBCFG, lacks: /X-Content-Type-Options/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header X-Content-Type-Options "nosniff" always;\n}\n' },
  { id: 'xcto-not-nosniff', title: 'X-Content-Type-Options is set to something other than nosniff', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => /X-Content-Type-Options/i.test(l) && !/nosniff/i.test(l),
    bad: 'server {\n  add_header X-Content-Type-Options "sniff";\n}\n', good: 'server {\n  add_header X-Content-Type-Options "nosniff";\n}\n' },
  { id: 'referrer-policy-missing', title: 'The config sets no Referrer-Policy header', files: HDR, when: WEBCFG, lacks: /Referrer-Policy/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header Referrer-Policy "strict-origin-when-cross-origin";\n}\n' },
  { id: 'referrer-policy-unsafe-url', title: 'Referrer-Policy is unsafe-url, which sends full URLs to other sites', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => /Referrer-Policy/i.test(l) && /unsafe-url/i.test(l),
    bad: 'server {\n  add_header Referrer-Policy "unsafe-url";\n}\n', good: 'server {\n  add_header Referrer-Policy "no-referrer";\n}\n' },
  { id: 'permissions-policy-missing', title: 'The config sets no Permissions-Policy header (camera, microphone, geolocation)', files: HDR, when: WEBCFG, lacks: /Permissions-Policy|Feature-Policy/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header Permissions-Policy "camera=(), microphone=()";\n}\n' },
  { id: 'csp-unsafe-inline-script', title: 'The CSP script-src allows unsafe-inline', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => cspDirective(l, 'script-src') && /'unsafe-inline'/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "script-src \'self\' \'unsafe-inline\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "script-src \'self\'";\n}\n' },
  { id: 'csp-unsafe-eval', title: 'The CSP script-src allows unsafe-eval', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => cspDirective(l, 'script-src') && /'unsafe-eval'/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "script-src \'self\' \'unsafe-eval\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "script-src \'self\'";\n}\n' },
  { id: 'csp-object-src-not-none', title: 'The CSP does not set object-src to none', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => CSP_LINE.test(l) && !/object-src\s+'none'/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "default-src \'self\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "default-src \'self\'; object-src \'none\'";\n}\n' },
  { id: 'csp-base-uri-missing', title: 'The CSP has no base-uri directive', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => CSP_LINE.test(l) && !/base-uri/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "default-src \'self\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "default-src \'self\'; base-uri \'self\'";\n}\n' },
  { id: 'csp-wildcard-source', title: 'The CSP script-src or default-src uses a bare wildcard source', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => CSP_LINE.test(l) && /(script-src|default-src)[^;'"]*\s\*(?=[\s;'"]|$)/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "script-src * ";\n}\n', good: 'server {\n  add_header Content-Security-Policy "script-src \'self\'";\n}\n' },
  { id: 'csp-http-source', title: 'The CSP allows plain http: sources in script-src or default-src', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => CSP_LINE.test(l) && /(script-src|default-src)[^;'"]*\shttp:/.test(l),
    bad: 'server {\n  add_header Content-Security-Policy "default-src http: \'self\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "default-src https: \'self\'";\n}\n' },
  { id: 'csp-report-only-only', title: 'The only Content-Security-Policy is report-only, so nothing is blocked', files: HDR, when: WEBCFG, sample: 'nginx.conf',
    whole: (t) => /Content-Security-Policy-Report-Only/i.test(t) && !/Content-Security-Policy(?!-Report-Only)/i.test(t),
    bad: 'server {\n  add_header Content-Security-Policy-Report-Only "default-src \'self\'";\n}\n', good: 'server {\n  add_header Content-Security-Policy "default-src \'self\'";\n}\n' },
  { id: 'coop-missing', title: 'No Cross-Origin-Opener-Policy header (informational, isolates the window)', files: HDR, when: WEBCFG, lacks: /Cross-Origin-Opener-Policy/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header Cross-Origin-Opener-Policy "same-origin";\n}\n' },
  { id: 'coep-missing', title: 'No Cross-Origin-Embedder-Policy header (informational)', files: HDR, when: WEBCFG, lacks: /Cross-Origin-Embedder-Policy/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header Cross-Origin-Embedder-Policy "require-corp";\n}\n' },
  { id: 'corp-missing', title: 'No Cross-Origin-Resource-Policy header (informational)', files: HDR, when: WEBCFG, lacks: /Cross-Origin-Resource-Policy/i, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  add_header Cross-Origin-Resource-Policy "same-origin";\n}\n' },
  { id: 'nginx-server-tokens-on', title: 'nginx sends its version in the Server header (server_tokens is not off)', files: NGINX, when: WEBCFG, lacks: /server_tokens\s+off/, sample: 'nginx.conf',
    bad: 'server {\n  listen 80;\n}\n', good: 'server {\n  server_tokens off;\n}\n' },
  { id: 'express-x-powered-by-enabled', title: 'Express sends X-Powered-By (app.disable x-powered-by or helmet is missing)', files: /(^|\/)(server|app)\.(m?js|ts)$/, when: /express\(/, lacks: /disable\(\s*['"]x-powered-by|helmet\(/i, sample: 'app.js',
    bad: 'const app = express()\napp.listen(3000)\n', good: 'const app = express()\napp.disable(\'x-powered-by\')\n' },
  { id: 'nginx-autoindex-on', title: 'nginx autoindex is on, so folders list their own files', files: NGINX, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => /autoindex\s+on\b/.test(l),
    bad: 'server {\n  autoindex on;\n}\n', good: 'server {\n  autoindex off;\n}\n' },
  { id: 'apache-indexes-option', title: 'Apache Options enables Indexes, so folders list their own files', files: APACHE, sample: '.htaccess',
    test: (l) => /^\s*Options\b/.test(l) && /(^|\s)\+?Indexes\b/.test(l) && !/-Indexes/.test(l),
    bad: 'Options +Indexes\n', good: 'Options -Indexes\n' },
  { id: 'apache-trace-enabled', title: 'Apache TraceEnable is on, which allows the TRACE method', files: APACHE, sample: 'httpd.conf',
    test: (l) => /TraceEnable\s+on/i.test(l),
    bad: 'TraceEnable on\n', good: 'TraceEnable off\n' },
  { id: 'http-put-delete-allowed', title: 'PUT, DELETE or TRACE is listed as an allowed method', files: /(^|\/)(nginx[^\/]*\.conf|[^\/]*\.conf|\.htaccess|httpd[^\/]*|vercel\.json|netlify\.toml|wrangler\.toml|server\.(m?js|ts))$/i, when: WEBCFG, sample: 'nginx.conf',
    test: (l) => /(allowedMethods|allow_methods|methods|Allow)[^\n]*\b(PUT|DELETE|TRACE)\b/.test(l),
    bad: 'server {\n  add_header Allow "GET, PUT";\n}\n', good: 'server {\n  add_header Allow "GET, HEAD";\n}\n' },
  { id: 'tls-protocol-legacy', title: 'The TLS config allows SSLv2, SSLv3, TLSv1, TLSv1.0 or TLSv1.1', files: /(^|\/)(nginx[^\/]*\.conf|[^\/]*\.conf|\.htaccess|httpd[^\/]*|Caddyfile[^\/]*|server\.(m?js|ts)|wrangler\.toml)$/i, sample: 'nginx.conf',
    test: (l) => /ssl_protocols|SSLProtocol|protocols\s*[:=]/i.test(l) && /\b(SSLv2|SSLv3|TLSv1(?![\d._])|TLSv1\.[01]|TLSv1_[01])\b/.test(l),
    bad: 'ssl_protocols TLSv1 TLSv1.2;\n', good: 'ssl_protocols TLSv1.2 TLSv1.3;\n' },
  { id: 'tls-weak-cipher', title: 'The cipher list includes RC4, DES, 3DES, NULL, EXPORT or MD5', files: /(^|\/)(nginx[^\/]*\.conf|[^\/]*\.conf|\.htaccess|httpd[^\/]*|Caddyfile[^\/]*|server\.(m?js|ts))$/i, sample: 'nginx.conf',
    test: (l) => /ssl_ciphers|SSLCipherSuite|ciphers\s*[:=]/.test(l) && /(^|[^A-Z0-9_])(RC4|3?DES|NULL|EXPORT|MD5)(?![A-Z0-9_])/.test(l),
    bad: 'ssl_ciphers RC4:HIGH;\n', good: 'ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256;\n' },
  { id: 'nginx-prefer-server-ciphers-off', title: 'nginx ssl_prefer_server_ciphers is not on, so the client picks the cipher', files: NGINX, when: /ssl_protocols/, lacks: /ssl_prefer_server_ciphers\s+on/, sample: 'nginx.conf',
    bad: 'ssl_protocols TLSv1.2;\n', good: 'ssl_protocols TLSv1.2;\nssl_prefer_server_ciphers on;\n' },
  { id: 'nginx-http2-not-enabled', title: 'The TLS listener does not enable http2 (informational)', files: NGINX, when: /listen\s+443\s+ssl/, lacks: /listen\s[^;\n]*\bhttp2\b/, sample: 'nginx.conf',
    bad: 'listen 443 ssl;\n', good: 'listen 443 ssl http2;\n' },
  { id: 'tls-min-version-below-1-2', title: 'A TLS minimum version is set below TLS 1.2 in code or config', files: /\.(m?[jt]s|go|java|kt|py|ya?ml|conf|json|toml)$/i, sample: 'server.js',
    test: (l) => /minVersion|minimum_protocol|MinProtocol|min_version|MinVersion|setMinimumTLS|tls_min/i.test(l) && /(TLSv1(?![\d._])|TLSv1\.[01]\b|SSLv3|VersionTLS1[01]\b|TLS_VERSION_1_[01]|TLS1[01]\b)/.test(l),
    bad: 'const https = { minVersion: \'TLSv1.1\' }\n', good: 'const https = { minVersion: \'TLSv1.2\' }\n' },
  { id: 'cookie-samesite-none-no-secure', title: 'A cookie sets SameSite=None without the Secure flag', files: CODE, sample: 'server.js',
    whole: (t) => /sameSite\s*[:=]\s*['"]?none\b/i.test(t) && !/secure\s*:\s*true|;\s*Secure\b|secure\s*=\s*true/i.test(t),
    bad: 'res.cookie("sid", v, { sameSite: \'none\' })\n', good: 'res.cookie("sid", v, { sameSite: \'none\', secure: true, httpOnly: true })\n' },
  { id: 'session-cookie-no-httponly', title: 'A session cookie is set without HttpOnly', files: CODE, sample: 'server.js',
    whole: (t) => /(res\.cookie\(|setCookie\(|session_set_cookie_params\(|setcookie\(|express-session['"]?\s*\)?\s*\(|cookie-session['"]?\s*\)?\s*\(|session\(\s*\{|\.setHeader\(\s*['"]Set-Cookie)/i.test(t) && !/httpOnly\s*:\s*true|HttpOnly|httponly\s*=\s*true|httponly\s*:\s*true/i.test(t),
    bad: 'app.use(session({ secret: s }))\n// express-session\n', good: 'app.use(session({ secret: s, cookie: { httpOnly: true } }))\n// express-session\n' },
  { id: 'cors-credentials-with-wildcard', title: 'CORS allows credentials together with a wildcard origin', files: CODE, sample: 'server.js',
    whole: (t) => /Access-Control-Allow-Origin["'\s:=,]+\*/i.test(t) && /Allow-Credentials["'\s:=,]+true|credentials\s*:\s*true/i.test(t),
    bad: 'res.set("Access-Control-Allow-Origin", "*")\nres.set("Access-Control-Allow-Credentials", "true")\n', good: 'res.set("Access-Control-Allow-Origin", "https://example.com")\nres.set("Access-Control-Allow-Credentials", "true")\n' },
  { id: 'cors-reflects-request-origin', title: 'CORS copies the request Origin header straight into the response', files: CODE, sample: 'server.js',
    test: (l) => /origin\s*[:=]\s*(req|request)\.(headers\.origin|get\(\s*['"]origin['"]\s*\))/i.test(l) || /Allow-Origin["']?\s*[:,]\s*(req|request)\.headers\.origin/i.test(l),
    bad: 'res.setHeader("Access-Control-Allow-Origin", req.headers.origin)\n', good: 'res.setHeader("Access-Control-Allow-Origin", "https://example.com")\n' },
]

// ---------- wh-html: structural and security audits on page templates and markup ----------

const HTML_FILES = /\.(html?|jsx|tsx|vue|svelte|php|liquid|hbs|erb|ejs)$/i
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|<!--|#)/
const PRIVATE_IP = /(^|[^\d.])(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/

// Headings: a level may go down freely, but not skip upward by more than one (h1 then h3).
const headingJump = (t) => {
  const levels = [...t.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]))
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) return true
  return false
}
// Duplicate access keys on one page.
const accessKeyDup = (t) => {
  const keys = [...t.matchAll(/accesskey\s*=\s*["']([^"']{1,20})["']/gi)].map((m) => m[1].toLowerCase())
  return new Set(keys).size !== keys.length
}
// A headers="a b" cell reference to an id that is not on the page.
const tdHeadersUnknown = (t) => {
  const ids = new Set([...t.matchAll(/\sid\s*=\s*["']([^"']{1,80})["']/gi)].map((m) => m[1]))
  for (const m of t.matchAll(/\sheaders\s*=\s*["']([^"']{1,200})["']/gi)) {
    for (const id of m[1].split(/\s+/)) if (id && !ids.has(id)) return true
  }
  return false
}

export const HTML = [
  { id: 'session-id-in-url', title: 'A link or form puts a session id in its URL (sid, jsessionid, phpsessid)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /(href|action|src)\s*=\s*["'][^"']*[?&;](sid|jsessionid|phpsessid|sessionid)=/i.test(l),
    bad: '<a href="/cart?sid=8f3a">Cart</a>\n', good: '<a href="/cart">Cart</a>\n' },
  { id: 'sensitive-param-in-url', title: 'A link or form puts a token, key or password in the URL query', files: HTML_FILES, sample: 'index.html',
    test: (l) => /(href|action|src)\s*=\s*["'][^"'\s]*[?&](token|apikey|api_key|access_token|password|passwd|pwd|secret)=/i.test(l),
    bad: '<a href="/reset?token=abc123">Reset</a>\n', good: '<a href="/reset">Reset</a>\n' },
  { id: 'private-ip-literal', title: 'A private network IP address (10.x, 172.16-31.x, 192.168.x) is written into a page', files: HTML_FILES, sample: 'index.html', skipLine: COMMENT_LINE,
    test: (l) => PRIVATE_IP.test(l),
    bad: '<img src="http://192.168.1.20/logo.png">\n', good: '<img src="https://cdn.example.com/logo.png">\n' },
  { id: 'form-action-over-http', title: 'A form posts over plain http://', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<form\b[^>]*\baction\s*=\s*["']http:\/\//i.test(l),
    bad: '<form action="http://example.com/login" method="post"></form>\n', good: '<form action="https://example.com/login" method="post"></form>\n' },
  { id: 'password-input-no-autocomplete', title: 'A password input has no autocomplete attribute (set off, new-password or current-password)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<input\b(?=[^>]{0,2000}type\s*=\s*["']?password\b)(?![^>]{0,2000}autocomplete\s*=)[^>]{0,2000}>/i.test(l),
    bad: '<input type="password" name="pw">\n', good: '<input type="password" name="pw" autocomplete="current-password">\n' },
  { id: 'password-field-in-get-form', title: 'A password field sits inside a form that submits with GET (the password lands in the URL)', files: HTML_FILES, sample: 'index.html',
    whole: (t) => /<form\b[^>]*method\s*=\s*["']get["'][^>]*>[\s\S]{0,3000}?type\s*=\s*["']password["']/i.test(t),
    bad: '<form method="get"><input type="password" name="p"></form>\n', good: '<form method="post"><input type="password" name="p"></form>\n' },
  { id: 'password-name-without-type', title: 'An input named password has no type attribute, so it shows the password in clear', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<input\b(?![^>]{0,2000}\btype\s*=)[^>]{0,2000}\bname\s*=\s*["']password["']/i.test(l),
    bad: '<input name="password">\n', good: '<input type="password" name="password">\n' },
  { id: 'iframe-no-sandbox', title: 'An iframe has no sandbox attribute', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<iframe\b(?![^>]*\bsandbox\b)[^>]*>/i.test(l),
    bad: '<iframe src="https://example.com/widget"></iframe>\n', good: '<iframe src="https://example.com/widget" sandbox="allow-scripts"></iframe>\n' },
  { id: 'meta-refresh-to-other-site', title: 'A meta refresh sends the visitor to another site', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*url\s*=\s*["']?https?:\/\//i.test(l),
    bad: '<meta http-equiv="refresh" content="0; url=https://example.com/">\n', good: '<meta http-equiv="refresh" content="0; url=/home">\n' },
  { id: 'meta-set-cookie', title: 'A meta http-equiv set-cookie tries to set a cookie (browsers ignore it)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<meta\b[^>]*http-equiv\s*=\s*["']set-cookie/i.test(l),
    bad: '<meta http-equiv="set-cookie" content="sid=1">\n', good: '<meta charset="utf-8">\n' },
  { id: 'meta-security-header-ignored', title: 'A security header is written as a meta tag, where browsers ignore it (X-Frame-Options, HSTS, nosniff, Permissions-Policy)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<meta\b[^>]*http-equiv\s*=\s*["']?(X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security|Permissions-Policy)/i.test(l),
    bad: '<meta http-equiv="X-Frame-Options" content="DENY">\n', good: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n' },
  { id: 'td-headers-unknown-id', title: 'A table cell names a headers id that is not on the page', files: HTML_FILES, sample: 'index.html',
    whole: tdHeadersUnknown,
    bad: '<table><tr><td headers="nope">1</td></tr></table>\n', good: '<table><tr><th id="a">A</th></tr><tr><td headers="a">1</td></tr></table>\n' },
  { id: 'video-no-controls', title: 'A video element has no controls attribute', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<video\b(?![^>]*\bcontrols\b)[^>]*>/i.test(l),
    bad: '<video src="a.mp4"></video>\n', good: '<video src="a.mp4" controls></video>\n' },
  { id: 'audio-no-controls', title: 'An audio element has no controls attribute', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<audio\b(?![^>]*\bcontrols\b)[^>]*>/i.test(l),
    bad: '<audio src="a.mp3"></audio>\n', good: '<audio src="a.mp3" controls></audio>\n' },
  { id: 'media-autoplay-unmuted', title: 'Media autoplays without the muted attribute', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<(video|audio)\b(?![^>]*\bmuted\b)[^>]*\bautoplay\b/i.test(l),
    bad: '<video src="a.mp4" autoplay controls></video>\n', good: '<video src="a.mp4" autoplay muted controls></video>\n' },
  { id: 'accesskey-duplicated', title: 'Two elements on one page use the same accesskey', files: HTML_FILES, sample: 'index.html',
    whole: accessKeyDup,
    bad: '<a href="/a" accesskey="s">A</a><a href="/b" accesskey="s">B</a>\n', good: '<a href="/a" accesskey="s">A</a><a href="/b" accesskey="b">B</a>\n' },
  { id: 'marquee-or-blink', title: 'A marquee or blink element is used (obsolete, and it cannot be paused)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<(marquee|blink)(?![\w-])/i.test(l),
    bad: '<marquee>News</marquee>\n', good: '<p>News</p>\n' },
  { id: 'data-url-in-link-or-frame', title: 'A link, form or iframe loads a data: URL', files: HTML_FILES, sample: 'index.html',
    test: (l) => /(href|action)\s*=\s*["']\s*data:|<iframe\b[^>]*src\s*=\s*["']\s*data:/i.test(l),
    bad: '<iframe src="data:text/html,hi"></iframe>\n', good: '<iframe src="/hi.html" sandbox></iframe>\n' },
  { id: 'srcdoc-with-template-variables', title: 'An iframe srcdoc is built from template variables (injection risk)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /srcdoc\s*=\s*(["'][^"']*\{\{|\{)/i.test(l),
    bad: '<iframe srcdoc="{{ body }}" sandbox></iframe>\n', good: '<iframe srcdoc="<p>hi</p>" sandbox></iframe>\n' },
  { id: 'object-embed-applet', title: 'An object, embed or applet element is used (plugin content)', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<(object|embed|applet)\b/i.test(l),
    bad: '<embed src="a.swf">\n', good: '<img src="a.svg" alt="">\n' },
  { id: 'base-href-other-origin', title: 'The base href points at another site (every relative link leaves the site)', files: HTML_FILES, sample: 'index.html',
    whole: (t) => /<base\b[^>]*href\s*=\s*["']https?:\/\//i.test(t),
    bad: '<base href="https://evil.example/">\n', good: '<base href="/">\n' },
  { id: 'stylesheet-over-http', title: 'A stylesheet is loaded over plain http://', files: HTML_FILES, sample: 'index.html',
    test: (l) => /<link\b(?=[^>]*rel\s*=\s*["']?stylesheet)(?=[^>]*href\s*=\s*["']http:\/\/)[^>]*>/i.test(l),
    bad: '<link rel="stylesheet" href="http://example.com/a.css">\n', good: '<link rel="stylesheet" href="https://example.com/a.css">\n' },
  { id: 'multipart-form-no-csrf', title: 'A multipart form has no visible CSRF token field (informational)', files: HTML_FILES, sample: 'index.html',
    whole: (t) => /<form\b[^>]*enctype\s*=\s*["']multipart\/form-data/i.test(t) && !/csrf|xsrf|_token|authenticity_token|RequestVerificationToken/i.test(t),
    bad: '<form enctype="multipart/form-data" method="post"><input type="file" name="f"></form>\n', good: '<form enctype="multipart/form-data"><input name="csrf_token" type="hidden" value="x"></form>\n' },
  { id: 'sourcemap-shipped', title: 'A built script or stylesheet points at a source map (the source is readable)', files: /(^|\/)(dist|build|public|out|www)\/.*\.(m?js|css)$/i, sample: 'dist/app.js',
    test: (l) => /sourceMappingURL=/.test(l),
    bad: '//# sourceMappingURL=app.js.map\n', good: 'console.log(1)\n' },
  { id: 'comment-holds-secret-literal', title: 'A code or markup comment holds a password, secret or API key value', files: HTML_FILES, sample: 'index.html',
    test: (l) => /(<!--|\/\/|\/\*|#)[^\n]{0,200}?\b(password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\/+\-]{8,}/i.test(l),
    bad: '<!-- password: hunter2hunter2 -->\n', good: '<!-- password is set in the vault -->\n' },
  { id: 'todo-mentions-secret', title: 'A TODO or FIXME note mentions a secret, password or token', files: HTML_FILES, sample: 'index.html',
    test: (l) => /\b(TODO|FIXME)\b[^\n]{0,120}?\b(password|secret|token)\b/i.test(l),
    bad: '// TODO move the token out of the bundle\n', good: '// TODO tidy the header\n' },
]

// ---------- wh-publish-root: files that should never sit in a published (deployed) folder ----------

const PUBLIC_DIR = '(public|static|dist|build|out|www|htdocs|wwwroot)'
const SECRET_TEST = /(^|\/)(tests?|fixtures?|__tests__|examples?)\//i

export const PUBLISH = [
  { id: 'git-dir-in-publish', title: 'A nested .git folder (repository history) sits inside the project tree', path: /^(?!\.git\/)(.+\/)?\.git\/(config|HEAD|index)$/, sample: '', bad: 'dist/.git/config', good: '.git/config' },
  { id: 'svn-or-hg-dir', title: 'A Subversion or Mercurial metadata folder is in the tree', path: /(^|\/)\.(svn|hg)\//, bad: 'site/.svn/entries', good: 'site/index.html' },
  { id: 'env-file-present', title: 'A .env file with settings or secrets is in the tree (templates excluded)', path: /(^|\/)\.env(?!\.(example|sample|template|dist)$)(\.[^\/]+)?$/, bad: 'app/.env.production', good: 'app/.env.example' },
  { id: 'backup-file-present', title: 'A backup or editor leftover (.bak, .old, .orig, .swp, ~) is in the tree', path: /(\.(bak|old|orig|swp|backup)|~)$/, bad: 'public/index.html.bak', good: 'public/index.html' },
  { id: 'database-dump-in-public', title: 'A database dump or SQLite file is in a public folder', path: new RegExp(`(^|\\/)${PUBLIC_DIR}\\/.*\\.(sql|dump|sqlite3?|db|mdb)$`, 'i'), bad: 'public/backup.sql', good: 'db/schema.sql' },
  { id: 'private-key-file', title: 'A private key file (id_rsa, .pem, .key, .p12, .pfx) is in the tree', path: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(pem|key|p12|pfx|ppk)$/i, notIn: new RegExp(`${SECRET_TEST.source}|pub(lic)?[-_.]?key|[-_.]pub(lic)?\\.|(^|/)[^/]*public[^/]*$`, 'i'), bad: 'certs/server.key', good: 'certs/readme.md' },
  { id: 'manifest-in-deployed-folder', title: 'A package.json, lockfile, composer file or Dockerfile is inside a deployed folder', path: new RegExp(`(^|\\/)${PUBLIC_DIR}\\/(package(-lock)?\\.json|composer\\.(json|lock)|Dockerfile[^\\/]*|docker-compose[^\\/]*\\.ya?ml)$`, 'i'), bad: 'dist/package.json', good: 'package.json' },
  { id: 'desktop-metadata-file', title: 'A .DS_Store or Thumbs.db metadata file is in the tree', path: /(^|\/)(\.DS_Store|Thumbs\.db)$/, bad: 'site/.DS_Store', good: 'site/index.html' },
  { id: 'web-inf-folder', title: 'A WEB-INF folder is in the tree (Java app configuration)', path: /(^|\/)WEB-INF\//i, bad: 'public/WEB-INF/web.xml', good: 'src/web.xml.md' },
  { id: 'phpinfo-or-test-page', title: 'A phpinfo, info, test or pinfo PHP page is in the tree', path: /(^|\/)(phpinfo|info|test|pinfo)\.php$/i, bad: 'public/phpinfo.php', good: 'public/index.php' },
  { id: 'admin-tool-in-tree', title: 'An Adminer or phpMyAdmin admin tool is in the tree', path: /(^|\/)(adminer[^\/]*\.php|phpmyadmin\/|pma\/)/i, bad: 'public/adminer.php', good: 'public/about.php' },
  { id: 'htpasswd-file', title: 'A .htpasswd file (password hashes) is in the tree', path: /(^|\/)\.htpasswd$/, bad: 'site/.htpasswd', good: 'site/.htaccess.md' },
  { id: 'netlify-publish-is-repo-root', title: 'netlify.toml publishes the whole repository root (publish = ".")', files: /(^|\/)netlify\.toml$/i, re: /^\s*publish\s*=\s*["']\.\/?["']/, sample: 'netlify.toml', bad: 'publish = "."', good: 'publish = "dist"' },
  { id: 'vercel-output-is-repo-root', title: 'vercel.json serves the whole repository root as its output', files: /(^|\/)vercel\.json$/i, re: /"outputDirectory"\s*:\s*"\.\/?"/, sample: 'vercel.json', bad: '{ "outputDirectory": "." }', good: '{ "outputDirectory": "dist" }' },
  { id: 'firebase-public-is-repo-root', title: 'firebase.json hosts the whole repository root (public = ".")', files: /(^|\/)firebase\.json$/i, re: /"public"\s*:\s*"\.\/?"/, sample: 'firebase.json', bad: '{ "hosting": { "public": "." } }', good: '{ "hosting": { "public": "dist" } }' },
  { id: 'wrangler-assets-is-repo-root', title: 'wrangler.toml serves the whole repository root as its assets', files: /(^|\/)wrangler\.toml$/i, re: /directory\s*=\s*["']\.\/?["']/, sample: 'wrangler.toml', bad: 'directory = "."', good: 'directory = "./dist"' },
  { id: 'apache-server-status-open', title: 'Apache server-status is handled by the server (exposes live request data)', files: APACHE, sample: 'httpd.conf', re: /SetHandler\s+server-status/, bad: 'SetHandler server-status', good: 'SetHandler default-handler' },
  { id: 'nginx-stub-status-open', title: 'nginx stub_status is enabled (exposes live connection counts)', files: NGINX, sample: 'nginx.conf', re: /stub_status/, bad: 'location /status { stub_status; }', good: 'location /health { return 200; }' },
  { id: 'stack-trace-to-client-js', title: 'An error stack (err.stack) is sent back to the client', files: /\.(m?[jt]sx?|cjs)$/i, sample: 'server.js', re: /\b(?:res|resp|response|reply|ctx|c|ws|socket)\b[^\n;]{0,60}\.(send|json|end|write)\([^\n]*\.stack\b/, bad: 'res.status(500).send(err.stack)', good: 'res.status(500).send("error")' },
  { id: 'stack-trace-to-client-php', title: 'A PHP exception trace is echoed to the page', files: /\.php$/i, sample: 'index.php', re: /(echo|print|print_r|var_dump)[^\n]*(getTraceAsString|getTrace\(\))/, bad: 'echo $e->getTraceAsString();', good: 'error_log($e->getTraceAsString());' },
  { id: 'stack-trace-to-client-py', title: 'A Python traceback is returned in the HTTP response', files: /\.py$/i, sample: 'app.py', re: /(HttpResponse|Response|return)[^\n]*(format_exc|print_exc)/, bad: 'return Response(traceback.format_exc(), 500)', good: 'log.exception("fail")' },
]

// ---------- wh-supply: vendored libraries, lockfile and manifest hygiene, SBOM readiness ----------

const jparse = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}
// Entries of a package-lock.json (v2/v3 "packages" map, or the v1 "dependencies" map). Root entry "" is skipped.
const lockEntries = (t) => {
  const j = jparse(t)
  if (!j) return []
  if (j.packages && typeof j.packages === 'object') return Object.entries(j.packages).filter(([k]) => k !== '')
  if (j.dependencies && typeof j.dependencies === 'object') return Object.entries(j.dependencies).map(([k, v]) => [`node_modules/${k}`, v])
  return []
}
const lockEntriesOrNone = (t) => lockEntries(t)
const pkgJson = (t) => {
  const j = jparse(t)
  return j && typeof j === 'object' && !Array.isArray(j) ? j : null
}
const allDeps = (j) => ({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}), ...(j.optionalDependencies ?? {}), ...(j.peerDependencies ?? {}) })
const JQUERY_BANNER = /jQuery(?: JavaScript Library)?\s+v(\d+)\.(\d+)\.(\d+)/
const ANY_VERSION = /(v|version\D{0,3})\d+\.\d+\.\d+/i
const KNOWN_LIB = /(^|\/)(vendor|vendors|static|public|lib|libs|assets)\/.*(jquery|lodash|bootstrap|angular|moment|handlebars|underscore|dompurify|react|vue|chart|d3|axios|marked|highlight|ckeditor|tinymce|swiper)[^\/]*\.js$/i

export const SUPPLY = [
  // Source: https://blog.jquery.com/2020/04/10/jquery-3-5-0-released/ (htmlPrefilter XSS; 3.4.1 and earlier affected, fixed in 3.5.0)
  { id: 'vendored-jquery-below-3-5', title: 'A vendored jQuery copy is older than 3.5.0 (htmlPrefilter XSS, fixed in 3.5.0)', files: /(^|\/)(vendor|vendors|static|public|lib|libs|assets|www|dist)\/.*jquery[^\/]*\.js$/i, sample: 'public/jquery.min.js',
    whole: (t) => { const m = JQUERY_BANNER.exec(t.slice(0, 2000)); return !!m && (Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 5)) },
    bad: '/*! jQuery v3.4.1 | (c) JS Foundation */\n', good: '/*! jQuery v3.5.1 | (c) JS Foundation */\n' },
  { id: 'vendored-library-no-version', title: 'A vendored library file has no version banner, so its version cannot be checked', files: KNOWN_LIB, sample: 'vendor/lodash.min.js',
    whole: (t) => !ANY_VERSION.test(t.slice(0, 1200)),
    bad: 'function f(){}\n', good: '/*! lodash v4.17.21 */\n' },
  { id: 'lockfile-entry-no-integrity', title: 'A package-lock entry has a resolved URL but no integrity hash', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json',
    whole: (t) => lockEntriesOrNone(t).some(([k, v]) => k && v && typeof v.resolved === 'string' && !v.integrity),
    bad: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","resolved":"https://registry.npmjs.org/a/-/a-1.0.0.tgz"}}}', good: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","resolved":"https://registry.npmjs.org/a/-/a-1.0.0.tgz","integrity":"sha512-x"}}}' },
  { id: 'lockfile-entry-no-version', title: 'A package-lock entry has no version (needed for an SBOM)', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json',
    whole: (t) => lockEntriesOrNone(t).some(([k, v]) => k && v && !v.link && !v.version),
    bad: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"resolved":"https://registry.npmjs.org/a/-/a.tgz","integrity":"x"}}}', good: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","resolved":"https://registry.npmjs.org/a/-/a.tgz","integrity":"x"}}}' },
  { id: 'lockfile-entry-no-resolved', title: 'A package-lock entry has no resolved URL (its origin cannot be recorded in an SBOM)', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json',
    whole: (t) => lockEntriesOrNone(t).some(([k, v]) => k && v && !v.link && !v.resolved && !v.inBundle),
    bad: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","integrity":"x"}}}', good: '{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{"version":"1.0.0","resolved":"https://registry.npmjs.org/a/-/a.tgz","integrity":"x"}}}' },
  { id: 'lockfile-resolved-over-http', title: 'A lockfile fetches a package over plain http://', files: /(^|\/)(package-lock\.json|yarn\.lock)$/, sample: 'package-lock.json', re: /("resolved"\s*:\s*"|resolved\s+"?)http:\/\//,
    bad: '"resolved": "http://packages.example/a.tgz"', good: '"resolved": "https://registry.npmjs.org/a.tgz"' },
  { id: 'lockfile-git-dependency-unpinned', title: 'A lockfile fetches a git dependency with no commit pin (no #commit)', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json', re: /"resolved"\s*:\s*"git\+?[^"#]*"/,
    bad: '"resolved": "git+ssh://git@example.com/x.git"', good: '"resolved": "git+ssh://git@example.com/x.git#3f2a9c1"' },
  { id: 'lockfile-duplicate-versions-over-budget', title: 'The lockfile holds more than 25 packages with two or more versions (duplicate-version budget)', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json',
    whole: (t) => {
      const seen = new Map()
      for (const [k] of lockEntriesOrNone(t)) {
        const name = k.split('node_modules/').pop()
        const vs = seen.get(name) ?? new Set()
        vs.add(k)
        seen.set(name, vs)
      }
      let dup = 0
      for (const set of seen.values()) if (set.size > 1) dup++
      return dup > 25
    },
    bad: JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [[`node_modules/p${i}`, { version: '1.0.0' }], [`node_modules/q/node_modules/p${i}`, { version: '2.0.0' }]]).flat()) }), good: '{"lockfileVersion":3,"packages":{"":{}}}' },
  { id: 'lockfile-deprecated-entry', title: 'A lockfile entry carries a deprecated marker (the package is no longer maintained)', files: /(^|\/)package-lock\.json$/, sample: 'package-lock.json',
    whole: (t) => lockEntriesOrNone(t).some(([, v]) => v && typeof v === 'object' && 'deprecated' in v),
    bad: '{"packages":{"node_modules/a":{"version":"1.0.0","deprecated":"use b"}}}', good: '{"packages":{"node_modules/a":{"version":"1.0.0"}}}' },
  { id: 'package-git-or-tarball-dependency', title: 'A published package depends on a git, tarball, file or http URL instead of a registry version', files: /(^|\/)package\.json$/, sample: 'package.json',
    whole: (t) => { const j = pkgJson(t); return !!j && !j.private && Object.values(allDeps(j)).some((v) => typeof v === 'string' && /^(git\+|git:|github:|https?:|file:|bitbucket:|gitlab:)/.test(v)) },
    bad: '{"name":"a","version":"1.0.0","dependencies":{"b":"github:x/b"}}', good: '{"name":"a","version":"1.0.0","dependencies":{"b":"^1.0.0"}}' },
  { id: 'package-wildcard-dependency', title: 'A dependency range is * or latest (any future version is accepted)', files: /(^|\/)package\.json$/, sample: 'package.json',
    whole: (t) => { const j = pkgJson(t); return !!j && Object.values(allDeps(j)).some((v) => v === '*' || v === 'latest' || v === '') },
    bad: '{"name":"a","dependencies":{"b":"*"}}', good: '{"name":"a","dependencies":{"b":"^1.2.0"}}' },
  { id: 'package-repository-missing', title: 'A published package has no repository field (provenance cannot be traced)', files: /(^|\/)package\.json$/, sample: 'package.json',
    whole: (t) => { const j = pkgJson(t); return !!j && !j.private && !j.repository },
    bad: '{"name":"a","version":"1.0.0"}', good: '{"name":"a","version":"1.0.0","repository":"https://example.com/a.git"}' },
  { id: 'package-license-missing', title: 'A published package has no license field', files: /(^|\/)package\.json$/, sample: 'package.json',
    whole: (t) => { const j = pkgJson(t); return !!j && !j.private && !j.license },
    bad: '{"name":"a","version":"1.0.0"}', good: '{"name":"a","version":"1.0.0","license":"MIT"}' },
  { id: 'npmrc-registry-over-http', title: 'An .npmrc points the registry at plain http://', files: /(^|\/)\.npmrc$/, sample: '.npmrc', re: /^\s*registry\s*=\s*http:\/\//i,
    bad: 'registry=http://packages.example/', good: 'registry=https://registry.npmjs.org/' },
  { id: 'npmrc-scope-registry-other-host', title: 'An .npmrc sends a scope to a registry other than the default npm registry', files: /(^|\/)\.npmrc$/, sample: '.npmrc', re: /^@[^:\s]+:registry\s*=\s*https?:\/\/(?!registry\.npmjs\.org)/i,
    bad: '@acme:registry=https://packages.example/', good: '@acme:registry=https://registry.npmjs.org/' },
  { id: 'release-workflow-no-sbom', title: 'A release workflow publishes an artifact with no SBOM step (CycloneDX, Syft or SPDX)', files: /(^|\/)\.github\/workflows\/[^\/]+\.ya?ml$/i, sample: '.github/workflows/release.yml',
    whole: (t) => /(npm publish|docker push|gh release create)/.test(t) && !/cyclonedx|syft|sbom|spdx/i.test(t),
    bad: 'run: npm publish\n', good: 'run: npm publish\nrun: npx @cyclonedx/cyclonedx-npm --output-file sbom.json\n' },
]
