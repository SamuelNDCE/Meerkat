// Game engine and storefront checks: Unity, Godot, Unreal, Shopify themes, Liquid, WordPress and static site generators.
// Every check reads only the files git tracks, and says "not applicable" when the project is not of its kind. Run through the engines pack, or by hand:
//   node thorough/engines.mjs <check> [--root <dir>]      node thorough/engines.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "engines": maxAssetMb (default 50), hazardsFail (default false: the script-hazard checks only report).
// A finding you accept goes in .meerkat-engines-allow as "<check-id> <path>", one per line (# starts a comment).
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const tracked = (root) => trackedFiles(root).filter((x) => !SKIP.test(x) && !isFixture(x))
const allowSet = (root) => new Set(readText(root, '.meerkat-engines-allow').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, id, path) => allow.has(`${id} ${path}`)
const engineBudget = (root, key, dflt) => readBudgets(root)?.engines?.[key] ?? dflt
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const notApplicable = (id, kind) => {
  console.log(`${id}: not applicable: not a ${kind} project`)
  return 0
}

// The first bytes of a file, read without loading the whole thing (binary-safe, and cheap for a large asset).
const head = (root, f, n = 4096) => {
  let fd
  try {
    fd = openSync(join(root, f), 'r')
    const buf = Buffer.alloc(n)
    const got = readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, got)
  } catch {
    return Buffer.alloc(0)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
const headText = (root, f, n = 4096) => head(root, f, n).toString('utf8')
const isBinary = (root, f) => head(root, f, 8000).includes(0)
const megabytes = (root, f) => {
  try {
    return statSync(join(root, f)).size / 2 ** 20
  } catch {
    return 0
  }
}

// .gitignore lines in a comparable form: no leading or trailing slash, [Ll]ibrary read as library, lower case.
const ignoreLines = (root) =>
  readText(root, '.gitignore')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\[([A-Za-z])[A-Za-z]\]/g, '$1').toLowerCase())
const ignores = (root, name) => ignoreLines(root).includes(name.toLowerCase())

