// What an AI needs before refactoring a file or a symbol: `refactorCtx(appDir, target)`.
// Built on the code map (lib/codemap.mjs). Reads files only: no network, nothing is run, no catalog entry is executed.
// Never guesses: an import the map could not resolve is listed as unresolved, never dropped as "not an importer".
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { buildCodemap, maskJs, maskPy } from './codemap.mjs'
import { MEERKAT_DIR } from './paths.mjs'

export const REFACTORCTX_VERSION = 1
const MAX_CHAIN = 12
const TEST_RE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.py$/i

const extOf = (p) => {
  const b = posix.basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}
const stemOf = (p) => posix.basename(p).replace(/\.[^.]+$/, '')
const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// A target is 'src/a.js', 'src/a.js#name' or { file, symbol }.
export function parseTarget(target) {
  if (target && typeof target === 'object') return { file: String(target.file ?? ''), symbol: target.symbol ? String(target.symbol) : null }
  const s = String(target ?? '')
  const i = s.indexOf('#')
  return i < 0 ? { file: s, symbol: null } : { file: s.slice(0, i), symbol: s.slice(i + 1) || null }
}

function normaliseFile(appDir, file) {
  let f = String(file).replace(/\\/g, '/')
  const root = resolve(appDir).replace(/\\/g, '/')
  if (f.startsWith(`${root}/`)) f = f.slice(root.length + 1)
  return posix.normalize(f).replace(/^\.\//, '')
}

// ---- catalog: list entries whose language matches, by reading the files as text (they are never imported or run) ----

const LANG_PACKS = { javascript: ['node'], typescript: ['node'], python: ['python'] }

function walkMjs(dir, depth = 0, acc = []) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return acc
  }
  for (const n of names.sort()) {
    const p = join(dir, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (depth < 3 && n !== 'node_modules') walkMjs(p, depth + 1, acc)
    } else if (n.endsWith('.mjs') && !n.endsWith('.test.mjs')) acc.push(p)
  }
  return acc
}

// Default folder: `catalog/` in the tool's own folder when it exists, otherwise `packs/` (where the checks live today).
export function defaultCatalogDir(root = MEERKAT_DIR) {
  for (const d of ['catalog', 'packs']) if (existsSync(join(root, d))) return join(root, d)
  return null
}

export function listCatalog(catalogDir, language, ext) {
  if (!catalogDir || !existsSync(catalogDir)) return { dir: catalogDir ? posix.basename(String(catalogDir).replace(/\\/g, '/')) : null, found: false, entries: [] }
  const root = resolve(catalogDir).replace(/\\/g, '/')
  const entries = []
  const packNames = LANG_PACKS[language] ?? []
  const bare = ext.slice(1)
  const globRe = new RegExp(`\\*\\.(?:\\{[^}]*\\b${bare}\\b[^}]*\\}|${bare}\\b)`)
  for (const p of walkMjs(root)) {
    const rel = posix.relative(root, p.replace(/\\/g, '/'))
    const text = readFileSync(p, 'utf8')
    const packFolder = rel.split('/')[0]
    const folderHit = packNames.includes(packFolder)
    if (!folderHit && !globRe.test(text)) continue
    const matchedBy = folderHit ? `pack folder "${packFolder}" is the ${language} pack` : `file names a ${ext} glob`
    const re = /\bid:\s*'([^']+)'/g
    let m
    while ((m = re.exec(text))) {
      const after = text.slice(m.index, m.index + 600)
      const t = after.match(/\btitle:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/)
      entries.push({ id: m[1], file: `${posix.basename(root)}/${rel}`, title: t ? (t[1] ?? t[2]) : null, matchedBy })
    }
  }
  entries.sort((a, b) => sortStr(a.file, b.file) || sortStr(a.id, b.id))
  return { dir: posix.basename(root), found: true, entries }
}

// ---- the main call ----

