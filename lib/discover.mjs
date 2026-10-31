// Finds the project's OWN tests without being told, so `meerkat full` runs what the project already has: its package.json scripts
// (test, e2e, verify:*, smoke, click-through ...), Makefile targets, Playwright and Cypress configs, scripts/ files named like click or smoke,
// and tests/ runner scripts. Each one becomes a check written as data (lib/customchecks.mjs): a program and its arguments, never a shell line.
//
// Everything here only LOOKS (it reads package.json, Makefile, folder listings and the first 4000 characters of a referenced script).
// It never runs anything. `MEERKAT_NO_PROJECT_CODE=1` keeps it from reading any script file: the items are still listed, from names and
// package.json alone, so a menu or tab completion never opens project code.
//
// Window checks (Electron, Playwright, a click-through) go on the `windows` lane, which runs several at once up to a cap
// (discover.maxWindows, default 3, never more than the CPU count minus 1). A script that can be split into shards runs as N checks side by side.
// Every discovered script gets MEERKAT_SHARD=<i>/<n> in its environment (1/1 when it is not split).
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { entryToCheck, validateEntry } from './customchecks.mjs'
import { runKey } from './recommend.mjs'
import { setProjectSuites, projectSuites } from './suites.mjs'
import { stripControl } from './tui/safe.mjs'

export const FOUND_SUITE = 'found'
export const DEFAULT_MAX_WINDOWS = 3
export const DEFAULT_SHARDS = 3
export const MAX_ITEMS = 30
const HEAD = 4000
const JS_TOOLS = ['npm', 'pnpm', 'yarn', 'bun']

// Which package.json scripts are tests, and which are not.
export const WANT_RE = /^(test|tests|e2e|test:e2e|e2e:.*|test:.*|verify|verify:.*|smoke|smoke:.*|click.*|clicks|ui|ui:test|playwright|cypress|screenshots?|a11y|visual.*|integration|test:integration)$/i
export const SKIP_RE = /(^|[:._-])(watch|dev|start|build|lint|format|install|prepare|publish|release|deploy|clean|serve|storybook|docs?)($|[:._-])/i
export const WINDOW_RE = /electron|BrowserWindow|playwright|cypress|puppeteer|click/i
const ALONE_RE = /e2e|click|playwright|cypress|screenshot/i
const HELPER_RE = /(^|[-_.])(lib|helper|helpers|util|utils|common|setup|fixtures?|runner|shared|mock|mocks|config|types?)([-_.]|$)/i
const NEEDS_SETUP_RE = /a11y|axe|perf|bench|demo|manual|stress|soak/i
const FILE_RE = /\.(?:c|m)?js$/i
const TEST_FILE_RE = /\.(?:test|spec)\.(?:c|m)?[jt]s$/i

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const names = (dir) => {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const fwd = (p) => String(p).replace(/\\/g, '/')
const clean = (x) => stripControl(String(x ?? ''))

// ---- the setting: "discover": false | { maxWindows, shards: { script, count } | [..] } ----

// Check a raw `discover` value. Returns { value, notes }: value is undefined (not set), false (off) or a cleaned object.
export function readDiscoverSetting(raw, label = 'discover') {
  const notes = []
  if (raw === undefined) return { value: undefined, notes }
  if (raw === false) return { value: false, notes }
  if (raw === true) return { value: {}, notes }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: undefined, notes: [`"${label}" must be false or an object such as { "maxWindows": 3, "shards": { "script": "test:clicks", "count": 3 } }; ignored`] }
  const value = {}
  if (raw.maxWindows !== undefined) {
    if (Number.isInteger(raw.maxWindows) && raw.maxWindows >= 1 && raw.maxWindows <= 32) value.maxWindows = raw.maxWindows
    else notes.push(`"${label}.maxWindows" must be a whole number from 1 to 32; ignored`)
  }
  if (raw.shards !== undefined) {
    const list = Array.isArray(raw.shards) ? raw.shards : [raw.shards]
    const ok = []
    for (const s of list) {
      if (s && typeof s === 'object' && typeof s.script === 'string' && /^[\w:.-]{1,80}$/.test(s.script) && (s.count === undefined || (Number.isInteger(s.count) && s.count >= 1 && s.count <= 16))) ok.push({ script: s.script, count: s.count ?? DEFAULT_SHARDS })
      else notes.push(`"${label}.shards" entries must look like { "script": "test:clicks", "count": 3 }; one ignored`)
    }
    if (ok.length) value.shards = ok
  }
  for (const k of Object.keys(raw)) if (!['maxWindows', 'shards'].includes(k)) notes.push(`"${label}.${clean(k).slice(0, 30)}" is not a known key; ignored`)
  return { value, notes }
}

