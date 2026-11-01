// Keeping Meerkat up to date.
//
// This is the ONLY code in Meerkat that talks to the network by itself (one `git fetch` of Meerkat's own clone).
// It does that only when the person turned it on (`meerkat update notify` or `auto`) or asked (`meerkat update`).
// In the default mode, notify, Meerkat looks up the latest version at most once a day (read-only, 3 second limit) and never installs;
// `meerkat update off` stops the lookup. Only mode auto installs by itself. Nothing is sent about you or your project.
//
// Every function takes an `exec(cmd, args, { cwd })` that returns the output text or throws, so tests use a fake one.
import { execFile, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { readUserConfig, updateMode, writeUserConfig } from './userconfig.mjs'
import { isNewer, isVersion, VERSION } from './version.mjs'

export const DAY_MS = 24 * 60 * 60 * 1000
const MAX_COMMITS = 15

export const defaultExec = (cmd, args, { cwd } = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })

// The same as defaultExec with a shorter hard limit: the check done on its own before the menu may never hold it up for long.
const timedExec = (timeoutMs) => (cmd, args, { cwd } = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })

// The same, but it does not block: the menu keeps drawing (and reading keys) while git works. Returns a promise of the output text.
export const asyncTimedExec = (timeoutMs) => (cmd, args, { cwd } = {}) =>
  new Promise((ok, no) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, out) => (e ? no(e) : ok(out)))
  })

// ---- the version numbers and the remembered answer ----
// The newest version GitHub told us about is kept in the personal file as updateCache { latest, checkedAt } so the menu can show
// a notice without asking again. Reading it never touches the network.
// The version rules live in lib/version.mjs (one helper, semver precedence); re-exported here for the callers that already import them.
export { compareVersions, isNewer, isVersion, VERSION } from './version.mjs'

// This copy's own version. Kept for lib/menu.mjs: it is always VERSION from package.json, the directory argument is not read.
export function readVersion() {
  return VERSION
}

// { latest, checkedAt (ms) } or null when there is no usable entry. Anything that is not a plain version number is ignored.
export function readUpdateCache(env = process.env, home) {
  const c = readUserConfig(env, home).updateCache
  if (!c || typeof c !== 'object' || Array.isArray(c) || !isVersion(c.latest)) return null
  const checkedAt = Date.parse(typeof c.checkedAt === 'string' ? c.checkedAt : '')
  const behind = Number.isInteger(c.behind) && c.behind > 0 ? Math.min(c.behind, 99999) : 0
  return Number.isFinite(checkedAt) ? { latest: c.latest, behind, checkedAt } : null
}

// Returns false (and writes nothing) for something that is not a version number.
// `behind` is how many commits the newest code is ahead of this copy: a fix published without a new version number still shows as an update.
export function writeUpdateCache(latest, now = Date.now(), env = process.env, home, behind = 0) {
  if (!isVersion(latest)) return false
  const n = Number.isInteger(behind) && behind > 0 ? Math.min(behind, 99999) : 0
  writeUserConfig({ updateCache: { latest, behind: n, checkedAt: new Date(now).toISOString() } }, env, home)
  return true
}

export const clearUpdateCache = (env = process.env, home) => writeUserConfig({ updateCache: null }, env, home)

// What the yellow bar says: { latest, current, checkedAt } when the remembered newest version is newer than this one, else null.
export function updateNotice({ current, env = process.env, home } = {}) {
  const c = readUpdateCache(env, home)
  if (!c) return null
  if (isNewer(c.latest, current)) return { latest: c.latest, current, checkedAt: c.checkedAt }
  // The same version number but newer code (a patch with no bump): shown as the version plus the number of new changes, like 1.2.3+3.
  if (c.behind > 0 && !isNewer(current, c.latest)) return { latest: `${c.latest}+${c.behind}`, current, checkedAt: c.checkedAt }
  return null
}

// The once-a-day rule: only in a mode the person chose, and only when the last check (either record of it) is a day old or missing.
export function checkDue({ mode, env = process.env, home, now = Date.now() }) {
  if (mode !== 'notify' && mode !== 'auto') return false
  const stamps = [Date.parse(readUserConfig(env, home).lastUpdateCheck ?? ''), readUpdateCache(env, home)?.checkedAt ?? Number.NaN].filter(Number.isFinite)
  return !stamps.length || now - Math.max(...stamps) >= DAY_MS
}

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

// checkForUpdate for an exec that may return a promise (asyncTimedExec): `await` takes both kinds. Same answers.
export async function checkForUpdateAsync({ repoDir, exec = defaultExec }) {
  const g = async (...args) => String(await exec('git', args, { cwd: repoDir })).trim()
  try {
    if (!sameDir(await g('rev-parse', '--show-toplevel'), repoDir)) return NOT_A_CLONE
  } catch {
    return NOT_A_CLONE
  }
  try {
    await g('fetch', '--quiet', 'origin') // the only network use
    let ref = 'origin/main'
    try {
      ref = (await g('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')) || ref
    } catch {
      /* no default branch recorded */
    }
    const behind = Number.parseInt(await g('rev-list', '--count', `HEAD..${ref}`), 10) || 0
    const commits = behind ? (await g('log', '--format=%s', `-n${MAX_COMMITS}`, `HEAD..${ref}`)).split('\n').filter(Boolean).slice(0, MAX_COMMITS) : []
    let version = null
    try {
      version = JSON.parse(await g('show', `${ref}:package.json`)).version ?? null
    } catch {
      /* no version at that ref */
    }
    return { ok: true, behind, commits, version, ref }
  } catch (e) {
    return { ok: false, reason: `could not check: ${String(e.message ?? e).split('\n')[0]}` }
  }
}

