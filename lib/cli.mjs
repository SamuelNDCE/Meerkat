// The command line front door: turns what the person typed after `meerkat` into a plan.
// planCommand is a pure function (it only reads what it is given), so it is easy to test.
// The bin (bin/meerkat.mjs) does the doing: spawning run.mjs, the menu, update, bug report, packs.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { findConfig, readConfig } from './config.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { PRESETS, resolvePreset } from './presets.mjs'
import { readUserConfig, writeUserConfig } from './userconfig.mjs'
import { stripControl } from './tui/safe.mjs'
import { SHELLS } from './completion.mjs'
import { allWords, nameOf, overviewHelp, suggest } from './help.mjs'

export const QUICK_WORDS = ['verify', 'test', 'quick']
export const HERE_WORDS = ['this', 'here', '.']
export const UPDATE_WORDS = ['auto', 'notify', 'off']

// Command words, for the help text and for the "unknown command" message.
export const COMMAND_LIST = [
  'verify', 'test', 'check', 'run', 'last', 'why', 'logs', 'list', 'self-test', 'init',
  'presets', 'preset', 'pack', 'root', 'doctor', 'mcp', 'completion', 'describe', 'bug', 'update', 'ai', 'menu', 'help',
]
const RESERVED = new Set([...COMMAND_LIST, 'version', 'describe', 'doctor', 'completion', 'mcp', 'preset', 'runs', 'log'])

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
  return presetNames({ user, project }).filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n)).map((name) => {
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
  // Each field is cleaned on its own, newlines included, so one preset can never draw a second row of its own.
  const f = (x) => stripControl(String(x ?? ''))
  for (const r of rows) lines.push(`  ${f(r.name).padEnd(w)}  ${f(r.source).padEnd(8)} ${f(r.tier).padEnd(9)} ${f(r.kinds.join(',')).padEnd(26)} ${f(r.about)}`)
  return lines.join('\n')
}

export function helpText(presets) {
  return overviewHelp(presetNames(presets))
}

const unknown = (word, presets) => ({
  kind: 'error',
  message: `Unknown command "${stripControl(word)}".${suggest(word, presetNames(presets)) ? `\nDid you mean ${suggest(word, presetNames(presets))}?` : ''}\n\nCommands: ${COMMAND_LIST.join(', ')}\nPresets: ${presetNames(presets).join(', ')}\n\nTry: meerkat help`,
})

// Where to run. The word after a command can be a pasted folder path (quotes are fine), or the NAME of a project: a bare name is looked
// for in the current folder, its parent, the folders from `meerkat root add <folder>`, and the folder Meerkat itself sits in. Nothing
// after the command means the current folder (`this`, `here` and `.` still work).
export function findProject(name, { cwd, env = process.env, exists = (p) => { try { return statSync(p).isDirectory() } catch { return false } }, list = (d) => { try { return readdirSync(d) } catch { return [] } } } = {}) {
  const roots = [resolve(cwd), dirname(resolve(cwd)), ...((readUserConfig(env).roots ?? []).filter((r) => typeof r === 'string')), dirname(MEERKAT_DIR)]
  const wanted = String(name).toLowerCase()
  const searched = []
  for (const root of [...new Set(roots)]) {
    searched.push(root)
    const hit = list(root).find((entry) => entry.toLowerCase() === wanted && exists(join(root, entry)))
    if (hit) return { folder: join(root, hit), searched }
  }
  return { folder: null, searched }
}

const looksLikePath = (w) => /[\\/]/.test(w) || /^[A-Za-z]:/.test(w) || w.startsWith('.') || w.startsWith('~')

function takeWhere(rest, cwd, env = process.env) {
  if (rest.length && !String(rest[0]).startsWith('-')) {
    const w = String(rest[0]).trim().replace(/^["']|["']$/g, '')
    if (HERE_WORDS.includes(w)) return { folder: resolve(cwd), rest: rest.slice(1) }
    if (looksLikePath(w)) return { folder: resolve(cwd, w), rest: rest.slice(1) }
    const found = findProject(w, { cwd, env })
    if (found.folder) return { folder: found.folder, rest: rest.slice(1) }
    return { error: `No project called "${w}". Looked in:\n  ${found.searched.join('\n  ')}\nPaste its folder path instead, or add where it lives: meerkat root add <folder>` }
  }
  return { folder: resolve(cwd), rest }
}
const withApp = (folder, rest) => (rest.includes('--app') ? rest : ['--app', folder, ...rest])

const GLOBALS = { '--json': 'json', '-q': 'quiet', '--quiet': 'quiet', '--no-color': 'noColor', '-y': 'yes', '--yes': 'yes', '--no-input': 'noInput', '--dry-run': 'dryRun' }
export function globalFlags(args) {
  const flags = {}
  const rest = []
  for (const a of args) (GLOBALS[a] ? (flags[GLOBALS[a]] = true) : rest.push(a))
  return { flags, rest }
}
const runFlags = (f) => [...(f.json ? ['--json-stdout'] : []), ...(f.quiet ? ['--quiet'] : []), ...(f.noColor ? ['--no-color'] : [])]
const VALUE_OPTS = ['--name', '--tier', '--group', '--pack', '--about', '--limit']
// For the commands that manage things: words, known options with their values, and any option we do not know.
export function parseFlags(args) {
  const flags = {}
  const words = []
  const unknownFlags = []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (GLOBALS[a]) flags[GLOBALS[a]] = true
    else if (a === '--personal' || a === '--project') flags[a.slice(2)] = true
    else if (VALUE_OPTS.includes(a)) flags[a.slice(2)] = args[++i]
    else if (a.startsWith('-') && a.length > 1) unknownFlags.push(a)
    else words.push(a)
  }
  return { flags, words, unknownFlags }
}

function presetRun(name, rest, cwd, env) {
  const where = takeWhere(rest, cwd, env)
  if (where.error) return { kind: 'error', message: where.error }
  const { folder } = where
  const g = globalFlags(where.rest)
  const args = withApp(folder, ['--preset', name, ...g.rest, ...runFlags(g.flags)])
  return { kind: 'run', args, preset: name, folder, ...(g.flags.json ? { json: true } : {}), ...(g.flags.quiet ? { quiet: true } : {}) }
}

// argv is what comes after `meerkat`. Returns one of:
//   { kind: 'run', args }  { kind: 'menu' }  { kind: 'help' }  { kind: 'version' }  { kind: 'presets' }  { kind: 'bug' }
//   { kind: 'last'|'why'|'logs'|'list'|'self-test'|'init', args }  { kind: 'update', ... }  { kind: 'pack', ... }  { kind: 'error', message }
function planLegacy(argv, { cwd = process.cwd(), env = process.env, interactive = false, presets } = {}) {
  const found = presets ?? loadPresets({ cwd, env })
  const [word, ...rest] = argv
  if (word === undefined) return interactive ? { kind: 'menu' } : { kind: 'help' }
  if (word === '--version' || word === '-v' || word === 'version') return { kind: 'version' }
  if (word === 'menu') return interactive ? { kind: 'menu' } : { kind: 'error', message: 'The menu needs a terminal you can type in. Try: meerkat help' }
  if (QUICK_WORDS.includes(word)) return presetRun('quick', rest, cwd, env)
  if (word === 'run') {
    const name = rest[0]
    if (!name || name.startsWith('-')) return { kind: 'error', message: `Say which preset to run, for example: meerkat run quick\nPresets: ${presetNames(found).join(', ')}` }
    if (!presetNames(found).includes(name)) return unknown(name, found)
    return presetRun(name, rest.slice(1), cwd, env)
  }
  if (word === 'last') return { kind: 'last', args: ['--last', ...rest] }
  if (word === 'logs') return { kind: 'logs', args: ['--logs', ...rest] }
  if (word === 'why') {
    if (!rest[0] || rest[0].startsWith('-')) return { kind: 'error', message: 'Say which check, for example: meerkat why secret-scan\n(meerkat last shows which ones failed)' }
    return { kind: 'why', args: ['--why', ...rest] }
  }
  if (word === 'list' || word === 'self-test' || word === 'init') {
    const where = takeWhere(rest, cwd, env)
    if (where.error) return { kind: 'error', message: where.error }
    const { folder, rest: flags } = where
    const flag = word === 'list' ? '--list' : word === 'self-test' ? '--self-test' : '--init'
    return { kind: word, args: withApp(folder, [flag, ...flags]), folder }
  }
  if (word === 'presets') return { kind: 'presets' }
  if (word === 'root') return { kind: 'root', action: rest[0] ?? 'list', folder: rest[1] ? resolve(cwd, String(rest[1]).replace(/^["']|["']$/g, '')) : null }
  if (word === 'bug') return { kind: 'bug' }
  if (word === 'ai') {
    const g = globalFlags(rest)
    return { kind: 'ai', action: g.rest[0] ?? 'status', args: g.rest.slice(1), ...(g.flags.json ? { json: true } : {}) }
  }
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
  if (presetNames(found).includes(word) && !RESERVED.has(word)) return presetRun(word, rest, cwd, env)
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

// `meerkat root add|list|remove <folder>`: folders Meerkat searches when a project is named instead of pasted.
export function rootCommand(action, folder, env = process.env) {
  const current = (readUserConfig(env).roots ?? []).filter((r) => typeof r === 'string')
  if (action === 'list') return { ok: true, text: current.length ? `Project names are looked for in:\n  ${current.join('\n  ')}\n(and the current folder, its parent, and the folder Meerkat is in)` : 'No folders added. Project names are looked for in the current folder, its parent, and the folder Meerkat is in.\nAdd one: meerkat root add <folder>' }
  if (!folder) return { ok: false, text: 'usage: meerkat root add <folder>, meerkat root remove <folder>, meerkat root list' }
  if (action === 'add') {
    try {
      if (!statSync(folder).isDirectory()) throw new Error('not a folder')
    } catch {
      return { ok: false, text: `${folder} is not a folder` }
    }
    writeUserConfig({ roots: [...new Set([...current, folder])] }, env)
    return { ok: true, text: `Added ${folder}. Now \`meerkat verify <name>\` finds projects inside it.` }
  }
  if (action === 'remove') {
    writeUserConfig({ roots: current.filter((r) => r !== folder) }, env)
    return { ok: true, text: `Removed ${folder}.` }
  }
  return { ok: false, text: 'usage: meerkat root add <folder>, meerkat root remove <folder>, meerkat root list' }
}

// ---- the full command set ----

const nounErr = (message) => ({ kind: 'error', message })

// argv is what comes after `meerkat`. Handles help for every command, then the commands that manage things (check, preset, pack,
// run, doctor, mcp, completion, describe); everything else goes to planLegacy (running presets, update, root, ai, bug, menu).
export function planCommand(argv, opts = {}) {
  const { cwd = process.cwd(), env = process.env } = opts
  const found = opts.presets ?? loadPresets({ cwd, env })
  const names = presetNames(found)
  const [word, ...rest] = argv
  if (word === 'help' || argv.includes('-h') || argv.includes('--help')) {
    const topicWord = word === 'help' ? rest.find((a) => !String(a).startsWith('-')) : argv.find((a) => !String(a).startsWith('-'))
    if (!topicWord) return { kind: 'help' }
    const topic = nameOf(topicWord) ?? (names.includes(topicWord) ? 'verify' : topicWord === 'list' ? 'check' : null)
    return topic ? { kind: 'help', topic } : unknown(topicWord, found)
  }
  const noun = (n, verb, extra = {}) => ({ kind: 'noun', noun: n, verb, ...extra })
  const bad = (cmd, p) => (p.unknownFlags.length ? nounErr(`Unknown option ${stripControl(p.unknownFlags[0])}. See: meerkat ${cmd} --help`) : null)
  const where = (cmd, words, flags, extra = {}) => {
    const w = takeWhere(words, cwd, env)
    return w.error ? nounErr(w.error) : noun(cmd, extra.verb ?? 'run', { folder: w.folder, flags, ...extra })
  }
  if (word === 'describe') return { kind: 'describe' }
  if (word === 'doctor') {
    const p = parseFlags(rest)
    return bad('doctor', p) ?? where('doctor', p.words, p.flags)
  }
  if (word === 'completion') {
    const p = parseFlags(rest)
    return SHELLS.includes(p.words[0]) ? { kind: 'completion', shell: p.words[0] } : nounErr('Say which shell: meerkat completion powershell, bash or zsh')
  }
  if (word === 'mcp') {
    const p = parseFlags(rest)
    const verb = p.words[0] ?? 'status'
    if (!['install', 'serve', 'status'].includes(verb)) return nounErr('Use: meerkat mcp install [claude], meerkat mcp serve, meerkat mcp status')
    if (verb === 'install' && p.words[1] && p.words[1] !== 'claude') return nounErr('Only Claude Code is supported for now: meerkat mcp install claude')
    return bad('mcp', p) ?? noun('mcp', verb, { flags: p.flags })
  }
  if (word === 'runs') return noun('run', 'list', { flags: parseFlags(rest).flags })
  if (word === 'log') return planLegacy(['why', ...rest], opts)
  if (word === 'run' && ['list', 'show', 'log', 'open'].includes(rest[0])) {
    const p = parseFlags(rest.slice(1))
    const verb = rest[0]
    if (verb === 'log' && !p.words[0]) return nounErr('Say which check, for example: meerkat run log secret-scan')
    return bad('run', p) ?? noun('run', verb, { check: verb === 'log' ? p.words[0] : null, id: verb === 'log' ? p.words[1] : p.words[0], flags: p.flags })
  }
  if (word === 'check') {
    const verb = rest[0]
    if (verb === 'list' || verb === 'show') {
      const p = parseFlags(rest.slice(1))
      if (verb === 'show' && !p.words[0]) return nounErr('Say which check, for example: meerkat check show secret-scan\n(meerkat check list shows them all)')
      return bad('check', p) ?? where('check', verb === 'show' ? p.words.slice(1) : p.words, p.flags, { verb, id: p.words[0] })
    }
    // meerkat check <id>... [folder]: run only these checks. The last word is the folder when it looks like one.
    const g = globalFlags(rest)
    const words = []
    const flagsOut = []
    for (let i = 0; i < g.rest.length; i++) {
      const a = String(g.rest[i])
      if (a.startsWith('-')) {
        flagsOut.push(a)
        if (['--only', '--include', '--group', '--config'].includes(a) && g.rest[i + 1] !== undefined) flagsOut.push(g.rest[++i])
      } else words.push(a)
    }
    if (!words.length) return nounErr('Say which checks to run, or list them: meerkat check list\nExample: meerkat check secret-scan')
    let folderWord = null
    const last = words[words.length - 1]
    if (HERE_WORDS.includes(last) || looksLikePath(last) || (words.length > 1 && findProject(last, { cwd, env }).folder)) folderWord = words.pop()
    const w = takeWhere(folderWord ? [folderWord] : [], cwd, env)
    if (w.error) return nounErr(w.error)
    if (!words.length) return nounErr('Say which checks to run, for example: meerkat check secret-scan')
    return { kind: 'run', args: withApp(w.folder, ['--only', words.join(','), '--all', ...flagsOut, ...runFlags(g.flags)]), preset: null, folder: w.folder, checks: words, ...(g.flags.json ? { json: true } : {}), ...(g.flags.quiet ? { quiet: true } : {}) }
  }
  if (word === 'preset') {
    const p = parseFlags(rest)
    const verb = p.words[0] ?? 'list'
    if (!['list', 'show', 'new', 'delete'].includes(verb)) return nounErr('Use: meerkat preset list, show <name>, new, delete <name>')
    const bd = bad('preset', p)
    if (bd) return bd
    if (verb === 'list') return noun('preset', 'list', { flags: p.flags })
    if (verb === 'new') return noun('preset', 'new', { flags: p.flags, folder: resolve(cwd) })
    if (!p.words[1]) return nounErr(`Say which preset, for example: meerkat preset ${verb} security`)
    if (verb === 'delete') return noun('preset', 'delete', { name: p.words[1], flags: p.flags, folder: resolve(cwd) })
    return where('preset', p.words.slice(2), p.flags, { verb: 'show', name: p.words[1] })
  }
  if (word === 'pack') {
    const [verb] = rest
    if (verb === 'enable' || verb === 'disable' || (verb === 'list' && rest.length > 1)) {
      const p = parseFlags(rest.slice(1))
      const bd = bad('pack', p)
      if (bd) return bd
      if (verb === 'list') return where('pack', p.words, p.flags, { verb })
      if (!p.words[0]) return nounErr(`Say which pack, for example: meerkat pack ${verb} python`)
      return where('pack', p.words.slice(1), p.flags, { verb, name: p.words[0] })
    }
  }
  return planLegacy(argv, opts)
}