// Project setting beats the person's. false in either one turns discovery off.
export function mergeSettings(project, personal) {
  if (project === false || personal === false) return { enabled: false, maxWindows: DEFAULT_MAX_WINDOWS, shards: [] }
  const p = personal && typeof personal === 'object' ? personal : {}
  const q = project && typeof project === 'object' ? project : {}
  return { enabled: true, maxWindows: q.maxWindows ?? p.maxWindows ?? DEFAULT_MAX_WINDOWS, shards: [...(q.shards ?? []), ...(p.shards ?? [])] }
}

// The window cap actually used: the setting, and never more than the CPU count minus one.
export const windowCap = (maxWindows = DEFAULT_MAX_WINDOWS, cpuCount = cpus().length) => Math.max(1, Math.min(maxWindows, Math.max(1, cpuCount - 1)))

// ---- reading a script file (only when project code may be read) ----

const inside = (root, file) => {
  try {
    const r = relative(realpathSync(root), realpathSync(file))
    return r !== '' && !r.startsWith('..') && !/^[a-zA-Z]:/.test(r)
  } catch {
    return false
  }
}
function head(root, file) {
  if (!existsSync(file) || !inside(root, file)) return ''
  let fd
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(HEAD)
    const n = readSync(fd, buf, 0, HEAD, 0)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
// The first 4000 characters of a file, plus those of the local files it requires or imports (one level).
export function sniffFile(root, file) {
  const text = head(root, file)
  if (!text) return ''
  let all = text
  let more = 0
  for (const m of text.matchAll(/(?:require\(|from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (more >= 3) break
    const base = resolve(dirname(file), m[1])
    const hit = [base, `${base}.cjs`, `${base}.mjs`, `${base}.js`].find((f) => FILE_RE.test(f) && existsSync(f))
    if (hit) {
      all += `\n${head(root, hit)}`
      more++
    }
  }
  return all
}
// Script files named in a package.json script line, as absolute paths that exist under `root`.
export function filesIn(body, root) {
  const out = []
  for (const tok of String(body).split(/\s+/)) {
    const t = tok.replace(/^['"]|['"]$/g, '')
    if (!/^[\w@./\\-]+$/.test(t) || !FILE_RE.test(t)) continue
    const f = resolve(root, t)
    if (existsSync(f) && inside(root, f)) out.push(f)
  }
  return out
}

// ---- classifying ----

// Is this package script a test worth running, and why not when it is not.
export function classifyScript(name, body) {
  const b = String(body ?? '')
  if (!WANT_RE.test(name)) return { use: false, why: 'not named like a test' }
  if (SKIP_RE.test(name)) return { use: false, why: 'named like a build, server or watcher, not a test' }
  if (/(^|\s)(--watch|-w|--watchAll)(\s|$)/.test(b) || /\bwatch\b/i.test(b)) return { use: false, why: 'it watches for changes and never ends' }
  if ((b.match(/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+/g) ?? []).length >= 2) return { use: false, why: 'it runs several other scripts; the test scripts among them are found on their own' }
  return { use: true, why: `package.json has a "${name}" script` }
}

// Do the words (script name, its line, what the script files say) mean a real window opens?
export const opensWindows = (text) => WINDOW_RE.test(text)
// The env variables a script reads to stay hidden, e.g. PLUME_HIDDEN, ELECTRON_HIDDEN.
export function hiddenVars(text) {
  const out = new Set()
  for (const m of String(text).matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,40}HIDDEN|HEADLESS)\b/g)) out.add(m[1])
  return [...out].slice(0, 3)
}

function packageManager(dir) {
  const has = (f) => existsSync(join(dir, f))
  return has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
}
const prefixArgs = (pm, rel) => (!rel ? [] : pm === 'npm' ? ['--prefix', rel] : pm === 'pnpm' ? ['--dir', rel] : ['--cwd', rel])
const scriptArgs = (pm, rel, name) => [...prefixArgs(pm, rel), 'run', name]

// "Already run by a bundled check?" Same program and first argument, ignoring --prefix/--dir/--cwd.
export function keyOf(cmd, args = []) {
  const a = [...args]
  if (JS_TOOLS.includes(cmd) && ['--prefix', '--dir', '--cwd', '-C'].includes(a[0])) a.splice(0, 2)
  return runKey(cmd, a)
}
const basenames = (args) => args.map((x) => fwd(x).split('/').pop()).filter((x) => FILE_RE.test(x))

// ---- the items ----

function itemFor({ id, title, script, source, why, cmd, args, lane, weight, estSeconds, text, files = [] }) {
  return { id, title, script, source, why, cmd, args, lane, weight, estSeconds, shard: null, env: {}, files: files.map((f) => fwd(f).split('/').pop()), hidden: hiddenVars(text ?? ''), text: '' }
}

function weightFor(name, body) {
  return ALONE_RE.test(`${name} ${body}`) ? 'alone' : 'heavy'
}
function secondsFor(lane, weight) {
  return weight === 'alone' ? 240 : lane === 'windows' ? 150 : 90
}

// One package.json: its test scripts.
function packageItems(root, rel, ctx, out) {
  const pkg = readJson(join(root, 'package.json'))
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {}
  const pm = packageManager(root)
  const tag = rel ? `${slug(rel.split('/').pop())}-` : ''
  const used = []
  const wanted = Object.entries(scripts).filter(([, body]) => typeof body === 'string')
  for (const [name, body] of wanted) {
    const shardCfg = ctx.shards.find((s) => s.script === name)
    const c = classifyScript(name, body)
    if (!c.use && !shardCfg) {
      if (WANT_RE.test(name)) out.skipped.push({ what: `${rel ? `${rel}: ` : ''}script "${clean(name)}"`, why: c.why })
      continue
    }
    const files = ctx.noCode ? [] : filesIn(body, root)
    const sniffed = ctx.noCode ? '' : files.map((f) => sniffFile(root, f)).join('\n')
    const text = `${name} ${body} ${sniffed}`
    const lane = opensWindows(text) ? 'windows' : 'free'
    const weight = weightFor(name, body)
    const item = itemFor({ id: `found-${tag}${slug(name)}`, title: `Your project's ${clean(name)} (${pm} run ${clean(name)})`, script: name, source: `${rel ? `${rel}/` : ''}package.json (scripts.${clean(name)})`, why: c.why, cmd: pm, args: scriptArgs(pm, rel, name), lane, weight, estSeconds: secondsFor(lane, weight), text, files })
    item.sniffed = !ctx.noCode && files.length > 0
    item.shardable = shardCfg ? { count: shardCfg.count, via: 'config' } : /--shard\b/.test(body) ? { count: ctx.shardCount, via: 'flag' } : /\bSHARDS?\b/.test(body) ? { count: ctx.shardCount, via: 'env' } : null
    used.push({ name, body, files })
    out.items.push(item)
  }
  return { pkg, scripts, pm, used }
}

// Files in a folder (scripts/ or tests/) that look like runnable scripts.
function runnableFiles(root, folder, { wantName, needMain, noCode }) {
  const out = []
  for (const f of names(join(root, folder))) {
    if (!FILE_RE.test(f) || TEST_FILE_RE.test(f) || HELPER_RE.test(f.replace(/\.[^.]+$/, ''))) continue
    if (wantName && !wantName.test(f)) continue
    if (NEEDS_SETUP_RE.test(f)) {
      out.push({ f, skip: 'it needs extra setup (a tool or option) that Meerkat cannot guess' })
      continue
    }
    const text = noCode ? '' : sniffFile(root, join(root, folder, f))
    if (needMain && !noCode && !/process\.exit|require\.main\s*===|^\s*(?:await\s+)?main\(|\.then\(/m.test(text)) {
      out.push({ f, skip: 'it does not look like a script that runs itself' })
      continue
    }
    out.push({ f, text })
  }
  return out
}

function fileItems(root, rel, ctx, out, scriptInfo) {
  const referenced = new Set(scriptInfo.used.flatMap((u) => u.files.map((x) => fwd(relative(root, x)))))
  const prefix = rel ? `${rel}/` : ''
  const tag = rel ? `${slug(rel.split('/').pop())}-` : ''
  const add = (folder, { f, text, skip }, kind, why) => {
    const path = `${folder}/${f}`
    if (referenced.has(path)) return
    if (skip) return out.skipped.push({ what: `${prefix}${path}`, why: skip })
    const lane = opensWindows(`${f} ${text}`) ? 'windows' : 'free'
    const weight = weightFor(f, '')
    const selfShards = /\bSHARDS\b|_SHARDS\b/.test(text ?? '')
    const item = itemFor({ id: `found-${tag}${kind}-${slug(f.replace(FILE_RE, ''))}`, title: `Your project's ${prefix}${path} (node ${prefix}${path})`, script: path, source: `${prefix}${path}`, why, cmd: 'node', args: [`${prefix}${path}`], lane, weight, estSeconds: secondsFor(lane, weight), text })
    item.shardable = /shard/i.test(f) && !selfShards ? { count: ctx.shardCount, via: 'file' } : null
    if (/shard/i.test(f) && selfShards) item.note = 'this script splits itself across windows, so it runs once'
    out.items.push(item)
  }
  for (const r of runnableFiles(root, 'scripts', { wantName: /(click|smoke|e2e|verify|shard)/i, needMain: false, noCode: ctx.noCode })) add('scripts', r, 'script', `scripts/${r.f} is named like a click-through, smoke or verify script`)
  // tests/ runners that no package script points at: only when the project has no test script of its own to point at them.
  if (!scriptInfo.used.length) for (const r of runnableFiles(root, 'tests', { wantName: null, needMain: true, noCode: ctx.noCode })) add('tests', r, 'tests', `tests/${r.f} is a test script that nothing in package.json runs`)
}

function nodeTestItem(root, rel, ctx, out, info) {
  const deps = { ...(info.pkg?.dependencies ?? {}), ...(info.pkg?.devDependencies ?? {}) }
  if (info.scripts?.test || deps.vitest || deps.jest || deps.mocha || deps.ava) return
  const prefix = rel ? `${rel}/` : ''
  const files = []
  for (const dir of ['test', 'tests']) {
    for (const f of names(join(root, dir))) {
      if (!TEST_FILE_RE.test(f) || !/\.(?:c|m)?js$/.test(f)) continue
      const text = ctx.noCode ? "from 'node:test'" : head(root, join(root, dir, f))
      if (/node:test/.test(text)) files.push(`${prefix}${dir}/${f}`)
    }
  }
  if (!files.length) return
  out.items.push({ ...itemFor({ id: `found-${rel ? `${slug(rel.split('/').pop())}-` : ''}node-test`, title: `Your project's node:test files (${files.length})`, script: 'node --test', source: `${prefix}test/ (files that import node:test)`, why: `${files.length} test file(s) use node:test and the project has no test script`, cmd: 'node', args: ['--test', ...files.slice(0, 40)], lane: 'free', weight: 'heavy', estSeconds: 60, text: '' }), shardable: null })
}

function configItems(root, rel, ctx, out, info) {
  const files = names(root)
  const bodies = Object.values(info.scripts ?? {}).filter((b) => typeof b === 'string').join(' ')
  const prefix = rel ? `${rel}/` : ''
  const tag = rel ? `${slug(rel.split('/').pop())}-` : ''
  const mk = (id, title, cmd, args, why) => out.items.push({ ...itemFor({ id: `found-${tag}${id}`, title, script: id, source: `${prefix}${why.split(' ')[0]}`, why, cmd, args: rel ? ['--prefix', rel, ...args] : args, lane: 'windows', weight: 'alone', estSeconds: 240, text: `${id} playwright cypress` }), shardable: null })
  if (files.some((f) => /^playwright\.config\./.test(f)) && !/playwright\s+test/.test(bodies)) mk('playwright', 'Your project\'s Playwright tests (npx playwright test)', 'npx', ['playwright', 'test'], `${files.find((f) => /^playwright\.config\./.test(f))} found`)
  if (files.some((f) => /^cypress\.config\./.test(f)) && !/cypress\s+run/.test(bodies)) mk('cypress', 'Your project\'s Cypress tests (npx cypress run)', 'npx', ['cypress', 'run'], `${files.find((f) => /^cypress\.config\./.test(f))} found`)
  const make = (() => {
    try {
      return readFileSync(join(root, existsSync(join(root, 'Makefile')) ? 'Makefile' : 'makefile'), 'utf8')
    } catch {
      return ''
    }
  })()
  for (const t of ['test', 'check', 'e2e', 'verify', 'smoke']) {
    if (!new RegExp(`^${t}\\s*:`, 'm').test(make)) continue
    out.items.push({ ...itemFor({ id: `found-${tag}make-${t}`, title: `Your project's make ${t}`, script: `make ${t}`, source: `${prefix}Makefile (target ${t})`, why: `the Makefile has a "${t}" target`, cmd: 'make', args: rel ? ['-C', rel, t] : [t], lane: 'free', weight: weightFor(t, ''), estSeconds: 90, text: t }), shardable: null })
  }
}

// ---- sharding ----

// Split a shardable item into N checks. Each gets MEERKAT_SHARD=<i>/<n>; a `--shard` script also gets --shard=<i>/<n>; an env style gets SHARD=<i>/<n>.
export function expandShards(item, { cap, cpuCount }) {
  const s = item.shardable
  if (!s) return [item]
  const limit = item.lane === 'windows' ? cap : Math.max(1, cpuCount - 1)
  const n = Math.min(s.count, limit, 16)
  if (n < 2) return [item]
  return Array.from({ length: n }, (_, k) => {
    const label = `${k + 1}/${n}`
    const dashed = s.via === 'flag' ? ['--', `--shard=${label}`] : []
    return { ...item, id: `${item.id}-shard-${k + 1}`.slice(0, 61), title: `${item.title} shard ${k + 1} of ${n}`, args: [...item.args, ...dashed], weight: item.weight === 'alone' ? 'medium' : item.weight, estSeconds: Math.max(20, Math.round(item.estSeconds / n) + 15), shard: { index: k + 1, count: n }, env: { ...(s.via === 'env' || s.via === 'file' || s.via === 'config' ? { SHARD: label } : {}) } }
  })
}

// ---- the whole thing ----

// Scan a folder. `checks` are the checks already loaded (bundled and yours): a test they already run is not found again.
export function discover(dir, { checks = [], settings = {}, noProjectCode = false, cpuCount = cpus().length } = {}) {
  const set = { maxWindows: DEFAULT_MAX_WINDOWS, shards: [], ...settings }
  const cap = windowCap(set.maxWindows, cpuCount)
  const out = { items: [], skipped: [], notes: [], roots: [] }
  const ctx = { noCode: noProjectCode, shards: set.shards, shardCount: Math.min(DEFAULT_SHARDS, cap) }
  const roots = [{ root: resolve(dir), rel: '' }]
  const rootHasScripts = Boolean(readJson(join(dir, 'package.json'))?.scripts)
  // A monorepo (apps/*, packages/*) with nothing at the top: look one level down.
  if (!rootHasScripts) {
    for (const group of ['apps', 'packages']) for (const sub of names(join(dir, group)).slice(0, 8)) if (existsSync(join(dir, group, sub, 'package.json'))) roots.push({ root: join(dir, group, sub), rel: `${group}/${sub}` })
  }
  for (const { root, rel } of roots) {
    const before = out.items.length
    const info = packageItems(root, rel, ctx, out)
    fileItems(root, rel, ctx, out, info)
    nodeTestItem(root, rel, ctx, out, info)
    configItems(root, rel, ctx, out, info)
    if (out.items.length > before || rel === '') out.roots.push(rel || '.')
  }
  // Drop what a loaded check already runs (same program and first argument, or the same script file), and repeats.
  const covered = new Set()
  const coveredFiles = new Set()
  const ids = new Set(checks.map((c) => c.id))
  for (const c of checks) {
    const r = c?.run && typeof c.run === 'object' ? c.run : null
    if (!r || typeof r.cmd !== 'string') continue
    covered.add(keyOf(r.cmd, r.args ?? []))
    for (const b of basenames(r.args ?? [])) coveredFiles.add(b)
  }
  const kept = []
  const seen = new Set()
  for (const it of out.items) {
    const key = keyOf(it.cmd, it.args)
    const dupFile = it.files.find((b) => coveredFiles.has(b))
    if (covered.has(key) && key !== 'js:') out.skipped.push({ what: it.source, why: 'a check Meerkat already has runs the same command' })
    else if (dupFile) out.skipped.push({ what: it.source, why: `a check Meerkat already has runs ${dupFile}` })
    else if (ids.has(it.id) || seen.has(it.id) || seen.has(key)) out.skipped.push({ what: it.source, why: 'already listed' })
    else {
      seen.add(it.id)
      seen.add(key)
      kept.push(it)
    }
  }
  const limited = kept.slice(0, MAX_ITEMS)
  if (kept.length > limited.length) out.notes.push(`found ${kept.length} tests; only the first ${MAX_ITEMS} are used`)
  out.items = limited.flatMap((it) => expandShards(it, { cap, cpuCount }))
  out.maxWindows = cap
  return out
}

// ---- items -> checks the runner understands ----

export function itemToCheck(it, { known = new Set() } = {}) {
  const v = validateEntry({ id: it.id, title: it.title, cmd: it.cmd, args: it.args, suite: FOUND_SUITE, group: 'functionality', tier: 'thorough', timeoutSeconds: 900, estSeconds: it.estSeconds, weight: it.weight, needs: [it.cmd], install: `install ${it.cmd}` }, { known })
  if (v.error) return { error: `${it.id}: ${v.error}` }
  const c = entryToCheck(v.entry, { origin: 'discovered', source: `found in ${it.source}`, where: { kind: 'discovered', file: null } })
  const env = { MEERKAT_SHARD: it.shard ? `${it.shard.index}/${it.shard.count}` : '1/1', ...it.env }
  if (it.lane === 'windows') {
    env.HEADLESS = '1'
    env.CI = '1'
    for (const h of it.hidden) env[h] = '1'
    c.lane = 'windows'
    // Shards run side by side, so one shard must not claim the whole machine.
    if (it.shard) c.cost = { cpu: 2, memGB: 1.5 }
  }
  c.run = { ...c.run, env }
  c.found = true
  return { check: c }
}

// Register the suite the found checks sit under, next to the project's own.
export function registerFoundSuite() {
  const list = projectSuites().filter((s) => s.id !== FOUND_SUITE)
  setProjectSuites([...list, { id: FOUND_SUITE, label: 'Found in your project', purpose: "The project's own tests, found without being told." }])
}

// Everything the wiring needs: settings in, checks out. `existing` are the checks already loaded.
export function discoverChecks(dir, { existing = [], project, personal, noProjectCode = false, cpuCount } = {}) {
  const settings = mergeSettings(project, personal)
  if (!settings.enabled) return { enabled: false, settings, checks: [], result: { items: [], skipped: [], notes: [], roots: [] } }
  const result = discover(dir, { checks: existing, settings, noProjectCode, ...(cpuCount ? { cpuCount } : {}) })
  const known = new Set(existing.map((c) => c.id))
  const checks = []
  for (const it of result.items) {
    const r = itemToCheck(it, { known })
    if (r.error) result.notes.push(r.error)
    else {
      known.add(it.id)
      checks.push(r.check)
    }
  }
  if (checks.length) registerFoundSuite()
  return { enabled: true, settings, checks, result }
}

// ---- what `meerkat discover` shows ----

export function discoverRows(result) {
  return result.items.map((it) => ({ id: it.id, title: clean(it.title), script: clean(it.script), source: clean(it.source), why: clean(it.why), command: [it.cmd, ...it.args].join(' '), lane: it.lane, weight: it.weight, estimateSeconds: it.estSeconds, shard: it.shard, note: it.note ? clean(it.note) : null }))
}

export function discoverText(data, folder) {
  if (!data.enabled) return `Discovery is turned off for ${folder} ("discover": false).\nNothing is found or run. Remove that line to turn it back on.`
  if (!data.items.length) return `Meerkat found no tests of its own to add in ${folder}.${data.skipped.length ? `\nLeft out (${data.skipped.length}):\n${data.skipped.map((s) => `  ${s.what}: ${s.why}`).join('\n')}` : ''}`
  const w = Math.max(...data.items.map((i) => i.id.length))
  const lines = [`${data.items.length} test${data.items.length === 1 ? '' : 's'} found in ${folder} (nothing was run)`, `They run with: meerkat full, thorough and release, or: meerkat check discovered`, `Window cap: ${data.maxWindows} at once`, '']
  for (const i of data.items) {
    lines.push(`${i.id.padEnd(w)}  found  ${i.lane.padEnd(7)} ${i.weight.padEnd(6)} about ${i.estimateSeconds}s`, `${' '.repeat(w)}  runs:  ${i.command}`, `${' '.repeat(w)}  from:  ${i.source}`, `${' '.repeat(w)}  why:   ${i.why}${i.shard ? ` (shard ${i.shard.index} of ${i.shard.count})` : ''}${i.note ? ` (${i.note})` : ''}`)
  }
  if (data.skipped.length) lines.push('', `Left out (${data.skipped.length}):`, ...data.skipped.map((s) => `  ${s.what}: ${s.why}`))
  lines.push('', 'Turn it off: "discover": false in meerkat.config.json. Split a script into shards: "discover": { "shards": { "script": "test:clicks", "count": 3 } }')
  return lines.join('\n')
}