export function refactorCtx(appDir, target, { map = null, catalogDir = undefined, readText = null } = {}) {
  const root = resolve(appDir)
  const { file: rawFile, symbol } = parseTarget(target)
  const file = normaliseFile(root, rawFile)
  const cm = map ?? buildCodemap(root)
  const rec = cm.files.find((f) => f.path === file)
  if (!rec) {
    const sk = cm.skipped.find((s) => s.path === file)
    return { schemaVersion: REFACTORCTX_VERSION, found: false, target: { file, symbol }, reason: sk ? `the code map skipped this file: ${sk.reason}` : 'the file is not in the code map (not a mapped source file, or the path is wrong)' }
  }
  const read = readText ?? ((p) => {
    try {
      return readFileSync(join(root, p), 'utf8').replace(/\r\n?/g, '\n')
    } catch {
      return null
    }
  })

  // Importers: every mapped import that resolved to the target.
  const importers = []
  const reverse = new Map()
  for (const f of cm.files) {
    for (const i of f.imports) {
      if (i.resolution.status !== 'local' || !i.resolution.mapped) continue
      if (!reverse.has(i.resolution.target)) reverse.set(i.resolution.target, new Map())
      const m = reverse.get(i.resolution.target)
      if (!m.has(f.path)) m.set(f.path, { line: i.line, spec: i.spec })
      if (i.resolution.target === file && f.path !== file) importers.push({ file: f.path, line: i.line, spec: i.spec, kind: i.kind })
    }
  }
  importers.sort((a, b) => sortStr(a.file, b.file) || a.line - b.line)

  // Symbol: the map keeps no imported names, so a mention is a text match in comment-masked source, labelled as such.
  let symbolInfo = null
  if (symbol) {
    const word = new RegExp(`(?<![\\w$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`)
    const exported = rec.exports.includes(symbol)
    const mention = (p) => {
      const raw = read(p)
      if (raw === null) return null
      const lang = cm.files.find((x) => x.path === p).language
      const masked = lang === 'python' ? maskPy(raw) : maskJs(raw)
      const at = masked.split('\n').findIndex((l) => word.test(l))
      return at < 0 ? false : at + 1
    }
    for (const row of importers) {
      const hit = mention(row.file)
      row.mentionsSymbol = hit === null ? 'unknown (file could not be read)' : hit !== false
      if (typeof hit === 'number') row.symbolLine = hit
    }
    const own = mention(file)
    symbolInfo = { name: symbol, exported, mentionedInTarget: own === null ? 'unknown' : own !== false, note: 'mentionsSymbol is a whole-word text match in comment-masked source, not a resolved usage: a hit may be an unrelated name, and a star import or re-export can use the symbol without naming it.' }
    if (!exported) symbolInfo.warning = `"${symbol}" is not in the exported names the map found for this file, so importers cannot use it by name unless it is re-exported or reached through a namespace`
  }

  // Tests whose imports reach the target: breadth-first over reverse edges, keeping the chain.
  const seen = new Map([[file, null]])
  let frontier = [file]
  while (frontier.length) {
    const next = []
    for (const cur of frontier) {
      for (const [from, at] of [...(reverse.get(cur) ?? new Map())].sort((a, b) => sortStr(a[0], b[0]))) {
        if (seen.has(from)) continue
        seen.set(from, { via: cur, line: at.line, spec: at.spec })
        next.push(from)
      }
    }
    frontier = next
  }
  const tests = []
  for (const [p, link] of seen) {
    if (!link || !TEST_RE.test(p)) continue
    const chain = [p]
    let c = link.via
    while (c !== file && chain.length < MAX_CHAIN) {
      chain.push(c)
      c = seen.get(c).via
    }
    chain.push(file)
    tests.push(chain.length === 2 ? { file: p, matched: 'direct', line: link.line, spec: link.spec } : { file: p, matched: 'transitive', line: link.line, spec: link.spec, chain })
  }
  tests.sort((a, b) => sortStr(a.file, b.file))
  const reachableFiles = [...seen.keys()].filter((p) => p !== file).sort()

  // Unresolved imports that could be importers. A non-literal specifier may point anywhere, so it counts.
  const stem = stemOf(file)
  const unresolvedAll = cm.unresolved.filter((u) => cm.files.some((f) => f.path === u.file && f.imports.some((i) => i.id === u.id)))
  const unresolvedCandidates = unresolvedAll
    .map((u) => {
      const nonLiteral = /not a string literal/.test(u.reason ?? '')
      const stemHit = !nonLiteral && stemOf(String(u.spec).replace(/\/+$/, '')) === stem
      return nonLiteral || stemHit ? { file: u.file, line: u.line, spec: u.spec, reason: u.reason, why: nonLiteral ? 'specifier is built at run time, so it could be this file' : 'unresolved specifier ends in the same name as the target' } : null
    })
    .filter(Boolean)
    .sort((a, b) => sortStr(a.file, b.file) || a.line - b.line)

  const modOf = (p) => cm.modules.find((m) => m.files.includes(p))?.id
  const targetModule = modOf(file)
  const modulesTouched = [...new Set([targetModule, ...importers.map((r) => modOf(r.file))].filter(Boolean))].sort()
  const mod = cm.modules.find((m) => m.id === targetModule)

  const catalogRoot = catalogDir === undefined ? defaultCatalogDir() : catalogDir
  const catalog = listCatalog(catalogRoot, rec.language, extOf(file))

  const blast = {
    importerCount: new Set(importers.map((r) => r.file)).size,
    importLineCount: importers.length,
    testsReaching: tests.length,
    reachableFileCount: reachableFiles.length,
    modulesTouched,
    unresolvedCouldBeImporters: unresolvedCandidates.length,
    unresolvedInProject: unresolvedAll.length,
    anyUnresolved: unresolvedCandidates.length > 0,
  }
  const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
  blast.line = `${pl(blast.importerCount, 'importer')} (${pl(blast.importLineCount, 'import line')}), ${pl(modulesTouched.length, 'module')} touched (${modulesTouched.join(', ') || 'none'}), ${pl(tests.length, 'test file')} reach it, ${unresolvedCandidates.length ? `${pl(unresolvedCandidates.length, 'unresolved import')} could also be importers (not counted above)` : 'no unresolved import could be an importer'}`

  return {
    schemaVersion: REFACTORCTX_VERSION,
    found: true,
    target: { file, symbol, language: rec.language, lines: rec.lines, module: targetModule },
    exports: rec.exports,
    symbol: symbolInfo,
    importers,
    tests,
    unresolved: unresolvedCandidates,
    module: { id: targetModule, dependsOn: mod?.dependsOn ?? [], dependedOnBy: mod?.dependedOnBy ?? [] },
    catalog,
    blastRadius: blast,
  }
}

