// Static checks that read the files git tracks and need no tool installed. Run through the packs, or by hand:
//   node thorough/static.mjs <check> [--root <dir>]      node thorough/static.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "static". A finding you accept goes in the check's allow file (named in each message).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, posix } from 'node:path'
import { isConstantMarkup, isStaticMarkupBuilder } from './guards.mjs'
import { finding, finish, isFixture, isTestFile, isText, main, readBudgets, readText, rustTestLines, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.static ?? {}
const SOURCE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|cs|svelte|vue)$/i
const TESTISH = /(^|\/)(tests?|__tests__|fixtures?|spec|examples?|docs?)\/|\.(test|spec)\.[a-z]+$/i
const allowList = (root, name) => new Set(readText(root, name).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const lineOf = (text, index) => text.slice(0, index).split('\n').length

// ---- whitespace: a byte-order mark, or lines ended two different ways in one file
const whitespace = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!isText(x) || /\.(lock|svg)$/.test(x)) continue
    const t = readText(root, x)
    if (t.charCodeAt(0) === 0xfeff) f.push(`${x}: starts with a byte-order mark`)
    const crlf = (t.match(/\r\n/g) ?? []).length
    const lf = (t.match(/(?<!\r)\n/g) ?? []).length
    if (crlf && lf) f.push(`${x}: mixes ${crlf} Windows and ${lf} Unix line endings`)
  }
  return finish('whitespace', f, 'no byte-order marks or mixed line endings')
}

// ---- env-example: every environment variable the code reads is written down somewhere
const COMMON_ENV = new Set(['NODE_ENV', 'PATH', 'HOME', 'USER', 'USERPROFILE', 'CI', 'PWD', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'LANG', 'TERM', 'DEBUG', 'PORT', 'HOST', 'APPDATA', 'LOCALAPPDATA', 'NO_COLOR', 'FORCE_COLOR', 'APPIMAGE', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_DIR', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE'])
// Set by the runtime or the packager, never by the person running the app: Electron's own ELECTRON_* switches, npm's npm_* and NODE_* variables, GitHub's GITHUB_*.
const RUNTIME_ENV = /^(?:ELECTRON_[A-Z_]+|npm_[A-Za-z0-9_]+|NODE_[A-Z_]+|GITHUB_[A-Z_]+|RUNNER_[A-Z_]+)$/
const envExample = (root) => {
  const files = trackedFiles(root)
  const docs = files.filter((x) => /(^|\/)(\.env\.(example|sample|template)|README[^/]*|docs\/.*\.md)$/i.test(x)).map((x) => readText(root, x)).join('\n')
  const allow = allowList(root, '.meerkat-env-allow')
  const used = new Map()
  const re = /(?:process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]|os\.environ(?:\.get)?\(?\[?['"]([A-Z][A-Z0-9_]{2,})['"]|os\.getenv\(['"]([A-Z][A-Z0-9_]{2,})['"]|env::var\("([A-Z][A-Z0-9_]{2,})"\)|os\.Getenv\("([A-Z][A-Z0-9_]{2,})"\))/g
  for (const x of files) {
    if (!SOURCE.test(x) || TESTISH.test(x)) continue
    for (const m of readText(root, x).matchAll(re)) {
      const name = m.slice(1).find(Boolean)
      if (!used.has(name)) used.set(name, x)
    }
  }
  const f = [...used].filter(([n]) => !COMMON_ENV.has(n) && !RUNTIME_ENV.test(n) && !allow.has(n) && !docs.includes(n)).map(([n, x]) => `${n} is read in ${x} but is not in .env.example or the README (add it, or list it in .meerkat-env-allow)`)
  return finish('env-example', f, 'every environment variable the code reads is documented')
}

// ---- broken-imports: a relative import that points at nothing
const EXTS = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.svelte', '.vue', '.d.ts']
// Blanks (same length, newlines kept) what is not an import: comments, and a string that merely QUOTES import text (a test's expect(src).toContain("from './x.cjs'")).
const blankSpan = (s) => s.replace(/[^\n]/g, ' ')
const withoutNonImports = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, blankSpan)
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (s, lead) => lead + blankSpan(s.slice(lead.length)))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (s) => (/\b(?:from|import|require)\b/.test(s) && /['"`]/.test(s.slice(1, -1)) ? blankSpan(s) : s))
const brokenImports = (root) => {
  const allow = allowList(root, '.meerkat-imports-allow')
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.(m?[jt]sx?|cjs|svelte|vue)$/i.test(x) || /(^|\/)(node_modules|dist|build)\//.test(x) || isFixture(x)) continue
    const t = withoutNonImports(readText(root, x))
    const re = /(?:from\s+|import\s+|import\(\s*|require\(\s*)['"](\.{1,2}\/[^'"?#]*)['"]/g
    for (const m of t.matchAll(re)) {
      const target = posix.normalize(posix.join(posix.dirname(x), m[1]))
      const bare = target.replace(/\.(m?js|cjs|jsx)$/, '')
      const tries = [...EXTS.map((e) => target + e), ...EXTS.map((e) => bare + e), ...EXTS.map((e) => `${target}/index${e}`)]
      const ok = tries.some((p) => {
        try {
          return existsSync(join(root, p)) && statSync(join(root, p)).isFile()
        } catch {
          return false
        }
      })
      if (!ok && !allow.has(x) && !allow.has(`${x}:${lineOf(t, m.index)}`)) f.push(`${x}:${lineOf(t, m.index)} imports ${m[1]}, which does not exist (accept it in .meerkat-imports-allow)`)
    }
  }
  return finish('broken-imports', f, 'every relative import resolves to a file')
}

// ---- dependency-pinning: versions that can change under you
const dependencyPinning = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    const base = x.split('/').pop()
    if (base === 'package.json' && !/node_modules/.test(x)) {
      let j
      try {
        j = JSON.parse(readText(root, x))
      } catch {
        continue
      }
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, v] of Object.entries(j[key] ?? {})) {
          if (/^(\*|latest|x|)$/i.test(String(v).trim()) || /^(git\+|git:|github:|https?:)/.test(String(v)) && !/#[0-9a-f]{7,40}$/i.test(String(v))) f.push(`${x}: ${name} is "${v}" (not a fixed version)`)
        }
      }
    } else if (base === 'Cargo.toml') {
      for (const m of readText(root, x).matchAll(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"\*"|\{[^}]*version\s*=\s*"\*"[^}]*\})/gm)) f.push(`${x}: ${m[1]} has version "*"`)
    } else if (/^requirements.*\.txt$/.test(base)) {
      readText(root, x).split('\n').forEach((l, i) => {
        const t = l.trim()
        if (t && !t.startsWith('#') && !t.startsWith('-') && !/[=<>~!@]/.test(t)) f.push(`${x}:${i + 1} ${t} has no version`)
      })
    }
  }
  return finish('dependency-pinning', f, 'every dependency names a version')
}

