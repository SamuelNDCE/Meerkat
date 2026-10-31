// Web and frontend checks that need no tool installed: markup structure, inline handlers, new-tab links, the Content-Security-Policy,
// image sizes, robots.txt and sitemap.xml, web app manifests and overuse of !important. Run through the web-plus pack, or by hand:
//   node thorough/web-plus.mjs <check> [--root <dir>]      node thorough/web-plus.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "web" (maxImportant, maxImageKb). A finding you accept goes in .meerkat-webplus-allow
// as "<check-id> <path>" (use "." for a finding about the whole repository).
import { statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.web ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?|testdata|__fixtures__|test-fixtures)\//i
const MINIFIED = /\.min\.(m?js|css|html)$/i
const HTML = /\.html?$/i
const MARKUP = /\.(html?|jsx|tsx|vue|svelte)$/i
const STYLE = /\.(css|scss|less)$/i
// Server or template syntax around the markup: the page is generated, so its tags cannot be read as plain HTML.
const TEMPLATE = /\{%|\{\{|<%|<\?(?!xml)/
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !isFixture(x))
const allowSet = (root) => new Set(readText(root, '.meerkat-webplus-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const blankOut = (s) => s.replace(/[^\n]/g, ' ')
// The markup with comments and the bodies of script, style, pre, code and textarea blanked out (same length, so line numbers still match).
const visible = (t) => t
  .replace(/<!--[\s\S]*?-->/g, blankOut)
  .replace(/(<(script|style|pre|code|textarea)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (m, open, tag, body, close) => open + blankOut(body) + close)
const OPEN_TAG = /<[a-zA-Z][^>]*>/g

// ---- html-valid-basics: a page has a doctype, and its common tags nest and close in order
// Only elements whose end tag can never be left out are checked. p, li, td and similar are skipped on purpose (HTML lets you omit them).
const PAIRED = new Set(['a', 'article', 'aside', 'button', 'div', 'em', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'label', 'main', 'nav', 'ol', 'section', 'select', 'span', 'strong', 'table', 'ul'])
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g
function tagProblems(t) {
  const body = visible(t)
  const out = []
  const stack = []
  for (const m of body.matchAll(TAG)) {
    const name = m[2].toLowerCase()
    if (!PAIRED.has(name)) continue
    const line = lineOf(body, m.index)
    if (m[1]) {
      const at = stack.map((s) => s.name).lastIndexOf(name)
      if (at === -1) out.push(`line ${line}: </${name}> has no matching opening tag`)
      else {
        const top = stack[stack.length - 1]
        if (at !== stack.length - 1) out.push(`line ${line}: </${name}> closes while <${top.name}> (opened at line ${top.line}) is still open`)
        stack.length = at
      }
    } else if (!m[3]) stack.push({ name, line })
  }
  for (const s of stack) out.push(`line ${s.line}: <${s.name}> is never closed`)
  return out
}
const htmlValidBasics = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, HTML)) {
    const t = readText(root, x)
    if (!/<html[\s>]/i.test(t) || TEMPLATE.test(t) || allow.has(`html-valid-basics ${x}`)) continue
    if (!/<!doctype\s+html\s*>/i.test(t)) f.push(`${x}: has no <!doctype html> declaration`)
    for (const p of tagProblems(t)) f.push(`${x}: ${p}`)
  }
  return finish('html-valid-basics', f, 'pages have a doctype and their common tags nest and close in order')
}

// ---- duplicate-ids: an id used twice in one page makes the second element unreachable by id (labels, anchors, scripts)
const ID_ATTR = /\sid\s*=\s*["']([^"']+)["']/gi
const duplicateIds = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, HTML)) {
    const t = readText(root, x)
    if (TEMPLATE.test(t) || allow.has(`duplicate-ids ${x}`)) continue
    const body = visible(t)
    const first = new Map()
    for (const m of body.matchAll(ID_ATTR)) {
      const line = lineOf(body, m.index)
      if (first.has(m[1])) f.push(`${x}: id="${m[1]}" is used at line ${first.get(m[1])} and again at line ${line}`)
      else first.set(m[1], line)
    }
  }
  return finish('duplicate-ids', f, 'no id is used twice in one page')
}

// ---- inline-event-handlers: onclick="..." and javascript: links in markup, which a Content-Security-Policy without 'unsafe-inline' blocks
const EVENT_ATTR = /\s(on[a-z]+)\s*=/i
const JS_URL = /\s(?:href|src|action|formaction)\s*=\s*["']\s*javascript:/i
const inlineEventHandlers = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, HTML)) {
    if (allow.has(`inline-event-handlers ${x}`)) continue
    const body = visible(readText(root, x))
    for (const m of body.matchAll(OPEN_TAG)) {
      const line = lineOf(body, m.index)
      const ev = EVENT_ATTR.exec(m[0])
      if (ev) f.push(`${x} line ${line}: ${ev[1]} is written into the tag (move it into a script file and bind it with addEventListener)`)
      if (JS_URL.test(m[0])) f.push(`${x} line ${line}: a link or form uses a javascript: URL`)
    }
  }
  return finish('inline-event-handlers', f, 'no markup carries inline script handlers')
}

