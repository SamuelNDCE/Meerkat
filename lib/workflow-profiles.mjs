// Workflow profiles: a starting configuration for a KIND of workflow (one person, a team, an AI agent, old code, a monorepo, CI only).
// A profile is data in profiles/<name>.json (not logic in this folder); `meerkat init --profile <name>` turns one into a meerkat.config.json.
//   meerkat init --profile team                  print the config it would write, change nothing
//   meerkat init --profile team --write          write meerkat.config.json (refuses when one exists)
//   meerkat init --profile team --write --force  replace an existing meerkat.config.json
// Not to be confused with lib/profiles.mjs, which holds the machine profiles (low, normal, high) for how many windows to open.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CONFIG_NAME } from './config.mjs'
import { detect } from './init.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { PRESETS } from './presets.mjs'

export const PROFILE_DIR = join(MEERKAT_DIR, 'profiles')
export const SCOPE_MODES = ['all', 'changed', 'package']
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const BASELINES = ['none', 'existing-debt', 'everything']
export const FORMATS = ['text', 'json', 'github']
const NAME = /^[a-z][a-z0-9-]*$/
const REQUIRED = ['name', 'summary', 'preset', 'scope', 'hooks', 'pullRequestGate', 'baseline', 'blocking', 'output', 'cache', 'commands']

export function profileNames(dir = PROFILE_DIR) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((n) => NAME.test(n)).sort()
  } catch {
    return []
  }
}

const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// What is wrong with a profile, as plain sentences. Empty means usable. `presets` is the list of preset names it may name.
export function profileProblems(p, { presets = Object.keys(PRESETS) } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['a profile must be a JSON object']
  const bad = []
  for (const k of REQUIRED) if (p[k] === undefined) bad.push(`"${k}" is missing`)
  if (bad.length) return bad
  if (typeof p.name !== 'string' || !NAME.test(p.name)) bad.push('"name" must be lowercase letters, digits and dashes')
  if (typeof p.summary !== 'string' || !p.summary.trim()) bad.push('"summary" must be a sentence')
  if (!presets.includes(p.preset)) bad.push(`"preset" ${JSON.stringify(p.preset)} is not a known preset`)
  if (!p.scope || !SCOPE_MODES.includes(p.scope.mode)) bad.push(`"scope.mode" must be one of ${SCOPE_MODES.join(', ')}`)
  if (!isStrings(p.hooks)) bad.push('"hooks" must be a list of words')
  if (typeof p.pullRequestGate !== 'boolean') bad.push('"pullRequestGate" must be true or false')
  if (!BASELINES.includes(p.baseline)) bad.push(`"baseline" must be one of ${BASELINES.join(', ')}`)
  if (!p.blocking || !SEVERITIES.includes(p.blocking.failOn) || !isStrings(p.blocking.suites ?? [])) bad.push('"blocking" needs "failOn" (a severity) and "suites" (a list)')
  if (!p.output || !FORMATS.includes(p.output.format)) bad.push(`"output.format" must be one of ${FORMATS.join(', ')}`)
  if (p.cache !== 'on' && p.cache !== 'off') bad.push('"cache" must be "on" or "off"')
  if (!p.commands || typeof p.commands !== 'object' || !Object.values(p.commands).every((c) => typeof c === 'string' && /^meerkat /.test(c))) bad.push('"commands" must map names to commands that start with "meerkat "')
  if (p.notes !== undefined && !isStrings(p.notes)) bad.push('"notes" must be a list of sentences')
  return bad
}

// One profile, or throws an Error whose message says what to do. The name is checked before it touches the file system.
export function loadProfile(name, dir = PROFILE_DIR) {
  const names = profileNames(dir)
  if (typeof name !== 'string' || !NAME.test(name) || !names.includes(name)) throw new Error(`no workflow profile named ${JSON.stringify(String(name).slice(0, 40))}. Choose one of: ${names.join(', ')}`)
  let p
  try {
    p = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))
  } catch (e) {
    throw new Error(`profile ${name} could not be read: ${String(e.message).split('\n')[0]}`)
  }
  const bad = profileProblems(p)
  if (bad.length) throw new Error(`profile ${name} is not valid: ${bad.join('; ')}`)
  if (p.name !== name) throw new Error(`profile ${name} is not valid: its "name" says ${p.name}`)
  return p
}

// The meerkat.config.json for a profile: the packs found for the folder, plus a "workflow" record of what the profile chose.
export function configFor(profile, detected = { packs: ['security', 'hygiene'] }) {
  const { name, preset, scope, hooks, pullRequestGate, baseline, blocking, output, cache, commands } = profile
  return { ...detected, workflow: { profile: name, preset, scope, hooks, pullRequestGate, baseline, blocking, output, cache, commands } }
}

const flagValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

export function initProfileText(profile, config, { file, exists, write }) {
  const lines = [JSON.stringify(config, null, 2), '']
  lines.push(`Profile ${profile.name}: ${profile.summary}`)
  if (write) lines.push(`Wrote ${file}`)
  else lines.push(exists ? `Dry run: nothing written. ${file} already exists, so --write would refuse; add --force to replace it.` : `Dry run: nothing written. Add --write to create ${file}.`)
  lines.push('', 'Commands for this workflow:')
  for (const [k, v] of Object.entries(profile.commands)) lines.push(`  ${k.padEnd(12)} ${v}`)
  if (profile.notes?.length) lines.push('', 'Notes:', ...profile.notes.map((n) => `  ${n}`))
  return lines.join('\n')
}

// meerkat init --profile <name> [folder] [--app <folder>] [--write] [--force]. Exit 0 done or dry run, 1 refused or could not write, 2 usage.
export function runInitProfile(argv, { cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), dir = PROFILE_DIR } = {}) {
  const args = argv.slice(1)
  const name = flagValue(args, '--profile')
  const known = new Set(['--profile', '--app', '--write', '--force'])
  const stray = args.filter((a) => a.startsWith('--') && !known.has(a))
  if (stray.length) return (err(`meerkat init: unknown option ${stray[0]}. Use: meerkat init --profile <name> [folder] [--write] [--force]`), 2)
  if (name === undefined || name.startsWith('--')) return (err(`meerkat init --profile needs a name. Choose one of: ${profileNames(dir).join(', ')}`), 2)
  const force = args.includes('--force')
  const write = args.includes('--write')
  if (force && !write) return (err('meerkat init: --force only matters with --write'), 2)
  const positional = args.filter((a, i) => !a.startsWith('--') && !['--profile', '--app'].includes(args[i - 1]))
  const folder = resolve(cwd, flagValue(args, '--app') ?? positional[0] ?? '.')
  let profile
  try {
    profile = loadProfile(name, dir)
  } catch (e) {
    return (err(`meerkat init: ${e.message}`), 2)
  }
  if (!existsSync(folder)) return (err(`meerkat init: ${folder} does not exist`), 2)
  const file = join(folder, CONFIG_NAME)
  const exists = existsSync(file)
  const config = configFor(profile, detect(folder).config)
  if (write && exists && !force) return (err(`meerkat init: ${file} already exists; left as it is. Add --force to replace it.`), 1)
  if (write) {
    try {
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { flag: force ? 'w' : 'wx' })
    } catch (e) {
      return (err(`meerkat init: could not write ${file}: ${String(e.message).split('\n')[0]}`), 1)
    }
  }
  out(initProfileText(profile, config, { file, exists, write }))
  return 0
}
