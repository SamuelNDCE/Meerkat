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
import { applyConfig, findConfig, readConfig } from './lib/config.mjs'
import { estimateRemaining } from './lib/eta.mjs'
import { initConfig } from './lib/init.mjs'
import { finalReport } from './lib/report.mjs'
import { createModel } from './lib/tui/model.mjs'
import { runAll, selectChecks, summarise, table } from './lib/runner.mjs'
import { appendRun, historyPath, loadHistory, runEntry } from './lib/tui/history.mjs'
import { canUseUi, createTui } from './lib/tui/index.mjs'
import { parseGroups, PRESETS, resolvePreset } from './lib/presets.mjs'
import { createSplash } from './lib/tui/splash.mjs'
import { loadTheme } from './lib/tui/theme.mjs'

export function parseArgs(argv) {
  const o = { progress: null, profile: null, thorough: false, changed: false, all: false, only: [], include: [], list: false, selfTest: false, json: null, keepGoing: false, ui: false, theme: null, app: null, config: null, noConfig: false, preset: null, groups: [], estimate: false, init: false, errors: [] }
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
    else if (a === '--config') o.config = next()
    else if (a === '--preset') o.preset = next()
    else if (a === '--group') o.groups.push(...parseGroups(next()))
    else if (a === '--estimate') o.estimate = true
    else if (a === '--init') o.init = true
    else if (a === '--no-config') o.noConfig = true
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
  if (opts.init) {
    const made = initConfig(appDir)
    log(made.message)
    return 0
  }
  let tier = opts.thorough ? 'thorough' : 'fast'
  let groups = [...opts.groups]
  // The board's look (theme.mjs): one look, tuned in ~/.nv-verify-theme.json. A loading screen shows what is happening
  // while the run is prepared, then disappears; real terminal only.
  const theme = loadTheme({ env })
  const uiOk = opts.ui && canUseUi({ isTTY: givenLog === undefined && Boolean(process.stdout.isTTY), env })
  const splash = createSplash({ theme, env, enabled: uiOk && !opts.list && !opts.selfTest, title: `MEERKAT ${opts.thorough ? 'thorough' : 'fast'}` })
  splash.step('Loading the checks')
  const builtInChecks = await loadChecks(join(here, 'checks'))
  // The project's own settings (meerkat.config.json, lib/config.mjs): checks turned off or swapped, tools changed, the budget. Every
  // note and every turned-off check is printed, so nothing is changed silently.
  const configFile = opts.noConfig ? null : findConfig({ explicit: opts.config, appDir, repoRoot })
  const read = configFile ? readConfig(configFile) : { config: { builtin: true, extraChecks: [], disable: [], override: {}, budget: null }, notes: [] }
  const applied = await applyConfig(builtInChecks, read.config, { file: configFile })
  const checks = applied.checks
  // --preset (security, ui-fast, app, ...) picks the tier and the kinds of check; --group adds to it.
  const chosen = resolvePreset(opts.preset, read.config.presets ?? {})
  if (chosen.error) {
    log(chosen.error)
    return 2
  }
  if (chosen.preset) {
    tier = chosen.preset.tier
    groups = [...chosen.preset.groups, ...groups]
    if (!opts.list) log(`preset ${chosen.preset.name}: ${chosen.preset.about}`)
  }
  if (!opts.list) {
    if (configFile) log(`config: ${configFile}`)
    for (const note of [...read.notes, ...applied.notes]) log(`config: ${note}`)
    for (const d of applied.disabled) log(`[DISABLED] ${d.id}: turned off in ${configFile}`)
  }
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
  let mode = opts.all || (tier === 'thorough' && !opts.changed) ? 'all' : 'changed'
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
    // The built-in checks drive an Electron app; a project that turned them off (a Rust app, say) needs no such folder.
    const problem = read.config.builtin === false ? null : appProblem(appDir)
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
    const sel = selectChecks(checks, { tier, only: opts.only, include: opts.include, mode, changedFiles: ctx.changedFiles, groups })
    splash.finish()
    if (opts.estimate) {
      // How long this run should take on this PC: the learned times, run through the same scheduling rules (lib/eta.mjs).
      const rows = createModel({ checks: sel.run, timings, tier }).snapshot(0)
      const slots = Math.max(1, cpus().length - 1)
      const ms = estimateRemaining(rows, 0, { freeSlots: slots })
      const measured = sel.run.filter((c) => c.writtenEstSeconds !== undefined).length
      const mins = (n) => (n >= 90_000 ? `${Math.round(n / 6000) / 10} minutes` : `${Math.round(n / 1000)} seconds`)
      log(`ESTIMATE ${opts.preset ?? tier}: about ${mins(ms)} for ${sel.run.length} checks (${measured} with times measured on this PC, ${sel.run.length - measured} using the written guess)`)
      const lane = (l) => sel.run.filter((c) => c.lane === l).reduce((n, c) => n + (c.estSeconds ?? 0), 0)
      log(`  work by lane: cargo ${lane('cargo')} s (one at a time), windows ${lane('electron')} s (one at a time), everything else ${lane('free')} s (side by side)`)
      return 0
    }
    skippedCount = sel.skipped.length + applied.disabled.length
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
    // How much a run may use at once: every thread by default, and 3 GB of memory left free; the config can change both.
    const budget = { cpu: read.config.budget?.cpu ?? cpus().length, reserveGB: read.config.budget?.reserveGB ?? 3, maxParallel: read.config.budget?.maxParallel ?? 5 }
    results = await runAll(sel.run, ctx, { budget, keepGoing: opts.keepGoing, parallel: Math.max(1, cpus().length - 1), log: quiet ? () => {} : log, hooks: fanOut(quiet ? bar : null, status) })
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
