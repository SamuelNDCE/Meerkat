// A map of a codebase for an AI (or a person) to read before refactoring it: `meerkat map --app <dir>`.
// Writes codemap.json (machine-readable, schema version 2) and codemap.md (what an AI reads first) into the run folder.
// The per-file facts are cached by content hash (lib/mapsync.mjs), so a second run re-parses only the files that changed.
// Parsing is regular expressions over comment-masked text. No dependencies, no network, nothing is run or imported.
// Anything the parser cannot resolve to a file is marked "unresolved" with a reason; it is never guessed.
import { createHash } from 'node:crypto'
import { builtinModules } from 'node:module'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'
import { refactorCtx, TEST_RE } from './refactorctx.mjs'
import { gitHead } from './githead.mjs'
import { extractPurpose, extractRoutes, extractSymbols } from './mapparse.mjs'

export { runMap } from './mapsync.mjs'

export const SCHEMA_VERSION = 2
export const MAX_FILES = 5000
export const MAX_FILE_BYTES = 1_000_000
export const TOP_IMPORTED = 20
const MAX_MODULE_EDGE_SAMPLES = 50

const IGNORE_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.next', '.nuxt', '.turbo', '.cache', 'graphify-out', 'target', 'vendor', '.meerkat'])
const LANG_BY_EXT = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.py': 'python' }
const JS_RESOLVE_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json']
const TS_SWAP = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] }
const CONTAINER_DIRS = new Set(['src', 'lib', 'app', 'apps', 'packages'])
const ENTRY_NAMES = new Set(['index', 'main', 'app', 'server', 'cli', '__main__', 'manage', 'run', 'start'])
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')))

const extOf = (p) => {
  const b = posix.basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

// ---- masking: comments (and string contents where they could hide fake code) become spaces, newlines and offsets stay ----

const blank = (s) => s.replace(/[^\n]/g, ' ')

// JavaScript and TypeScript: comments and template literal bodies are blanked; ' and " strings are kept (import specifiers live there).
// Limit: a regular expression literal that contains a quote or a comment marker can confuse the scanner.
export function maskJs(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '/' && d === '/') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '/' && d === '*') {
      let j = text.indexOf('*/', i + 2)
      j = j < 0 ? n : j + 2
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      out += text.slice(i, j)
      i = j
    } else if (c === '`') {
      let j = i + 1
      while (j < n && text[j] !== '`') j += text[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      out += `\`${blank(text.slice(i + 1, j - 1))}\``.slice(0, j - i)
      i = j
    } else {
      out += c
      i += 1
    }
  }
  return out
}

// Python: comments and all string contents (including docstrings) are blanked.
export function maskPy(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '#') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      let j = i + q.length
      while (j < n && !text.startsWith(q, j)) {
        if (!triple && text[j] === '\n') break
        j += text[j] === '\\' ? 2 : 1
      }
      j = Math.min(text.startsWith(q, j) ? j + q.length : j, n)
      out += blank(text.slice(i, j))
      i = j
    } else {
      out += c
      i += 1
    }
  }
  return out
}

// ---- line lookup ----

function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

const countLines = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

// ---- extraction ----

