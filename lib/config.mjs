// Making Meerkat fit a project: which checks run, which tool a check uses, and how much the machine is given. A project keeps a
// `meerkat.config.json` (no code) next to its app, or in its repo root, or names one with `--config`:
//
//   {
//     "builtin": true,
//     "extraChecks": ["tools/meerkat-checks"],
//     "disable": ["ui-axe"],
//     "override": {
//       "type-check": { "run": { "cmd": "pnpm", "args": ["tsc", "--noEmit"] }, "tier": "fast", "estSeconds": 8 },
//       "unit-tests": { "cost": { "cpu": 6, "memGB": 4 } }
//     },
//     "budget": { "cpu": 8, "reserveGB": 4 }
//   }
//
//   builtin       use Meerkat's own checks (default true); false means only the project's own
//   packs         ready-made sets that fit any project: "rust" (fmt, clippy, test, audit, release build), "security" (secret scan, full npm audit)
//   extraChecks   folders of check files, relative to the config file, in the same shape as checks/*.mjs. A check there with the
//                 same id as a built-in one REPLACES it, so a tool can be swapped for another
//   disable       ids to turn off; every run lists them, so a turned-off check is never silent
//   override      per check: tier, lane, estSeconds, cost, timeoutSeconds, paths, after, needs, optIn, title, and `run` (cmd, args,
//                 cwd, env) to run a different tool for the same job, with `selfTest` for the broken case that tool must fail
//   budget        how much a run may use at once (threads, and memory to leave free)
//   presets       your own named runs: { "before-release": { "tier": "thorough", "groups": ["security"] } }, used with --preset
//
// A mistake in the file is reported as a note on every run and the rest of the file still applies, so a typo never stops a run.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { loadChecks, validateCheck } from './load-checks.mjs'

export const CONFIG_NAME = 'meerkat.config.json'
const OVERRIDE_KEYS = ['title', 'group', 'tier', 'lane', 'estSeconds', 'timeoutSeconds', 'cost', 'paths', 'after', 'needs', 'optIn', 'alone', 'weight', 'supersededBy', 'fastWhenAll', 'run', 'selfTest']
const RUN_KEYS = ['cmd', 'args', 'cwd', 'env']

