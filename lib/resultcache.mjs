// Result cache: a check that PASSED on exactly this project (same file snapshot, same commit, same preset tier, same Meerkat
// version) and less than six hours ago is not run again; its earlier passing result is reused and marked as cached.
// Only passes are cached (a failure is always re-run), a run that wrote into the project caches nothing, and `--no-cache` turns it off.
// Stored under ~/.meerkat/cache/ (or MEERKAT_LOG_DIR/cache), one file per project, atomically written, at most 512 KB.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { projectSlug, writeAtomic } from './findingshistory.mjs'

export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const CACHE_MAX_BYTES = 512 * 1024

export const cacheHome = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'cache') : join(home, '.meerkat', 'cache'))
export const cacheFile = (env, projectPath, home = homedir()) => join(cacheHome(env, home), `${projectSlug(projectPath)}.json`).split('\\').join('/')

// One key for one check on one state of the project.
export function cacheKey({ digest, head, tier, version, checkId }) {
  return createHash('sha256').update([digest, head ?? '-', tier ?? '-', version ?? '-', checkId].join('|')).digest('hex').slice(0, 32)
}

export function readCache(file) {
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'))
    if (c && c.schemaVersion === 1 && c.entries && typeof c.entries === 'object') return c
  } catch {
    /* no cache yet, or unreadable: start again */
  }
  return { schemaVersion: 1, entries: {} }
}

// A hit: the stored result, when the key matches and the entry is fresh.
export function cacheHit(cache, checkId, key, now = Date.now()) {
  const e = cache?.entries?.[checkId]
  if (!e || e.key !== key || e.status !== 'PASS') return null
  if (!(now - Date.parse(e.at) < CACHE_MAX_AGE_MS)) return null
  return e
}

// Stores the passing results of a run. Keeps only the fields the result tables read, and never a check's whole output.
export function updatedCache(cache, passes, now = new Date()) {
  const entries = { ...(cache?.entries ?? {}) }
  for (const p of passes) entries[p.id] = { key: p.key, status: 'PASS', at: now.toISOString(), result: slim(p.result) }
  // Oldest entries go first when the file would grow past its limit.
  let text = JSON.stringify({ schemaVersion: 1, entries })
  const ids = Object.keys(entries).sort((a, b) => String(entries[a].at).localeCompare(String(entries[b].at)))
  while (text.length > CACHE_MAX_BYTES && ids.length) {
    delete entries[ids.shift()]
    text = JSON.stringify({ schemaVersion: 1, entries })
  }
  return { cache: { schemaVersion: 1, entries }, text }
}

function slim(r) {
  const { id, title, suite, group, tier, status, ms, subs, origin, weight, ...rest } = r ?? {}
  void rest
  return { id, title, suite, group, tier, status: 'PASS', ms: 0, subs: Array.isArray(subs) ? subs.slice(0, 200) : undefined, origin, weight }
}

export function saveCache(env, projectPath, text, io = {}) {
  try {
    ;(io.mkdirSync ?? mkdirSync)(cacheHome(env), { recursive: true, mode: 0o700 })
  } catch {
    return false
  }
  return writeAtomic(cacheFile(env, projectPath), text, io)
}

export const cacheExists = (env, projectPath) => existsSync(cacheFile(env, projectPath))
