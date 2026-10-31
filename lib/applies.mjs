// Does a check apply to this folder at all? A check can name the files it is about in `appliesTo` (the same globs as `paths`): a Go check on
// a project with no Go files, or cargo on a folder with no Cargo.toml, has nothing to look at. The runner then reports a PASS that says
// "not applicable" instead of running the tool (which would fail with "no go.mod" or "could not find Cargo.toml").
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { matchesAny } from './glob.mjs'
import { resolveCwd } from './lanes.mjs'

const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'vendor', '.terraform', '.dart_tool', 'obj'])
const MAX_FILES = 20000
const cache = new Map()

// The files under a folder (relative, forward slashes), without build output and dependencies. Kept for a few seconds so that the many
// checks of one run share one walk.
export function filesUnder(root, now = Date.now()) {
  const hit = cache.get(root)
  if (hit && now - hit.at < 15_000) return hit.files
  const files = []
  const walk = (dir, rel, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && depth < 8) walk(join(dir, e.name), `${rel}${e.name}/`, depth + 1)
      } else files.push(`${rel}${e.name}`)
    }
  }
  walk(root, '', 0)
  cache.set(root, { at: now, files })
  return files
}

// null when the check applies (or does not say), else the sentence for the PASS.
export function notApplicable(check, ctx) {
  const globs = check.appliesTo
  if (!Array.isArray(globs) || !globs.length) return null
  const root = resolveCwd(check.run && typeof check.run === 'object' ? check.run.cwd : 'repo', ctx)
  if (matchesAny(globs, filesUnder(root))) return null
  return `not applicable: no ${globs.slice(0, 3).join(', ')} here, so there is nothing for this check to look at`
}
