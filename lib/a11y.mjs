// The accessibility gap module: checks that find a problem, say how to fix it as TEXT (nothing is ever changed on disk), and then re-check the
// suggested fix themselves, so every finding says whether its own fix would pass. Run through its rule ids, or by hand:
//   node lib/a11y.mjs <rule> [--root <dir>]      node lib/a11y.mjs <rule> --fixtures   (must exit 1)
// It only adds what thorough/a11y.mjs, thorough/hygiene.mjs (ui-static) and thorough/static.mjs (html-structure) do not already do; see GAPS below.
// An accepted finding goes in .meerkat-a11y-allow, one per line: <rule> <file>   or   <rule> <file>:<line>
// Blind spots (said out loud, not hidden): it reads source text, not the rendered page. A JSX/Svelte/Vue expression ({label}), a spread ({...props})
// or a capitalised component (<Icon />) may supply a name, so such cases are assumed fine. CSS-only hiding, ARIA set at run time, and text that
// comes from a template include are invisible. Tags are read with quote and brace awareness, but a template language that builds tags from
// strings is not understood. Heading order is judged per file, so a component that starts at <h3> is allowed; only a jump inside one file is flagged.
import { fileURLToPath } from 'node:url'
import { MEERKAT_DIR as MK } from './paths.mjs'
import { finish, isFixture, isTestFile, main, readText, trackedFiles, withFixture } from '../thorough/kit.mjs'

const MARKUP = /\.(html?|jsx|tsx|vue|svelte)$/i
const COMPONENT_FILE = /\.(jsx|tsx|vue|svelte)$/i
const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor)\//

