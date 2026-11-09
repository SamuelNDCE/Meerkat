// Context checks for the cp-* code-pattern rules (thorough/rules-code-patterns.mjs): each says "the hit is not a risk here" and is used as a rule's
// `unless`. They answer false alarms found on the safe twins of the trap corpus (tools/accuracy-extra-trap-web-*.mjs). Like thorough/guards.mjs, every one
// is deliberately narrow: a guard only ever says "safe", never the reverse, and when in doubt it says "not safe" so the finding stays.

const cut = (s) => (s ?? '').slice(0, 300)
const esc = (s) => s.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&')

// A name declared once as a string constant: Go `const x = "..."` (or inside a const block), Java `static final String X = "..."`, C# `const string X = "..."`,
// JS `const x = '...'` (no interpolation).
export const constString = (text, name, lang) => {
  const n = esc(name)
  if (lang === 'go') return new RegExp(String.raw`(?:^|\n)[ \t]*const[ \t]+${n}\b[^=\n]*=[ \t]*"[^"\n]*"|(?:^|\n)[ \t]*const[ \t]*\([^)]*\n[ \t]*${n}\b[^=\n]*=[ \t]*"[^"\n]*"`).test(text)
  if (lang === 'java') return new RegExp(String.raw`\bfinal\s+String\s+${n}\s*=\s*"[^"\n]*"\s*;`).test(text)
  if (lang === 'cs') return new RegExp(String.raw`\bconst\s+string\s+${n}\s*=\s*@?"[^"\n]*"\s*;`).test(text)
  return new RegExp(String.raw`(?:^|\n)[ \t]*(?:export\s+)?const\s+${n}\s*=\s*(?:'[^'\\\n$]*'|"[^"\\\n$]*")\s*;?[ \t]*(?:\n|$)`).test(text)
}
export const firstArgIsConst = (callRe, lang) => (line, ctx) => {
  const m = callRe.exec(cut(line))
  return Boolean(m) && constString(ctx.text, m[1], lang)
}

