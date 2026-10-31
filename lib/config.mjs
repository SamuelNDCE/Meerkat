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
//   customChecks checks written as data, no code: { id, title, cmd, args, suite, group, tier, cwd, timeoutSeconds, weight, needs, install }; see
//                 lib/customchecks.mjs and docs/customizing.md ("Your own checks"). `suites` names and describes the project's own suites
//   disable       ids to turn off; every run lists them, so a turned-off check is never silent. "suite:<name>" turns off a whole suite
//                 (for example "suite:web-security")
//   disableSubs   sub-checks (rules) to turn off, as "check/sub" (for example "secret-scan/aws-access-key"); a turned-off rule is left out of the
//                 counts, and a check whose only failing rules are turned off passes. A mistake is reported as a note
//   override      per check: tier, lane, estSeconds, cost, timeoutSeconds, paths, after, needs, optIn, title, and `run` (cmd, args,
//                 cwd, env) to run a different tool for the same job, with `selfTest` for the broken case that tool must fail
//   budget        how much a run may use at once (threads, and memory to leave free)
//   presets       your own named runs: { "before-release": { "tier": "thorough", "groups": ["security"] } }, used with --preset
//
// A mistake in the file is reported as a note on every run and the rest of the file still applies, so a typo never stops a run.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { loadChecks, validateCheck } from './load-checks.mjs'
import { cleanAbout, cleanPurpose } from './presets.mjs'
import { entryToCheck, suitesFor, validateCustomChecks, validateSuites } from './customchecks.mjs'
import { isSuite, parseSubRef, setProjectSuites, suiteIdOf } from './suites.mjs'

export const CONFIG_NAME = 'meerkat.config.json'
const OVERRIDE_KEYS = ['title', 'group', 'tier', 'lane', 'estSeconds', 'timeoutSeconds', 'cost', 'paths', 'after', 'needs', 'optIn', 'alone', 'weight', 'supersededBy', 'fastWhenAll', 'run', 'selfTest']
const RUN_KEYS = ['cmd', 'args', 'cwd', 'env']

// The config file to use, or null: the one named on the command line, else the app's, else the repository's.
export function findConfig({ explicit, appDir, repoRoot, exists = existsSync }) {
  if (explicit) return resolve(explicit)
  for (const dir of [appDir, repoRoot]) if (dir && exists(join(dir, CONFIG_NAME))) return join(dir, CONFIG_NAME)
  return null
}

