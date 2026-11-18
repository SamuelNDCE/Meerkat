// A total size cap on the saved run folders (`<log folder>/runs`). After a run is written, the oldest finished run folders are removed until the
// whole `runs` folder fits under the cap, so the newest runs always stay. The cap is MEERKAT_LOG_MAX_MB (default 2048 MB; 0 turns the cap off).
// Never removed: the run that just finished (`keep`), a run still being written (no summary.json yet), and the run `latest.json` points at.
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { logRoot, parseRunName } from './runlog.mjs'

export const DEFAULT_LOG_MAX_MB = 2048

export function logCapBytes(env = process.env) {
  const raw = env.MEERKAT_LOG_MAX_MB
  if (raw === undefined || raw === '') return DEFAULT_LOG_MAX_MB * 1024 * 1024
  const mb = Number(raw)
  return Number.isFinite(mb) && mb >= 0 ? mb * 1024 * 1024 : DEFAULT_LOG_MAX_MB * 1024 * 1024
}

function dirBytes(dir) {
  let total = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) total += dirBytes(p)
      else if (e.isFile()) total += lstatSync(p).size
    }
  } catch {
    /* a folder that vanished while it was counted adds nothing */
  }
  return total
}

// Returns the names of the run folders removed. Never throws: an old log that cannot be removed is only clutter.
export function pruneRunsBySize(env = process.env, { keep = null } = {}) {
  const cap = logCapBytes(env)
  if (!cap) return []
  const removed = []
  try {
    const root = join(logRoot(env), 'runs')
    let latest = null
    try {
      latest = basename(JSON.parse(readFileSync(join(logRoot(env), 'latest.json'), 'utf8')).dir ?? '')
    } catch {
      /* no pointer yet */
    }
    const protect = new Set([keep ? basename(keep) : null, latest])
    const rows = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, stamp: parseRunName(e.name).stamp ?? '', bytes: dirBytes(join(root, e.name)) }))
      .sort((a, b) => b.stamp.localeCompare(a.stamp) || (b.name < a.name ? -1 : b.name > a.name ? 1 : 0)) // newest first
    let total = rows.reduce((n, r) => n + r.bytes, 0)
    for (const r of rows.reverse()) { // oldest first
      if (total <= cap) break
      if (protect.has(r.name) || !existsSync(join(root, r.name, 'summary.json'))) continue
      rmSync(join(root, r.name), { recursive: true, force: true })
      total -= r.bytes
      removed.push(r.name)
    }
  } catch {
    /* a missing runs folder or an unreadable one means nothing to prune */
  }
  return removed
}
