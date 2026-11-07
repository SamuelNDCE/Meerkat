// Security checks that read the code as plain text, so no tool has to be installed. They look for the common ways a web app
// or service gets hurt: open CORS, cookies without flags, weak JWTs, SQL built from strings, and so on.
// Run through the security-plus pack, or by hand:
//   node thorough/sec-code.mjs <check> [--root <dir>]      node thorough/sec-code.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-seccode-allow: a path (accepts the whole file) or path:line, one per line, # for comments.
import { isConstantMarkup } from './guards.mjs'
import { helperTaint, projectContext, taintNames } from './project-ctx.mjs'
import { blankRustStrings, finding, finish, isInsecureSampleFile, main, readText, rustTestLines, stringOnlyLines, trackedFiles, withFixture } from './kit.mjs'

const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|kt|cs|svelte|vue)$/i
const CONFIG = /\.(ya?ml|toml|json|ini|env|conf|cfg|properties|xml)$|(^|\/)\.env[^/]*$|(^|\/)(Dockerfile[^/]*|docker-compose[^/]*)$/i
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|tests?|__tests__|fixtures?|spec|examples?|docs?)\/|(^|\/)(?:scripts|tools|supabase|qa|e2e)\/probes?\/|(^|\/)probe-[\w.-]+\.(?:[cm]?[jt]s|py)$|\.(test|spec)\.[a-z]+$|(^|\/)[\w.-]+_tests?\.(rs|go|py)$|(^|\/)test_[\w.-]+\.py$|\.min\.(m?js|css)$|(^|\/)sec-code\.mjs$/i
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
  scan: (t, x) => hits(t, re).map((h) => {
    const w = typeof why === 'function' ? why(t, h, x) : why
    return w && typeof w === 'object' ? { line: h.line, info: w.info } : { line: h.line, why: w }
  }).filter((r) => r.why || r.info),
})

// Runs every rule over the files git tracks (a plain walk outside a repository) and returns the findings as text.
function runRules(root, rules, { skipSamples = true } = {}) {
  const allow = allowSet(root)
  const f = []
  const tracked = trackedFiles(root)
  const ctx = projectContext(root, tracked)
  for (const x of tracked) {
    if (SKIP.test(x) || BINARY.test(x) || allow.has(x)) continue
    const raw = readText(root, x)
    const t = skipSamples && isInsecureSampleFile(x) ? blankRustStrings(raw) : raw // sample snippets held as strings in a rule-fixture file are data, not code
    const inTest = rustTestLines(x, t) // Rust unit tests sit in the same file, in a #[cfg(test)] module: not shipped code
    // A line that is only string literals (a table of sample code a detector feeds to itself) is data, not a call: the pattern checks leave it alone.
    const isSample = skipSamples ? stringOnlyLines(x, t) : () => false
    for (const r of rules) {
      if (!r.files(x)) continue
      for (const { line, why, info } of r.scan(t, x, ctx)) {
        if (line && (inTest(line) || isSample(line))) continue
        if (info) {
          if (!allow.has(`${x}:${line}`)) finding('info', 'debug-enabled', x, line, info)
          continue
        }
        const where = line ? `${x}:${line}` : x
        if (!allow.has(where)) f.push(`${where} ${why}`)
      }
    }
  }
  return f
}

const define = (id, rules, ok, fixture, opts) => {
  const run = (root) => finish(id, runRules(root, rules, opts), ok)
  return { run, fixture: () => withFixture(fixture, run) }
}

// ---- cors-wildcard: any site may read responses that carry credentials
const CORS_CREDENTIALS = /credentials['"]?\s*(?:\]\s*)?[:=,\]]\s*['"]?true\b/i
const corsWildcard = pat(codeOrConfig, /\borigin['"]?\s*[:=,]\s*(?:true|['"]\*['"])|Access-Control-Allow-Origin['"]?\s*\]?\s*[:=,)]\s*['"]\*['"]/i, (t, h) =>
  CORS_CREDENTIALS.test(t.slice(Math.max(0, h.at - 200), h.at + 300)) ? 'allows every website to send requests with credentials (any origin plus credentials)' : null)
