// Security checks that read the code as plain text, so no tool has to be installed. They look for the common ways a web app
// or service gets hurt: open CORS, cookies without flags, weak JWTs, SQL built from strings, and so on.
// Run through the security-plus pack, or by hand:
//   node thorough/sec-code.mjs <check> [--root <dir>]      node thorough/sec-code.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-seccode-allow: a path (accepts the whole file) or path:line, one per line, # for comments.
import { finish, main, readText, trackedFiles, withFixture } from './kit.mjs'

const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|kt|cs|svelte|vue)$/i
const CONFIG = /\.(ya?ml|toml|json|ini|env|conf|cfg|properties|xml)$|(^|\/)\.env[^/]*$|(^|\/)(Dockerfile[^/]*|docker-compose[^/]*)$/i
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|tests?|__tests__|fixtures?|spec|examples?|docs?)\/|\.(test|spec)\.[a-z]+$|\.min\.(m?js|css)$|(^|\/)sec-code\.mjs$/i
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|mov|wasm|bin|exe|dll|so|dylib|lock|svg)$/i
const COMMENT = /^\s*(\/\/|#|\/\*|\*|--\s)/

const code = (x) => SOURCE.test(x)
const codeOrConfig = (x) => SOURCE.test(x) || CONFIG.test(x)
const js = (x) => /\.(m?[jt]sx?|cjs)$/i.test(x)
const py = (x) => /\.py$/i.test(x)
const deployFile = (x) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*|compose[^/]*\.ya?ml|[^/]*\.prod[^/]*|[^/]*production[^/]*)$/i.test(x)
const configFile = (x) => /\.(toml|ini|cfg|conf|ya?ml|json|xml|properties)$/i.test(x) || /(^|\/)(config|settings)[^/]*$/i.test(x)

