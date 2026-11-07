// `meerkat blast <file>[#symbol] [--app <dir>] [--json]`: the blast radius of a file or symbol, fast.
// Reuses the code map (lib/codemap.mjs) and the refactor context (lib/refactorctx.mjs). Before it answers, the map is refreshed for the
// files that changed since the last map (lib/mapsync.mjs; the per-file cache is in the Meerkat data folder), and one line says how many.
// Exit codes: 0 done, 2 usage error, 75 the target is not in the map.
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { syncCodemap } from './mapsync.mjs'
import { refactorCtx } from './refactorctx.mjs'

export const EXIT_NOT_FOUND = 75

// Brings the code map up to date first (only the files that changed since the last map are read again), then returns it.
// Returns { map, source: 'built' | 'refreshed' | 'cache', refreshed, ms, cacheFile }; the per-file cache lives in the Meerkat data folder.
export function cachedCodemap(appDir, { env = process.env } = {}) {
  const s = syncCodemap(appDir, { env })
  return { map: s.map, source: s.firstBuild ? 'built' : s.refreshed.length ? 'refreshed' : 'cache', refreshed: s.refreshed.length, removed: s.removed.length, total: s.total, ms: s.ms, cacheFile: s.stateFile }
}

// One line that says what the map did before the answer, or '' when it was already current.
export function mapRefreshLine(meta) {
  if (!meta) return ''
  if (meta.source === 'built') return `map: built (${meta.total} files, no earlier map) in ${Math.round(meta.ms)} ms`
  if (meta.source === 'refreshed') return `map: refreshed ${meta.refreshed} file${meta.refreshed === 1 ? '' : 's'}${meta.removed ? ` and dropped ${meta.removed}` : ''} first (${Math.round(meta.ms)} ms)`
  return `map: current, nothing to refresh (${Math.round(meta.ms)} ms)`
}

export function blastText(r, meta) {
  if (!r.found) return `blast: ${r.target.file}\n  not found: ${r.reason}\n`
  const b = r.blastRadius
  const L = [`blast radius: ${r.target.file}${r.target.symbol ? `#${r.target.symbol}` : ''} (${r.target.language}, module ${r.target.module})`]
  L.push(`summary: ${b.line}`)
  L.push(`importers: ${b.importerCount}`)
  for (const i of r.importers) L.push(`  ${i.file}:${i.line}  ${i.spec}${r.symbol ? (i.mentionsSymbol === true ? `  [mentions ${r.symbol.name}]` : i.mentionsSymbol === false ? `  [does not mention ${r.symbol.name}]` : '') : ''}`)
  L.push(`modules touched: ${b.modulesTouched.length} (${b.modulesTouched.join(', ') || 'none'})`)
  L.push(`tests reaching it: ${b.testsReaching}`)
  for (const t of r.tests) L.push(`  ${t.file}  ${t.matched === 'direct' ? 'direct import' : `through ${t.chain.join(' -> ')}`}`)
  L.push(`unresolved imports that could be importers: ${b.unresolvedCouldBeImporters} (they are NOT counted as safe)`)
  for (const u of r.unresolved) L.push(`  ${u.file}:${u.line}  ${u.spec}  (${u.why})`)
  if (r.symbol?.warning) L.push(`warning: ${r.symbol.warning}`)
  if (meta) L.push(mapRefreshLine(meta))
  return `${L.join('\n')}\n`
}

export function runBlast(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  let app = null
  let json = false
  let target = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') {
      app = argv[++i]
      if (!app) {
        err('--app needs a folder, for example: meerkat blast src/a.js --app ./my-app')
        return 2
      }
    } else if (a === '--json') json = true
    else if (a.startsWith('--')) {
      err(`blast: unknown option ${a.slice(0, 60)}. Use: meerkat blast <file>[#symbol] [--app <folder>] [--json]`)
      return 2
    } else if (target === null) target = a
    else {
      err('blast: give one target. Use: meerkat blast <file>[#symbol] [--app <folder>] [--json]')
      return 2
    }
  }
  if (!target || target.startsWith('#')) {
    err('blast: say which file, for example: meerkat blast src/a.js or meerkat blast src/a.js#name')
    return 2
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    err(`blast: ${app ?? '.'} is not a folder`)
    return 2
  }
  const meta = cachedCodemap(appDir, { env })
  const r = refactorCtx(appDir, target, { map: meta.map, catalogDir: null })
  const mapInfo = { source: meta.source, refreshed: meta.refreshed, ms: Math.round(meta.ms) }
  out(json ? JSON.stringify({ ...r, map: mapInfo }, null, 2) : blastText(r, mapInfo).trimEnd())
  return r.found ? 0 : EXIT_NOT_FOUND
}