const corsReflect = {
  files: code,
  scan: (t) => hits(t, /Access-Control-Allow-Origin['"]?\s*[:=,)]\s*[^\n;]*?\b(?:req|request|r|ctx)\b[^\n;]*?origin/i)
    .filter((h) => !/allowed|allowlist|whitelist|includes\(|indexOf\(|\bhas\(|\.test\(/i.test(near(t, h.line, 4, 0)))
    .map((h) => ({ line: h.line, why: "copies the caller's Origin header into Access-Control-Allow-Origin with no check against a list of allowed sites" })),
}

// The credentials flag is switched on in ANOTHER file for an options object that allows every origin here (corsOptions.credentials = true).
const corsSplit = {
  files: codeOrConfig,
  scan: (t, x, ctx) => hits(t, /\b(\w+)\s*=\s*\{[^}\n]*\borigin['"]?\s*:\s*(?:true|['"]\*['"])/)
    .filter((h) => !CORS_CREDENTIALS.test(t.slice(Math.max(0, h.at - 200), h.at + 300)))
    .filter((h) => [...ctx.all].some(([y, other]) => y !== x && new RegExp(`\\b${h.m[1]}\\.credentials\\s*=\\s*true\\b`).test(other)))
    .map((h) => ({ line: h.line, why: `allows every origin here, and another file sets ${h.m[1]}.credentials = true (any origin plus credentials)` })),
}
// The Allow-Origin value comes from a helper function in another file that returns the caller's Origin with no check against a list.
const corsHelper = {
  files: code,
  scan: (t, x, ctx) => hits(t, /Access-Control-Allow-Origin['"]?\s*[:=,)]\s*(\w+)\s*\(/i)
    .filter((h) => {
      const def = ctx.constant(h.m[1])
      return def && /\b(?:origin|Origin)\b/.test(def) && !/allowed|allowlist|whitelist|includes\(|indexOf\(|\bhas\(|\.test\(/i.test(def) && /\b(?:req|request|r|ctx)\b/.test(def)
    })
    .map((h) => ({ line: h.line, why: `copies the caller's Origin header into Access-Control-Allow-Origin through ${h.m[1]}(), which checks it against no list of allowed sites` })),
}

// ---- cookie-flags: a cookie set without HttpOnly, Secure and SameSite
const cookieFlags = pat(code, /\bres\.cookie\s*\(|\bset_cookie\s*\(|\bcookies\.set\s*\(|\bSetCookie\s*\(|\bCookie::(?:new|build)\s*\(|\bSet-Cookie\b/i, (t, h) => {
  let win = after(t, h.at, 4)
  if (h.m[0].endsWith('(')) {
    const open = h.at + h.m[0].length - 1
    const call = callText(t, open)
    win = call + after(t, open + call.length, 4)
    // res.cookie('sid', sid, COOKIE_OPTIONS): the flags live in the options object the call names, declared in this file.
    for (const a of call.matchAll(/[,(]\s*([A-Za-z_$][\w$]*)\s*(?=[,)])/g)) {
      const d = new RegExp(String.raw`(?:const|let|var)\s+${a[1].replace(/\$/g, '\\$')}\s*=\s*\{([^}]*)\}`).exec(t)
      if (d) win += ' ' + d[1]
    }
  }
  const missing = [['HttpOnly', /http_?only/i], ['Secure', /\bsecure\b/i], ['SameSite', /same_?site/i]].filter(([, re]) => !re.test(win)).map(([name]) => name)
  return missing.length ? `sets a cookie with no ${missing.join(', ')} setting (checked in the call and the 3 lines after it)` : null
})

// ---- jwt-weak: tokens accepted without a real signature, or signed with a secret typed into the code
const jwtRules = [
  pat(code, /\balg(?:orithm)?s?['"]?\s*[:=]\s*\[?\s*['"]none['"]/i, 'accepts unsigned tokens (algorithm "none"), so anyone can forge one'),
  // An algorithm list held in a constant that names "none", used as the accepted list by a verify call in any file.
  {
    files: code,
    scan: (t, x, ctx) => hits(t, /\b(\w*[Aa]lgorithms?\w*)\s*[:=](?!=)\s*\[[^\]\n]*['"]none['"]/)
      .filter((h) => [...ctx.all].some(([, other]) => new RegExp(`algorithms?['"]?\\s*:\\s*${h.m[1]}\\b`).test(other)))
      .map((h) => ({ line: h.line, why: `the accepted token algorithms (${h.m[1]}) include "none", so anyone can forge a token` })),
  },
  // A signing secret that falls back to a typed-in default when the environment variable is missing.
  pat(code, /\b\w*(?:jwt|token|signing|session)\w*(?:secret|key)\w*\s*[:=](?!=)\s*(?:process\.env\.\w+|os\.(?:environ\.get|getenv)\([^)]*\))\s*(?:\|\||\bor\b|\?\?)\s*['"][^'"\n]{4,}['"]/i, 'the token signing secret falls back to a default typed into the code when the environment variable is missing'),
  pat(code, /\bverify_signature['"]?\s*[:=]\s*(?:False|false)\b/, 'reads a token without checking its signature'),
  pat(js, /\bjwt\.decode\s*\(/, (t) => /\b(?:req|request)\.(?:user|session)\b|isAuthenticated|authenticate|requireAuth|currentUser/.test(t) && !/\.verify\s*\(|jwtVerify/.test(t)
    ? 'reads a token with jwt.decode, which skips the signature check, in a file that looks like it decides who is signed in'
    : null),
  pat(code, /\b(?:jwt|jsonwebtoken|JWT)\.(?:sign|verify|encode|decode)\s*\([^\n;]*?,\s*(['"])([^'"\n]{4,})\1/, 'signs or checks a token with a secret typed into the code (move it to an environment variable)'),
]

// ---- hardcoded-ip: a public IPv4 address written into the code
// The well-known public DNS resolvers (Cloudflare, Google, Quad9, OpenDNS): named public services with fixed addresses, not a server of the project's own.
const PUBLIC_RESOLVERS = new Set(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '149.112.112.112', '208.67.222.222', '208.67.220.220'])
const publicIp = (ip) => {
  if (PUBLIC_RESOLVERS.has(ip)) return false
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
  pat(deployFile, /NODE_ENV\s*[=:]\s*['"]?development\b/i, (t, h, x) => (/(^|\/)docker-compose\.override\.ya?ml$/i.test(x) ? { info: 'NODE_ENV is development in docker-compose.override.yml, which Compose merges only on a developer machine (check it is not copied to a server)' } : 'NODE_ENV is development in a deployment file (development mode is looser and slower)')),
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
const SQL_JOIN = /["'\x60]\s*(?:\+|%\s*[\w(]|\.format\s*\(|\.\s*\$|\.\s*$|\.\s*[A-Za-z_]\w*\s*\.)|\bf["'][^"'\n]*\{|\$@?"[^"\n]*\{|\x60[^\x60\n]*\$\{|"[^"\n]*(?:\$[A-Za-z_]|#\{)|\b(?:fmt\.Sprintf|String\.format|format!|sprintf|Format)\s*\(/
// 'Select a file from the list: ' is a sentence, not a statement: a capitalised Select, then words with no comma, star, bracket or dot, then a lower-case from.
const PROSE_SELECT = /\bSelect\s+[A-Za-z]+(?:\s+[A-Za-z]+)+\s+from\b/
const RB_SQL_INTERP = /\.(?:where|having|order|group|joins|find_by_sql|select|pluck|exists\?|delete_all|update_all|execute|exec_query)\s*\(\s*"[^"\n]{0,200}#\{/
// Parts of an SQL line that cannot carry input are taken out before the line is judged (the text keeps its line breaks, so line numbers hold):
//   - a tagged template (sql`...`, Prisma $queryRaw`...`): the tag turns every ${} into a bound parameter, not text;
//   - ${NAME} or {NAME} where NAME is a top-level constant holding only text (const TABLE = 'orders'), and ${MAP[key] ?? MAP.dflt} picking from such a table of text:
//     the value is chosen from author-written strings;
//   - ' + marks + ' where marks is ids.map(() => '?').join(','): a list of placeholders;
//   - ' + Date.now() and ' + 42: a number cannot carry SQL.
const neutralSql = (t) => {
  let u = t.replace(/(?:\$queryRaw|\$executeRaw|\bPrisma\.sql|\bsql|\bSQL)\x60[^\x60]*\x60/g, (m) => '""' + '\n'.repeat(m.split('\n').length - 1))
  const textConst = (n) => new RegExp(String.raw`^(?:export\s+)?(?:const|let|var)?\s*${n}\s*[:=]`, 'm').test(u) && isConstantMarkup(u, n)
  const pyConst = new Set([...u.matchAll(/^([A-Z][A-Z0-9_]*)\s*=\s*(['"])[^'"\n]*\2\s*$/gm)].map((m) => m[1]))
  const isText = (n) => /^[A-Z][A-Z0-9_]*$/.test(n) && (pyConst.has(n) || textConst(n))
  u = u.replace(/\$\{\s*([A-Za-z_$][\w$]*)(?:\[[^\]\n]*\]|\.\w+)*\s*(?:(?:\?\?|\|\|)\s*([A-Za-z_$][\w$]*)(?:\[[^\]\n]*\]|\.\w+)*\s*)?\}/g, (m, a, b) => (isText(a) && (!b || isText(b)) ? 'x' : m))
  u = u.replace(/(?<![$\w])\{\s*([A-Z][A-Z0-9_]*)\s*\}/g, (m, a) => (isText(a) ? 'x' : m))
  const marks = [...u.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[\w.]+\.map\(\s*\(\s*\w*\s*\)\s*=>\s*(?:'\?'|"\?")\s*\)\s*\.join\(/g)].map((m) => m[1])
  for (const n of marks) u = u.replace(new RegExp(String.raw`(['"\x60])\s*\+\s*${n}\s*\+\s*(['"\x60])`, 'g'), '')
  u = u.replace(/(['"])\s*\+\s*(?:Date\.now\(\)|\d+)(?:\s*[-*]\s*(?:\d+|Date\.now\(\)))*(?=\s*[,);\n])/g, '$1')
  // A quoted-identifier helper (qIdent, quoteIdent, escapeIdentifier ..., or a function in this file that only wraps its argument in quotes after doubling the quote
  // character) makes a table or column name safe: ${qIdent(table)}, ${cols.map(qIdent).join(', ')} and ' + qIdent(col) + ' are text, not a value.
  const quoters = new Set([...u.matchAll(/\b(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)\n]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g)]
    .filter((m) => /^[\s\S]{0,260}?\.replace\(\s*\/(?:"|\x60)\/g/.test(u.slice(m.index + m[0].length)) && !/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(u.slice(m.index, m.index + 260)))
    .map((m) => m[1] ?? m[2]))
  for (const n of u.matchAll(/\b(?:q|quote|escape)_?(?:ident(?:ifier)?|id|name)s?\b|\bquote_ident\b|\bqi\b/gi)) quoters.add(n[0])
  for (const n of [...quoters].map((q) => q.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&'))) {
    u = u.replace(new RegExp(String.raw`\$\{\s*${n}\s*\([^(){}]*\)\s*\}`, 'g'), 'x')
    u = u.replace(new RegExp(String.raw`\$\{\s*[\w.$]+\.map\(\s*(?:${n}|\(?\s*\w+\s*\)?\s*=>\s*${n}\s*\(\s*\w+\s*\))\s*\)(?:\.join\([^()]*\))?\s*\}`, 'g'), 'x')
    u = u.replace(new RegExp(String.raw`(['"\x60])\s*\+\s*${n}\s*\([^()]*\)\s*\+\s*(['"\x60])`, 'g'), '')
    u = u.replace(new RegExp(String.raw`(['"\x60])\s*\+\s*${n}\s*\([^()]*\)(?=\s*[,);\n])`, 'g'), '$1')
  }
  // A constant table name joined into the statement ('SELECT * FROM ' + TABLE + ' WHERE ...') is author-written text, the same as ${TABLE}.
  for (const n of new Set([...u.matchAll(/(['"\x60])\s*\+\s*([A-Z][A-Z0-9_]*)\s*(?:\+\s*(['"\x60])|(?=[,);\n]))/g)].map((m) => m[2]).filter(isText))) {
    u = u.replace(new RegExp(String.raw`(['"\x60])\s*\+\s*${n}\s*\+\s*(['"\x60])`, 'g'), '')
    u = u.replace(new RegExp(String.raw`(['"\x60])\s*\+\s*${n}(?=\s*[,);\n])`, 'g'), '$1')
  }
  // A parameterised call: the first argument is ONE plain SQL literal (no join in the statement itself) and the second is an array of bound values. A + or a template inside
  // that array (['%' + name + '%'] for a LIKE) is a value the driver binds, not text added to the SQL, so the array is emptied before the line is judged.
  u = u.replace(/(\(\s*)(['"\x60])((?:(?!\2)[^\n])*)\2(\s*,\s*)\[(?:[^\[\]\n]|\[[^\]\n]*\])*\]/g, (m, open, q, body, comma) => (SQL_KW.test(body) && !(q === '\x60' && body.includes('${')) ? `${open}${q}${body}${q}${comma}[]` : m))
  return u
}
const sqlBuilt = {
  files: code,
  scan: (t0) => {
    const t = neutralSql(t0)
    const found = new Map()
    // q = 'select ... from t where id = ' on one line and q += <request data or any non-literal> a few lines later.
    const ls = t.split('\n')
    for (const [i, line] of ls.entries()) {
      const m = /^\s*(?:(?:const|let|var)\s+)?(\w+)\s*=\s*(['"\x60])[^\n]*$/.exec(line)
      if (!m || !SQL_SHAPE.test(line) || COMMENT.test(line)) continue
      for (let j = i + 1; j < Math.min(ls.length, i + 8); j++) {
        const a = new RegExp(`^\\s*${m[1]}\\s*\\+=\\s*(.+)$`).exec(ls[j])
        if (a && !/^(['"\x60])[^'"\x60]*\1;?$/.test(a[1].trim()) && !found.has(j + 1)) found.set(j + 1, { line: j + 1, why: 'builds an SQL statement by adding a value onto the text (use placeholders such as $1 or ?)' })
      }
    }
    for (const [i, line] of t.split('\n').entries()) {
      if (line.length > 600 || COMMENT.test(line)) continue
      if (PROSE_SELECT.test(line) && !/\bSELECT\b/.test(line)) continue
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
// A guard counts only when it is CALLED (importing safe_join or naming filepath.Base protects nothing).
const PATH_GUARD = /path\.(?:resolve|normalize|basename)\s*\(|os\.path\.basename\s*\(|filepath\.(?:Clean|Rel|Base)\s*\(|startsWith\(|is_relative_to|realpath|secure_filename\s*\(|safe_join\s*\(|canonicalize/
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
// const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-...$/ and UUID.test(value) near the read: a whole-value pattern of plain characters (no dot, slash, backslash, negated or wildcard class) lets no path through.
const strictPatterns = (t) => [...t.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\/\^((?:[^\/\\\n]|\\.)+)\$\/[a-z]*/g)]
  .filter((m) => !/(?<!\\)\.|\\[SWDsb.\/\\]|\[\^|\[[^\]]*[.\/\\][^\]]*\]/.test(m[2].replace(/\\[dw]/g, '')))
  .map((m) => m[1])
// The guard counts only when it tests the SAME expression the file call uses (a request field or a name that appears in the path argument) and a failed test ends the
// handler before the call: `if (!UUID.test(req.params.id)) return ...` in the 15 lines above. A test of some other value, or one that does nothing on failure, protects nothing.
const strictGuarded = (t, h, strict) => {
  const arg = firstArg(t, h)
  const above = t.split('\n').slice(Math.max(0, h.line - 16), h.line - 1).join('\n')
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return strict.some((n) => [...above.matchAll(new RegExp(String.raw`\bif\s*\(\s*!\s*${esc(n)}\.test\(\s*([^()]+?)\s*\)\s*\)\s*(?:\{[^{}]*?)?\b(?:return|throw)\b`, 'g'))].some((m) => arg.includes(m[1])))
}
const pathTraversal = {
  files: code,
  scan: (t, x, ctx) => {
    const taint = taintNames(t, REQ)
    const strict = strictPatterns(t)
    return hits(t, FILE_API)
      .filter((h) => !tableLookup(t, firstArg(t, h)) && !strictGuarded(t, h, strict)).filter((h) => (REQ.test(firstArg(t, h)) || [...taint].some((n) => new RegExp(`\\b${n}\\b`).test(firstArg(t, h))) || helperTaint(t, h.line, firstArg(t, h), ctx, REQ, callText)) && !PATH_GUARD.test(near(t, h.line, 15, 15)))
      .map((h) => ({ line: h.line, why: 'reads or sends a file using a path taken straight from the request, with no path check nearby (use path.basename, or check the resolved path stays inside your folder)' }))
  },
}

// ---- open-redirect-pattern: a redirect to an address taken from the request, with no allow-list check
const REDIRECT = /\bredirect\s*\(|\bRedirect\s*\(|['"]Location['"]\s*(?:[,:\]=])|['"]Location:|(?<![\w$.])(?:window\.|document\.|self\.|top\.)?location(?:\.href)?\s*=(?!=)|\blocation\.(?:assign|replace)\s*\(/
// A regular expression that only lets a path starting with a single slash through (/^\/[^/\]/.test(next), /^\/(?!\/)/.test(next)) is a local-path check too.
const ALLOW_CHECK = /allow|whitelist|includes\(|indexOf\(|startsWith\(\s*['"]\/|isSafe|isLocal|is_safe_url|allowed_hosts|url_has_allowed|isRelative|\^\\\/(?:\[\^\/|\(\?!\\?\/)/i
// NAME[key] or NAME[key] || '/': the target is picked from a table of author-written paths (const ROUTES = { orders: '/account/orders' }), whatever the key is.
const tableLookup = (t, arg) => {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*\[[^\]\n]*\]\s*(?:(?:\|\||\?\?)\s*(['"])[^'"\n]*\2)?\s*$/.exec(arg)
  return !!m && isConstantMarkup(t, m[1])
}
// A value the sign-in flow stored from the request (req.session.returnTo) is request data too.
const REDIR_REQ = new RegExp(REQ.source + '|\\b(?:req|request)\\.session\\.(?:returnTo|return_to|next|redirect\\w*|returnUrl|callback\\w*)\\b|\\bsession\\[[\'"](?:next|return_?to|redirect\\w*)[\'"]\\]')
const openRedirect = {
  files: code,
  scan: (t, x, ctx) => hits(t, REDIRECT)
    .filter((h) => {
      const text = h.m[0].endsWith('(') ? h.text + ' ' + callText(t, h.at + h.m[0].length - 1) : h.text
      const arg = h.m[0].endsWith('(') ? firstArg(t, h) : text
      const tn = taintNames(t, REDIR_REQ)
      // A name whose every assignment comes through a function named safe*, allow* or validate* (const next = safeNext(searchParams.get('next'))) went through an allow-list.
      for (const n of [...tn]) {
        const assign = new RegExp(String.raw`(?<![\w$.])${n}\s*(?::[^=\n]+)?=(?![=>])([^\n]*)`, 'g')
        const rhs = [...t.matchAll(assign)].map((m) => m[1])
        if (rhs.length && rhs.every((r) => /^\s*(?:await\s+)?[\w$.]*(?:safe|allow|validate)[\w$]*\s*\(/i.test(r))) tn.delete(n)
      }
      if (h.m[0].endsWith('(') && tableLookup(t, arg)) return false
      // location.href = location.pathname + '?' + params: only the query of the page's own address changes, never the destination.
      if (/^(?:window\.|document\.)?location(?:\.href)?\s*=\s*(?:window\.)?location\.(?:pathname|origin)\b/.test(h.text.trim().replace(/^[^=]*?(?=(?:window\.|document\.)?location)/, ''))) return false
      return (REDIR_REQ.test(text) || [...tn].some((n) => new RegExp(`\\b${n}\\b`).test(arg)) || (h.m[0].endsWith('(') && helperTaint(t, h.line, arg, ctx, REDIR_REQ, callText))) && !ALLOW_CHECK.test(near(t, h.line, 4, 10))
    })
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
    // One option that starts another is only ambiguous when the rest of the longer option can itself begin a new round: (a|aa)+ splits aaaa many ways, (ab|a)+ does not.
    if (alts.some((a, i) => alts.some((b, j) => i !== j && b.startsWith(a) && (b.length === a.length || alts.some((c) => c.startsWith(b[a.length])))))) return 'a repeated choice where one option is the start of another'
  }
  return null
}
// A pattern held as a string constant here and compiled with new RegExp(NAME) / re.compile(NAME) in any file.
const regexConstant = {
  files: code,
  scan: (t, x, ctx) => hits(t, /\b([A-Za-z_]\w*)\s*[:=](?!=)\s*(['"])((?:(?!\2)[^\n\\]|\\.)*)\2/)
    .map((h) => ({ h, risk: repeatRisk(h.m[3].replace(/\\\\/g, '\\')) }))
    .filter((r) => r.risk && [...ctx.all].some(([, other]) => new RegExp(`(?:new\\s+RegExp|re\\.(?:compile|match|search|fullmatch)|Regex\\.new|regexp\\.MustCompile)\\s*\\(\\s*${r.h.m[1]}\\b`).test(other)))
    .map((r) => ({ line: r.h.line, why: `the pattern ${r.h.m[1]} is used as a regular expression elsewhere and can take exponential time (${r.risk}), which can freeze the program` })),
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
    // A comment that mentions passwords (// Passwords were once stored with MD5) is not the code using MD5 on one.
    .filter((h) => /passw|passwd|\bpwd\b/i.test(near(t, h.line, 3, 0).split('\n').filter((l) => !COMMENT.test(l)).join('\n')))
    .map((h) => ({ line: h.line, why: 'MD4 or MD5 is used on what looks like a password (use bcrypt, scrypt or argon2)' })),
}
const TOKENISH = /token|secret|passw|nonce|session|api[_-]?key|\botp\b|csrf|reset|\bsalt\b|\bkey\b|\bpin\b|verif|invite|\bauth|\bcode\b|uuid|captcha|\bsid\b|\bid_?gen/i
// The words that make a random value a secret (a plain id or key is not one): when one is near, the value is judged a secret whatever it is called.
const SECRETISH = /token|secret|passw|nonce|session|api[_-]?key|\botp\b|csrf|reset|\bsalt\b|\bpin\b|verif|invite|\bauth|captcha|\bsid\b/i
// A name that says the value is an identifier or a list/cache key: newId(), attachmentId =, requestId:, uuid =, cacheKey =.
const ID_NAME = /(?:\b(?:function\s+)?[A-Za-z_$][\w$]*(?:[a-z0-9]Id|ID|_id|Uuid|UUID|(?:cache|item|row|list|dom|react|map|sort|lookup)Key)|\b(?:id|uuid))\s*(?:[:=(]|=>)/
const weakCrypto = [
  pat(code, /\bcreate(?:De)?[Cc]ipher\s*\(/, 'createCipher uses no IV, so the same key always gives the same output (use createCipheriv with a random IV)'),
  pat(code, /\bcreate(?:De)?[Cc]ipheriv\s*\(\s*['"](?:des|rc4|bf|blowfish|aes-\d+-ecb)/i, 'a weak or unsafe cipher (DES, RC4, Blowfish or ECB mode) is named'),
  pat(code, /getInstance\s*\(\s*"(?:DES|RC4|ARCFOUR|Blowfish|[A-Za-z0-9]+\/ECB)/, 'a weak or unsafe cipher (DES, RC4, Blowfish or ECB mode) is named'),
  pat(code, /\b(?:DES3?|ARC4|ARC2|Blowfish)\.new\s*\(|\b(?:des|rc4|blowfish)\.NewCipher\s*\(/, 'a weak cipher (DES, RC4 or Blowfish) is used'),
  pat(code, /\bMODE_ECB\b/, 'ECB mode: identical blocks encrypt to identical output (use GCM, or CBC with a random IV)'),
  pat(code, /(?:Cipheriv|Decipheriv)\s*\([^\n]*?(?:Buffer\.from|new Buffer)\(\s*['"]|\b(?:key|iv|IV|secretKey)\s*[:=]\s*(?:Buffer\.from|new Buffer)\(\s*['"]|\b(?:AES|DES3?|ChaCha20\w*)\.new\(\s*b?['"]|\b(?:key|iv|IV|KEY)\s*=\s*b['"][^'"\n]{4,}['"]/,
    'a cipher key or IV is written into the code (load it from a secret store or an environment variable)'),
  // The generator call, or the name it is assigned to / the function it sits in (up to 3 lines above), says token, secret, key, code...
  pat(code, /(?<!['"\`])(?:\b(?:Math\.random|random\.(?:random|choice|choices|randint|randrange|getrandbits|sample)|(?:Kernel\.|Random\.)?rand|mt_rand|lcg_value|uniqid|rand\.(?:Int|Intn|Int31n?|Int63n?|Uint32|Uint64|Float64|Read)|Random\.new|SecureRandom\.hex\(\s*\d{1,2}\s*\)\.to_i|new\s+(?:java\.util\.)?Random)\s*\(|\bnew\s+Random\b\s*(?!\())/, (t, h) => {
    const around = near(t, h.line, 3, 0)
    if (!TOKENISH.test(around)) return null
    // An id or a cache key only has to be unique, not secret: no secret word near, and the value is named as an id / list key, or it is the fallback for crypto.randomUUID.
    if (!SECRETISH.test(around) && (ID_NAME.test(around) || /\brandomUUID\b/.test(around))) return null
    return 'a random number from a generator that is not secure makes a token or secret (use crypto.randomBytes, Python secrets, SecureRandom, random_bytes or crypto/rand)'
  }),
  // A cipher name or key held in a constant in one file and passed to createCipheriv / createDecipheriv in another.
  {
    files: code,
    scan: (t, x, ctx) => [
      ...hits(t, /\b([A-Za-z_]\w*)\s*[:=](?!=)\s*['"](des[\w-]*|rc4|bf[\w-]*|blowfish|aes-\d+-ecb)['"]/i)
        .filter((h) => [...ctx.all].some(([, other]) => new RegExp(`create(?:De)?[Cc]ipheriv\\s*\\(\\s*${h.m[1]}\\b`).test(other)))
        .map((h) => ({ line: h.line, why: `${h.m[1]} names a weak or unsafe cipher (DES, RC4, Blowfish or ECB mode) and is passed to createCipheriv elsewhere` })),
      ...hits(t, /\b([A-Za-z_]\w*)\s*[:=](?!=)\s*(?:Buffer\.from|new Buffer)\(\s*['"][^'"\n]{8,}['"]/)
        .filter((h) => [...ctx.all].some(([, other]) => new RegExp(`create(?:De)?[Cc]ipheriv\\s*\\([^\\n]*,\\s*${h.m[1]}\\s*[,)]`).test(other)))
        .map((h) => ({ line: h.line, why: `${h.m[1]} is a cipher key written into the code and used by createCipheriv elsewhere (load it from a secret store or an environment variable)` })),
    ],
  },
  md5Password,
]

// ---- credentials-in-urls: a user name and password written into a web address
const URL_CRED = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:\/@'"<>]+):([^\s\/@'"<>]+)@[^\s'"<>]+/i
const FAKE_PART = /^(user(name)?|pass(word)?|pwd|name|login|your\w*|example|changeme|xxx+|x+|\*+)$/i
// Web pages and templates too: a link such as <a href="https://user:pass@host/file"> ships the password to every visitor.
const MARKUP = /\.(html?|xhtml|ejs|hbs|handlebars|njk|twig|erb|astro|mdx)$/i
const credsInUrl = pat((x) => codeOrConfig(x) || MARKUP.test(x), URL_CRED, (t, h) => (FAKE_PART.test(h.m[1]) || FAKE_PART.test(h.m[2]) || /[<>{}$%]/.test(h.m[1] + h.m[2]))
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
  'cors-wildcard': define('cors-wildcard', [corsWildcard, corsReflect, corsSplit, corsHelper], 'no CORS setting lets any site read responses that carry credentials',
    { 'api.js': "res.setHeader('Access-Control-Allow-Origin', req.headers.origin)\n" }),
  'cookie-flags': define('cookie-flags', [cookieFlags], 'every cookie that is set has HttpOnly, Secure and SameSite',
    { 'app.js': "res.cookie('session', token)\n" }),
  'jwt-weak': define('jwt-weak', jwtRules, 'tokens are checked with a real signature and a secret kept out of the code',
    { 'auth.js': "const t = jwt.sign({ id: 1 }, 'hunter22')\n" }),
  'hardcoded-ip': define('hardcoded-ip', [hardcodedIp], 'no public IP address is written into the code',
    { 'server.js': "const upstream = '45.33.12.9'\n" }, { skipSamples: false }), // the finding is the literal value itself, so a string-only line must still be read
  'debug-enabled': define('debug-enabled', debugRules, 'no debug mode is switched on where it should be off',
    { 'settings.py': 'DEBUG = True\n' }),
  'sql-concat': define('sql-concat', [sqlBuilt], 'no SQL statement is built by joining text and values together',
    { 'db.js': "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)\n" }),
  'path-traversal-pattern': define('path-traversal-pattern', [pathTraversal], 'no file is read or sent with a path straight from the request',
    { 'files.js': "app.get('/f', (req, res) => res.sendFile(req.query.name))\n" }),
  'open-redirect-pattern': define('open-redirect-pattern', [openRedirect], 'no redirect goes to an address taken from the request unchecked',
    { 'auth.js': 'res.redirect(req.query.next)\n' }),
  'regex-dos': define('regex-dos', [regexDos, regexConstant], 'no regular expression has a repeat inside a repeat',
    { 'pattern.js': 'const bad = /(a+)+$/\n' }),
  'weak-crypto-modes': define('weak-crypto-modes', weakCrypto, 'no weak cipher, ECB mode, fixed key or guessable token is used',
    { 'crypto.js': "const c = crypto.createCipher('aes192', pw)\n" }),
  'credentials-in-urls': define('credentials-in-urls', [credsInUrl], 'no web address carries a user name and password',
    { 'db.js': "const url = 'postgres://admin:S3cretPass@db.internal:5432/app'\n" }, { skipSamples: false }),
  'xxe-and-deserialize': define('xxe-and-deserialize', xxeDeser, 'XML parsers are locked down and no untrusted data is deserialized',
    { 'parse.py': 'parser = etree.XMLParser(resolve_entities=True)\n' }),
})
