// False-alarm traps, part 2: Python, Go, Java, C#, PHP, Ruby, the JavaScript code-pattern rules, and repo-level files. Same rules as part 1:
// every project ends in -clean, every file is safe code that resembles a defect. Traps are added to the TRAPS list that part 1 exports
// (part 1 runs first and clears it, so the verifier reads TRAPS after calling both projects() functions).

import { TRAPS, group } from './accuracy-extra-trap-web-1.mjs'

export function projects(ctx) {
  const out = {}
  const g = (name, traps, per) => group(ctx, out, name, traps, per)

  g('cp-python', [
    ['app/git_status.py', 'cp-python', "import subprocess\n\ndef status():\n    return subprocess.run(['git', 'status', '--short'], check=True, capture_output=True, text=True).stdout"],
    ['app/ls_shell.py', 'cp-python', "import subprocess\n\ndef listing():\n    return subprocess.run('ls -l', shell=True, check=True, capture_output=True, text=True).stdout"],
    ['app/literal_eval.py', 'cp-python', "import ast\n\ndef parse(text):\n    return ast.literal_eval(text)"],
    ['app/sql_alchemy.py', 'cp-python', "from sqlalchemy import select\n\ndef newest(session, model):\n    return session.execute(select(model).order_by(model.id.desc()).limit(10)).scalars().all()"],
    ['app/http_timeout.py', 'cp-python', "import requests\n\ndef health(url):\n    return requests.get(url, timeout=(3, 10)).ok"],
    ['app/bind_all.py', 'cp-python', "# Runs in a container behind the platform proxy; the container network is private.\ndef serve(app):\n    app.run(host='0.0.0.0', port=8080)"],
    ['app/jinja_text.py', 'cp-python', "from jinja2 import Environment\n\n# Plain-text emails: there is no HTML to escape.\nenv = Environment(autoescape=False, loader=None)"],
    ['app/mark_safe_const.py', 'cp-python', "from django.utils.safestring import mark_safe\n\nREQUIRED = mark_safe('<abbr title=\"required\">*</abbr>')"],
    ['app/webhook_view.py', 'cp-python', "import hmac\nfrom django.views.decorators.csrf import csrf_exempt\n\n@csrf_exempt\ndef webhook(request):\n    expected = hmac.new(KEY, request.body, 'sha256').hexdigest()\n    if not hmac.compare_digest(expected, request.headers.get('X-Signature', '')):\n        return HttpResponse(status=401)\n    return HttpResponse(status=204)"],
    ['app/tmp_doc.py', 'cp-python', "\"\"\"Cache lives under '/tmp/meerkat' only in CI; locally it uses the user cache folder.\"\"\"\nimport tempfile\n\ndef cache_dir():\n    return tempfile.mkdtemp(prefix='meerkat-')"],
    ['app/zip_extract.py', 'cp-python', "import zipfile\n\ndef unpack(path, dest):\n    with zipfile.ZipFile(path) as z:\n        z.extractall(dest)  # ZipFile drops absolute and .. member names itself"],
    ['app/tar_filter.py', 'cp-python', "import tarfile\n\ndef unpack(path, dest):\n    with tarfile.open(path) as t:\n        t.extractall(dest, filter='data')"],
    ['app/defused.py', 'cp-python', "from defusedxml import minidom\n\ndef parse(path):\n    return minidom.parse(path)"],
    ['app/shelve_own.py', 'cp-python', "import shelve\n\ndef open_cache(path):\n    # path is a file this program created under its own cache folder\n    return shelve.open(path)"],
    ['app/torch_safe.py', 'cp-python', "import torch\n\ndef load(path):\n    return torch.load(path, weights_only=True)"],
    ['app/password_env.py', 'cp-python', "import os\n\nDB_PASSWORD = os.environ['DB_PASSWORD']"],
    ['app/chmod_ok.py', 'cp-python', "import os\n\ndef private_dir(path):\n    os.makedirs(path, mode=0o700, exist_ok=True)"],
    ['app/ssl_default.py', 'cp-python', "import ssl\n\nctx = ssl.create_default_context()"],
    ['app/raw_param.py', 'cp-python', "def fetch(conn, uid):\n    cur = conn.cursor()\n    cur.execute('SELECT id, name FROM users WHERE id = %s', (uid,))\n    return cur.fetchone()"],
    ['app/ssh_known.py', 'cp-python', "import paramiko\n\ndef connect(host):\n    c = paramiko.SSHClient()\n    c.load_system_host_keys()\n    c.connect(host)\n    return c"],
  ])

  g('cp-go', [
    ['cmd/get_config.go', 'cp-go', "package fetch\n\nimport (\n\t\"net/http\"\n\n\t\"example.com/shop/config\"\n)\n\nfunc Ping() (*http.Response, error) {\n\treturn http.Get(config.UpstreamURL)\n}"],
    ['cmd/git_cmd.go', 'cp-go', "package gitx\n\nimport \"os/exec\"\n\nfunc Status() ([]byte, error) {\n\treturn exec.Command(\"git\", \"status\", \"--short\").Output()\n}"],
    ['cmd/const_bin.go', 'cp-go', "package gitx\n\nimport \"os/exec\"\n\nconst gitBin = \"git\"\n\nfunc Version() ([]byte, error) {\n\treturn exec.Command(gitBin, \"--version\").Output()\n}"],
    ['cmd/sh_const.go', 'cp-go', "package sys\n\nimport \"os/exec\"\n\nfunc Clear() error {\n\treturn exec.Command(\"sh\", \"-c\", \"clear\").Run()\n}"],
    ['cmd/server_timeouts.go', 'cp-go', "package srv\n\nimport (\n\t\"net/http\"\n\t\"time\"\n)\n\nfunc New(mux http.Handler) *http.Server {\n\treturn &http.Server{Addr: \":8080\", Handler: mux, ReadHeaderTimeout: 5 * time.Second}\n}"],
    ['cmd/listen_default.go', 'cp-go', "package srv\n\nimport \"net/http\"\n\nfunc Run(mux http.Handler) error {\n\treturn http.ListenAndServe(\"127.0.0.1:8080\", mux)\n}"],
    ['cmd/sql_cols.go', 'cp-go', "package store\n\nimport (\n\t\"database/sql\"\n\t\"fmt\"\n)\n\nconst cols = \"id, name, email\"\n\nfunc One(db *sql.DB, id int) *sql.Row {\n\treturn db.QueryRow(fmt.Sprintf(\"SELECT %s FROM users WHERE id = $1\", cols), id)\n}"],
    ['cmd/sql_param.go', 'cp-go', "package store\n\nimport \"database/sql\"\n\nfunc One(db *sql.DB, id int) *sql.Row {\n\treturn db.QueryRow(\"SELECT id, name FROM users WHERE id = $1\", id)\n}"],
    ['cmd/jitter.go', 'cp-go', "package retry\n\nimport (\n\t\"math/rand\"\n\t\"time\"\n)\n\n// Backoff jitter only; secrets use crypto/rand elsewhere.\nfunc Jitter() time.Duration {\n\treturn time.Duration(rand.Intn(250)) * time.Millisecond\n}"],
    ['cmd/etag.go', 'cp-go', "package web\n\nimport (\n\t\"crypto/md5\"\n\t\"fmt\"\n)\n\n// ETag fingerprint of a response body, not a security control.\nfunc ETag(b []byte) string {\n\treturn fmt.Sprintf(\"%x\", md5.Sum(b))\n}"],
    ['cmd/cookie_multi.go', 'cp-go', "package web\n\nimport \"net/http\"\n\nfunc Session(v string) *http.Cookie {\n\treturn &http.Cookie{\n\t\tName:     \"sid\",\n\t\tValue:    v,\n\t\tSecure:   true,\n\t\tHttpOnly: true,\n\t\tSameSite: http.SameSiteLaxMode,\n\t}\n}"],
    ['cmd/html_const.go', 'cp-go', "package web\n\nimport \"html/template\"\n\nvar Break = template.HTML(\"<br>\")"],
    ['cmd/open_base.go', 'cp-go', "package files\n\nimport (\n\t\"net/http\"\n\t\"os\"\n\t\"path/filepath\"\n)\n\nfunc Open(dir string, r *http.Request) (*os.File, error) {\n\treturn os.Open(filepath.Join(dir, filepath.Base(r.FormValue(\"f\"))))\n}"],
    ['cmd/unzip.go', 'cp-go', "package files\n\nimport (\n\t\"archive/zip\"\n\t\"errors\"\n\t\"path/filepath\"\n\t\"strings\"\n)\n\nfunc Target(dest string, f *zip.File) (string, error) {\n\tp := filepath.Join(dest, f.Name)\n\tif !strings.HasPrefix(p, filepath.Clean(dest)+string(filepath.Separator)) {\n\t\treturn \"\", errors.New(\"entry escapes folder\")\n\t}\n\treturn p, nil\n}"],
    ['cmd/pprof_admin.go', 'cp-go', "package admin\n\nimport (\n\t\"net/http\"\n\t_ \"net/http/pprof\"\n)\n\n// Bound to loopback on the admin port only.\nfunc Serve() error {\n\treturn http.ListenAndServe(\"127.0.0.1:6060\", nil)\n}"],
    ['cmd/rsa_big.go', 'cp-go', "package keys\n\nimport (\n\t\"crypto/rand\"\n\t\"crypto/rsa\"\n)\n\nfunc New() (*rsa.PrivateKey, error) {\n\treturn rsa.GenerateKey(rand.Reader, 4096)\n}"],
    ['cmd/tls12.go', 'cp-go', "package srv\n\nimport \"crypto/tls\"\n\nvar Config = &tls.Config{MinVersion: tls.VersionTLS12}"],
    ['cmd/cors_list.go', 'cp-go', "package web\n\nimport \"github.com/rs/cors\"\n\nvar Policy = cors.Options{AllowedOrigins: []string{\"https://app.harbourside.dev\"}}"],
    ['cmd/gz_limit.go', 'cp-go', "package files\n\nimport (\n\t\"compress/gzip\"\n\t\"io\"\n)\n\nfunc Copy(dst io.Writer, gz *gzip.Reader) (int64, error) {\n\treturn io.Copy(dst, io.LimitReader(gz, 10<<20))\n}"],
  ])

  g('cp-java', [
    ['src/main/java/shop/GitCmd.java', 'cp-java', "package shop;\n\npublic class GitCmd {\n    private static final String GIT = \"git\";\n    public static Process status() throws java.io.IOException {\n        return new ProcessBuilder(GIT, \"status\", \"--short\").start();\n    }\n}"],
    ['src/main/java/shop/Digests.java', 'cp-java', "package shop;\n\nimport java.security.MessageDigest;\n\npublic class Digests {\n    // Cache fingerprint, not a password hash.\n    public static MessageDigest etag() throws Exception {\n        return MessageDigest.getInstance(\"MD5\");\n    }\n    public static MessageDigest strong() throws Exception {\n        return MessageDigest.getInstance(\"SHA-256\");\n    }\n}"],
    ['src/main/java/shop/Gcm.java', 'cp-java', "package shop;\n\nimport javax.crypto.Cipher;\n\npublic class Gcm {\n    // GCM is a stream-style mode: NoPadding is correct here.\n    public static Cipher cipher() throws Exception {\n        return Cipher.getInstance(\"AES/GCM/NoPadding\");\n    }\n}"],
    ['src/main/java/shop/Jitter.java', 'cp-java', "package shop;\n\npublic class Jitter {\n    public static long retryDelayMs(int attempt) {\n        return 500L * attempt + (long) (Math.random() * 100);\n    }\n}"],
    ['src/main/java/shop/Table.java', 'cp-java', "package shop;\n\nimport java.sql.*;\n\npublic class Table {\n    private static final String TABLE = \"orders\";\n    public static ResultSet all(Statement st) throws SQLException {\n        return st.executeQuery(\"SELECT id FROM \" + TABLE);\n    }\n}"],
    ['src/main/java/shop/Prepared.java', 'cp-java', "package shop;\n\nimport java.sql.*;\n\npublic class Prepared {\n    public static ResultSet byId(Connection c, long id) throws SQLException {\n        PreparedStatement ps = c.prepareStatement(\"SELECT id, name FROM users WHERE id = ?\");\n        ps.setLong(1, id);\n        return ps.executeQuery();\n    }\n}"],
    ['src/main/java/shop/Cors.java', 'cp-java', "package shop;\n\nimport org.springframework.web.bind.annotation.CrossOrigin;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\n@CrossOrigin(origins = \"https://app.harbourside.dev\")\npublic class Cors {\n}"],
    ['src/main/java/shop/Cookies.java', 'cp-java', "package shop;\n\nimport javax.servlet.http.Cookie;\n\npublic class Cookies {\n    public static Cookie session(String v) {\n        Cookie c = new Cookie(\"sid\", v);\n        c.setSecure(true);\n        c.setHttpOnly(true);\n        return c;\n    }\n}"],
    ['src/main/java/shop/Jndi.java', 'cp-java', "package shop;\n\nimport javax.naming.Context;\n\npublic class Jndi {\n    private static final String DS = \"java:comp/env/jdbc/Main\";\n    public static Object ds(Context ctx) throws Exception {\n        return ctx.lookup(DS);\n    }\n}"],
    ['src/main/java/shop/Spel.java', 'cp-java', "package shop;\n\nimport org.springframework.expression.spel.standard.SpelExpressionParser;\n\npublic class Spel {\n    private static final String RULE = \"#order.total > 100\";\n    public static Object compile(SpelExpressionParser parser) {\n        return parser.parseExpression(RULE);\n    }\n}"],
    ['src/main/java/shop/Xml.java', 'cp-java', "package shop;\n\nimport javax.xml.parsers.DocumentBuilderFactory;\n\npublic class Xml {\n    public static DocumentBuilderFactory factory() throws Exception {\n        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();\n        f.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true);\n        f.setExpandEntityReferences(false);\n        return f;\n    }\n}"],
    ['src/main/java/shop/Ldap.java', 'cp-java', "package shop;\n\npublic class Ldap {\n    public static String filter(String name) {\n        String escaped = name.replaceAll(\"[\\\\\\\\*()\\\\u0000]\", \"\");\n        return \"(uid=\" + escaped + \")\";\n    }\n}"],
    ['src/main/java/shop/Tls.java', 'cp-java', "package shop;\n\nimport javax.net.ssl.SSLContext;\n\npublic class Tls {\n    public static SSLContext ctx() throws Exception {\n        return SSLContext.getInstance(\"TLSv1.3\");\n    }\n}"],
    ['src/main/java/shop/Name.java', 'cp-java', "package shop;\n\nimport java.io.File;\nimport java.nio.file.Paths;\nimport javax.servlet.http.HttpServletRequest;\n\npublic class Name {\n    public static File upload(HttpServletRequest request) {\n        String leaf = Paths.get(request.getParameter(\"f\")).getFileName().toString();\n        return new File(\"/srv/uploads\", leaf);\n    }\n}"],
    ['src/main/java/shop/Shuffle.java', 'cp-java', "package shop;\n\nimport java.util.*;\n\npublic class Shuffle {\n    public static void demo(List<String> items) {\n        Collections.shuffle(items, new Random(42));\n    }\n}"],
    ['src/main/java/shop/Exec.java', 'cp-java', "package shop;\n\npublic class Exec {\n    public static Process version() throws java.io.IOException {\n        return Runtime.getRuntime().exec(new String[] {\"git\", \"--version\"});\n    }\n}"],
  ])

  g('cp-dotnet', [
    ['src/Etag.cs', 'cp-dotnet-php-ruby', "using System.Security.Cryptography;\n\npublic static class Etag\n{\n    // Content fingerprint for caching, not a password hash.\n    public static byte[] Of(byte[] body) { using var h = MD5.Create(); return h.ComputeHash(body); }\n}"],
    ['src/Process.cs', 'cp-dotnet-php-ruby', "using System.Diagnostics;\n\npublic static class Git\n{\n    public static Process Status() => Process.Start(new ProcessStartInfo(\"git\", \"status --short\") { UseShellExecute = false });\n}"],
    ['src/TableName.cs', 'cp-dotnet-php-ruby', "public static class Q\n{\n    private const string Table = \"orders\";\n    public static string CountSql() => \"SELECT COUNT(*) FROM \" + Table;\n}"],
    ['src/Csrf.cs', 'cp-dotnet-php-ruby', "using Microsoft.AspNetCore.Http;\n\npublic static class Csrf\n{\n    // Angular reads this cookie and echoes it in a header, so it must not be HttpOnly.\n    public static CookieOptions Options => new CookieOptions { HttpOnly = false, Secure = true, SameSite = SameSiteMode.Strict };\n}"],
    ['src/ApiController.cs', 'cp-dotnet-php-ruby', "using Microsoft.AspNetCore.Mvc;\n\n// Bearer-token JSON API: no cookie authentication, so there is no forgery to guard against.\n[IgnoreAntiforgeryToken]\n[ApiController]\npublic class OrdersController : ControllerBase { }"],
    ['src/Jwt.cs', 'cp-dotnet-php-ruby', "using Microsoft.IdentityModel.Tokens;\n\npublic static class Jwt\n{\n    public static TokenValidationParameters Params(SecurityKey key) => new TokenValidationParameters { ValidateLifetime = true, ValidateAudience = true, ValidateIssuer = true, IssuerSigningKey = key };\n}"],
    ['src/Raw.cshtml', 'cp-dotnet-php-ruby', "@Html.Raw(Constants.AnalyticsSnippet)"],
    ['web/assert.php', 'cp-dotnet-php-ruby', "<?php\nfunction total(array $items): int {\n    $sum = array_sum($items);\n    assert($sum >= 0);\n    return $sum;\n}"],
    ['web/autoload.php', 'cp-dotnet-php-ruby', "<?php\n$autoload = __DIR__ . '/vendor/autoload.php';\nrequire_once $autoload;"],
    ['web/cache.php', 'cp-dotnet-php-ruby', "<?php\nfunction readCache(string $path) {\n    $cached = file_get_contents($path);\n    return unserialize($cached, ['allowed_classes' => false]);\n}"],
    ['web/bucket.php', 'cp-dotnet-php-ruby', "<?php\n// Picks a cache bucket; not a secret.\n$cacheKey = mt_rand(0, 9);"],
    ['web/version.php', 'cp-dotnet-php-ruby', "<?php\n$rev = shell_exec('git rev-parse --short HEAD');"],
    ['web/pdo.php', 'cp-dotnet-php-ruby', "<?php\nfunction byId(PDO $pdo, int $id) {\n    $stmt = $pdo->prepare('SELECT id, name FROM users WHERE id = :id');\n    $stmt->execute(['id' => $id]);\n    return $stmt->fetch();\n}"],
    ['web/curl.php', 'cp-dotnet-php-ruby', "<?php\n$c = curl_init('https://api.harbourside.dev/v1');\ncurl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);\ncurl_setopt($c, CURLOPT_SSL_VERIFYHOST, 2);"],
    ['web/errors.php', 'cp-dotnet-php-ruby', "<?php\nini_set('display_errors', '0');\nerror_reporting(E_ALL);"],
    ['app/cache_load.rb', 'cp-dotnet-php-ruby', "# The cache file is written by this application only.\nCACHE = Marshal.load(File.binread(File.join(__dir__, 'tmp', 'cache.bin')))"],
    ['app/etag.rb', 'cp-dotnet-php-ruby', "require 'digest'\n\n# Fingerprint for HTTP caching.\ndef etag(body) = Digest::MD5.hexdigest(body)"],
    ['app/shell_escape.rb', 'cp-dotnet-php-ruby', "require 'shellwords'\n\ndef open_folder(name)\n  system(\"ls #{Shellwords.escape(name)}\")\nend"],
    ['app/html_i18n.rb', 'cp-dotnet-php-ruby', "def required_mark\n  I18n.t('forms.required_html').html_safe\nend"],
    ['app/api_controller.rb', 'cp-dotnet-php-ruby', "class WebhooksController < ApplicationController\n  # Authenticated by a signed header, not a cookie session.\n  skip_before_action :verify_authenticity_token, only: :create\n\n  def create\n    head :no_content\n  end\nend"],
    ['config/routes.rb', 'cp-dotnet-php-ruby', "Rails.application.routes.draw do\n  root 'pages#home'\n  get '*path', to: 'errors#not_found'\nend"],
    ['app/yaml_load.rb', 'cp-dotnet-php-ruby', "require 'yaml'\nSETTINGS = YAML.safe_load(File.read('config/settings.yml'))"],
  ], 7)

  g('cp-js', [
    ['src/ops/exec-const.js', 'cp-js', "const { exec } = require('child_process')\nconst cmd = 'git --version'\nexports.version = (done) => exec(cmd, done)"],
    ['src/ops/spawn-cmd.js', 'cp-js', "const { spawn } = require('child_process')\n// npm is a .cmd file on Windows and needs a shell; the arguments are fixed.\nexports.install = () => spawn('npm', ['ci'], { shell: true })"],
    ['src/ops/plugin-allowlist.js', 'cp-js', "const PLUGINS = new Set(['csv', 'json'])\nexports.load = (name) => {\n  if (!PLUGINS.has(name)) throw new Error('unknown plugin')\n  return require(name)\n}"],
    ['src/ops/token-kind.js', 'cp-js', "// A lexer token type, not a credential.\nexports.isIdent = (tokenKind) => tokenKind === Kind.Identifier"],
    ['src/ops/timing-safe.js', 'cp-js', "const crypto = require('crypto')\nexports.same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))"],
    ['src/ops/plain-text-mail.js', 'cp-js', "const Handlebars = require('handlebars')\n// Plain-text emails: no HTML is produced, so escaping would only add &amp;.\nexports.render = (tpl, data) => Handlebars.compile(tpl, { noEscape: true })(data)"],
    ['src/ops/api-helmet.js', 'cp-js', "const helmet = require('helmet')\n// JSON API only: it never serves an HTML page, so a page policy has nothing to protect.\nexports.mw = helmet({ contentSecurityPolicy: false })"],
    ['src/ops/post-origin.js', 'cp-js', "export function ready() {\n  window.parent.postMessage({ type: 'ready' }, window.location.origin)\n}"],
    ['src/ops/help-text.js', 'cp-js', "const HELP = ['  --out DIR   write the report to DIR (default \"/tmp/out\" in CI)']\nexports.HELP = HELP"],
    ['src/ops/tmpdir.js', 'cp-js', "const os = require('os')\nconst path = require('path')\nexports.cache = path.join(os.tmpdir(), 'harbourside-cache')"],
    ['src/ops/timer-fn.js', 'cp-js', "exports.later = (fn) => setTimeout(fn, 250)"],
    ['src/ops/yaml-default.js', 'cp-js', "const yaml = require('js-yaml')\nexports.read = (text) => yaml.load(text)"],
    ['src/ops/buffer-from.js', 'cp-js', "exports.bytes = (s) => Buffer.from(s, 'utf8')"],
    ['src/ops/chmod-ok.js', 'cp-js', "const fs = require('fs')\nexports.exec = (file) => fs.chmodSync(file, 0o755)"],
  ])

  g('repo', [
    ['.env.example', 'secret-scan', "DATABASE_URL=\nSESSION_SECRET=\nSTRIPE_KEY=sk_test_your_key_here\nSMTP_PASSWORD=changeme\n"],
    ['docs/aws-example.md', 'secret-scan', "# AWS example\n\nAWS documents this sample pair for its CLI guide: `AKIAIOSFODNN7EXAMPLE` and `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`. Both are published placeholders.\n"],
    ['src/config/empty-hash.js', 'secret-scan', "// sha256 of the empty string, used as a known constant in a test of the hashing helper\nexports.EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'"],
    ['src/config/uuids.js', 'secrets-plus', "exports.DEMO_TENANT = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'"],
    ['src/config/placeholder.js', 'secrets-plus', "exports.OPENAI_KEY = process.env.OPENAI_API_KEY ?? ''\nexports.HINT = 'Set OPENAI_API_KEY to a key that starts with sk- (see the docs).'"],
    ['docker-compose.yml', 'compose-hygiene', "services:\n  db:\n    image: postgres:16.4@sha256:0d5dffa2a9d1b0a1e9c6d6a7b8c3f4e5d6c7b8a9f0e1d2c3b4a5968778695a4b\n    environment:\n      POSTGRES_PASSWORD: ${DB_PASSWORD:?set DB_PASSWORD in .env}\n    ports:\n      - '127.0.0.1:5432:5432'\n"],
    ['Dockerfile', 'docker-base-pinning', "FROM node:22.11.0-alpine3.20@sha256:0d5dffa2a9d1b0a1e9c6d6a7b8c3f4e5d6c7b8a9f0e1d2c3b4a5968778695a4b\nWORKDIR /app\nCOPY package.json ./\nRUN npm ci --omit=dev\nCOPY . .\nUSER node\nCMD [\"node\", \"src/server.js\"]\n"],
    ['.github/workflows/deploy.yml', 'workflow-security', "name: deploy\non:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  deploy:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n      - run: ./scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n"],
    ['helm/values.yaml', 'helm-values-secrets', "replicaCount: 2\nexistingSecret: harbourside-db\nsecretKeyRef:\n  name: harbourside-db\n  key: password\n"],
    ['.npmrc', 'secret-scan', "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n"],
  ])

  return { projects: out, expect: {} }
}
