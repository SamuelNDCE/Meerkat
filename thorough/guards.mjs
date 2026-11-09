// Context checks that turn a pattern hit into "not a risk here". Each one answers a false alarm found in a real scan (Plume, 2026-11-01):
// the same call was flagged although the code around it already limits it. A guard only ever says "this hit is safe", never the reverse,
// and each one is deliberately narrow: when in doubt it answers "not safe", so the finding stays. A guard that wrongly says "safe" hides a
// real problem, which is worse than the noise it removes.

const indentOf = (s) => s.length - s.trimStart().length
// Lines are cut before any pattern runs over them, so a hostile minified line cannot make a guard slow.
const cut = (s) => s.slice(0, 300)
// The header of a function or callback: the code below it runs when something calls it, not as part of the code above.
const FN_HEADER = /(?:=>|\bfunction\b[^\n]{0,100}\))\s*\{\s*$/

// The hit sits inside a braced `if (...)` block whose condition is a positive development or QA switch (QA, isDev, !app.isPackaged, NODE_ENV
// being development, an `&&` of those with other tests). Code in that block does not run in a shipped build. Only enclosing blocks count: the
// walk up follows the indentation inwards to outwards, never crosses a function header or an else, and gives up at the top.
const DEV_SWITCH = /(?<![\w$.!])(?:QA|isDev|IS_DEV)\b|(?<![\w$.])!\s*(?:app\.)?isPackaged\b|NODE_ENV\s*===?\s*['"]development['"]|import\.meta\.env\.DEV\b|__DEV__\b/
export const inDevOnlyBlock = (ctx, lookBack = 40) => {
  let here = indentOf(ctx.lines[ctx.index])
  for (let i = ctx.index - 1; i >= 0 && i >= ctx.index - lookBack; i--) {
    const l = cut(ctx.lines[i])
    if (!l.trim() || indentOf(l) >= here) continue
    here = indentOf(l)
    // A callback written inside the dev block only exists when the block ran, so it stays covered. An else branch is the other side: not covered.
    if (/^\s*(?:}\s*)?else\b/.test(l)) return false
    const m = /^\s*if\s*\((.*)\)\s*\{\s*$/.exec(l)
    if (m) {
      const cond = m[1]
      if (!/\|\|/.test(cond) && DEV_SWITCH.test(cond)) return true
      continue
    }
    if (here === 0) return false
  }
  return false
}

// shell.openPath(p) / trashItem(p) where p was checked by a guard just before in the same function, or is a constant folder.
const GUARDS = String.raw`(?:need|assert|grants\.assert|assertGranted|isAllowed|checkPath|resolveInside|safePath|validatePath|ensureInside)`
const LIT = String.raw`(?:'[^'\\\n$]{0,200}'|"[^"\\\n$]{0,200}")`
const PATH_ARG = String.raw`(?:${LIT}|__dirname|app\.getPath\(\s*'\w+'\s*\))`
export const shellPathIsChecked = (line, ctx, lookBack = 10) => {
  const m = /\bshell\.(?:openPath|showItemInFolder|trashItem)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(cut(line))
  if (!m) return false
  const v = m[1].replace(/\$/g, '\\$')
  const stmt = new RegExp(String.raw`^\s*(?:await\s+)?${GUARDS}\(\s*${v}\s*[,)][^\n]{0,100}$`)
  const assigned = new RegExp(String.raw`(?<![\w$.])${v}\s*[-+*/|&]?=[^=]`)
  const early = new RegExp(String.raw`^\s*if\s*\(\s*!\s*${GUARDS}\(\s*${v}\s*[,)][^\n]{0,60}\)\s*(?:return|throw)\b`)
  for (let i = ctx.index; i >= 0 && i >= ctx.index - lookBack; i--) {
    const l = cut(ctx.lines[i])
    if (i < ctx.index && FN_HEADER.test(l)) break
    if (stmt.test(l) || early.test(l)) return !assigned.test(ctx.lines.slice(i + 1, ctx.index + 1).join('\n'))
  }
  // A constant folder: one declaration whose whole value is string literals, __dirname and app.getPath('name'), never assigned again.
  const decl = new RegExp(String.raw`^[ \t]*(?:const|let|var)\s+${v}\s*=\s*(?:${LIT}|path\.(?:join|resolve)\(\s*${PATH_ARG}(?:\s*,\s*${PATH_ARG}){0,6}\s*\)|app\.getPath\(\s*'\w+'\s*\))\s*;?\s*$`, 'm')
  if (!decl.test(ctx.text)) return false
  const rest = ctx.text.replace(decl, '')
  return !new RegExp(String.raw`(?<![\w$.])${v}\s*[-+*/|&]?=[^=]`).test(rest) && !new RegExp(String.raw`(?:\bfunction\b[^(\n]{0,60}|=>|\)\s*)?\([^()\n]{0,120}\b${v}\b[^()\n]{0,120}\)\s*(?:=>|\{)`).test(rest)
}

// require(name) inside a helper whose every use in the file is a call with ONE fixed string as its argument: `const load = (name) => require(name)`
// ... `load('x')`. The helper must not be exported, passed as a value, or called through .call or .apply, and its parameter is not reassigned.
const ONE_LITERAL = /^\s*(?:'[^'\\\n]{0,150}'|"[^"\\\n]{0,150}")\s*(?:\)|,)/
export const requireHelperOnlyFixed = (line, ctx) => {
  const m = /(?<![\w$.])require\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(cut(line))
  if (!m) return false
  const v = m[1].replace(/\$/g, '\\$')
  const arrowDecl = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?\s*${v}\s*\)?\s*=>`)
  const fnDecl = new RegExp(String.raw`function\s+([A-Za-z_$][\w$]*)\s*\(\s*${v}\s*[,)]`)
  let fn = null
  let from = ctx.index
  for (let i = ctx.index; i >= 0 && i >= ctx.index - 8; i--) {
    const l = cut(ctx.lines[i])
    const d = arrowDecl.exec(l) ?? fnDecl.exec(l)
    if (d) { fn = d[1]; from = i; break }
  }
  if (!fn) return false
  if (new RegExp(String.raw`(?<![\w$.])${v}\s*[-+*/|&]?=[^=>]`).test(ctx.lines.slice(from + 1, ctx.index + 1).join('\n'))) return false
  const name = fn.replace(/\$/g, '\\$')
  const declAt = new RegExp(String.raw`(?:const|let|var|function)\s+${name}\b`)
  const all = [...ctx.text.matchAll(new RegExp(String.raw`(?<![\w$.])${name}\b`, 'g'))].filter((c) => !declAt.test(ctx.text.slice(Math.max(0, c.index - 10), c.index + name.length)))
  if (!all.length) return false
  return all.every((c) => {
    const after = ctx.text.slice(c.index + name.length, c.index + name.length + 160)
    return after.startsWith('(') && ONE_LITERAL.test(after.slice(1))
  })
}

// Markup set from a name such as ICONS.save, where ICONS (any name) is a top-level constant whose value holds only string text: a table of plain strings. No ${},
// no calls, no joins, no value that is a name. The name is declared once and never assigned to (not even a property).
export const isConstantMarkup = (text, name) => {
  const n = name.replace(/\$/g, '\\$')
  const decls = text.match(new RegExp(String.raw`(?:const|let|var)\s+${n}\b`, 'g')) ?? []
  if (decls.length !== 1) return false
  // Also used as a parameter name somewhere: the name in a use may be that parameter, not this constant.
  if (new RegExp(String.raw`[(,]\s*${n}\s*[,)=]`).test(text)) return false
  const m = new RegExp(String.raw`^(?:export\s+)?const\s+${n}\s*=([\s\S]*?)(?=^\S)`, 'm').exec(text)
  if (!m) return false
  const body = m[1]
  if (/\$\{/.test(body)) return false
  const stripped = body.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
  // What is left may only be structure: braces, brackets, commas, colons and keys. A bare name as a value would be a variable.
  if (/[A-Za-z_$]/.test(stripped.replace(/(?:^|[\s{,])[A-Za-z_$][\w$]*\s*:/g, ' '))) return false
  if (/[(+]|=>/.test(stripped)) return false
  return !new RegExp(String.raw`(?<![\w$.])${n}\s*(?:\.[\w$]+|\[[^\]]{0,80}\])*\s*[-+*/|&]?=[^=]`).test(text.replace(m[0], ''))
}

// The text of a top-level declaration of `name` (a function or an arrow function bound to a const) up to the next line that starts at column 0 (a closing brace stays).
const topLevelDecl = (text, name) => {
  const n = name.replace(/\$/g, '\\$')
  const all = [...text.matchAll(new RegExp(String.raw`^(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*${n}\s*\(|(?:const|let|var)\s+${n}\s*=\s*(?:async\s*)?(?:function\b[^(]*)?(?:\([^)]*\)|[\w$]+)\s*(?:=>)?)`, 'gm'))]
  if (all.length !== 1) return null
  const from = all[0].index
  const rest = text.slice(from)
  const nl = rest.indexOf('\n')
  const after = nl < 0 ? '' : rest.slice(nl + 1).split('\n')
  const keep = [rest.slice(0, nl < 0 ? rest.length : nl)]
  for (const l of after) {
    if (/^[^\s})\]]/.test(l)) break
    keep.push(l)
  }
  return keep.join('\n')
}
const LIT_STR = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`
// `const iconSvg = (name) => `<svg ...>${PATHS[name]}</svg>``: a local builder whose whole result is one template literal, and every ${} in it is a lookup in a table of
// plain strings (isConstantMarkup) or a choice between two string literals made by comparing a name to a literal. The markup is author-written whatever is passed in.
export const isStaticMarkupBuilder = (text, fn) => {
  const decl = topLevelDecl(text, fn)
  if (!decl) return false
  const open = decl.indexOf('`')
  if (open < 0 || /\b(?:innerHTML|insertAdjacentHTML|eval|Function)\b/.test(decl)) return false
  // Only the template is allowed in the body: whatever comes before it is the signature, and only a return or an arrow may sit between.
  const head = decl.slice(0, open).replace(/\s+/g, ' ').trim()
  const n = fn.replace(/\$/g, '\\$')
  if (!new RegExp(String.raw`^(?:export )?(?:const|let|var) ${n} = (?:async )?(?:\([^)]*\)|[\w$]+) =>$|^(?:export )?function ${n} ?\([^)]*\) ?\{ ?return$`).test(head)) return false
  const exprs = []
  let i = open + 1
  for (; i < decl.length; i++) {
    const c = decl[i]
    if (c === '\\') i++
    else if (c === '`') break
    else if (c === '$' && decl[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      for (; j < decl.length && depth > 0; j++) {
        if (decl[j] === '`') return false
        if (decl[j] === '{') depth++
        else if (decl[j] === '}') depth--
      }
      if (depth) return false
      exprs.push(decl.slice(i + 2, j - 1).trim())
      i = j - 1
    }
  }
  if (i >= decl.length) return false
  // After the closing backtick only the end of the statement may follow (a `}` of a function body, a `;`).
  if (!/^[\s;}]*$/.test(decl.slice(i + 1))) return false
  const table = new RegExp(String.raw`^([A-Za-z_$][\w$]*)\s*\[\s*(?:[A-Za-z_$][\w$]*|${LIT_STR})\s*\]$`)
  const choice = new RegExp(String.raw`^[A-Za-z_$][\w$.]*\s*(?:===|!==)\s*${LIT_STR}\s*\?\s*${LIT_STR}\s*:\s*${LIT_STR}$`)
  return exprs.every((e) => {
    const t = table.exec(e)
    return t ? isConstantMarkup(text, t[1]) : choice.test(e)
  })
}
// `ipcMain.handle(...)` in a file that never imports ipcMain from electron: the name is a parameter, such as `function register({ ipcMain })`. When another
// file of the project passes `ipcMain: guarded` and `guarded` is an object defined there whose every method this file uses stops a message from the wrong
// sender, every handler registered here is checked. Fails closed: a call site written any other way (shorthand `{ ipcMain }`, a member or call expression, the
// real ipcMain), a wrapper that lacks one of the methods used, no call site found at all, or an electron import in this file all keep the finding.
const SENDER_TEST = /\.sender\b|senderFrame|isMainFrame|frameId/
const EVENT_ARG = String.raw`(?:e|ev|event|_e|evt)`
const escapeRe = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
// A condition that looks at the sender itself and stops the handler: `if (... e.senderFrame ...)`.
const directGuard = (code) => new RegExp(String.raw`\bif\s*\([^)\n]*(?:\.sender\b|senderFrame|isMainFrame|frameId)`).test(code)
// `if (!helper(e)) ...` where helper is declared in the same file and its own first lines look at the sender. A mention elsewhere does not count.
const callsSenderHelper = (code, text) => {
  const body = stripComments(code)
  // `if (!helper(e)) stop` or `if (helper(e)) run`; the second form with an else would run something for the wrong sender too.
  if (/\belse\b/.test(body)) return false
  for (const m of body.matchAll(new RegExp(String.raw`\bif\s*\(\s*!?\s*([A-Za-z_$][\w$]*)\(\s*${EVENT_ARG}\s*[,)]`, 'g'))) {
    const decl = new RegExp(String.raw`^[ \t]*(?:const|let|var|function)\s+${escapeRe(m[1])}\b`, 'm').exec(text)
    if (decl && SENDER_TEST.test(stripComments(text.slice(decl.index, decl.index + 400)).split('\n').slice(0, 4).join('\n'))) return true
  }
  return false
}
// `const name = { handle: ..., on: ... }`: each method in `methods` exists and its own body is guarded.
const wrapperGuardsMethods = (other, name, methods) => {
  const decl = new RegExp(String.raw`^[ \t]*(?:const|let|var)\s+${escapeRe(name)}\s*=\s*\{`, 'm').exec(other)
  if (!decl || !methods.length) return false
  const lines = stripComments(other.slice(decl.index)).split('\n').slice(0, 40)
  const end = lines.findIndex((l, i) => i > 0 && /^\S/.test(l))
  const region = end < 0 ? lines : lines.slice(0, end)
  for (const method of methods) {
    const at = region.findIndex((l, i) => i > 0 && new RegExp(String.raw`^\s*${escapeRe(method)}\s*(?::|\()`).test(l))
    if (at < 0) return false
    const indent = indentOf(region[at])
    let stop = region.length
    for (let i = at + 1; i < region.length; i++) {
      if (region[i].trim() && indentOf(region[i]) <= indent) {
        stop = i
        break
      }
    }
    const body = region.slice(at, stop).join('\n')
    if (!directGuard(body) && !callsSenderHelper(body, other)) return false
  }
  return true
}
export const ipcMainIsGuardedParameter = (_line, ctx) => {
  const text = ctx.text
  // The name may appear only as the one-line parameter destructure and as `ipcMain.method(`. An import, an alias, a destructure of anything else, `electron.ipcMain`,
  // a spread or a multi-line header all leave a use behind, and then the finding stays.
  const param = /\(\s*\{[^}\n]{0,200}\bipcMain\b[^}\n]{0,200}\}\s*\)/
  if (!param.test(text)) return false
  if (/\bipcMain\b/.test(stripComments(text).replace(param, ' ').replace(/\bipcMain\.[A-Za-z]+\(/g, ' '))) return false
  const methods = [...new Set([...text.matchAll(/\bipcMain\.([A-Za-z]+)\(/g)].map((m) => m[1]))]
  const project = ctx.project
  if (!project?.files?.length || !methods.length) return false
  const base = ctx.file.split('/').pop().replace(/\.[cm]?[jt]s$/, '')
  const required = new RegExp(String.raw`['"]\.{1,2}/(?:[^'"\n]*/)?${escapeRe(base)}(?:\.[cm]?[jt]s)?['"]`)
  let sites = 0
  for (const f of project.files) {
    if (f === ctx.file || !/\.[cm]?[jt]sx?$/.test(f)) continue
    const other = project.read(f)
    if (typeof other !== 'string' || !required.test(other)) continue
    // Every place this file hands something over as ipcMain must be a plain name of a guarded wrapper; shorthand or anything computed is not understood.
    for (const m of other.matchAll(/[{,]\s*ipcMain\b\s*(?::\s*([^,}\n]*))?\s*(?=[,}])/g)) {
      // `const { app, ipcMain } = require('electron')` and `import { ipcMain } from 'electron'` bring the name in; they hand nothing over.
      const close = other.indexOf('}', m.index + m[0].length)
      if (close >= 0 && /^\s*(?:=(?!=)|from\b)/.test(other.slice(close + 1, close + 20))) continue
      sites++
      const value = (m[1] ?? '').trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(value) || value === 'ipcMain') return false
      if (!wrapperGuardsMethods(other, value, methods)) return false
    }
  }
  return sites > 0
}