const allowSet = (root) => new Set(readText(root, '.meerkat-seccode-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const lineNo = (t, i) => t.slice(0, i).split('\n').length

// Every match of re that is not on a comment-only line. Each hit has m (the match), at (its index), line (1-based) and text (the whole line).
function hits(t, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const out = []
  for (const m of t.matchAll(g)) {
    const start = m.index === 0 ? 0 : t.lastIndexOf('\n', m.index - 1) + 1
    const end = t.indexOf('\n', m.index)
    const text = t.slice(start, end < 0 ? t.length : end)
    if (COMMENT.test(text)) continue
    out.push({ m, at: m.index, line: lineNo(t, m.index), text })
  }
  return out
}

// The lines from `line` (1-based) with `before` lines above and `after` lines below.
const near = (t, line, before, after) => t.split('\n').slice(Math.max(0, line - 1 - before), line + after).join('\n')
// The text from index `at` for `n` lines.
const after = (t, at, n) => t.slice(at).split('\n').slice(0, n).join('\n')
// A call's text from its opening parenthesis to the matching close (or 600 characters if it never closes).
const callText = (t, open) => {
  let depth = 0
  for (let i = open; i < Math.min(t.length, open + 600); i++) {
    if (t[i] === '(') depth++
    else if (t[i] === ')' && --depth === 0) return t.slice(open, i + 1)
  }
  return t.slice(open, open + 600)
}

// A rule flags each match of re. why is the message, or a function (text, hit, file) that returns the message or null to let it go.
const pat = (files, re, why) => ({
  files,
  scan: (t, x) => hits(t, re).map((h) => ({ line: h.line, why: typeof why === 'function' ? why(t, h, x) : why })).filter((r) => r.why),
})

// Runs every rule over the files git tracks (a plain walk outside a repository) and returns the findings as text.
function runRules(root, rules) {
  const allow = allowSet(root)
  const f = []
  for (const x of trackedFiles(root)) {
    if (SKIP.test(x) || BINARY.test(x) || allow.has(x)) continue
    const t = readText(root, x)
    for (const r of rules) {
      if (!r.files(x)) continue
      for (const { line, why } of r.scan(t, x)) {
        const where = line ? `${x}:${line}` : x
        if (!allow.has(where)) f.push(`${where} ${why}`)
      }
    }
  }
  return f
}

const define = (id, rules, ok, fixture) => {
  const run = (root) => finish(id, runRules(root, rules), ok)
  return { run, fixture: () => withFixture(fixture, run) }
}

// ---- cors-wildcard: any site may read responses that carry credentials
const CORS_CREDENTIALS = /credentials['"]?\s*[:=,\]]\s*['"]?true\b/i
const corsWildcard = pat(codeOrConfig, /\borigin['"]?\s*[:=,]\s*(?:true|['"]\*['"])|Access-Control-Allow-Origin['"]?\s*[:=,)]\s*['"]\*['"]/i, (t, h) =>
  CORS_CREDENTIALS.test(t.slice(Math.max(0, h.at - 200), h.at + 300)) ? 'allows every website to send requests with credentials (any origin plus credentials)' : null)
const corsReflect = {
  files: code,
  scan: (t) => hits(t, /Access-Control-Allow-Origin['"]?\s*[:=,)]\s*[^\n;]*?\b(?:req|request|r|ctx)\b[^\n;]*?origin/i)
    .filter((h) => !/allowed|allowlist|whitelist|includes\(|indexOf\(|\bhas\(|\.test\(/i.test(near(t, h.line, 4, 0)))
    .map((h) => ({ line: h.line, why: "copies the caller's Origin header into Access-Control-Allow-Origin with no check against a list of allowed sites" })),
}

// ---- cookie-flags: a cookie set without HttpOnly, Secure and SameSite
const cookieFlags = pat(code, /\bres\.cookie\s*\(|\bset_cookie\s*\(|\bcookies\.set\s*\(|\bSetCookie\s*\(|\bCookie::(?:new|build)\s*\(|\bSet-Cookie\b/i, (t, h) => {
  let win = after(t, h.at, 4)
  if (h.m[0].endsWith('(')) {
    const open = h.at + h.m[0].length - 1
    const call = callText(t, open)
    win = call + after(t, open + call.length, 4)
  }
  const missing = [['HttpOnly', /http_?only/i], ['Secure', /\bsecure\b/i], ['SameSite', /same_?site/i]].filter(([, re]) => !re.test(win)).map(([name]) => name)
  return missing.length ? `sets a cookie with no ${missing.join(', ')} setting (checked in the call and the 3 lines after it)` : null
})

// ---- jwt-weak: tokens accepted without a real signature, or signed with a secret typed into the code
const jwtRules = [
  pat(code, /\balg(?:orithm)?s?['"]?\s*[:=]\s*\[?\s*['"]none['"]/i, 'accepts unsigned tokens (algorithm "none"), so anyone can forge one'),
  pat(code, /\bverify_signature['"]?\s*[:=]\s*(?:False|false)\b/, 'reads a token without checking its signature'),
  pat(js, /\bjwt\.decode\s*\(/, (t) => /\b(?:req|request)\.(?:user|session)\b|isAuthenticated|authenticate|requireAuth|currentUser/.test(t) && !/\.verify\s*\(|jwtVerify/.test(t)
    ? 'reads a token with jwt.decode, which skips the signature check, in a file that looks like it decides who is signed in'
    : null),
  pat(code, /\b(?:jwt|jsonwebtoken|JWT)\.(?:sign|verify|encode|decode)\s*\([^\n;]*?,\s*(['"])([^'"\n]{4,})\1/, 'signs or checks a token with a secret typed into the code (move it to an environment variable)'),
]

// ---- hardcoded-ip: a public IPv4 address written into the code
const publicIp = (ip) => {
  const [a, b, c] = ip.split('.').map(Number)
  if (ip.split('.').some((n) => Number(n) > 255)) return false
  if (a === 0 || a === 10 || a === 127 || a === 255 || a >= 224) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || (b === 0 && c === 2))) return false
  if (a === 169 && b === 254) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 198 && ((b === 51 && c === 100) || b === 18 || b === 19)) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}
const hardcodedIp = {
  files: (x) => codeOrConfig(x),
  scan: (t, x) => {
    if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$/.test(x)) return []
    return hits(t, /(?<![\w.\/-])(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?![\w.\/-])/)
      .filter((h) => publicIp(h.m[1]) && !/version/i.test(h.text))
      .map((h) => ({ line: h.line, why: `contains the address ${h.m[1]}, a public IP written into the code (move it to configuration)` }))
  },
}

// ---- debug-enabled: debug mode switched on where it should be off
const debugRules = [
  pat(py, /^DEBUG\s*=\s*True\b/m, 'DEBUG = True: errors show stack traces and settings to anyone who triggers one'),
  pat(py, /\bapp\.run\s*\([^)\n]*\bdebug\s*=\s*True/, 'app.run(debug=True): the Flask debugger can let a visitor run code on the server'),
  pat(deployFile, /NODE_ENV\s*[=:]\s*['"]?development\b/i, 'NODE_ENV is development in a deployment file (development mode is looser and slower)'),
  pat(codeOrConfig, /\bdevtools\s*:\s*true\b/, 'devtools: true opens the developer tools in the shipped app'),
  pat(configFile, /^\s*Debug\s*=\s*true\b/m, 'Debug = true in a config file (debug mode is on wherever this file is used)'),
]

// ---- sql-concat: SQL built by joining text and values together
const SQL_KW = /\b(?:SELECT|INSERT|UPDATE|DELETE|select|insert|update|delete)\b/
const SQL_TEMPLATE = /\b(?:query|execute|executemany|raw|exec|prepare|queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\s*\(\s*`(?=[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|select|insert|update|delete)\b)[^`]*\$\{/
const SQL_CONCAT = /\b(?:query|execute|executemany|raw|exec|prepare|sql_query|raw_sql)\s*\(\s*(['"])(?:(?!\1)[^\n])*?\b(?:SELECT|INSERT|UPDATE|DELETE|select|insert|update|delete)\b(?:(?!\1)[^\n])*?\1\s*(?:\+|%|\.format\s*\()/
const SQL_FORMAT = /\b(?:query|execute\w*|executemany|raw|exec|prepare|queryRaw\w*|executeRaw\w*|sql_query|raw_sql|Query\w*|Exec\w*)\s*\(\s*(?=[^\n]*\b(?:SELECT|INSERT|UPDATE|DELETE|select|insert|update|delete)\b)(?:f(['"])[^\n]*?\{|fmt\.Sprintf\(|format!\(|&format!\(|(['"])[^\n]*?\2\s*\.format\()/
// A line holding a whole SQL statement shape in a string literal that is joined to a value on the same line (+, %, .format, an f-string,
// $"...{x}", a template, "...$x", "...#{x}", Sprintf, String.format) or that ends in a + or . so the value comes on the next line.
const SQL_SHAPE = /\b(?:SELECT\b[^"'\x60\n]{1,200}\bFROM|INSERT\s+INTO|UPDATE\s+[\w.\x60"\[\]]{1,60}\s+SET|DELETE\s+FROM)\b/i
const SQL_JOIN = /["'\x60]\s*(?:\+|%\s*[\w(]|\.format\s*\(|\.\s*\$|\.\s*$|\.\s*[A-Za-z_]\w*\s*\.)|\bf["'][^"'\n]*\{|\$@?"[^"\n]*\{|\x60[^\x60\n]*\$\{|"[^"\n]*(?:\$\w|#\{)|\b(?:fmt\.Sprintf|String\.format|format!|sprintf|Format)\s*\(/
const RB_SQL_INTERP = /\.(?:where|having|order|group|joins|find_by_sql|select|pluck|exists\?|delete_all|update_all|execute|exec_query)\s*\(\s*"[^"\n]{0,200}#\{/
const sqlBuilt = {
  files: code,
  scan: (t) => {
    const found = new Map()
    for (const [i, line] of t.split('\n').entries()) {
      if (line.length > 600 || COMMENT.test(line)) continue
      if ((SQL_SHAPE.test(line) && SQL_JOIN.test(line)) || RB_SQL_INTERP.test(line)) found.set(i + 1, { line: i + 1, why: 'builds an SQL statement by joining text and values together (use placeholders such as $1 or ?)' })
    }
    for (const re of [SQL_TEMPLATE, SQL_CONCAT, SQL_FORMAT]) {
      for (const h of hits(t, re)) if (!found.has(h.line)) found.set(h.line, { line: h.line, why: 'builds an SQL statement by joining text and values together (use placeholders such as $1 or ?)' })
    }
    return [...found.values()]
  },
}

// ---- path-traversal-pattern: a file read or sent with a path taken straight from the request
const REQ = /\b(?:req|request|ctx|c)\.(?:query|params|body|args|form|values|GET|POST|files|json)\b|\blocation\.(?:search|hash)\b|\bURLSearchParams\b|\bsearchParams\b|\br\.URL\.Query\(|\bc\.(?:Query|Param)\(|\$_(?:GET|POST|REQUEST|COOKIE)\b|\bparams\[/
const FILE_API = /(?:\b(?:readFile\w*|createReadStream|createWriteStream|sendFile|download|writeFile\w*|unlink\w*|readdir\w*|send_file|send_from_directory|ReadFile|os\.Open|os\.ReadFile|os\.Create|File::open|fs::read\w*|fs::write\w*)|(?<![.\w])open)\s*\(/
const PATH_GUARD = /path\.(?:resolve|normalize|basename)|os\.path\.basename|filepath\.(?:Clean|Rel|Base)|startsWith\(|is_relative_to|realpath|secure_filename|safe_join|canonicalize/
// The first argument of the call at hit h (the path, for every file API here).
const firstArg = (t, h) => {
  const call = callText(t, h.at + h.m[0].length - 1).slice(1)
  let depth = 0
  for (let i = 0; i < call.length; i++) {
    const ch = call[i]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) {
      if (depth === 0) return call.slice(0, i)
      depth--
    } else if (ch === ',' && depth === 0) return call.slice(0, i)
  }
  return call
}
const pathTraversal = {
  files: code,
  scan: (t) => {
    const taint = new Set()
    for (const l of t.split('\n')) {
      if (!REQ.test(l)) continue
      const a = /([A-Za-z_]\w*)\s*(?::=|=(?![=>]))/.exec(l)
      if (a) taint.add(a[1])
    }
    return hits(t, FILE_API)
      .filter((h) => (REQ.test(firstArg(t, h)) || [...taint].some((n) => new RegExp(`\\b${n}\\b`).test(firstArg(t, h)))) && !PATH_GUARD.test(near(t, h.line, 15, 15)))
      .map((h) => ({ line: h.line, why: 'reads or sends a file using a path taken straight from the request, with no path check nearby (use path.basename, or check the resolved path stays inside your folder)' }))
  },
}

// ---- open-redirect-pattern: a redirect to an address taken from the request, with no allow-list check
const REDIRECT = /\bredirect\s*\(|\bRedirect\s*\(|['"]Location['"]\s*(?:[,:\]=])|['"]Location:|(?<![\w$.])(?:window\.|document\.|self\.|top\.)?location(?:\.href)?\s*=(?!=)|\blocation\.(?:assign|replace)\s*\(/
const ALLOW_CHECK = /allow|whitelist|includes\(|indexOf\(|startsWith\(\s*['"]\/|isSafe|isLocal|is_safe_url|allowed_hosts|url_has_allowed|isRelative/i
const openRedirect = {
  files: code,
  scan: (t) => hits(t, REDIRECT)
    .filter((h) => REQ.test(h.m[0].endsWith('(') ? h.text + ' ' + callText(t, h.at + h.m[0].length - 1) : h.text) && !ALLOW_CHECK.test(near(t, h.line, 4, 10)))
    .map((h) => ({ line: h.line, why: 'sends people to an address taken from the request with no allow-list check (send them only to your own pages)' })),
}

// ---- regex-dos: a regular expression that can take exponential time
const regexSources = (t) => [
  ...hits(t, /(?<=[=(,:\[!&|?{;]\s*|\breturn\s+)\/((?:[^\/\\\n]|\\.)+)\/[dgimsuy]*/).map((h) => ({ line: h.line, src: h.m[1] })),
  ...hits(t, /new\s+RegExp\s*\(\s*(['"`])((?:(?!\1)[^\n\\]|\\.)*)\1/).map((h) => ({ line: h.line, src: h.m[2].replace(/\\\\/g, '\\') })),
  ...hits(t, /\bre\.(?:compile|match|search|fullmatch|sub|findall|finditer|split)\s*\(\s*r?(['"])((?:(?!\1)[^\n\\]|\\.)*)\1/).map((h) => ({ line: h.line, src: h.m[2] })),
]
const repeatRisk = (src) => {
  const s = src.replace(/\\./g, '~').replace(/\[(?:[^\]\\]|\\.)*\]/g, 'C')
  // A single repeated token inside an open-ended repeat, such as (a+)+, (.*)*, (\s*)* or ([a-z]+)*. Bounded repeats and longer bodies are left alone.
  if (/\((?:\?:)?(?:[~C.]|[a-zA-Z0-9])[+*]\)(?:[+*]|\{\d+,\})/.test(s)) return 'a group that repeats is itself repeated'
  // A repeated token followed by an optional one inside an open-ended repeat, such as (\w+\s?)+: the optional part lets the same text split many ways.
  if (/\((?:\?:)?(?:[~C.]|[a-zA-Z0-9])[+*](?:[~C.]|[a-zA-Z0-9])[?*]\)(?:[+*]|\{\d+,\})/.test(s)) return 'a group that repeats is itself repeated'
  for (const m of s.matchAll(/\((?:\?:)?([^()]*\|[^()]*)\)(?:[+*]|\{\d)/g)) {
    const alts = m[1].split('|').filter(Boolean)
    if (alts.some((a, i) => alts.some((b, j) => i !== j && b.startsWith(a)))) return 'a repeated choice where one option is the start of another'
  }
  return null
}
const regexDos = {
  files: code,
  scan: (t) => regexSources(t)
    .map((r) => ({ line: r.line, risk: repeatRisk(r.src) }))
    .filter((r) => r.risk)
    .map((r) => ({ line: r.line, why: `a regular expression can take exponential time on some input (${r.risk}), which can freeze the program` })),
}

// ---- weak-crypto-modes: broken ciphers, ECB mode, fixed keys, guessable tokens, MD5 on passwords
const md5Password = {
  files: code,
  scan: (t) => hits(t, /createHash\(\s*['"]md[45]['"]|hashlib\.md[45]\(|\bMD[45]\b|\bmd[45]\s*\(/i)
    .filter((h) => /passw|passwd|\bpwd\b/i.test(near(t, h.line, 3, 0)))
    .map((h) => ({ line: h.line, why: 'MD4 or MD5 is used on what looks like a password (use bcrypt, scrypt or argon2)' })),
}
const TOKENISH = /token|secret|passw|nonce|session|api[_-]?key|\botp\b|csrf|reset|\bsalt\b|\bkey\b|\bpin\b|verif|invite|\bauth|\bcode\b|uuid|captcha|\bsid\b|\bid_?gen/i
const weakCrypto = [
  pat(code, /\bcreate(?:De)?[Cc]ipher\s*\(/, 'createCipher uses no IV, so the same key always gives the same output (use createCipheriv with a random IV)'),
  pat(code, /\bcreate(?:De)?[Cc]ipheriv\s*\(\s*['"](?:des|rc4|bf|blowfish|aes-\d+-ecb)/i, 'a weak or unsafe cipher (DES, RC4, Blowfish or ECB mode) is named'),
  pat(code, /getInstance\s*\(\s*"(?:DES|RC4|ARCFOUR|Blowfish|[A-Za-z0-9]+\/ECB)/, 'a weak or unsafe cipher (DES, RC4, Blowfish or ECB mode) is named'),
  pat(code, /\b(?:DES3?|ARC4|ARC2|Blowfish)\.new\s*\(|\b(?:des|rc4|blowfish)\.NewCipher\s*\(/, 'a weak cipher (DES, RC4 or Blowfish) is used'),
  pat(code, /\bMODE_ECB\b/, 'ECB mode: identical blocks encrypt to identical output (use GCM, or CBC with a random IV)'),
  pat(code, /(?:Cipheriv|Decipheriv)\s*\([^\n]*?(?:Buffer\.from|new Buffer)\(\s*['"]|\b(?:key|iv|IV|secretKey)\s*[:=]\s*(?:Buffer\.from|new Buffer)\(\s*['"]|\b(?:AES|DES3?|ChaCha20\w*)\.new\(\s*b?['"]|\b(?:key|iv|IV|KEY)\s*=\s*b['"][^'"\n]{4,}['"]/,
    'a cipher key or IV is written into the code (load it from a secret store or an environment variable)'),
  // The generator call, or the name it is assigned to / the function it sits in (up to 3 lines above), says token, secret, key, code...
  pat(code, /(?<!['"\`])(?:\b(?:Math\.random|random\.(?:random|choice|choices|randint|randrange|getrandbits|sample)|(?:Kernel\.|Random\.)?rand|mt_rand|lcg_value|uniqid|rand\.(?:Int|Intn|Int31n?|Int63n?|Uint32|Uint64|Float64|Read)|Random\.new|SecureRandom\.hex\(\s*\d{1,2}\s*\)\.to_i|new\s+(?:java\.util\.)?Random)\s*\(|\bnew\s+Random\b\s*(?!\())/, (t, h) => TOKENISH.test(near(t, h.line, 3, 0))
    ? 'a random number from a generator that is not secure makes a token or secret (use crypto.randomBytes, Python secrets, SecureRandom, random_bytes or crypto/rand)'
    : null),
  md5Password,
]

// ---- credentials-in-urls: a user name and password written into a web address
const URL_CRED = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:\/@'"<>]+):([^\s\/@'"<>]+)@[^\s'"<>]+/i
const FAKE_PART = /^(user(name)?|pass(word)?|pwd|name|login|your\w*|example|changeme|xxx+|x+|\*+)$/i
const credsInUrl = pat(codeOrConfig, URL_CRED, (t, h) => (FAKE_PART.test(h.m[1]) || FAKE_PART.test(h.m[2]) || /[<>{}$%]/.test(h.m[1] + h.m[2]))
  ? null
  : 'a web address has a user name and password written into it (move them to an environment variable)')

// ---- xxe-and-deserialize: XML that reads outside files, and objects loaded from untrusted data
const xmlDoc = {
  files: (x) => /\.(java|kt)$/i.test(x),
  scan: (t) => {
    if (!/DocumentBuilderFactory/.test(t) || /disallow-doctype-decl|external-general-entities|setExpandEntityReferences\s*\(\s*false/.test(t)) return []
    return hits(t, /DocumentBuilderFactory\.newInstance\s*\(/).slice(0, 1)
      .map((h) => ({ line: h.line, why: 'XML parser has no DOCTYPE or entity limits set (XXE can read local files; set disallow-doctype-decl)' }))
  },
}
const xxeDeser = [
  pat(code, /\bresolve_entities\s*=\s*True\b/, 'XML parser resolves external entities (XXE can read local files)'),
  pat(code, /\bnoent\s*:\s*true\b/, 'XML parser expands external entities (XXE can read local files)'),
  xmlDoc,
  pat((x) => /\.(java|kt)$/i.test(x), /\.readObject\s*\(/, (t) => /ObjectInputStream/.test(t)
    ? 'reads a Java object from a stream (crafted data can run code while it loads; avoid it for untrusted input)'
    : null),
  pat((x) => /\.php$/i.test(x), /\bunserialize\s*\([^\n]*(?:\$_(?:GET|POST|REQUEST|COOKIE)\b|php:\/\/input)/, 'unserialize() on request data can run code (use json_decode)'),
  pat((x) => /\.rb$/i.test(x), /\b(?:Marshal\.load|YAML\.load)\s*\([^\n]*(?:params|request|cookies|body)/, 'Marshal.load or YAML.load on request data can run code (use JSON, or YAML.safe_load)'),
  pat((x) => /\.cs$/i.test(x), /\bnew\s+BinaryFormatter\s*\(/, 'BinaryFormatter runs code from crafted data (Microsoft says never to use it on untrusted input)'),
]

main({
  'cors-wildcard': define('cors-wildcard', [corsWildcard, corsReflect], 'no CORS setting lets any site read responses that carry credentials',
    { 'api.js': "res.setHeader('Access-Control-Allow-Origin', req.headers.origin)\n" }),
  'cookie-flags': define('cookie-flags', [cookieFlags], 'every cookie that is set has HttpOnly, Secure and SameSite',
    { 'app.js': "res.cookie('session', token)\n" }),
  'jwt-weak': define('jwt-weak', jwtRules, 'tokens are checked with a real signature and a secret kept out of the code',
    { 'auth.js': "const t = jwt.sign({ id: 1 }, 'hunter22')\n" }),
  'hardcoded-ip': define('hardcoded-ip', [hardcodedIp], 'no public IP address is written into the code',
    { 'server.js': "const upstream = '45.33.12.9'\n" }),
  'debug-enabled': define('debug-enabled', debugRules, 'no debug mode is switched on where it should be off',
    { 'settings.py': 'DEBUG = True\n' }),
  'sql-concat': define('sql-concat', [sqlBuilt], 'no SQL statement is built by joining text and values together',
    { 'db.js': "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)\n" }),
  'path-traversal-pattern': define('path-traversal-pattern', [pathTraversal], 'no file is read or sent with a path straight from the request',
    { 'files.js': "app.get('/f', (req, res) => res.sendFile(req.query.name))\n" }),
  'open-redirect-pattern': define('open-redirect-pattern', [openRedirect], 'no redirect goes to an address taken from the request unchecked',
    { 'auth.js': 'res.redirect(req.query.next)\n' }),
  'regex-dos': define('regex-dos', [regexDos], 'no regular expression has a repeat inside a repeat',
    { 'pattern.js': 'const bad = /(a+)+$/\n' }),
  'weak-crypto-modes': define('weak-crypto-modes', weakCrypto, 'no weak cipher, ECB mode, fixed key or guessable token is used',
    { 'crypto.js': "const c = crypto.createCipher('aes192', pw)\n" }),
  'credentials-in-urls': define('credentials-in-urls', [credsInUrl], 'no web address carries a user name and password',
    { 'db.js': "const url = 'postgres://admin:S3cretPass@db.internal:5432/app'\n" }),
  'xxe-and-deserialize': define('xxe-and-deserialize', xxeDeser, 'XML parsers are locked down and no untrusted data is deserialized',
    { 'parse.py': 'parser = etree.XMLParser(resolve_entities=True)\n' }),
})
