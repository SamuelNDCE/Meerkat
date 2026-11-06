// `meerkat gate` and `meerkat smoke`: a recent-change gate and a self-check of the tool.
//
//   gate   runs only the checks whose paths match the files changed since a base ref. For a pre-commit hook (--staged) or a pull
//          request (--base <ref>). Exit 0 pass, 1 fail (a check failed, or a check's tool crashed), 75 not run (no base found, no checks
//          loaded, or every selected check could not run), 2 usage error.
//   smoke  runs each selected check on the changed files with a tiny time limit and fails when the TOOL misbehaves: a check crashes,
//          hangs past the limit, or no check is selected for a non-empty change. A check that finds problems in the project is fine
//          here: smoke tests Meerkat, not the project.
//
// Both reuse selectChecks (lib/runner.mjs) to choose and runAll / runOne to run; nothing of the runner is copied. The pure core is
// runGate / runSmoke (checks and files are passed in); gateMain loads the project's checks the way run.mjs does and prints.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyConfig, findConfig, readConfig } from './config.mjs'
import { sweepSpawned } from './exec.mjs'
import { detect } from './init.mjs'
import { appDirOf, repoRootOf } from './paths.mjs'
import { defaultParallel } from './priority.mjs'
import { createControl, runAll, runOne, selectChecks } from './runner.mjs'
import { readUserConfig } from './userconfig.mjs'

export const EXIT = { pass: 0, fail: 1, usage: 2, notRun: 75 }
export const SMOKE_TIMEOUT_SECONDS = 5

// ---------- which files changed ----------

