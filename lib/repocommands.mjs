// A repo's own test and build commands: the `commands` block of meerkat.config.json.
//   { "commands": { "test": "npm test", "build": "npm run build", "typecheck": "npx tsc --noEmit" } }
//   meerkat commands   lists them     meerkat test   runs `test`     meerkat build   runs `build`
// Only a command written in that block is ever run, exactly as written, from the folder the config file is in. The command is printed first.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { findConfig } from './config.mjs'
import { globToRegExp } from './glob.mjs'
import { getTrustRecord, isTrusted } from './trust.mjs'
import { stripControl } from './tui/safe.mjs'

// Control (Cc), format (Cf: bidi overrides, zero-width joiners) and line/paragraph separators (Zl, Zp) can all hide what a command does.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const show = (t) => stripControl(String(t)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
import { appDirOf, repoRootOf } from './paths.mjs'
import { markPartial } from './cost.mjs'

// { file, dir, commands: { name: "command" }, notes } for the config that governs `appDir` (null file when there is none).
export function readCommands(appDir) {
  const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  const notes = []
  const commands = {}
  if (!file) return { file: null, dir: appDir, commands, notes }
  let raw = null
  let unreadable = false
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))?.commands
  } catch (e) {
    notes.push(`${file} could not be read as JSON (${String(e?.message ?? e).split(String.fromCharCode(10))[0]}), so no commands are available; fix the file`)
    unreadable = true
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
  return { file, dir: dirname(file), commands, notes, unreadable }
}