// An ipc handler whose own first lines stop on a sender-checking helper declared in the same file: `ipcMain.handle(ch, (e) => { if (!fromAppPage(e)) throw ... })`.
// Only the handler's lines count: the window ends where the next ipcMain call starts.
export const ipcHandlerCallsSenderHelper = (_line, ctx) => {
  const rest = ctx.lines.slice(ctx.index + 1, ctx.index + 8)
  const next = rest.findIndex((l) => /\bipcMain\./.test(l))
  return callsSenderHelper([ctx.lines[ctx.index], ...(next < 0 ? rest : rest.slice(0, next))].join('\n'), ctx.text)
}

// ---- Electron false-alarm guards (round 5, from an Electron app audit of 2026-11-02) ----

// The argument of a call on this line is a bare identifier that is a module-level constant holding a fixed string (or a template with no ${} hole):
// `const DEV_SERVER = 'http://localhost:5273'` then `win.loadURL(DEV_SERVER)`. The address or script is fixed in the source, nothing from outside can reach it.
// A parameter, a `let`, an indented const inside a function, or a template with a hole is NOT fixed.
export const argIsModuleConstString = (callName) => (line, ctx) => {
  const id = new RegExp(`\\b${callName}\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]`).exec(line)?.[1]
  if (!id) return false
  const decl = new RegExp(`^(?:export\\s+)?const\\s+${id.replace(/\$/g, '\\$')}\\s*(?::[^=\\n]{1,60})?=\\s*(['"\`])`, 'm').exec(ctx.text)
  if (!decl) return false
  if (decl[1] !== '`') return true
  const rest = ctx.text.slice(decl.index + decl[0].length, decl.index + decl[0].length + 40000)
  const end = rest.indexOf('`')
  return end >= 0 && !rest.slice(0, end).includes('${')
}

