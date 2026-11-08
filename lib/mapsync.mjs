// Keeps the code map current without re-reading the project: `meerkat map`, `meerkat map --check`, and the refresh that blast and brief run first.
// The per-file facts live in <cache>/map-<project>.json (the Meerkat data folder, never in the repo), keyed by path with the file's size,
// modification time and content hash. A run walks the folder, trusts a file whose size and time are unchanged, hashes one that looks
// different, and parses again only when the hash changed. Resolving imports and building modules, routes and tests from those facts
// needs no disk reads, so a warm run costs one stat per file.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assembleCodemap, PARSER_REV, routesPhrase, scanFiles, SCHEMA_VERSION, withBuild, writeMapFiles } from './codemap.mjs'
import { gitHead, gitState } from './githead.mjs'
import { projectSlug, writeAtomic } from './findingshistory.mjs'
import { cacheHome } from './resultcache.mjs'
import { makeRunDir } from './runlog.mjs'

export const mapStateFile = (env, appDir) => join(cacheHome(env), `map-${projectSlug(appDir)}.json`).split('\\').join('/')
const MAX_STALE_LINES = 50

// The run folder holding the last map saved for this project, or null.
export const savedMapDir = (appDir, env = process.env) => loadState(mapStateFile(env, resolve(appDir)))?.saved?.runDir ?? null

function loadState(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'))
    if (!s || s.parser !== PARSER_REV || s.schema !== SCHEMA_VERSION || typeof s.files !== 'object') return null
    return { entries: new Map(Object.entries(s.files)), saved: s.saved ?? null }
  } catch {
    return null
  }
}

function saveState(file, env, entries, saved) {
  try {
    mkdirSync(cacheHome(env), { recursive: true })
    writeAtomic(file, JSON.stringify({ parser: PARSER_REV, schema: SCHEMA_VERSION, files: Object.fromEntries([...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))), saved }))
    return true
  } catch {
    return false // a cache that cannot be written only makes the next run slower
  }
}

const hashes = (entries) => Object.fromEntries([...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, e]) => [p, e.hash]))

// Brings the cached facts up to date with the working tree and returns the map. refreshed lists the files that were parsed again.
export function syncCodemap(appDir, { env = process.env, now = new Date(), persist = true } = {}) {
  const t0 = process.hrtime.bigint()
  const root = resolve(appDir)
  const file = mapStateFile(env, root)
  const state = loadState(file)
  const scan = scanFiles(root, state?.entries ?? null)
  const saved = state?.saved ?? null
  const map = withBuild(assembleCodemap(root, scan), { commit: gitHead(root), unborn: gitState(root) === 'unborn', now, keep: saved })
  const changed = !state || scan.refreshed.length > 0 || scan.removed.length > 0 || scan.touched
  if (persist && changed) saveState(file, env, scan.entries, saved)
  return {
    map,
    saved,
    refreshed: scan.refreshed,
    removed: scan.removed,
    firstBuild: !state,
    total: map.summary.files,
    ms: Number(process.hrtime.bigint() - t0) / 1e6,
    stateFile: file,
    // Remember that this map was written to runDir, so `--check` and the next `meerkat map` can compare against it.
    markSaved: (runDir) => saveState(file, env, scan.entries, { contentHash: map.build.contentHash, commit: map.build.commit, builtAt: map.build.builtAt, runDir, files: hashes(scan.entries) }),
  }
}

// Is the saved map current? Reads nothing but file sizes and times, plus the content of any file whose time changed.
// Returns { current, stale: [{ path, reason }], reason, files, ms }.
export function checkCodemap(appDir, { env = process.env } = {}) {
  const t0 = process.hrtime.bigint()
  const root = resolve(appDir)
  const state = loadState(mapStateFile(env, root))
  const done = (o) => ({ files: 0, stale: [], ...o, ms: Number(process.hrtime.bigint() - t0) / 1e6 })
  if (!state?.saved?.files) return done({ current: false, reason: 'no map has been saved for this project yet (run: meerkat map)' })
  const scan = scanFiles(root, state.entries, { parse: false })
  const stale = []
  for (const [p, e] of scan.entries) {
    const was = state.saved.files[p]
    if (was === undefined) stale.push({ path: p, reason: 'new' })
    else if (was !== e.hash) stale.push({ path: p, reason: 'changed' })
  }
  for (const p of Object.keys(state.saved.files)) if (!scan.entries.has(p)) stale.push({ path: p, reason: 'removed' })
  stale.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return done({ current: stale.length === 0, stale, files: scan.entries.size })
}