// The repo's commands run through a shell, so they need the same one-time trust as a project's own check code: a record per config file, keyed to a
// hash of the commands block (a changed command asks again). MEERKAT_TRUST_PROJECT=1 is the documented choice of whoever runs Meerkat (a CI job
// that owns its repository). Nothing here asks a question: `meerkat trust` does.
export const trustKey = (r) => `commands:${resolve(r.file).replace(/\\/g, '/')}`
export const trustHash = (r) => createHash('sha256').update(JSON.stringify(Object.entries(r.commands).sort())).digest('hex')
// A second checkout (git worktree) of the same repository may inherit an approval, but ONLY when the approved side says so. The approval is also
// recorded under the repository's git common directory plus the config file's place inside the repository. The decision is never taken from
// the candidate folder's own git metadata (a folder whose .git points elsewhere could claim any identity): when the shared record's hash
// matches, the approved repo's own `git worktree list --porcelain` (run against the common directory stored in the approved record) must list
// the candidate's real path as a worktree. Not listed means not trusted. Any change to the commands text changes the hash and needs a new approval.
const gitEnv = () => {
  const e = { ...process.env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete e[k]
  return e
}
const fwdPath = (p) => String(p).split(String.fromCharCode(92)).join('/')
const realFwd = (p) => {
  let c = resolve(String(p))
  try { c = realpathSync(c) } catch { /* keep the resolved path */ }
  return fwdPath(c)
}
export const foldPath = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p))
// The nearest folder at or above `dir` that holds a .git entry (file or directory), found on disk without asking git; its real path.
export function candidateTop(dir) {
  let d = resolve(dir)
  for (;;) {
    if (existsSync(join(d, '.git'))) return realFwd(d)
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
}
// The git common directory the candidate CLAIMS (used only to pick which shared record to look at, never to decide trust).
export function claimedCommon(dir) {
  try {
    const g = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8', timeout: 10000, env: gitEnv() })
    if (g.status !== 0) return null
    const common = g.stdout.split(/\r?\n/)[0]
    return common ? realFwd(resolve(dir, common)) : null
  } catch {
    return null
  }
}
function configRel(r, top) {
  const f = realFwd(r.file)
  const t = top.endsWith('/') ? top : `${top}/`
  return foldPath(f).startsWith(foldPath(t)) ? f.slice(t.length) : null
}
export function sharedTrustKey(r) {
  if (!r.file) return null
  const top = candidateTop(r.dir)
  const common = claimedCommon(r.dir)
  if (!top || !common) return null
  const rel = configRel(r, top)
  if (rel === null) return null
  return `commands@git:${foldPath(common)}|${rel}`
}
// The real paths of every worktree the repository at `common` lists, run from the approved repo (its recorded folder when that still exists).
export function registeredWorktrees(common, cwdHint) {
  try {
    const cwd = cwdHint && existsSync(String(cwdHint)) ? String(cwdHint) : common
    const g = spawnSync('git', ['--git-dir', common, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 10000, cwd, env: gitEnv() })
    if (g.status !== 0) return null
    return g.stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => realFwd(l.slice('worktree '.length)))
  } catch {
    return null
  }
}
export const revokedKey = (top) => `inherit-revoked:${foldPath(top)}`
// Is this candidate a live, registered worktree of the repository the shared record `sh` was approved in? { ok, worktree, why }
export function verifyInherit(r, sh, env = process.env) {
  const top = candidateTop(r.dir)
  if (!top || !sh || !sh.common) return { ok: false, why: 'no approved repository is recorded for it' }
  if (configRel(r, top) === null) return { ok: false, why: 'its commands file is not inside its own worktree' }
  const live = registeredWorktrees(sh.common, sh.folder)
  if (!live) return { ok: false, why: 'the approved repository could not list its worktrees' }
  if (!live.some((w) => foldPath(w) === foldPath(top))) return { ok: false, why: `it is not a registered worktree of ${sh.common} (git worktree list does not include ${top})` }
  const rv = getTrustRecord(env, revokedKey(top))
  if (rv && rv.hash === sh.hash) return { ok: false, why: 'its inheritance was revoked here', revoked: true }
  return { ok: true, worktree: top }
}
// { trusted, via: 'record' | 'inherited' | 'env' | null, from, rec } where rec is the newest approval on record (own, else shared) for before/after.
export function trustStatus(r, env = process.env) {
  const hash = trustHash(r)
  const own = r.file ? getTrustRecord(env, trustKey(r)) : null
  if (own && own.hash === hash) return { trusted: true, via: 'record', rec: own }
  const shared = r.file ? sharedTrustKey(r) : null
  const sh = shared ? getTrustRecord(env, shared) : null
  let why = null
  if (sh && sh.hash === hash) {
    const v = verifyInherit(r, sh, env)
    if (v.ok) return { trusted: true, via: 'inherited', from: sh.folder ?? null, worktree: v.worktree, common: sh.common, rec: sh }
    why = v.why
  }
  if (env.MEERKAT_TRUST_PROJECT === '1') return { trusted: true, via: 'env', rec: own ?? sh }
  return { trusted: false, via: null, rec: own ?? sh, why }
}
export const commandsTrusted = (r, env = process.env) => trustStatus(r, env).trusted

// The one line every command prints when it refuses because the folder is not trusted (test, frontend, gate, evidence).
// A folder as one shell word for a copy-paste command, or null when its name is not plainly safe. Only letters, digits and _ . / : @ + - and
// spaces are accepted; anything else (quotes of any kind including Unicode ones, $ ` ( ) & | < > ^ % ! ; and so on) gets no pasteable command.
const SAFE_PATH = /^[A-Za-z0-9_./:@+ -]+$/
export const shellQuote = (p) => (SAFE_PATH.test(String(p)) ? `'${String(p)}'` : null)
// "meerkat trust <folder>" as text to paste, or, for an unsafe folder name, the folder on its own line with the words to do it by hand.
export const trustCommand = (folder, { flag = '', yes = false } = {}) => {
  const q = shellQuote(folder)
  if (q) return `meerkat trust${flag ? ` ${flag}` : ''} ${q}${yes ? ' --yes' : ''}`
  return `copy this folder path and run meerkat trust on it yourself${flag || yes ? ` (add ${[flag, yes ? '--yes' : ''].filter(Boolean).join(' ')})` : ''}:
${folder}`
}
export const notTrustedLine = (r) => { const f = show(String(r.dir).split(String.fromCharCode(92)).join('/')); return `not run: ${f} is not trusted yet. Run: ${trustCommand(f)}` }
// frontend's refusal: the folder to trust and the command, first line of the output.
export const frontendUntrustedLine = (r) => {
  const f = show(String(r.dir).split(String.fromCharCode(92)).join('/'))
  const q = shellQuote(f)
  const head = `NOT RUN (status 400): ${f} is not trusted yet, so its commands did not run.`
  return q ? `${head} next: meerkat trust --app ${q}` : `${head} next: run meerkat trust --app on that folder yourself (its name has characters that cannot be pasted safely)`
}
export const show_ = show

