// Code-pattern rule tables (the cp-* checks in thorough/code-patterns.mjs). Each table is one check. A rule is a line regex (or a
// `test(line, ctx)` function when it needs the surrounding lines). Meerkat's own wording and regexes: written from the common
// mistakes in each language, not copied from another tool's rule files. Every rule carries a bad and a good sample (selfProve).
// Regexes are linear: bounded quantifiers ({0,200}) instead of open-ended spans, so a hostile 100 KB line cannot blow up.
// Known limits: a rule that matches one line cannot see a call that is split over several lines (noted per rule where it matters).

const PY_SKIP = /^\s*#/
const SLASH_SKIP = /^\s*(\/\/|\/\*|\*)/
const PHP_SKIP = /^\s*(\/\/|#|\/\*|\*)/
const RB_SKIP = /^\s*#/
// Tests, docs, examples, fixtures and vendored code: deliberate bad code lives there.
// The rule tables and the runner quote dangerous code as sample text, so they are excluded from their own scan.
const TEST_OUT = /(^|\/)(tests?|__tests__|spec|specs|examples?|docs?|fixtures?|testdata|vendor|third_party|benches?)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]*\.py$|_spec\.rb$|(^|\/)conftest\.py$|(^|\/)(rules-code-patterns|code-patterns)\.mjs$|(^|\/)packs\/code-patterns\//i

// Rules whose target IS literal text (a character, a string's content, a header value) match inside string literals too.
const LITERAL = new Set(['go-cors-any-origin', 'java-log4shell-lookup-string', 'js-hidden-bidi-control', 'js-zero-width-char', 'js-template-no-escape', 'js-node-serialize'])

// A line test that is true only when the regex matches OUTSIDE a string literal (quotes tracked left to right, with escapes).
// Call-shaped rules use it so that a sample quoted inside a string, a message or a doc does not count as code. Linear: the
// quote state is carried forward from one match to the next, never rescanned.
const outsideStrings = (re) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return (line) => {
    let state = null
    let pos = 0
    let esc = false
    for (const m of line.matchAll(g)) {
      while (pos < m.index) {
        const c = line[pos++]
        if (state) {
          if (esc) esc = false
          else if (c === '\\') esc = true
          else if (c === state) state = null
        } else if (c === '"' || c === "'" || c === '`') state = c
      }
      if (!state) return true
    }
    return false
  }
}

const TIMING_RE = /\b\w*(?:(?:auth|api|access|session|csrf|bearer|refresh)_?token|secret|signature|hmac|apiKey|password)\w*\s*(?:===|!==)\s*(?!(?:undefined|null|true|false|NaN)\b)[A-Za-z_$][\w.$[\]]{0,79}/i

// A regex literal whose character class lists the characters (a scanner that looks for them): not a hidden character.
const REGEX_CLASS_LINE = /[=(,:]\s*\/\[[^\]\n]{1,80}\]\/[gimsuy]*\s*[;,).]?\s*$/

// A call whose parentheses are still open at the end of the line is joined with the next lines (up to 6) and the rule's regex runs on the
// joined text, provided the match STARTS on this line. So a dangerous argument on the next line is still seen, and a rule that looks for
// a missing argument (no timeout) sees the argument that is on the next line. Linear: bounded joins, lines over 400 characters are not joined.
const openParens = (s) => {
  let d = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 40) d++
    else if (c === 41) d--
  }
  return d > 0
}
const joined = (re, base) => (line, ctx) => {
  if (base(line, ctx)) return true
  if (line.length > 400 || !openParens(line)) return false
  let w = line
  for (let i = ctx.index + 1; i < Math.min(ctx.lines.length, ctx.index + 7); i++) {
    w += ' ' + ctx.lines[i].trim()
    if (!openParens(w)) break
  }
  const m = re.exec(w)
  return Boolean(m) && m.index < line.length && base(w, ctx)
}

const family = (ext, skipLine) => (id, title, re, bad, good, extra = {}) => ({
  id,
  title,
  // A rule with its own `files` pattern reads those files only: the engine would otherwise look at `ext` first and ignore `files`.
  ext: extra.files ? undefined : ext,
  re,
  skipLine,
  notIn: TEST_OUT,
  bad,
  good,
  ...(re && !LITERAL.has(id) ? { test: joined(re, outsideStrings(re)) } : {}),
  ...(re && LITERAL.has(id) ? { test: joined(re, (l) => re.test(l)) } : {}),
  ...extra,
})

// Names a file gives to child_process exec: { exec as run }, { exec: run }, promisify(exec), and namespace imports (cp.exec). Cached per text.
const aliasCache = new Map()
function execAliasRe(text) {
  if (aliasCache.has(text)) return aliasCache.get(text)
  const bare = new Set()
  const ns = new Set()
  for (const m of text.matchAll(/\{([^}\n]{1,200})\}\s*(?:=\s*require\(\s*|from\s*)['"](?:node:)?child_process['"]/g)) {
    for (const it of m[1].split(',')) {
      const x = /^\s*exec(?:Sync)?\s*(?:(?::|\s+as\s+)\s*(\w+))?\s*$/.exec(it)
      if (x && x[1]) bare.add(x[1])
    }
  }
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:util\.)?promisify\(\s*(?:\w+\.)?exec(?:Sync)?\s*\)/g)) bare.add(m[1])
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)|import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*['"](?:node:)?child_process['"]/g)) ns.add(m[1] || m[2])
  const tail = String.raw`\(\s*(?!['"][^'"\n]{0,300}['"]\s*[,)])`
  const parts = []
  if (bare.size) parts.push('(?<![\\w$.])(?:' + [...bare].join('|') + ')' + tail)
  if (ns.size) parts.push('(?<![\\w$])(?:' + [...ns].join('|') + ')\\.exec(?:Sync)?' + tail)
  const re = parts.length ? new RegExp(parts.join('|')) : null
  if (aliasCache.size > 50) aliasCache.clear()
  aliasCache.set(text, re)
  return re
}