const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n)}...` : s)

// Raw imports of a JS or TS file: { kind, spec, line, literal }. literal false means the specifier is an expression.
export function extractJsImports(text) {
  const masked = maskJs(text)
  const lineOf = lineIndex(masked)
  const found = []
  const add = (re, kind, literal = true) => {
    for (const m of masked.matchAll(re)) found.push({ kind, spec: literal ? m[2] : clip(m[1].trim().replace(/\s+/g, ' ')), line: lineOf(m.index), literal, at: m.index })
  }
  add(/(?<![.\w$])import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?(['"])([^'"\n]+)\1/g, 'static')
  add(/(?<![.\w$])export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g, 'reexport')
  add(/(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, 'require')
  add(/(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, 'dynamic')
  add(/(?<![.\w$])import\s*\(\s*(?!['"])([^)]+)\)/g, 'dynamic', false)
  add(/(?<![.\w$]|function\s+)require\s*\(\s*(?!['"])([^)]+)\)/g, 'require', false)
  return found.sort((a, b) => a.at - b.at)
}

export function extractJsExports(text) {
  const masked = maskJs(text)
  const names = new Set()
  if (/(?<![.\w$])export\s+default\b/.test(masked)) names.add('default')
  for (const m of masked.matchAll(/(?<![.\w$])export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|class|abstract\s+class|const|let|var|interface|type|enum|namespace)\s+([\w$]+)/g)) names.add(m[1])
  for (const m of masked.matchAll(/(?<![.\w$])export\s*\{([^}]*)\}(\s*from\s*['"][^'"\n]+['"])?/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '')
      if (!t) continue
      const name = t.split(/\s+as\s+/).pop().trim()
      if (/^[\w$]+$/.test(name)) names.add(name)
    }
  }
  for (const m of masked.matchAll(/(?<![.\w$])export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"]([^'"\n]+)['"]/g)) names.add(m[1] ?? `* from ${m[2]}`)
  const cjs = masked.match(/(?<![.\w$])module\.exports\s*=\s*(\{[^}]*\})?/)
  if (cjs) {
    names.add('module.exports')
    if (cjs[1]) for (const part of cjs[1].slice(1, -1).split(',')) {
      const k = part.match(/^\s*([\w$]+)\s*(?::|$)/)
      if (k) names.add(k[1])
    }
  }
  for (const m of masked.matchAll(/(?<![.\w$])(?:module\.)?exports\.([\w$]+)\s*=/g)) names.add(m[1])
  return [...names].sort()
}

// Python: { kind: 'import' | 'from', module, dots, names, line }
export function extractPyImports(text) {
  const masked = maskPy(text)
  const lineOf = lineIndex(masked)
  const found = []
  for (const m of masked.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm)) {
    const names = m[3].replace(/[()]/g, ' ').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
    found.push({ kind: 'from', dots: m[1].length, module: m[2], names, line: lineOf(m.index + m[0].indexOf('from')), at: m.index })
  }
  for (const m of masked.matchAll(/^[ \t]*import[ \t]+([^\n;]+)/gm)) {
    for (const part of m[1].split(',')) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[\w.]+$/.test(mod)) found.push({ kind: 'import', dots: 0, module: mod, names: [], line: lineOf(m.index + m[0].indexOf('import')), at: m.index })
    }
  }
  return found.sort((a, b) => a.at - b.at)
}

export function extractPyExports(text) {
  const masked = maskPy(text)
  const names = new Set()
  for (const m of masked.matchAll(/^(?:async[ \t]+def|def|class)[ \t]+([A-Za-z]\w*)/gm)) names.add(m[1])
  for (const m of masked.matchAll(/^([A-Za-z]\w*)[ \t]*(?::[^=\n]+)?=(?!=)/gm)) names.add(m[1])
  return [...names].sort()
}

// ---- resolution ----

function jsCandidates(base) {
  const out = [base]
  const ext = extOf(base)
  if (TS_SWAP[ext]) for (const e of TS_SWAP[ext]) out.push(base.slice(0, -ext.length) + e)
  for (const e of JS_RESOLVE_EXT) out.push(base + e)
  for (const e of JS_RESOLVE_EXT) out.push(`${base}/index${e}`)
  return out
}

export function resolveJsSpec(fromPath, spec, has) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = spec.startsWith('/') ? null : posix.normalize(posix.join(posix.dirname(fromPath), spec))
    if (base === null) return { status: 'unresolved', target: null, reason: 'absolute path, not followed' }
    if (base === '..' || base.startsWith('../')) return { status: 'unresolved', target: null, reason: 'points outside the app folder' }
    for (const c of jsCandidates(base)) if (has(c)) return { status: 'local', target: c }
    return { status: 'unresolved', target: null, reason: 'no matching file under the app folder' }
  }
  const bare = spec.replace(/^node:/, '')
  if (spec.startsWith('node:') || BUILTINS.has(bare.split('/')[0])) return { status: 'external', target: null, package: bare.split('/')[0], reason: 'node builtin' }
  if (/^[@~#]\//.test(spec) || spec.startsWith('#')) return { status: 'unresolved', target: null, reason: 'alias or package imports map, not followed' }
  const parts = spec.split('/')
  return { status: 'external', target: null, package: spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], reason: 'package name' }
}

function pyModuleFile(modPath, has) {
  for (const c of [`${modPath}.py`, `${modPath}/__init__.py`]) if (has(c)) return c
  return null
}

// One Python import statement becomes one or more resolutions (a from-import can reach the package and several submodules).
export function resolvePyImport(fromPath, imp, has) {
  const dir = posix.dirname(fromPath) === '.' ? '' : posix.dirname(fromPath)
  const join2 = (a, b) => [a, b].filter(Boolean).join('/')
  const modRel = imp.module.split('.').filter(Boolean).join('/')
  let bases
  let how = null
  if (imp.dots > 0) {
    let d = dir
    for (let k = 1; k < imp.dots; k++) d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''
    if (imp.dots - 1 > dir.split('/').filter(Boolean).length) return [{ status: 'unresolved', target: null, reason: 'relative import climbs above the app folder', spec: '.'.repeat(imp.dots) + imp.module }]
    bases = [join2(d, modRel)]
  } else {
    bases = [modRel, join2(dir, modRel)]
    how = ['root', 'importing file folder']
  }
  const spec = '.'.repeat(imp.dots) + imp.module
  for (let b = 0; b < bases.length; b++) {
    const base = bases[b]
    const via = how ? how[b] : null
    const out = []
    const mod = base === '' ? (has('__init__.py') ? '__init__.py' : null) : pyModuleFile(base, has)
    if (mod) out.push({ status: 'local', target: mod, spec, ...(via === 'importing file folder' ? { note: 'resolved against the importing file folder (script-style import)' } : {}) })
    if (imp.kind === 'from') {
      for (const name of imp.names) {
        if (name === '*') continue
        const sub = pyModuleFile(join2(base, name), has)
        if (sub && sub !== mod) out.push({ status: 'local', target: sub, spec: `${spec}.${name}`, ...(via === 'importing file folder' ? { note: 'resolved against the importing file folder (script-style import)' } : {}) })
      }
    }
    if (out.length > 0) return out
  }
  return [{ status: 'unresolved', target: null, reason: 'no matching module under the app folder (standard library, installed package, or missing)', spec }]
}

// ---- walking ----

function walk(root) {
  const files = []
  const skipped = []
  const visit = (rel) => {
    let entries
    try {
      entries = readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })
    } catch {
      skipped.push({ path: rel || '.', reason: 'folder could not be read' })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of entries) {
      const p = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) visit(p)
      } else if (e.isFile()) {
        files.push(p)
      }
    }
  }
  visit('')
  return { files, skipped }
}

// ---- the map ----

function moduleOf(path) {
  const parts = path.split('/')
  if (parts.length === 1) return '.'
  if (CONTAINER_DIRS.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`
  return parts[0]
}

