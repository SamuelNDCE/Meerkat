// Questions the code map answers directly, each printing one table at most:
//   meerkat who-calls <symbol>    file:line of each call site of a function or method named <symbol>
//   meerkat deps <file>           the files <file> imports, resolved (an alias import shows the alias it went through)
//   meerkat tests-for <file>      the test files that import <file> or name it
// They read the code map (lib/codemap.mjs, kept current by lib/mapsync.mjs) and never re-parse the code; who-calls and tests-for read
// the text of the mapped files only to find the names the map does not index.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { EXIT_NOT_FOUND } from './blast.mjs'
import { repoRootOf } from './paths.mjs'
import { syncCodemap } from './mapsync.mjs'
import { maskJs, maskPy } from './codemap.mjs'
import { TEST_RE } from './refactorctx.mjs'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')
const clip = (s, n = 110) => (s.length > n ? s.slice(0, n - 3) + '...' : s)

function readText(appDir, path) {
  try {
    return readFileSync(join(appDir, path), 'utf8')
  } catch {
    return null
  }
}

const mask = (text, language) => (language === 'python' ? maskPy(text) : language === 'powershell' ? text : maskJs(text))

const IMPORT_LINE = /^\s*(?:import\b|export\b[^=]*\bfrom\b|from\s+\S+\s+import\b|use\s|mod\s)|\brequire\s*\(|^\s*(?:const|let|var)\s+[^=]*=\s*(?:await\s+)?import\s*\(/

// Every call site of `symbol`: a use followed by "(" that is not a declaration of it and not on an import line.
export function findCalls(map, appDir, symbol, readFile = (p) => readText(appDir, p)) {
  const word = new RegExp(`(?<![\\w$])${esc(symbol)}\\s*\\(`)
  const decl = new RegExp(`(?:\\b(?:function|def|fn|func|class)\\s*\\*?\\s*${esc(symbol)}\\b)|^\\s*(?:(?:public|private|protected|static|async|get|set)\\s+)*\\*?${esc(symbol)}\\s*\\([^)]*\\)\\s*(?::[^{=]+)?\\{\\s*$`)
  const hits = []
  let searched = 0
  for (const f of map.files) {
    const text = readFile(f.path)
    if (text === null) continue
    searched++
    if (!text.includes(symbol)) continue
    const lines = mask(text, f.language).split('\n')
    const raw = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!word.test(lines[i]) || IMPORT_LINE.test(lines[i]) || decl.test(lines[i])) continue
      hits.push({ file: f.path, line: i + 1, text: clip(raw[i].trim()) })
    }
  }
  return { hits, searched }
}

const fileOf = (map, file) => map.files.find((f) => f.path === norm(file))

// The working tree first: the map is refreshed from the files on disk before every question (lib/mapsync.mjs), so a file added on this branch is in it.
// A path may be given from the repository root while the project is a sub-folder; it is tried both ways. Returns { map, note, path }.
export function loadMap(appDir, file, { env = process.env } = {}) {
  const s = syncCodemap(appDir, { env })
  const notes = []
  const head = s.map.build?.commit ?? null
  const was = s.saved?.commit ?? null
  if (was && head && was !== head) {
    const d = spawnSync('git', ['-C', appDir, 'diff', '--name-only', was, head], { encoding: 'utf8', timeout: 20000 })
    const n = d.status === 0 ? d.stdout.split('\n').filter(Boolean).length : s.refreshed.length
    notes.push(`map: the last saved map is from commit ${was.slice(0, 9)}, HEAD is ${head.slice(0, 9)}, ${n} file${n === 1 ? '' : 's'} differ; this answer uses the working tree (${s.refreshed.length} re-read now)`)
  } else if (s.refreshed.length) notes.push(`map: re-read ${s.refreshed.length} changed file${s.refreshed.length === 1 ? '' : 's'} from the working tree first`)
  let path = file === undefined ? undefined : norm(file)
  if (path !== undefined && !fileOf(s.map, path)) {
    const root = repoRootOf(appDir)
    const rel = norm(relative(resolve(appDir), resolve(root, path)))
    if (rel && !rel.startsWith('..') && fileOf(s.map, rel)) path = rel
  }
  return { map: s.map, notes, path }
}

// Why a file that is on disk is still not in the map, or '' when it is not on disk either.
function absentReason(appDir, file) {
  try {
    const st = statSync(join(appDir, norm(file)))
    if (!st.isFile()) return ''
    return ' The file exists in the working tree, so the map left it out on purpose (an ignored folder, a file over 1 MB or a type the map does not read).'
  } catch {
    return ''
  }
}

// The imports of a file that resolve to a file in the project.
export function depsOf(map, file) {
  const f = fileOf(map, file)
  if (!f) return null
  const rows = []
  let other = 0
  for (const i of f.imports) {
    const r = i.resolution ?? {}
    if (r.status === 'local' && r.target) {
      const via = r.alias ?? r.via ?? r.aliasFrom ?? r.matchedAlias ?? null
      rows.push({ line: i.line, spec: i.spec, target: r.target, via: via ? (typeof via === 'string' ? via : JSON.stringify(via)) : null })
    } else other++
  }
  return { file: f.path, rows, other }
}

