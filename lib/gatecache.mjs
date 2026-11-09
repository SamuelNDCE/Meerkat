// The gate's own result cache: a check whose inputs are exactly what they were at its last run is not run again.
//
// The inputs of a check are the whole tracked project (every file's size, time and content hash: lib/integrity.mjs), the commit it sits on,
// the Meerkat version, the tier, the check id, and the settings that change a verdict (every `.meerkat*` file in the project root, even an
// untracked one, and the MEERKAT_* environment). If any of that differs, the check runs. Unlike the full run's cache (lib/resultcache.mjs,
// passes only) this one keeps a FAIL too, because the same inputs give the same findings and the gate must show them again. A check that
// could not run, crashed or hung is never kept. A run that wrote into the project keeps nothing. `--no-cache` turns it off.
// Stored beside the full-run cache, one file per project, at most 512 KB, atomically written.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic, projectSlug } from './findingshistory.mjs'
import { cacheHome, CACHE_MAX_AGE_MS, CACHE_MAX_BYTES } from './resultcache.mjs'
import { snapshotDigest, snapshotTree } from './integrity.mjs'

export const gateCacheFile = (env, projectPath) => join(cacheHome(env), `${projectSlug(projectPath)}--gate.json`).split('\\').join('/')

// The hash of the settings that are not tracked files but change what a check says.
export function settingsDigest(dirs, env = process.env) {
  const h = createHash('sha256')
  for (const d of [...new Set(dirs)]) {
    let names = []
    try {
      names = readdirSync(d).filter((n) => /^\.meerkat/i.test(n) || n === 'meerkat.config.json' || n === 'meerkat.order.json').sort()
    } catch {
      /* no such folder */
    }
    for (const n of names) {
      try {
        h.update(`${n}\0${createHash('sha256').update(readFileSync(join(d, n))).digest('hex')}\n`)
      } catch {
        /* unreadable: it counts as absent */
      }
    }
  }
  for (const k of Object.keys(env).filter((x) => /^MEERKAT_/.test(x) && x !== 'MEERKAT_LOG_DIR').sort()) h.update(`${k}=${env[k]}\n`)
  return h.digest('hex')
}

// One digest for the project state this gate run sees. Null when git cannot list the files (then nothing is cached).
export function stateDigest({ repoRoot, appDir, head, env = process.env }) {
  const snap = snapshotTree(repoRoot)
  if (!snap) return null
  return createHash('sha256').update([snapshotDigest(snap), head ?? '-', settingsDigest([repoRoot, appDir], env)].join('|')).digest('hex')
}

export const gateKey = ({ digest, tier, version, checkId }) => createHash('sha256').update([digest, tier ?? '-', version ?? '-', checkId].join('|')).digest('hex').slice(0, 32)

export function readGateCache(file) {
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'))
    if (c && c.schemaVersion === 1 && c.entries && typeof c.entries === 'object') return c
  } catch {
    /* no cache yet, or unreadable: start again */
  }
  return { schemaVersion: 1, entries: {} }
}

// A hit: the stored row, when the key matches and the entry is fresh.
export function gateCacheHit(cache, checkId, key, now = Date.now()) {
  const e = cache?.entries?.[checkId]
  if (!e || e.key !== key || (e.row?.kind !== 'pass' && e.row?.kind !== 'fail')) return null
  if (e.row.kind === 'fail' && !Array.isArray(e.row.places)) return null // an entry from before places were kept: run the check again
  return now - Date.parse(e.at) < CACHE_MAX_AGE_MS ? e : null
}

// Keeps the pass and fail rows of this run (id, kind, detail, findings). Oldest entries go first when the file would grow past its limit.
export function updatedGateCache(cache, items, now = new Date()) {
  const entries = { ...(cache?.entries ?? {}) }
  for (const it of items) if (it.row.kind === 'pass' || it.row.kind === 'fail') entries[it.row.id] = { key: it.key, at: now.toISOString(), row: { id: it.row.id, kind: it.row.kind, detail: String(it.row.detail ?? '').slice(0, 2000), findings: (it.row.findings ?? []).slice(0, 200), files: (it.row.files ?? []).slice(0, 500), ...(it.row.kind === 'fail' ? { places: (it.row.places ?? []).slice(0, 500) } : {}) } }
  let text = JSON.stringify({ schemaVersion: 1, entries })
  const ids = Object.keys(entries).sort((a, b) => String(entries[a].at).localeCompare(String(entries[b].at)))
  while (text.length > CACHE_MAX_BYTES && ids.length) {
    delete entries[ids.shift()]
    text = JSON.stringify({ schemaVersion: 1, entries })
  }
  return { cache: { schemaVersion: 1, entries }, text }
}

export function saveGateCache(env, projectPath, text, io = {}) {
  return writeAtomic(gateCacheFile(env, projectPath), text, io)
}

export const gateCacheExists = (env, projectPath) => existsSync(gateCacheFile(env, projectPath))

// ---- narrower keys for checks that never read source text (see LAYOUT_CHECKS in lib/gatepaths.mjs) ----
const SOURCE_EXT = /\.(m?[jt]sx?|cjs|cts|vue|svelte|pyi?|rs|go|java|kt|cs|rb|php|c|cc|cpp|h|hpp|swift|dart|lua|sh|bash|ps1|html?|s?css|less|sql)$/i

// All tracked file names, and the content of every tracked file that is not source code. A source edit leaves it unchanged; adding, removing
// or renaming any file, or editing a document or config file, changes it.
export function layoutDigest(repoRoot) {
  const r = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 2 ** 20 })
  if (r.status !== 0) return null
  const names = r.stdout.split('\0').filter(Boolean).sort()
  const snap = snapshotTree(repoRoot, { list: () => names.filter((n) => !SOURCE_EXT.test(n)) })
  return createHash('sha256').update(`${createHash('sha256').update(names.join('\n')).digest('hex')}|${snapshotDigest(snap)}`).digest('hex')
}

// The commits, branches, tags and git settings the history checks read.
export function gitStateDigest(repoRoot) {
  const run = (...a) => spawnSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 })
  const parts = [run('rev-parse', 'HEAD'), run('for-each-ref'), run('config', '-l'), run('rev-parse', '--is-shallow-repository')]
  return createHash('sha256').update(parts.map((p) => `${p.status}:${p.stdout}`).join('\0')).digest('hex')
}

// A digest of the code that decides a check's result. The cache key includes it, so a change to how results are read or classified
// (a fix to the gate or the runner) never reuses a result the old code produced. Before this, the key used only the package version,
// which does not change between commits, so a stale "wide" row was served from cache after the fix (NeuralVault, ab06a25).
import { fileURLToPath } from 'node:url'
const RESULT_CODE = ['gate.mjs', 'runner.mjs', 'gatecache.mjs', 'timeouts.mjs', 'integrity.mjs', '../packs/rust/rust.mjs']
let codeDigestCache = null
export function codeDigest() {
  if (codeDigestCache) return codeDigestCache
  const h = createHash('sha256')
  for (const f of RESULT_CODE) {
    try {
      h.update(readFileSync(fileURLToPath(new URL(f, import.meta.url))))
    } catch {
      h.update(`missing:${f}`)
    }
  }
  codeDigestCache = h.digest('hex').slice(0, 16)
  return codeDigestCache
}