function lineOfKey(text, key) {
  const i = text.indexOf(`"${key}"`)
  return i < 0 ? null : text.slice(0, i).split('\n').length
}

function packageEntries(pkgPath, text, has) {
  let pkg
  try {
    pkg = JSON.parse(text)
  } catch {
    return [{ id: `${pkgPath}#unreadable`, kind: 'package-unreadable', name: null, file: null, status: 'unresolved', reason: 'package.json is not valid JSON', source: { file: pkgPath, line: 1 } }]
  }
  if (!pkg || typeof pkg !== 'object') return []
  const dir = posix.dirname(pkgPath) === '.' ? '' : posix.dirname(pkgPath)
  const rel = (v) => posix.normalize(posix.join(dir, String(v)))
  const fileFor = (v) => {
    const base = rel(v)
    for (const c of jsCandidates(base)) if (has(c)) return c
    return null
  }
  const out = []
  const push = (kind, name, key, value) => {
    const file = typeof value === 'string' ? fileFor(value) : null
    out.push({ id: `${pkgPath}#${kind}${name ? `:${name}` : ''}`, kind, name, value: typeof value === 'string' ? value : null, file, status: file ? 'local' : 'unresolved', ...(file ? {} : { reason: 'no matching file under the app folder' }), source: { file: pkgPath, line: lineOfKey(text, key) ?? 1 } })
  }
  if (typeof pkg.main === 'string') push('package-main', null, 'main', pkg.main)
  if (typeof pkg.module === 'string') push('package-module', null, 'module', pkg.module)
  if (typeof pkg.bin === 'string') push('package-bin', pkg.name ?? 'bin', 'bin', pkg.bin)
  else if (pkg.bin && typeof pkg.bin === 'object') for (const k of Object.keys(pkg.bin).sort()) push('package-bin', k, k, pkg.bin[k])
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const k of Object.keys(pkg.scripts).sort()) {
      const cmd = String(pkg.scripts[k])
      const tok = cmd.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).find((t) => /\.(?:[cm]?[jt]sx?|py)$/.test(t) && !t.startsWith('-'))
      if (!tok) {
        out.push({ id: `${pkgPath}#package-script:${k}`, kind: 'package-script', name: k, value: cmd, file: null, status: 'command-only', source: { file: pkgPath, line: lineOfKey(text, k) ?? 1 } })
        continue
      }
      const file = has(rel(tok)) ? rel(tok) : null
      out.push({ id: `${pkgPath}#package-script:${k}`, kind: 'package-script', name: k, value: cmd, file, status: file ? 'local' : 'unresolved', ...(file ? {} : { reason: `script names ${tok} but no such file under the app folder` }), source: { file: pkgPath, line: lineOfKey(text, k) ?? 1 } })
    }
  }
  return out
}

