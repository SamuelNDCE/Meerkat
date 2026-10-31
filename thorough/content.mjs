// Content checks: documents, data files, localisation and project metadata. Every check reads tracked files only.
// Run through the content pack, or by hand:
//   node thorough/content.mjs <check> [--root <dir>]      node thorough/content.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "content" (maxDataKb, default 512).
// A finding you accept goes in .meerkat-content-allow, one "<check-id> <path>" per line.
import { statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.content ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?|coverage|generated|__generated__|\.next)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(lock|snap)$/i
const MD = /\.(md|mdx)$/i
const JSON_FILE = /\.json$/i
const DATA = /\.(json|csv|sql)$/i
const TEXT = /\.(m?[jt]sx?|cjs|json|md|mdx|html?|css|scss|rs|toml|ya?ml|py|go|sh|bash|ps1|txt|svelte|vue|java|cs|rb|php|kt|swift|dart|cfg|ini|xml|csv|sql|c|h|cc|cpp|hpp)$|(^|\/)(Makefile|makefile)$/i
const ASSET = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|woff2?|ttf|otf|eot)$/i
const ASSET_DIRS = /(^|\/)(public|assets|static)\//i
const LOCALE_DIR = /(^|\/)(locales?|i18n|lang|langs|languages|translations?|messages|intl|strings)\//i
const LOCALE_NAME = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*\.json$/i
const MAX_TEXT_BYTES = 2 * 2 ** 20
const COMMENT = /^\s*(\/\/|\/\*|\*|#|<!--|--)/
const PLACEHOLDER = /\{\{\s*\w+\s*\}\}|\{\w+\}|%\(\w+\)s|%(?:\d+\$)?[sdif]/g
// U+FEFF (byte-order mark) is left out on purpose: it is used to strip or add BOMs in code, and the Trojan Source class is bidi overrides and zero-width joiners or spaces.
const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060]/g
const BIDI = /[\u202A-\u202E\u2066-\u2069]/
// A short list of very common misspellings, each with its correction. Matched as whole words in Markdown and comment lines only.
const TYPOS = [
  ['teh', 'the'], ['hte', 'the'], ['taht', 'that'], ['waht', 'what'], ['wiht', 'with'], ['recieve', 'receive'], ['recieved', 'received'],
  ['seperate', 'separate'], ['seperation', 'separation'], ['occured', 'occurred'], ['occurance', 'occurrence'], ['definately', 'definitely'],
  ['wich', 'which'], ['adress', 'address'], ['accomodate', 'accommodate'], ['acheive', 'achieve'], ['begining', 'beginning'],
  ['begginning', 'beginning'], ['beleive', 'believe'], ['buisness', 'business'], ['calender', 'calendar'], ['collegue', 'colleague'],
  ['commitee', 'committee'], ['concious', 'conscious'], ['consistant', 'consistent'], ['dependant', 'dependent'], ['dissapoint', 'disappoint'],
  ['embarass', 'embarrass'], ['enviroment', 'environment'], ['existance', 'existence'], ['experiance', 'experience'], ['familar', 'familiar'],
  ['foriegn', 'foreign'], ['freind', 'friend'], ['goverment', 'government'], ['grammer', 'grammar'], ['harrass', 'harass'],
  ['immediatly', 'immediately'], ['incidently', 'incidentally'], ['independant', 'independent'], ['inteligence', 'intelligence'],
  ['knowlege', 'knowledge'], ['lenght', 'length'], ['lisense', 'license'], ['maintainance', 'maintenance'], ['managment', 'management'],
  ['neccessary', 'necessary'], ['noticable', 'noticeable'], ['occassion', 'occasion'], ['orignal', 'original'], ['pasword', 'password'],
  ['persistant', 'persistent'], ['posession', 'possession'], ['prefered', 'preferred'], ['priviledge', 'privilege'],
  ['proffesional', 'professional'], ['pronounciation', 'pronunciation'], ['publically', 'publicly'], ['realy', 'really'],
  ['reccomend', 'recommend'], ['refered', 'referred'], ['relevent', 'relevant'], ['sentance', 'sentence'], ['sucess', 'success'],
  ['succesful', 'successful'], ['supercede', 'supersede'], ['tommorow', 'tomorrow'], ['truely', 'truly'], ['untill', 'until'],
  ['wierd', 'weird'], ['writting', 'writing'], ['becuase', 'because'], ['thier', 'their'], ['arguement', 'argument'], ['alot', 'a lot'],
]
const TYPO_FIX = new Map(TYPOS)
const TYPO_RE = new RegExp(`\\b(${TYPOS.map(([w]) => w).join('|')})\\b`, 'gi')

