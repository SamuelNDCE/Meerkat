// `meerkat blast <file>[#symbol] [--app <dir>] [--json]`: the blast radius of a file or symbol, fast.
// Reuses the code map (lib/codemap.mjs) and the refactor context (lib/refactorctx.mjs). The code map is cached per git HEAD commit
// under the Meerkat cache folder (MEERKAT_LOG_DIR/cache or ~/.meerkat/cache); the cache is reused only when HEAD matches and no
// source file (or package.json) has changed in the working tree. Outside a git work tree nothing is cached.
// Exit codes: 0 done, 2 usage error, 75 the target is not in the map.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildCodemap, SCHEMA_VERSION } from './codemap.mjs'
import { cacheHome } from './resultcache.mjs'
import { projectSlug, writeAtomic } from './findingshistory.mjs'
import { refactorCtx } from './refactorctx.mjs'
import { VERSION } from './version.mjs'

export const EXIT_NOT_FOUND = 75
const SOURCE_RE = /(?:\.(?:[cm]?[jt]sx?|py)|(?:^|\/)package\.json)$/i

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

export const codemapCacheFile = (env, appDir) => join(cacheHome(env), `codemap-${projectSlug(appDir)}.json`).split('\\').join('/')

// True when a source file under the app folder differs from HEAD (changed, staged or untracked), or when git cannot say.
function sourceDirty(appDir) {
  const status = git(appDir, ['status', '--porcelain', '--untracked-files=all', '-z', '--', '.'])
  if (status === null) return true
  return status.split('\0').filter(Boolean).some((e) => SOURCE_RE.test(e.slice(3).replace(/\\/g, '/')))
}

// Returns { map, source: 'cache' | 'built' | 'built-uncached', ms, cacheFile }.
export function cachedCodemap(appDir, { env = process.env, build = buildCodemap } = {}) {
  const t0 = process.hrtime.bigint()
  const done = (map, source, file) => ({ map, source, ms: Number(process.hrtime.bigint() - t0) / 1e6, cacheFile: file })
  const root = resolve(appDir)
  const head = git(root, ['rev-parse', 'HEAD'])?.trim() || null
  if (!head) return done(build(root), 'built-uncached', null)
  const file = codemapCacheFile(env, root)
  const dirty = sourceDirty(root)
  if (!dirty && existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'))
      if (c && c.commit === head && c.meerkat === VERSION && c.schemaVersion === SCHEMA_VERSION && c.map?.files) return done(c.map, 'cache', file)
    } catch {
      /* unreadable cache: rebuild */
    }
  }
  const map = build(root)
  if (dirty) return done(map, 'built-uncached', file)
  try {
    mkdirSync(cacheHome(env), { recursive: true })
    writeAtomic(file, JSON.stringify({ schemaVersion: SCHEMA_VERSION, meerkat: VERSION, commit: head, map }))
  } catch {
    /* a cache that cannot be written is only slower */
  }
  return done(map, 'built', file)
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
  if (meta) L.push(`map: ${meta.source} in ${Math.round(meta.ms)} ms`)
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
  const mapInfo = { source: meta.source, ms: Math.round(meta.ms) }
  out(json ? JSON.stringify({ ...r, map: mapInfo }, null, 2) : blastText(r, mapInfo).trimEnd())
  return r.found ? 0 : EXIT_NOT_FOUND
}
