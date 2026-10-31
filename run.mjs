// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Meerkat, the validation tool (issue #3114). Contract: docs/testing/validation-tool.md.
//   npm --prefix apps/desktop-electron run verify            (fast tier)
//   npm --prefix apps/desktop-electron run verify -- --thorough
import { existsSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedFiles as gitChangedFiles } from './lib/changed.mjs'
import { appDirOf, appProblem, repoRootOf } from './lib/paths.mjs'
import { applyProfile } from './lib/profiles.mjs'
import { createProgress } from './lib/progress.mjs'
import { loadChecks } from './lib/load-checks.mjs'
import { createStatus, fanOut, statusPath } from './lib/status.mjs'
import { applyLearned, loadTimings, recordRun, saveTimings, timingsPath } from './lib/timings.mjs'
import { finalReport } from './lib/report.mjs'
import { runAll, selectChecks, summarise, table } from './lib/runner.mjs'
import { appendRun, historyPath, loadHistory, runEntry } from './lib/tui/history.mjs'
import { canUseUi, createTui } from './lib/tui/index.mjs'
import { createSplash } from './lib/tui/splash.mjs'
import { loadTheme } from './lib/tui/theme.mjs'

export function parseArgs(argv) {
  const o = { progress: null, profile: null, thorough: false, changed: false, all: false, only: [], include: [], list: false, selfTest: false, json: null, keepGoing: false, ui: false, theme: null, app: null, errors: [] }
  const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--thorough') o.thorough = true
    else if (a === '--changed') o.changed = true
    else if (a === '--all') o.all = true
    else if (a === '--list') o.list = true
    else if (a === '--self-test') o.selfTest = true
    else if (a === '--keep-going') o.keepGoing = true
    else if (a === '--only') o.only.push(...list(next()))
    else if (a === '--include') o.include.push(...list(next()))
    else if (a === '--json') o.json = next()
    else if (a === '--profile') o.profile = next()
    else if (a === '--progress') o.progress = true
    else if (a === '--no-progress') o.progress = false
    else if (a === '--ui') o.ui = true
    else if (a === '--app') o.app = next()
    else o.errors.push(`unknown argument: ${a}`)
  }
  if (o.changed && o.all) o.errors.push('--changed and --all cannot be used together')
  return o
}

