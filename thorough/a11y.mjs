// Accessibility, markup and performance checks that read the files git tracks and need no tool installed. Run through the a11y pack, or by hand:
//   node thorough/a11y.mjs <check> [--root <dir>]      node thorough/a11y.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "a11y". An accepted finding goes in .meerkat-a11y-allow, one per line:
//   <check-id> <file>        or        <check-id> <file>:<line>
// Known limits: a tag is read up to its first ">", so an attribute holding ">" (for example an arrow function in JSX) can hide it;
// style blocks inside HTML files are not read by the CSS checks; "another site" means any absolute URL, since the project's own host is not known.
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.a11y ?? {}
const MARKUP = /\.(html?|jsx|tsx|vue|svelte)$/i
const STYLES = /\.(css|scss)$/i
const SKIP_DIR = /(^|\/)(node_modules|dist|build|vendor)\//
const filesMatching = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP_DIR.test(x) && !isFixture(x))
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, '')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

const ARIA_ATTRS = new Set(`aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-checked aria-colcount aria-colindex
  aria-colspan aria-controls aria-current aria-describedby aria-details aria-disabled aria-dropeffect aria-errormessage aria-expanded
  aria-flowto aria-grabbed aria-haspopup aria-hidden aria-invalid aria-keyshortcuts aria-label aria-labelledby aria-level aria-live
  aria-modal aria-multiline aria-multiselectable aria-orientation aria-owns aria-placeholder aria-posinset aria-pressed aria-readonly
  aria-relevant aria-required aria-roledescription aria-rowcount aria-rowindex aria-rowspan aria-selected aria-setsize aria-sort
  aria-valuemax aria-valuemin aria-valuenow aria-valuetext`.trim().split(/\s+/))

const ROLES = new Set(`alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox
  complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group
  heading img insertion link list listbox listitem log main marquee math meter menu menubar menuitem menuitemcheckbox menuitemradio
  navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search
  searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer
  toolbar tooltip tree treegrid treeitem`.trim().split(/\s+/))

// Collects one check's findings, dropping any the allow file accepts.
const collector = (root, id) => {
  const allow = new Set(readText(root, '.meerkat-a11y-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
  const out = []
  const add = (file, line, message) => {
    if (allow.has(`${id} ${file}`) || (line && allow.has(`${id} ${file}:${line}`))) return
    out.push(line ? `${file}:${line} ${message}` : `${file}: ${message}`)
  }
  return { out, add }
}

const check = (id, okNote, scan) => (root) => {
  const { out, add } = collector(root, id)
  scan(root, add)
  return finish(id, out, okNote)
}

// ---- aria-valid: attribute and role names that are not real, and a hidden element a keyboard can still reach
const ariaValid = check('aria-valid', 'every ARIA attribute and role is real, and nothing focusable is hidden from screen readers', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/\s(aria-[a-z-]+)\s*=/gi)) {
      if (!ARIA_ATTRS.has(m[1].toLowerCase())) add(x, lineOf(t, m.index), `${m[1]} is not a WAI-ARIA attribute (check the spelling)`)
    }
    for (const m of t.matchAll(/(?<![\w-])role\s*=\s*["']([^"']*)["']/gi)) {
      for (const role of m[1].trim().split(/\s+/).filter(Boolean)) {
        if (!ROLES.has(role)) add(x, lineOf(t, m.index), `role="${role}" is not a real ARIA role`)
      }
    }
    for (const m of t.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      if (!/aria-hidden\s*=\s*["']true["']/i.test(m[2])) continue
      const tag = m[1].toLowerCase()
      const focusable = (tag === 'a' && /\shref\s*=/i.test(m[2])) || (/^(button|input|select|textarea)$/.test(tag) && !/type\s*=\s*["']?hidden/i.test(m[2])) || /tabindex\s*=\s*["']?(?!-1)\d/i.test(m[2])
      if (focusable) add(x, lineOf(t, m.index), `<${tag}> has aria-hidden="true" but a keyboard can still reach it`)
    }
  }
})

// ---- link-text: links with no words, or words that do not say where they go
const linkText = check('link-text', 'every link has text a person can act on', (root, add) => {
  const VAGUE = new Set(['click here', 'here', 'read more', 'more', 'link'])
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      if (/aria-label(?:ledby)?\s*=/i.test(m[1])) continue
      if (/<(?:img|svg)\b|\{/i.test(m[2])) continue
      const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!:]+$/, '')
      if (!text) add(x, lineOf(t, m.index), 'link has no text (give it words or an aria-label)')
      else if (VAGUE.has(text)) add(x, lineOf(t, m.index), `link text "${text}" does not say where the link goes`)
    }
  }
})