function git(repoRoot, args) {
  const r = spawnSync('git', ['-C', repoRoot, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : null
}
const norm = (list) => [...new Set(list.map((f) => f.replace(/\\/g, '/')))]
const verify = (repoRoot, ref) => git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null

// The files changed, repo-relative with forward slashes. Returns { files, desc } or { error }.
//   staged:  the index only (what a commit would contain)
//   against: the working tree compared directly with <ref> (no merge-base), plus new untracked files
//   base:    the merge-base of <ref> and HEAD to the working tree (what a pull request shows), plus new untracked files
//   neither: base is the merge-base with main (or master, origin/main, origin/master, the first that exists)
// Deleted files are left out: no check can read them.
export function gateFiles(repoRoot, { staged = false, base = null, against = null } = {}) {
  if (git(repoRoot, ['rev-parse', '--is-inside-work-tree']) === null) return { error: `${repoRoot} is not inside a git work tree, so there is no change to look at` }
  if (staged) {
    const files = git(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    return files === null ? { error: 'git could not list the staged files' } : { files: norm(files), desc: 'staged files' }
  }
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard']) ?? []
  if (against) {
    if (!verify(repoRoot, against)) return { error: `--against ${against}: git does not know that ref` }
    const files = git(repoRoot, ['diff', '--name-only', '--diff-filter=ACMR', against])
    return files === null ? { error: `git could not compare with ${against}` } : { files: norm([...files, ...untracked]), desc: `changes against ${against}` }
  }
  const ref = base ?? ['main', 'master', 'origin/main', 'origin/master'].find((r) => verify(repoRoot, r))
  if (!ref) return { error: 'no base to compare with: there is no main or master branch (pass --base <ref>)' }
  if (!verify(repoRoot, ref)) return { error: `--base ${ref}: git does not know that ref` }
  const mb = git(repoRoot, ['merge-base', ref, 'HEAD'])?.[0]
  if (!mb) return { error: `${ref} and HEAD share no history, so there is no merge-base` }
  const files = git(repoRoot, ['diff', '--name-only', '--diff-filter=ACMR', mb])
  return files === null ? { error: `git could not compare with ${ref}` } : { files: norm([...files, ...untracked]), desc: `changes since the merge-base with ${ref}` }
}

// ---------- classifying a result ----------

// What a tool prints when it dies instead of reporting: a stack trace, a panic, a Python traceback, a segfault.
const CRASH_TEXT = /^\s+at .+[(:]\d+:\d+\)?\s*$|Traceback \(most recent call last\)|panicked at|thread '.+' panicked|Segmentation fault|SIGSEGV|Unhandled(Promise)?Rejection|FATAL ERROR:|core dumped/m
const HANG_TEXT = /^timed out after|^no output for/

// 'pass' | 'fail' | 'crash' | 'hang' | 'notrun'. A crash is the tool dying (Meerkat marked it broken, it never started, it exited with a code other
// than 0 or 1, or it exited 1 printing a stack trace). A hang is a stop by the time limit or the idle limit. exit 1 with findings is a plain fail.
export function classify(result, output = '') {
  if (!result) return 'crash'
  if (result.status === 'PASS') return 'pass'
  if (result.status === 'NOT RUN') return HANG_TEXT.test(String(result.detail ?? '')) ? 'hang' : 'notrun'
  if (result.broken) return 'crash'
  if (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0 && result.exitCode !== 1) return 'crash'
  if (result.exitCode === null) return 'crash'
  if (CRASH_TEXT.test(String(output))) return 'crash'
  return 'fail'
}

const tempLogDir = () => mkdtempSync(join(tmpdir(), 'meerkat-gate-'))
const dropDir = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    /* a leftover temp folder never fails a run */
  }
}

function makeCtx({ repoRoot, appDir, env, files, logDir, tier, smokeSeconds }) {
  const ctx = { timeoutScale: 1, control: createControl(), noIdleKill: false, repoRoot, appDir, tier, env, platform: process.platform, exists: existsSync, changedFiles: files, scope: [], findingsSink: new Map(), logDir }
  // The tiny limit of smoke: every check gets the same few seconds (the budgets file would otherwise raise single checks).
  if (smokeSeconds) ctx.timeoutPolicy = { facts: {}, budgets: { timeouts: {}, idleKill: {}, timeoutScale: 1 }, scale: 1, load: 1 }
  return ctx
}

// ---------- the pure cores ----------

function select(checks, files, tier, env) {
  return selectChecks(checks, { tier, only: [], include: [], mode: 'changed', changedFiles: files, groups: [], suites: [], windows: env.MEERKAT_WINDOWS === '1', skipCompile: false })
}

// gate: { exitCode, files, ran, skipped, rows: [{id, kind, detail}], note }
export async function runGate({ checks, files, repoRoot, appDir = repoRoot, env = process.env, tier = 'fast', parallel = defaultParallel(cpus().length, env), log = () => {} }) {
  if (!checks.length) return { exitCode: EXIT.notRun, files, rows: [], ran: [], skipped: [], note: 'no checks are loaded for this project (meerkat init, or add a pack to meerkat.config.json), so nothing was checked' }
  if (!files.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: [], note: 'nothing changed, so no check has anything to read' }
  const sel = select(checks, files, tier, env)
  if (!sel.run.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: sel.skipped.map((c) => c.id), note: `${files.length} file(s) changed but no check covers their paths (${sel.skipped.length} check(s) skipped)` }
  const logDir = tempLogDir()
  try {
    const ctx = makeCtx({ repoRoot, appDir, env, files, logDir, tier })
    const budget = { cpu: Math.min(10, cpus().length), reserveGB: 3, maxParallel: 10, maxWindows: 3 }
    const results = await runAll(sel.run, ctx, { budget, keepGoing: true, parallel, log, deadlineMs: 0 })
    const rows = results.map((r) => ({ id: r.id, kind: classify(r, ctx.findingsSink.get(r.id)?.output), detail: r.detail ?? '' }))
    const bad = rows.some((r) => r.kind === 'fail' || r.kind === 'crash')
    const exitCode = bad ? EXIT.fail : rows.some((r) => r.kind === 'notrun' || r.kind === 'hang') ? EXIT.notRun : EXIT.pass
    return { exitCode, files, rows, ran: sel.run.map((c) => c.id), skipped: sel.skipped.map((c) => c.id), note: '' }
  } finally {
    dropDir(logDir)
  }
}

// smoke: each selected check runs alone and in turn on the changed files, with `seconds` as its whole limit. The verdict is about the tool:
// pass and fail (findings) are both fine; crash, hang and an empty selection are failures. Not-run (a missing tool) is reported, not failed.
export async function runSmoke({ checks, files, repoRoot, appDir = repoRoot, env = process.env, tier = 'fast', seconds = SMOKE_TIMEOUT_SECONDS }) {
  if (!checks.length) return { exitCode: EXIT.notRun, files, rows: [], ran: [], skipped: [], note: 'no checks are loaded for this project, so there is nothing to smoke-test' }
  if (!files.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: [], note: 'nothing changed, so no check was selected and none needed' }
  const sel = select(checks, files, tier, env)
  if (!sel.run.length) return { exitCode: EXIT.fail, files, rows: [], ran: [], skipped: sel.skipped.map((c) => c.id), note: `${files.length} file(s) changed but zero checks were selected: Meerkat would check nothing here. A selection that is empty for a real change is a bug in the selection, the packs or the paths` }
  const logDir = tempLogDir()
  try {
    const ctx = makeCtx({ repoRoot, appDir, env, files, logDir, tier, smokeSeconds: seconds })
    ctx.timeoutPolicy.budgets.timeouts = Object.fromEntries(sel.run.map((c) => [c.id, Math.max(1, Math.round(seconds))]))
    const rows = []
    for (const c of sel.run) {
      let result
      try {
        result = await runOne(c, ctx)
      } catch (e) {
        result = { status: 'FAIL', broken: true, detail: `threw inside Meerkat: ${String(e?.message ?? e)}` }
      }
      rows.push({ id: c.id, kind: classify(result, ctx.findingsSink.get(c.id)?.output), detail: result.detail ?? '' })
    }
    const toolBad = rows.some((r) => r.kind === 'crash' || r.kind === 'hang')
    const exitCode = toolBad ? EXIT.fail : rows.every((r) => r.kind === 'notrun') ? EXIT.notRun : EXIT.pass
    return { exitCode, files, rows, ran: sel.run.map((c) => c.id), skipped: sel.skipped.map((c) => c.id), note: '' }
  } finally {
    dropDir(logDir)
  }
}

// ---------- the command ----------

const validOptions = (smoke) => `--staged, --base <ref>, --against <ref>, --app <folder>, --thorough, --json${smoke ? ', --timeout <seconds>' : ''} (or a folder: meerkat ${smoke ? 'smoke' : 'gate'} <folder>)`

export function parseGateArgs(argv, { smoke = false } = {}) {
  const o = { staged: false, base: null, against: null, app: null, json: false, thorough: false, seconds: SMOKE_TIMEOUT_SECONDS, errors: [] }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) o.errors.push(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--staged') o.staged = true
    else if (a === '--json') o.json = true
    else if (a === '--thorough') o.thorough = true
    else if (a === '--base') o.base = value(i++, a)
    else if (a === '--against') o.against = value(i++, a)
    else if (a === '--app') o.app = value(i++, a)
    else if (a === '--timeout' && smoke) {
      const n = Number(value(i++, a))
      if (Number.isFinite(n) && n >= 1) o.seconds = n
      else o.errors.push('--timeout needs a number of seconds, 1 or more')
    } else if (!a.startsWith('-')) {
      // a folder given the way `meerkat verify .` takes it
      if (o.app) o.errors.push(`only one folder can be given (got ${o.app} and ${a})`)
      else o.app = a
    } else o.errors.push(`unknown option ${a}. Valid options: ${validOptions(smoke)}`)
  }
  if (o.staged && (o.base || o.against)) o.errors.push('--staged cannot be used with --base or --against')
  if (o.base && o.against) o.errors.push('--base and --against cannot be used together')
  return o
}

