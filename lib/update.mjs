// Keeping Meerkat up to date.
//
// This is the ONLY code in Meerkat that talks to the network by itself (one `git fetch` of Meerkat's own clone).
// It does that only when the person turned it on (`meerkat update notify` or `auto`) or asked (`meerkat update`).
// In the default mode, notify, Meerkat looks up the latest version at most once a day (read-only, 3 second limit) and never installs;
// `meerkat update off` stops the lookup. Only mode auto installs by itself. Nothing is sent about you or your project.
//
// Every function takes an `exec(cmd, args, { cwd })` that returns the output text or throws, so tests use a fake one.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { readUserConfig, updateMode, writeUserConfig } from './userconfig.mjs'
import { isNewer, isVersion, VERSION } from './version.mjs'

export const DAY_MS = 24 * 60 * 60 * 1000
const MAX_COMMITS = 15

export const defaultExec = (cmd, args, { cwd } = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })

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

// Tracked files with uncommitted changes, as paths (untracked files are not touched by an update, so they are not listed).
export function dirtyFiles(exec, repoDir) {
  const out = String(exec('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repoDir }))
  const unquote = (p) => p.replace(/^"(.*)"$/, '$1')
  return out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).flatMap((l) => l.slice(3).split(' -> ').map(unquote))
}

// The files that differ between two refs (what an update to that ref would change).
const changedBetween = (exec, repoDir, a, b) => git(exec, repoDir, 'diff', '--name-only', a, b).split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean)

const MAX_LISTED = 10
// Plain wording for the refusal: only the files the update would overwrite, and two safe ways out. Nothing here throws changes away.
export function blockedText(files, repoDir) {
  const shown = files.slice(0, MAX_LISTED).map((f) => `  ${f}`)
  if (files.length > MAX_LISTED) shown.push(`  ...and ${files.length - MAX_LISTED} more`)
  const g = `git -C "${repoDir}"`
  return [
    'you have changes to files this update also changes, so it was not updated:',
    ...shown,
    `See what you changed: ${g} diff`,
    `Commit them (${g} commit -am "my changes") or move them aside (${g} stash), then run the update again.`,
  ].join('\n')
}

const NOT_A_CLONE = { ok: false, reason: 'not a git clone, this copy was installed from a package: update it with npm install -g @samuelndce/meerkat@latest' }

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
  if (!found.ok) {
    retrySoon(now, env, home)
    return { ran: true, found }
  }
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
  const applied = applyUpdate({ repoDir, exec: applyExec, verify: smartVerify(applyExec) })
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

// A look-up that failed (offline, a slow fetch) must not use up the day: back-date the stamp so it is tried again in about an hour.
function retrySoon(now, env, home) {
  try {
    writeUserConfig({ lastUpdateCheck: new Date(now - DAY_MS + 60 * 60 * 1000).toISOString() }, env, home)
  } catch {
    /* see above */
  }
}

// ---- smart update: try the new version in a throwaway copy first ----
// The log folder is where Meerkat keeps what it writes about itself (the same rule as lib/runlog.mjs: MEERKAT_LOG_DIR, else ~/.meerkat/logs).
export const updateLogRoot = (env = process.env) => resolve(env.MEERKAT_LOG_DIR || join(homedir(), '.meerkat', 'logs'))

// The checks the copy must pass before the real folder is touched: the self-test and a plain --help.
export const VERIFY_STEPS = [
  { name: 'self-test', args: ['bin/meerkat.mjs', 'self-test'], timeoutMs: 300000 },
  { name: '--help', args: ['bin/meerkat.mjs', '--help'], timeoutMs: 60000 },
]

