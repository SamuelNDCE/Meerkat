// The first-run note: a project with no meerkat.config.json gets only the packs that fit the folder, and some checks need tools that are not installed,
// so a first run can look cleaner than it is. This prints ONE note, once per machine, that says so and suggests `meerkat init --profile solo` (or team).
// "Once per machine" is a marker file in the Meerkat data folder (next to the logs: MEERKAT_LOG_DIR, else ~/.meerkat). Never in --plain, --json or --quiet output.
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dataDir } from './datadir.mjs'
import { writeAtomic } from './findingshistory.mjs'
import { toolsReport } from './tools.mjs'

export const firstRunDir = (env = process.env, home = homedir()) => join(dataDir(env, home), 'first-run')
// One marker per machine (not per project): the note is shown once, then never again.
const markerFile = (dir, env, home) => join(firstRunDir(env, home), 'machine.seen')

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
    'To set the project up for how you work, run: meerkat init --profile solo   (or --profile team). This note is shown once on this machine.',
  ]
  if (write) {
    try {
      mkdirSync(firstRunDir(env, home), { recursive: true })
      writeAtomic(marker,`${new Date().toISOString()}\n`)
    } catch {
      /* a marker that cannot be written only means the note shows again */
    }
  }
  return lines.join('\n')
}
