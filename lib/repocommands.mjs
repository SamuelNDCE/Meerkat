// A repo's own test and build commands: the `commands` block of meerkat.config.json.
//   { "commands": { "test": "npm test", "build": "npm run build", "typecheck": "npx tsc --noEmit" } }
//   meerkat commands   lists them     meerkat test   runs `test`     meerkat build   runs `build`
// Only a command written in that block is ever run, exactly as written, from the folder the config file is in. The command is printed first.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { findConfig } from './config.mjs'
import { isTrusted, saveTrust } from './trust.mjs'
import { stripControl } from './tui/safe.mjs'

// Control (Cc), format (Cf: bidi overrides, zero-width joiners) and line/paragraph separators (Zl, Zp) can all hide what a command does.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const show = (t) => stripControl(String(t)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
import { appDirOf, repoRootOf } from './paths.mjs'

// { file, dir, commands: { name: "command" }, notes } for the config that governs `appDir` (null file when there is none).
export function readCommands(appDir) {
  const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  const notes = []
  const commands = {}
  if (!file) return { file: null, dir: appDir, commands, notes }
  let raw = null
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))?.commands
  } catch {
    /* an unreadable config has no commands; the config reader already says so */
  }
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) notes.push('"commands" must be an object such as { "test": "npm test" }; ignored')
    else
      for (const [name, cmd] of Object.entries(raw)) {
        if (CONTROL.test(String(name)) || (typeof cmd === 'string' && CONTROL.test(cmd))) notes.push(`commands.${show(String(name).slice(0, 40))} contains a control character (an escape sequence, bidi override or zero-width character could hide what runs), so it is rejected and never trusted or run`)
        else if (typeof cmd === 'string' && cmd.trim() && /^[A-Za-z][\w-]{0,40}$/.test(name)) commands[name] = cmd.trim()
        else notes.push(`commands.${show(String(name).slice(0, 40))} must be a one-line command string; ignored`)
      }
  }
  return { file, dir: dirname(file), commands, notes }
}

// The repo's commands run through a shell, so they need the same one-time trust as a project's own check code: a record per config file, keyed to a
// hash of the commands block (a changed command asks again). MEERKAT_TRUST_PROJECT=1 is the documented choice of whoever runs Meerkat (a CI job
// that owns its repository). Nothing here asks a question: `meerkat trust` does.
const trustKey = (r) => `commands:${resolve(r.file).replace(/\\/g, '/')}`
const trustHash = (r) => createHash('sha256').update(JSON.stringify(Object.entries(r.commands).sort())).digest('hex')
export const commandsTrusted = (r, env = process.env) => env.MEERKAT_TRUST_PROJECT === '1' || isTrusted(env, trustKey(r), trustHash(r))

const folderOf = (argv, env, cwd) => {
  const app = argv.indexOf('--app')
  if (app >= 0 && argv[app + 1]) return resolve(cwd, argv[app + 1])
  const pos = argv.find((a, i) => !a.startsWith('-') && argv[i - 1] !== '--app')
  return pos ? resolve(cwd, pos) : resolve(appDirOf(env, cwd))
}

export function runCommandsList(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const r = readCommands(folderOf(argv, env, cwd))
  for (const n of r.notes) err(`meerkat commands: ${show(n)}`)
  if (argv.includes('--json')) {
    out(JSON.stringify({ config: r.file, commands: r.commands }, null, 2).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' '))
    return 0
  }
  const names = Object.keys(r.commands)
  if (!names.length) {
    out(`no commands: ${r.file ? `${show(r.file)} has no "commands" block` : 'there is no meerkat.config.json'}. Add { "commands": { "test": "npm test", "build": "npm run build" } } to define them.`)
    return 0
  }
  const w = Math.max(...names.map((n) => n.length))
  for (const n of names) out(`${show(n).padEnd(w)}  ${show(r.commands[n])}`)
  return 0
}

// Runs commands.<name>. Returns the exit code, or null when the folder defines no such command and `fallback` is true (the old meaning of the word applies).
export function runNamedCommand(name, argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), fallback = false } = {}) {
  const r = readCommands(folderOf(argv, env, cwd))
  const cmd = r.commands[name]
  if (!cmd) {
    if (fallback) {
      err(`meerkat ${name}: no commands.${name} in the config, so this is the quick check`)
      return null
    }
    err(`meerkat ${name}: ${r.file ? `${show(r.file)} defines no commands.${name}` : 'there is no meerkat.config.json here'}. Add { "commands": { "${name}": "<your command>" } }; meerkat commands lists what is defined.`)
    return 2
  }
  if (!commandsTrusted(r, env)) {
    err(`meerkat ${name}: this repo's commands (${show(r.file)}) need \`meerkat trust\` before they run, so commands.${name} was NOT run${fallback ? '; this is the quick check instead' : ''}`)
    return fallback ? null : 1
  }
  const extra = argv.filter((a, i) => a.startsWith('-') && a !== '--app' && argv[i - 1] !== '--app')
  if (extra.length) {
    err(`meerkat ${name}: unknown option ${extra[0]}. usage: meerkat ${name} [folder]. The command runs exactly as written in the config.`)
    return 2
  }
  out(`$ ${cmd}   (in ${r.dir.replace(/\\/g, '/')})`)
  const res = spawnSync(cmd, { cwd: r.dir, shell: true, stdio: 'inherit', env }) // meerkat-ignore js-spawn-shell guarded above: the command is run only after commandsTrusted() and exactly as written in the trusted config
  if (res.error) {
    err(`meerkat ${name}: could not start the command: ${res.error.message}`)
    return 1
  }
  return res.status ?? 1
}

// `meerkat trust [folder]`: shows the commands and records the person's yes. Asks only at a terminal; without one it refuses and trusts nothing.
export async function runTrust(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const r = readCommands(folderOf(argv, env, cwd))
  if (!Object.keys(r.commands).length) {
    out('nothing to trust: the config defines no commands')
    return 0
  }
  if (commandsTrusted(r, env)) {
    out(`already trusted: ${show(r.file)}`)
    return 0
  }
  out(`${show(r.file)} defines these commands, which run through a shell:`)
  for (const [n, c] of Object.entries(r.commands)) out(`  ${show(n)}: ${show(c)}`)
  if (!(Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY) && !env.CI)) {
    err('meerkat trust: no terminal to ask in, so nothing was trusted. Run it in a terminal, or set MEERKAT_TRUST_PROJECT=1 if you own this repository.')
    return 1
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  let answer = ''
  try {
    answer = await rl.question('Trust these commands? [y/N] ')
  } finally {
    rl.close()
  }
  if (!/^y(es)?$/i.test(answer.trim())) {
    out('not trusted')
    return 1
  }
  saveTrust(env, trustKey(r), trustHash(r))
  out('trusted')
  return 0
}