// ---- per-file facts (what the incremental cache stores) ----

export const PARSER_REV = 1 // bump when extraction changes, so cached per-file facts from an older parser are dropped
const hashOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 20)
const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const isTestPath = (p) => TEST_RE.test(p)

// Everything the map needs from one source file, with imports still unresolved (resolution needs the whole file list).
export function parseSource(path, text, language) {
  const python = language === 'python'
  const rawImports = (python ? extractPyImports(text) : extractJsImports(text)).map(({ at, ...rest }) => rest)
  const specs = python ? rawImports.map((i) => '.'.repeat(i.dots) + i.module) : rawImports.filter((i) => i.literal).map((i) => i.spec)
  const r = extractRoutes(path, text, language, specs, { isTest: isTestPath(path) })
  const rec = {
    language,
    lines: countLines(text),
    purpose: extractPurpose(text, language),
    exports: python ? extractPyExports(text).filter((n) => !n.startsWith('_')) : extractJsExports(text),
    symbols: extractSymbols(text, language),
    rawImports,
    routes: r.routes,
    frameworks: r.frameworks,
    seenOnly: r.seenOnly,
    shebang: /^#!.*\b(?:node|python[0-9.]*|deno|bun|tsx)\b/.test(text.split('\n', 1)[0] ?? ''),
  }
  if (python) {
    const m = text.match(/^if[ \t]+__name__[ \t]*==[ \t]*['"]__main__['"]/m)
    if (m) rec.pyMainLine = text.slice(0, m.index).split('\n').length
  }
  return rec
}

// Walk the folder, then reuse the cached facts of every file whose size and modification time are unchanged. A file that does look
// different is read and hashed: the same hash (a touch, a checkout) keeps its facts, a new hash is parsed again. With parse false
// nothing is parsed (used by `meerkat map --check`): changed files are only hashed.
// prev is a Map of path -> { size, mtimeMs, hash, rec } or null. Returns the entries for this run and what changed.
export function scanFiles(root, prev = null, { parse = true } = {}) {
  const { files: walked, skipped } = walk(root)
  const allPaths = walked.sort(sortStr)
  const sourcePaths = allPaths.filter((p) => LANG_BY_EXT[extOf(p)])
  const wanted = [...sourcePaths.slice(0, MAX_FILES), ...allPaths.filter((p) => posix.basename(p) === 'package.json')]
  for (const p of sourcePaths.slice(MAX_FILES)) skipped.push({ path: p, reason: `more than ${MAX_FILES} source files, the rest are not mapped` })
  const entries = new Map()
  const refreshed = []
  const stale = []
  let touched = false
  for (const p of wanted) {
    let st
    try {
      st = statSync(join(root, p))
    } catch {
      skipped.push({ path: p, reason: 'file could not be read' })
      continue
    }
    if (st.size > MAX_FILE_BYTES) {
      skipped.push({ path: p, reason: `larger than ${MAX_FILE_BYTES} bytes` })
      continue
    }
    const old = prev?.get(p)
    if (old && old.size === st.size && old.mtimeMs === st.mtimeMs && (old.rec || !parse)) {
      entries.set(p, old)
      continue
    }
    let buf
    try {
      buf = readFileSync(join(root, p))
    } catch {
      skipped.push({ path: p, reason: 'file could not be read' })
      continue
    }
    const hash = hashOf(buf)
    if (old && old.hash === hash && (old.rec || !parse)) {
      entries.set(p, { ...old, size: st.size, mtimeMs: st.mtimeMs })
      touched = true
      continue
    }
    stale.push({ path: p, reason: old ? 'changed' : 'new' })
    if (!parse) {
      entries.set(p, { size: st.size, mtimeMs: st.mtimeMs, hash, rec: null })
      continue
    }
    const text = buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    const rec = posix.basename(p) === 'package.json' && !LANG_BY_EXT[extOf(p)] ? { pkg: text } : parseSource(p, text, LANG_BY_EXT[extOf(p)])
    entries.set(p, { size: st.size, mtimeMs: st.mtimeMs, hash, rec })
    refreshed.push(p)
  }
  const removed = prev ? [...prev.keys()].filter((p) => !entries.has(p) && !skipped.some((s) => s.path === p)).sort(sortStr) : []
  for (const p of removed) stale.push({ path: p, reason: 'removed' })
  return { entries, allPaths, skipped, refreshed, removed, stale: stale.sort((a, b) => sortStr(a.path, b.path)), touched }
}

// ---- the map ----

function resolveImports(p, rec, hasFile, edgeSeq) {
  const imports = []
  const nextId = (line) => {
    const k = `${p}#${line}`
    const n = edgeSeq.get(k) ?? 0
    edgeSeq.set(k, n + 1)
    return `${k}.${n}`
  }
  if (rec.language === 'python') {
    for (const imp of rec.rawImports) {
      const spec = '.'.repeat(imp.dots) + imp.module
      for (const r of resolvePyImport(p, imp, hasFile)) imports.push({ id: nextId(imp.line), line: imp.line, kind: imp.kind === 'from' ? 'py-from' : 'py-import', spec: r.spec ?? spec, resolution: strip(r, ['spec']) })
    }
  } else {
    for (const imp of rec.rawImports) {
      const resolution = imp.literal ? resolveJsSpec(p, imp.spec, hasFile) : { status: 'unresolved', target: null, reason: 'specifier is not a string literal' }
      imports.push({ id: nextId(imp.line), line: imp.line, kind: imp.kind, spec: imp.spec, resolution })
    }
  }
  return imports
}

function entryPointsOf(files, entries, hasFile) {
  const out = []
  for (const [p, e] of entries) if (e.rec?.pkg !== undefined) out.push(...packageEntries(p, e.rec.pkg, hasFile))
  for (const f of files) {
    const rec = entries.get(f.path).rec
    const base = posix.basename(f.path).replace(/\.[^.]+$/, '')
    const depth = f.path.split('/').length - 1
    if (ENTRY_NAMES.has(base) && depth <= 1) out.push({ id: `${f.path}#convention`, kind: 'convention', name: base, file: f.path, status: 'local', source: { file: f.path, line: 1 } })
    if (rec.shebang) out.push({ id: `${f.path}#shebang`, kind: 'shebang', name: base, file: f.path, status: 'local', source: { file: f.path, line: 1 } })
    if (rec.pyMainLine) out.push({ id: `${f.path}#python-main`, kind: 'python-main', name: base, file: f.path, status: 'local', source: { file: f.path, line: rec.pyMainLine } })
  }
  return out.sort((a, b) => sortStr(a.id, b.id))
}

// The map from scanned entries. Pure: no clock, no git, no disk. `build` is added by withBuild.
export function assembleCodemap(root, scan) {
  const { entries, allPaths, skipped } = scan
  const pathSet = new Set(allPaths)
  const hasFile = (p) => pathSet.has(p)
  const edgeSeq = new Map()
  const files = []
  for (const [p, e] of [...entries].sort((a, b) => sortStr(a[0], b[0]))) {
    if (!e.rec || e.rec.pkg !== undefined) continue
    const rec = e.rec
    files.push({ id: p, path: p, language: rec.language, lines: rec.lines, purpose: rec.purpose ?? null, exports: rec.exports, symbols: rec.symbols, imports: resolveImports(p, rec, hasFile, edgeSeq), routes: rec.routes, testedBy: [] })
  }
  const mappedSet = new Set(files.map((f) => f.path))
  for (const f of files) for (const i of f.imports) if (i.resolution.status === 'local') i.resolution.mapped = mappedSet.has(i.resolution.target)

  const entryPoints = entryPointsOf(files, entries, hasFile)

  const fileModule = new Map(files.map((f) => [f.path, moduleOf(f.path)]))
  const modules = new Map()
  for (const f of files) {
    const id = fileModule.get(f.path)
    if (!modules.has(id)) modules.set(id, { id, files: [], lines: 0, languages: new Set(), dependsOn: new Set(), dependedOnBy: new Set() })
    const m = modules.get(id)
    m.files.push(f.path)
    m.lines += f.lines
    m.languages.add(f.language)
  }
  const moduleEdges = new Map()
  const importers = new Map()
  const covers = new Map()
  for (const f of files) {
    for (const i of f.imports) {
      const t = i.resolution.target
      if (i.resolution.status !== 'local' || !i.resolution.mapped) continue
      if (!importers.has(t)) importers.set(t, new Set())
      importers.get(t).add(f.path)
      if (isTestPath(f.path) && !isTestPath(t) && t !== f.path) {
        if (!covers.has(f.path)) covers.set(f.path, new Set())
        covers.get(f.path).add(t)
      }
      const a = fileModule.get(f.path)
      const b = fileModule.get(t)
      if (a === b) continue
      const key = `${a} -> ${b}`
      if (!moduleEdges.has(key)) moduleEdges.set(key, { id: key, from: a, to: b, count: 0, sources: [], truncated: false })
      const e = moduleEdges.get(key)
      e.count += 1
      if (e.sources.length < MAX_MODULE_EDGE_SAMPLES) e.sources.push({ file: f.path, line: i.line, spec: i.spec, target: t })
      else e.truncated = true
      modules.get(a).dependsOn.add(b)
      modules.get(b).dependedOnBy.add(a)
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f]))
  const tests = [...covers].sort((a, b) => sortStr(a[0], b[0])).map(([file, set]) => ({ file, covers: [...set].sort(sortStr) }))
  for (const t of tests) for (const c of t.covers) byPath.get(c).testedBy.push(t.file)
  const moduleList = [...modules.values()].sort((a, b) => sortStr(a.id, b.id)).map((m) => ({ id: m.id, fileCount: m.files.length, lines: m.lines, languages: [...m.languages].sort(), files: m.files, dependsOn: [...m.dependsOn].sort(), dependedOnBy: [...m.dependedOnBy].sort() }))
  const mostImported = [...importers.entries()].map(([id, set]) => ({ id, importedBy: set.size, importers: [...set].sort() })).sort((a, b) => b.importedBy - a.importedBy || sortStr(a.id, b.id)).slice(0, TOP_IMPORTED)

  const unresolved = []
  for (const f of files) for (const i of f.imports) if (i.resolution.status === 'unresolved') unresolved.push({ id: i.id, file: f.path, line: i.line, spec: i.spec, reason: i.resolution.reason })
  for (const e of entryPoints) if (e.status === 'unresolved') unresolved.push({ id: e.id, file: e.source.file, line: e.source.line, spec: e.value ?? e.name, reason: e.reason })

  const routes = []
  for (const f of files) for (const r of f.routes) routes.push({ method: r.method, path: r.path, file: f.path, line: r.line, framework: r.framework })
  routes.sort((a, b) => sortStr(a.path, b.path) || sortStr(a.method, b.method) || sortStr(a.file, b.file) || a.line - b.line)
  const parsed = new Set()
  const seen = new Set()
  for (const f of files) {
    const rec = entries.get(f.path).rec
    for (const x of rec.frameworks) parsed.add(x)
    for (const x of rec.seenOnly) seen.add(x)
  }
  const notParsed = [...seen].filter((x) => !parsed.has(x)).sort()
  const routing = { frameworksParsed: [...parsed].sort(), seenButNotParsed: notParsed, note: routingNote(parsed, notParsed, routes.length) }

  const byLang = {}
  for (const f of files) byLang[f.language] = (byLang[f.language] ?? 0) + 1
  const sum = (fn) => files.reduce((n, f) => n + fn(f), 0)
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: 'meerkat map',
    app: { name: basename(root) },
    limits: { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, topImported: TOP_IMPORTED, ignoredFolders: [...IGNORE_DIRS].sort() },
    summary: { files: files.length, lines: sum((f) => f.lines), languages: byLang, symbols: sum((f) => f.symbols.length), routes: routes.length, testFiles: tests.length, filesWithTests: files.filter((f) => f.testedBy.length).length, imports: sum((f) => f.imports.length), localImports: sum((f) => f.imports.filter((i) => i.resolution.status === 'local').length), externalImports: sum((f) => f.imports.filter((i) => i.resolution.status === 'external').length), unresolvedImports: unresolved.length, modules: moduleList.length, entryPoints: entryPoints.length },
    routing,
    files,
    routes,
    tests,
    entryPoints,
    modules: moduleList,
    moduleEdges: [...moduleEdges.values()].sort((a, b) => sortStr(a.id, b.id)),
    mostImported,
    unresolved,
    skipped: [...skipped].sort((a, b) => sortStr(a.path, b.path)),
  }
}

