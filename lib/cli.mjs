// The command line front door: turns what the person typed after `meerkat` into a plan.
// planCommand is a pure function (it only reads what it is given), so it is easy to test.
// The bin (bin/meerkat.mjs) does the doing: spawning run.mjs, the menu, update, bug report, packs.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { findConfig, readConfig } from './config.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { PRESETS, resolvePreset } from './presets.mjs'
import { readUserConfig, writeUserConfig } from './userconfig.mjs'
import { cleanText } from './tui/safe.mjs'

export const QUICK_WORDS = ['verify', 'test', 'check']
export const HERE_WORDS = ['this', 'here', '.']
export const UPDATE_WORDS = ['auto', 'notify', 'off']

// Command words, for the help text and for the "unknown command" message.
export const COMMAND_LIST = [
  'verify', 'test', 'check', 'run', 'last', 'why', 'logs', 'list', 'self-test', 'init',
  'presets', 'pack', 'bug', 'update', 'ai', 'menu', 'help',
]
const RESERVED = new Set([...COMMAND_LIST, 'version'])

// Personal presets (user config) and project presets (meerkat.config.json). Reads files; planCommand takes the result as an option.
export function loadPresets({ cwd = process.cwd(), env = process.env, home = homedir() } = {}) {
  const personal = readUserConfig(env, home).presets
  const user = personal && typeof personal === 'object' && !Array.isArray(personal) ? personal : {}
  let project = {}
  try {
    const appDir = resolve(cwd)
    const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
    if (file) project = readConfig(file).config.presets ?? {}
  } catch {
    /* a project config that cannot be read adds no presets */
  }
  return { user, project }
}

const presetNames = ({ user = {}, project = {} } = {}) => [...new Set([...Object.keys(PRESETS), ...Object.keys(user), ...Object.keys(project)])]

// Every preset, with where it comes from. A project preset beats a personal one, which beats a bundled one.
export function listPresets({ user = {}, project = {} } = {}) {
  return presetNames({ user, project }).map((name) => {
    const source = name in project ? 'project' : name in user ? 'personal' : 'bundled'
    const r = resolvePreset(name, { ...user, ...project })
    const p = r.preset
    return { name, source, tier: p.tier, kinds: p.groups.length ? p.groups : ['all'], about: p.about }
  })
}

export function presetsText(presets) {
  const rows = listPresets(presets)
  const w = Math.max(...rows.map((r) => r.name.length))
  const lines = ['Presets (meerkat <name> [folder]):', '']
  for (const r of rows) lines.push(`  ${r.name.padEnd(w)}  ${r.source.padEnd(8)} ${r.tier.padEnd(9)} ${r.kinds.join(',').padEnd(26)} ${r.about}`)
  return cleanText(lines.join('\n'))
}

export function helpText(presets) {
  const names = presetNames(presets)
  return [
    'MEERKAT: one command that checks your project.',
    '',
    'Run checks',
    '  meerkat verify this       the quick checks on this folder',
    '  meerkat full ../my-app    every check on another folder',
    '  meerkat security          one kind of check (also: ui, performance, ...)',
    '  meerkat run ci            the same, naming the preset first',
    '',
    'Look at the results',
    '  meerkat last              show the newest report',
    '  meerkat why secret-scan   show one check\'s log',
    '  meerkat logs              show where logs are kept',
    '',
    'Set up',
    '  meerkat init              write a starter meerkat.config.json',
    '  meerkat list              list the checks that apply',
    '  meerkat self-test         prove each check can catch a fault',
    '  meerkat presets           list every preset',
    '  meerkat pack add <dir>    add a folder of packs (also: list, remove)',
    '',
    'Look after Meerkat',
    '  meerkat update            see what is new and update',
    '  meerkat update auto       update by itself (also: notify, off, status)',
    '  meerkat bug               write a bug report you can paste',
    '  meerkat --version',
    '',
    'meerkat on its own opens a menu.',
    'Extra flags after the words go straight to the run, for example: meerkat quick --keep-going',
    '',
    `Presets: ${names.join(', ')}`,
  ].join('\n')
}

const unknown = (word, presets) => ({
  kind: 'error',
  message: `Unknown command "${word}".\n\nCommands: ${COMMAND_LIST.join(', ')}\nPresets: ${presetNames(presets).join(', ')}\n\nTry: meerkat help`,
})

// The folder named after a command word (this, here, ".", nothing = the current folder, else a path), and what is left over.
function takeWhere(rest, cwd) {
  if (rest.length && !String(rest[0]).startsWith('-')) {
    const w = String(rest[0])
    return { folder: HERE_WORDS.includes(w) ? resolve(cwd) : resolve(cwd, w), rest: rest.slice(1) }
  }
  return { folder: resolve(cwd), rest }
}
const withApp = (folder, rest) => (rest.includes('--app') ? rest : ['--app', folder, ...rest])

function presetRun(name, rest, cwd) {
  const { folder, rest: flags } = takeWhere(rest, cwd)
  const args = withApp(folder, ['--preset', name, ...flags])
  return { kind: 'run', args, preset: name, folder }
}