// The checks of a project, the way run.mjs loads them: its config (or the packs that fit the folder), the person's pack folders and checks.
export async function loadProjectChecks(appDir, repoRoot, env = process.env) {
  const configFile = findConfig({ appDir, repoRoot })
  const read = configFile ? readConfig(configFile) : { config: { packs: detect(appDir).config.packs, extraChecks: [], disable: [], override: {}, budget: null, presets: {} }, notes: [] }
  const user = readUserConfig(env)
  const packDirs = Array.isArray(user.packDirs) ? user.packDirs.filter((d) => typeof d === 'string' && d.trim() !== '') : []
  const applied = await applyConfig([], read.config, { file: configFile, extraPackDirs: packDirs, personalChecks: user.customChecks, projectDir: appDir, noProjectCode: Boolean(env.MEERKAT_NO_PROJECT_CODE) })
  return { checks: applied.checks, notes: [...read.notes, ...applied.notes] }
}

const ICON = { pass: 'PASS   ', fail: 'FAIL   ', crash: 'TOOL   ', hang: 'HANG   ', notrun: 'NOT RUN' }

export function gateText(kind, out, desc) {
  const lines = [`MEERKAT ${kind}: ${desc}, ${out.files.length} file(s)`]
  for (const r of out.rows) lines.push(`${ICON[r.kind]}  ${r.id}${r.detail ? `  ${String(r.detail).split('\n')[0].slice(0, 200)}` : ''}`)
  if (out.skipped.length) lines.push(`skipped (no changed file in their paths): ${out.skipped.length}`)
  if (out.note) lines.push(out.note)
  const n = (k) => out.rows.filter((r) => r.kind === k).length
  const tool = n('crash') + n('hang')
  lines.push(`${kind}: ${n('pass')} passed, ${n('fail')} failed, ${tool} tool failure(s), ${n('notrun')} not run, exit ${out.exitCode}`)
  return lines.join('\n')
}