const allowSet = (root) => new Set(readText(root, '.meerkat-content-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, id, file) => allow.has(`${id} ${file}`)
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x))
const sizeOf = (root, x) => {
  try {
    return statSync(join(root, x)).size
  } catch {
    return Infinity
  }
}
const small = (root, x) => sizeOf(root, x) <= MAX_TEXT_BYTES
const rootHas = (root, name) => trackedFiles(root).includes(name)

// Each line of a Markdown file, with YAML front matter skipped and fenced code marked, so a # inside a code block is not read as a heading.
function markdownLines(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) i = end + 1
  }
  const out = []
  let fence = null
  for (; i < lines.length; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null
      out.push({ text: lines[i], n: i + 1, code: true })
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      fence = { ch: m[1][0], len: m[1].length, lang: m[2].trim(), n: i + 1 }
      out.push({ text: lines[i], n: i + 1, code: true, open: fence })
    } else out.push({ text: lines[i], n: i + 1, code: false })
  }
  return { lines: out, unclosed: fence }
}

function headingsOf(text) {
  const out = []
  for (const l of markdownLines(text).lines) {
    if (l.code) continue
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(l.text)
    if (m) out.push({ level: m[1].length, title: m[2].replace(/\s+#+$/, ''), n: l.n })
  }
  return out
}

// GitHub-style anchor for a heading: lower case, punctuation removed, spaces become hyphens. Repeats get -1, -2 and so on.
const slugOf = (title) => title.replace(/<[^>]+>|`/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
function anchorsOf(text) {
  const set = new Set()
  const seen = new Map()
  for (const h of headingsOf(text)) {
    const base = slugOf(h.title)
    const k = seen.get(base) ?? 0
    seen.set(base, k + 1)
    set.add(k ? `${base}-${k}` : base)
  }
  for (const m of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) set.add(m[1])
  return set
}

// ---- markdown-headings: a heading level never jumps by more than one, one H1 per file, no trailing punctuation
const markdownHeadings = (root) => {
  const id = 'markdown-headings'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, MD)) {
    if (allowed(allow, id, x)) continue
    let prev = 0
    let h1 = 0
    for (const h of headingsOf(readText(root, x))) {
      if (h.level === 1 && ++h1 === 2) f.push(`${x}:${h.n} is a second top-level heading (H1), and a page should have one`)
      if (prev && h.level > prev + 1) f.push(`${x}:${h.n} jumps from heading level ${prev} to ${h.level}, skipping a level`)
      if (/[.:;,]$/.test(h.title)) f.push(`${x}:${h.n} heading ends with punctuation: "${h.title}"`)
      prev = h.level
    }
  }
  return finish(id, f, 'headings nest one level at a time, with one H1 and no trailing punctuation')
}

// ---- markdown-code-fences: every fence is closed, and fences name their language when the repo mostly does
const markdownCodeFences = (root) => {
  const id = 'markdown-code-fences'
  const allow = allowSet(root)
  const f = []
  const opens = []
  for (const x of files(root, MD)) {
    if (allowed(allow, id, x)) continue
    const { lines, unclosed } = markdownLines(readText(root, x))
    if (unclosed) f.push(`${x}:${unclosed.n} code fence is never closed, so the rest of the file renders as code`)
    for (const l of lines) if (l.open) opens.push({ x, n: l.open.n, lang: l.open.lang })
  }
  const withLang = opens.filter((o) => o.lang).length
  if (opens.length >= 3 && withLang >= opens.length / 2) {
    for (const o of opens.filter((o) => !o.lang)) f.push(`${o.x}:${o.n} code fence names no language (most fences in this repo do, so add one after the backticks)`)
  }
  return finish(id, f, 'every code fence is closed and names its language')
}

// ---- markdown-anchors: a same-page link to #something must match a heading or an id in that file
const markdownAnchors = (root) => {
  const id = 'markdown-anchors'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, MD)) {
    if (allowed(allow, id, x)) continue
    const text = readText(root, x)
    const anchors = anchorsOf(text)
    for (const l of markdownLines(text).lines) {
      if (l.code) continue
      for (const m of l.text.matchAll(/\]\(#([^)\s]+)\)|href\s*=\s*["']#([^"']+)["']/g)) {
        let target = m[1] ?? m[2]
        try {
          target = decodeURIComponent(target)
        } catch {
          /* keep the raw text */
        }
        if (!anchors.has(target)) f.push(`${x}:${l.n} links to #${target}, which matches no heading or anchor in this file`)
      }
    }
  }
  return finish(id, f, 'every same-page #anchor link matches a heading')
}