const PYF = family(['py'], PY_SKIP)
const JSF = family(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'], SLASH_SKIP)
const GOF = family(['go'], SLASH_SKIP)
const RSF = family(['rs'], SLASH_SKIP)
const JVF = family(['java'], SLASH_SKIP)
const CSF = family(['cs'], SLASH_SKIP)
const PHPF = family(['php', 'phtml'], PHP_SKIP)
const RBF = family(['rb'], RB_SKIP)

// ---------------------------------------------------------------- Python (cp-python)
export const PY = [
  PYF('py-popen-variable', 'os.popen runs a command that is built from a variable', /\bos\.popen\(\s*(?!['"])/, 'out = os.popen(cmd)', 'out = os.popen("ls")'),
  PYF('py-subprocess-string', 'a subprocess call is given one string, not a list of arguments', /\bsubprocess\.(?:call|run|Popen|check_output|check_call)\(\s*f?['"]/, 'subprocess.call("ls -l")', 'subprocess.call(["ls", "-l"])'),
  PYF('py-marshal-load', 'marshal, dill or jsonpickle loads data that can build arbitrary objects', /\bmarshal\.loads?\(|\bdill\.loads?\(|\bjsonpickle\.loads?\(|\bjsonpickle\.decode\(/, 'obj = marshal.loads(data)', 'obj = json.loads(data)'),
  PYF('py-shelve-open', 'shelve stores pickled objects, so opening untrusted data runs code', /\bshelve\.open\(/, 'db = shelve.open(path)', 'db = dbm.open(path)'),
  PYF('py-shell-true', 'a subprocess call runs through a shell (shell=True), so a value in the command can inject more commands', undefined, 'import subprocess\nsubprocess.run(cmd, shell=True)', 'import subprocess\nsubprocess.run(cmd)', { test: (line, ctx) => /\bshell\s*=\s*True\b/.test(line) && /\bsubprocess\b|\bPopen\b|\bcheck_output\b|\bcheck_call\b/.test(ctx.text) }),
  PYF('py-os-system-alias', 'os.system is reached through an import alias (from os import system, import os as x), so a value in the command can inject commands', undefined, 'from os import system\nsystem(cmd)', 'import os\nos.getcwd()', { test: (line, ctx) => {
    if (!/\bsystem\b/.test(line) || !/\bos\b/.test(ctx.text)) return false
    const names = new Set()
    for (const m of ctx.text.matchAll(/^\s*from\s+os\s+import\s+([^\n#]+)/gm)) for (const it of m[1].split(',')) { const x = /^\s*\(?\s*system(?:\s+as\s+(\w+))?\s*\)?\s*$/.exec(it); if (x) names.add(x[1] || 'system') }
    const mods = []
    for (const m of ctx.text.matchAll(/^\s*import\s+os\s+as\s+(\w+)/gm)) mods.push(m[1])
    return [...names].some((n) => new RegExp('(?<![\\w.])' + n + '\\s*\\(\\s*(?![\'"][^\'"\\n]{0,200}[\'"]\\s*\\))').test(line)) || mods.some((n) => new RegExp('\\b' + n + '\\.system\\s*\\(').test(line))
  } }),
  PYF('py-exec-text', 'exec runs text as Python code', /(?<![\w.])exec\s*\(/, 'exec(user_code)', 'value = ast.literal_eval(text)'),
  PYF('py-compile-exec-mode', 'compile() builds code from text in exec or single mode', /\bcompile\([^\n]{0,200},\s*['"](?:exec|single)['"]/, 'compile(src, "<s>", "exec")', 'compile(src, "<s>", "eval")'),
  PYF('py-hardcoded-password', 'a password, secret or token is typed straight into the code', /(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|api_key|apikey|token)\s*(?::\s*\w+(?:\[[^\]]{0,20}\])?\s*)?=\s*['"][^'"\s]{4,}['"]/i, 'password = "hunter22"', 'password = os.environ["PW"]'),
  PYF('py-hardcoded-password-default', 'a function has a password, secret or token default written in the code', /\bdef\s+\w+\([^)\n]{0,300}\b(?:password|passwd|secret|token)\s*(?::\s*\w+\s*)?=\s*['"][^'"\n]{1,}['"]/, 'def login(user, password="hunter2"):', 'def login(user, password=None):'),
  PYF('py-requests-no-timeout', 'an HTTP request has no timeout, so it can hang forever (one-line calls only)', /\brequests\.(?:get|post|put|delete|patch|head|request)\((?![^\n]{0,400}\btimeout\s*=)/, 'r = requests.get(url)', 'r = requests.get(url, timeout=5)'),
  PYF('py-ssl-unverified', 'TLS certificate or hostname checks are turned off', /\b_create_unverified_context\(|\bCERT_NONE\b|\bcheck_hostname\s*=\s*False\b/, 'ctx = ssl._create_unverified_context()', 'ctx = ssl.create_default_context()'),
  PYF('py-ssl-old-protocol', 'an old SSL or TLS 1.0/1.1 protocol is selected', /\bPROTOCOL_(?:SSLv2|SSLv3|TLSv1|TLSv1_1)\b/, 'ctx = ssl.SSLContext(ssl.PROTOCOL_TLSv1)', 'ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)'),
  PYF('py-ftp-telnet', 'plain FTP or Telnet is used, which sends passwords unencrypted', /\bftplib\.FTP\(|\btelnetlib\.Telnet\(|^\s*(?:import telnetlib|from telnetlib)\b/, 'c = ftplib.FTP(host)', 'c = ftplib.FTP_TLS(host)'),
  PYF('py-plain-http-fetch', 'a request is sent to a plain http:// address', /\b(?:requests\.\w+|urlopen|httpx\.\w+|aiohttp\.ClientSession)\(\s*f?['"]http:\/\/(?!localhost\b|127\.0\.0\.1)/, 'requests.get("http://example.com/api")', 'requests.get("https://example.com/api", timeout=5)'),
  PYF('py-xml-untrusted', 'XML is parsed by a parser that does not limit entities (use defusedxml)', /(?<![\w.])(?:xml\.dom\.)?minidom\.parse(?:String)?\(|(?<![\w.])xml\.sax\.parse(?:String)?\(|(?<![\w.])expatbuilder\.parse\w*\(/, 'doc = minidom.parseString(data)', 'doc = defusedxml.minidom.parseString(data)'),
  PYF('py-tar-extractall-unfiltered', 'an archive is extracted with no member filter (a path can escape the folder)', /\.extractall\((?![^\n]{0,200}\bfilter\s*=)/, 'tar.extractall(dest)', 'tar.extractall(dest, filter="data")'),
  PYF('py-torch-load-unsafe', 'torch.load without weights_only=True can run pickled code', /\btorch\.load\((?![^\n]{0,200}\bweights_only\s*=\s*True)/, 'model = torch.load(path)', 'model = torch.load(path, weights_only=True)'),
  PYF('py-trust-remote-code', 'a model loader runs code shipped with the model (trust_remote_code=True)', /\btrust_remote_code\s*=\s*True\b/, 'AutoModel.from_pretrained(name, trust_remote_code=True)', 'AutoModel.from_pretrained(name)'),
  PYF('py-paramiko-autoadd', 'SSH accepts any unknown host key (AutoAddPolicy)', /\bAutoAddPolicy\(\)/, 'c.set_missing_host_key_policy(paramiko.AutoAddPolicy())', 'c.load_system_host_keys()'),
  PYF('py-snmp-community', 'an SNMP v1 or v2c community string is typed into the code', /\bCommunityData\(\s*['"]/, "CommunityData('public')", 'CommunityData(os.environ["SNMP"])'),
  PYF('py-bind-all-interfaces', 'a server listens on every network interface (0.0.0.0)', /\bhost\s*=\s*['"]0\.0\.0\.0['"]|\.bind\(\s*\(\s*['"]0\.0\.0\.0['"]/, 'app.run(host="0.0.0.0")', 'app.run(host="127.0.0.1")'),
  PYF('py-jinja-autoescape-off', 'Jinja2 autoescaping is turned off, so HTML is not escaped', /\bautoescape\s*=\s*False\b/, 'env = Environment(autoescape=False)', 'env = Environment(autoescape=True)'),
  PYF('py-django-mark-safe', 'output is marked safe, so its HTML is not escaped', /\bmark_safe\s*\(/, 'return mark_safe(html)', 'return escape(html)'),
  PYF('py-django-allowed-hosts-star', 'Django accepts any Host header (ALLOWED_HOSTS = ["*"])', /\bALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]/, 'ALLOWED_HOSTS = ["*"]', 'ALLOWED_HOSTS = ["example.com"]'),
  PYF('py-django-csrf-exempt', 'a view is exempt from CSRF protection', /^\s*@csrf_exempt\b/, '@csrf_exempt', '@require_POST'),
  PYF('py-raw-sql-formatted', 'SQL is built with % or format or an f-string, not parameters', /\.(?:execute|executemany|raw|extra)\(\s*(?:f['"]|['"][^'"\n]{0,300}['"]\s*(?:%|\.format\(|\+))/, 'cursor.execute("SELECT * FROM t WHERE id=%s" % uid)', 'cursor.execute("SELECT * FROM t WHERE id=%s", [uid])'),
  PYF('py-flask-secret-literal', 'the Flask secret key is typed into the code', /\bsecret_key\s*=\s*['"][^'"\n]{1,}['"]/, 'app.secret_key = "dev"', 'app.secret_key = os.environ["SECRET"]'),
  PYF('py-hardcoded-iv', 'a cipher IV or nonce is a fixed literal', /\b(?:iv|nonce)\s*=\s*b?['"][^'"\n]{4,}['"]/i, 'iv = b"0123456789abcdef"', 'iv = os.urandom(16)'),
  PYF('py-tmp-literal', 'a fixed /tmp path is used (shared, guessable)', /['"]\/tmp\//, 'open("/tmp/data.txt", "w")', 'open(os.path.join(tempfile.gettempdir(), "data.txt"))'),
  PYF('py-mktemp-race', 'tempfile.mktemp returns a name that another process can take first', /\btempfile\.mktemp\(/, 'name = tempfile.mktemp()', 'fd, name = tempfile.mkstemp()'),
  PYF('py-world-writable-mode', 'a file or folder is made writable by everyone (mode ends in 2, 3, 6 or 7)', /\bos\.(?:chmod|makedirs|mkdir)\([^\n]{0,80}\b0o?[0-7][0-7][236]\b/, 'os.chmod(p, 0o666)', 'os.chmod(p, 0o600)'),
]

// ---------------------------------------------------------------- JavaScript and TypeScript (cp-js)
export const JS = [
  JSF('js-exec-variable', 'child_process exec runs a command string that is not a fixed literal', /(?<![\w$.])(?:(?:child_process|childProcess|cp)\.)?exec(?:Sync)?\(\s*(?!['"][^'"\n]{0,300}['"]\s*[,)])(?!\w+\??\s*:\s*[A-Za-z{\[])/, 'exec(cmd, done)', 'exec("ls -l", done)'),
  JSF('js-exec-alias', 'a child_process exec under another name (renamed import, namespace import or promisify) runs a command string that is not a fixed literal', undefined, "import { exec as run } from 'child_process'\nrun(cmd)", "import { exec as run } from 'child_process'\nrun('ls -l')", { test: (line, ctx) => {
    if (!/exec/.test(ctx.text)) return false
    const re = execAliasRe(ctx.text)
    return Boolean(re) && joined(re, (l) => re.test(l))(line, ctx)
  } }),
  JSF('js-require-dynamic', 'require is called with a template literal or a joined string, so the module name is built at run time', /(?<![\w$.])require\(\s*(?:\x60[^\x60\n]*\$\{|['"][^'"\n]*['"]\s*\+)/, 'const m = require("./h/" + type)', 'const m = require("./h/a")'),
  JSF('js-spawn-shell', 'spawn or execFile is given shell: true, so arguments are parsed by a shell', /\bspawn(?:Sync)?\([^\n]{0,300}\bshell\s*:\s*true\b/, 'spawn("ls", [], { shell: true })', 'spawn("ls", [])'),
  JSF('js-require-variable', 'require is called with a name that is not a fixed string', /(?<![\w$.])require\(\s*(?!['"`]|[A-Z][A-Z0-9_]*\s*\)|path\.|__dirname|process\.|join\(|resolve\()[A-Za-z_$][^)\n]{0,200}\)/, 'const m = require(name)', 'const m = require("fs")'),
  JSF('js-require-url', 'a module is loaded from a web address', /(?<![\w$.])require\(\s*['"]https?:\/\//, 'require("https://x.example/a.js")', 'require("./a.js")'),
  JSF('js-fs-request-path', 'a file system call takes its path straight from the request', /\bfs\.(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|unlinkSync|readdir|readdirSync|stat|statSync|access|appendFile|rm|rmSync)\(\s*(?:req|request|ctx|params|query|body)\b/, 'fs.readFile(req.query.file, cb)', 'fs.readFile(safePath(req.query.file), cb)'),
  JSF('js-new-buffer', 'new Buffer() is unsafe (it can expose old memory); use Buffer.from or Buffer.alloc', /\bnew\s+Buffer\s*\(/, 'const b = new Buffer(10)', 'const b = Buffer.alloc(10)'),
  JSF('js-pseudorandom-bytes', 'crypto.pseudoRandomBytes is used, which is not cryptographic random', /\bpseudoRandomBytes\s*\(/, 'crypto.pseudoRandomBytes(16)', 'crypto.randomBytes(16)'),
  JSF('js-timing-unsafe-compare', 'a secret or token is compared with === to another variable (timing leaks the value; use a constant-time compare)', TIMING_RE, 'if (req.authToken === expected) ok()', 'if (safeEqual(a, b)) ok()', {
    // typeof checks and comparisons with a literal (a string, a number, null) are not a secret-versus-secret compare.
    test: (line) => !/\btypeof\b/.test(line) && outsideStrings(TIMING_RE)(line),
  }),
  JSF('js-nested-quantifier-regex', 'a regular expression has a nested quantifier that can take exponential time', /\((?!(?:\?:)?(?:\\\.|-|\/))(?:\?:)?[^()[\]\n]{1,40}[+*]\)[+*{]/, 'const re = /(a+)+$/', 'const re = /a+$/'),
  JSF('js-template-no-escape', 'a template turns off HTML escaping (noEscape or a triple-stash tag)', /\bnoEscape\s*:\s*true\b|\{\{\{\s*[\w.]+\s*\}\}\}/, 'Handlebars.compile(t, { noEscape: true })', 'Handlebars.compile(t)'),
  JSF('js-csrf-before-method-override', 'CSRF middleware is mounted before methodOverride, so it cannot read the overridden method', undefined, "app.use(csurf());\napp.use(methodOverride('_method'));", "app.use(methodOverride('_method'));\napp.use(csurf());", { test: (line, ctx) => /\bmethodOverride\s*\(/.test(line) && /\b(?:csurf|csrf)\s*\(/.test(ctx.lines.slice(0, ctx.index).join('\n')) }),
  JSF('js-vm-variable', 'vm is given code built from a variable (vm is not a security sandbox)', /\bvm\.(?:runInNewContext|runInThisContext|runInContext|createScript|compileFunction)\(\s*(?!['"`])/, 'vm.runInNewContext(code)', 'vm.runInNewContext("1 + 1")'),
  JSF('js-http-server-auth', 'an auth-related server is plain http (created with http.createServer)', undefined, "const http = require('http')\nhttp.createServer((req, res) => { check(req.headers.password) })", "const https = require('https')\nhttps.createServer(app)", { test: (line, ctx) => /\bhttp\.createServer\s*\(/.test(line) && /(?<![A-Za-z0-9])(?:password|login|authorization|cookie)\b/i.test(ctx.text) }),
  JSF('js-session-cookie-insecure', 'a session cookie is allowed over plain http (secure: false)', /\bsecure\s*:\s*false\b/, 'session({ cookie: { secure: false } })', 'session({ cookie: { secure: true } })'),
  JSF('js-helmet-csp-off', "Helmet's content security policy is turned off", /\bcontentSecurityPolicy\s*:\s*false\b/, 'helmet({ contentSecurityPolicy: false })', 'helmet()'),
  JSF('js-postmessage-any-origin', 'postMessage sends data to any window origin ("*")', /\.postMessage\([^\n]{0,200},\s*['"`]\*['"`]\s*\)/, 'win.postMessage(data, "*")', 'win.postMessage(data, origin)'),
  JSF('js-chmod-world-writable', 'a file or folder is made writable by everyone (mode ends in 2, 3, 6 or 7)', /\bfs\.(?:chmod|chmodSync|mkdir|mkdirSync|writeFile|writeFileSync)\([^\n]{0,120}\b0o?[0-7][0-7][236]\b/, 'fs.writeFileSync(p, d, { mode: 0o666 })', 'fs.writeFileSync(p, d, { mode: 0o600 })'),
  JSF('js-tmp-literal', 'a fixed /tmp path is used (shared, guessable)', /['"`]\/tmp\//, 'fs.writeFileSync("/tmp/x.json", d)', 'fs.writeFileSync(path.join(os.tmpdir(), "x.json"), d)'),
  JSF('js-yaml-full-schema', 'js-yaml is loaded with the full schema, which can construct objects that run code', /\byaml\.load\([^\n]{0,200}\b(?:FULL_SCHEMA|DEFAULT_FULL_SCHEMA|unsafeLoad)\b/, 'yaml.load(s, { schema: yaml.DEFAULT_FULL_SCHEMA })', 'yaml.load(s)'),
  JSF('js-node-serialize', 'the node-serialize package is used, which can run code from the data', /\bnode-serialize['"]|\bserialize\.unserialize\s*\(/, 'serialize.unserialize(body)', 'JSON.parse(body)'),
  JSF('js-hidden-bidi-control', 'a bidirectional control character is in the source (Trojan Source: it can hide code from review)', /[‪-‮⁦-⁩]/, 'const role = "admin‮"', 'const role = "admin"', { skipLine: REGEX_CLASS_LINE }),
  JSF('js-zero-width-char', 'a zero-width character is in the source (it can hide or change identifiers)', /[​-‏⁠]/, 'const x​ = 1', 'const x = 1', { skipLine: REGEX_CLASS_LINE }),
  JSF('js-timer-string', 'setTimeout or setInterval is given a string, which runs as code', /\b(?:setTimeout|setInterval)\(\s*['"`]/, 'setTimeout("doIt()", 10)', 'setTimeout(doIt, 10)'),
  JSF('js-document-domain', 'document.domain is set, which relaxes the same-origin policy', /\bdocument\.domain\s*=/, 'document.domain = "example.com"', 'const d = document.domain'),
]

// ---------------------------------------------------------------- Go (cp-go)
export const GO = [
  GOF('go-hardcoded-secret', 'a password, secret or token is typed straight into the code', /(?<![A-Za-z0-9])(?:password|passwd|secret|apiKey|token|privateKey)(?!\w*(?:Type|Name|Kind|Path|File|Url|Header|Field|Label)\s*(?::=|=))\w*\s*(?::=|=)\s*"[^"\n]{4,}"/i, 'password := "hunter22"', 'password := os.Getenv("PW")'),
  GOF('go-listen-all-interfaces', 'a server listens on every network interface (empty host or 0.0.0.0)', /\bListen(?:AndServe(?:TLS)?)?\([^\n]{0,80}"(?:0\.0\.0\.0)?:\d{2,5}"/, 'http.ListenAndServe(":8080", nil)', 'ln, err := net.Listen("tcp", "127.0.0.1:8080")'),
  GOF('go-ssh-ignore-hostkey', 'SSH accepts any host key (InsecureIgnoreHostKey)', /\bInsecureIgnoreHostKey\(\)/, 'cfg := &ssh.ClientConfig{HostKeyCallback: ssh.InsecureIgnoreHostKey()}', 'cfg := &ssh.ClientConfig{HostKeyCallback: knownHosts}'),
  GOF('go-http-get-variable', 'an HTTP call takes a URL from a variable (possible SSRF)', /\bhttp\.(?:Get|Post|Head)\(\s*(?!"[^"\n]*"\s*[,)])/, 'resp, err := http.Get(url)', 'resp, err := http.Get("https://example.com")'),
  GOF('go-pprof-imported', 'the pprof profiling endpoints are imported (they expose internals)', /^\s*(?:_\s+)?"net\/http\/pprof"/, '_ "net/http/pprof"', '"net/http"'),
  GOF('go-io-copy-decompressor', 'io.Copy reads a decompressor with no size limit (decompression bomb)', /\bio\.Copy\([^\n]{0,80},\s*\w*(?:gz|gzip|zlib|zr)\w*\)/i, 'io.Copy(dst, gz)', 'io.CopyN(dst, gz, maxBytes)'),
  GOF('go-server-no-header-timeout', 'an http.Server has no ReadHeaderTimeout (slowloris)', /\bhttp\.Server\{(?![^}\n]{0,400}\bReadHeaderTimeout\b)/, 'srv := &http.Server{Addr: ":8080"}', 'srv := &http.Server{Addr: ":8080", ReadHeaderTimeout: 5 * time.Second}'),
  GOF('go-default-listen-no-timeouts', 'http.ListenAndServe uses the default server, which has no timeouts', /\bhttp\.ListenAndServe(?:TLS)?\(/, 'http.ListenAndServe(":8080", nil)', 'srv.ListenAndServe()'),
  GOF('go-sql-built-string', 'SQL is built with Sprintf or string concatenation, not parameters', /\.(?:Query|QueryRow|Exec|QueryContext|QueryRowContext|ExecContext)\(\s*(?:fmt\.Sprintf\(|"[^"\n]{0,300}"\s*\+)/, 'db.Query(fmt.Sprintf("SELECT * FROM t WHERE id=%s", id))', 'db.Query("SELECT * FROM t WHERE id=$1", id)'),
  GOF('go-exec-variable', 'exec.Command gets a program name from a variable', /\bexec\.Command\(\s*(?!"[^"\n]*"\s*[,)])/, 'exec.Command(name)', 'exec.Command("ls", "-l")'),
  GOF('go-shell-dash-c', 'a shell is started with -c, so the text is parsed by the shell', /"(?:sh|bash|cmd)",\s*"(?:-c|\/c)"/, 'exec.Command("sh", "-c", cmd)', 'exec.Command("ls", "-l")'),
  GOF('go-world-writable-mode', 'a file or folder is made writable by everyone (mode ends in 2, 3, 6 or 7)', /\bos\.(?:Chmod|WriteFile|OpenFile|Mkdir|MkdirAll)\([^\n]{0,160}\b0o?[0-7][0-7][2367]\b/, 'os.WriteFile(p, d, 0666)', 'os.WriteFile(p, d, 0600)'),
  GOF('go-tmp-literal', 'a file is created at a fixed /tmp path (predictable name)', /\bos\.(?:Create|OpenFile|WriteFile|Mkdir)\(\s*"\/tmp\//, 'os.Create("/tmp/out.txt")', 'os.CreateTemp("", "out")'),
  GOF('go-file-from-request', 'a file is opened at a path taken from the request', /\bos\.(?:Open|OpenFile|ReadFile|Create)\([^\n]{0,80}(?:FormValue|PathValue|URL\.Query\(\)|\.Param\(|FormFile)/, 'os.Open(r.FormValue("f"))', 'os.Open(safePath)'),
  GOF('go-zip-slip-join', 'an archive entry name is joined to a path with no check for ../ (zip slip)', /\bfilepath\.Join\([^\n]{0,80},\s*\w+\.Name\)/, 'path := filepath.Join(dest, f.Name)', 'path := filepath.Join(dest, safeName(f.Name))'),
  GOF('go-md4-md5-sha1', 'MD4, MD5 or SHA-1 is used (broken for security)', /\b(?:md4|md5|sha1)\.(?:New|Sum)\(/, 'h := md5.New()', 'h := sha256.New()'),
  GOF('go-tls-old-minimum', 'TLS allows version 1.0 or 1.1, or SSL 3', /\bMinVersion\s*:\s*tls\.VersionTLS1[01]\b|\bMinVersion\s*:\s*tls\.VersionSSL30\b/, 'MinVersion: tls.VersionTLS10', 'MinVersion: tls.VersionTLS12'),
  GOF('go-rsa-small-key', 'an RSA key shorter than 2048 bits is generated', /\brsa\.GenerateKey\([^\n]{0,80},\s*(?:512|1024)\s*\)/, 'rsa.GenerateKey(rand.Reader, 1024)', 'rsa.GenerateKey(rand.Reader, 3072)'),
  GOF('go-math-rand-import', 'math/rand is imported, which is not safe for secrets (use crypto/rand)', /^\s*(?:import\s+)?(?:\w+\s+)?"math\/rand(?:\/v2)?"/, 'import "math/rand"', 'import "crypto/rand"'),
  GOF('go-tripledes-cipher', 'the 3DES cipher is used (weak and slow)', /\bdes\.NewTripleDESCipher\(/, 'c, _ := des.NewTripleDESCipher(key)', 'c, _ := aes.NewCipher(key)'),
  GOF('go-hardcoded-iv', 'a cipher IV is a fixed literal', /\b(?:iv|nonce|IV|Nonce|initVector)\s*:?=\s*\[\]byte\(\s*"[^"\n]{4,}"/, 'iv := []byte("0123456789abcdef")', 'iv := make([]byte, aes.BlockSize)'),
  GOF('go-weak-crypto-import', 'a weak crypto package is imported (md5, sha1, des, rc4, dsa, ripemd160) or CGI', /^\s*(?:import\s+)?(?:_\s+|\w+\s+)?"(?:crypto\/md5|crypto\/sha1|crypto\/des|crypto\/rc4|crypto\/dsa|net\/http\/cgi|golang\.org\/x\/crypto\/ripemd160)"/, 'import "crypto/md5"', 'import "crypto/sha256"'),
  GOF('go-cookie-not-secure', 'an http.Cookie literal does not set Secure: true', /\bhttp\.Cookie\{(?![^}\n]{0,300}\bSecure\s*:\s*true\b)/, 'c := http.Cookie{Name: "s", Value: v}', 'c := http.Cookie{Name: "s", Value: v, Secure: true, HttpOnly: true}'),
  GOF('go-cors-any-origin', 'CORS allows any origin ("*")', /Access-Control-Allow-Origin["`]?\s*,\s*["`]\*["`]|\bAllowAllOrigins\s*:\s*true\b|\bAllowedOrigins\s*:\s*\[\]string\{\s*"\*"/, 'w.Header().Set("Access-Control-Allow-Origin", "*")', 'w.Header().Set("Access-Control-Allow-Origin", origin)'),
  GOF('go-template-html-unescaped', 'template.HTML marks a string as safe, so it is not escaped', /\btemplate\.HTML\(/, 'tpl := template.HTML(userInput)', 'tpl := template.HTMLEscapeString(userInput)'),
]

// ---------------------------------------------------------------- Rust (cp-rust)
export const RS = [
  RSF('rs-unsafe-no-safety', 'an unsafe block has no SAFETY note in the three lines above it', undefined, 'let x = unsafe { *p };', '// SAFETY: p is valid for reads\nlet x = unsafe { *p };', { test: (line, ctx) => /\bunsafe\s*\{/.test(line) && !/SAFETY/i.test(ctx.lines.slice(Math.max(0, ctx.index - 3), ctx.index + 1).join('\n')) }),
  RSF('rs-transmute', 'mem::transmute reinterprets bytes as another type (easy to get wrong)', /\bmem::transmute\b/, 'let f: f32 = mem::transmute(x);', 'let f = f32::from_bits(x);'),
  RSF('rs-forget-uninitialized', 'mem::forget or mem::uninitialized can leak or read undefined memory', /\bmem::(?:forget|uninitialized)\b/, 'mem::forget(buf);', 'drop(buf);'),
  RSF('rs-command-variable', 'Command::new gets a program name built with format! or taken from user, input, request or cmd data', /\bCommand::new\(\s*(?:&?format!\(|&?(?:user|input|req|param|untrusted|arg|cmd|command|query|body|payload)\w*\b)/, 'Command::new(cmd).arg(x).output()', 'Command::new("ls").arg("-l").output()'),
  RSF('rs-unwrap-in-library', 'a library file (src/lib.rs) panics with unwrap() outside test code', /\.unwrap\(\)/, 'let v = x.unwrap();', 'let v = x?;', {
    files: /(^|\/)src\/lib\.rs$/,
    test: (line, ctx) => /\.unwrap\(\)/.test(line) && !ctx.lines.slice(0, ctx.index).some((l) => /#\[cfg\(test\)\]/.test(l)),
  }),
  RSF('rs-accept-invalid-certs', 'TLS accepts invalid certificates or hostnames', /\bdanger_accept_invalid_(?:certs|hostnames)\s*\(\s*true\s*\)/, 'builder.danger_accept_invalid_certs(true)', 'builder.danger_accept_invalid_certs(false)'),
  RSF('rs-weak-hash-crate', 'MD5 or SHA-1 is computed with a crate (broken for security)', /\bmd5::(?:compute|Md5)\b|\bSha1::new\(\)|\bsha1::Sha1\b/, 'let d = md5::compute(pw);', 'let d = Sha256::digest(pw);'),
  RSF('rs-thread-rng-secret', 'a key, token or nonce is made with thread_rng (use OsRng)', /\b(?:key|secret|token|nonce|password|salt)\w*\s*=\s*[^;\n]{0,80}\brand::thread_rng\(\)/i, 'let key = rand::thread_rng();', 'let key = OsRng;'),
  RSF('rs-secret-logged', 'a password, secret or token is printed or logged', /\b(?:println|eprintln|print|eprint|info|debug|warn|error|trace)!\([^\n]{0,120}\b(?:password|secret|token|api_key)\b/i, 'println!("token {}", token);', 'println!("ok")'),
  RSF('rs-sql-formatted', 'SQL is built with format! instead of bound parameters', /\b(?:execute|query|query_as|query_scalar)\(\s*&?format!\(/, 'conn.execute(&format!("DELETE FROM t WHERE id={}", id), [])', 'conn.execute("DELETE FROM t WHERE id = ?1", [id])'),
]

// ---------------------------------------------------------------- Java (cp-java)
export const JAVA = [
  JVF('java-runtime-exec-variable', 'Runtime.exec runs a command from a variable', /\bRuntime\.getRuntime\(\)\.exec\(\s*(?!"[^"\n]*"\s*\))/, 'Runtime.getRuntime().exec(cmd);', 'Runtime.getRuntime().exec("ls");'),
  JVF('java-processbuilder-variable', 'ProcessBuilder gets a program name from a variable', /\bnew\s+ProcessBuilder\(\s*(?!"[^"\n]*"\s*[,)])/, 'new ProcessBuilder(cmd)', 'new ProcessBuilder("ls", "-l")'),
  JVF('java-object-stream-read', 'Java object deserialization (readObject) or XMLDecoder runs on data that may be untrusted', /\bObjectInputStream\b[^\n]{0,80}\.readObject\(\)|\bnew\s+XMLDecoder\(/, 'new ObjectInputStream(in).readObject()', 'new ObjectOutputStream(out).writeObject(o)'),
  JVF('java-xxe-parser-factory', 'an XML parser factory is created without secure processing or DTD limits', undefined, 'DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();', 'DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();\nf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);', { test: (line, ctx) => /\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory)\.newInstance\(\)/.test(line) && !/FEATURE_SECURE_PROCESSING|setFeature\(|setProperty\(/.test(ctx.text) }),
  JVF('java-weak-digest', 'MD2, MD5 or SHA-1 is used through MessageDigest (broken for security)', undefined, 'MessageDigest.getInstance("MD5")', 'MessageDigest.getInstance("SHA-256")', { test: (line, ctx) => /\bMessageDigest\s*\.\s*getInstance\(\s*"(?:MD2|MD5|SHA-?1)"/.test(line) || (/^\s*\.getInstance\(\s*"(?:MD2|MD5|SHA-?1)"/.test(line) && /MessageDigest\s*$/.test(ctx.lines[ctx.index - 1] ?? '')) }),
  JVF('java-cipher-default-ecb', 'AES is requested with no mode, so Java uses ECB', /\bCipher\.getInstance\(\s*"AES"\s*\)/, 'Cipher.getInstance("AES")', 'Cipher.getInstance("AES/GCM/PKCS5Padding")'),
  JVF('java-cipher-no-padding', 'a cipher is set to NoPadding (padding attacks or wrong lengths)', /\bCipher\.getInstance\(\s*"[^"\n]{0,60}\/NoPadding"/, 'Cipher.getInstance("AES/CBC/NoPadding")', 'Cipher.getInstance("AES/CBC/PKCS5Padding")'),
  JVF('java-trust-all-certificates', 'a TrustManager accepts every certificate (empty checkServerTrusted)', undefined, 'public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException {}', 'public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException { verify(c, a); }', { test: (line) => /\bcheckServerTrusted\s*\([^)\n]{0,200}\)[^{\n]{0,120}\{\s*\}/.test(line) }),
  JVF('java-hostname-verifier-true', 'a HostnameVerifier always returns true', /\(\s*\w+\s*,\s*\w+\s*\)\s*->\s*true\b|\bverify\s*\([^)\n]{0,120}\)\s*\{\s*return\s+true\s*;/, 'HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);', 'HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> hostname.equals("x.example"));'),
  JVF('java-random-secret', 'a token, nonce or key is made with java.util.Random or Math.random (use SecureRandom)', /\b(?:token|secret|password|nonce|salt|sessionId|apiKey)\w*\s*=\s*[^;\n]{0,80}(?:\bnew\s+Random\(|\bMath\.random\()/i, 'String token = new Random().nextLong() + "";', 'SecureRandom token = new SecureRandom();'),
  JVF('java-random-token-method', 'java.util.Random or Math.random makes a value in a token, key, code or session method (use SecureRandom)', undefined, 'String newToken() {\n    return new Random().nextInt() + "";\n}', 'String newToken() {\n    return new SecureRandom().nextInt() + "";\n}', {
    test: (line, ctx) => /\bnew\s+(?:java\.util\.)?Random\s*\(|\bMath\.random\s*\(|\bThreadLocalRandom\.current\(\)/.test(line) && /token|secret|passw|nonce|session|api[_-]?key|\botp\b|csrf|reset|\bsalt\b|\bkey\b|\bpin\b|verif|invite|\bauth|\bcode\b|uuid|captcha|\bsid\b/i.test(ctx.lines.slice(Math.max(0, ctx.index - 3), ctx.index + 3).join('\n')),
  }),
  JVF('java-hardcoded-secret', 'a password, secret or key is typed straight into the code', /(?<![A-Za-z0-9])(?:password|passwd|secret|apiKey|api_key|privateKey)\w*\s*=\s*"[^"\n]{4,}"/i, 'String password = "hunter22";', 'String password = System.getenv("PW");'),
  JVF('java-statement-concat', 'SQL is built by concatenating a value into the string', /\.(?:executeQuery|executeUpdate|execute)\(\s*"[^"\n]{0,200}"\s*\+\s*\w/, 'stmt.executeQuery("SELECT * FROM u WHERE id=" + id);', 'ps.executeQuery();'),
  JVF('java-file-from-request', 'a file is opened at a path taken from the request', /\bnew\s+File(?:InputStream|OutputStream)?\(\s*(?:request|req)\.getParameter\(|\bPaths\.get\(\s*(?:request|req)\.getParameter\(/, 'new File(request.getParameter("f"))', 'new File(baseDir, "f.txt")'),
  JVF('java-spel-variable', 'a Spring expression is parsed from a variable (expression injection)', /\.parseExpression\(\s*(?!"[^"\n]*"\s*\))/, 'parser.parseExpression(input).getValue()', 'parser.parseExpression("1 + 1")'),
  JVF('java-ognl-el-sink', 'an OGNL or EL expression engine is called (expression injection sink)', /\bOgnlUtil\.|\bValueStack\b[^\n]{0,40}\.findValue\(|\bELProcessor\b[^\n]{0,60}\.eval\(/, 'OgnlUtil.getValue(expr, ctx)', 'Util.getValue(x)'),
  JVF('java-jndi-lookup-variable', 'a JNDI lookup uses a name from a variable', /\b(?:new\s+InitialContext\(\)|ctx|context|jndi)\.lookup\(\s*(?!"[^"\n]*"\s*\))/, 'ctx.lookup(name)', 'ctx.lookup("java:comp/env/jdbc/ds")'),
  JVF('java-log4shell-lookup-string', 'a JNDI lookup string (${jndi:) is written in the code (the Log4Shell pattern)', /\$\{jndi:/i, 'log.info("${jndi:ldap://x.example/a}")', 'log.info("plain text")'),
  JVF('java-static-iv', 'a cipher IV is a fixed literal', /\bnew\s+(?:IvParameterSpec|GCMParameterSpec)\([^\n]{0,40}"[^"\n]*"/, 'new IvParameterSpec("0123456789abcdef".getBytes())', 'new IvParameterSpec(iv)'),
  JVF('java-secret-key-literal', 'a secret key is built from a literal in the code', /\bnew\s+SecretKeySpec\(\s*"/, 'new SecretKeySpec("0123456789abcdef".getBytes(), "AES")', 'new SecretKeySpec(key, "AES")'),
  JVF('java-cookie-not-secure', 'a cookie is not marked Secure (setSecure(false))', /\.setSecure\(\s*false\s*\)/, 'cookie.setSecure(false);', 'cookie.setSecure(true);'),
  JVF('java-cors-any-origin', 'a CrossOrigin annotation allows any origin', /@CrossOrigin\s*(?:\(\s*(?:origins\s*=\s*)?"\*"\s*\)|$)|@CrossOrigin\(\s*origins\s*=\s*\{\s*"\*"/, '@CrossOrigin(origins = "*")', '@CrossOrigin(origins = "https://app.example")'),
  JVF('java-regex-from-request', 'a regular expression is compiled from a request value', /\bPattern\.compile\(\s*(?:request|req)\.getParameter\(/, 'Pattern.compile(request.getParameter("q"))', 'Pattern.compile("[a-z]+")'),
  JVF('java-ssl-old-protocol', 'an old SSL or TLS 1.0/1.1 context is requested', /\bSSLContext\.getInstance\(\s*"(?:SSL|SSLv2|SSLv3|TLSv1|TLSv1\.1)"/, 'SSLContext.getInstance("TLSv1")', 'SSLContext.getInstance("TLSv1.3")'),
  JVF('java-xpath-concat', 'an XPath expression is built by concatenating a value (XPath injection)', /\bxpath\w*\.(?:compile|evaluate)\(\s*"[^"\n]{0,200}"\s*\+/, 'xpath.compile("//u[@n=\'" + name + "\']")', 'xpath.compile("//u")'),
  JVF('java-ldap-filter-concat', 'an LDAP filter is built by concatenating a value (LDAP injection)', /"\(\s*\w+\s*=\s*\*?"\s*\+/, 'String f = "(uid=" + name + ")";', 'String f = "(uid=*)";'),
]

// ---------------------------------------------------------------- C#, PHP and Ruby (cp-dotnet-php-ruby)
export const DNP = [
  CSF('cs-binary-formatter', 'a .NET formatter that can run code during deserialization is used (BinaryFormatter, LosFormatter, NetDataContractSerializer)', /\b(?:BinaryFormatter|LosFormatter|NetDataContractSerializer|SoapFormatter)\b/, 'new BinaryFormatter().Deserialize(s)', 'JsonSerializer.Deserialize<T>(s)'),
  CSF('cs-typename-handling', 'Json.NET TypeNameHandling is set to read type names from the data', /\bTypeNameHandling\s*=\s*TypeNameHandling\.(?:All|Auto|Objects|Arrays)\b/, 'settings.TypeNameHandling = TypeNameHandling.All;', 'settings.TypeNameHandling = TypeNameHandling.None;'),
  CSF('cs-accept-any-certificate', 'the TLS certificate callback always returns true', /\bServerCertificateCustomValidationCallback\s*=\s*[^\n]{0,80}=>\s*true\b|\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)\s*=>\s*true\b/, 'h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true;', 'h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => e == SslPolicyErrors.None;'),
  CSF('cs-process-variable', 'Process.Start runs a program named by a variable', /\bProcess\.Start\(\s*(?!"[^"\n]*"\s*\))[A-Za-z_$@]|\bProcess\.Start\(\s*@?"[^"\n]{1,100}"\s*,\s*(?:\$@?"[^"\n]*\{|@?"[^"\n]*"\s*\+|string\.Format\(|[A-Za-z_])|\bArguments\s*=\s*(?:\$@?"[^"\n]*\{|@?"[^"\n]*"\s*\+|string\.Format\(|[A-Za-z_]\w*\s*[;,)])|\bFileName\s*=\s*(?:\$@?"[^"\n]*\{|@?"[^"\n]*"\s*\+|[A-Za-z_]\w*\s*[;,)])/, 'Process.Start(cmd)', 'Process.Start("notepad.exe")'),
  CSF('cs-weak-hash', 'MD5 or SHA-1 is used (broken for security)', /\b(?:MD5|SHA1)\.Create\(|\bMD5CryptoServiceProvider\b|\bSHA1Managed\b/, 'var h = MD5.Create();', 'var h = SHA256.Create();'),
  CSF('cs-weak-cipher', 'DES, RC2 or 3DES is used (weak)', /\b(?:DESCryptoServiceProvider|TripleDESCryptoServiceProvider|RC2CryptoServiceProvider|DES\.Create\(|RC2\.Create\(|TripleDES\.Create\()/, 'var c = DES.Create();', 'var c = Aes.Create();'),
  CSF('cs-ecb-mode', 'ECB cipher mode is selected (identical blocks encrypt identically)', /\bCipherMode\.ECB\b/, 'c.Mode = CipherMode.ECB;', 'c.Mode = CipherMode.CBC;'),
  CSF('cs-random-secret', 'a token, key or nonce is made with System.Random (not cryptographic)', /\b(?:token|key|secret|password|nonce|salt)\w*\s*=\s*[^;\n]{0,80}\bnew\s+(?:System\.)?Random\(/i, 'var token = new Random().Next().ToString();', 'var token = RandomNumberGenerator.GetBytes(32);'),
  CSF('cs-sql-concat', 'SQL is built by concatenating a value into the string', /"(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]{0,200}"\s*\+/, 'var q = "SELECT * FROM u WHERE id=" + id;', 'var q = "SELECT * FROM u WHERE id=@id";'),
  CSF('cs-xmltextreader', 'XmlTextReader is used, which does not lock down entity resolution', /\bnew\s+XmlTextReader\(/, 'var r = new XmlTextReader(s);', 'var r = XmlReader.Create(s, settings);'),
  CSF('cs-cookie-insecure', 'a cookie is set without HttpOnly or Secure', /\b(?:HttpOnly|Secure)\s*=\s*false\b/, 'new CookieOptions { HttpOnly = false }', 'new CookieOptions { HttpOnly = true }'),
  CSF('cs-hardcoded-secret', 'a password, secret or key is typed straight into the code', /(?<![A-Za-z0-9])(?:password|secret|apiKey)\w*\s*=\s*@?"[^"\n]{4,}"/i, 'var password = "hunter22";', 'var password = config["pw"];'),
  CSF('cs-raw-html', 'Html.Raw outputs a value without escaping', /@Html\.Raw\(/, '@Html.Raw(model.Comment)', '@model.Comment'),
  CSF('cs-jwt-check-off', 'a JWT check (issuer, lifetime, audience or signing key) is turned off', /\b(?:ValidateIssuerSigningKey|ValidateLifetime|ValidateAudience|ValidateIssuer|RequireSignedTokens)\s*=\s*false\b/, 'ValidateIssuerSigningKey = false', 'ValidateIssuerSigningKey = true'),
  CSF('cs-antiforgery-ignored', 'a controller action ignores the anti-forgery token', /\[IgnoreAntiforgeryToken\]/, '[IgnoreAntiforgeryToken]', '[ValidateAntiForgeryToken]'),
  PHPF('php-eval-assert', 'eval or assert runs text as PHP code', /(?<![\w$>:.])(?:eval|assert)\s*\(/, 'eval($code);', '$n = intval($raw);'),
  PHPF('php-preg-replace-e-modifier', 'preg_replace uses the removed /e modifier (runs the replacement as code)', /\bpreg_replace\s*\(\s*['"][^'"\n]{0,200}\/[a-z]*e[a-z]*['"]/, 'preg_replace("/(x)/e", $r, $s)', 'preg_replace("/(x)/i", $r, $s)'),
  PHPF('php-unserialize-variable', 'unserialize is given data that is not a fixed string', /\bunserialize\s*\(\s*(?!['"][^'"\n]*['"]\s*\))/, 'unserialize($_COOKIE["d"])', 'json_decode($s, true)'),
  PHPF('php-extract-request', 'extract() turns request values into variables', /\bextract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)\b/, 'extract($_GET);', '$id = (int) $_GET["id"];'),
  PHPF('php-include-variable', 'include or require loads a file named by a variable', /(?<![\w$])(?:include|require)(?:_once)?\s*\(?\s*\$/, 'include $page;', 'include "header.php";'),
  PHPF('php-shell-variable', 'a shell function runs a command from a variable', /(?<![\w>$.:])(?:system|exec|shell_exec|passthru|popen|proc_open)\s*\(\s*(?:\$|"[^"\n]*\$\w|'[^'\n]*'\s*\.)|\x60[^\x60\n]*\$\w[^\x60\n]*\x60/, 'system($cmd);', 'system("ls");'),
  PHPF('php-random-token', 'a token, key or nonce is made with rand, mt_rand or uniqid (not cryptographic)', /\$(?:token|key|secret|password|nonce|salt)\w*\s*=\s*[^;\n]{0,60}\b(?:rand|mt_rand|uniqid)\s*\(/i, '$token = mt_rand();', '$token = bin2hex(random_bytes(16));'),
  PHPF('php-sql-interpolated', 'SQL is written in a double-quoted PHP string with a variable inside, or joined to the next line', /"(?:SELECT\b[^"\n]{1,200}\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^"\n]{0,200}(?:\$\w|\{\$)|"(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]{0,200}"\s*\.\s*$/i, '$q = "SELECT * FROM u WHERE id = $id";', '$q = "SELECT * FROM u WHERE id = ?";'),
  PHPF('php-mysql-legacy', 'the removed mysql_* functions are used (no prepared statements)', /\bmysql_(?:query|connect|select_db|real_escape_string|fetch_array|fetch_assoc)\s*\(/, 'mysql_query($sql)', '$pdo->query($sql)'),
  PHPF('php-display-errors-on', 'display_errors is on, so errors and paths are shown to visitors', /\bini_set\s*\(\s*['"]display_errors['"]\s*,\s*['"]?(?:1|on|true)\b|\bdisplay_errors\s*=\s*(?:On|1|true)\b/i, "ini_set('display_errors', '1');", "ini_set('display_errors', '0');"),
  PHPF('php-sql-concat', 'SQL is built by concatenating a value or a request field', /\b(?:mysqli_query|mysql_query|pg_query)\s*\([^\n]{0,80}\$_(?:GET|POST|REQUEST|COOKIE)\b|"(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]{0,200}"\s*\.\s*\$/, '$r = mysqli_query($c, "SELECT * FROM u WHERE id=" . $id);', '$s = $pdo->prepare("SELECT * FROM u WHERE id = ?");'),
  PHPF('php-file-from-request', 'a file function reads a path taken from the request', /\b(?:file_get_contents|fopen|readfile|include|require|file)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)\b/, 'readfile($_GET["f"]);', 'readfile("notes.txt");'),
  PHPF('php-libxml-loader-off-false', 'libxml entity loader is switched off, so XML external entities are read', /\blibxml_disable_entity_loader\s*\(\s*false\s*\)/, 'libxml_disable_entity_loader(false);', 'libxml_disable_entity_loader(true);'),
  PHPF('php-curl-verify-off', 'cURL does not verify the server certificate or host name', /CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:false|0)\b/, 'curl_setopt($c, CURLOPT_SSL_VERIFYPEER, false);', 'curl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);'),
  RBF('rb-eval-params', 'eval or instance_eval runs text from params or the request', /(?<![\w.:])(?:eval|instance_eval|class_eval|module_eval)\s*\(?\s*(?:params|request|cookies)\b/, 'eval(params[:code])', 'eval("1 + 1")'),
  RBF('rb-send-params', 'send, constantize or find a method or class named by params', /(?:^|[\s.(=,])(?:send|public_send|__send__|try|instance_variable_get|instance_variable_set|const_get|method|define_method)\(?\s*(?:params|request\.|cookies)\b|\b(?:params|request\.\w+|cookies)\b[^\n]{0,60}\.(?:constantize|safe_constantize|to_sym\.to_proc)\b|\.(?:constantize|safe_constantize)\(?\s*params\b/, 'User.send(params[:m])', 'User.where(id: params[:id])'),
  RBF('rb-marshal-load', 'Marshal.load can build arbitrary objects from data', /\bMarshal\.load\(/, 'obj = Marshal.load(data)', 'obj = JSON.parse(data)'),
  RBF('rb-weak-digest', 'MD5 or SHA-1 is used through Digest or OpenSSL (broken for security)', /\bDigest::(?:MD5|SHA1)\b|\bOpenSSL::Digest(?:::(?:MD5|SHA1)\b|\.new\(\s*['"](?:MD5|SHA1)['"])|\bOpenSSL::Digest::(?:MD5|SHA1)\b/i, 'Digest::MD5.hexdigest(text)', 'Digest::SHA256.hexdigest(text)'),
  RBF('rb-random-token', 'a token, key or code is made with rand or Random (not cryptographic; use SecureRandom)', /\b(?:token|key|secret|password|nonce|salt|otp|code|reset|session)\w*\s*=\s*[^\n]{0,80}(?:\b(?:Kernel\.|Random\.)?rand\b|\bRandom\.new\b|\.sample\b|\.shuffle\b)/i, 'token = rand(100000)', 'token = SecureRandom.hex(16)'),
  RBF('rb-sql-interpolation', 'SQL fragment in a string with #{} inside (where, order, execute...)', /\.(?:where|having|order|group|joins|find_by_sql|select|pluck|exists\?|delete_all|update_all|execute|exec_query)\s*\(\s*"[^"\n]{0,200}#\{/, 'User.where("name = \'#{n}\'")', 'User.where(name: n)'),
  RBF('rb-yaml-unsafe', 'YAML is loaded with the unsafe loader (it can build Ruby objects)', /\bYAML\.unsafe_load(?:_file)?\(/, 'YAML.unsafe_load(s)', 'YAML.safe_load(s)'),
  RBF('rb-system-interpolation', 'a shell command has a #{} interpolation in its string', /(?<![\w.])(?:system|exec|spawn|IO\.popen|Open3\.\w+)\s*\(?\s*"[^"\n]{0,200}#\{|`[^`\n]{0,200}#\{/, 'system("ls #{dir}")', 'system("ls", dir)'),
  RBF('rb-permit-all', 'strong parameters allow every field (permit!)', /\.permit!/, 'params.permit!', 'params.require(:user).permit(:name)'),
  RBF('rb-html-safe', 'a string is marked html_safe, so it is not escaped', /\.html_safe\b/, 'name.html_safe', 'ERB::Util.html_escape(name)'),
  RBF('rb-csrf-skipped', 'CSRF token checking is skipped for a controller', /\bskip_(?:before_action|before_filter)\s+:verify_authenticity_token\b|\bskip_forgery_protection\b/, 'skip_before_action :verify_authenticity_token', 'before_action :authenticate_user!'),
  RBF('rb-open-params', 'open() is given a request value (a leading | runs a command)', /(?<![\w.:])open\(\s*params\b|\bKernel\.open\(/, 'open(params[:f])', 'File.read(path)'),
  RBF('rb-render-params', 'render takes its template name from params', /\brender\s+(?:params|request)\b|\brender\s*\(\s*(?:file|template)\s*:\s*params\b/, 'render params[:page]', 'render "pages/home"'),
  RBF('rb-catch-all-route', 'a route catches every path (a wildcard route)', /^\s*(?:match|get|post|put|patch|delete)\s+['"]\*\w*['"]/, 'get "*path", to: "pages#show"', 'get "about", to: "pages#about"'),
]

// The check name -> its rule table. A table with no matching files in a project reports NA for each rule (see thorough/code-patterns.mjs).
export const CHECK_TABLES = {
  'cp-python': PY,
  'cp-js': JS,
  'cp-go': GO,
  'cp-rust': RS,
  'cp-java': JAVA,
  'cp-dotnet-php-ruby': DNP,
}