const globToRegex = (pat) => {
  let s = ''
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i]
    if (c === '*') {
      if (pat[i + 1] === '*') {
        i++
        if (pat[i + 1] === '/') i++
        s += '.*'
      } else s += '[^/]*'
    } else if (c === '?') s += '[^/]'
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${s}$`)
}
// Git LFS patterns from .gitattributes: a file that matches one is stored outside git, so its size does not count against git.
const lfsMatcher = (root) => {
  const pats = readText(root, '.gitattributes')
    .split('\n')
    .filter((l) => /filter=lfs/.test(l))
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map((p) => ({ re: globToRegex(p.replace(/^\//, '')), bare: !p.replace(/^\//, '').includes('/') }))
  return (f) => pats.some((p) => p.re.test(p.bare ? posix.basename(f) : f))
}

// Project detection: each check says "not applicable" unless the project is of its kind.
const isUnity = (T) => T.some((x) => x.startsWith('Assets/')) && T.some((x) => x.startsWith('ProjectSettings/'))
const isGodot = (T) => T.includes('project.godot') || T.some((x) => /\.gd$/i.test(x))
const isTheme = (T) => T.includes('layout/theme.liquid') && T.some((x) => x.startsWith('sections/'))
const isShopify = (T) => isTheme(T) || T.some((x) => /^shopify\.(app|theme)(\.[\w-]+)?\.toml$/.test(x))
const WP_MARK = /\b(Plugin|Theme) Name:/
const isWordPress = (root, T) =>
  T.some((w) => ['wp-config.php', 'wp-config-sample.php', 'wp-settings.php'].includes(w) || w.startsWith('wp-content/') || ((/\.php$/i.test(w) || /(^|\/)style\.css$/.test(w)) && WP_MARK.test(headText(root, w))))

// Findings that are reported but do not fail the run, unless the project sets engines.hazardsFail to true.
const informational = (root, id, f, okNote) => {
  if (engineBudget(root, 'hazardsFail', false) === true) return finish(id, f, okNote)
  if (!f.length) {
    console.log(`${id}: ${okNote}`)
    return 0
  }
  console.log(`${id}: found ${f.length} (informational, not failing; set engines.hazardsFail to true in .meerkat-budgets.json to fail on them)`)
  for (const line of f.slice(0, 20)) console.log(`  ${line}`)
  if (f.length > 20) console.log(`  ... and ${f.length - 20} more`)
  return 0
}

// ---- unity-meta-files: every asset has a .meta, every .meta has an asset, and no GUID is used twice
const unityMeta = (root) => {
  const id = 'unity-meta-files'
  const T = tracked(root)
  if (!isUnity(T)) return notApplicable(id, 'Unity')
  const allow = allowSet(root)
  const set = new Set(T)
  const dirs = new Set()
  for (const x of T) {
    const parts = x.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  const f = []
  const assets = T.filter((x) => x.startsWith('Assets/'))
  for (const x of assets) {
    if (x.endsWith('.meta')) {
      const asset = x.slice(0, -5)
      if (!set.has(asset) && !dirs.has(asset) && !allowed(allow, id, x)) f.push(`${x} has no matching asset ${asset}`)
    } else if (!/(^|\/)\.|~$/.test(x) && !set.has(`${x}.meta`) && !allowed(allow, id, x)) f.push(`${x} has no .meta file`)
  }
  const guids = new Map()
  for (const x of assets.filter((p) => p.endsWith('.meta'))) {
    const m = /^guid:\s*([0-9a-fA-F]{32})\s*$/m.exec(readText(root, x))
    if (!m) continue
    if (!guids.has(m[1])) guids.set(m[1], [])
    guids.get(m[1]).push(x)
  }
  for (const [g, list] of guids) if (list.length > 1) f.push(`GUID ${g.slice(0, 8)} is used by ${list.join(', ')}`)
  return finish(id, f, 'every asset has a .meta file, every .meta has an asset, and no GUID repeats')
}

// ---- unity-gitignore: the generated folders are ignored, and none of them is tracked
const UNITY_GENERATED = ['Library', 'Temp', 'Logs', 'obj', 'UserSettings']
const unityGitignore = (root) => {
  const id = 'unity-gitignore'
  const T = tracked(root)
  if (!isUnity(T)) return notApplicable(id, 'Unity')
  const allow = allowSet(root)
  const f = []
  if (!T.includes('.gitignore')) f.push('there is no .gitignore at the project root')
  else {
    for (const n of UNITY_GENERATED) if (!ignores(root, n) && !allowed(allow, id, n)) f.push(`.gitignore does not ignore ${n}/`)
  }
  const tops = new Set(T.map((x) => x.split('/')[0]).filter((t) => UNITY_GENERATED.includes(t) && !allowed(allow, id, t)))
  for (const t of tops) f.push(`${t}/ has tracked files, but it is generated output and must not be in git`)
  return finish(id, f, 'the generated Unity folders are ignored and none of them is tracked')
}

// ---- unity-serialization: Asset Serialization is Force Text, so scenes and assets are readable YAML
const UNITY_MODE = { 0: 'Mixed', 1: 'Force Binary', 2: 'Force Text' }
const unitySerialization = (root) => {
  const id = 'unity-serialization'
  const T = tracked(root)
  if (!isUnity(T)) return notApplicable(id, 'Unity')
  const allow = allowSet(root)
  const f = []
  const settings = 'ProjectSettings/EditorSettings.asset'
  if (T.includes(settings)) {
    const m = /^\s*serializationMode:\s*(\d+)/m.exec(readText(root, settings))
    if (m && m[1] !== '2' && !allowed(allow, id, settings)) f.push(`${settings} sets Asset Serialization to ${UNITY_MODE[m[1]] ?? m[1]}, not Force Text`)
  }
  for (const x of T.filter((p) => /^Assets\/.*\.(unity|prefab|asset|mat|anim|controller)$/i.test(p))) {
    const h = head(root, x, 16).toString('latin1')
    if (h && !h.startsWith('%YAML') && !allowed(allow, id, x)) f.push(`${x} is saved as binary, not as text (YAML)`)
  }
  return finish(id, f, 'the project saves its scenes and assets as text (Force Text)')
}

// ---- unity-large-assets: textures, audio and models over the size budget that are not in Git LFS
const UNITY_ASSET = /\.(png|jpe?g|tga|psd|tiff?|exr|hdr|wav|mp3|ogg|aiff?|flac|fbx|obj|blend|mov|mp4)$/i
const unityLarge = (root) => {
  const id = 'unity-large-assets'
  const T = tracked(root)
  if (!isUnity(T)) return notApplicable(id, 'Unity')
  const allow = allowSet(root)
  const limit = Number(engineBudget(root, 'maxAssetMb', 50))
  const lfs = lfsMatcher(root)
  const f = []
  for (const x of T.filter((p) => p.startsWith('Assets/') && UNITY_ASSET.test(p))) {
    const mb = megabytes(root, x)
    if (mb > limit && !lfs(x) && !allowed(allow, id, x)) f.push(`${x} is ${mb.toFixed(3)} MB (limit ${limit} MB) and is not in Git LFS`)
  }
  return finish(id, f, `no tracked texture, audio or model is over ${limit} MB outside Git LFS`)
}

// ---- unity-script-hazards: inside Update(), Find, GetComponent, Resources.Load and Debug.Log run every frame
const UNITY_HAZARDS = [
  [/\bGameObject\.Find\w*\s*\(|\bFindObjectOfType\s*[<(]|\bFindObjectsOfType\s*[<(]/, 'calls a Find method every frame'],
  [/\bGetComponent\s*[<(]/, 'calls GetComponent every frame'],
  [/\bResources\.Load\s*[<(]/, 'calls Resources.Load every frame'],
  [/\bDebug\.Log\w*\s*\(/, 'leaves a Debug.Log in Update'],
]
// The text between the brace at openIdx and its match (strings and comments are not parsed: a narrow check, not a compiler).
const bodyOf = (text, openIdx) => {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return [openIdx, i]
    }
  }
  return [openIdx, text.length]
}
const unityScripts = (root) => {
  const id = 'unity-script-hazards'
  const T = tracked(root)
  if (!isUnity(T)) return notApplicable(id, 'Unity')
  const allow = allowSet(root)
  const f = []
  for (const x of T.filter((p) => p.startsWith('Assets/') && /\.cs$/i.test(p))) {
    if (allowed(allow, id, x)) continue
    const t = readText(root, x)
    for (const m of t.matchAll(/\bvoid\s+Update\s*\(\s*\)\s*\{/g)) {
      const [s, e] = bodyOf(t, m.index + m[0].length - 1)
      const first = lineOf(t, s)
      t.slice(s, e).split('\n').forEach((line, i) => {
        const hit = UNITY_HAZARDS.find(([re]) => re.test(line))
        if (hit) f.push(`${x}:${first + i} ${hit[1]}`)
      })
    }
  }
  return informational(root, id, f, 'no Update method calls Find, GetComponent, Resources.Load or Debug.Log')
}

// ---- godot-project: project.godot with a config_version, .godot/ and *.import ignored, export presets without credentials
const godotProject = (root) => {
  const id = 'godot-project'
  const T = tracked(root)
  if (!isGodot(T)) return notApplicable(id, 'Godot')
  const allow = allowSet(root)
  const f = []
  if (!T.includes('project.godot')) f.push('there are GDScript files but no project.godot at the root')
  else if (!/^config_version\s*=\s*\d+/m.test(readText(root, 'project.godot')) && !allowed(allow, id, 'project.godot')) f.push('project.godot has no config_version line')
  if (!T.includes('.gitignore')) f.push('there is no .gitignore at the root')
  else {
    for (const n of ['.godot', '*.import']) if (!ignores(root, n) && !allowed(allow, id, n)) f.push(`.gitignore does not ignore ${n}`)
  }
  if (T.some((x) => x.startsWith('.godot/')) && !allowed(allow, id, '.godot')) f.push('.godot/ has tracked files, but it is the generated editor cache')
  if (T.includes('export_presets.cfg') && !allowed(allow, id, 'export_presets.cfg')) {
    readText(root, 'export_presets.cfg')
      .split('\n')
      .forEach((line, i) => {
        // Names only: the value is never printed.
        const m = /^\s*([\w/.-]*(?:password|secret|token|api_key|apikey)[\w/.-]*)\s*=\s*"([^"]+)"/i.exec(line)
        if (m) f.push(`export_presets.cfg:${i + 1} stores a value for ${m[1]} (signing credentials belong outside the project)`)
      })
  }
  return finish(id, f, 'project.godot is set up, build output is ignored, and export presets hold no credentials')
}

// ---- godot-script-hazards: print() and get_node() inside _process run every frame (GDScript scopes by indentation)
const godotScripts = (root) => {
  const id = 'godot-script-hazards'
  const T = tracked(root)
  if (!isGodot(T)) return notApplicable(id, 'Godot')
  const allow = allowSet(root)
  const f = []
  for (const x of T.filter((p) => /\.gd$/i.test(p))) {
    if (allowed(allow, id, x)) continue
    const lines = readText(root, x).split('\n')
    lines.forEach((line, i) => {
      if (!/^\s*func\s+_process\s*\(/.test(line)) return
      const base = /^\s*/.exec(line)[0].length
      for (let j = i + 1; j < lines.length; j++) {
        const body = lines[j]
        if (!body.trim()) continue
        if (/^\s*/.exec(body)[0].length <= base) break
        if (body.trim().startsWith('#')) continue
        if (/\bprint\s*\(/.test(body)) f.push(`${x}:${j + 1} leaves a print() in _process`)
        if (/\bget_node\s*\(/.test(body)) f.push(`${x}:${j + 1} calls get_node() every frame`)
      }
    })
  }
  return informational(root, id, f, 'no _process function calls print() or get_node()')
}

// ---- unreal-hygiene: .uproject readable, generated folders ignored and untracked, Content assets within budget, plugin versions declared
const UNREAL_GENERATED = ['Binaries', 'Intermediate', 'Saved', 'DerivedDataCache']
const unrealHygiene = (root) => {
  const id = 'unreal-hygiene'
  const T = tracked(root)
  const projects = T.filter((x) => x.endsWith('.uproject'))
  if (!projects.length) return notApplicable(id, 'Unreal')
  const allow = allowSet(root)
  const lfs = lfsMatcher(root)
  const limit = Number(engineBudget(root, 'maxAssetMb', 50))
  const f = []
  for (const p of projects) {
    try {
      const j = JSON.parse(readText(root, p))
      if (!j.EngineAssociation && !allowed(allow, id, p)) f.push(`${p} has no EngineAssociation`)
    } catch {
      f.push(`${p} is not valid JSON`)
    }
  }
  if (!T.includes('.gitignore')) f.push('there is no .gitignore at the root')
  else {
    for (const n of UNREAL_GENERATED) if (!ignores(root, n) && !allowed(allow, id, n)) f.push(`.gitignore does not ignore ${n}/`)
  }
  for (const n of UNREAL_GENERATED) if (T.some((x) => x.startsWith(`${n}/`)) && !allowed(allow, id, n)) f.push(`${n}/ has tracked files, but it is generated build output`)
  for (const x of T.filter((p) => /^Content\/.*\.uasset$/i.test(p))) {
    const mb = megabytes(root, x)
    if (mb > limit && !lfs(x) && !allowed(allow, id, x)) f.push(`${x} is ${mb.toFixed(3)} MB (limit ${limit} MB) and is not in Git LFS`)
  }
  for (const x of T.filter((p) => /^Plugins\/.*\.uplugin$/i.test(p))) {
    try {
      const j = JSON.parse(readText(root, x))
      if ((typeof j.VersionName !== 'string' || !Number.isInteger(j.Version)) && !allowed(allow, id, x)) f.push(`${x} does not declare VersionName (text) and Version (whole number)`)
    } catch {
      f.push(`${x} is not valid JSON`)
    }
  }
  return finish(id, f, 'the Unreal project keeps build output out of git, and its assets and plugins are in order')
}

// ---- shopify-theme-basics: settings schema valid, templates use existing sections, referenced assets exist, no store URL next to a token
const THEME_TEXT = /^(layout|templates|sections|snippets|assets|config|locales)\/.*\.(liquid|json|js|css|scss)$/
const shopifyTheme = (root) => {
  const id = 'shopify-theme-basics'
  const T = tracked(root)
  if (!isTheme(T)) return notApplicable(id, 'Shopify theme')
  const allow = allowSet(root)
  const set = new Set(T)
  const f = []
  const schema = 'config/settings_schema.json'
  if (!set.has(schema)) f.push(`there is no ${schema}`)
  else {
    try {
      if (!Array.isArray(JSON.parse(readText(root, schema)))) f.push(`${schema} must be a JSON array of settings groups`)
    } catch {
      f.push(`${schema} is not valid JSON`)
    }
  }
  for (const t of T.filter((x) => /^templates\/.*\.json$/.test(x))) {
    let j
    try {
      j = JSON.parse(readText(root, t))
    } catch {
      f.push(`${t} is not valid JSON`)
      continue
    }
    for (const [key, s] of Object.entries(j?.sections ?? {})) {
      const type = s?.type
      if (typeof type === 'string' && !set.has(`sections/${type}.liquid`) && !allowed(allow, id, t)) f.push(`${t} uses section "${type}" (key ${key}), but sections/${type}.liquid does not exist`)
    }
  }
  for (const x of T.filter((p) => /^(templates|layout|sections)\/.*\.liquid$/.test(p))) {
    for (const m of readText(root, x).matchAll(/\{%-?\s*section\s+['"]([^'"]+)['"]/g)) {
      if (!set.has(`sections/${m[1]}.liquid`) && !allowed(allow, id, x)) f.push(`${x} renders section "${m[1]}", but sections/${m[1]}.liquid does not exist`)
    }
  }
  for (const x of T.filter((p) => THEME_TEXT.test(p))) {
    const t = readText(root, x)
    for (const m of t.matchAll(/['"]([^'"{}]+)['"]\s*\|\s*asset_url/g)) {
      if (!set.has(`assets/${m[1]}`) && !allowed(allow, id, m[1])) f.push(`${x} asks for asset "${m[1]}", but assets/${m[1]} is not in the theme`)
    }
    t.split('\n').forEach((line, i) => {
      if (/[\w-]+\.myshopify\.com/.test(line) && /access_token|shp(at|ca|pa|ss)_|password/i.test(line) && !allowed(allow, id, x)) f.push(`${x}:${i + 1} puts a myshopify.com store URL next to a token or password`)
    })
  }
  return finish(id, f, 'the theme settings, templates, sections and assets line up, with no store URL next to a token')
}

// ---- liquid-hygiene: blocks closed, render instead of include, images with alt, scripts with defer or async
const LIQUID_BLOCKS = new Set(['if', 'unless', 'for', 'case', 'capture', 'tablerow', 'comment', 'raw', 'form', 'paginate'])
const liquidHygiene = (root) => {
  const id = 'liquid-hygiene'
  const T = tracked(root)
  const files = T.filter((x) => /\.liquid$/i.test(x))
  if (!files.length) return notApplicable(id, 'Liquid')
  const allow = allowSet(root)
  const f = []
  for (const x of files) {
    if (allowed(allow, id, x)) continue
    const t = readText(root, x)
    const stack = []
    for (const m of t.matchAll(/\{%-?\s*(end)?([a-z]+)\b/g)) {
      const name = m[2]
      if (!LIQUID_BLOCKS.has(name)) continue
      const line = lineOf(t, m.index)
      if (!m[1]) stack.push({ name, line })
      else {
        const top = stack.pop()
        if (!top || top.name !== name) f.push(`${x}:${line} has end${name} with no matching {% ${name} %} open`)
      }
    }
    for (const s of stack) f.push(`${x}:${s.line} opens {% ${s.name} %} with no matching end${s.name}`)
    for (const m of t.matchAll(/\{%-?\s*include\b/g)) f.push(`${x}:${lineOf(t, m.index)} uses include, which is deprecated: use render`)
    for (const m of t.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\salt\s*=/i.test(m[0])) f.push(`${x}:${lineOf(t, m.index)} <img> has no alt attribute`)
    }
    for (const m of t.matchAll(/<script\b[^>]*\ssrc\s*=[^>]*>/gi)) {
      if (!/\s(defer|async)[\s/>]/i.test(m[0])) f.push(`${x}:${lineOf(t, m.index)} <script src> has neither defer nor async`)
    }
  }
  return finish(id, f, 'every Liquid block is closed, render is used, images have alt text and scripts defer')
}

// ---- shopify-secrets: Admin, custom app, private app and storefront tokens in any tracked text file (only the first 4 characters are printed)
const SHOPIFY_SECRETS = [
  [/\bshpat_[0-9a-fA-F]{32}\b/g, 'an Admin API access token'],
  [/\bshpca_[0-9a-fA-F]{32}\b/g, 'a custom app access token'],
  [/\bshppa_[0-9a-fA-F]{32}\b/g, 'a private app password'],
  [/\bshpss_[0-9a-fA-F]{32}\b/g, 'an app shared secret'],
  [/(storefront[_-]?access[_-]?token|X-Shopify-Storefront-Access-Token)["'\s:=]+["']?[0-9a-fA-F]{32}\b/gi, 'a Storefront API token'],
]
const shopifySecrets = (root) => {
  const id = 'shopify-secrets'
  const T = tracked(root)
  if (!isShopify(T)) return notApplicable(id, 'Shopify')
  const allow = allowSet(root)
  const f = []
  for (const x of T) {
    if (allowed(allow, id, x) || isBinary(root, x) || megabytes(root, x) > 1) continue
    const t = readText(root, x)
    for (const [re, label] of SHOPIFY_SECRETS) {
      for (const m of t.matchAll(re)) f.push(`${x}:${lineOf(t, m.index)} holds a ${label} (starts ${m[0].slice(0, 4)}..., value not printed)`)
    }
  }
  return finish(id, f, 'no Shopify token or secret is in a tracked file')
}

// ---- wordpress-hygiene: ABSPATH guard, sanitised superglobals, no eval or base64_decode, prepared queries
const WP_CODE = /\b(function\s|class\s|add_action\s*\(|add_filter\s*\(|add_shortcode\s*\(|register_(post_type|taxonomy|block_type|rest_route)\s*\()/
const WP_SAFE = /sanitize_|absint|intval|\(int\)|esc_|wp_unslash|filter_input/
const wordpressHygiene = (root) => {
  const id = 'wordpress-hygiene'
  const T = tracked(root)
  if (!isWordPress(root, T)) return notApplicable(id, 'WordPress')
  const allow = allowSet(root)
  const f = []
  for (const x of T.filter((p) => /\.php$/i.test(p) && !/(^|\/)wp-config(-sample)?\.php$/i.test(p) && !/(^|\/)tests?\//i.test(p))) {
    if (allowed(allow, id, x)) continue
    const t = readText(root, x)
    if (/Silence is golden/i.test(t)) continue
    if (WP_CODE.test(t) && !/defined\s*\(\s*['"]ABSPATH['"]\s*\)/.test(t.slice(0, 1500))) f.push(`${x} defines code but has no ABSPATH guard near the top`)
    t.split('\n').forEach((line, i) => {
      const n = i + 1
      if (/\$_(GET|POST|REQUEST|COOKIE)\s*\[/.test(line) && !/isset\s*\(|empty\s*\(/.test(line) && !WP_SAFE.test(line)) f.push(`${x}:${n} reads $_GET, $_POST or $_REQUEST without sanitize or escape`)
      if (/\beval\s*\(/.test(line)) f.push(`${x}:${n} calls eval()`)
      if (/\bbase64_decode\s*\(/.test(line)) f.push(`${x}:${n} calls base64_decode(), which is a common way to hide code`)
    })
    for (const m of t.matchAll(/\$wpdb->(query|get_results|get_row|get_var|get_col)\s*\(([^;]*)/g)) {
      const args = m[2]
      if (/\$[a-zA-Z_]/.test(args) && !/prepare\s*\(/.test(args)) f.push(`${x}:${lineOf(t, m.index)} runs $wpdb->${m[1]}() with a variable and no prepare()`)
    }
  }
  return finish(id, f, 'WordPress code has its guards, sanitises input, and prepares its queries')
}

// ---- wordpress-config: wp-config.php holds no live credentials, salts or debug switches (a tracked copy is the problem)
const WP_PLACEHOLDER = /^(|password|pass|changeme|root|your_?password|.*_here|.*placeholder.*)$/i
const wordpressConfig = (root) => {
  const id = 'wordpress-config'
  const T = tracked(root)
  if (!isWordPress(root, T)) return notApplicable(id, 'WordPress')
  const allow = allowSet(root)
  const f = []
  const info = []
  for (const x of T.filter((p) => p === 'wp-config.php' || /\/wp-config\.php$/.test(p))) {
    if (allowed(allow, id, x)) continue
    const t = readText(root, x)
    for (const m of t.matchAll(/define\(\s*['"]([A-Z_]+)['"]\s*,\s*['"]([^'"]*)['"]/g)) {
      const [, key, val] = m
      const line = lineOf(t, m.index)
      if (key === 'DB_PASSWORD') {
        if (val.length >= 6 && !WP_PLACEHOLDER.test(val)) f.push(`${x}:${line} sets DB_PASSWORD to a real-looking value (not printed)`)
      } else if (/_(KEY|SALT)$/.test(key) && val.length > 0 && !/put your unique phrase/i.test(val)) {
        f.push(`${x}:${line} commits ${key} with a live value, not the placeholder`)
      }
    }
    if (/define\(\s*['"]WP_DEBUG['"]\s*,\s*true\s*\)/i.test(t)) f.push(`${x} turns WP_DEBUG on`)
    if (!/DISALLOW_FILE_EDIT/.test(t)) info.push(`${x} does not set DISALLOW_FILE_EDIT (informational)`)
  }
  const code = finish(id, f, 'wp-config.php holds no committed credentials, salts or debug switch')
  for (const line of info) console.log(`  note: ${line}`)
  return code
}

// ---- static-site-generator: site URL is https, drafts are not published, a 404 page exists (informational)
const SSG = [
  { name: 'Hugo', file: (x) => /^(hugo\.(toml|ya?ml|json)|config\.(toml|ya?ml|json))$/.test(x), marker: /baseURL/, http: true, drafts: /\bbuildDrafts\s*[:=]\s*["']?true/i },
  { name: 'Jekyll', file: (x) => /^_config\.ya?ml$/.test(x), marker: /\b(baseurl|url)\s*:/, http: true, drafts: /\bshow_drafts\s*:\s*["']?true/i },
  { name: 'Eleventy', file: (x) => /^(\.eleventy|eleventy\.config)\.(c|m)?js$/.test(x), marker: null },
  { name: 'Astro', file: (x) => /^astro\.config\.(m|c)?[jt]s$/.test(x), marker: null, http: true },
  { name: 'Next', file: (x) => /^next\.config\.(m|c)?[jt]s$/.test(x), marker: null },
]
const staticSite = (root) => {
  const id = 'static-site-generator'
  const T = tracked(root)
  const found = []
  for (const x of T.filter((p) => !p.includes('/'))) {
    for (const g of SSG) {
      if (!g.file(x)) continue
      const text = readText(root, x)
      if (g.marker && !g.marker.test(text)) continue
      found.push({ g, x, text })
    }
  }
  if (!found.length) return notApplicable(id, 'static site')
  const allow = allowSet(root)
  const f = []
  for (const { g, x, text } of found) {
    if (allowed(allow, id, x)) continue
    if (g.http && new RegExp(`\\b(baseURL|baseurl|url|site)\\s*[:=]\\s*["']?http://(?!localhost|127\\.0\\.0\\.1)`, 'i').test(text)) f.push(`${x} (${g.name}) sets the site URL to http://, not https://`)
    if (g.drafts && g.drafts.test(text)) f.push(`${x} (${g.name}) publishes drafts`)
  }
  const code = finish(id, f, 'the static site uses https and does not publish drafts')
  if (!T.some((x) => /(^|\/)(404|not-found)\.[a-z]+$/i.test(x))) console.log('  note: no 404 page found (informational): add a 404 page so missing links get a real page')
  return code
}