// A template literal on this line whose every ${...} hole is wrapped in `wrap(` (JSON.stringify for a script, encodeURIComponent for a data: address).
// A hole that holds anything else, or one this simple scan cannot read (a nested brace), counts as unwrapped.
export const holesAllWrapped = (callName, wrap, needPrefix) => (line) => {
  const m = new RegExp(`\\b${callName}\\(\\s*\`([^\`]*)\``).exec(line)
  if (!m) return false
  if (needPrefix && !needPrefix.test(m[1])) return false
  const holes = [...m[1].matchAll(/\$\{([^}]*)\}/g)]
  if (!holes.length || m[1].replace(/\$\{[^}]*\}/g, '').includes('${')) return false
  return holes.every((h) => new RegExp(`^\\s*${wrap}\\(`).test(h[1]) && (h[1].match(/\(/g) ?? []).length === (h[1].match(/\)/g) ?? []).length)
}

// Some file of the app registers a window-open handler that denies every window (action: 'deny') and never allows one:
// window.open(url) from the page is then routed by the main process (for example to a consent dialog), not opened by the page.
const JS_FILE = /\.(?:[cm]?[jt]sx?)$/i
export const appDeniesWindowOpen = (_line, ctx) => {
  const texts = [ctx.text, ...(ctx.project?.files ?? []).filter((f) => JS_FILE.test(f) && f !== ctx.file).map((f) => ctx.project.read(f) ?? '')]
  const handlers = texts.filter((t) => typeof t === 'string' && /setWindowOpenHandler/.test(t))
  if (!handlers.length) return false
  const all = handlers.join('\n')
  return /action\s*:\s*['"]deny['"]/.test(all) && !/action\s*:\s*['"]allow['"]/.test(all)
}

// The line sits within `n` lines below a call of `name(` (the handler body of that call).
export const withinCallBody = (name, n) => (_line, ctx) => ctx.lines.slice(Math.max(0, ctx.index - n), ctx.index + 1).some((l) => new RegExp(`\\b${name}\\s*\\(`).test(l))

// The line sits inside an ipcMain.handle / ipcMain.on handler (one is opened within the 25 lines above).
export const inIpcHandler = (_line, ctx) => ctx.lines.slice(Math.max(0, ctx.index - 25), ctx.index + 1).some((l) => /\bipcMain\.(?:handle|on|once)\s*\(/.test(l))

// The channel name used on this line was checked against a list just above (`ALLOWED.includes(channel)`, `.has(channel)`, `isAllowedChannel(channel)`).
export const channelChecked = (_line, ctx) => {
  const above = ctx.lines.slice(Math.max(0, ctx.index - 12), ctx.index).join('\n')
  return /\b(?:includes|has)\(\s*(?:channel|ch|chan|topic)\s*\)|\b(?:is|assert|check|validate)\w*(?:Channel|Event)\w*\(\s*(?:channel|ch|chan|topic)\s*\)/i.test(above)
}

// A template literal passed to callName whose every ${...} hole is a number or a module-level const that holds a literal: the script is fixed at write time, so no input can change it.
export const templateHolesAllConstant = (callName) => (line, ctx) => {
  const m = new RegExp(`\\b${callName}\\(\\s*\`([^\`]*)\``).exec(line)
  if (!m) return false
  const holes = [...m[1].matchAll(/\$\{\s*([^}]*?)\s*\}/g)].map((h) => h[1])
  if (!holes.length) return false
  return holes.every((h) => {
    if (/^\d+(?:\.\d+)?$/.test(h)) return true
    if (!/^[A-Za-z_$][\w$]*$/.test(h)) return false
    return new RegExp(`^(?:export\\s+)?const\\s+${h.replace(/\$/g, '\\$')}\\s*(?::[^=\\n]{1,60})?=\\s*(?:['"\`]|\\d)`, 'm').test(ctx.text)
  })
}