// ---- lockfile-integrity: package-lock entries fetched over plain http, or with no checksum
const lockfileIntegrity = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/(^|\/)package-lock\.json$/.test(x) || /node_modules/.test(x)) continue
    let j
    try {
      j = JSON.parse(readText(root, x))
    } catch {
      continue
    }
    for (const [name, p] of Object.entries(j.packages ?? {})) {
      if (!name || p.link || p.inBundle) continue
      if (typeof p.resolved === 'string' && p.resolved.startsWith('http://')) f.push(`${x}: ${name} is fetched over plain http`)
      else if (typeof p.resolved === 'string' && /^https?:/.test(p.resolved) && !p.integrity) f.push(`${x}: ${name} has no integrity checksum`)
    }
  }
  return finish('lockfile-integrity', f, 'every locked package is fetched securely and checksummed')
}

// ---- risky-code: calls that are usually a security mistake
const RISKY = [
  // A method named eval on some other object (redis.eval(script), df.eval('a * b')) is not the language's eval; window.eval and globalThis.eval still are.
  [/(?:(?<![\w$.])|\b(?:window|globalThis|self|global)\.)eval\s*\(/, 'eval() runs text as code', /\.(m?[jt]sx?|cjs|py|php|rb|svelte|vue)$/],
  [/(?<![\w$.:])(?:new\s+)?Function\s*\(\s*(?!\))/, 'new Function() runs text as code', /\.(m?[jt]sx?|cjs|svelte|vue)$/],
  [/document\.write\s*\(/, 'document.write() with page content', /\.(m?[jt]sx?|svelte|vue|html?)$/],
  [/\.(?:inner|outer)HTML\s*(?:=(?!=)|\+=)/, 'innerHTML assignment (script injection unless the value is trusted)', /\.(m?[jt]sx?|svelte|vue)$/],
  [/\.insertAdjacentHTML\s*\(\s*['"][a-zA-Z]+['"]\s*,\s*(?!['"\x60][^'"\x60$\n]*['"\x60]\s*\))/, 'innerHTML assignment through insertAdjacentHTML (script injection unless the value is trusted)', /\.(m?[jt]sx?|svelte|vue)$/],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML (script injection unless the value is trusted)', /\.(jsx|tsx)$/],
  [/\bchild_process\b[\s\S]{0,40}\bexec\s*\(\s*(?:`[^`]*\$\{|[^)]*\+)/, 'exec() with a built-up command string (shell injection)', /\.(m?[jt]s|cjs)$/],
  [/\bos\.system\s*\(|subprocess\.[A-Za-z_]+\([^)]*shell\s*=\s*True/, 'a shell command from Python (shell injection if any part is user input)', /\.py$/],
  [/\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader\s*=\s*(?:yaml\.)?C?SafeLoader\b)/, 'pickle or yaml.load can run code from the data', /\.py$/],
  [/verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, 'TLS certificate checks turned off', SOURCE],
  // A shared options dict that turns certificate checking off (TLS = {'verify': False}) is only a finding when some file unpacks it into a call (**TLS).
  [/\b([A-Za-z_]\w*)\s*=\s*\{[^}\n]*['"]verify['"]\s*:\s*False\b/, 'TLS certificate checks turned off in an options dict that is unpacked into calls', /\.py$/],
  [/createHash\(\s*['"](?:md5|sha1)['"]\)|hashlib\.(?:md5|sha1)\(|\bMD5\.|\bSHA1\./, 'MD5 or SHA-1 (broken for security uses)', SOURCE],
  [/Math\.random\(\)[^\n]*(?:token|secret|password|passwd|key|nonce|session)|(?:token|secret|password|passwd|key|nonce|session)[^\n]*Math\.random\(\)/i, 'Math.random() for something secret (not secure random)', /\.(m?[jt]sx?|cjs|svelte|vue)$/],
  [/chmod\s+(?:-R\s+)?0?777|0o777|StrictHostKeyChecking\s*=\s*no/, 'world-writable permissions or SSH host checks off', /\.(sh|bash|py|m?[jt]s|cjs|ya?ml|rs|go)$/],
  [/['"]http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\]|example\.|www\.w3\.org|schemas\.|json-schema\.org|host\.docker\.internal|host\.containers\.internal|gateway\.docker\.internal|(?:www\.)?sitemaps\.org\/schemas\/)[a-z0-9.-]+\.[a-z]{2,}/i, 'a plain http:// address (not encrypted)', SOURCE],
]
// `const btn = (icon, label) => { ...innerHTML = icon }` where every call of btn in the file passes a string literal or an ALL_CAPS constant (ICON.up) for that
// parameter, and btn is not exported or passed around as a value: the markup is always author-written. Not safe when unsure, and nothing is safe with no call.
const CONST_ARG = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Z][A-Z0-9_]*(?:\.\w+|\[['"]\w+['"]\])*)$/
const splitArgs = (s) => {
  const out = []
  let depth = 0
  let cur = ''
  let q = ''
  for (const c of s) {
    if (q) {
      cur += c
      if (c === q) q = ''
    } else if (c === '"' || c === "'" || c === '`') {
      q = c
      cur += c
    } else if ('([{'.includes(c)) {
      depth++
      cur += c
    } else if (')]}'.includes(c)) {
      depth--
      cur += c
    } else if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
const paramOnlyConstants = (t, at, param) => {
  const before = t.slice(0, at)
  const defs = [...before.matchAll(/(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^()]*)\)\s*=>|\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^()]*)\))/g)]
  const d = defs.at(-1)
  if (!d) return false
  const name = d[1] ?? d[3]
  const params = splitArgs(d[2] ?? d[4])
  const idx = params.findIndex((p) => p === param)
  // Exported helpers have callers elsewhere; any write to the parameter (plain, compound, ++/--, destructuring target) ends the argument-only reasoning.
  if (/(?:^|[\n;}])[ \t]*export\s+(?:default\s+)?(?:async\s+)?$/.test(t.slice(Math.max(0, d.index - 60), d.index))) return false
  if (idx < 0 || params.some((p) => p.startsWith('...'))) return false
  // The sink must sit inside the helper's braced body, and nothing inside that body may declare the same name again (a nested function parameter, let, const, var).
  const open = t.indexOf('{', d.index + d[0].length - 1)
  if (open < 0 || t.slice(d.index + d[0].length, open).trim() !== '') return false
  const blank = t.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`/g, (s) => ' '.repeat(s.length))
  let depth = 0
  let close = -1
  for (let i = open; i < blank.length; i++) {
    if (blank[i] === '{') depth++
    else if (blank[i] === '}' && --depth === 0) {
      close = i
      break
    }
  }
  if (close < 0 || at < open || at > close) return false
  const p = param.replace(/\$/g, '\\$')
  // Fail closed on anything that could rebind the name or hide code from the blanking above: a nested function or class, a template with ${} or a backtick left
  // in a comment, or a declaration of the name (const, let, var, destructuring) in the body.
  const rawBody = t.slice(open + 1, close)
  if (/=>|\bfunction\b|\bclass\b|\$\{|`/.test(rawBody.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, ' '))) return false
  // Strictest form: inside the helper the name appears exactly once, as the sink's value. Any write, shadowing, loop variable or destructuring needs a second mention.
  const mentions = blank.slice(open + 1, close).match(new RegExp(String.raw`(?<![\w$])${p}(?![\w$])`, 'g')) ?? []
  if (mentions.length !== 1) return false
  const n = name.replace(/\$/g, '\\$')
  // A name inside a class name or string ('find-btn') is not a use of the helper.
  const uses = [...t.matchAll(new RegExp(String.raw`(?<![\w$.\-'"\x60])${n}(?![\w$\-])`, 'g'))]
  const calls = [...t.matchAll(new RegExp(String.raw`(?<![\w$.\-'"\x60])${n}\(`, 'g'))].filter((c) => c.index !== d.index + d[0].indexOf(name))
  if (!calls.length || uses.length !== calls.length + 1) return false
  for (const c of calls) {
    let depth = 0
    let end = -1
    for (let i = c.index + c[0].length - 1; i < t.length && i < c.index + 400; i++) {
      if (t[i] === '(') depth++
      else if (t[i] === ')' && --depth === 0) {
        end = i
        break
      }
    }
    if (end < 0) return false
    const args = splitArgs(t.slice(c.index + c[0].length, end))
    if (args.slice(0, idx + 1).some((a) => a.startsWith('...'))) return false
    const arg = args[idx]
    if (arg === undefined || !CONST_ARG.test(arg)) return false
  }
  return true
}
// ---- innerHTML precision: which values are markup the author wrote, or text that was escaped or sanitised first.
// A call of one of these names (the last part of a dotted name, case ignored) cleans its input. Extend the list here; a project adds its own helpers in
// .meerkat-xss-safe instead (one name per line, the reason after #).
const XSS_SAFE_CALLS = ['esc', 'escape', 'escapeHtml', 'sanitize', 'sanitizeHtml', 'purify', 'DOMPurify']
const xssSafeNames = (root) => new Set(readText(root, '.meerkat-xss-safe').split('\n').map((l) => l.split('#')[0].trim().toLowerCase()).filter(Boolean))
// The right side of an assignment, read the way JavaScript reads it: from just after the operator to the end of the statement (a ; or a line end outside
// brackets and strings). Comments are removed first. A // comment ends only the line it is on: the expression goes on when the next line that holds code
// starts with a continuation token, exactly as for a plain line end, so a comment cannot hide a raw value on the next line.
// Blanks // and /* */ comments with spaces (line breaks kept, so every index stays the same) outside strings and template literals. Every later step reads this copy.
let blankedFor = ''
let blankedText = ''
const blankComments = (t) => {
  if (t === blankedFor) return blankedText
  let out = ''
  let q = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      out += c
      if (c === '\\') out += t[++i] ?? ''
      else if (c === q) q = ''
    } else if (c === '"' || c === "'" || c === '`') {
      q = c
      out += c
    } else if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') (out += ' '), i++
      i--
    } else if (c === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2)
      const stop = end < 0 ? t.length : end + 2
      for (; i < stop; i++) out += t[i] === '\n' ? '\n' : ' '
      i--
    } else out += c
  }
  blankedFor = t
  blankedText = out
  return out
}
const rhsText = (t, from) => {
  let depth = 0
  let q = ''
  let out = ''
  let i = from
  // The first character of the next line that holds code (blank lines and whole-line // comments are skipped).
  const nextCode = (at) => {
    const m = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(\S)/.exec(t.slice(at, at + 400))
    return m ? m[1] : ''
  }
  const continues = (before, at) => before === '' || /[+,(?:&|=]$/.test(before) || /[+.?:&|]/.test(nextCode(at))
  for (; i < t.length && i < from + 2000; i++) {
    const c = t[i]
    if (q) {
      out += c
      if (c === '\\') out += t[++i] ?? ''
      else if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth <= 0 && c === ';') break
    else if (depth <= 0 && c === '/' && t[i + 1] === '/') {
      const eol = t.indexOf('\n', i)
      if (eol < 0 || !continues(out.trimEnd(), eol + 1)) break
      out += '\n'
      i = eol
      continue
    } else if (depth <= 0 && c === '\n') {
      if (continues(out.trimEnd(), i + 1)) {
        out += c
        continue
      }
      break
    }
    out += c
  }
  return out.trim()
}
// Splits on a separator at the top level only (not inside strings, template literals or brackets).
const splitTop = (s, sep) => {
  const out = []
  let depth = 0
  let q = ''
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      cur += c
      if (c === '\\') cur += s[++i] ?? ''
      else if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    if (depth === 0 && c === sep) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}
const wrapped = (s) => {
  if (!s.startsWith('(') || !s.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0 && i < s.length - 1) return false
  }
  return true
}
const CALL_HEAD = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/
// A decoder, unescaper or raw-markup helper turns text back into markup, so it is never accepted as a cleaner, not even when a project vouches for it.
// Judged on whole name parts (split at . _ $ - spaces and camelCase), so unescapeHtml and he.unescape are decoders but drawChart and withdrawHtml are not.
const DECODER_PARTS = new Set(['decode', 'decoded', 'decoder', 'decodeuri', 'decodeuricomponent', 'unescape', 'unescaped', 'atob', 'raw'])
const nameSegments = (name) => name.split(/[\s._$-]+/).flatMap((p) => p.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)).map((p) => p.toLowerCase()).filter(Boolean)
const isDecoder = (name) => nameSegments(name).some((p) => DECODER_PARTS.has(p))
// A call is safe only when its callee is a known cleaner (XSS_SAFE_CALLS) or a name the project vouches for. A wrapper around a cleaner is not: whatever it does
// to the cleaned text afterwards is unknown, so it is reported unless it is vouched too.
const cleansInput = (name, vouched) => {
  const last = name.split('.').pop().toLowerCase()
  if (isDecoder(name)) return false
  return XSS_SAFE_CALLS.some((n) => n.toLowerCase() === last) || vouched.has(last) || vouched.has(name.toLowerCase())
}
const safeTerm = (t, raw, vouched) => {
  const term = raw.trim()
  if (term === '') return false
  if (wrapped(term)) return safeExpr(t, term.slice(1, -1), vouched)
  if (/^(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")$/.test(term)) return true
  if (term.length > 1 && term.startsWith('`') && term.endsWith('`')) {
    // Every ${} in a template literal must itself be safe.
    const exprs = []
    for (let i = 1; i < term.length - 1; i++) {
      if (term[i] === '\\') i++
      else if (term[i] === '$' && term[i + 1] === '{') {
        let d = 0
        let j = i + 1
        for (; j < term.length; j++) {
          if (term[j] === '{') d++
          else if (term[j] === '}' && --d === 0) break
        }
        if (j >= term.length) return false
        exprs.push(term.slice(i + 2, j))
        i = j
      }
    }
    return exprs.every((e) => safeExpr(t, e, vouched))
  }
  const call = CALL_HEAD.exec(term)
  if (call) {
    const args = callText(term, call[0].length)
    if (args === null || term.slice(call[0].length + args.length + 1).trim() !== '') return false
    return cleansInput(call[1], vouched)
  }
  const path = /^([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*|\[(?:'[^']*'|"[^"]*"|\d+)\])*)$/.exec(term)
  if (path) return (/^[A-Z][A-Z0-9_]*$/.test(path[1]) && path[2] !== '') || isConstantMarkup(t, path[1])
  return false
}
const safeExpr = (t, expr, vouched) => {
  const terms = splitTop(expr, '+')
  return terms.every((x) => safeTerm(t, x, vouched))
}
// innerHTML = '' or = '<svg ...>' (a plain string with no ${} and no + joining other text) injects nothing a visitor controls, so it is not a risk.
const safeLiteralAssign = (t0, m, why, vouched = new Set()) => {
  const t = blankComments(t0)
  const from = m.index + m[0].length
  const eol = t.indexOf('\n', from)
  let rest = t.slice(from, eol < 0 ? t.length : eol).trim()
  // dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}: the value goes through a sanitiser first.
  if (why.startsWith('dangerouslySetInnerHTML')) {
    // The WHOLE __html value must be one sanitiser call with balanced parentheses, then }}: a sanitiser followed by + more markup, or a longer expression, is not safe.
    const head = /^=\s*\{\{\s*__html\s*:\s*(?:DOMPurify\.sanitize|sanitizeHtml|sanitize)\s*\(/.exec(t.slice(from, from + 400))
    if (!head) return false
    const args = callText(t, from + head[0].length)
    return args !== null && /^\s*\}\}/.test(t.slice(from + head[0].length + args.length + 1))
  }
  if (!why.startsWith('innerHTML')) return false
  // el.insertAdjacentHTML('beforeend', ROW): the second argument is judged the same way as the right side of innerHTML =.
  if (why.includes('insertAdjacentHTML')) {
    const arg = callText(t, from)
    if (arg === null) return false
    rest = arg.trim()
  }
  // The statement as JavaScript reads it. When it runs over more than one line, the one-line shortcuts below (which look at the first line only) do not apply.
  const full = why.includes('insertAdjacentHTML') ? rest : rhsText(t, from)
  const oneLine = !full.includes('\n')
  // A plain name or dotted path that is a top-level constant holding only text (const ICONS = { save: '<svg ...>' }) is author-written markup too.
  const root = /^([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*|\[(?:'[^']*'|"[^"]*")\])*\s*;?\s*(?:\/\/.*)?$/.exec(rest)
  if (oneLine && root && isConstantMarkup(t, root[1])) return true
  if (oneLine && root && !root[0].includes('.') && paramOnlyConstants(t, m.index, root[1])) return true
  // A constant by the ALL_CAPS convention (ICON.close, ICONS['x'], SPINNER_SVG) holds markup the author wrote, not input.
  const atom = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60[^\x60$\\]*\x60|[A-Z][A-Z0-9_]*(?:\.\w+|\[['"]\w+['"]\])*)`
  if (oneLine && new RegExp(String.raw`^${atom}\s*;?\s*(?:\/\/.*)?$`).test(rest)) return true
  // A call of a function declared in this same file: judged by reading that function. A builder whose result is a template of table lookups produces
  // author-written markup. A renderer that escapes with a local escaper is NOT accepted: reading JavaScript with patterns kept finding bypasses, so it is reported.
  const localCall = /^([A-Za-z_$][\w$]*)\(/.exec(rest)
  if (oneLine && localCall && !why.includes('insertAdjacentHTML')) {
    const open = t.indexOf(localCall[0], from) + localCall[0].length
    const args = callText(t, open)
    const lineEnd = t.indexOf('\n', open)
    const tail = args === null ? null : t.slice(open + args.length + 1, lineEnd < 0 ? t.length : lineEnd)
    if (tail !== null && /^\s*;?\s*(?:\/\/.*)?$/.test(tail) && isStaticMarkupBuilder(t, localCall[1])) return true
  }
  // A value built only from safe parts: string literals, module-level constant tables, and calls of a known escape or sanitiser (XSS_SAFE_CALLS, or a name the
  // project vouches for in .meerkat-xss-safe). Every part of a + chain must be safe, so esc(a) + b is still reported.
  if (safeExpr(t, full, vouched)) return true
  // cond ? CONST : '' picks between constants, so the condition decides which author-written markup is shown, never what it contains.
  return oneLine && new RegExp(String.raw`^[^?]+\?\s*${atom}\s*:\s*${atom}\s*;?\s*(?:\/\/.*)?$`).test(rest)
}
const bareValue = (t, m) => {
  const from = m.index + m[0].length
  const eol = t.indexOf('\n', from)
  const rest = t.slice(from, eol < 0 ? t.length : eol).trim()
  // Only a plain name or a dotted path, or a path indexed by a literal or a name. A value rooted at something a visitor controls (the URL, the page,
  // an event, a request, props or query) is never downgraded: it stays medium.
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[(?:'[^']*'|"[^"]*"|\d+|[A-Za-z_$][\w$]*)\])*\s*;?\s*(?:\/\/.*)?$/.test(rest)) return false
  return !/^(?:location|document|window|self|top|parent|event|evt|ev|e|req|request|res|params|query|props|searchParams|data|msg|message|input|userInput|body|url|href)\b/i.test(rest)
}
// The text of a call's arguments, from just after its opening parenthesis to the matching close; null when it does not close within 600 characters.
const callText = (t, start) => {
  let depth = 1
  let q = ''
  for (let i = start; i < t.length && i < start + 600; i++) {
    const c = t[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = ''
    } else if (c === '"' || c === "'" || c === '`') q = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c) && --depth === 0) return t.slice(start, i)
  }
  return null
}
const LITERAL = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`
// A call whose text is fixed by the author cannot be steered by input: new Function('a', 'b', 'return a + b'), os.system('clear'), os.system('cls' if os.name == 'nt' else 'clear').
const fixedText = (t, m, why) => {
  const fn = why.startsWith('new Function')
  if (!fn && !why.startsWith('a shell command from Python')) return false
  // The shell rule also matches subprocess(..., shell=True); only os.system( is judged here.
  if (!fn && !/os\.system\s*\($/.test(m[0])) return false
  const args = callText(t, m.index + m[0].length)
  if (args === null) return false
  if (fn) return splitArgs(args).every((a) => new RegExp(String.raw`^${LITERAL}$`).test(a))
  return new RegExp(String.raw`^\s*${LITERAL}(?:\s+if\s+[\w.]+\s*(?:==|!=)\s*${LITERAL}\s+else\s+${LITERAL})?\s*$`).test(args)
}
// The name of the call that encloses position `at` (the nearest unclosed parenthesis before it), e.g. 'requests.get' for the verify=False in requests.get(url, verify=False).
const enclosingCallee = (t, at) => {
  let depth = 0
  for (let i = at - 1; i >= 0 && i > at - 600; i--) {
    if (')]}'.includes(t[i])) depth++
    else if ('([{'.includes(t[i]) && depth-- === 0) return t[i] === '(' ? (/([\w$.]+)\s*$/.exec(t.slice(Math.max(0, i - 80), i))?.[1] ?? '') : ''
  }
  return ''
}
// pickle.loads(X) where X is a plain name that an HMAC was computed over (hmac.new(key, X ...) or hmac.digest(key, X ...)) and compared in an
// `if not ...compare_digest(...):` whose body raises or returns, all in the 14 lines above. The compared bytes must be the unpickled ones, and a failed
// comparison must stop the function before the load.
const hmacChecked = (t, m) => {
  const arg = (callText(t, m.index + m[0].length) ?? '').trim()
  if (!/^[A-Za-z_]\w*$/.test(arg)) return false
  const line = lineOf(t, m.index)
  const above = t.split('\n').slice(Math.max(0, line - 15), line - 1)
  const macOver = new RegExp(String.raw`\bhmac\.(?:new|digest)\s*\([^\n]*,\s*${arg}\b`)
  for (let i = 0; i < above.length; i++) {
    if (!/^\s*if\s+not\s+(?:hmac\.)?compare_digest\s*\(/.test(above[i])) continue
    const body = above[i + 1] ?? ''
    if (!/^\s+(?:raise|return)\b/.test(body)) continue
    if (macOver.test(above.slice(0, i + 1).join('\n'))) return true
  }
  return false
}
// True when a Python file anywhere unpacks the dict `name` into a call (**name).
const unpackedSomewhere = (root, name) => trackedFiles(root).some((y) => y.endsWith('.py') && new RegExp(String.raw`\*\*${name}\b`).test(readText(root, y)))
const riskyCode = (root) => {
  const allow = allowList(root, '.meerkat-risky-allow')
  const vouched = xssSafeNames(root)
  const structured = []
  const fallbackSeverity = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY ?? '') ? process.env.MEERKAT_DEFAULT_SEVERITY : 'high'
  const f = []
  for (const x of trackedFiles(root)) {
    if (!isText(x) || TESTISH.test(x) || isTestFile(x) || /(^|\/)(node_modules|dist|build|vendor)\//.test(x) || x.endsWith('static.mjs') || allow.has(x)) continue
    const t = readText(root, x)
    const inRustTest = rustTestLines(x, t)
    for (const [re, why, only] of RISKY) {
      if (!only.test(x)) continue
      // Every hit counts, not just the first in a file: a second innerHTML or eval further down is a separate risk.
      for (const m of t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
        if (safeLiteralAssign(t, m, why, vouched)) continue
        if (fixedText(t, m, why)) continue
        // A property or variable named exactly `key` set to Math.random() alone is a React list key or a sort/map key, not a secret (apiKey, secretKey, keyFile are still checked).
        if (why.startsWith('Math.random()') && /^key\s*[:=]\s*Math\.random\(\)$/i.test(m[0]) && !/[\w$]/.test(t[m.index - 1] ?? '') && !/(?:token|secret|password|passwd|nonce|session)/i.test(t.slice(t.lastIndexOf('\n', m.index) + 1, t.indexOf('\n', m.index) < 0 ? t.length : t.indexOf('\n', m.index)))) continue
        // verify=False is only a TLS finding on a call that talks to a server; checker.run(verify=False) is some other option named verify.
        if (why.startsWith('TLS certificate checks turned off') && m[0].startsWith('verify') && enclosingCallee(t, m.index) !== '' && !/requests|httpx|urllib|session|client|http|fetch|aiohttp|curl|ssl|\b(?:get|post|put|patch|delete|head|request|urlopen|connect)$/i.test(enclosingCallee(t, m.index))) continue
        // pickle.loads after the data's HMAC was compared (hmac.compare_digest) in the lines just above: the bytes are ones this program signed.
        if (why.startsWith('pickle or yaml.load') && /pickle\./.test(m[0]) && hmacChecked(t, m)) continue
        if (why.startsWith('TLS certificate checks turned off in an options dict') && !unpackedSomewhere(root, m[1])) continue
        // Not code that runs: a hit in a Rust unit-test module, in a comment (a note that says the call is banned), or inside a string literal (sample code a detector or a
        // test feeds to itself). The plain-http rule matches the string itself, so it is judged as before.
        if (inRustTest(lineOf(t, m.index))) continue
        const ls = t.lastIndexOf('\n', m.index - 1) + 1
        const before = t.slice(ls, m.index)
        if (/^\s*(?:\/\/|\/\*|\*|#)/.test(before) || (!why.startsWith('a plain http') && /\.(rs|py|go)$/.test(x) && (before.match(/(?<!\\)"/g) ?? []).length % 2 === 1)) continue
        if (/\.[cm]?[jt]sx?$/.test(x) && /\/\/[^\n]*$/.test(before) && !/['"`][^'"`\n]*\/\/[^\n]*$/.test(before)) continue
        const lineText = t.slice(ls, t.indexOf('\n', m.index) < 0 ? t.length : t.indexOf('\n', m.index))
        // A plain http:// name that is only compared, trimmed or declared as a namespace is an identifier, not a request (XML and metadata namespaces, URL prefixes).
        // Only when the URL itself is the helper's direct argument, or the URL's own host is a known namespace host (not anything else on the line).
        const host = /^['"]http:\/\/([^/'"\s:]+)/i.exec(m[0])?.[1] ?? ''
        const directArg = new RegExp(String.raw`\b(?:trim_start_matches|strip_prefix|starts_with|startsWith|trimStart|removePrefix)\s*\(\s*&?['"]http://`).test(lineText)
        if (why.startsWith('a plain http') && (directArg || /^(?:(?:www\.)?apache\.org|ns\.adobe\.com|purl\.org|(?:www\.)?xmlns\.com|schemas\.openxmlformats\.org|schemas\.microsoft\.com|ns\.useplus\.org|(?:www\.)?iptc\.org)$/i.test(host))) continue
        // MD5 and SHA-1 are only a risk where a secret or a signature depends on them: a content hash used to find duplicate files is fine.
        // It is downgraded only on positive evidence of a non-security use (a dedupe key, checksum, ETag, fingerprint, cache key or a hash of a whole file), and only
        // when no secret or signature word is near. Otherwise it keeps failing; an accepted content hash goes in .meerkat-risky-allow. A downgrade is still reported, as info.
        if (why.startsWith('MD5')) {
          const around = t.split('\n').slice(Math.max(0, lineOf(t, m.index) - 4), lineOf(t, m.index) + 3).join('\n')
          const secretNear = /pass|pwd|secret|token|sign|auth|cert|hmac|credential|api[_-]?key|\bkey\b|session|nonce|salt|\botp\b|\bpin\b/i.test(around)
          const benign = /dedup|duplicate|checksum|etag|fingerprint|cache[_-]?key|content[_-]?hash|usedforsecurity\s*=\s*False|by_?hash|readFileSync|read_bytes|fs::read/i.test(around)
          if (benign && !secretNear) {
            if (!allow.has(`${x}:${lineOf(t, m.index)}`)) structured.push(['info', 'risky-call', x, lineOf(t, m.index), `${why} (used as a content hash or checksum)`])
            continue
          }
        }
        if (!allow.has(`${x}:${lineOf(t, m.index)}`)) {
          f.push(`${x}:${lineOf(t, m.index)} ${why}`)
          // Every hit is reported with its own severity: innerHTML with a value the code does not show to be safe is a medium risk (it depends on where the
          // value comes from), the other calls keep the check's own severity (high).
          // A plain variable on the right (el.innerHTML = icon) only says "check where it comes from": low. Built text (concatenation, a template with a
          // value in it, a call) is medium.
          const htmlSeverity = bareValue(t, m) ? 'low' : 'medium'
          structured.push([why.startsWith('innerHTML') ? htmlSeverity : fallbackSeverity, why.startsWith('innerHTML') ? 'innerhtml-assignment' : 'risky-call', x, lineOf(t, m.index), why])
        }
      }
    }
  }
  const r = finish('risky-code', f, 'none of the usual dangerous calls found (accept one in .meerkat-risky-allow)', { structured: true })
  for (const s of structured) finding(...s)
  return r
}

// ---- workflow-security: GitHub Actions workflows that can be abused
const workflowSecurity = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(x)) continue
    // Whole-line YAML comments are blanked (same length, so line numbers hold): a trigger or an expression named in a comment is not one that runs.
    const t = readText(root, x).replace(/^[ \t]*#.*$/gm, (c) => ' '.repeat(c.length))
    for (const m of t.matchAll(/uses:\s*([A-Za-z0-9_.-]+)\/([A-Za-z0-9_./-]+)@([^\s#]+)/g)) {
      if (!/^[0-9a-f]{40}$/.test(m[3]) && !['actions', 'github'].includes(m[1])) f.push(`${x}:${lineOf(t, m.index)} ${m[1]}/${m[2]}@${m[3]} is not pinned to a commit (a tag can be moved)`)
    }
    if (!/^permissions:/m.test(t)) f.push(`${x}: no top-level "permissions:" (the token gets broad rights by default)`)
    if (/pull_request_target/.test(t) && /github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref/.test(t)) f.push(`${x}: pull_request_target checks out code from the pull request (it runs with secrets)`)
    for (const m of t.matchAll(/run:[^\n]*\$\{\{\s*github\.(?:event\.(?:issue|pull_request|comment|review|head_commit)\.[a-z_.]*(?:title|body|message|name|label|ref)|head_ref)[^}]*\}\}/g)) f.push(`${x}:${lineOf(t, m.index)} untrusted text from the event is put straight into a shell command (script injection)`)
  }
  return finish('workflow-security', f, 'workflows pin their actions, limit permissions and keep event text out of commands')
}

// ---- html-structure: headings, ids, labels, click handlers
const htmlStructure = (root) => {
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.html?$/i.test(x) || /(^|\/)(node_modules|dist|build)\//.test(x)) continue
    const t = readText(root, x).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    const heads = [...t.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]))
    if (heads.filter((h) => h === 1).length > 1) f.push(`${x}: more than one <h1>`)
    for (let i = 1; i < heads.length; i++) if (heads[i] > heads[i - 1] + 1) f.push(`${x}: a heading jumps from <h${heads[i - 1]}> to <h${heads[i]}>`)
    const ids = [...t.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    for (const id of new Set(ids.filter((v, i) => ids.indexOf(v) !== i))) f.push(`${x}: id="${id}" is used more than once`)
    for (const m of t.matchAll(/<input\b[^>]*>/gi)) {
      if (/type\s*=\s*["']?(hidden|submit|button|reset|image)/i.test(m[0])) continue
      if (!/\b(id|aria-label|aria-labelledby|title)\s*=/i.test(m[0]) && !/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/i.test(t.slice(0, m.index))) f.push(`${x}: an <input> with no label (no id, aria-label or enclosing <label>)`)
    }
    for (const m of t.matchAll(/<(div|span)\b[^>]*\bonclick\s*=[^>]*>/gi)) if (!/\b(role|tabindex)\s*=/i.test(m[0])) f.push(`${x}: a <${m[1]}> with a click handler that a keyboard cannot reach (add role and tabindex, or use a <button>)`)
    if (/\btabindex\s*=\s*["']?[1-9]/i.test(t)) f.push(`${x}: a positive tabindex (breaks the natural tab order)`)
  }
  return finish('html-structure', f, 'headings, ids, labels and click handlers are in order')
}

// ---- css-contrast: text colour against its background, where both are written in the same rule
const hexToRgb = (h) => {
  const v = h.slice(1)
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}
const cssContrast = (root) => {
  const min = cfg(root).minContrast ?? 4.5
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.(css|scss|html?|svelte|vue)$/i.test(x) || /(^|\/)(node_modules|dist|build)\//.test(x)) continue
    const t = readText(root, x).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const fg = /(?:^|;|\s)color\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/i.exec(m[2])
      const bg = /background(?:-color)?\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/i.exec(m[2])
      if (!fg || !bg) continue
      const r = ratio(hexToRgb(fg[1]), hexToRgb(bg[1]))
      if (r < min) f.push(`${x}:${lineOf(t, m.index)} ${m[1].trim().split('\n').pop().trim().slice(0, 40)}: ${fg[1]} on ${bg[1]} is ${r.toFixed(1)}:1 (needs ${min}:1)`)
    }
  }
  return finish('css-contrast', f, `text and background colours written together have at least ${min}:1 contrast`)
}

// ---- meta-seo: what a search result and a link preview are made from
const metaSeo = (root) => {
  // The page of a desktop app (Electron or Tauri) is loaded from disk into the app's own window: no search engine or link preview sees it.
  const pkg = readText(root, 'package.json')
  // A site kept in docs/, site/ or similar in the same repository is still public and still checked.
  const desktop = /"electron"\s*:/.test(pkg) || trackedFiles(root).some((x) => /(^|\/)src-tauri\/tauri\.conf\.json$/.test(x))
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.html?$/i.test(x) || /(^|\/)(node_modules|dist|build|fixtures?|mockups?|codemap|prototypes?|wireframes?)\//.test(x)) continue
    if (desktop && !/(^|\/)(docs?|site|website|www|landing|pages|public)\//i.test(x)) continue
    const t = readText(root, x)
    if (!/<html\b/i.test(t)) continue
    const title = /<title>([^<]*)<\/title>/i.exec(t)?.[1]?.trim() ?? ''
    if (title && (title.length < 10 || title.length > 70)) f.push(`${x}: the title is ${title.length} characters (10 to 70 reads well in search results)`)
    const desc = /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(t)?.[1] ?? /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i.exec(t)?.[1]
    if (desc === undefined) f.push(`${x}: no <meta name="description">`)
    else if (desc.length < 50 || desc.length > 170) f.push(`${x}: the description is ${desc.length} characters (50 to 170 reads well)`)
  }
  return finish('meta-seo', f, 'pages have a title and description of a useful length')
}

// ---- image-weight: pictures that are too heavy to ship
const imageWeight = (root) => {
  const max = (cfg(root).maxImageKB ?? 500) * 1024
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i.test(x) || /(^|\/)(fixtures?|docs|examples?)\//i.test(x)) continue
    let size = 0
    try {
      size = statSync(join(root, x)).size
    } catch {
      continue
    }
    if (size > max) f.push(`${x} is ${Math.round(size / 1024)} KB (limit ${Math.round(max / 1024)} KB): compress it or serve a smaller one`)
  }
  return finish('image-weight', f, 'no image is over its size limit')
}

const fx = (files, fn) => ({ fixture: () => withFixture(files, fn) })
// Self-test for risky-code. The broken folder must fail (eval, and three innerHTML shapes that take raw input). The clean folder holds one innerHTML per safe shape
// (constant table, escaped, sanitised, vouched helper) and must NOT be flagged: if it is, this returns 0, which the self-test reports as a check that stopped working.
const RISKY_BROKEN = { 'app.js': 'const r = eval(input)\nel.innerHTML = location.hash\nel.innerHTML = "<b>" + name + "</b>"\nel.innerHTML = esc(a) + b\n' }
const RISKY_CLEAN = {
  'app.js': "const ICON = { close: '<svg></svg>' }\nbtn.innerHTML = ICON.close\nel.innerHTML = esc(text)\nel.innerHTML = '<b>' + escapeHtml(name) + '</b>'\nel.innerHTML = purify.sanitize(chunk, CONFIG)\nel.innerHTML = DOMPurify.sanitize(x)\nel.innerHTML = mine(x)\n",
  '.meerkat-xss-safe': 'mine # strips every tag, reviewed\n',
}
const quietly = async (fn) => {
  const log = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
  }
}
async function riskyFixture() {
  const clean = await quietly(() => withFixture(RISKY_CLEAN, riskyCode))
  if (clean !== 0) {
    console.log('risky-code self-test: a safe innerHTML shape (constant table, escaped, sanitised or vouched) was flagged')
    return 0
  }
  return withFixture(RISKY_BROKEN, riskyCode)
}
void dirname
void extname
void readFileSync

main({
  whitespace: { run: whitespace, ...fx({ 'a.js': 'a\r\nb\nc\r\n' }, whitespace) },
  'env-example': { run: envExample, ...fx({ 'app.js': 'const k = process.env.MY_SECRET_THING\n' }, envExample) },
  'broken-imports': { run: brokenImports, ...fx({ 'a.js': "import x from './nope.js'\n" }, brokenImports) },
  'dependency-pinning': { run: dependencyPinning, ...fx({ 'package.json': '{"dependencies":{"left-pad":"latest"}}' }, dependencyPinning) },
  'lockfile-integrity': { run: lockfileIntegrity, ...fx({ 'package-lock.json': '{"packages":{"":{},"node_modules/a":{"resolved":"http://registry.example.org/a.tgz","integrity":"sha512-x"}}}' }, lockfileIntegrity) },
  'risky-code': { run: riskyCode, fixture: riskyFixture },
  'workflow-security': { run: workflowSecurity, ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: someone/action@v1\n      - run: echo "${{ github.event.pull_request.title }}"\n' }, workflowSecurity) },
  'html-structure': { run: htmlStructure, ...fx({ 'p.html': '<html><body><h1>a</h1><h1>b</h1></body></html>' }, htmlStructure) },
  'css-contrast': { run: cssContrast, ...fx({ 'a.css': '.x { color: #777777; background: #888888; }\n' }, cssContrast) },
  'meta-seo': { run: metaSeo, ...fx({ 'p.html': '<html><head><title>A page title here</title></head><body></body></html>' }, metaSeo) },
  'image-weight': { run: imageWeight, ...fx({ 'big.png': 'x'.repeat(600 * 1024) }, imageWeight) },
})
