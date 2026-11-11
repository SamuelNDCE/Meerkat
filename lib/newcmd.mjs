// `meerkat new check <id> [--pack <name|folder>]` and `meerkat new pack <name> [--dir <folder>]`: write a working check (or a pack with one
// example check) from a template, so a developer starts from something that already runs and already proves itself.
// The template is the example in docs/add-a-check.md; tests/developer-extend.test.ts keeps the two in step.
// Exit codes: 0 written, 2 a usage problem or a file that already exists (nothing is overwritten; the line reads "USAGE (status 400): ...").
import fs from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { availablePacks } from './packs.mjs'
import { stripControl } from './tui/safe.mjs'

const { existsSync, mkdirSync, statSync, writeFileSync } = fs
const { basename, isAbsolute, join, resolve } = path
const KEBAB = /^[a-z0-9][a-z0-9-]*$/
const IDENT = /^[A-Za-z_$][\w$]*$/
export const NEW_USAGE = ['meerkat new check <id> [--pack <name|folder>] [--ban <function-name>] [--app <folder>]', 'meerkat new pack <name> [--dir <folder>] [--ban <function-name>]']
const DEFAULT_BAN = 'legacyCall'

const flagValue = (args, name) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length && !String(args[i + 1]).startsWith('--') ? String(args[i + 1]) : null
}
const positionals = (args, valueFlags) => {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++
    else if (!String(args[i]).startsWith('-')) out.push(String(args[i]))
  }
  return out
}

const usageLine = (reason, next) => `USAGE (status 400): ${stripControl(reason)}${next ? `. next: ${next}` : ''}`

// The scanner the check runs: reads a folder, prints `path:line message` for each call of the banned function (the form `meerkat findings` reads), exits 1 if it found any.
export function scannerSource() {
  return `// Scans a folder for calls to a banned function in JavaScript files.
// Usage: node scan.mjs <folder> <function-name>      exit 0: none found, exit 1: found (one "path:line message" line each)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const [root = '.', name = '${DEFAULT_BAN}'] = process.argv.slice(2)
const call = new RegExp('\\\\b' + name.replace(/[$]/g, '\\\\$') + '\\\\s*\\\\(')
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\\.(js|mjs|cjs|jsx)$/.test(n) ? [p] : []
  })

const hits = []
for (const file of walk(root)) {
  readFileSync(file, 'utf8')
    .split(/\\r?\\n/)
    .forEach((line, i) => {
      if (call.test(line)) hits.push(relative(root, file).replace(/\\\\/g, '/') + ':' + (i + 1) + ' banned function ' + name + ' is called')
    })
}
if (hits.length) {
  for (const h of hits) console.log(h)
  console.log('banned function ' + name + ' is called in ' + hits.length + ' place(s): use its replacement')
  process.exit(1)
}
console.log('no calls to ' + name)
`
}

export function checkSource(id, ban) {
  return `// ${id}: flags calls to the function ${ban} in JavaScript files. Written by \`meerkat new check\`; edit freely.
// How it fits together: docs/add-a-check.md. Prove it works: meerkat self-test --only ${id}
import { fileURLToPath } from 'node:url'

const scan = fileURLToPath(new URL('./${id}/scan.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('./${id}/fixture', import.meta.url))

export default [
  {
    id: '${id}',
    group: 'functionality', // security, functionality, ui, performance or refactor
    tier: 'fast', // fast runs in quick runs and the gate; thorough only in full
    lane: 'free',
    weight: 'tiny', // a check that only reads files is tiny
    title: 'No calls to ${ban}',
    estSeconds: 1,
    needs: ['node'],
    paths: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'], // the gate runs it only when a changed file matches
    severity: 'medium',
    fix: 'Replace the call to ${ban} with its replacement',
    run: { cmd: 'node', args: [scan, '{app}', '${ban}'], cwd: 'repo' },
    // The self-test: the same program on a small broken folder. It must FAIL, and for this reason.
    selfTest: { cmd: 'node', args: [scan, fixture, '${ban}'], cwd: 'repo', expectFail: true, expectMatch: 'banned function ${ban}' },
  },
]
`
}

export const fixtureSource = (ban) => `// A deliberately broken file: the check must flag the next line.\n${ban}('this call is banned')\n`

const exists = (p) => existsSync(p)
const isDir = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Writes the three files of a check into `dir`. Refuses (and writes nothing) if any of them is already there.
function writeCheck(dir, id, ban) {
  const files = { [join(dir, `${id}.mjs`)]: checkSource(id, ban), [join(dir, id, 'scan.mjs')]: scannerSource(), [join(dir, id, 'fixture', 'bad.js')]: fixtureSource(ban) }
  const taken = Object.keys(files).find(exists)
  if (taken) return { ok: false, reason: `${taken} already exists, so nothing was written`, next: 'pick another id, or edit that file' }
  mkdirSync(join(dir, id, 'fixture'), { recursive: true })
  for (const [file, text] of Object.entries(files)) writeFileSync(file, text)
  return { ok: true, file: join(dir, `${id}.mjs`), files: Object.keys(files) }
}

// Where `--pack` points: a folder path, the name of a pack Meerkat can find, or (a new name) a personal pack folder.
function packFolder(spec, { cwd, env, home }) {
  if (/[\\/]/.test(spec) || isAbsolute(spec) || isDir(resolve(cwd, spec))) return { dir: resolve(cwd, spec), kind: 'folder' }
  if (!KEBAB.test(spec)) return { error: `"${spec}" is not a pack name (lowercase letters, digits and hyphens) or a folder` }
  const found = availablePacks(env, home).find((p) => p.name === spec)
  if (found) return { dir: found.dir, kind: found.source, name: spec }
  return { dir: join(home, '.meerkat', 'packs', spec), kind: 'new personal pack', name: spec }
}