// The ten most common unresolved specifiers, so a reader can tell unconfigured aliases from real gaps.
function topUnresolved(map) {
  const top = map.unresolvedTop ?? []
  if (!top.length) return ''
  return `${NL}  top unresolved: ${top.map((x) => `${x.spec} x${x.count}`).join(', ')}`
}
const NL = String.fromCharCode(10)

const USAGE = 'Use: meerkat map [--app <folder>] [--json] [--quiet] [--check]'

// `meerkat map [--app <dir>] [--json] [--quiet] [--check]`. Returns the exit code: 0 done (or current), 1 --check found stale files or the map could not be saved, 2 usage.
export function runMap(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`), now = new Date() } = {}) {
  let app = null
  const flag = { json: false, quiet: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app') {
      app = argv[++i]
      if (!app) {
        err('--app needs a folder, for example: meerkat map --app ./my-app')
        return 2
      }
    } else if (a === '--json') flag.json = true
    else if (a === '--quiet') flag.quiet = true
    else if (a === '--check') flag.check = true
    else {
      err(`map: unknown option ${String(a).slice(0, 60)}. ${USAGE}`)
      return 2
    }
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    err(`map: ${app ?? '.'} is not a folder`)
    return 2
  }
  if (flag.check) return runCheck(appDir, flag, { env, out })
  const s = syncCodemap(appDir, { env, now })
  const keep = s.saved
  const same = keep && keep.contentHash === s.map.build.contentHash && keep.commit === s.map.build.commit && keep.runDir && existsSync(join(keep.runDir, 'codemap.json')) && existsSync(join(keep.runDir, 'codemap.md'))
  let runDir = same ? keep.runDir : makeRunDir(env, 'map', now, undefined, appDir)
  if (!runDir) {
    err('map: could not make a run folder to save the map in')
    return 1
  }
  if (!same) {
    try {
      writeMapFiles(s.map, runDir)
    } catch (e) {
      err(`map: could not write the map into ${runDir}: ${String(e?.message ?? e).slice(0, 120)}`)
      return 1
    }
    s.markSaved(runDir)
  }
  if (flag.quiet) return 0
  const reread = s.firstBuild ? `read all ${s.total} files` : `re-read ${s.refreshed.length} of ${s.total} files`
  const m = s.map.summary
  if (flag.json) out(JSON.stringify({ runDir, files: ['codemap.json', 'codemap.md'], schemaVersion: s.map.schemaVersion, unchanged: Boolean(same), refreshed: s.refreshed.length, build: s.map.build, summary: m }, null, 2))
  else out(`code map ${same ? 'unchanged, still in' : 'saved in'} ${runDir}\n  codemap.json  codemap.md\n  ${m.files} files, ${m.symbols} symbols, ${routesPhrase(s.map)}, ${m.unresolvedImports} unresolved; ${reread} (${Math.round(s.ms)} ms)${topUnresolved(s.map)}
  resolved through config: ${m.aliasResolvedImports} (tsconfig paths ${m.resolvedVia.tsconfigPaths}, baseUrl ${m.resolvedVia.baseUrl}, workspace packages ${m.resolvedVia.workspacePackage}); unresolved by language: ${Object.entries(m.unresolvedByLanguage).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  return 0
}

function runCheck(appDir, flag, { env, out }) {
  const r = checkCodemap(appDir, { env })
  if (r.current) {
    if (!flag.quiet) out(flag.json ? JSON.stringify({ current: true, stale: [], files: r.files, ms: Math.round(r.ms) }, null, 2) : `map is current (${r.files} files checked in ${Math.round(r.ms)} ms)`)
    return 0
  }
  if (flag.json) out(JSON.stringify({ current: false, reason: r.reason ?? null, stale: r.stale, files: r.files, ms: Math.round(r.ms) }, null, 2))
  else {
    out(r.reason ? `map is stale: ${r.reason}` : `map is stale: ${r.stale.length} file${r.stale.length === 1 ? ' differs' : 's differ'} from the saved map (run: meerkat map)`)
    for (const x of r.stale.slice(0, MAX_STALE_LINES)) out(`  ${x.reason.padEnd(8)} ${x.path}`)
    if (r.stale.length > MAX_STALE_LINES) out(`  ... ${r.stale.length - MAX_STALE_LINES} more`)
  }
  return 1
}
