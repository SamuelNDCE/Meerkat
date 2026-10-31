// Is a binary on PATH? On Windows also tries the PATHEXT extensions (.exe, .cmd, ...).
import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export function findBinary(name, env = process.env, platform = process.platform) {
  const pathVar = env.PATH ?? env.Path ?? ''
  const exts = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean)] : ['']
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

// Project-local tools (eslint, tsc, vitest and the like) live in node_modules/.bin, which is not on PATH unless an npm script starts them.
// Meerkat puts the app's and the repository's folders first, as npm does, so a check can name a tool the project installed for itself.
export function localPath(env = process.env, dirs = []) {
  const bins = [...new Set(dirs.filter(Boolean).map((d) => join(d, 'node_modules', '.bin')))].filter((d) => existsSync(d))
  if (!bins.length) return {}
  const value = [...bins, env.PATH ?? env.Path ?? ''].join(delimiter)
  return { PATH: value, Path: value }
}