// A preset's `about` and `purpose` are text: cleaned here, and dropped with a note when they are not text. Other keys are left alone.
function cleanPresetTexts(presets, notes) {
  const out = {}
  for (const [name, p] of Object.entries(presets)) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      out[name] = p
      continue
    }
    const next = { ...p }
    for (const [key, clean] of [['about', cleanAbout], ['purpose', cleanPurpose]]) {
      if (!(key in next)) continue
      if (typeof next[key] === 'string') next[key] = clean(next[key])
      else {
        notes.push(`preset "${name}": "${key}" must be text; ignored`)
        delete next[key]
      }
    }
    out[name] = next
  }
  return out
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
  const config = { packs: [], extraChecks: [], disable: [], disableSubs: [], override: {}, budget: null, presets: {}, customChecks: [], suites: {} }
  if (raw.customChecks !== undefined) {
    if (Array.isArray(raw.customChecks)) config.customChecks = raw.customChecks
    else notes.push('"customChecks" must be a list of checks such as [{ "id": "e2e", "cmd": "npm", "args": ["run", "test:e2e"] }]; ignored')
  }
  if (raw.suites !== undefined) {
    if (raw.suites && typeof raw.suites === 'object' && !Array.isArray(raw.suites)) config.suites = raw.suites
    else notes.push('"suites" must be an object such as { "my-app": { "label": "My app", "purpose": "..." } }; ignored')
  }
  if (raw.packs !== undefined) {
    if (isStrings(raw.packs) && raw.packs.every((p) => /^[a-z0-9-]+$/.test(p))) config.packs = raw.packs
    else notes.push('"packs" must be a list of pack names such as ["rust", "security"]; ignored')
  }
  if (raw.presets && typeof raw.presets === 'object' && !Array.isArray(raw.presets)) config.presets = cleanPresetTexts(raw.presets, notes)
  else if (raw.presets !== undefined) notes.push('"presets" must be an object of named runs; ignored')
  if (raw.extraChecks !== undefined) {
    if (isStrings(raw.extraChecks)) config.extraChecks = raw.extraChecks
    else notes.push('"extraChecks" must be a list of folder names; ignored')
  }
  if (raw.disable !== undefined) {
    if (isStrings(raw.disable)) {
      config.disable = raw.disable.filter((d) => {
        if (d.startsWith('suite:') && !/^suite:[a-z0-9][a-z0-9-]*$/.test(d)) {
          notes.push(`"disable" entry "${d.slice(0, 60)}" is not "suite:<name>" with a plain suite name; ignored`)
          return false
        }
        return true
      })
    } else notes.push('"disable" must be a list of check ids (or "suite:<name>"); ignored')
  }
  if (raw.disableSubs !== undefined) {
    if (isStrings(raw.disableSubs)) {
      for (const d of raw.disableSubs) {
        const p = parseSubRef(d)
        if (p) config.disableSubs.push(`${p.check}/${p.sub}`)
        else notes.push(`"disableSubs" entry "${d.slice(0, 60)}" must look like "check/sub" (lowercase letters, digits, dashes); ignored`)
      }
    } else notes.push('"disableSubs" must be a list such as ["secret-scan/aws-access-key"]; ignored')
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
// `personalChecks` is the raw customChecks list of ~/.meerkat.json, `projectDir` the folder whose .meerkat/checks/*.mjs may be loaded, and
// `noProjectCode` (MEERKAT_NO_PROJECT_CODE) keeps every file of the project's own code from being imported: config-defined checks are
// data, so they are still listed. Every check carries `origin`: bundled (ships with Meerkat), personal (yours, in every project) or project.
export async function applyConfig(builtIn, config, { file, load = loadChecks, extraPackDirs = [], personalChecks, projectDir, noProjectCode = false } = {}) {
  const notes = []
  const where = file ? dirname(file) : process.cwd()
  let checks = builtIn.map((c) => ({ origin: 'bundled', ...c }))
  // Packs ship with Meerkat (packs/<name>/): rust, security. A pack's check with the id of one already there replaces it.
  for (const name of config.packs ?? []) {
    // packs/<name> ships with Meerkat; examples/<name> holds the checks of one real app, used the same way. Then each folder the person
    // named (extraPackDirs, from ~/.meerkat.json packDirs), each holding <name>/ folders, then ~/.meerkat/packs/<name>.
    const dirs = [
      resolve(MEERKAT_DIR, 'packs', name),
      resolve(MEERKAT_DIR, 'examples', name),
      ...(extraPackDirs ?? []).map((d) => resolve(d, name)),
      join(homedir(), '.meerkat', 'packs', name),
    ]
    const at = dirs.findIndex((d) => existsSync(d))
    const origin = at >= 0 && at < 2 ? 'bundled' : 'personal'
    const more = await load(dirs[at < 0 ? 0 : at])
    if (!more.length) notes.push(`pack "${name}": not found or empty`)
    for (const c of more) {
      const i = checks.findIndex((x) => x.id === c.id)
      if (i >= 0) checks[i] = { ...c, source: `pack ${name}`, origin }
      else checks.push({ ...c, source: `pack ${name}`, origin })
    }
  }
  for (const dir of noProjectCode ? [] : config.extraChecks ?? []) {
    const more = await load(resolve(where, dir))
    if (!more.length) notes.push(`extraChecks "${dir}": no checks found there`)
    for (const c of more) {
      const i = checks.findIndex((x) => x.id === c.id)
      if (i >= 0) {
        checks[i] = { ...c, source: `${dir} (replaces the built-in ${c.id})`, origin: 'project' }
        notes.push(`${c.id}: swapped for the one in ${dir}`)
      } else checks.push({ ...c, source: dir, origin: 'project' })
    }
  }
  // The project's own .meerkat/checks/*.mjs: the same shape as an extraChecks folder, found without any setting.
  if (projectDir && !noProjectCode) {
    for (const c of await load(join(projectDir, '.meerkat', 'checks'))) {
      if (checks.some((x) => x.id === c.id)) {
        notes.push(`.meerkat/checks: id "${c.id}" is already used by another check; skipped`)
        continue
      }
      checks.push({ ...c, source: `.meerkat/checks/${c.source}`, origin: 'project' })
    }
  }
  // Checks written as data (no JavaScript): the project's customChecks, then the person's own. Ids are unique across every pack.
  const known = new Set(checks.map((c) => c.id))
  const mine = validateCustomChecks(config.customChecks, { known, label: 'customChecks' })
  const yours = validateCustomChecks(personalChecks, { known, label: '~/.meerkat.json customChecks' })
  notes.push(...mine.notes, ...yours.notes)
  const declared = validateSuites(config.suites)
  notes.push(...declared.notes)
  const projectSuiteList = suitesFor([...mine.entries, ...yours.entries], declared.list)
  setProjectSuites(projectSuiteList)
  const cfgName = file ? file.split(/[\/]/).pop() : CONFIG_NAME
  for (const e of mine.entries) checks.push(entryToCheck(e, { origin: 'project', source: `${cfgName} (customChecks)`, where: { kind: 'config', file: file ?? null } }))
  for (const e of yours.entries) checks.push(entryToCheck(e, { origin: 'personal', source: '~/.meerkat.json (customChecks)', where: { kind: 'personal-config', file: null } }))
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
  const everyCheck = [...checks]
  for (const id of config.disable ?? []) {
    const sm = /^suite:(.+)$/.exec(id)
    if (sm) {
      if (!isSuite(sm[1])) {
        notes.push(`disable "${id}": no such suite; ignored`)
        continue
      }
      const mine = checks.filter((x) => suiteIdOf(x) === sm[1])
      if (!mine.length) notes.push(`disable "${id}": no check of that suite is loaded here`)
      for (const x of mine) disabled.push({ id: x.id, title: x.title, by: id })
      checks = checks.filter((x) => suiteIdOf(x) !== sm[1])
      continue
    }
    const c = checks.find((x) => x.id === id)
    if (!c) {
      notes.push(`disable "${id}": no such check; ignored`)
      continue
    }
    disabled.push({ id, title: c.title })
    checks = checks.filter((x) => x.id !== id)
  }
  const disabledSubs = []
  for (const ref of config.disableSubs ?? []) {
    const cid = ref.split('/')[0]
    if (!everyCheck.some((x) => x.id === cid)) notes.push(`disableSubs "${ref}": no such check; ignored`)
    else disabledSubs.push(ref)
  }
  return { checks, disabled, disabledSubs, notes, projectSuites: projectSuiteList }
}