// argv is what comes after `meerkat`. Returns one of:
//   { kind: 'run', args }  { kind: 'menu' }  { kind: 'help' }  { kind: 'version' }  { kind: 'presets' }  { kind: 'bug' }
//   { kind: 'last'|'why'|'logs'|'list'|'self-test'|'init', args }  { kind: 'update', ... }  { kind: 'pack', ... }  { kind: 'error', message }
export function planCommand(argv, { cwd = process.cwd(), env = process.env, interactive = false, presets } = {}) {
  const found = presets ?? loadPresets({ cwd, env })
  const [word, ...rest] = argv
  if (word === undefined) return interactive ? { kind: 'menu' } : { kind: 'help' }
  if (word === 'help' || word === '-h' || word === '--help') return { kind: 'help' }
  if (word === '--version' || word === '-v' || word === 'version') return { kind: 'version' }
  if (word === 'menu') return interactive ? { kind: 'menu' } : { kind: 'error', message: 'The menu needs a terminal you can type in. Try: meerkat help' }
  if (QUICK_WORDS.includes(word)) return presetRun('quick', rest, cwd)
  if (word === 'run') {
    const name = rest[0]
    if (!name || name.startsWith('-')) return { kind: 'error', message: `Say which preset to run, for example: meerkat run quick\nPresets: ${presetNames(found).join(', ')}` }
    if (!presetNames(found).includes(name)) return unknown(name, found)
    return presetRun(name, rest.slice(1), cwd)
  }
  if (word === 'last') return { kind: 'last', args: ['--last', ...rest] }
  if (word === 'logs') return { kind: 'logs', args: ['--logs', ...rest] }
  if (word === 'why') {
    if (!rest[0] || rest[0].startsWith('-')) return { kind: 'error', message: 'Say which check, for example: meerkat why secret-scan\n(meerkat last shows which ones failed)' }
    return { kind: 'why', args: ['--why', ...rest] }
  }
  if (word === 'list' || word === 'self-test' || word === 'init') {
    const { folder, rest: flags } = takeWhere(rest, cwd)
    const flag = word === 'list' ? '--list' : word === 'self-test' ? '--self-test' : '--init'
    return { kind: word, args: withApp(folder, [flag, ...flags]), folder }
  }
  if (word === 'presets') return { kind: 'presets' }
  if (word === 'bug') return { kind: 'bug' }
  if (word === 'ai') return { kind: 'ai', action: rest[0] ?? 'status' }
  if (word === 'update') {
    const sub = rest[0]
    if (sub === undefined || String(sub).startsWith('-')) {
      const flags = rest
      return { kind: 'update', action: flags.includes('--check') ? 'check' : 'apply', yes: flags.includes('--yes') || flags.includes('-y') }
    }
    if (UPDATE_WORDS.includes(sub)) return { kind: 'update', action: 'set', mode: sub }
    if (sub === 'status') return { kind: 'update', action: 'status' }
    return { kind: 'error', message: `Unknown update option "${sub}". Use: meerkat update, meerkat update --check, meerkat update auto|notify|off|status` }
  }
  if (word === 'pack') {
    const [sub, folder] = rest
    if (sub === 'list' && folder === undefined) return { kind: 'pack', action: 'list' }
    if (sub === 'add' || sub === 'remove') {
      if (!folder) return { kind: 'error', message: `Say which folder, for example: meerkat pack ${sub} ../my-packs` }
      return { kind: 'pack', action: sub, folder: HERE_WORDS.includes(folder) ? resolve(cwd) : resolve(cwd, folder) }
    }
    return { kind: 'error', message: 'Use: meerkat pack add <folder>, meerkat pack list, meerkat pack remove <folder>' }
  }
  if (presetNames(found).includes(word) && !RESERVED.has(word)) return presetRun(word, rest, cwd)
  return unknown(word, found)
}

// ---- packs ----

const subfolders = (dir) => {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).sort()
  } catch {
    return []
  }
}
const same = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b)
const norm = (p) => resolve(p).replace(/\\/g, '/')

export function packAdd(folder, env = process.env, home = homedir()) {
  const abs = norm(folder)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return { ok: false, text: `${abs} is not a folder` }
  const dirs = readUserConfig(env, home).packDirs
  const list = Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string') : []
  if (list.some((d) => same(norm(d), abs))) return { ok: true, text: `${abs} is already in your pack folders` }
  writeUserConfig({ packDirs: [...list, abs] }, env, home)
  const names = subfolders(abs)
  return { ok: true, text: `Added ${abs}\nPacks found there: ${names.join(', ') || 'none yet (each subfolder is one pack)'}` }
}

export function packRemove(folder, env = process.env, home = homedir()) {
  const abs = norm(folder)
  const dirs = readUserConfig(env, home).packDirs
  const list = Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string') : []
  const keep = list.filter((d) => !same(norm(d), abs))
  if (keep.length === list.length) return { ok: false, text: `${abs} is not in your pack folders` }
  writeUserConfig({ packDirs: keep.length ? keep : null }, env, home)
  return { ok: true, text: `Removed ${abs}` }
}

export function packList(env = process.env, home = homedir()) {
  const dirs = readUserConfig(env, home).packDirs
  const list = Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string') : []
  const lines = []
  const sections = [
    [`${MEERKAT_DIR}/packs (comes with Meerkat)`, `${MEERKAT_DIR}/packs`],
    ['~/.meerkat/packs', join(home, '.meerkat', 'packs')],
    ...list.map((d) => [d, d]),
  ]
  for (const [label, dir] of sections) {
    const names = subfolders(dir)
    lines.push(`${label}${existsSync(dir) ? '' : ' (not found)'}`, `  ${names.join(', ') || 'no packs'}`)
  }
  return lines.join('\n')
}