// ---------------------------------------------------------------- Python
// subprocess with a plain-text command (no f prefix, no % or + after it): nothing is put into the text.
export const pyLiteralCommand = (line) => /\bsubprocess\.\w+\(\s*(['"])(?:(?!\1)[^\\\n])*\1\s*(?:,|\))/.test(cut(line))
// ... and shell=True asked for on purpose: a one-string call is how a shell is meant to be used.
export const pySubprocessStringShell = (line) => pyLiteralCommand(line) && /\bshell\s*=\s*True\b/.test(line)
// mark_safe on a plain string literal (no f prefix, no % or .format or +): fixed markup, nothing to escape.
export const pyMarkSafeLiteral = (line) => /\bmark_safe\(\s*(['"])(?:(?!\1)[^\\\n])*\1\s*\)/.test(cut(line))
// minidom here is the defusedxml one (`from defusedxml import minidom`), and the standard-library minidom is not imported too.
export const pyDefusedMinidom = (line, ctx) => {
  if (!/(?<![\w.])minidom\.parse/.test(line) || /xml\.dom\.minidom\.parse/.test(line)) return false
  const defused = /^\s*from\s+defusedxml(?:\.minidom)?\s+import\b[^\n]*\bminidom\b|^\s*import\s+defusedxml\.minidom\s+as\s+minidom\b/m.test(ctx.text)
  return defused && !/^\s*from\s+xml\.dom\s+import\b[^\n]*\bminidom\b|^\s*import\s+xml\.dom\.minidom\b/m.test(ctx.text)
}
// A csrf_exempt view that checks a request signature before it does anything: a webhook, authenticated by the signature, not a cookie.
export const pyCsrfExemptSigned = (line, ctx) => {
  let seenDef = false
  for (let i = ctx.index + 1; i < Math.min(ctx.lines.length, ctx.index + 26); i++) {
    const l = ctx.lines[i]
    if (/^(?:def|class|async def)\b/.test(l) && seenDef) break
    if (/^\s*(?:async\s+)?def\b/.test(l)) seenDef = true
    if (/\bhmac\.compare_digest\(|\bconstant_time_compare\(|\bverify_signature\(|\bconstruct_event\(|\bWebhook\.verify\(/.test(l)) return seenDef
  }
  return false
}
// extractall on a zip: ZipFile.extractall drops absolute names and .. parts itself; only tar needs a filter. Holds when the file uses zipfile and never tarfile.
export const pyZipOnlyExtract = (line, ctx) => /\bzipfile\b/.test(ctx.text) && !/\btarfile\b|\bshutil\.unpack_archive\b/.test(ctx.text)

// ---------------------------------------------------------------- Go
export const goConstFirstArg = firstArgIsConst(/\bexec\.Command\(\s*([A-Za-z_]\w*)\s*[,)]/, 'go')
const GO_CONFIG_PKG = /^(?:config|cfg|conf|settings|constants|consts)$/
// http.Get(config.UpstreamURL): a URL from the deployment configuration package, or a string constant, is not a URL a caller chooses.
export const goGetFromConfig = (line, ctx) => {
  const m = /\bhttp\.(?:Get|Post|Head)\(\s*([A-Za-z_]\w*)(?:\.([A-Z]\w*))?\s*[,)]/.exec(cut(line))
  if (!m) return false
  return m[2] ? GO_CONFIG_PKG.test(m[1]) : constString(ctx.text, m[1], 'go')
}
export const goLoopbackListen = (line) => /\bhttp\.ListenAndServe(?:TLS)?\(\s*"(?:127\.0\.0\.1|localhost|\[::1\])[:"]/.test(cut(line))
// Every ListenAndServe in the file binds loopback: a profiling endpoint that is not reachable from outside.
export const goPprofLoopbackOnly = (line, ctx) => {
  const listens = [...ctx.text.matchAll(/\bListenAndServe(?:TLS)?\(\s*([^,)\n]*)/g)].map((m) => m[1].trim())
  return listens.length > 0 && listens.every((a) => /^"(?:127\.0\.0\.1|localhost|\[::1\])[:"]/.test(a))
}
export const goShellLiteralScript = (line) => /"(?:-c|\/c)",\s*(?:"[^"\n]*"|`[^`\n]*`)\s*\)/.test(cut(line))
// Sprintf into SQL where every argument is a string constant (a column list, a table name): nothing a caller can change.
export const goSprintfConstArgs = (line, ctx) => {
  const m = /fmt\.Sprintf\(\s*"[^"\n]*"((?:\s*,\s*[A-Za-z_]\w*)+)\s*\)/.exec(cut(line))
  if (!m) return false
  const args = m[1].split(',').map((s) => s.trim()).filter(Boolean)
  return args.length > 0 && args.every((a) => constString(ctx.text, a, 'go'))
}
// A multi-line http.Cookie{ ... } literal that sets Secure: true on one of its lines.
export const goCookieSecureMultiline = (line, ctx) => {
  if (!/\bhttp\.Cookie\{\s*$/.test(cut(line))) return false
  for (let i = ctx.index + 1; i < Math.min(ctx.lines.length, ctx.index + 20); i++) {
    const l = ctx.lines[i]
    if (/\bSecure\s*:\s*true\b/.test(l)) return true
    if (/^\s*\}/.test(l)) break
  }
  return false
}
export const goHtmlLiteral = (line) => /\btemplate\.HTML\(\s*(?:"[^"\n]*"|`[^`\n]*`)\s*\)/.test(cut(line))
// The request value is cut down to its last path element by filepath.Base before it is joined to the folder.
export const goBaseWrapped = (line) => {
  const stripped = cut(line).replace(/\bfilepath\.Base\((?:[^()]|\([^()]*\))*\)/g, 'BASE')
  return stripped !== cut(line) && !/\bos\.(?:Open|OpenFile|ReadFile|Create)\([^\n]{0,80}(?:FormValue|PathValue|URL\.Query\(\)|\.Param\(|FormFile)/.test(stripped)
}
// filepath.Join(dest, f.Name) followed within a few lines by a prefix or Rel check on the result.
export const goZipChecked = (line, ctx) => {
  const m = /\b(\w+)\s*:?=\s*filepath\.Join\(/.exec(cut(line))
  if (!m) return false
  const v = esc(m[1])
  const re = new RegExp(String.raw`strings\.HasPrefix\(\s*${v}\b|filepath\.Rel\([^\n]*\b${v}\b|strings\.Contains\([^\n]*\.Name,\s*"\.\."`)
  return ctx.lines.slice(ctx.index + 1, ctx.index + 9).some((l) => re.test(l))
}

// ---------------------------------------------------------------- Java
export const javaConstProcess = firstArgIsConst(/\bnew\s+ProcessBuilder\(\s*([A-Za-z_]\w*)\s*[,)]/, 'java')
export const javaConstSpel = firstArgIsConst(/\.parseExpression\(\s*([A-Za-z_]\w*)\s*[,)]/, 'java')
export const javaConstLookup = firstArgIsConst(/\.lookup\(\s*([A-Za-z_]\w*)\s*[,)]/, 'java')
export const javaConstExec = (line, ctx) => firstArgIsConst(/\.exec\(\s*([A-Za-z_]\w*)\s*[,)]/, 'java')(line, ctx) || /\.exec\(\s*new\s+String\[\]\s*\{\s*"[^"\n]*"(?:\s*,\s*"[^"\n]*")*\s*\}\s*\)/.test(cut(line))
// AEAD and stream modes have no padding: NoPadding is the only correct choice there.
export const javaStreamModeNoPadding = (line) => /\bCipher\.getInstance\(\s*"[^"\n]*\/(?:GCM|CTR|CCM|OFB|CFB\d*)\/NoPadding"/.test(cut(line))
export const javaSqlConstTail = (line, ctx) => {
  const m = /\.(?:executeQuery|executeUpdate|execute)\(\s*"[^"\n]*"\s*\+\s*([A-Za-z_]\w*)\s*\)/.exec(cut(line))
  return Boolean(m) && constString(ctx.text, m[1], 'java')
}
// An LDAP filter built from a variable whose LAST assignment before the filter line is a real LDAP filter encoder that wraps the whole
// right-hand side (`v = LdapEncoder.filterEncode(x);`), or a replaceAll whose character class (not negated) covers * ( ) \ and NUL and whose
// replacement is empty or a backslash-hex escape. Any other "escape"/"encode" call (HTML, URL, SQL, DN) does not escape LDAP filter characters.
// An earlier safe assignment never clears a later raw one, and += is never safe.
const LDAP_ENCODER = /^(?:LdapEncoder\.filterEncode|Encode\.forLdapFilter|(?:\w+\.)?escapeLDAPSearchFilter)\b/
const ldapRhsOk = (rhs) => {
  const r = rhs.trim().replace(/"(?:[^"\\]|\\.)*"/g, 'S')
  const wholeCall = (x) => { // the first opening parenthesis closes at the very end
    const open = x.indexOf('(')
    if (open < 0) return false
    let d = 0
    for (let i = open; i < x.length; i++) {
      if (x[i] === '(') d++
      else if (x[i] === ')' && --d === 0) return i === x.length - 1
    }
    return false
  }
  if (LDAP_ENCODER.test(r)) return wholeCall(r)
  if (!/^[\w.$]+\.replaceAll\(\s*S\s*,\s*S\s*\)$/.test(r)) return false
  const m = /\.replaceAll\(\s*"\[([^"\n]*)\]"\s*,\s*"([^"\n]*)"\s*\)\s*$/.exec(rhs.trim())
  if (!m) return false
  const [, c, rep] = m
  if (c.startsWith('^')) return false
  // Exactly one flat class: no nested [, no && intersection, no unescaped ] that would end it early.
  if (/(?<!\\)\[/.test(c) || c.includes('&&') || /(?<!\\)\]/.test(c)) return false
  if (!/^(?:\\{4}[0-9a-fA-F]{2})*$/.test(rep)) return false
  return c.includes('*') && c.includes('(') && c.includes(')') && c.includes('\\\\\\\\') && /\\\\u0000|\\\\x00|\\\\0/.test(c)
}
export const javaLdapEscaped = (line, ctx) => {
  const m = /"\(\s*\w+\s*=\s*\*?"\s*\+\s*([A-Za-z_]\w*)/.exec(cut(line))
  if (!m) return false
  const v = esc(m[1])
  const asg = new RegExp(String.raw`(?<![\w.])${v}\s*(\+?)=(?!=)\s*([^;\n]+);`, 'g')
  let last = null
  for (const l of ctx.lines.slice(0, ctx.index)) for (const a of l.matchAll(asg)) last = a
  return Boolean(last) && last[1] === '' && ldapRhsOk(last[2])
}
// Paths.get(request value).getFileName(): only the last path element is kept.
export const javaFileNameOnly = (line) => /\bPaths\.get\(\s*(?:request|req)\.getParameter\([^()]*\)\s*\)\s*\.getFileName\(\)/.test(cut(line)) && !/\bnew\s+File(?:InputStream|OutputStream)?\(\s*(?:request|req)\.getParameter\(/.test(line)

// ---------------------------------------------------------------- C#
// Process.Start(new ProcessStartInfo("literal", "literal")) with no FileName or Arguments assigned from a variable.
export const csProcessLiteralInfo = (line) => {
  const m = /\bProcess\.Start\(\s*new\s+ProcessStartInfo\(\s*@?"[^"\n]*"\s*(?:,\s*@?"[^"\n]*"\s*)?\)/.exec(cut(line))
  return Boolean(m) && !/\b(?:Arguments|FileName)\s*=/.test(cut(line).slice(m.index + m[0].length))
}
export const csSqlConstTail = (line, ctx) => {
  const m = /"(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*"\s*\+\s*([A-Za-z_]\w*)\s*(?:[;),]|$)/.exec(cut(line))
  return Boolean(m) && constString(ctx.text, m[1], 'cs')
}
// ---------------------------------------------------------------- PHP
// assert() of a comparison: PHP 8 never evaluates assert's argument as text, and a comparison is not text.
// The first argument of every assert( ... ) on the line is read up to its matching parenthesis (string text and the arrows -> => <=> are cut out first).
// It must hold a binary comparison (< <= > >= == === != !== instanceof) at the top level of that argument, and no string concatenation (.).
export const phpAssertComparison = (line) => {
  if (/(?<![\w$>:.])eval\s*\(/.test(line)) return false
  const s = cut(line).replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, 'S').replace(/->|=>|<=>/g, ' ')
  let seen = false
  for (const m of s.matchAll(/(?<![\w$>:.])assert\s*\(/g)) {
    seen = true
    let d = 0
    let top = ''
    for (let i = m.index + m[0].length; i < s.length; i++) {
      const c = s[i]
      if (c === '(') { d++; top += d === 1 ? '(' : '' } else if (c === ')') { if (d === 0) break; d--; top += d === 0 ? ')' : '' } else if (c === ',' && d === 0) break
      else if (d === 0) top += c
    }
    if (!/(?:[<>]=?|[!=]==?|\binstanceof\b)/.test(top) || /(?<!\d)\.(?!\d)/.test(top)) return false
  }
  return seen
}
export const phpUnserializeNoClasses = (line) => /['"]allowed_classes['"]\s*=>\s*false\b/.test(cut(line))
// include/require of a variable that is only ever assigned fixed text: literals, __DIR__, __FILE__, dirname() and dots.
const PHP_FIXED = /^(?:\s*(?:'[^'\\\n]*'|"[^"\\\n$]*"|__DIR__|__FILE__|dirname\(\s*(?:__FILE__|__DIR__)\s*(?:,\s*\d+\s*)?\)|\.)\s*)+$/
export const phpIncludeFixedVar = (line, ctx) => {
  const m = /(?<![\w$])(?:include|require)(?:_once)?\s*\(?\s*\$(\w+)\s*\)?\s*;/.exec(cut(line))
  if (!m) return false
  const asg = [...ctx.text.matchAll(new RegExp(String.raw`\$${esc(m[1])}\s*\.?=(?!=)\s*([^;\n]+);`, 'g'))]
  return asg.length > 0 && asg.every((a) => PHP_FIXED.test(a[1]))
}

// ---------------------------------------------------------------- Ruby
export const rbMarshalOwnFile = (line) => /\bMarshal\.load\(\s*File\.(?:binread|read)\(\s*File\.join\(\s*(?:__dir__|File\.dirname\(__FILE__\))\s*(?:,\s*['"][^'"\n#]*['"]\s*)*\)\s*\)\s*\)/.test(cut(line))
// Every interpolation in the shell string is exactly one escape call over one simple name (`#{Shellwords.escape(name)}`, `#{name.shellescape}`).
// An interpolation that joins text (+, <<, %, a nested #{}) is not removed, so it still counts as a hit.
export const rbShellEscaped = (line, base) => {
  const cleaned = cut(line).replace(/#\{\s*Shellwords\.(?:escape|shellescape)\(\s*[@$]?\w+(?:\.\w+)*\s*\)\s*\}/g, '').replace(/#\{\s*[@$]?\w+(?:\.\w+)*\.shellescape\s*\}/g, '')
  return cleaned !== cut(line) && !base.test(cleaned)
}
// html_safe on a translation whose key ends in _html (Rails marks those safe itself) or on a plain string literal with no interpolation.
export const rbHtmlSafeFixed = (line) => {
  const s = cut(line).replace(/\b(?:I18n\.)?t\(\s*['"][^'"\n]*_html['"][^)\n]*\)\.html_safe\b/g, 'X').replace(/(['"])[^'"#\n]*\1\.html_safe\b/g, 'X')
  return s !== cut(line) && !/\.html_safe\b/.test(s)
}
export const rbNotFoundRoute = (line) => /(?:to:\s*|=>\s*)['"][^'"\n]*#(?:not_found|404|routing_error)\b/.test(cut(line))

// ---------------------------------------------------------------- JavaScript
export const jsConstExec = firstArgIsConst(/(?<![\w$.])(?:(?:child_process|childProcess|cp)\.)?exec(?:Sync)?\(\s*([A-Za-z_$][\w$]*)\s*[,)]/, 'js')
// spawn with a fixed program and an array of fixed words: the shell has nothing to parse but those words (npm needs shell: true on Windows).
// spawn('fixed command line', { shell: true }): the whole command is one fixed string, so nothing can be injected.
const jsSpawnFixedString = (line) => /\bspawn(?:Sync)?\(\s*(['"])[^'"\n]*\1\s*,\s*\{[^}\n]*\bshell\s*:\s*true\b/.test(cut(line))
export const jsSpawnFixedArgs = (line) => jsSpawnFixedString(line) ||/\bspawn(?:Sync)?\(\s*(['"])[^'"\n]*\1\s*,\s*\[\s*(?:(['"])[^'"\n]*\2\s*,?\s*)+\]\s*,\s*\{[^}\n]*\bshell\s*:\s*true\b/.test(cut(line))
// The same, when the words are in a name declared once in the file as an array of fixed strings (const args = ['deploy', '--json']) and never changed after.
const FIXED_WORD = String.raw`(?:(['"])[^'"\n]*\1|\x60[^\x60\n$]*\x60|\d+)`
export const jsSpawnFixedVar = (line, ctx) => {
  const m = /\bspawn(?:Sync)?\(\s*(['"])[^'"\n]*\1\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*\{[^}\n]*\bshell\s*:\s*true\b/.exec(cut(line))
  if (!m || !ctx?.text) return false
  const n = esc(m[2])
  const decl = new RegExp(String.raw`(?:const|let|var)\s+${n}\s*(?::[^=\n]+)?=\s*`)
  if (!new RegExp(decl.source + String.raw`\[\s*(?:${FIXED_WORD}\s*,?\s*)+\]`).test(ctx.text)) return false
  return !new RegExp(String.raw`(?<![\w$.])${n}\s*(?:\.(?:push|unshift|splice|concat|fill)\(|\[[^\]\n]*\]\s*=(?!=)|=(?![=>]))`).test(ctx.text.replace(decl, ''))
}
// require(name) right after a check that name is in a fixed list of strings (a Set or array literal in the same file).
export const jsRequireAllowListed = (line, ctx) => {
  const m = /(?<![\w$.])require\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(cut(line))
  if (!m) return false
  const v = esc(m[1])
  const guard = new RegExp(String.raw`if\s*\(\s*!\s*([A-Za-z_$][\w$.]*)\.(?:has|includes)\(\s*${v}\s*\)\s*\)\s*(?:\{\s*)?(?:throw|return)\b`)
  for (let i = ctx.index; i >= 0 && i >= ctx.index - 6; i--) {
    const g = guard.exec(cut(ctx.lines[i]))
    if (!g) continue
    if (new RegExp(String.raw`(?<![\w$.])${v}\s*[-+*/|&]?=[^=>]`).test(ctx.lines.slice(i + 1, ctx.index + 1).join('\n'))) return false
    const set = esc(g[1])
    return new RegExp(String.raw`(?:const|let|var)\s+${set}\s*=\s*(?:new\s+Set\(\s*)?\[\s*(?:(['"])[^'"\n]*\1\s*,?\s*)+\]`).test(ctx.text)
  }
  return false
}