// ---- focus-visible: a stylesheet removes the focus outline and puts nothing in its place
const focusVisible = check('focus-visible', 'no stylesheet removes the focus outline without a replacement', (root, add) => {
  for (const x of filesMatching(root, STYLES)) {
    const t = readText(root, x).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim()
      const body = m[2]
      if (!/(?:^|[;\s{])outline(?:-width)?\s*:\s*(?:none|0(?:px)?)(?![\w.-])/i.test(body)) continue
      if (!/:focus|(?:^|[\s,>+~])(?:a|button|input|select|textarea)(?![\w-])/i.test(selector)) continue
      if (/box-shadow\s*:|(?:^|[;\s])border(?:-[\w]+)?\s*:|background(?:-color)?\s*:/i.test(body)) continue
      add(x, lineOf(t, m.index + m[1].length - m[1].trimStart().length), `"${selector.slice(0, 60)}" removes the focus outline and sets nothing in its place (add a box-shadow, border or background)`)
    }
  }
})

// ---- zoom-allowed: a viewport setting that blocks pinch zoom
const zoomAllowed = check('zoom-allowed', 'the viewport allows pinch zoom', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<meta\b[^>]*>/gi)) {
      if (!/name\s*=\s*["']viewport["']/i.test(m[0])) continue
      const content = /content\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? ''
      const line = lineOf(t, m.index)
      if (/user-scalable\s*=\s*(?:no|0)(?![\w.])/i.test(content)) add(x, line, 'the viewport turns off pinch zoom (user-scalable=no)')
      const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(content)
      if (max && Number(max[1]) < 2) add(x, line, `the viewport caps zoom at ${max[1]}x (keep it at 2 or more)`)
    }
  }
})

// ---- reduced-motion: motion in the project CSS, with no prefers-reduced-motion query anywhere in it
const reducedMotion = check('reduced-motion', 'motion has a prefers-reduced-motion option in the project CSS', (root, add) => {
  const moving = []
  let optOut = false
  for (const x of filesMatching(root, STYLES)) {
    const t = readText(root, x)
    if (/prefers-reduced-motion/i.test(t)) optOut = true
    const m = /(?:^|[\s;{])(?:animation|transition)(?:-\w+)?\s*:\s*(?!none\b)|@keyframes\b/i.exec(t)
    if (m) moving.push([x, lineOf(t, m.index)])
  }
  if (!optOut) for (const [x, line] of moving) add(x, line, 'uses animation or transition, but the project CSS never checks prefers-reduced-motion')
})

// ---- iframe-title: an embedded frame with no name
const iframeTitle = check('iframe-title', 'every iframe has a title', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<iframe\b[^>]*>/gi)) {
      if (!/(?<![\w-])title\s*=/i.test(m[0])) add(x, lineOf(t, m.index), '<iframe> has no title (screen readers announce a frame by its title)')
    }
  }
})

// ---- table-headers: a data table with no header cells, or header cells that do not say what they head
const tableHeaders = check('table-headers', 'data tables have header cells, and each header says what it heads', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)) {
      if (/role\s*=\s*["'](?:presentation|none)["']/i.test(m[1])) continue
      const line = lineOf(t, m.index)
      const headers = [...m[2].matchAll(/<th\b([^>]*)>/gi)]
      if (!headers.length) {
        add(x, line, 'table has no header cells (<th>), so screen readers cannot tell what each column holds')
        continue
      }
      if (headers.length > 1 && headers.some((h) => !/(?<![\w-])scope\s*=/i.test(h[1]))) add(x, line, 'a <th> has no scope, so it is not tied to its row or column')
    }
  }
})