// What already exists (so nothing is duplicated), and what this module adds on top.
export const GAPS = {
  'a11y-img-alt': 'ui-static flags <img> with no alt but gives no line or fix; this adds line + fix, plus <area>, <input type=image> and role="img" with no name',
  'a11y-form-label': 'html-structure checks <input> in .html only and accepts any id as a label; this covers input/select/textarea in JSX, Vue, Svelte and HTML and needs a real label',
  'a11y-button-name': 'ui-static flags only a literally empty <button>; this adds icon-only buttons and role="button" with no name',
  'a11y-link-name': 'link-text skips links holding an <img> or <svg>; this checks that those have a name',
  'a11y-html-lang': 'ui-static checks <html lang> in .html only; this adds JSX/Vue/Svelte roots and an empty or malformed lang value',
  'a11y-heading-order': 'html-structure checks heading jumps in .html only; this adds JSX/Vue/Svelte',
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length
// Same length as the input so every index still points at the right line.
const blank = (s) => s.replace(/[^\n]/g, ' ')
const clean = (t) => t.replace(/<!--[\s\S]*?-->/g, blank).replace(/\{\/\*[\s\S]*?\*\/\}/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, blank)

// One opening tag starting at `from` (the "<"): name, raw attribute text, where it ends. Quotes and { } (JSX/Svelte expressions) are respected.
function readTag(text, from) {
  const m = /^<([A-Za-z][\w.:-]*)/.exec(text.slice(from, from + 64))
  if (!m) return null
  let i = from + m[0].length
  let quote = ''
  let depth = 0
  const attrsStart = i
  for (; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c
    else if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    else if (c === '>' && depth === 0) break
  }
  if (i >= text.length) return null
  const raw = text.slice(attrsStart, i)
  return { name: m[1], lower: m[1].toLowerCase(), attrs: raw.replace(/\/\s*$/, ''), start: from, end: i + 1, selfClosing: /\/\s*$/.test(raw) }
}

function tagsNamed(text, names) {
  const out = []
  const re = new RegExp(`<(?:${names.join('|')})(?=[\\s/>])`, 'gi')
  for (let m; (m = re.exec(text)); ) {
    const t = readTag(text, m.index)
    if (t) out.push(t)
  }
  return out
}

// Attribute helpers. `spread` means the tag may get attributes we cannot see ({...props}, {...rest}, use:action).
const hasAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}(?=\\s|=|$)`, 'i').test(attrs)
const attrValue = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\{[^}]*\\})|([^\\s"'>]+))`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '') : null
}
const spread = (attrs) => /\{\s*\.\.\./.test(attrs)
const nonEmptyAttr = (attrs, name) => {
  const v = attrValue(attrs, name)
  return v !== null && (v.trim() !== '' && v.trim() !== '""' && v.trim() !== "''")
}

// The tag plus everything up to its closing tag (the first one: button, a, h1-h6 and svg do not nest in themselves).
function withContent(text, tag) {
  if (tag.selfClosing) return { ...tag, inner: '', close: tag.end, full: text.slice(tag.start, tag.end) }
  const re = new RegExp(`</${tag.lower}\\s*>`, 'ig')
  re.lastIndex = tag.end
  const m = re.exec(text)
  if (!m) return null
  return { ...tag, inner: text.slice(tag.end, m.index), close: m.index + m[0].length, full: text.slice(tag.start, m.index + m[0].length) }
}

// Does this inner markup give a screen reader a name? 'named' | 'none' | 'unknown' (an expression or a component might supply one).
function nameOf(inner) {
  if (/\{/.test(inner) || /<[A-Z]/.test(inner)) return 'unknown'
  if (inner.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') !== '') return 'named'
  for (const m of inner.matchAll(/<img\b[^>]*>/gi)) if (nonEmptyAttr(m[0], 'alt')) return 'named'
  if (/<svg\b[\s\S]*?<title\b[^>]*>[^<]*\S[^<]*<\/title>/i.test(inner)) return 'named'
  for (const m of inner.matchAll(/<[a-z][^>]*>/gi)) if (nonEmptyAttr(m[0], 'aria-label') || nonEmptyAttr(m[0], 'title') || hasAttr(m[0], 'aria-labelledby')) return 'named'
  return 'none'
}
const namedByAttr = (attrs) => nonEmptyAttr(attrs, 'aria-label') || hasAttr(attrs, 'aria-labelledby') || nonEmptyAttr(attrs, 'title')
const shorten = (s, n = 90) => s.replace(/\s+/g, ' ').trim().slice(0, n)
// Insert an attribute right after the tag name of an opening tag.
const insertAttr = (src, attr) => src.replace(/^(<[A-Za-z][\w.:-]*)/, `$1 ${attr}`)

// A hit: { index, message, evidence, fix, fixed (replacement for `source`), source (the text it replaces), context? (code the re-check needs in front) }.
const hit = (text, source, index, message, fix, fixed, context = '') => ({ index, line: lineOf(text, index), message, evidence: shorten(source), fix, source, fixed, context })

const RULES = {
  'a11y-img-alt': {
    title: 'Every image-like element has alt text (img, area, input type=image, role="img")',
    scan(file, raw) {
      const text = clean(raw)
      const out = []
      const need = (t, what) => out.push(hit(text, text.slice(t.start, t.end), t.start, `${what} has no alt text`, `Add alt="..." describing what it shows or does. Use alt="" only if it is purely decorative. Replace the TODO text before shipping.`, insertAttr(text.slice(t.start, t.end), 'alt="TODO describe this image"')))
      for (const t of tagsNamed(text, ['img'])) if (!hasAttr(t.attrs, 'alt') && !spread(t.attrs)) need(t, '<img>')
      for (const t of tagsNamed(text, ['area'])) if (hasAttr(t.attrs, 'href') && !hasAttr(t.attrs, 'alt') && !spread(t.attrs)) need(t, '<area>')
      for (const t of tagsNamed(text, ['input'])) if (/\btype\s*=\s*["']?image/i.test(t.attrs) && !hasAttr(t.attrs, 'alt') && !spread(t.attrs)) need(t, '<input type="image">')
      for (const t of tagsNamed(text, ['[a-z][\\w-]*'])) {
        if (!/\brole\s*=\s*["']img["']/i.test(t.attrs) || namedByAttr(t.attrs) || spread(t.attrs)) continue
        const w = withContent(text, t)
        if (w && nameOf(w.inner) !== 'none') continue
        out.push(hit(text, text.slice(t.start, t.end), t.start, `<${t.name} role="img"> has no accessible name`, 'Add aria-label="..." describing the picture (or aria-hidden="true" if it is decoration). Replace the TODO text.', insertAttr(text.slice(t.start, t.end), 'aria-label="TODO describe this image"')))
      }
      return out
    },
  },

  'a11y-form-label': {
    title: 'Every form control has a label (wrapping <label>, <label for>, aria-label or aria-labelledby)',
    scan(file, raw) {
      const text = clean(raw)
      const labels = tagsNamed(text, ['label']).map((t) => withContent(text, t)).filter(Boolean)
      const forIds = new Set(labels.map((l) => attrValue(l.attrs, 'for') ?? attrValue(l.attrs, 'htmlFor')).filter(Boolean))
      const out = []
      for (const t of tagsNamed(text, ['input', 'select', 'textarea'])) {
        if (t.lower === 'input' && /\btype\s*=\s*["']?(hidden|submit|button|reset|image)/i.test(t.attrs)) continue
        if (namedByAttr(t.attrs) || spread(t.attrs)) continue
        if (labels.some((l) => t.start > l.start && t.end <= l.close)) continue
        const id = attrValue(t.attrs, 'id')
        if (id !== null && (/^\{/.test(id) || forIds.has(id))) continue
        const src = text.slice(t.start, t.end)
        out.push(hit(text, src, t.start, `<${t.name}> has no label`, 'Wrap it in a visible <label> (or add <label for="its-id">). Where no visible text fits, add aria-label="...". Replace the TODO text.', `<label>TODO field name ${src}</label>`))
      }
      return out
    },
  },

  'a11y-button-name': {
    title: 'Every button has an accessible name (text, aria-label, or an image/svg with a description)',
    scan(file, raw) {
      const text = clean(raw)
      const out = []
      for (const t of tagsNamed(text, ['button', 'div', 'span', 'a'])) {
        const isButton = t.lower === 'button' || /\brole\s*=\s*["']button["']/i.test(t.attrs)
        if (!isButton || namedByAttr(t.attrs) || spread(t.attrs)) continue
        const w = withContent(text, t)
        if (!w || nameOf(w.inner) !== 'none') continue
        out.push(hit(text, w.full, t.start, `<${t.name}${t.lower === 'button' ? '' : ' role="button"'}> has no accessible name (icon-only or empty)`, 'Add aria-label="..." saying what the button does (for example "Close"), or put visible text in it. Replace the TODO text.', insertAttr(w.full, 'aria-label="TODO what this button does"')))
      }
      return out
    },
  },

  'a11y-link-name': {
    title: 'Links that hold only an image or icon have an accessible name',
    scan(file, raw) {
      const text = clean(raw)
      const out = []
      for (const t of tagsNamed(text, ['a'])) {
        if (!hasAttr(t.attrs, 'href') || namedByAttr(t.attrs) || spread(t.attrs)) continue
        const w = withContent(text, t)
        // A link with no content at all is link-text's job; this is the image/icon-only case it skips.
        if (!w || !/<(img|svg)\b/i.test(w.inner) || nameOf(w.inner) !== 'none') continue
        out.push(hit(text, w.full, t.start, '<a> holds only an image or icon with no accessible name', 'Add aria-label="..." saying where the link goes (for example "Home"), or give the image a real alt. Replace the TODO text.', insertAttr(w.full, 'aria-label="TODO where this link goes"')))
      }
      return out
    },
  },

  'a11y-html-lang': {
    title: 'The <html> element has a valid lang (including in JSX, Vue and Svelte layouts)',
    scan(file, raw) {
      const text = clean(raw)
      const out = []
      for (const t of tagsNamed(text, ['html'])) {
        if (spread(t.attrs)) continue
        const src = text.slice(t.start, t.end)
        const v = attrValue(t.attrs, 'lang')
        const valid = (s) => /^\{/.test(s) || /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s.trim())
        if (v === null) {
          if (!COMPONENT_FILE.test(file)) continue // a plain .html page without lang is already ui-static's finding
          out.push(hit(text, src, t.start, '<html> has no lang attribute', 'Add lang="en" (or the real language code of the page).', insertAttr(src, 'lang="en"')))
        } else if (!valid(v)) {
          out.push(hit(text, src, t.start, `<html> has an ${v.trim() === '' ? 'empty' : 'invalid'} lang ("${v}")`, 'Set lang to a language code such as "en" or "fr-CA".', src.replace(/(\blang\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '$1"en"')))
        }
      }
      return out
    },
  },

  'a11y-heading-order': {
    title: 'Heading levels do not skip (h2 straight to h4) in JSX, Vue and Svelte files',
    scan(file, raw) {
      if (!COMPONENT_FILE.test(file)) return [] // .html pages are html-structure's job
      const text = clean(raw)
      const heads = tagsNamed(text, ['h[1-6]']).map((t) => withContent(text, t)).filter(Boolean).sort((a, b) => a.start - b.start)
      const out = []
      for (let i = 1; i < heads.length; i++) {
        const prev = Number(heads[i - 1].lower[1])
        const cur = Number(heads[i].lower[1])
        if (cur <= prev + 1) continue
        const to = `h${prev + 1}`
        const fixed = heads[i].full.replace(/^<h[1-6]/i, `<${to}`).replace(/<\/h[1-6]\s*>$/i, `</${to}>`)
        out.push(hit(text, heads[i].full, heads[i].start, `heading jumps from <h${prev}> to <h${cur}>`, `Use <${to}> here (style it with CSS if it should look smaller), so the outline has no gap.`, fixed, heads[i - 1].full))
      }
      return out
    },
  },
}

export const RULE_IDS = Object.keys(RULES)

// Re-run the rule that raised a finding on the suggested fix. PASS = the fixed snippet no longer triggers that rule.
export function recheck(f) {
  const rule = RULES[f.rule]
  if (!rule) return 'FAIL'
  const probe = (f.context ? `${f.context}\n` : '') + f.fixedSnippet
  return rule.scan(f.file, probe).length === 0 ? 'PASS' : 'FAIL'
}

// files: { 'path': 'text' }. Returns findings with rule id, file, line, evidence, suggested fix text, the fixed snippet and its re-check result.
export function analyze(files, rules = RULE_IDS, allow = new Set()) {
  const out = []
  for (const id of rules) {
    for (const [file, text] of Object.entries(files)) {
      if (!MARKUP.test(file)) continue
      for (const h of RULES[id].scan(file, text)) {
        if (allow.has(`${id} ${file}`) || allow.has(`${id} ${file}:${h.line}`)) continue
        const f = { rule: id, file, line: h.line, message: h.message, evidence: h.evidence, fix: h.fix, fixedSnippet: h.fixed, context: h.context }
        out.push({ ...f, recheck: recheck(f) })
      }
    }
  }
  return out
}

const formatFinding = (f) => `${f.file}:${f.line} [${f.rule}] ${f.message}. Evidence: ${f.evidence} | Fix: ${f.fix} Suggested: ${shorten(f.fixedSnippet, 120)} | Re-check of the fix: ${f.recheck}`

const shippedMarkup = (root) => trackedFiles(root).filter((x) => MARKUP.test(x) && !SKIP_DIR.test(x) && !isFixture(x) && !isTestFile(x) && !/(^|\/)(mockups?|prototypes?|wireframes?)\//i.test(x))

export function runRule(id, root) {
  const allow = new Set(readText(root, '.meerkat-a11y-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  const files = Object.fromEntries(shippedMarkup(root).map((x) => [x, readText(root, x)]))
  const found = analyze(files, [id], allow)
  return finish(id, found.map(formatFinding), 'nothing to fix', { structured: true })
}

// One small broken file per rule (the self-test runs the rule on it and it must fail).
export const FIXTURES = {
  'a11y-img-alt': { 'index.html': '<area shape="rect" coords="0,0,9,9" href="/a">\n' },
  'a11y-form-label': { 'form.html': '<form><input type="text" name="email"></form>\n' },
  'a11y-button-name': { 'bar.html': '<button class="x"><svg viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg></button>\n' },
  'a11y-link-name': { 'nav.html': '<a href="/"><img src="logo.png" alt=""></a>\n' },
  'a11y-html-lang': { 'layout.tsx': 'export default function L({ children }) {\n  return <html><body>{children}</body></html>\n}\n' },
  'a11y-heading-order': { 'Page.svelte': '<h2>Title</h2>\n<h4>Skipped</h4>\n' },
}

// The same entries in the shape a pack uses, so wiring is one line in a pack file (see packs/a11y/a11y.mjs).
export const packChecks = RULE_IDS.map((id) => ({
  id,
  group: 'ui',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title: RULES[id].title,
  estSeconds: 1,
  needs: ['node'],
  paths: ['**/*.html', '**/*.htm', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte'],
  run: { cmd: 'node', args: [`${MK}/lib/a11y.mjs`, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [`${MK}/lib/a11y.mjs`, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
}))

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(Object.fromEntries(RULE_IDS.map((id) => [id, { run: (root) => runRule(id, root), fixture: () => withFixture(FIXTURES[id], (dir) => runRule(id, dir)) }])))
}