export function runNew(args, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), home = homedir() } = {}) {
  const [what, ...rest] = args
  const fail = (reason, next) => {
    const line = usageLine(reason, next)
    out(line)
    err(line)
    return 2
  }
  const valueFlags = ['--pack', '--dir', '--ban', '--app']
  for (let i = 0; i < rest.length; i++) {
    const a = String(rest[i])
    if (valueFlags.includes(a)) {
      if (i + 1 >= rest.length || String(rest[i + 1]).startsWith('--')) return fail(`${a} needs a value`, `usage: ${NEW_USAGE.join(' | ')}`)
      i++
    } else if (a.startsWith('-') && !['--json', '-q', '--quiet', '--no-color', '-y', '--yes', '--no-input'].includes(a)) return fail(`unknown option ${a.replace(/[\p{Cc}\p{Cf}]/gu, '?')}`, `usage: ${NEW_USAGE.join(' | ')}`)
  }
  const ban = flagValue(rest, '--ban') ?? DEFAULT_BAN
  if (!IDENT.test(ban)) return fail(`--ban ${stripControl(ban)} is not a function name (letters, digits, _ and $)`)
  const [name] = positionals(rest, valueFlags)

  if (what === 'check') {
    if (!name) return fail('say the id of the new check', 'meerkat new check <id> [--pack <name|folder>]')
    if (!KEBAB.test(name)) return fail(`check id "${stripControl(name)}" must be kebab-case (lowercase letters, digits and hyphens)`)
    const spec = flagValue(rest, '--pack')
    const app = resolve(cwd, flagValue(rest, '--app') ?? '.')
    let dir
    let where
    if (spec) {
      const p = packFolder(spec, { cwd, env, home })
      if (p.error) return fail(p.error)
      if (p.kind === 'bundled' || p.kind === 'example') return fail(`pack "${spec}" ships with Meerkat and an update replaces it`, 'use your own pack: meerkat new pack <name>, or --pack <folder>')
      dir = p.dir
      where = `pack ${p.name ?? basename(dir)}`
    } else {
      if (!isDir(app)) return fail(`folder does not exist: ${app}`)
      dir = join(app, '.meerkat', 'checks')
      where = 'this project (.meerkat/checks)'
    }
    const w = writeCheck(dir, name, ban)
    if (!w.ok) return fail(w.reason, w.next)
    const lines = [`created check ${name} in ${where}`, ...w.files.map((f) => `  ${f}`), '', 'next, in order:']
    if (spec) {
      const personal = resolve(dir, '..') === join(home, '.meerkat', 'packs')
      let n = 1
      if (!personal) lines.push(`  ${n++}. meerkat pack add ${resolve(dir, '..')}      (once) tell Meerkat to look for packs in that folder`)
      lines.push(`  ${n++}. meerkat pack enable ${basename(dir)}      switch the pack on for this project`)
      lines.push(`  ${n++}. meerkat self-test --only ${name}      prove it fails on its broken case, for the right reason`)
      lines.push(`  ${n++}. meerkat check try ${name}      run it on this project`)
    } else {
      lines.push(`  1. meerkat self-test --only ${name}      prove it fails on its broken case, for the right reason (the first run in a terminal asks you to trust the project's check files)`)
      lines.push(`  2. meerkat check try ${name}      run it on this project`)
      lines.push('  3. meerkat gate --base main      the gate runs it when a changed file matches its paths')
    }
    lines.forEach((l) => out(l))
    return 0
  }

  if (what === 'pack') {
    if (!name) return fail('say the name of the new pack', 'meerkat new pack <name> [--dir <folder>]')
    if (!KEBAB.test(name)) return fail(`pack name "${stripControl(name)}" must be lowercase letters, digits and hyphens`)
    if (availablePacks(env, home).some((p) => p.name === name && (p.source === 'bundled' || p.source === 'example'))) return fail(`a pack named "${name}" ships with Meerkat and would win over yours`, 'choose another name')
    const parentSpec = flagValue(rest, '--dir')
    const parent = parentSpec ? resolve(cwd, parentSpec) : join(home, '.meerkat', 'packs')
    const dir = join(parent, name)
    if (exists(dir)) return fail(`${dir} already exists, so nothing was written`, 'pick another name, or add a check to it: meerkat new check <id> --pack ' + name)
    const id = `${name}-no-${ban.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'legacy-call'}`
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ pack: name, about: `${name}: checks written by me. Example check: ${id}` }, null, 2)}\n`)
    const w = writeCheck(dir, id, ban)
    if (!w.ok) return fail(w.reason, w.next)
    const lines = [`created pack ${name} at ${dir}`, `  ${join(dir, 'pack.json')}`, ...w.files.map((f) => `  ${f}`), '', 'load it:']
    let n = 1
    if (parentSpec) lines.push(`  ${n++}. meerkat pack add ${parent}      tell Meerkat to look for packs in that folder (once)`)
    else lines.push('  (this folder is ~/.meerkat/packs, which Meerkat always looks in; no "pack add" is needed)')
    lines.push(`  ${n++}. meerkat pack enable ${name}      switch it on for this project (adds "${name}" to "packs" in meerkat.config.json)`)
    lines.push(`  ${n++}. meerkat self-test --only ${id}      prove the example check works`)
    lines.forEach((l) => out(l))
    return 0
  }

  return fail(what ? `unknown thing to create: ${stripControl(what)}` : 'say what to create', `usage: ${NEW_USAGE.join(' | ')}`)
}
