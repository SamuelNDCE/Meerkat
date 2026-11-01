// Static checks that read the files git tracks and need no tool installed. Run through the packs, or by hand:
//   node thorough/static.mjs <check> [--root <dir>]      node thorough/static.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "static". A finding you accept goes in the check's allow file (named in each message).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, posix } from 'node:path'
import { isConstantMarkup } from './guards.mjs'
import { finding, finish, isFixture, isText, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

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
const brokenImports = (root) => {
  const allow = allowList(root, '.meerkat-imports-allow')
  const f = []
  for (const x of trackedFiles(root)) {
    if (!/\.(m?[jt]sx?|cjs|svelte|vue)$/i.test(x) || /(^|\/)(node_modules|dist|build)\//.test(x) || isFixture(x)) continue
    const t = readText(root, x)
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
  [/\beval\s*\(/, 'eval() runs text as code', /\.(m?[jt]sx?|cjs|py|php|rb|svelte|vue)$/],
  [/(?<![\w$.:])(?:new\s+)?Function\s*\(\s*(?!\))/, 'new Function() runs text as code', /\.(m?[jt]sx?|cjs|svelte|vue)$/],
  [/document\.write\s*\(/, 'document.write() with page content', /\.(m?[jt]sx?|svelte|vue|html?)$/],
  [/\.(?:inner|outer)HTML\s*(?:=(?!=)|\+=)/, 'innerHTML assignment (script injection unless the value is trusted)', /\.(m?[jt]sx?|svelte|vue)$/],
  [/\.insertAdjacentHTML\s*\(\s*['"][a-zA-Z]+['"]\s*,\s*(?!['"\x60][^'"\x60$\n]*['"\x60]\s*\))/, 'innerHTML assignment through insertAdjacentHTML (script injection unless the value is trusted)', /\.(m?[jt]sx?|svelte|vue)$/],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML (script injection unless the value is trusted)', /\.(jsx|tsx)$/],
  [/\bchild_process\b[\s\S]{0,40}\bexec\s*\(\s*(?:`[^`]*\$\{|[^)]*\+)/, 'exec() with a built-up command string (shell injection)', /\.(m?[jt]s|cjs)$/],
  [/\bos\.system\s*\(|subprocess\.[A-Za-z_]+\([^)]*shell\s*=\s*True/, 'a shell command from Python (shell injection if any part is user input)', /\.py$/],
  [/\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader\s*=\s*(?:yaml\.)?SafeLoader)/, 'pickle or yaml.load can run code from the data', /\.py$/],
  [/verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, 'TLS certificate checks turned off', SOURCE],
  [/createHash\(\s*['"](?:md5|sha1)['"]\)|hashlib\.(?:md5|sha1)\(|\bMD5\.|\bSHA1\./, 'MD5 or SHA-1 (broken for security uses)', SOURCE],
  [/Math\.random\(\)[^\n]*(?:token|secret|password|passwd|key|nonce|session)|(?:token|secret|password|passwd|key|nonce|session)[^\n]*Math\.random\(\)/i, 'Math.random() for something secret (not secure random)', /\.(m?[jt]sx?|cjs|svelte|vue)$/],
  [/chmod\s+(?:-R\s+)?0?777|0o777|StrictHostKeyChecking\s*=\s*no/, 'world-writable permissions or SSH host checks off', /\.(sh|bash|py|m?[jt]s|cjs|ya?ml|rs|go)$/],
  [/['"]http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\]|example\.|www\.w3\.org|schemas\.|json-schema\.org)[a-z0-9.-]+\.[a-z]{2,}/i, 'a plain http:// address (not encrypted)', SOURCE],
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
  if (idx < 0 || new RegExp(String.raw`(?<![\w$.])${param.replace(/\$/g, '\\$')}\s*[-+*/|&]?=(?!=)`).test(t.slice(d.index + d[0].length))) return false
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
    const arg = splitArgs(t.slice(c.index + c[0].length, end))[idx]
    if (arg === undefined || !CONST_ARG.test(arg)) return false
  }
  return true
}
// innerHTML = '' or = '<svg ...>' (a plain string with no ${} and no + joining other text) injects nothing a visitor controls, so it is not a risk.
const safeLiteralAssign = (t, m, why) => {
  if (!why.startsWith('innerHTML')) return false
  const from = m.index + m[0].length
  const eol = t.indexOf('\n', from)
  const rest = t.slice(from, eol < 0 ? t.length : eol).trim()
  // A plain name or dotted path that is a top-level constant holding only text (const ICONS = { save: '<svg ...>' }) is author-written markup too.
  const root = /^([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*|\[(?:'[^']*'|"[^"]*")\])*\s*;?\s*(?:\/\/.*)?$/.exec(rest)
  if (root && isConstantMarkup(t, root[1])) return true
  if (root && !root[0].includes('.') && paramOnlyConstants(t, m.index, root[1])) return true
  // A constant by the ALL_CAPS convention (ICON.close, ICONS['x'], SPINNER_SVG) holds markup the author wrote, not input.
  const atom = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60[^\x60$\\]*\x60|[A-Z][A-Z0-9_]*(?:\.\w+|\[['"]\w+['"]\])*)`
  if (new RegExp(String.raw`^${atom}\s*;?\s*(?:\/\/.*)?$`).test(rest)) return true
  // A value passed through a sanitiser (DOMPurify.sanitize(x), sanitize(x), escapeHtml(x), esc(x)) is cleaned markup, not raw input.
  if (new RegExp(String.raw`^(?:DOMPurify\.sanitize|(?:[A-Za-z_$][\w$.]*\.)?(?:sanitize|escape|esc|purify)\w*)\s*\(`, 'i').test(rest)) return true
  // cond ? CONST : '' picks between constants, so the condition decides which author-written markup is shown, never what it contains.
  return new RegExp(String.raw`^[^?]+\?\s*${atom}\s*:\s*${atom}\s*;?\s*(?:\/\/.*)?$`).test(rest)
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
const riskyCode = (root) => {
  const allow = allowList(root, '.meerkat-risky-allow')
  const structured = []
  const fallbackSeverity = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY ?? '') ? process.env.MEERKAT_DEFAULT_SEVERITY : 'high'
  const f = []
  for (const x of trackedFiles(root)) {
    if (!isText(x) || TESTISH.test(x) || /(^|\/)(node_modules|dist|build|vendor)\//.test(x) || x.endsWith('static.mjs') || allow.has(x)) continue
    const t = readText(root, x)
    for (const [re, why, only] of RISKY) {
      if (!only.test(x)) continue
      // Every hit counts, not just the first in a file: a second innerHTML or eval further down is a separate risk.
      for (const m of t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
        if (safeLiteralAssign(t, m, why)) continue
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
    const t = readText(root, x)
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
    if (!/\.html?$/i.test(x) || /(^|\/)(node_modules|dist|build|fixtures?)\//.test(x)) continue
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
void dirname
void extname
void readFileSync

main({
  whitespace: { run: whitespace, ...fx({ 'a.js': 'a\r\nb\nc\r\n' }, whitespace) },
  'env-example': { run: envExample, ...fx({ 'app.js': 'const k = process.env.MY_SECRET_THING\n' }, envExample) },
  'broken-imports': { run: brokenImports, ...fx({ 'a.js': "import x from './nope.js'\n" }, brokenImports) },
  'dependency-pinning': { run: dependencyPinning, ...fx({ 'package.json': '{"dependencies":{"left-pad":"latest"}}' }, dependencyPinning) },
  'lockfile-integrity': { run: lockfileIntegrity, ...fx({ 'package-lock.json': '{"packages":{"":{},"node_modules/a":{"resolved":"http://registry.example.org/a.tgz","integrity":"sha512-x"}}}' }, lockfileIntegrity) },
  'risky-code': { run: riskyCode, ...fx({ 'app.js': 'const r = eval(input)\n' }, riskyCode) },
  'workflow-security': { run: workflowSecurity, ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: someone/action@v1\n      - run: echo "${{ github.event.pull_request.title }}"\n' }, workflowSecurity) },
  'html-structure': { run: htmlStructure, ...fx({ 'p.html': '<html><body><h1>a</h1><h1>b</h1></body></html>' }, htmlStructure) },
  'css-contrast': { run: cssContrast, ...fx({ 'a.css': '.x { color: #777777; background: #888888; }\n' }, cssContrast) },
  'meta-seo': { run: metaSeo, ...fx({ 'p.html': '<html><head><title>A page title here</title></head><body></body></html>' }, metaSeo) },
  'image-weight': { run: imageWeight, ...fx({ 'big.png': 'x'.repeat(600 * 1024) }, imageWeight) },
})
