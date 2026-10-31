// Keeping Meerkat up to date.
//
// This is the ONLY code in Meerkat that talks to the network by itself (one `git fetch` of Meerkat's own clone).
// It does that only when the person turned it on (`meerkat update notify` or `auto`) or asked (`meerkat update`).
// With the default mode, off, Meerkat never contacts GitHub on its own. Nothing is sent about you or your project.
//
// Every function takes an `exec(cmd, args, { cwd })` that returns the output text or throws, so tests use a fake one.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { readUserConfig, updateMode, writeUserConfig } from './userconfig.mjs'

export const DAY_MS = 24 * 60 * 60 * 1000
const MAX_COMMITS = 15

export const defaultExec = (cmd, args, { cwd } = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })

const git = (exec, repoDir, ...args) => String(exec('git', args, { cwd: repoDir })).trim()
const sameDir = (a, b) => {
  const n = (p) => resolve(p).replace(/\\/g, '/').replace(/\/$/, '')
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b)
}

function isOwnClone(exec, repoDir) {
  try {
    return sameDir(git(exec, repoDir, 'rev-parse', '--show-toplevel'), repoDir)
  } catch {
    return false
  }
}

// origin's default branch, else origin/main
function remoteRef(exec, repoDir) {
  try {
    const ref = git(exec, repoDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    if (ref) return ref
  } catch {
    /* no default branch recorded */
  }
  return 'origin/main'
}

const versionAt = (exec, repoDir, ref) => {
  try {
    return JSON.parse(git(exec, repoDir, 'show', `${ref}:package.json`)).version ?? null
  } catch {
    return null
  }
}

const NOT_A_CLONE = { ok: false, reason: 'not a git clone, update it the way you installed it' }

export function checkForUpdate({ repoDir, exec = defaultExec }) {
  if (!isOwnClone(exec, repoDir)) return NOT_A_CLONE
  try {
    git(exec, repoDir, 'fetch', '--quiet', 'origin') // the only network use
    const ref = remoteRef(exec, repoDir)
    const behind = Number.parseInt(git(exec, repoDir, 'rev-list', '--count', `HEAD..${ref}`), 10) || 0
    const commits = behind ? git(exec, repoDir, 'log', '--format=%s', `-n${MAX_COMMITS}`, `HEAD..${ref}`).split('\n').filter(Boolean).slice(0, MAX_COMMITS) : []
    return { ok: true, behind, commits, version: versionAt(exec, repoDir, ref), ref }
  } catch (e) {
    return { ok: false, reason: `could not check: ${String(e.message ?? e).split('\n')[0]}` }
  }
}

export function applyUpdate({ repoDir, exec = defaultExec }) {
  if (!isOwnClone(exec, repoDir)) return NOT_A_CLONE
  try {
    if (git(exec, repoDir, 'status', '--porcelain')) return { ok: false, reason: 'you have changes in Meerkat\'s folder, so it was not updated. Save or undo them first' }
    const ref = remoteRef(exec, repoDir)
    try {
      git(exec, repoDir, 'merge-base', '--is-ancestor', 'HEAD', ref)
    } catch {
      return { ok: false, reason: 'Meerkat\'s folder has changes of its own that are not on GitHub, so it cannot update by itself' }
    }
    const from = versionAt(exec, repoDir, 'HEAD')
    git(exec, repoDir, 'merge', '--ff-only', ref)
    return { ok: true, from, to: versionAt(exec, repoDir, 'HEAD') }
  } catch (e) {
    return { ok: false, reason: `could not update: ${String(e.message ?? e).split('\n')[0]}` }
  }
}

// At most once a day, only in a mode the person chose. Silent about failures. Returns what happened (for tests).
export function maybeAutoUpdate({ repoDir, exec = defaultExec, env = process.env, home, now = Date.now(), print = () => {} }) {
  const mode = updateMode(env, home)
  if (mode === 'off') return { ran: false, why: 'off' }
  const last = Date.parse(readUserConfig(env, home).lastUpdateCheck ?? '')
  if (Number.isFinite(last) && now - last < DAY_MS) return { ran: false, why: 'checked recently' }
  try {
    writeUserConfig({ lastUpdateCheck: new Date(now).toISOString() }, env, home)
  } catch {
    return { ran: false, why: 'could not save the check time' }
  }
  const found = checkForUpdate({ repoDir, exec })
  if (!found.ok) return { ran: true, found }
  if (!found.behind) return { ran: true, found }
  if (mode === 'notify') {
    print(`Meerkat has ${found.behind} new change${found.behind === 1 ? '' : 's'}${found.version ? ` (version ${found.version})` : ''}. Run: meerkat update`)
    return { ran: true, found, notified: true }
  }
  const applied = applyUpdate({ repoDir, exec })
  if (applied.ok) print(`Meerkat updated${applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''}: ${found.commits[0] ?? 'new changes'}${found.behind > 1 ? ` and ${found.behind - 1} more` : ''}.`)
  return { ran: true, found, applied }
}

export const MODE_MEANING = {
  off: 'Meerkat never contacts GitHub on its own. You update with: meerkat update',
  notify: 'Once a day Meerkat checks GitHub and tells you when there is a new version. It does not change anything.',
  auto: 'Once a day Meerkat checks GitHub and installs new versions by itself when that is safe.',
}

export function setMode(mode, env = process.env, home) {
  writeUserConfig({ updates: mode }, env, home)
  return MODE_MEANING[mode]
}

export function statusText(env = process.env, home) {
  const mode = updateMode(env, home)
  const last = readUserConfig(env, home).lastUpdateCheck
  return `Update mode: ${mode}\n${MODE_MEANING[mode]}\nLast check: ${last ?? 'never'}`
}

async function askYesNo(question, stdin, stdout) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const a = await rl.question(question)
    return /^y(es)?$/i.test(a.trim())
  } finally {
    rl.close()
  }
}

