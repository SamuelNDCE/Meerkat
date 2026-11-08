// The first-run note: a project with no meerkat.config.json gets only the packs that fit the folder, and some checks need tools that are not installed,
// so a first run can look cleaner than it is. This prints ONE note, once per project, that says so and suggests `meerkat init --profile solo` (or team).
// "Once per project" is a marker file in the Meerkat data folder (next to the logs: MEERKAT_LOG_DIR, else ~/.meerkat). Never in --plain, --json or --quiet output.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { toolsReport } from './tools.mjs'

export const firstRunDir = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'first-run') : join(home, '.meerkat', 'first-run'))
const markerFile = (dir, env, home) => join(firstRunDir(env, home), `${createHash('sha256').update(resolve(dir).toLowerCase()).digest('hex').slice(0, 16)}.seen`)

// An eslint config in the project folder (flat or legacy).
export function hasEslintConfig(dir) {
  try {
    return readdirSync(dir).some((n) => /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?)$/.test(n))
  } catch {
    return false
  }
}

// The text, or null when nothing should be printed. `find` is passed to the tools report (tests give a fake). Writes the marker only when it returns text.
export function firstRunNote({ dir, configFile = null, env = process.env, home = homedir(), quiet = false, json = false, plain = false, find, write = true } = {}) {
  if (configFile || quiet || json || plain || env.CI || env.MEERKAT_NO_TIP) return null
  const marker = markerFile(dir, env, home)
  if (existsSync(marker)) return null
  const wanted = new Set(['hadolint', 'actionlint', ...(hasEslintConfig(dir) ? ['eslint'] : [])])
  const missing = toolsReport({ env, home, ...(find ? { find } : {}) }).tools.filter((t) => wanted.has(t.bin) && !t.found).map((t) => t.bin)
  const lines = [
    'First run in this project: there is no meerkat.config.json, so Meerkat used the checks that fit this folder and nothing more.',
    ...(missing.length ? [`Not installed, so these checks are NOT RUN: ${missing.join(', ')}. See: meerkat tools`] : []),
    'To set the project up for how you work, run: meerkat init --profile solo   (or --profile team). This note is shown once for this project.',
  ]
  if (write) {
    try {
      mkdirSync(firstRunDir(env, home), { recursive: true })
      writeFileSync(marker, `${new Date().toISOString()}\n`)
    } catch {
      /* a marker that cannot be written only means the note shows again */
    }
  }
  return lines.join('\n')
}