// ---- changelog-version-headings: CHANGELOG.md has an Unreleased or version heading, Unreleased first, versions newest first
const changelogVersionHeadings = (root) => {
  const id = 'changelog-version-headings'
  const name = 'CHANGELOG.md'
  if (!rootHas(root, name)) return finish(id, [], `skipped: there is no ${name}`)
  const keys = []
  for (const h of headingsOf(readText(root, name))) {
    if (/unreleased/i.test(h.title)) {
      keys.push({ n: h.n, kind: 'unreleased' })
      continue
    }
    const d = /(\d{4})-(\d{2})-(\d{2})/.exec(h.title)
    if (d) {
      keys.push({ n: h.n, kind: 'date', v: Number(d[1]) * 10000 + Number(d[2]) * 100 + Number(d[3]) })
      continue
    }
    const v = /(?:^|[\s[v])(\d+)\.(\d+)(?:\.(\d+))?/.exec(h.title)
    if (v) keys.push({ n: h.n, kind: 'version', v: Number(v[1]) * 1e6 + Number(v[2]) * 1e3 + Number(v[3] ?? 0) })
  }
  const f = []
  if (!keys.length) f.push(`${name} has no Unreleased or version heading (for example "## [1.2.0] - 2026-01-31")`)
  keys.forEach((k, i) => {
    if (k.kind === 'unreleased' && i > 0) f.push(`${name}:${k.n} the Unreleased section is not at the top`)
  })
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (a.kind !== 'unreleased' && a.kind === b.kind && b.v > a.v) f.push(`${name}:${b.n} is newer than the entry above it (entries should run newest first)`)
  }
  return finish(id, f, `${name} has version headings, newest first`)
}

