// Is a binary on PATH? On Windows also tries the PATHEXT extensions (.exe, .cmd, ...).
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export function findBinary(name, env = process.env, platform = process.platform) {
  const pathVar = env.PATH ?? env.Path ?? ''
  const exts = platform === 'win32' ? [...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean), ''] : ['']
  for (const dir of pathVar.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = join(dir, name + ext)
      try {
        if (existsSync(full) && statSync(full).isFile()) return full
      } catch {
        // unreadable entry: keep looking
      }
    }
  }
  return null
}

export function missingBinaries(needs = [], env = process.env, platform = process.platform) {
  return needs.filter((n) => !findBinary(n, env, platform))
}

// Meerkat's own private tool cache: `meerkat tools install` puts npm-based tools here (never in the project, never global).
export function toolsHome(env = process.env, home = homedir()) {
  return env.MEERKAT_TOOLS_DIR || join(env.MEERKAT_HOME || join(home, '.meerkat'), 'tools')
}

const isDir = (d) => {
  try {
    return statSync(d).isDirectory()
  } catch {
    return false
  }
}

// Where Meerkat looks for a tool the machine's PATH does not list, in this order:
//   the project's node_modules/.bin, its python venv (.venv or venv: Scripts on Windows, bin elsewhere), Meerkat's private tool cache,
//   cargo bin, Go bin, dotnet tools.
export function extraToolDirs(env = process.env, dirs = [], home = homedir()) {
  const list = []
  for (const d of new Set(dirs.filter(Boolean))) {
    list.push(join(d, 'node_modules', '.bin'))
    for (const v of ['.venv', 'venv']) list.push(join(d, v, 'Scripts'), join(d, v, 'bin'))
  }
  list.push(join(toolsHome(env, home), 'node_modules', '.bin'))
  list.push(join(env.CARGO_HOME || join(home, '.cargo'), 'bin'))
  list.push(env.GOBIN || join(env.GOPATH ? env.GOPATH.split(delimiter)[0] : join(home, 'go'), 'bin'))
  list.push(join(home, '.dotnet', 'tools'))
  return [...new Set(list)].filter(isDir)
}

// Project-local tools (eslint, tsc, vitest and the like) live in node_modules/.bin, which is not on PATH unless an npm script starts them.
// The extra folders go AFTER the existing PATH, never before it: a folder inside the project must not be able to shadow node, python, git or cargo.
// On Windows the .cmd shims resolve because findBinary tries PATHEXT.
export function localPath(env = process.env, dirs = [], home = homedir()) {
  const bins = extraToolDirs(env, dirs, home)
  if (!bins.length) return {}
  const value = [env.PATH ?? env.Path ?? '', ...bins].join(delimiter)
  return { PATH: value, Path: value }
}

// Programs `meerkat tools install` can put in the private cache.
export const NPM_TOOLS = new Set(['eslint', 'prettier', 'tsc', 'madge', 'htmlhint', 'stylelint', 'markdownlint-cli2'])

// The one-line reason shown when a check is NOT RUN for a missing tool: "needs prettier: meerkat tools install".
export function missingReason(tools = [], install = '') {
  const npm = tools.length > 0 && tools.every((t) => NPM_TOOLS.has(t))
  return `needs ${tools.join(', ')}: ${npm || !install ? 'meerkat tools install' : install}`
}
