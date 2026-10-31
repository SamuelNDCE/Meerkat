// Where things are, now that Meerkat lives in its own repo and checks an app that lives somewhere else.
//   MEERKAT_DIR  this repo's root (the checks, fixtures and scripts that ship with the tool)
//   the app      the folder being checked. Given by --app, else MEERKAT_APP_DIR, else the folder the command was started in.
//                Its repo root is what git says, else two levels up.
// Nothing here is a fixed path: everything is worked out from where the tool and the app actually are.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MEERKAT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')

export function appDirOf(env = process.env, cwd = process.cwd()) {
  return resolve(env.MEERKAT_APP_DIR || env.NV_APP_DIR || cwd)
}

// The repository root of an app folder: what git says, else two levels up. Remembered per folder.
const roots = new Map()
export function repoRootOf(appDir) {
  if (!roots.has(appDir)) {
    let top = null
    try {
      top = execFileSync('git', ['-C', appDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      /* not a git repository */
    }
    roots.set(appDir, top ? resolve(top) : resolve(appDir, '..', '..'))
  }
  return roots.get(appDir)
}

// null when the folder looks like an app Meerkat can drive, else one plain sentence saying what to do.
export function appProblem(appDir, exists = existsSync) {
  if (exists(join(appDir, 'scripts', 'electron-run.mjs'))) return null
  return `${appDir} is not the app to check (no scripts/electron-run.mjs). Start Meerkat from the app folder, or pass --app <folder> (or set MEERKAT_APP_DIR).`
}

// Load a script that belongs to the app (the window lock lives with the app's own drivers, so Meerkat and the
// drivers always queue on the same lock).
export async function importFromApp(appDir, relative) {
  return import(pathToFileURL(join(appDir, relative)).href)
}