const runStep = (step, cwd, env) => {
  try {
    execFileSync(process.execPath, step.args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: step.timeoutMs, maxBuffer: 64 * 1024 * 1024, env })
    return null
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}` || String(e.message ?? e)
    return text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).slice(-5).join('\n')
  }
}

function cleanCopy(dir) {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* a leftover temporary folder changes nothing */
  }
}

// Builds a copy of this folder in the log folder (never inside the user's folder): their commit, their uncommitted changes (the saved patch), then the
// new version on top, the same way the real update will do it. Runs the checks there. { ok: true } or { ok: false, reason }. The copy is always removed.
export function verifyInCopy({ repoDir, exec = defaultExec, ref, patchFile, logDir = updateLogRoot(), steps = VERIFY_STEPS }) {
  const base = join(logDir, 'update-verify')
  let copy = null
  try {
    mkdirSync(base, { recursive: true })
    copy = mkdtempSync(join(base, 'copy-'))
    const headSha = git(exec, repoDir, 'rev-parse', 'HEAD')
    const targetSha = git(exec, repoDir, 'rev-parse', ref)
    git(exec, copy, 'clone', '--quiet', '--no-checkout', '--local', repoDir, copy)
    for (const key of ['core.autocrlf', 'core.eol', 'core.filemode']) {
      try {
        git(exec, copy, 'config', key, git(exec, repoDir, 'config', '--get', key))
      } catch {
        /* not set in the user's folder: the same default applies in the copy */
      }
    }
    git(exec, copy, 'checkout', '--quiet', '--detach', headSha)
    if (patchFile) git(exec, copy, 'apply', '--whitespace=nowarn', patchFile)
    git(exec, copy, 'checkout', '--quiet', '--detach', targetSha)
  } catch (e) {
    cleanCopy(copy)
    return { ok: false, reason: `could not build a temporary copy to try the update in, so your folder was not changed: ${String(e.message ?? e).split('\n')[0]}` }
  }
  try {
    const env = { ...process.env, MEERKAT_LOG_DIR: join(copy, '.verify-logs') }
    for (const step of steps) {
      const failure = runStep(step, copy, env)
      if (failure !== null) return { ok: false, reason: `the new version did not pass its own ${step.name} in a temporary copy that has your changes, so your folder was not changed:\n${failure}` }
    }
    return { ok: true }
  } finally {
    cleanCopy(copy)
  }
}

// What the callers use unless they pass their own: the real copy check, but only with the real git (a fake exec in a test has no folder to copy).
export const smartVerify = (exec) => (exec === defaultExec ? verifyInCopy : null)

// The uncommitted changes to tracked files, saved as a patch before anything else happens. Returns the file path, or null when git shows no diff.
function savePatch(exec, repoDir, logDir, to, now) {
  const text = String(exec('git', ['diff', '--binary', 'HEAD'], { cwd: repoDir }))
  if (!text) return null
  const dir = join(logDir, 'update-patches')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  const file = join(dir, `${stamp}-to-${String(to ?? 'new').replace(/[^0-9A-Za-z.+-]/g, '_')}.patch`)
  writeFileSync(file, text)
  return file
}

const isAncestor = (exec, repoDir, a, b) => {
  try {
    git(exec, repoDir, 'merge-base', '--is-ancestor', a, b)
    return true
  } catch {
    return false
  }
}

// Installs the newest version, the careful way:
//   1. A file you changed that the update also changes: refused, named, nothing touched (your edit is never overwritten).
//   2. Your uncommitted changes are saved as a patch file in the log folder first.
//   3. `verify` (the real update passes verifyInCopy) tries the new version in a temporary copy that carries your changes; if its self-test or
//      --help fails, nothing in your folder is changed.
//   4. Only then the folder moves, and your changes stay as they are. Two cases:
//      - on the default branch (or an older copy of it): fast-forward;
//      - on another branch with commits GitHub does not have: those commits are NOT touched. The folder moves onto the default branch and the
//        branch keeps its commits, so nothing is lost; `switchedFrom` names that branch.
//   A detached HEAD with commits of its own is refused, because moving off it would leave those commits unreferenced.
// The result has `kept` (how many files of yours were carried) and `patch` (where the saved patch is) when you had local changes.
export function applyUpdate({ repoDir, exec = defaultExec, verify = null, logDir = updateLogRoot(), now = Date.now() }) {
  if (!isOwnClone(exec, repoDir)) return NOT_A_CLONE
  let patch = null
  const withPatch = (r) => (patch ? { ...r, patch } : r)
  try {
    const ref = remoteRef(exec, repoDir)
    const dirty = dirtyFiles(exec, repoDir)
    if (dirty.length) {
      const incoming = new Set(changedBetween(exec, repoDir, 'HEAD', ref))
      const overlap = dirty.filter((f) => incoming.has(f))
      if (overlap.length) return { ok: false, reason: blockedText(overlap, repoDir), files: overlap }
      try {
        patch = savePatch(exec, repoDir, logDir, versionAt(exec, repoDir, ref), now)
      } catch (e) {
        return { ok: false, reason: `could not save a copy of your changes first, so nothing was changed: ${String(e.message ?? e).split('\n')[0]}` }
      }
    }
    const from = versionAt(exec, repoDir, 'HEAD')
    const defaultBranch = ref.replace(/^origin\//, '')
    const fastForward = isAncestor(exec, repoDir, 'HEAD', ref)
    let branch = null
    if (!fastForward) {
      branch = git(exec, repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')
      if (branch === 'HEAD') return withPatch({ ok: false, reason: 'this folder has commits GitHub does not have and is on no branch, so it was not updated. Put those commits on a branch first' })
      let localDefault = null
      try {
        localDefault = git(exec, repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${defaultBranch}`)
      } catch {
        /* no local copy of the default branch yet */
      }
      if (localDefault && !isAncestor(exec, repoDir, localDefault, ref)) return withPatch({ ok: false, reason: `the local ${defaultBranch} branch has commits of its own, so it was not updated. Check it with git log ${ref}..${defaultBranch}` })
    }
    if (verify) {
      const v = verify({ repoDir, exec, ref, patchFile: patch, logDir })
      if (!v.ok) return withPatch({ ok: false, reason: v.reason })
    }
    const kept = dirty.length ? { kept: dirty.length } : {}
    if (fastForward) {
      git(exec, repoDir, 'merge', '--ff-only', ref)
      return withPatch({ ok: true, from, to: versionAt(exec, repoDir, 'HEAD'), ...kept })
    }
    git(exec, repoDir, 'checkout', '--quiet', '-B', defaultBranch, ref)
    return withPatch({ ok: true, from, to: versionAt(exec, repoDir, 'HEAD'), switchedFrom: branch, ...kept })
  } catch (e) {
    return withPatch({ ok: false, reason: `could not update: ${String(e.message ?? e).split('\n')[0]}` })
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
  if (!found.ok) {
    retrySoon(now, env, home)
    return { ran: true, found }
  }
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
  const applied = applyUpdate({ repoDir, exec, verify: smartVerify(exec) })
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
  say('Trying the new version in a temporary copy of your folder first...')
  const applied = applyUpdate({ repoDir, exec, verify: smartVerify(exec) })
  if (!applied.ok) {
    say(`Not updated: ${applied.reason}`)
    if (applied.patch) say(`Your changes are saved in: ${applied.patch}`)
    return 1
  }
  try {
    clearUpdateCache(env, home)
  } catch {
    /* see above */
  }
  say(updatedText(applied))
  return 0
}

// The sentence after a successful install. When the folder had moved off the default branch, it says where that work went.
export function updatedText(applied) {
  const version = applied.from && applied.to ? ` from ${applied.from} to ${applied.to}` : ''
  const moved = applied.switchedFrom ? ` This folder was on branch ${applied.switchedFrom}; that branch keeps its own commits, and the folder is now on the default branch. To keep those commits on GitHub, push that branch from this folder: git push -u origin ${applied.switchedFrom}` : ''
  const kept = applied.kept ? ` Your ${applied.kept} local change${applied.kept === 1 ? ' was' : 's were'} kept. A copy of them is saved in: ${applied.patch}` : ''
  return `Updated${version}.${kept}${moved}`
}