export async function main(argv = process.argv.slice(2), { log: givenLog, env = process.env, interactive } = {}) {
  const log = givenLog ?? ((l) => console.log(l))
  const opts = parseArgs(argv)
  // The live bar is for a person at a terminal: drawn only on a real TTY with the default output (a test or a
  // pipe passes its own log, CI sets CI), or when asked for with --progress. --no-progress or NV_VERIFY_PLAIN=1 turns it off.
  const liveBar = opts.progress ?? (interactive ?? (givenLog === undefined && Boolean(process.stdout.isTTY) && !env.CI && env.NV_VERIFY_PLAIN !== '1'))
  if (opts.errors.length) {
    log(opts.errors.join('\n'))
    return 2
  }
  try {
    const set = applyProfile(opts.profile ?? env.NV_VERIFY_PROFILE, env)
    if (set.length) log(`profile ${opts.profile ?? env.NV_VERIFY_PROFILE}: ${set.join(' ')}`)
  } catch (e) {
    log(String(e.message))
    return 2
  }
  const here = dirname(fileURLToPath(import.meta.url))
  // The app being checked (NeuralVault: apps/desktop-electron). Child scripts read it from NV_APP_DIR.
  const appDir = resolve(opts.app || appDirOf(env))
  const repoRoot = repoRootOf(appDir)
  process.env.NV_APP_DIR = appDir
  env.NV_APP_DIR = appDir
  const tier = opts.thorough ? 'thorough' : 'fast'
  // The board's look (theme.mjs): one look, tuned in ~/.nv-verify-theme.json. A loading screen shows what is happening
  // while the run is prepared, then disappears; real terminal only.
  const theme = loadTheme({ env })
  const uiOk = opts.ui && canUseUi({ isTTY: givenLog === undefined && Boolean(process.stdout.isTTY), env })
  const splash = createSplash({ theme, env, enabled: uiOk && !opts.list && !opts.selfTest, title: `MEERKAT ${opts.thorough ? 'thorough' : 'fast'}` })
  splash.step('Loading the checks')
  const checks = await loadChecks(join(here, 'checks'))
  splash.step('Reading the times measured on this PC')
  // Use the times measured on this machine for the order, the bar and the time left; keep the written ones for any check not yet measured.
  const timingsFile = timingsPath(env)
  const timings = loadTimings(timingsFile)
  applyLearned(checks, timings, tier)

  if (opts.list) {
    for (const c of checks) {
      log(`${c.id.padEnd(24)} ${c.group.padEnd(13)} ${c.tier.padEnd(9)} ${c.lane.padEnd(9)} ~${String(c.estSeconds ?? '?').padStart(4)}s${c.optIn ? `  opt-in:${c.optIn}` : ''}  ${c.title}`)
    }
    return 0
  }

  const ctx = { repoRoot, appDir, tier, env, platform: process.platform, exists: existsSync, changedFiles: null }
  let mode = opts.all || (opts.thorough && !opts.changed) ? 'all' : 'changed'
  if (mode === 'changed') splash.step('Finding what changed against origin/dev')
  if (mode === 'changed') ctx.changedFiles = gitChangedFiles(repoRoot)
  if (mode === 'changed' && ctx.changedFiles === null) log('note: git could not list changed files (no origin/dev?), running every check')
  // Nothing differs from origin/dev on a promotion branch (test, beta, stable sit behind dev) or a clean dev
  // checkout. "Nothing changed" must never mean "nothing to check", so every check of the tier runs.
  if (mode === 'changed' && Array.isArray(ctx.changedFiles) && ctx.changedFiles.length === 0) {
    log('note: nothing differs from origin/dev (a promotion branch or a clean checkout), running every check of the tier')
    mode = 'all'
  }

  const started = Date.now()
  let results
  let skippedCount = 0
  let status = null
  if (!opts.list) {
    const problem = appProblem(appDir)
    if (problem) {
      log(problem)
      return 2
    }
  }
  if (opts.selfTest) {
    const withTest = checks.filter((c) => (opts.only.length ? opts.only.includes(c.id) : !c.optIn || opts.include.includes(c.optIn)))
    log(`self-test: ${withTest.length} checks`)
    const bar = createProgress({ title: `MEERKAT ${tier} self-test`, checks: withTest, enabled: liveBar })
    status = createStatus({ title: `MEERKAT ${tier} self-test`, tier, checks: withTest, file: statusPath(env), say: liveBar ? null : log })
    results = await runAll(withTest, ctx, { selfTest: true, parallel: Math.max(1, cpus().length - 1), log: liveBar ? () => {} : log, hooks: fanOut(liveBar ? bar : null, status) })
    bar.stop()
    status.stop()
  } else {
    splash.step('Choosing the checks to run')
    const sel = selectChecks(checks, { tier, only: opts.only, include: opts.include, mode, changedFiles: ctx.changedFiles })
    splash.finish()
    skippedCount = sel.skipped.length
    for (const s of sel.superseded ?? []) log(`[COVERED ] ${s.id}: not run on its own, ${s.supersededBy} covers it`)
    for (const s of sel.skipped) log(`[SKIPPED] ${s.id}: no files changed in its paths`)
    for (const id of opts.only) if (!checks.some((c) => c.id === id)) log(`warning: --only ${id} matches no check`)
    // --ui: the richer terminal view (lib/tui). Real terminal only; anywhere else the plain lines stay, and say so.
    const useUi = uiOk
    if (opts.ui && !useUi) log('note: --ui needs an interactive terminal (not a pipe, CI or NV_VERIFY_PLAIN=1); using the plain lines')
    const bar = useUi
      ? createTui({ theme, title: `MEERKAT ${tier}`, checks: sel.run, timings, tier, history: loadHistory(historyPath(env)), meta: `${cpus().length} threads`, profile: opts.profile ?? env.NV_VERIFY_PROFILE ?? '' })
      : createProgress({ title: `MEERKAT ${tier}`, checks: sel.run, enabled: liveBar })
    const quiet = liveBar || useUi
    status = createStatus({ title: `MEERKAT ${tier}`, tier, checks: sel.run, file: statusPath(env), say: quiet ? null : log })
    log(`live status: ${statusPath(env)} (rewritten every few seconds while this runs)`)
    results = await runAll(sel.run, ctx, { keepGoing: opts.keepGoing, parallel: Math.max(1, cpus().length - 1), log: quiet ? () => {} : log, hooks: fanOut(quiet ? bar : null, status) })
    bar.stop()
    status.stop()
    // Keep what this run measured, so the next run's order, bar and time left are closer to the truth.
    saveTimings(timingsFile, recordRun(timings, results, tier))
  }
  const { line, exitCode } = summarise(opts.selfTest ? `${tier} self-test` : tier, results, skippedCount, Date.now() - started)
  status?.stop(line)
  // A finished real run adds one entry to the run log the terminal UI's history view reads (home folder, never the repo).
  if (!opts.selfTest) appendRun(historyPath(env), runEntry({ tier, summary: line, exitCode, ms: Date.now() - started, results }))
  log('')
  log(table(results))
  // What needs a look, repeated in full (failed output, reasons); a passing check shows nothing beyond its row above.
  if (!opts.selfTest) for (const l of finalReport({ results, tier, timings, totalMs: Date.now() - started })) log(l)
  log(line)
  if (opts.json) writeFileSync(opts.json, JSON.stringify({ tier, summary: line, exitCode, results }, null, 2))
  return exitCode
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e)
      process.exit(2)
    },
  )
}