// ---- image-alt-quality: alt text that is a file name, a bare generic word, or too long
const imageAltQuality = check('image-alt-quality', 'image descriptions say what the picture shows', (root, add) => {
  const max = cfg(root).maxAltLength ?? 150
  const FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp|tiff?)$/i
  const GENERIC = new Set(['image', 'picture', 'photo', 'graphic', 'icon', 'logo'])
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<img\b[^>]*>/gi)) {
      const alt = /(?<![\w-])alt\s*=\s*["']([^"']*)["']/i.exec(m[0])
      if (!alt) continue
      const text = alt[1].trim()
      const line = lineOf(t, m.index)
      if (FILE.test(text)) add(x, line, `alt text "${text}" is a file name, not a description`)
      else if (GENERIC.has(text.toLowerCase().replace(/[.!]+$/, ''))) add(x, line, `alt text "${text}" says nothing on its own (describe what the picture shows)`)
      else if (text.length > max) add(x, line, `alt text is ${text.length} characters (limit ${max})`)
    }
  }
})

// ---- media-captions: video with no captions, and autoplaying sound with no way to stop it
const mediaCaptions = check('media-captions', 'videos have captions and autoplay only when silent or controllable', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video\s*>/gi)) {
      const decorative = /(?<![\w-])muted\b/i.test(m[1]) && /(?<![\w-])autoplay\b/i.test(m[1])
      const captioned = /<track\b[^>]*kind\s*=\s*["']?(?:captions|subtitles)/i.test(m[2])
      if (!decorative && !captioned) add(x, lineOf(t, m.index), '<video> has no captions track (add <track kind="captions">)')
    }
    for (const m of t.matchAll(/<(audio|video)\b([^>]*)>/gi)) {
      if (!/(?<![\w-])autoplay\b/i.test(m[2])) continue
      if (!/(?<![\w-])muted\b/i.test(m[2]) && !/(?<![\w-])controls\b/i.test(m[2])) add(x, lineOf(t, m.index), `<${m[1].toLowerCase()} autoplay> plays sound with no controls and is not muted`)
    }
  }
})