// ---- The fixtures: each one is a small project of the right kind with one deliberate problem.
const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const UNITY_BASE = { 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.1f1\n', 'Assets/Player.cs': 'class Player {}\n' }
const TOKEN = 'shpat' + '_' + 'ab12'.repeat(8)

main({
  'unity-meta-files': { run: unityMeta, ...fx(UNITY_BASE, unityMeta) },
  'unity-gitignore': { run: unityGitignore, ...fx({ ...UNITY_BASE, '.gitignore': 'bin/\n', 'Library/Cache.bin': 'x' }, unityGitignore) },
  'unity-serialization': {
    run: unitySerialization,
    ...fx({ ...UNITY_BASE, 'ProjectSettings/EditorSettings.asset': '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!159 &1\nEditorSettings:\n  serializationMode: 1\n' }, unitySerialization),
  },
  'unity-large-assets': {
    run: unityLarge,
    ...fx({ ...UNITY_BASE, 'Assets/Hero.png': 'x'.repeat(4096), '.meerkat-budgets.json': '{"engines":{"maxAssetMb":0.001}}' }, unityLarge),
  },
  'unity-script-hazards': {
    run: unityScripts,
    ...fx({ ...UNITY_BASE, 'Assets/Hero.cs': 'class Hero : MonoBehaviour {\n  void Update() {\n    GetComponent<Rigidbody>();\n  }\n}\n', '.meerkat-budgets.json': '{"engines":{"hazardsFail":true}}' }, unityScripts),
  },
  'godot-project': {
    run: godotProject,
    ...fx({ 'project.godot': '; Engine configuration file.\n[application]\nconfig/name="x"\n', 'export_presets.cfg': '[preset.0]\n\nkeystore/release_password="fixture-only"\n', 'main.gd': 'extends Node\n' }, godotProject),
  },
  'godot-script-hazards': {
    run: godotScripts,
    ...fx({ 'main.gd': 'extends Node\n\nfunc _process(delta):\n\tprint("tick")\n\tget_node("Player")\n', '.meerkat-budgets.json': '{"engines":{"hazardsFail":true}}' }, godotScripts),
  },
  'unreal-hygiene': { run: unrealHygiene, ...fx({ 'Game.uproject': '{"FileVersion":3,"EngineAssociation":"5.3"}\n' }, unrealHygiene) },
  'shopify-theme-basics': {
    run: shopifyTheme,
    ...fx(
      {
        'layout/theme.liquid': "<html>{{ 'theme.css' | asset_url | stylesheet_tag }}</html>\n",
        'sections/header.liquid': '<h1>x</h1>\n',
        'config/settings_schema.json': '[]\n',
        'templates/index.json': '{"sections":{"main":{"type":"missing-one"}},"order":["main"]}\n',
      },
      shopifyTheme,
    ),
  },
  'liquid-hygiene': {
    run: liquidHygiene,
    ...fx({ 'sections/a.liquid': '{% if product %}\n<img src="a.png">\n<script src="a.js"></script>\n{% include "x" %}\n' }, liquidHygiene),
  },
  'shopify-secrets': {
    run: shopifySecrets,
    ...fx({ 'layout/theme.liquid': '<html></html>\n', 'sections/x.liquid': '<p>x</p>\n', 'config/app.env': `SHOPIFY_TOKEN=${TOKEN}\n` }, shopifySecrets),
  },
  'wordpress-hygiene': {
    run: wordpressHygiene,
    ...fx(
      {
        'wp-content/plugins/demo/demo.php':
          "<?php\n/*\nPlugin Name: Demo\n*/\nfunction demo_run() {\n\t$v = $_GET['x'];\n\teval($v);\n\t$wpdb->query(\"DELETE FROM t WHERE id = $v\");\n}\n",
      },
      wordpressHygiene,
    ),
  },
  'wordpress-config': {
    run: wordpressConfig,
    ...fx({ 'wp-config.php': "<?php\ndefine('DB_NAME', 'site');\ndefine('DB_PASSWORD', 'fixture-only-pass');\ndefine('WP_DEBUG', true);\n" }, wordpressConfig),
  },
  'static-site-generator': {
    run: staticSite,
    ...fx({ 'config.toml': 'baseURL = "http://example.com/"\nbuildDrafts = true\n' }, staticSite),
  },
})
