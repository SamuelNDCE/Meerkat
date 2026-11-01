// Context checks that turn a pattern hit into "not a risk here". Each one answers a false alarm found in a real scan (Plume, 2026-11-01):
// the same call was flagged although the code around it already limits it. A guard only ever says "this hit is safe", never the reverse,
// and each one is deliberately narrow so a real problem next to it is still reported.

const indentOf = (s) => s.length - s.trimStart().length

// The hit sits inside an `if (...)` whose condition names a development or QA switch (QA, isDev, !app.isPackaged, an environment flag).
// Code in that block does not run in a shipped build.
export const inDevOnlyBlock = (ctx, lookBack = 30) => {
  const here = indentOf(ctx.lines[ctx.index])
  for (let i = ctx.index - 1; i >= 0 && i >= ctx.index - lookBack; i--) {
    const l = ctx.lines[i]
    if (!l.trim() || indentOf(l) >= here) continue
    const m = /\bif\s*\((.*)\)\s*\{?\s*$/.exec(l) ?? /\bif\s*\((.*)/.exec(l)
    if (m && /(?:^|[^\w$.!])(?:QA|isDev|IS_DEV|DEV)\b|!\s*(?:app\.)?isPackaged\b|\bprocess\.env\.\w+|import\.meta\.env\.DEV|__DEV__/.test(m[1])) return true
    if (/^\s*(?:function\b|(?:async\s+)?\(.*\)\s*=>|}\s*$)/.test(l) && indentOf(l) === 0) return false
  }
  return false
}

// shell.openPath(p) / trashItem(p) where p was checked by a guard call just before (need(p), assert(p) ...) or is a constant folder.
const GUARD_CALL = (v) => new RegExp(String.raw`(?:^|[^\w$])(?:need|assert|grants\.assert|assertGranted|isAllowed|checkPath|resolveInside|safePath|validatePath|ensureInside)\(\s*${v}\b`)
export const shellPathIsChecked = (line, ctx, lookBack = 10) => {
  const m = /\bshell\.(?:openPath|showItemInFolder|trashItem)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(line)
  if (!m) return false
  const v = m[1].replace(/\$/g, '\\$')
  const guard = GUARD_CALL(v)
  for (let i = ctx.index; i >= 0 && i >= ctx.index - lookBack; i--) if (guard.test(ctx.lines[i])) return true
  // A constant: const dir = path.join(app.getPath(...)) or a string literal, never assigned again.
  const decl = new RegExp(String.raw`(?:const|let|var)\s+${v}\s*=\s*(?:path\.(?:join|resolve)\(\s*(?:app\.getPath\(|__dirname)|app\.getPath\(|['"\x60][^$]*['"\x60]\s*[;\n])`)
  return decl.test(ctx.text) && !new RegExp(String.raw`(?<![\w$.])${v}\s*=[^=]`).test(ctx.text.replace(decl, ''))
}

// require(name) inside a helper whose every call in the file passes a fixed string: `const load = (name) => require(name)` ... `load('x')`.
export const requireHelperOnlyFixed = (line, ctx) => {
  const m = /(?<![\w$.])require\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(line)
  if (!m) return false
  const v = m[1].replace(/\$/g, '\\$')
  let fn = null
  for (let i = ctx.index; i >= 0 && i >= ctx.index - 8; i--) {
    const d = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?\s*${v}\s*\)?\s*=>`).exec(ctx.lines[i]) ??
      new RegExp(String.raw`function\s+([A-Za-z_$][\w$]*)\s*\(\s*${v}\s*[,)]`).exec(ctx.lines[i])
    if (d) { fn = d[1]; break }
  }
  if (!fn) return false
  const name = fn.replace(/\$/g, '\\$')
  const calls = [...ctx.text.matchAll(new RegExp(String.raw`(?<![\w$.])${name}\(\s*([^\n)]{0,80})`, 'g'))]
    .filter((c) => !new RegExp(String.raw`(?:const|let|var|function)\s+${name}\b`).test(ctx.text.slice(Math.max(0, c.index - 12), c.index + name.length + 1)))
  return calls.length > 0 && calls.every((c) => /^\s*['"]/.test(c[1]))
}

// `el.innerHTML = ICONS.save` where ICONS (any name) is a top-level constant whose value holds only string text: no ${}, no calls, no joins.
export const isConstantMarkup = (text, name) => {
  const n = name.replace(/\$/g, '\\$')
  const m = new RegExp(String.raw`^(?:export\s+)?const\s+${n}\s*=([\s\S]*?)(?=^\S)`, 'm').exec(text)
  if (!m) return false
  const body = m[1]
  if (/\$\{/.test(body)) return false
  const stripped = body.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
  return !/[(+]|=>/.test(stripped)
}