function routingNote(parsed, notParsed, count) {
  const bits = []
  if (parsed.size) bits.push(`routes read for: ${[...parsed].sort().join(', ')}`)
  else bits.push('no recognised web framework found, so no routes are listed')
  if (notParsed.length) bits.push(`seen but NOT parsed (their routes are missing): ${notParsed.join(', ')}`)
  if (parsed.size && count === 0) bits.push('a recognised framework is imported but no static route string was found')
  bits.push('recognised: express, fastify, hono, koa-router, restify, hapi, polka (method call with a string path), Next.js app router and pages/api (by file path), flask, quart, fastapi, sanic (decorators); mounted prefixes, dynamic paths and template strings are not followed')
  return bits.join('. ')
}

// Adds the build block: the commit (from the .git files), when it was built, and a hash of everything else. An unchanged project built
// from the same commit keeps the earlier builtAt (pass it as `keep`), so the output is byte-identical from run to run.
export function withBuild(map, { commit = null, now = null, keep = null } = {}) {
  const contentHash = createHash('sha256').update(JSON.stringify(map)).digest('hex').slice(0, 20)
  const same = keep && keep.contentHash === contentHash && keep.commit === commit
  const build = { commit, builtAt: same ? keep.builtAt : now ? now.toISOString() : null, contentHash }
  const { schemaVersion, generator, app, ...rest } = map
  return { schemaVersion, generator, app, build, ...rest }
}

