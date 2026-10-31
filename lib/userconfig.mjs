// Settings that belong to the person, not the project: ~/.meerkat.json (or the file named by MEERKAT_USER_CONFIG).
//   presets   { "my-run": { "tier": "fast", "groups": ["security"], "about": "..." } }   personal presets, used in every project
//   updates   "off" (default) | "notify" | "auto"                                       what `meerkat` may do about new versions
//   packDirs  ["C:/my/meerkat-packs"]                                                   extra folders of packs, found by name
//   recent    ["C:/code/app"]                                                           projects used lately, newest first, at most 12 (paths only)
// The same file already holds { "cargoLock": ..., "electronLock": ... } (lib/lanes.mjs); this module leaves keys it does not own alone.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { stripControl } from './tui/safe.mjs'

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

// ---- recent projects: paths only, checked every time they are read (a string, absolute, no control characters, still a folder) ----
export const RECENT_MAX = 12
const isDirDefault = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
const pathKey = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

export function readRecent(env = process.env, home = homedir(), isDir = isDirDefault) {
  const raw = readUserConfig(env, home).recent
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const p of raw) {
    if (typeof p !== 'string' || !p || stripControl(p) !== p || !isAbsolute(p) || !isDir(p)) continue
    const key = pathKey(p)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= RECENT_MAX) break
  }
  return out
}

// Puts a folder first in the recent list. Returns the new list; a folder that does not exist or has odd characters is not added.
export function addRecent(folder, env = process.env, home = homedir(), isDir = isDirDefault) {
  const abs = resolve(String(folder ?? ''))
  const current = readRecent(env, home, isDir)
  if (!folder || stripControl(abs) !== abs || !isDir(abs)) return current
  const next = [abs, ...current.filter((p) => pathKey(p) !== pathKey(abs))].slice(0, RECENT_MAX)
  writeUserConfig({ recent: next }, env, home)
  return next
}

export function clearRecent(env = process.env, home = homedir()) {
  writeUserConfig({ recent: null }, env, home)
}