// gateMain(['--staged'], { smoke: false }) -> exit code. `log` and `err` are injectable for tests.
export async function gateMain(argv, { smoke = false, env = process.env, cwd = process.cwd(), log = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const kind = smoke ? 'smoke' : 'gate'
  const o = parseGateArgs(argv, { smoke })
  if (o.errors.length) {
    err(`meerkat ${kind}: ${o.errors.join('; ')}\nusage: meerkat ${kind} [folder] [--staged | --base <ref> | --against <ref>] [--app <folder>] [--thorough] [--json]${smoke ? ' [--timeout <seconds>]' : ''}`)
    return EXIT.usage
  }
  const appDir = o.app ? resolve(cwd, o.app) : resolve(appDirOf(env, cwd))
  const repoRoot = repoRootOf(appDir)
  const changed = gateFiles(repoRoot, o)
  if (changed.error) {
    err(`meerkat ${kind}: ${changed.error}`)
    return EXIT.notRun
  }
  let loaded
  try {
    loaded = await loadProjectChecks(appDir, repoRoot, env)
  } catch (e) {
    err(`meerkat ${kind}: the checks could not be loaded: ${String(e?.message ?? e)}`)
    return EXIT.notRun
  }
  const base = { checks: loaded.checks, files: changed.files, repoRoot, appDir, env, tier: o.thorough ? 'thorough' : 'fast' }
  try {
    const out = smoke ? await runSmoke({ ...base, seconds: o.seconds }) : await runGate({ ...base })
    log(o.json ? JSON.stringify({ kind, desc: changed.desc, ...out }, null, 2) : gateText(kind, out, changed.desc))
    if (o.staged && !o.json && !smoke) log('note: checks read the working tree, so a file staged in part is checked as saved, not as staged')
    return out.exitCode
  } finally {
    sweepSpawned()
  }
}

// Directly: node lib/gate.mjs gate --staged   |   node lib/gate.mjs smoke --base origin/main
import { fileURLToPath } from 'node:url'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [word, ...rest] = process.argv.slice(2)
  if (word !== 'gate' && word !== 'smoke') {
    process.stderr.write('usage: node lib/gate.mjs gate|smoke [--staged | --base <ref> | --against <ref>]\n')
    process.exit(EXIT.usage)
  }
  gateMain(rest, { smoke: word === 'smoke' }).then((c) => process.exit(c), (e) => (console.error(e), process.exit(2)))
}