// Builds the whole map from scratch (no cache). Use syncCodemap (lib/mapsync.mjs) for the incremental version.
export function buildCodemap(appDir, { now = null } = {}) {
  const root = resolve(appDir)
  return withBuild(assembleCodemap(root, scanFiles(root, null)), { commit: gitHead(root), now })
}

function strip(obj, keys) {
  const o = { ...obj }
  for (const k of keys) delete o[k]
  return o
}

const MD_FILE_LINES = 400
const MD_SYMBOLS = 8

export function codemapMarkdown(map, { blast = true } = {}) {
  const s = map.summary
  const langs = Object.entries(s.languages).map(([k, v]) => `${k} ${v}`).join(', ') || 'none found'
  const b = map.build
  const L = [`# Code map: ${map.app.name}`, '', `schema ${map.schemaVersion} | ${s.files} files, ${s.lines} lines (${langs}) | ${s.symbols} symbols | ${s.routes} routes | ${s.filesWithTests} files covered by ${s.testFiles} test files`, `built from commit ${b.commit ? b.commit.slice(0, 12) : '(not a git work tree)'}${b.builtAt ? ` at ${b.builtAt}` : ''}; content hash ${b.contentHash}. The content is read from the working tree, so uncommitted edits are included.`, `${s.imports} imports: ${s.localImports} local, ${s.externalImports} external, ${s.unresolvedImports} unresolved. Full detail is in codemap.json.`, '']
  L.push('## Routes and endpoints', '', map.routing.note, '')
  if (map.routes.length === 0) L.push('None listed.')
  for (const r of map.routes.slice(0, 200)) L.push(`- ${r.method} ${r.path}  ${r.file}:${r.line}  (${r.framework})`)
  if (map.routes.length > 200) L.push(`- ... ${map.routes.length - 200} more in codemap.json`)
  L.push('', '## Entry points', '')
  if (map.entryPoints.length === 0) L.push('None found.')
  for (const e of map.entryPoints) L.push(`- ${e.kind}${e.name ? ` ${e.name}` : ''}: ${e.file ?? (e.status === 'command-only' ? '(a command, no file)' : 'UNRESOLVED')} (${e.source.file}:${e.source.line})`)
  L.push('', '## Modules', '')
  if (map.modules.length === 0) L.push('None found.')
  for (const m of map.modules) L.push(`- ${m.id}: ${m.fileCount} files, ${m.lines} lines${m.dependsOn.length ? `; depends on ${m.dependsOn.join(', ')}` : ''}`)
  L.push('', '## Module edges', '')
  if (map.moduleEdges.length === 0) L.push('None found.')
  for (const e of map.moduleEdges.slice(0, 40)) L.push(`- ${e.from} -> ${e.to} (${e.count} import${e.count === 1 ? '' : 's'})`)
  if (map.moduleEdges.length > 40) L.push(`- ... ${map.moduleEdges.length - 40} more in codemap.json`)
  L.push('', `## Most imported files (top ${map.limits.topImported})`, '')
  if (map.mostImported.length === 0) L.push('None found.')
  for (const f of map.mostImported) L.push(`- ${f.id}: imported by ${f.importedBy} file${f.importedBy === 1 ? '' : 's'}`)
  const shown = map.files.filter((f) => !isTestPath(f.path)).slice(0, MD_FILE_LINES)
  L.push('', '## Files', '', 'path (language, lines, test files that import it): purpose from a leading comment. Functions and classes as name:line, exported ones marked +.', '')
  for (const f of shown) {
    const syms = f.symbols.slice(0, MD_SYMBOLS).map((x) => `${x.exported ? '+' : ''}${x.name}:${x.line}`).join(' ')
    const more = f.symbols.length > MD_SYMBOLS ? ` +${f.symbols.length - MD_SYMBOLS} more` : ''
    L.push(`- ${f.path} (${f.language === 'javascript' ? 'js' : f.language === 'typescript' ? 'ts' : 'py'}, ${f.lines}, ${f.testedBy.length} tests)${f.purpose ? `: ${f.purpose}` : ''}${syms ? ` [${syms}${more}]` : ''}`)
  }
  const nonTest = map.files.filter((f) => !isTestPath(f.path)).length
  if (nonTest > shown.length) L.push(`- ... ${nonTest - shown.length} more files in codemap.json`)
  L.push('', '## Tests', '')
  if (map.tests.length === 0) L.push('No test file imports a mapped source file.')
  for (const t of map.tests.slice(0, 150)) L.push(`- ${t.file} covers ${t.covers.slice(0, 6).join(', ')}${t.covers.length > 6 ? ` +${t.covers.length - 6} more` : ''}`)
  if (map.tests.length > 150) L.push(`- ... ${map.tests.length - 150} more in codemap.json`)
  L.push('', '## Unresolved', '')
  if (map.unresolved.length === 0) L.push('None.')
  for (const u of map.unresolved.slice(0, 25)) L.push(`- ${u.file}:${u.line} ${u.spec}: ${u.reason}`)
  if (map.unresolved.length > 25) L.push(`- ... ${map.unresolved.length - 25} more in codemap.json`)
  if (blast && map.mostImported.length) {
    L.push('', '## Blast radius of the five most imported files', '')
    for (const f of map.mostImported.slice(0, 5)) {
      const r = refactorCtx(map.app.name, f.id, { map, catalogDir: null, readText: () => null })
      L.push(`- ${f.id}: ${r.found ? r.blastRadius.line : 'not found'}`)
    }
  }
  if (map.skipped.length) L.push('', '## Not mapped', '', ...map.skipped.slice(0, 15).map((x) => `- ${x.path}: ${x.reason}`))
  L.push('', '## How to read this', '', 'Parsed with regular expressions, not a full parser. Unresolved means the parser could not point at a file under the app folder; it never guesses. Aliases (tsconfig paths, package imports maps), generated code and computed require or import calls are not followed. A test is listed as covering a file only when it imports it; a test that starts the program as a child process is not seen.', '')
  return L.join('\n')
}

// JSON with small values on one line (an import, a symbol, a route) and larger ones indented: far fewer lines than JSON.stringify(x, null, 2) and still easy to diff.
export function formatMapJson(value, indent = '') {
  const flat = JSON.stringify(value)
  if (flat === undefined || flat.length <= 110 || value === null || typeof value !== 'object') return flat
  const inner = `${indent}  `
  const NL = String.fromCharCode(10)
  if (Array.isArray(value)) return `[${NL}${value.map((v) => inner + formatMapJson(v, inner)).join(`,${NL}`)}${NL}${indent}]`
  return `{${NL}${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatMapJson(v, inner)}`).join(`,${NL}`)}${NL}${indent}}`
}

export function writeMapFiles(map, runDir) {
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'codemap.json'), `${formatMapJson(map)}\n`)
  writeFileSync(join(runDir, 'codemap.md'), codemapMarkdown(map))
  return { json: join(runDir, 'codemap.json'), md: join(runDir, 'codemap.md') }
}

// One-off: build and write, no cache. `meerkat map` uses syncCodemap instead.
export function writeCodemap(appDir, runDir) {
  const map = buildCodemap(appDir)
  return { map, ...writeMapFiles(map, runDir) }
}