// maybeAutoUpdate without blocking (the menu shows a spinner meanwhile). Same rules, same return values.
export async function maybeAutoUpdateAsync({ repoDir, exec = defaultExec, applyExec = defaultExec, env = process.env, home, now = Date.now(), print = () => {}, onCheck = () => {}, onDone = () => {} }) {
  const mode = updateMode(env, home)
  if (mode === 'off') return { ran: false, why: 'off' }
  if (!checkDue({ mode, env, home, now })) return { ran: false, why: 'checked recently' }
  try {
    writeUserConfig({ lastUpdateCheck: new Date(now).toISOString() }, env, home)
  } catch {
    return { ran: false, why: 'could not save the check time' }
  }
  onCheck()
  let found
  try {
    found = await checkForUpdateAsync({ repoDir, exec })
  } finally {
    onDone()
  }
  if (!found.ok) return { ran: true, found }
  try {
    writeUpdateCache(found.version, now, env, home, found.behind)
  } catch {
    /* not being able to remember the answer changes nothing */
  }
  if (!found.behind) return { ran: true, found }
  if (mode === 'notify') {
    print(`Meerkat has ${found.behind} new change${found.behind === 1 ? '' : 's'}${found.version ? ` (version ${found.version})` : ''}. Run: meerkat update`)
    return { ran: true, found, notified: true }
  }
  const applied = applyUpdate({ repoDir, exec: applyExec })
  if (applied.ok) {
    try {
      clearUpdateCache(env, home)
    } catch {
      /* see above */
    }
    print(`Meerkat updated${applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''}: ${found.commits[0] ?? 'new changes'}${found.behind > 1 ? ` and ${found.behind - 1} more` : ''}.`)
  }
  return { ran: true, found, applied }
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
// onCheck / onDone bracket the network call so the caller can show "Checking for updates..." and take it away again.
export function maybeAutoUpdate({ repoDir, exec = defaultExec, env = process.env, home, now = Date.now(), print = () => {}, onCheck = () => {}, onDone = () => {} }) {
  const mode = updateMode(env, home)
  if (mode === 'off') return { ran: false, why: 'off' }
  if (!checkDue({ mode, env, home, now })) return { ran: false, why: 'checked recently' }
  try {
    writeUserConfig({ lastUpdateCheck: new Date(now).toISOString() }, env, home)
  } catch {
    return { ran: false, why: 'could not save the check time' }
  }
  onCheck()
  let found
  try {
    found = checkForUpdate({ repoDir, exec })
  } finally {
    onDone()
  }
  if (!found.ok) return { ran: true, found }
  try {
    writeUpdateCache(found.version, now, env, home, found.behind)
  } catch {
    /* not being able to remember the answer changes nothing */
  }
  if (!found.behind) return { ran: true, found }
  if (mode === 'notify') {
    print(`Meerkat has ${found.behind} new change${found.behind === 1 ? '' : 's'}${found.version ? ` (version ${found.version})` : ''}. Run: meerkat update`)
    return { ran: true, found, notified: true }
  }
  const applied = applyUpdate({ repoDir, exec })
  if (applied.ok) {
    try {
      clearUpdateCache(env, home)
    } catch {
      /* see above */
    }
    print(`Meerkat updated${applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''}: ${found.commits[0] ?? 'new changes'}${found.behind > 1 ? ` and ${found.behind - 1} more` : ''}.`)
  }
  return { ran: true, found, applied }
}

export const MODE_MEANING = {
  off: 'Meerkat does not look up new versions on its own. You can still run: meerkat update --check',
  notify: 'Meerkat looks up the latest version once a day (turn off with: meerkat update off) and shows a yellow bar when there is a newer one. It never installs without you.',
  auto: 'Once a day Meerkat looks up the latest version and installs a newer one by itself when that is safe.',
}

export function setMode(mode, env = process.env, home) {
  writeUserConfig({ updates: mode }, env, home)
  return MODE_MEANING[mode]
}

export function statusText(env = process.env, home) {
  const mode = updateMode(env, home)
  const last = readUserConfig(env, home).lastUpdateCheck
  const cache = readUpdateCache(env, home)
  const known = cache ? `${cache.latest} (checked ${new Date(cache.checkedAt).toISOString()})` : 'none yet (run: meerkat update --check)'
  return `Update mode: ${mode}\n${MODE_MEANING[mode]}\nLast check: ${last ?? 'never'}\nLatest version known: ${known}`
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
    writeUpdateCache(found.version, Date.now(), env, home, found.behind) // so the menu can show its bar afterwards
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
  try {
    clearUpdateCache(env, home)
  } catch {
    /* see above */
  }
  say(`Updated${applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''}.`)
  return 0
}
