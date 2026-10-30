// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

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
