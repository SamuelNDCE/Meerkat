// A map of a codebase for an AI (or a person) to read before refactoring it: `meerkat map --app <dir>`.
// Writes codemap.json (machine-readable, schema version 1) and codemap.md (short summary) into the run folder.
// Parsing is regular expressions over comment-masked text. No dependencies, no network, nothing is run or imported.
// Anything the parser cannot resolve to a file is marked "unresolved" with a reason; it is never guessed.
import { builtinModules } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'
import { makeRunDir } from './runlog.mjs'

export const SCHEMA_VERSION = 1
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

export function buildCodemap(appDir) {
  const root = resolve(appDir)
  const { files: allPaths, skipped } = walk(root)
  const pathSet = new Set(allPaths)
  const hasFile = (p) => pathSet.has(p)

  const sourcePaths = allPaths.filter((p) => LANG_BY_EXT[extOf(p)])
  const kept = sourcePaths.slice(0, MAX_FILES)
  for (const p of sourcePaths.slice(MAX_FILES)) skipped.push({ path: p, reason: `more than ${MAX_FILES} source files, the rest are not mapped` })
  const mappedSet = new Set()

  const files = []
  const texts = new Map()
  for (const p of kept) {
    let size = 0
    try {
      size = statSync(join(root, p)).size
    } catch {
      skipped.push({ path: p, reason: 'file could not be read' })
      continue
    }
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path: p, reason: `larger than ${MAX_FILE_BYTES} bytes` })
      continue
    }
    try {
      texts.set(p, readFileSync(join(root, p), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'))
      mappedSet.add(p)
    } catch {
      skipped.push({ path: p, reason: 'file could not be read' })
    }
  }

  // Resolution uses every file on disk (so a json or css target is "local"), the map lists only parsed source files.
  const edgeSeq = new Map()
  for (const p of [...texts.keys()]) {
    const text = texts.get(p)
    const language = LANG_BY_EXT[extOf(p)]
    const imports = []
    const nextId = (line) => {
      const k = `${p}#${line}`
      const n = edgeSeq.get(k) ?? 0
      edgeSeq.set(k, n + 1)
      return `${k}.${n}`
    }
    if (language === 'python') {
      for (const imp of extractPyImports(text)) {
        const spec = '.'.repeat(imp.dots) + imp.module
        for (const r of resolvePyImport(p, imp, hasFile)) imports.push({ id: nextId(imp.line), line: imp.line, kind: imp.kind === 'from' ? 'py-from' : 'py-import', spec: r.spec ?? spec, resolution: strip(r, ['spec']) })
      }
    } else {
      for (const imp of extractJsImports(text)) {
        const resolution = imp.literal ? resolveJsSpec(p, imp.spec, hasFile) : { status: 'unresolved', target: null, reason: 'specifier is not a string literal' }
        imports.push({ id: nextId(imp.line), line: imp.line, kind: imp.kind, spec: imp.spec, resolution })
      }
    }
    const exported = language === 'python' ? extractPyExports(text).filter((n) => !n.startsWith('_')) : extractJsExports(text)
    files.push({ id: p, path: p, language, lines: countLines(text), exports: exported, imports })
  }

  for (const f of files) for (const i of f.imports) {
    const t = i.resolution.target
    if (i.resolution.status === 'local') i.resolution.mapped = mappedSet.has(t)
  }

  // Entry points.
  const entryPoints = []
  for (const p of allPaths.filter((x) => posix.basename(x) === 'package.json')) {
    let text = ''
    try {
      text = readFileSync(join(root, p), 'utf8')
    } catch {
      continue
    }
    entryPoints.push(...packageEntries(p, text, hasFile))
  }
  for (const f of files) {
    const text = texts.get(f.path)
    const base = posix.basename(f.path).replace(/\.[^.]+$/, '')
    const depth = f.path.split('/').length - 1
    if (ENTRY_NAMES.has(base) && depth <= 1) entryPoints.push({ id: `${f.path}#convention`, kind: 'convention', name: base, file: f.path, status: 'local', source: { file: f.path, line: 1 } })
    if (/^#!.*\b(?:node|python[0-9.]*|deno|bun|tsx)\b/.test(text.split('\n')[0] ?? '')) entryPoints.push({ id: `${f.path}#shebang`, kind: 'shebang', name: base, file: f.path, status: 'local', source: { file: f.path, line: 1 } })
    if (f.language === 'python') {
      const m = text.match(/^if[ \t]+__name__[ \t]*==[ \t]*['"]__main__['"]/m)
      if (m) entryPoints.push({ id: `${f.path}#python-main`, kind: 'python-main', name: base, file: f.path, status: 'local', source: { file: f.path, line: text.slice(0, m.index).split('\n').length } })
    }
  }
  entryPoints.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Modules and edges.
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
  for (const f of files) {
    for (const i of f.imports) {
      const t = i.resolution.target
      if (i.resolution.status !== 'local' || !i.resolution.mapped) continue
      if (!importers.has(t)) importers.set(t, new Set())
      importers.get(t).add(f.path)
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
  const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const moduleList = [...modules.values()].sort((a, b) => sortStr(a.id, b.id)).map((m) => ({ id: m.id, fileCount: m.files.length, lines: m.lines, languages: [...m.languages].sort(), files: m.files, dependsOn: [...m.dependsOn].sort(), dependedOnBy: [...m.dependedOnBy].sort() }))

  const mostImported = [...importers.entries()].map(([id, set]) => ({ id, importedBy: set.size, importers: [...set].sort() })).sort((a, b) => b.importedBy - a.importedBy || sortStr(a.id, b.id)).slice(0, TOP_IMPORTED)

  const unresolved = []
  for (const f of files) for (const i of f.imports) if (i.resolution.status === 'unresolved') unresolved.push({ id: i.id, file: f.path, line: i.line, spec: i.spec, reason: i.resolution.reason })
  for (const e of entryPoints) if (e.status === 'unresolved') unresolved.push({ id: e.id, file: e.source.file, line: e.source.line, spec: e.value ?? e.name, reason: e.reason })

  const edgeCount = files.reduce((n, f) => n + f.imports.length, 0)
  const byLang = {}
  for (const f of files) byLang[f.language] = (byLang[f.language] ?? 0) + 1
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: 'meerkat map',
    app: { name: basename(root) },
    limits: { maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, topImported: TOP_IMPORTED, ignoredFolders: [...IGNORE_DIRS].sort() },
    summary: { files: files.length, lines: files.reduce((n, f) => n + f.lines, 0), languages: byLang, imports: edgeCount, localImports: files.reduce((n, f) => n + f.imports.filter((i) => i.resolution.status === 'local').length, 0), externalImports: files.reduce((n, f) => n + f.imports.filter((i) => i.resolution.status === 'external').length, 0), unresolvedImports: unresolved.length, modules: moduleList.length, entryPoints: entryPoints.length },
    files,
    entryPoints,
    modules: moduleList,
    moduleEdges: [...moduleEdges.values()].sort((a, b) => sortStr(a.id, b.id)),
    mostImported,
    unresolved,
    skipped: skipped.sort((a, b) => sortStr(a.path, b.path)),
  }
}

function strip(obj, keys) {
  const o = { ...obj }
  for (const k of keys) delete o[k]
  return o
}

export function codemapMarkdown(map) {
  const s = map.summary
  const langs = Object.entries(s.languages).map(([k, v]) => `${k} ${v}`).join(', ') || 'none found'
  const L = [`# Code map: ${map.app.name}`, '', `${s.files} source files, ${s.lines} lines (${langs}). ${s.imports} imports: ${s.localImports} local, ${s.externalImports} external, ${s.unresolvedImports} unresolved. Schema version ${map.schemaVersion}; full detail is in codemap.json.`, '']
  L.push('## Entry points', '')
  if (map.entryPoints.length === 0) L.push('None found.')
  for (const e of map.entryPoints) L.push(`- ${e.kind}${e.name ? ` ${e.name}` : ''}: ${e.file ?? (e.status === 'command-only' ? '(a command, no file)' : 'UNRESOLVED')} (${e.source.file}:${e.source.line})`)
  L.push('', '## Modules', '')
  if (map.modules.length === 0) L.push('None found.')
  for (const m of map.modules) L.push(`- ${m.id}: ${m.fileCount} files, ${m.lines} lines${m.dependsOn.length ? `; depends on ${m.dependsOn.join(', ')}` : ''}`)
  L.push('', `## Most imported files (top ${map.limits.topImported})`, '')
  if (map.mostImported.length === 0) L.push('None found.')
  for (const f of map.mostImported) L.push(`- ${f.id}: imported by ${f.importedBy} file${f.importedBy === 1 ? '' : 's'}`)
  L.push('', '## Unresolved', '')
  if (map.unresolved.length === 0) L.push('None.')
  for (const u of map.unresolved.slice(0, 25)) L.push(`- ${u.file}:${u.line} ${u.spec}: ${u.reason}`)
  if (map.unresolved.length > 25) L.push(`- ... ${map.unresolved.length - 25} more in codemap.json`)
  if (map.skipped.length) L.push('', '## Not mapped', '', ...map.skipped.slice(0, 15).map((x) => `- ${x.path}: ${x.reason}`))
  L.push('', '## How to read this', '', 'Parsed with regular expressions, not a full parser. Unresolved means the parser could not point at a file under the app folder; it never guesses. Aliases (tsconfig paths, package imports maps), generated code and computed require or import calls are not followed.', '')
  return L.join('\n')
}

export function writeCodemap(appDir, runDir) {
  const map = buildCodemap(appDir)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'codemap.json'), `${JSON.stringify(map, null, 2)}\n`)
  writeFileSync(join(runDir, 'codemap.md'), codemapMarkdown(map))
  return { map, json: join(runDir, 'codemap.json'), md: join(runDir, 'codemap.md') }
}

// `meerkat map [--app <dir>] [--json]`. Returns the exit code.
export function runMap(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`), now = new Date() } = {}) {
  let app = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app') {
      app = argv[++i]
      if (!app) {
        err('--app needs a folder, for example: meerkat map --app ./my-app')
        return 2
      }
    } else if (argv[i] === '--json') json = true
    else {
      err(`map: unknown option ${String(argv[i]).slice(0, 60)}. Use: meerkat map --app <folder> [--json]`)
      return 2
    }
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    err(`map: ${app ?? '.'} is not a folder`)
    return 2
  }
  const runDir = makeRunDir(env, 'map', now, undefined, appDir)
  if (!runDir) {
    err('map: could not make a run folder to save the map in')
    return 1
  }
  const r = writeCodemap(appDir, runDir)
  out(json ? JSON.stringify({ runDir, files: ['codemap.json', 'codemap.md'], summary: r.map.summary }, null, 2) : `code map saved in ${runDir}\n  codemap.json  codemap.md\n  ${r.map.summary.files} files, ${r.map.summary.unresolvedImports} unresolved`)
  return 0
}
