// Settings that belong to the person, not the project: ~/.meerkat.json (or the file named by MEERKAT_USER_CONFIG).
//   presets   { "my-run": { "tier": "fast", "groups": ["security"], "about": "..." } }   personal presets, used in every project
//   updates   "off" (default) | "notify" | "auto"                                       what `meerkat` may do about new versions
//   packDirs  ["C:/my/meerkat-packs"]                                                   extra folders of packs, found by name
// The same file already holds { "cargoLock": ..., "electronLock": ... } (lib/lanes.mjs); this module leaves keys it does not own alone.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const userConfigPath = (env = process.env, home = homedir()) => env.MEERKAT_USER_CONFIG || join(home, '.meerkat.json')

export function readUserConfig(env = process.env, home = homedir()) {
  try {
    const raw = JSON.parse(readFileSync(userConfigPath(env, home), 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

// Merge `patch` into the file (top-level keys replace; null removes a key). Returns the new contents.
export function writeUserConfig(patch, env = process.env, home = homedir()) {
  const file = userConfigPath(env, home)
  const next = { ...readUserConfig(env, home) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k]
    else next[k] = v
  }
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export const UPDATE_MODES = ['off', 'notify', 'auto']
export const updateMode = (env = process.env, home = homedir()) => {
  const m = readUserConfig(env, home).updates
  return UPDATE_MODES.includes(m) ? m : 'off'
}