// ---- target-blank-noopener: a link that opens a new tab without rel="noopener" lets the new page reach back into this one
const A_OPEN = /<a\b[^>]*>/gi
const BLANK = /\btarget\s*=\s*\{?\s*["'`]_blank["'`]/i
const SAFE_REL = /\brel\s*=\s*\{?\s*["'`][^"'`]*\bno(?:opener|referrer)\b/i
const targetBlankNoopener = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, MARKUP)) {
    if (allow.has(`target-blank-noopener ${x}`)) continue
    const body = visible(readText(root, x))
    for (const m of body.matchAll(A_OPEN)) {
      if (BLANK.test(m[0]) && !SAFE_REL.test(m[0])) f.push(`${x} line ${lineOf(body, m.index)}: a link opens a new tab with target="_blank" but no rel="noopener"`)
    }
  }
  return finish('target-blank-noopener', f, 'every new-tab link has rel="noopener" (or noreferrer)')
}

// ---- csp-present: a site with HTML pages should send a Content-Security-Policy, in a meta tag, a header file or the server code
const CSP_MARK = /content-security-policy|helmet\s*\(|helmet\.contentSecurityPolicy/i
const CSP_SOURCES = /\.(html?|jsx|tsx|vue|svelte|m?[jt]sx?|cjs|json|toml|conf|ya?ml|txt|php|py|rb|go|rs)$|(^|\/)(_headers|\.htaccess|Caddyfile|nginx\.conf)$/i
const cspPresent = (root) => {
  const pages = files(root, HTML).filter((x) => /<html[\s>]/i.test(readText(root, x)))
  const f = []
  if (pages.length && !allowSet(root).has('csp-present .') && !files(root, CSP_SOURCES).some((x) => CSP_MARK.test(readText(root, x)))) {
    f.push(`${pages.length} HTML page(s), for example ${pages[0]}, and no Content-Security-Policy in a meta tag, a header file or the server code (add one, or accept it with "csp-present ." in .meerkat-webplus-allow)`)
  }
  return finish('csp-present', f, 'the site sends a Content-Security-Policy, or has no pages')
}

// ---- image-dimensions: an <img> with no width and height moves the page when it loads; a large local image needs loading="lazy"
const IMG = /<img\b[^>]*>/gi
const SRC = /\ssrc\s*=\s*["']([^"']+)["']/i
const sizeAt = (root, p) => {
  try {
    const s = statSync(join(root, p))
    return s.isFile() ? s.size : null
  } catch {
    return null
  }
}
const localSize = (root, x, src) => {
  const clean = src.split(/[?#]/)[0]
  if (/^(?:[a-z]+:|\/\/)/i.test(clean) || clean.includes('{')) return null
  const rel = clean.startsWith('/') ? clean.slice(1) : posix.join(posix.dirname(x), clean)
  for (const p of [rel, posix.join('public', rel)]) {
    const size = sizeAt(root, p)
    if (size !== null) return size
  }
  return null
}
const imageDimensions = (root) => {
  const allow = allowSet(root)
  const max = (cfg(root).maxImageKb ?? 500) * 1024
  const f = []
  for (const x of files(root, HTML)) {
    const t = readText(root, x)
    if (TEMPLATE.test(t) || allow.has(`image-dimensions ${x}`)) continue
    const body = visible(t)
    for (const m of body.matchAll(IMG)) {
      const src = SRC.exec(m[0])?.[1]
      if (src === undefined || src.includes('{')) continue
      const line = lineOf(body, m.index)
      const sized = (/\swidth\s*=/i.test(m[0]) && /\sheight\s*=/i.test(m[0])) || /aspect-ratio/i.test(m[0])
      if (!sized) f.push(`${x} line ${line}: <img src="${src}"> has no width and height, so the page jumps when it loads`)
      const size = localSize(root, x, src)
      if (size !== null && size > max && !/\sloading\s*=\s*["']?lazy/i.test(m[0])) f.push(`${x} line ${line}: ${src} is ${Math.round(size / 1024)} KB and has no loading="lazy"`)
    }
  }
  return finish('image-dimensions', f, 'every image has a size, and large images load lazily')
}

// ---- robots-sitemap: a folder with an index.html is a web root; it should have a robots.txt or a sitemap.xml (beside the page or in public/)
// An Electron or Tauri app loads its pages from disk: there is no crawler, so robots.txt and sitemap.xml do not apply.
const isDesktopApp = (root) => {
  try {
    const p = JSON.parse(readText(root, 'package.json'))
    const deps = { ...p.dependencies, ...p.devDependencies }
    return Boolean(deps.electron || deps['@tauri-apps/api'])
  } catch {
    return false
  }
}
const robotsSitemap = (root) => {
  if (isDesktopApp(root)) return finish('robots-sitemap', [], 'not applicable: this is a desktop app (its pages are not crawled)')
  const allow = allowSet(root)
  const tracked = new Set(trackedFiles(root))
  const f = []
  for (const x of files(root, /(^|\/)index\.html?$/i)) {
    if (!/<html[\s>]/i.test(readText(root, x)) || allow.has(`robots-sitemap ${x}`)) continue
    const dir = posix.dirname(x)
    const has = (name) => [posix.join(dir, name), posix.join(dir, 'public', name)].some((p) => tracked.has(p))
    if (!has('robots.txt') && !has('sitemap.xml')) f.push(`${x}: a site with pages but no robots.txt or sitemap.xml beside it (add one, or accept it with "robots-sitemap ${x}")`)
  }
  return finish('robots-sitemap', f, 'every web root has a robots.txt or a sitemap.xml')
}

// ---- manifest-valid: a web app manifest is valid JSON with a name, icons and a start_url (a browser extension manifest is not checked)
const MANIFEST = /(\.webmanifest|(^|\/)manifest\.json)$/i
const manifestValid = (root) => {
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, MANIFEST)) {
    if (allow.has(`manifest-valid ${x}`)) continue
    let j
    try {
      j = JSON.parse(readText(root, x))
    } catch {
      f.push(`${x}: is not valid JSON`)
      continue
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      f.push(`${x}: is not a JSON object`)
      continue
    }
    const isWeb = x.endsWith('.webmanifest') || ['start_url', 'icons', 'short_name', 'display'].some((k) => k in j)
    if (!isWeb || 'manifest_version' in j) continue
    if (typeof j.name !== 'string' || !j.name.trim()) f.push(`${x}: has no "name"`)
    if (!Array.isArray(j.icons) || !j.icons.length) f.push(`${x}: has no "icons"`)
    if (typeof j.start_url !== 'string' || !j.start_url) f.push(`${x}: has no "start_url"`)
  }
  return finish('manifest-valid', f, 'every web app manifest has a name, icons and a start_url')
}

// ---- css-important-overuse: !important beyond the budget (web.maxImportant, default 20) makes the cascade impossible to override
const cssImportantOveruse = (root) => {
  const allow = allowSet(root)
  const max = cfg(root).maxImportant ?? 20
  const counts = []
  let total = 0
  for (const x of files(root, STYLE)) {
    if (allow.has(`css-important-overuse ${x}`) || allow.has('css-important-overuse .')) continue
    const css = readText(root, x).replace(/\/\*[\s\S]*?\*\//g, blankOut).replace(/^\s*\/\/.*$/gm, blankOut)
    const n = (css.match(/!\s*important\b/gi) ?? []).length
    if (n) {
      total += n
      counts.push([x, n])
    }
  }
  if (total <= max) return finish('css-important-overuse', [], `${total} uses of !important, within the budget of ${max}`)
  const top = counts.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([x, n]) => `${x}: ${n} uses`)
  return finish('css-important-overuse', [`${total} uses of !important, over the budget of ${max} (set web.maxImportant in .meerkat-budgets.json)`, ...top], '')
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })

main({
  'html-valid-basics': { run: htmlValidBasics, ...fx({ 'index.html': '<!doctype html>\n<html><body><div><span>hi</div></span></body></html>\n' }, htmlValidBasics) },
  'duplicate-ids': { run: duplicateIds, ...fx({ 'index.html': '<!doctype html>\n<html><body><p id="a">x</p><p id="a">y</p></body></html>\n' }, duplicateIds) },
  'inline-event-handlers': { run: inlineEventHandlers, ...fx({ 'index.html': '<!doctype html>\n<html><body><button onclick="go()">Go</button></body></html>\n' }, inlineEventHandlers) },
  'target-blank-noopener': { run: targetBlankNoopener, ...fx({ 'index.html': '<a href="https://example.com/" target="_blank">Example</a>\n' }, targetBlankNoopener) },
  'csp-present': { run: cspPresent, ...fx({ 'index.html': '<!doctype html>\n<html><head><title>Site</title></head><body>Hi</body></html>\n' }, cspPresent) },
  'image-dimensions': { run: imageDimensions, ...fx({ 'index.html': '<!doctype html>\n<html><body><img src="logo.png" alt="Logo"></body></html>\n' }, imageDimensions) },
  'robots-sitemap': { run: robotsSitemap, ...fx({ 'index.html': '<!doctype html>\n<html><body>Hi</body></html>\n' }, robotsSitemap) },
  'manifest-valid': { run: manifestValid, ...fx({ 'site.webmanifest': '{"short_name":"Site"}\n' }, manifestValid) },
  'css-important-overuse': { run: cssImportantOveruse, ...fx({ '.meerkat-budgets.json': '{"web":{"maxImportant":0}}\n', 'a.css': '.a { color: red !important; }\n' }, cssImportantOveruse) },
})