// ---- sri-missing: a script or stylesheet from another site with no integrity hash
const sriMissing = check('sri-missing', 'every script and stylesheet from another site has an integrity hash', (root, add) => {
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    for (const m of t.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const kind = m[1].toLowerCase()
      let ref = null
      if (kind === 'script') ref = /(?<![\w-])src\s*=\s*["']([^"']*)["']/i.exec(m[0])
      else if (/rel\s*=\s*["'][^"']*stylesheet/i.test(m[0])) ref = /(?<![\w-])href\s*=\s*["']([^"']*)["']/i.exec(m[0])
      if (!ref) continue
      const url = ref[1]
      if (/^(?:https?:)?\/\//i.test(url) && !/(?<![\w-])integrity\s*=/i.test(m[0])) {
        add(x, lineOf(t, m.index), `${kind} loads ${url.slice(0, 80)} from another site with no integrity hash (add integrity="sha384-...")`)
      }
    }
  }
})

// ---- mixed-content: a plain http:// resource on a page that is otherwise https
const mixedContent = check('mixed-content', 'no resource is loaded over plain http on an https page', (root, add) => {
  const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    const httpsPage = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']https:/i.test(t) || /og:url["'][^>]*content\s*=\s*["']https:/i.test(t) || /(?:src|href)\s*=\s*["']https:\/\//i.test(t)
    if (!httpsPage) continue
    for (const m of t.matchAll(/<(link|script|img)\b[^>]*>/gi)) {
      const ref = /(?<![\w-])(?:src|href)\s*=\s*["'](http:\/\/[^"']*)["']/i.exec(m[0])
      if (ref && !LOCAL.test(ref[1])) add(x, lineOf(t, m.index), `<${m[1].toLowerCase()}> loads ${ref[1].slice(0, 80)} over plain http on an https page (browsers block or warn)`)
    }
  }
  for (const x of filesMatching(root, STYLES)) {
    const t = readText(root, x)
    if (!/https:\/\//i.test(t)) continue
    for (const m of t.matchAll(/url\(\s*["']?(http:\/\/[^"')\s]+)/gi)) {
      if (!LOCAL.test(m[1])) add(x, lineOf(t, m.index), `url() loads ${m[1].slice(0, 80)} over plain http on an https page`)
    }
  }
})

// ---- render-blocking: scripts in the head that stop the page drawing, images with no size, and images that load late
const renderBlocking = check('render-blocking', 'head scripts do not block drawing, and images have a size and load lazily', (root, add) => {
  const afterImages = cfg(root).lazyAfterImages ?? 3
  for (const x of filesMatching(root, MARKUP)) {
    const t = stripComments(readText(root, x))
    const head = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i.exec(t)
    if (head) {
      for (const m of t.matchAll(/<script\b[^>]*>/gi)) {
        const inHead = m.index >= head.index && m.index < head.index + head[0].length
        if (!inHead || !/(?<![\w-])src\s*=/i.test(m[0])) continue
        if (/(?<![\w-])(?:defer|async)(?![\w-])|type\s*=\s*["']?module/i.test(m[0])) continue
        add(x, lineOf(t, m.index), '<script src> in the <head> stops the page drawing until it loads (add defer, async or type="module")')
      }
    }
    const imgs = [...t.matchAll(/<img\b[^>]*>/gi)]
    imgs.forEach((m, i) => {
      const line = lineOf(t, m.index)
      if (!(/(?<![\w-])width\s*=/i.test(m[0]) && /(?<![\w-])height\s*=/i.test(m[0]))) add(x, line, '<img> has no width and height, so the page jumps when it loads (layout shift)')
      if (i >= afterImages && !/loading\s*=\s*["']?lazy/i.test(m[0])) add(x, line, `<img> is image ${i + 1} on the page with no loading="lazy"`)
    })
  }
})

const fx = (files, run) => ({ fixture: () => withFixture(files, run) })

main({
  'aria-valid': { run: ariaValid, ...fx({ 'index.html': '<main><button aria-hidden="true">Close</button></main>\n' }, ariaValid) },
  'link-text': { run: linkText, ...fx({ 'index.html': '<p><a href="/docs"></a></p>\n' }, linkText) },
  'focus-visible': { run: focusVisible, ...fx({ 'style.css': 'button:focus { outline: none; }\n' }, focusVisible) },
  'zoom-allowed': { run: zoomAllowed, ...fx({ 'index.html': '<meta name="viewport" content="width=device-width, user-scalable=no">\n' }, zoomAllowed) },
  'reduced-motion': { run: reducedMotion, ...fx({ 'style.css': '.box { transition: color 0.3s; }\n' }, reducedMotion) },
  'iframe-title': { run: iframeTitle, ...fx({ 'index.html': '<iframe src="/map.html"></iframe>\n' }, iframeTitle) },
  'table-headers': { run: tableHeaders, ...fx({ 'index.html': '<table><tr><td>Name</td><td>Role</td></tr></table>\n' }, tableHeaders) },
  'image-alt-quality': { run: imageAltQuality, ...fx({ 'index.html': '<img src="cat.jpg" width="10" height="10" alt="cat.jpg">\n' }, imageAltQuality) },
  'media-captions': { run: mediaCaptions, ...fx({ 'index.html': '<video src="intro.mp4" controls></video>\n' }, mediaCaptions) },
  'sri-missing': { run: sriMissing, ...fx({ 'index.html': '<script src="https://cdn.example.com/lib.js"></script>\n' }, sriMissing) },
  'mixed-content': { run: mixedContent, ...fx({ 'index.html': '<link rel="canonical" href="https://example.com/"><img src="http://example.com/logo.png" width="10" height="10" alt="Example home">\n' }, mixedContent) },
  'render-blocking': { run: renderBlocking, ...fx({ 'index.html': '<html><head><script src="app.js"></script></head><body></body></html>\n' }, renderBlocking) },
})