// ---- changelog-vs-version: the version in package.json is written down in CHANGELOG.md
const changelogVsVersion = (root) => {
  const id = 'changelog-vs-version'
  const allow = allowSet(root)
  if (!rootHas(root, 'package.json') || !rootHas(root, 'CHANGELOG.md')) return finish(id, [], 'skipped: needs both package.json and CHANGELOG.md')
  if (allowed(allow, id, 'package.json')) return finish(id, [], 'allowed by .meerkat-content-allow')
  let version
  try {
    version = JSON.parse(readText(root, 'package.json').replace(/^\uFEFF/, '')).version
  } catch {
    return finish(id, [], 'skipped: package.json does not parse (json-valid reports that)')
  }
  if (typeof version !== 'string' || !version || version === '0.0.0') return finish(id, [], 'skipped: package.json has no real version')
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\w.])v?${escaped}(?![\\w]|\\.\\d)`)
  if (!re.test(readText(root, 'CHANGELOG.md'))) return finish(id, [`package.json version ${version} does not appear in CHANGELOG.md`])
  return finish(id, [], `CHANGELOG.md mentions the package.json version ${version}`)
}

// ---- readme-install-usage: README is over 200 characters and has an install section and a usage section (the title does not count)
const INSTALL = /\b(install|installation|setup|set up|getting started|quick ?start|build)\b/i
const USAGE = /\b(usage|use|using|how to use|how it works|running|run|examples?|quick ?start|getting started|commands?|command line|cli|keyboard shortcuts|tour|walkthrough|guide|tutorial)\b/i
const readmeInstallUsage = (root) => {
  const id = 'readme-install-usage'
  const name = 'README.md'
  const allow = allowSet(root)
  if (!rootHas(root, name)) return finish(id, [], `skipped: there is no ${name}`)
  if (allowed(allow, id, name)) return finish(id, [], 'allowed by .meerkat-content-allow')
  const text = readText(root, name)
  const f = []
  if (text.trim().length <= 200) f.push(`${name} is only ${text.trim().length} characters (more than 200 is expected)`)
  const sections = headingsOf(text).filter((h) => h.level >= 2).map((h) => h.title)
  if (!sections.some((t) => INSTALL.test(t))) f.push(`${name} has no install or setup section (a heading such as "Install" or "Getting started")`)
  if (!sections.some((t) => USAGE.test(t))) f.push(`${name} has no usage section (a heading such as "Usage" or "Examples")`)
  return finish(id, f, `${name} has install and usage sections`)
}

// ---- i18n: locale files are the .json files named by language code inside a locales, i18n, lang or similar folder
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}
function localeGroups(root) {
  const byDir = new Map()
  for (const x of files(root, JSON_FILE)) {
    if (!LOCALE_DIR.test(x) || !LOCALE_NAME.test(posix.basename(x)) || !small(root, x)) continue
    let data
    try {
      data = JSON.parse(readText(root, x).replace(/^\uFEFF/, ''))
    } catch {
      continue
    }
    const dir = posix.dirname(x)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push({ file: x, bytes: sizeOf(root, x), keys: flatten(data) })
  }
  return [...byDir.values()].filter((g) => g.length > 1)
}
// The largest file is the reference the others are compared with.
const referenceOf = (group) => group.reduce((a, b) => (b.bytes > a.bytes ? b : a))

// ---- i18n-keys-match: every locale file has the same keys as the largest one
const i18nKeysMatch = (root) => {
  const id = 'i18n-keys-match'
  const allow = allowSet(root)
  const f = []
  for (const group of localeGroups(root)) {
    const ref = referenceOf(group)
    for (const loc of group) {
      if (loc === ref || allowed(allow, id, loc.file)) continue
      const missing = [...ref.keys.keys()].filter((k) => !loc.keys.has(k))
      const extra = [...loc.keys.keys()].filter((k) => !ref.keys.has(k))
      if (missing.length) f.push(`${loc.file} is missing ${missing.length} key(s) that ${ref.file} has, for example ${missing.slice(0, 3).join(', ')}`)
      if (extra.length) f.push(`${loc.file} has ${extra.length} key(s) that ${ref.file} does not, for example ${extra.slice(0, 3).join(', ')}`)
    }
  }
  return finish(id, f, 'every locale file has the same keys as the largest one')
}

// ---- i18n-placeholders: a translation uses the same {name} or %s placeholders as the reference for that key
const placeholdersOf = (v) => (typeof v === 'string' ? [...v.matchAll(PLACEHOLDER)].map((m) => m[0].replace(/\s/g, '')).sort().join(' ') : '')
const i18nPlaceholders = (root) => {
  const id = 'i18n-placeholders'
  const allow = allowSet(root)
  const f = []
  for (const group of localeGroups(root)) {
    const ref = referenceOf(group)
    for (const loc of group) {
      if (loc === ref || allowed(allow, id, loc.file)) continue
      for (const [key, value] of loc.keys) {
        if (!ref.keys.has(key)) continue
        const want = placeholdersOf(ref.keys.get(key))
        const have = placeholdersOf(value)
        if (want !== have) f.push(`${loc.file} "${key}" has placeholders [${have || 'none'}] but ${ref.file} has [${want || 'none'}]`)
      }
    }
  }
  return finish(id, f, 'every translation uses the same placeholders as the reference')
}

// ---- json-duplicate-keys: a key repeated inside one object (JSON.parse keeps only the last value, silently)
// Only called on text that JSON.parse has already accepted.
function repeatedKeys(text) {
  const found = []
  const stack = []
  let line = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') line++
    else if (c === '{') stack.push({ keys: new Set() })
    else if (c === '[') stack.push(null)
    else if (c === '}' || c === ']') stack.pop()
    else if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      let k = j + 1
      while (k < text.length && /\s/.test(text[k])) k++
      const top = stack[stack.length - 1]
      if (top && text[k] === ':') {
        const key = JSON.parse(text.slice(i, j + 1))
        if (top.keys.has(key)) found.push({ key, line })
        else top.keys.add(key)
      }
      i = j
    }
  }
  return found
}
const jsonDuplicateKeys = (root) => {
  const id = 'json-duplicate-keys'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, JSON_FILE)) {
    if (allowed(allow, id, x) || !small(root, x)) continue
    const text = readText(root, x).replace(/^\uFEFF/, '')
    try {
      JSON.parse(text)
    } catch {
      continue
    }
    for (const d of repeatedKeys(text)) f.push(`${x}:${d.line} repeats the key "${d.key}" in one object (only the last value is kept)`)
  }
  return finish(id, f, 'no JSON object repeats a key')
}

// ---- csv-consistent: every row of a CSV has as many columns as its header
// Rows of a CSV as arrays of fields, each with the line it starts on. Handles quoted fields with commas, quotes and line breaks.
function csvRows(text) {
  const t = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else {
        if (c === '\n') line++
        field += c
      }
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push({ row, line: rowLine })
      row = []
      field = ''
      line++
      rowLine = line
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push({ row, line: rowLine })
  }
  return rows.filter((r) => !(r.row.length === 1 && r.row[0] === ''))
}
const csvConsistent = (root) => {
  const id = 'csv-consistent'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, /\.csv$/i)) {
    if (allowed(allow, id, x) || !small(root, x)) continue
    const rows = csvRows(readText(root, x))
    if (rows.length < 2) continue
    const width = rows[0].row.length
    for (const r of rows.slice(1)) {
      if (r.row.length !== width) f.push(`${x}:${r.line} has ${r.row.length} column(s), but the header has ${width}`)
    }
  }
  return finish(id, f, 'every CSV row has as many columns as its header')
}

// ---- dead-assets: an image or font under public, assets or static that no tracked text file mentions by name
const deadAssets = (root) => {
  const id = 'dead-assets'
  const allow = allowSet(root)
  const assets = files(root, ASSET).filter((x) => ASSET_DIRS.test(x) && !/(^|\/)(favicon|apple-touch-icon)[^/]*$/i.test(x) && !allowed(allow, id, x))
  if (!assets.length) return finish(id, [], 'no image or font files under public, assets or static')
  const text = files(root, TEXT).filter((x) => small(root, x)).map((x) => readText(root, x)).join('\n')
  const f = assets
    .filter((x) => !text.includes(posix.basename(x)))
    .map((x) => `${x} is never mentioned by name in a tracked text file (unused, or loaded dynamically: allow it in .meerkat-content-allow)`)
  return finish(id, f, 'every image and font under public, assets or static is mentioned somewhere')
}

// ---- large-json-or-data: a tracked .json, .csv or .sql over the size budget (lock files are excluded)
const largeJsonOrData = (root) => {
  const id = 'large-json-or-data'
  const max = cfg(root).maxDataKb ?? 512
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, DATA)) {
    if (allowed(allow, id, x)) continue
    const kb = sizeOf(root, x) / 1024
    if (kb > max) f.push(`${x} is ${Math.round(kb)} KB (budget ${max} KB: set content.maxDataKb in .meerkat-budgets.json, or allow the file)`)
  }
  return finish(id, f, `no data file is over ${max} KB`)
}

// ---- spell-common-typos: a short built-in list of very common misspellings, in Markdown and comment lines only
const spellCommonTypos = (root) => {
  const id = 'spell-common-typos'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, TEXT)) {
    if (allowed(allow, id, x) || !small(root, x)) continue
    const md = MD.test(x)
    readText(root, x).split('\n').forEach((line, i) => {
      if (!md && !COMMENT.test(line)) return
      for (const m of line.matchAll(TYPO_RE)) f.push(`${x}:${i + 1} "${m[1]}" should be "${TYPO_FIX.get(m[1].toLowerCase())}"`)
    })
  }
  return finish(id, f, 'no common misspelling in the docs or comments')
}

// ---- unicode-control-chars: bidirectional overrides and invisible characters in tracked text (the Trojan Source class)
const unicodeControlChars = (root) => {
  const id = 'unicode-control-chars'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, TEXT)) {
    if (allowed(allow, id, x) || !small(root, x)) continue
    readText(root, x).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(INVISIBLE)) {
        const cp = m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
        const kind = BIDI.test(m[0]) ? 'a bidirectional control character' : 'an invisible zero-width character'
        f.push(`${x}:${i + 1} contains U+${cp}, ${kind} (the code can look different from what runs)`)
      }
    })
  }
  return finish(id, f, 'no bidirectional or invisible characters in tracked text')
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const CONTENT_FILES = {
  'markdown-headings': { run: markdownHeadings, ...fx({ 'README.md': '# Title\n\n### Deep heading\n\n# Second title.\n' }, markdownHeadings) },
  'markdown-code-fences': {
    run: markdownCodeFences,
    ...fx({ 'README.md': '```js\nconst a = 1\n```\n\n```bash\necho hi\n```\n\n```\nplain\n```\n\n```py\nprint(1)\n' }, markdownCodeFences),
  },
  'markdown-anchors': { run: markdownAnchors, ...fx({ 'README.md': '# Install\n\nSee [usage](#usage-guide) and [install](#install).\n' }, markdownAnchors) },
  'changelog-version-headings': {
    run: changelogVersionHeadings,
    ...fx({ 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n## 2.0.0\n\n## Unreleased\n' }, changelogVersionHeadings),
  },
  'changelog-vs-version': {
    run: changelogVsVersion,
    ...fx({ 'package.json': '{"name":"demo","version":"2.3.4"}\n', 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n' }, changelogVsVersion),
  },
  'readme-install-usage': { run: readmeInstallUsage, ...fx({ 'README.md': '# Demo\n\nA small tool.\n' }, readmeInstallUsage) },
  'i18n-keys-match': {
    run: i18nKeysMatch,
    ...fx({ 'locales/en.json': '{"hello":"Hello","bye":"Goodbye, and thanks for all the fish"}\n', 'locales/fr.json': '{"hello":"Bonjour"}\n' }, i18nKeysMatch),
  },
  'i18n-placeholders': {
    run: i18nPlaceholders,
    ...fx({ 'locales/en.json': '{"greet":"Hello {name}, welcome back"}\n', 'locales/fr.json': '{"greet":"Bonjour {nom}, bon retour"}\n' }, i18nPlaceholders),
  },
  'json-duplicate-keys': {
    run: jsonDuplicateKeys,
    ...fx({ 'config.json': '{\n  "name": "a",\n  "name": "b"\n}\n' }, jsonDuplicateKeys),
  },
  'csv-consistent': { run: csvConsistent, ...fx({ 'data.csv': 'name,count,unit\nwidgets,4,boxes\ngears,9\n' }, csvConsistent) },
  'dead-assets': { run: deadAssets, ...fx({ 'public/hero.png': 'not really a png', 'index.html': '<h1>Hello</h1>\n' }, deadAssets) },
  'large-json-or-data': {
    run: largeJsonOrData,
    ...fx({ '.meerkat-budgets.json': '{"content":{"maxDataKb":1}}\n', 'data.json': JSON.stringify(Array(600).fill('abcdefgh')) + '\n' }, largeJsonOrData),
  },
  'spell-common-typos': { run: spellCommonTypos, ...fx({ 'README.md': 'This is teh readme.\n' }, spellCommonTypos) },
  'unicode-control-chars': {
    run: unicodeControlChars,
    ...fx({ 'src/app.js': 'const admin = false // \u202E }\n' }, unicodeControlChars),
  },
}

main(CONTENT_FILES)