export function refactorCtxText(r) {
  if (!r.found) return `refactor context: ${r.target.file}\n  not found: ${r.reason}\n`
  const L = [`refactor context: ${r.target.file}${r.target.symbol ? `#${r.target.symbol}` : ''} (${r.target.language}, ${r.target.lines} lines, module ${r.target.module})`]
  L.push(`blast radius: ${r.blastRadius.line}`)
  L.push(`exports: ${r.exports.join(', ') || 'none found'}`)
  if (r.symbol) L.push(`symbol ${r.symbol.name}: ${r.symbol.exported ? 'exported' : 'NOT in the exported names'}${r.symbol.warning ? ` (${r.symbol.warning})` : ''}`)
  L.push(`importers (${r.importers.length}):`)
  for (const i of r.importers) L.push(`  ${i.file}:${i.line}  ${i.spec}${r.symbol ? (i.mentionsSymbol === true ? `  [mentions ${r.symbol.name} at line ${i.symbolLine}]` : i.mentionsSymbol === false ? `  [does not mention ${r.symbol.name}]` : `  [${i.mentionsSymbol}]`) : ''}`)
  L.push(`tests that reach it (${r.tests.length}):`)
  for (const t of r.tests) L.push(`  ${t.file}  ${t.matched === 'direct' ? `direct import at line ${t.line}` : `through ${t.chain.join(' -> ')}`}`)
  L.push(`unresolved imports that could be importers (${r.unresolved.length}):`)
  for (const u of r.unresolved) L.push(`  ${u.file}:${u.line}  ${u.spec}  (${u.why})`)
  L.push(`catalog entries for ${r.target.language} (${r.catalog.entries.length}, listed only, not run${r.catalog.found ? '' : '; no catalog folder found'}):`)
  for (const c of r.catalog.entries) L.push(`  ${c.id}  ${c.file}${c.title ? `  ${c.title}` : ''}`)
  return `${L.join('\n')}\n`
}
