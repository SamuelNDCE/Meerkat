// Electron and desktop-framework checks (the ep-* checks): deeper rules than the desktop pack, built from the rule tables in
// thorough/rules-electron-plus.mjs. Run through the electron-plus pack, or by hand:
//   node thorough/electron-plus.mjs <check> [--root <dir>]      node thorough/electron-plus.mjs <check> --fixtures   (must exit 1)
// The three Electron checks print one NA line per rule and exit 0 when the folder is not an Electron project (package.json
// depends on electron, electron-builder or @electron-forge, or a forge or electron-builder config file exists).
// The Tauri check has no project gate: each of its rules reads only the files of its own framework, so it is NA when that
// framework's files are absent. A finding you accept goes in .meerkat-electronplus-allow as "<rule-id> <path>" or "<rule-id> *".
import { main, readText, trackedFiles, withFixture } from './kit.mjs'
import { scanRules } from './rules.mjs'
import { CHECK_TABLES } from './rules-electron-plus.mjs'

const ALLOW = '.meerkat-electronplus-allow'
const SKIP_DIRS = /(^|\/)(fixtures?|tests?|__tests__|examples?|docs?|node_modules)\//i

// True when the tracked package.json files name Electron or its builders, or a build config file is tracked.
export function isElectronProject(root) {
  const files = trackedFiles(root).filter((f) => !SKIP_DIRS.test(f))
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x))) {
    try {
      const j = JSON.parse(readText(root, f))
      const deps = { ...j.dependencies, ...j.devDependencies }
      if (deps.electron || deps['electron-builder'] || Object.keys(deps).some((k) => k.startsWith('@electron-forge/')) || j.build) return true
    } catch {
      // not a readable manifest: skip it
    }
  }
  return files.some((f) => /(^|\/)(forge\.config\.[cm]?[jt]s|electron-builder\.[A-Za-z0-9]+)$/.test(f))
}

// Electron checks are gated on the project; the Tauri check is gated per rule by file match (see the header).
const GATED = new Set(['ep-window', 'ep-ipc-preload', 'ep-fuses-build', 'ep-content-renderer'])

// A sample file for one rule in the --fixtures tree: its own sample name when it has one, else sample.<first ext>.
const sampleName = (r) => r.sample ?? `sample.${(r.ext ?? ['txt'])[0]}`

const fixtureFiles = (table) => {
  const out = { 'package.json': '{\n  "name": "fixture",\n  "devDependencies": { "electron": "41.0.0" }\n}\n' }
  table.forEach((r, i) => {
    out[`s${i}/${sampleName(r)}`] = r.bad
  })
  return out
}

const checks = {}
for (const [id, table] of Object.entries(CHECK_TABLES)) {
  const run = (root) => {
    if (GATED.has(id) && !isElectronProject(root)) {
      for (const r of table) console.log(`MEERKAT-SUB NA ${r.id} ${String(r.title).slice(0, 120)}`)
      console.log(`${id}: not an Electron project, so there is nothing to check`)
      return 0
    }
    return scanRules(id, root, table, { allowFile: ALLOW, okNote: 'no risky Electron or desktop setting found' })
  }
  checks[id] = { run, fixture: () => withFixture(fixtureFiles(table), run) }
}

await main(checks)
