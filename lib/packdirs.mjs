// Where a pack lives, shared by `meerkat pack` (lib/packs.mjs) and the loader (lib/config.mjs) so they always agree.
// A folder given to `meerkat pack add` may hold packs (each subfolder is one pack) or may itself be one pack (it has a pack.json).
// A pack's name is the "pack" (or "name") in its pack.json when that is a valid name, else the folder name.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const NAME = /^[a-z0-9-]+$/

export function packNameOf(dir) {
  try {
    const j = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
    for (const k of ['pack', 'name']) if (typeof j?.[k] === 'string' && NAME.test(j[k])) return j[k]
  } catch {
    /* no pack.json, or not valid: use the folder name */
  }
  const b = basename(resolve(dir)).toLowerCase()
  return NAME.test(b) ? b : null
}

// A folder is itself a pack when it has a pack.json or holds check files (*.mjs) directly.
export const isPackFolder = (dir) => {
  if (existsSync(join(dir, 'pack.json'))) return true
  try {
    return readdirSync(dir).some((n) => n.endsWith('.mjs') && !n.endsWith('.test.mjs'))
  } catch {
    return false
  }
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Every pack in a folder from `pack add`: the folder itself when it has a pack.json, plus each subfolder, as { name, dir }.
export function packsIn(dir) {
  const out = []
  if (isPackFolder(dir)) {
    const name = packNameOf(dir)
    if (name) out.push({ name, dir: resolve(dir) })
  }
  let subs = []
  try {
    subs = readdirSync(dir).filter((n) => !n.startsWith('.') && NAME.test(n) && isDir(join(dir, n))).sort()
  } catch {
    /* unreadable folder: no packs */
  }
  for (const n of subs) {
    const d = join(dir, n)
    out.push({ name: n, dir: d })
    const alias = packNameOf(d)
    if (alias && alias !== n && existsSync(join(d, 'pack.json'))) out.push({ name: alias, dir: d })
  }
  return out
}

// The folder of the pack called `name` among the folders from `pack add`, or null.
export function findInPackDirs(name, dirs) {
  for (const d of dirs ?? []) {
    const hit = packsIn(d).find((p) => p.name === name)
    if (hit) return hit.dir
  }
  return null
}