// `meerkat update`, `--check`, `--yes`, a mode, or status. Returns the exit code.
export async function runUpdateCommand(plan, { repoDir, exec = defaultExec, env = process.env, stdin = process.stdin, stdout = process.stdout, home } = {}) {
  const say = (t) => stdout.write(`${t}\n`)
  if (plan.action === 'set') {
    say(`Update mode is now ${plan.mode}. ${setMode(plan.mode, env, home)}`)
    return 0
  }
  if (plan.action === 'status') {
    say(statusText(env, home))
    return 0
  }
  say('Checking GitHub for a new version of Meerkat...')
  const found = checkForUpdate({ repoDir, exec })
  if (!found.ok) {
    say(`Cannot update: ${found.reason}`)
    return 1
  }
  try {
    writeUserConfig({ lastUpdateCheck: new Date().toISOString() }, env, home)
  } catch {
    /* not being able to remember the check changes nothing */
  }
  if (!found.behind) {
    say('Meerkat is up to date.')
    return 0
  }
  say(`${found.behind} new change${found.behind === 1 ? '' : 's'}${found.version ? ` (version ${found.version})` : ''}:`)
  for (const c of found.commits) say(`  - ${c}`)
  if (found.behind > found.commits.length) say(`  ...and ${found.behind - found.commits.length} more`)
  if (plan.action === 'check') return 0
  if (!plan.yes) {
    if (!stdin.isTTY) {
      say('Run "meerkat update --yes" to install it.')
      return 0
    }
    if (!(await askYesNo('Update now? [y/N] ', stdin, stdout))) {
      say('Not updated.')
      return 0
    }
  }
  const applied = applyUpdate({ repoDir, exec })
  if (!applied.ok) {
    say(`Not updated: ${applied.reason}`)
    return 1
  }
  say(`Updated${applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''}.`)
  return 0
}
