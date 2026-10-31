// Health checks: static performance smells and dependency health, offline and read-only. Zero dependencies. Run through the
// health pack, or by hand:
//   node thorough/health.mjs <check> [--root <dir>]      node thorough/health.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "health": maxJsonInLoop (default 10), maxInlineKb (20), maxImageKb (500),
// maxDependencies (150). A finding you accept goes in .meerkat-health-allow as "<check-id> <path>" (or "<check-id> <name>" for a
// dependency), one per line, # starts a comment. Loop and handler detection follows braces line by line: a close approximation,
// not a parser, so a one-line body that spans several lines can be missed.
import { join, posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, sizeOf, trackedFiles, withFixture } from './kit.mjs'

const cfg = (root) => readBudgets(root)?.health ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?|coverage|\.next)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock|yarn\.lock|pnpm-lock\.yaml)$|\.(lock|snap)$/i
const SCRIPT = /\.(m?[jt]sx?|cjs)$/i
const FRONTEND = /\.(m?[jt]sx?|cjs|html?|vue|svelte)$/i
const STYLE_OR_MARKUP = /\.(m?[jt]sx?|cjs|css|scss|html?|vue|svelte)$/i
const SOURCE_TEXT = /\.(m?[jt]sx?|cjs|json|html?|css|scss|rs|toml|ya?ml|py|go|sh|svelte|vue|xml|cfg|ini)$|(^|\/)(Makefile|Dockerfile)$/i
const SERVER_FILE = /(^|\/)(server|app|api|routes?|handlers?|controllers?|index)\.[cm]?[jt]s$/i
const SERVER_HINT = /\b(createServer|express\(|fastify\(|new Koa\(|app\.(get|post|put|patch|delete|use)\s*\(|router\.(get|post|put|patch|delete)\s*\()/
const LOOP = /\b(for|while)\b(\s+await)?\s*\(/
const HANDLER = /\(\s*(req|request|res|response|reply|ctx|event|evt)\b[^)]*\)\s*=>|\bfunction\b[^(]*\(\s*(req|request|res|response|reply|ctx)\b|\.(on|once|addEventListener)\s*\(.*,\s*(async\s+)?(\(|function\b)/
const SYNC_IO = /\b(readFileSync|writeFileSync|appendFileSync|execSync|execFileSync|spawnSync)\s*\(/
const JSON_CALL = /\bJSON\.(parse|stringify)\s*\(/g
const DOM_QUERY = /\bdocument\.(querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)\s*\(/
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+(?:;[^,\s'"`)]*)?,[^\s'"`)]*/gi
const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?)$/i
const ALWAYS_LARGE_IMAGE = /\.(bmp|tiff?)$/i
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const SECTION_RE = Object.fromEntries(SECTIONS.map((s) => [s, new RegExp(`"${s}"\\s*:\\s*\\{([^{}]*)\\}`, 'g')]))
const ENTRY_RE = /"([^"\\]+)"\s*:\s*"([^"\\]*)"/g
const DEV_ONLY = /^(eslint|jest|vitest|mocha|typescript|webpack|prettier|nodemon|@types\/.+|eslint-.+|@typescript-eslint\/.+)$/
const TOOLING = /^(typescript|eslint|prettier|vitest|jest|mocha|nodemon|webpack|vite|tsx|ts-node|rimraf|husky|lint-staged|esbuild|rollup|concurrently|cross-env|npm-run-all|electron|electron-builder|@types\/.+|@typescript-eslint\/.+|eslint-.+|@babel\/.+|babel-.+|postcss|autoprefixer|tailwindcss)$/
const REQ_UNPINNED = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]*\])?$/
const CARGO_STAR = /\bversion\s*=\s*"\*"|^\s*[\w-]+\s*=\s*"\*"\s*$/

const allowSet = (root) => new Set(readText(root, '.meerkat-health-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, id, x) => allow.has(`${id} ${x}`)
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !GENERATED.test(x) && !isFixture(x))
const manifests = (root) => files(root, /(^|\/)package\.json$/)
const lines = (text) => text.split('\n')

// A line of code with string and regex literal contents blanked (quotes kept) and any // comment cut, so a pattern only matches real code.
const STRING = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g
const REGEX = /(^|[=(,:;!&|?{}\[]|\breturn)\s*\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[a-z]*/g
const blankString = (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]
const code = (raw) => raw.replace(STRING, blankString).replace(REGEX, (m) => ' '.repeat(m.length)).replace(/\/\/.*$/, '')
const codeLines = (text) => lines(text).map(code)

// For each line: true when it sits inside a block opened by a line matching startRe (a loop body, a request handler).
// A loop header with no brace whose body ends on the same line counts as a one-line body.
function regions(cl, startRe) {
  const out = []
  const stack = []
  let open = 0
  let pending = false
  for (const line of cl) {
    const before = open > 0
    if (startRe.test(line)) pending = true
    for (const ch of line) {
      if (ch === '{') {
        stack.push(pending)
        if (pending) open++
        pending = false
      } else if (ch === '}') {
        if (stack.pop()) open--
      }
    }
    const oneLine = pending && !line.includes('{') && /;\s*$/.test(line)
    if (oneLine) pending = false
    out.push(before || oneLine)
  }
  return out
}

// Every name and range in each dependency section, in file order, with repeats kept (JSON.parse silently drops a repeated key).
function depEntries(text) {
  const out = []
  for (const section of SECTIONS) {
    for (const m of text.matchAll(SECTION_RE[section])) {
      for (const p of m[1].matchAll(ENTRY_RE)) out.push({ section, name: p[1], range: p[2] })
    }
  }
  return out
}

// ---- sync-fs-in-handlers: blocking file or process calls inside a request or event handler, in server files only
const syncFsInHandlers = (root) => {
  const id = 'sync-fs-in-handlers'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SCRIPT)) {
    if (!SERVER_FILE.test(x) || allowed(allow, id, x)) continue
    const cl = codeLines(readText(root, x))
    if (!SERVER_HINT.test(cl.join('\n'))) continue
    const inHandler = regions(cl, HANDLER)
    cl.forEach((l, i) => {
      if (inHandler[i] && SYNC_IO.test(l)) f.push(`${x}:${i + 1} blocks the event loop inside a request or event handler (use fs.promises or the callback form)`)
    })
  }
  return finish(id, f, 'no server handler makes a blocking file or process call')
}

// ---- json-parse-in-loop: JSON.parse or JSON.stringify inside loop bodies, counted across the project against a budget
const jsonParseInLoop = (root) => {
  const id = 'json-parse-in-loop'
  const max = cfg(root).maxJsonInLoop ?? 10
  const allow = allowSet(root)
  const per = []
  let total = 0
  for (const x of files(root, SCRIPT)) {
    if (allowed(allow, id, x)) continue
    const cl = codeLines(readText(root, x))
    const inLoop = regions(cl, LOOP)
    let n = 0
    cl.forEach((l, i) => {
      if (inLoop[i]) n += (l.match(JSON_CALL) ?? []).length
    })
    if (n) {
      total += n
      per.push(`${x} calls JSON.parse or JSON.stringify ${n} time(s) inside a loop`)
    }
  }
  if (total > max) return finish(id, [`${total} JSON calls sit inside loops, over the budget of ${max} (set health.maxJsonInLoop)`, ...per])
  return finish(id, [], `JSON calls inside loops: ${total}, within the budget of ${max}`)
}

// ---- regex-in-loop: a RegExp built inside a loop is compiled again on every pass
const regexInLoop = (root) => {
  const id = 'regex-in-loop'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SCRIPT)) {
    if (allowed(allow, id, x)) continue
    const cl = codeLines(readText(root, x))
    const inLoop = regions(cl, LOOP)
    cl.forEach((l, i) => {
      if (inLoop[i] && /\bnew\s+RegExp\s*\(/.test(l)) f.push(`${x}:${i + 1} builds a RegExp inside a loop (build it once, before the loop)`)
    })
  }
  return finish(id, f, 'no RegExp is built inside a loop')
}

// ---- dom-query-in-loop: document lookups repeated on every pass of a loop in frontend code
const domQueryInLoop = (root) => {
  const id = 'dom-query-in-loop'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, FRONTEND)) {
    if (allowed(allow, id, x)) continue
    const cl = codeLines(readText(root, x))
    const inLoop = regions(cl, LOOP)
    cl.forEach((l, i) => {
      if (inLoop[i] && DOM_QUERY.test(l)) f.push(`${x}:${i + 1} looks up the DOM inside a loop (look the element up once, before the loop)`)
    })
  }
  return finish(id, f, 'no DOM lookup is repeated inside a loop')
}

// ---- large-inline-assets: data: URIs bigger than the budget, in source, styles and markup
const largeInlineAssets = (root) => {
  const id = 'large-inline-assets'
  const max = cfg(root).maxInlineKb ?? 20
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, STYLE_OR_MARKUP)) {
    if (allowed(allow, id, x)) continue
    lines(readText(root, x)).forEach((raw, i) => {
      for (const m of raw.matchAll(DATA_URI)) {
        const kb = m[0].length / 1024
        if (kb > max) f.push(`${x}:${i + 1} has an inline data URI of ${Math.round(kb)} KB (budget ${max} KB: set health.maxInlineKb, or move the asset to a file)`)
      }
    })
  }
  return finish(id, f, `no inline data URI is over ${max} KB`)
}

// ---- unoptimised-images: raster images over the size budget, and bmp or tiff of any size
const unoptimisedImages = (root) => {
  const id = 'unoptimised-images'
  const max = cfg(root).maxImageKb ?? 500
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, IMAGE)) {
    if (allowed(allow, id, x)) continue
    if (ALWAYS_LARGE_IMAGE.test(x)) {
      f.push(`${x} is a ${x.split('.').pop()} file (uncompressed or rarely optimised: convert it to PNG, WebP or AVIF)`)
      continue
    }
    const kb = sizeOf(join(root, x)) / 1024
    if (kb > max) f.push(`${x} is ${Math.round(kb)} KB (budget ${max} KB: set health.maxImageKb, or compress it)`)
  }
  return finish(id, f, `no image is over ${max} KB`)
}

// ---- duplicate-dependencies: one package listed in two sections, or twice with different ranges
const duplicateDependencies = (root) => {
  const id = 'duplicate-dependencies'
  const allow = allowSet(root)
  const f = []
  for (const x of manifests(root)) {
    if (allowed(allow, id, x)) continue
    const byName = new Map()
    for (const e of depEntries(readText(root, x))) byName.set(e.name, [...(byName.get(e.name) ?? []), e])
    for (const [name, list] of byName) {
      if (list.length < 2) continue
      const sections = [...new Set(list.map((e) => e.section))]
      const ranges = [...new Set(list.map((e) => e.range))]
      if (sections.length > 1) f.push(`${x} lists ${name} in both ${sections.join(' and ')}`)
      else if (ranges.length > 1) f.push(`${x} lists ${name} twice in ${sections[0]} with different ranges (${ranges.join(', ')})`)
    }
  }
  return finish(id, f, 'no dependency is listed twice')
}

// ---- wildcard-versions: a dependency that floats (*, latest, empty, or a git or URL spec) and unpinned lines in Python and Rust manifests
const floating = (r) => r === '*' || r === 'latest' || r === '' || /^(git\+https?:|git:\/\/|https?:\/\/)/.test(r)
const wildcardVersions = (root) => {
  const id = 'wildcard-versions'
  const allow = allowSet(root)
  const f = []
  for (const x of manifests(root)) {
    if (allowed(allow, id, x)) continue
    for (const e of depEntries(readText(root, x))) {
      if (floating(e.range)) f.push(`${x} depends on ${e.name} at "${e.range}", which is not a fixed version`)
    }
  }
  for (const x of files(root, /(^|\/)requirements[^/]*\.txt$/i)) {
    if (allowed(allow, id, x)) continue
    lines(readText(root, x)).forEach((raw, i) => {
      const l = raw.replace(/#.*$/, '').trim()
      if (l && !l.startsWith('-') && REQ_UNPINNED.test(l)) f.push(`${x}:${i + 1} lists ${l} with no version (pin it, for example ${l}==1.0.0)`)
    })
  }
  for (const x of files(root, /(^|\/)Cargo\.toml$/)) {
    if (allowed(allow, id, x)) continue
    lines(readText(root, x)).forEach((raw, i) => {
      if (CARGO_STAR.test(raw)) f.push(`${x}:${i + 1} uses a "*" version (pin a version range)`)
    })
  }
  return finish(id, f, 'every dependency names a version')
}

// ---- dependency-count: direct dependencies over the budget (informational budget, see perf-deps for installed size)
const dependencyCount = (root) => {
  const id = 'dependency-count'
  const max = cfg(root).maxDependencies ?? 150
  const allow = allowSet(root)
  const f = []
  for (const x of manifests(root)) {
    if (allowed(allow, id, x)) continue
    const names = new Set(depEntries(readText(root, x)).filter((e) => e.section === 'dependencies' || e.section === 'devDependencies').map((e) => e.name))
    if (names.size > max) f.push(`${x} lists ${names.size} direct dependencies (budget ${max}: set health.maxDependencies)`)
  }
  return finish(id, f, `direct dependencies are within the budget of ${max}`)
}

// ---- dev-deps-in-prod: build and test tools listed under dependencies in an application (a published library may ship one)
const devDepsInProd = (root) => {
  const id = 'dev-deps-in-prod'
  const allow = allowSet(root)
  const f = []
  for (const x of manifests(root)) {
    if (allowed(allow, id, x)) continue
    let j
    try {
      j = JSON.parse(readText(root, x))
    } catch {
      continue
    }
    if (j.private !== true && (j.main || j.exports || j.module || j.types)) continue
    for (const name of Object.keys(j.dependencies ?? {})) {
      if (DEV_ONLY.test(name) && !allow.has(`${id} ${name}`)) f.push(`${x} lists ${name} under dependencies (a build or test tool: move it to devDependencies)`)
    }
  }
  return finish(id, f, 'no build or test tool is listed under dependencies')
}

// ---- deprecated-apis: calls Node or the language has deprecated or removed
const DEPRECATED = [
  [/\bnew Buffer\s*\(/, 'new Buffer() is deprecated: use Buffer.from() or Buffer.alloc()'],
  [/\bfs\.exists\s*\(/, 'fs.exists() is deprecated: use fs.promises.access() or fs.existsSync()'],
  [/\burl\.parse\s*\(/, 'url.parse() is deprecated: use new URL()'],
  [/\bcrypto\.createCipher\s*\(/, 'crypto.createCipher() is removed from modern Node: use createCipheriv() with a key and IV'],
  [/\bprocess\.binding\s*\(/, 'process.binding() is internal and deprecated: avoid it'],
]
// A require, import or from-clause whose module string is blank in code (the literal is blanked), checked against the raw line for its name.
const PUNYCODE_LOAD = /\brequire\s*\(\s*['"`]\s*['"`]\s*\)|\bfrom\s+['"`]\s*['"`]|\bimport\s*\(\s*['"`]\s*['"`]/
const deprecatedApis = (root) => {
  const id = 'deprecated-apis'
  const allow = allowSet(root)
  const f = []
  for (const x of files(root, SCRIPT)) {
    if (allowed(allow, id, x)) continue
    const raw = lines(readText(root, x))
    raw.forEach((r, i) => {
      const l = code(r)
      for (const [re, msg] of DEPRECATED) if (re.test(l)) f.push(`${x}:${i + 1} ${msg}`)
      if (PUNYCODE_LOAD.test(l) && /punycode/.test(r)) f.push(`${x}:${i + 1} loads punycode, which is deprecated: use the userland punycode package or a URL API`)
    })
  }
  return finish(id, f, 'no deprecated API is called')
}

// ---- node-version-mismatch: the Node major named by .nvmrc, package.json engines, Dockerfiles and workflows must agree
const nodeVersionMismatch = (root) => {
  const id = 'node-version-mismatch'
  const allow = allowSet(root)
  const found = []
  const add = (x, major) => {
    if (major && !allowed(allow, id, x)) found.push({ x, major: Number(major) })
  }
  for (const x of files(root, /(^|\/)\.nvmrc$/)) add(x, /(\d+)/.exec(readText(root, x))?.[1])
  for (const x of manifests(root)) {
    let j
    try {
      j = JSON.parse(readText(root, x))
    } catch {
      continue
    }
    add(x, typeof j.engines?.node === 'string' ? /(\d+)/.exec(j.engines.node)?.[1] : null)
  }
  for (const x of files(root, /(^|\/)Dockerfile[^/]*$/i)) {
    for (const l of lines(readText(root, x))) add(x, /^\s*FROM\s+node:(\d+)/i.exec(l)?.[1])
  }
  for (const x of files(root, /^\.github\/workflows\/[^/]+\.ya?ml$/)) {
    for (const l of lines(readText(root, x))) add(x, /node-version\s*:\s*['"]?(\d+)/.exec(l)?.[1])
  }
  const majors = [...new Set(found.map((e) => e.major))]
  if (majors.length > 1) return finish(id, found.map((e) => `${e.x} asks for Node ${e.major}`), '')
  return finish(id, [], majors.length ? `every Node version source agrees on Node ${majors[0]}` : 'no Node version is pinned in any source')
}

// ---- lockfile-in-sync: direct dependencies that the package-lock.json does not record, and the reverse (v2 and later lockfiles)
const lockfileInSync = (root) => {
  const id = 'lockfile-in-sync'
  const allow = allowSet(root)
  const tracked = new Set(trackedFiles(root))
  const f = []
  for (const x of manifests(root)) {
    const lockPath = posix.join(posix.dirname(x), 'package-lock.json')
    if (!tracked.has(lockPath) || allowed(allow, id, x)) continue
    let lock
    try {
      lock = JSON.parse(readText(root, lockPath))
    } catch {
      continue
    }
    const wanted = new Set(depEntries(readText(root, x)).map((e) => e.name))
    const rootEntry = lock.packages?.['']
    const recorded = new Set(rootEntry ? SECTIONS.flatMap((s) => Object.keys(rootEntry[s] ?? {})) : Object.keys(lock.dependencies ?? {}))
    for (const n of wanted) if (!recorded.has(n)) f.push(`${x} lists ${n}, which ${lockPath} does not record (run npm install to refresh the lock)`)
    if (rootEntry) for (const n of recorded) if (!wanted.has(n)) f.push(`${lockPath} records ${n}, which ${x} no longer lists`)
  }
  return finish(id, f, 'every lockfile matches its package.json')
}

// ---- unused-dependencies-quick: a dependency no tracked source or package script mentions by name (a quick name search, not a graph)
const unusedDependenciesQuick = (root) => {
  const id = 'unused-dependencies-quick'
  const allow = allowSet(root)
  const f = []
  const pkgs = manifests(root).map((x) => ({ x, text: readText(root, x) }))
  const parts = []
  for (const x of files(root, SOURCE_TEXT)) {
    if (/(^|\/)package\.json$/.test(x)) continue
    parts.push(readText(root, x))
  }
  for (const p of pkgs) {
    const scripts = /"scripts"\s*:\s*\{[^{}]*\}/.exec(p.text)
    if (scripts) parts.push(scripts[0])
  }
  const blob = parts.join('\n')
  for (const p of pkgs) {
    if (allowed(allow, id, p.x)) continue
    for (const e of depEntries(p.text)) {
      if (e.section !== 'dependencies' && e.section !== 'devDependencies') continue
      if (TOOLING.test(e.name) || allow.has(`${id} ${e.name}`) || blob.includes(e.name)) continue
      f.push(`${p.x} lists ${e.name}, which no tracked source or script mentions (remove it, or allow it as "${id} ${e.name}" in .meerkat-health-allow)`)
    }
  }
  return finish(id, f, 'every listed dependency is mentioned by some tracked source or script')
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const budgets = (health) => ({ '.meerkat-budgets.json': JSON.stringify({ health }) + '\n' })

main({
  'sync-fs-in-handlers': {
    run: syncFsInHandlers,
    ...fx({ 'server.js': "const fs = require('fs')\nconst app = express()\napp.get('/', (req, res) => {\n  res.send(fs.readFileSync('a.txt'))\n})\n" }, syncFsInHandlers),
  },
  'json-parse-in-loop': {
    run: jsonParseInLoop,
    ...fx({ ...budgets({ maxJsonInLoop: 1 }), 'a.js': 'for (const x of xs) {\n  JSON.parse(x)\n  JSON.parse(x)\n}\n' }, jsonParseInLoop),
  },
  'regex-in-loop': { run: regexInLoop, ...fx({ 'a.js': 'for (const x of xs) {\n  const r = new RegExp(x)\n}\n' }, regexInLoop) },
  'dom-query-in-loop': { run: domQueryInLoop, ...fx({ 'app.js': 'for (const i of xs) {\n  document.getElementById(i)\n}\n' }, domQueryInLoop) },
  'large-inline-assets': {
    run: largeInlineAssets,
    ...fx({ ...budgets({ maxInlineKb: 1 }), 'page.html': '<img src="data:image/png;base64,' + 'A'.repeat(3000) + '">\n' }, largeInlineAssets),
  },
  'unoptimised-images': { run: unoptimisedImages, ...fx({ 'logo.bmp': 'BM' }, unoptimisedImages) },
  'duplicate-dependencies': {
    run: duplicateDependencies,
    ...fx({ 'package.json': '{"name":"x","private":true,"dependencies":{"left-pad":"1.0.0"},"devDependencies":{"left-pad":"1.0.0"}}\n' }, duplicateDependencies),
  },
  'wildcard-versions': {
    run: wildcardVersions,
    ...fx({ 'package.json': '{"name":"x","private":true,"dependencies":{"a-pkg":"*"}}\n' }, wildcardVersions),
  },
  'dependency-count': {
    run: dependencyCount,
    ...fx({ ...budgets({ maxDependencies: 1 }), 'package.json': '{"name":"x","private":true,"dependencies":{"a-pkg":"1.0.0","b-pkg":"1.0.0"}}\n' }, dependencyCount),
  },
  'dev-deps-in-prod': {
    run: devDepsInProd,
    ...fx({ 'package.json': '{"name":"x","private":true,"dependencies":{"eslint":"9.0.0"}}\n' }, devDepsInProd),
  },
  'deprecated-apis': { run: deprecatedApis, ...fx({ 'a.js': 'const b = new Buffer(4)\n' }, deprecatedApis) },
  'node-version-mismatch': {
    run: nodeVersionMismatch,
    ...fx({ '.nvmrc': '18\n', '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n' }, nodeVersionMismatch),
  },
  'lockfile-in-sync': {
    run: lockfileInSync,
    ...fx({
      'package.json': '{"name":"x","private":true,"dependencies":{"a-pkg":"1.0.0"}}\n',
      'package-lock.json': '{"name":"x","lockfileVersion":3,"packages":{"":{"name":"x","dependencies":{}}}}\n',
    }, lockfileInSync),
  },
  'unused-dependencies-quick': {
    run: unusedDependenciesQuick,
    ...fx({ 'package.json': '{"name":"x","private":true,"dependencies":{"leftover-zzz":"1.0.0"}}\n', 'a.js': 'console.log(1)\n' }, unusedDependenciesQuick),
  },
})