// Test files that import `file` (direct import in the map) or whose text names it (its path, or its file name without the extension as a word).
export function testsFor(map, appDir, file, readFile = (p) => readText(appDir, p)) {
  const target = norm(file)
  const stem = posix.basename(target).replace(/\.[^.]+$/, '')
  const nameRe = stem.length >= 3 ? new RegExp(`(?<![\\w$])${esc(stem)}(?![\\w$])`) : null
  const rows = []
  let tests = 0
  for (const f of map.files) {
    if (!TEST_RE.test(f.path) || f.path === target) continue
    tests++
    const imp = f.imports.find((i) => i.resolution?.status === 'local' && i.resolution.target === target)
    if (imp) {
      rows.push({ file: f.path, line: imp.line, how: 'imports it' })
      continue
    }
    const text = readFile(f.path)
    if (text === null) continue
    const lines = text.split('\n')
    const at = lines.findIndex((l) => l.includes(target) || (nameRe && nameRe.test(l)))
    if (at >= 0) rows.push({ file: f.path, line: at + 1, how: 'names it' })
  }
  return { rows, tests }
}

const table = (head, rows) => {
  const all = [head, ...rows]
  const w = head.map((_, c) => Math.max(...all.map((r) => String(r[c]).length)))
  return all.map((r) => r.map((v, c) => String(v).padEnd(w[c])).join('  ').trimEnd()).join('\n')
}

function setup(word, argv, { cwd, err, usage }) {
  let app = null
  let json = false
  let target = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') {
      app = argv[++i]
      if (!app) return { code: (err(`${word}: --app needs a folder`), 2) }
    } else if (a === '--json') json = true
    else if (a.startsWith('--')) return { code: (err(`${word}: unknown option ${a.slice(0, 60)}. Use: ${usage}`), 2) }
    else if (target === null) target = a
    else return { code: (err(`${word}: give one target. Use: ${usage}`), 2) }
  }
  if (!target) return { code: (err(`${word}: say what to look up. Use: ${usage}`), 2) }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) return { code: (err(`${word}: ${app ?? '.'} is not a folder`), 2) }
  return { appDir, json, target }
}

export function runWhoCalls(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const usage = 'meerkat who-calls <symbol> [--app <folder>] [--json]'
  const s = setup('who-calls', argv, { cwd, err, usage })
  if (s.code) return s.code
  const symbol = s.target.split('.').pop()
  if (!/^[\w$]+$/.test(symbol)) {
    err(`who-calls: "${s.target.slice(0, 60)}" is not a function or method name (letters, digits, _ and $)`)
    return 2
  }
  const { map, notes } = loadMap(s.appDir, undefined, { env })
  for (const n of notes) err(n)
  const { hits, searched } = findCalls(map, s.appDir, symbol)
  if (s.json) out(JSON.stringify({ symbol, searched, calls: hits }, null, 2))
  else if (!hits.length) out(`who-calls: no call of ${symbol}( found. Searched the text of ${searched} mapped files for "${symbol}(" outside import lines, comments, strings and its own declaration.`)
  else out(`${hits.length} call site${hits.length === 1 ? '' : 's'} of ${symbol}\n${table(['CALL SITE', 'CODE'], hits.map((h) => [`${h.file}:${h.line}`, h.text]))}`)
  return hits.length ? 0 : EXIT_NOT_FOUND
}

export function runDeps(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const usage = 'meerkat deps <file> [--app <folder>] [--json]'
  const s = setup('deps', argv, { cwd, err, usage })
  if (s.code) return s.code
  const { map, notes, path } = loadMap(s.appDir, s.target, { env })
  for (const n of notes) err(n)
  const d = depsOf(map, path)
  if (!d) {
    out(`deps: ${norm(s.target)} is not in the code map. Searched ${map.files.length} mapped files for that path (it is relative to the project folder).${absentReason(s.appDir, path)}`)
    return EXIT_NOT_FOUND
  }
  if (s.json) out(JSON.stringify(d, null, 2))
  else if (!d.rows.length) out(`deps: ${d.file} imports no project file${d.other ? ` (${d.other} external or unresolved imports are not listed; meerkat blast shows them)` : ''}.`)
  else out(`${d.file} imports ${d.rows.length} project file${d.rows.length === 1 ? '' : 's'}\n${table(['LINE', 'IMPORT', 'RESOLVES TO', 'VIA'], d.rows.map((r) => [r.line, r.spec, r.target, r.via ? `alias ${r.via}` : '']))}${d.other ? `\n(${d.other} external or unresolved imports are not listed; meerkat blast shows them)` : ''}`)
  return d.rows.length ? 0 : EXIT_NOT_FOUND
}

export function runTestsFor(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const usage = 'meerkat tests-for <file> [--app <folder>] [--json]'
  const s = setup('tests-for', argv, { cwd, err, usage })
  if (s.code) return s.code
  const { map, notes, path } = loadMap(s.appDir, s.target, { env })
  for (const n of notes) err(n)
  if (!fileOf(map, path)) {
    out(`tests-for: ${norm(s.target)} is not in the code map. Searched ${map.files.length} mapped files for that path (it is relative to the project folder).${absentReason(s.appDir, path)}`)
    return EXIT_NOT_FOUND
  }
  const { rows, tests } = testsFor(map, s.appDir, path)
  if (s.json) out(JSON.stringify({ file: path, tests, rows }, null, 2))
  else if (!rows.length) out(`tests-for: no test imports or names ${norm(s.target)}. Searched ${tests} test files (by import in the map, then by the path or the file name in their text).`)
  else out(`${rows.length} test file${rows.length === 1 ? '' : 's'} for ${norm(s.target)}\n${table(['TEST FILE', 'LINE', 'HOW'], rows.map((r) => [r.file, r.line, r.how]))}`)
  return rows.length ? 0 : EXIT_NOT_FOUND
}