// The config file to use, or null: the one named on the command line, else the app's, else the repository's.
export function findConfig({ explicit, appDir, repoRoot, exists = existsSync }) {
  if (explicit) return resolve(explicit)
  for (const dir of [appDir, repoRoot]) if (dir && exists(join(dir, CONFIG_NAME))) return join(dir, CONFIG_NAME)
  return null
}

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// Read and check the file. Returns { config, notes }; never throws.
export function readConfig(file, read = (f) => readFileSync(f, 'utf8')) {
  const notes = []
  let raw
  try {
    raw = JSON.parse(read(file))
  } catch (e) {
    return { config: {}, notes: [`${file}: could not be read as JSON (${String(e.message).split('\n')[0]}); it is ignored`] }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { config: {}, notes: [`${file}: must be a JSON object; it is ignored`] }
  const config = { packs: [], extraChecks: [], disable: [], override: {}, budget: null, presets: {} }
  if (raw.packs !== undefined) {
    if (isStrings(raw.packs) && raw.packs.every((p) => /^[a-z0-9-]+$/.test(p))) config.packs = raw.packs
    else notes.push('"packs" must be a list of pack names such as ["rust", "security"]; ignored')
  }
  if (raw.presets && typeof raw.presets === 'object' && !Array.isArray(raw.presets)) config.presets = raw.presets
  else if (raw.presets !== undefined) notes.push('"presets" must be an object of named runs; ignored')
  if (raw.extraChecks !== undefined) {
    if (isStrings(raw.extraChecks)) config.extraChecks = raw.extraChecks
    else notes.push('"extraChecks" must be a list of folder names; ignored')
  }
  if (raw.disable !== undefined) {
    if (isStrings(raw.disable)) config.disable = raw.disable
    else notes.push('"disable" must be a list of check ids; ignored')
  }
  if (raw.override && typeof raw.override === 'object' && !Array.isArray(raw.override)) {
    for (const [id, o] of Object.entries(raw.override)) {
      if (!o || typeof o !== 'object') {
        notes.push(`override "${id}" must be an object; ignored`)
        continue
      }
      const clean = {}
      for (const [k, v] of Object.entries(o)) {
        if (!OVERRIDE_KEYS.includes(k)) notes.push(`override "${id}": "${k}" is not something that can be changed; ignored`)
        else clean[k] = v
      }
      if (clean.run) clean.run = Object.fromEntries(Object.entries(clean.run).filter(([k]) => RUN_KEYS.includes(k)))
      config.override[id] = clean
    }
  } else if (raw.override !== undefined) notes.push('"override" must be an object; ignored')
  const b = raw.budget
  if (b && typeof b === 'object') {
    config.budget = {}
    if (Number.isInteger(b.cpu) && b.cpu >= 1) config.budget.cpu = b.cpu
    else if (b.cpu !== undefined) notes.push('"budget.cpu" must be a whole number of threads, 1 or more; ignored')
    if (Number.isInteger(b.maxParallel) && b.maxParallel >= 1) config.budget.maxParallel = b.maxParallel
    else if (b.maxParallel !== undefined) notes.push('"budget.maxParallel" must be a whole number, 1 or more; ignored')
    if (typeof b.reserveGB === 'number' && b.reserveGB >= 0) config.budget.reserveGB = b.reserveGB
    else if (b.reserveGB !== undefined) notes.push('"budget.reserveGB" must be a number of GB, 0 or more; ignored')
  }
  return { config, notes }
}

// Apply a config to the built-in checks. Returns { checks, disabled, notes }. A check turned off is returned in `disabled` (with
// the reason) and not in `checks`, so the caller can list it.
export async function applyConfig(builtIn, config, { file, load = loadChecks } = {}) {
  const notes = []
  const where = file ? dirname(file) : process.cwd()
  let checks = [...builtIn]
  // Packs ship with Meerkat (packs/<name>/): rust, security. A pack's check with the id of one already there replaces it.
  for (const name of config.packs ?? []) {
    // packs/<name> ships with Meerkat; examples/<name> holds the checks of one real app, used the same way.
    const dirs = [resolve(MEERKAT_DIR, 'packs', name), resolve(MEERKAT_DIR, 'examples', name)]
    const more = await load(dirs.find((d) => existsSync(d)) ?? dirs[0])
    if (!more.length) notes.push(`pack "${name}": not found or empty`)
    for (const c of more) {
      const i = checks.findIndex((x) => x.id === c.id)
      if (i >= 0) checks[i] = { ...c, source: `pack ${name}` }
      else checks.push({ ...c, source: `pack ${name}` })
    }
  }
  for (const dir of config.extraChecks ?? []) {
    const more = await load(resolve(where, dir))
    if (!more.length) notes.push(`extraChecks "${dir}": no checks found there`)
    for (const c of more) {
      const i = checks.findIndex((x) => x.id === c.id)
      if (i >= 0) {
        checks[i] = { ...c, source: `${dir} (replaces the built-in ${c.id})` }
        notes.push(`${c.id}: swapped for the one in ${dir}`)
      } else checks.push({ ...c, source: dir })
    }
  }
  for (const [id, o] of Object.entries(config.override ?? {})) {
    const i = checks.findIndex((c) => c.id === id)
    if (i < 0) {
      notes.push(`override "${id}": no such check; ignored`)
      continue
    }
    const merged = { ...checks[i], ...o }
    if (o.run) merged.run = typeof checks[i].run === 'function' && !o.run.cmd ? checks[i].run : { ...(typeof checks[i].run === 'object' ? checks[i].run : {}), ...o.run }
    const bad = validateCheck(merged)
    if (bad) notes.push(`override "${id}": ${bad}; ignored`)
    else {
      checks[i] = { ...merged, overridden: true }
      // A changed tool has to prove it still fails on a broken case: the old self-test belonged to the old tool, so it is dropped unless
      // the config gives a new one (`selfTest`: cmd, args, cwd, env, expectFail). With none, `--self-test` fails for that check, loudly.
      if (o.run && !o.selfTest) delete checks[i].selfTest
    }
  }
  const disabled = []
  for (const id of config.disable ?? []) {
    const c = checks.find((x) => x.id === id)
    if (!c) {
      notes.push(`disable "${id}": no such check; ignored`)
      continue
    }
    disabled.push({ id, title: c.title })
    checks = checks.filter((x) => x.id !== id)
  }
  return { checks, disabled, notes }
}