export const folderOf = (argv, env, cwd) => {
  const app = argv.indexOf('--app')
  if (app >= 0 && argv[app + 1]) return resolve(cwd, argv[app + 1])
  const pos = argv.find((a, i) => !a.startsWith('-') && argv[i - 1] !== '--app')
  return pos ? resolve(cwd, pos) : resolve(appDirOf(env, cwd))
}

// The `legacy` list of meerkat.config.json: folder paths or globs (apps/old, packages/old-*) that commands, verdict and top leave out.
export function readLegacy(appDir) {
  const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  const raw = file ? readJson(file)?.legacy : null
  return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')) : []
}
// The legacy entry that covers `path` (the path itself or any folder above it), or null.
export function legacyMatch(patterns, path) {
  const parts = String(path).replace(/\\/g, '/').split('/')
  for (let i = 1; i <= parts.length; i++) {
    const prefix = parts.slice(0, i).join('/')
    if (patterns.some((p) => globToRegExp(p).test(prefix))) return prefix
  }
  return null
}

const WANTED = ['test', 'build', 'typecheck', 'lint']
const readJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

// One level down: apps/*, packages/* and the folders a root `workspaces` field names (a trailing /* lists that folder's children).
// Returns [{ path: 'apps/web', scripts: [[name, body]] }] for the packages that have at least one of the wanted scripts.
export function workspaceScripts(root, legacy = [], hidden = new Set()) {
  const ws = readJson(join(root, 'package.json'))?.workspaces
  const listed = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : []
  const patterns = [...new Set(['apps/*', 'packages/*', ...listed.filter((x) => typeof x === 'string')])]
  const dirs = new Set()
  for (const pat of patterns) {
    const clean = pat.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (clean.includes('..') || clean.startsWith('/')) continue
    if (clean.endsWith('/*')) {
      const parent = clean.slice(0, -2)
      if (parent.includes('*')) continue
      try {
        for (const e of readdirSync(join(root, parent), { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules') dirs.add(`${parent}/${e.name}`)
      } catch {
        /* a pattern that matches no folder */
      }
    } else if (!clean.includes('*')) dirs.add(clean)
  }
  const found = []
  for (const d of [...dirs].sort()) {
    const hit = legacyMatch(legacy, d)
    if (hit) {
      hidden.add(hit)
      continue
    }
    const sc = readJson(join(root, d, 'package.json'))?.scripts
    const scripts = sc && typeof sc === 'object' ? WANTED.filter((n) => typeof sc[n] === 'string').map((n) => [n, sc[n]]) : []
    if (scripts.length) found.push({ path: d, scripts })
  }
  return found
}

// The test, build, typecheck and lint scripts of the folder's package.json, as [name, body] (empty when there is none).
export function packageScripts(dir) {
  try {
    const sc = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))?.scripts
    if (!sc || typeof sc !== 'object') return []
    return ['test', 'build', 'typecheck', 'lint'].filter((n) => typeof sc[n] === 'string').map((n) => [n, sc[n]])
  } catch {
    return []
  }
}

export function runCommandsList(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const r = readCommands(folderOf(argv, env, cwd))
  for (const n of r.notes) err(`meerkat commands: ${show(n)}`)
  if (r.unreadable) return 2
  if (argv.includes('--json')) {
    out(JSON.stringify({ config: r.file, commands: r.commands }, null, 2).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' '))
    return 0
  }
  const names = Object.keys(r.commands)
  if (!names.length) {
    // No commands block: show the repo's own package.json scripts (read-only) and how to pin them.
    const scripts = packageScripts(r.file ? r.dir : folderOf(argv, env, cwd))
    if (scripts.length) {
      const w2 = Math.max(...scripts.map(([n]) => n.length))
      out(`no commands block${r.file ? ` in ${show(r.file)}` : ' (there is no meerkat.config.json)'}; these are the package.json scripts (nothing here is run):`)
      for (const [n, c] of scripts) out(`${n.padEnd(w2)}  npm run ${n}   (runs: ${show(c)})`)
      out(`to pin them: add { "commands": { ${scripts.map(([n]) => `"${n}": "npm run ${n}"`).join(', ')} } } to meerkat.config.json, then run meerkat trust`)
      return 0
    }
    const wsRoot = r.file ? r.dir : folderOf(argv, env, cwd)
    const hidden = new Set()
    const pkgs = workspaceScripts(wsRoot, readLegacy(wsRoot), hidden)
    if (pkgs.length) {
      const rows = pkgs.flatMap((p) => p.scripts.map(([n, c]) => `${show(p.path)}  ${n}  npm --prefix ${show(p.path)} run ${n}   (runs: ${show(c)})`))
      out(`no commands block${r.file ? ` in ${show(r.file)}` : ' (there is no meerkat.config.json)'} and no root scripts; these are the scripts of the packages one level down (nothing here is run):`)
      for (const l of rows.slice(0, 40)) out(l)
      if (rows.length > 40) out(`... ${rows.length - 40} more omitted (${rows.length} scripts in ${pkgs.length} packages)`)
      if (hidden.size) out(`${hidden.size} folder(s) hidden as legacy (the legacy list in meerkat.config.json)`)
      const first = pkgs[0]
      out(`to pin one: add { "commands": { "test": "npm --prefix ${show(first.path)} run ${first.scripts[0][0]}" } } to meerkat.config.json, then run meerkat trust`)
      return 0
    }

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
    if (r.unreadable) {
      for (const n of r.notes) err(`meerkat ${name}: ${show(n)}`)
      return 2
    }
    if (fallback) {
      err(`meerkat ${name}: no ${name} command is configured (${r.file ? `${show(r.file)} has no commands.${name}` : 'there is no meerkat.config.json here'}). Set one with { "commands": { "${name}": "<your command>" } } in meerkat.config.json, then run meerkat trust; for the quick check run: meerkat run --preset quick`)
      return 2
    }
    err(`meerkat ${name}: ${r.file ? `${show(r.file)} defines no commands.${name}` : 'there is no meerkat.config.json here'}. Add { "commands": { "${name}": "<your command>" } }; meerkat commands lists what is defined.`)
    return 2
  }
  if (!commandsTrusted(r, env)) {
    err(notTrustedLine(r))
    return fallback ? null : 1
  }
  const extra = argv.filter((a, i) => a.startsWith('-') && a !== '--app' && argv[i - 1] !== '--app')
  if (extra.length) {
    err(`meerkat ${name}: unknown option ${extra[0]}. usage: meerkat ${name} [folder]. The command runs exactly as written in the config.`)
    return 2
  }
  markPartial()
  out(`$ ${cmd}   (in ${r.dir.replace(/\\/g, '/')})`)
  const res = spawnSync(cmd, { cwd: r.dir, shell: true, stdio: 'inherit', env }) // meerkat-ignore js-spawn-shell guarded above: the command is run only after commandsTrusted() and exactly as written in the trusted config
  if (res.error) {
    err(`meerkat ${name}: could not start the command: ${res.error.message}`)
    return 1
  }
  return res.status ?? 1
}
