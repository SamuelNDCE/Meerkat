// Meerkat, the validation tool (issue #3114). Contract: docs/testing/validation-tool.md.
//   npm --prefix apps/desktop-electron run verify            (fast tier)
//   npm --prefix apps/desktop-electron run verify -- --thorough
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, freemem } from 'node:os'
import { diffSnapshots, snapshotDigest, snapshotTree, violationText } from './lib/integrity.mjs'
import { cacheFile, cacheHit, cacheKey, readCache, saveCache, updatedCache } from './lib/resultcache.mjs'
import { markLegacyNoticed, migrationNote, unnoticedLegacy } from './lib/findingid.mjs'
import { acceptedSets, applyAccepted, passInlineIgnored } from './lib/accepted.mjs'
import { githubAnnotations } from './lib/ci-output.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedFiles as gitChangedFiles, inScopeFile, scopedFiles } from './lib/changed.mjs'
import { examplePacks } from './lib/example-packs.mjs'
import { appDirOf, appProblem, repoRootOf } from './lib/paths.mjs'
import { loadOrder } from './lib/testorder.mjs'
import { applyProfile } from './lib/profiles.mjs'
import { defaultParallel, lowerPriority, priorityProblem } from './lib/priority.mjs'
import { createProgress } from './lib/progress.mjs'
import { loadChecks } from './lib/load-checks.mjs'
import { createStatus, fanOut, statusPath } from './lib/status.mjs'
import { applyLearned, loadTimings, recordRun, saveTimings, timingsPath } from './lib/timings.mjs'
import { applyConfig, findConfig, readConfig } from './lib/config.mjs'
import { makeTrust } from './lib/trust.mjs'
import { discoverChecks } from './lib/discover.mjs'
import { estimateRemaining } from './lib/eta.mjs'
import { estimateRunMs, estimateRunMsWithCache, estimateVsActualText } from './lib/runestimate.mjs'
import { clampScale } from './lib/timeouts.mjs'
import { applicablePacks, detect, initConfig, presetPacks } from './lib/init.mjs'
import { finalReport } from './lib/report.mjs'
import { compactSummary } from './lib/tui/results.mjs'
import { buildFindings, saveFindings } from './lib/findingsdoc.mjs'
import { folderProblem } from './lib/folderguard.mjs'
import { createInterface } from 'node:readline/promises'
import { verifyRunDir } from './lib/aiverify.mjs'
import { failureLines, groupFailures, summaryLines } from './lib/failsummary.mjs'
import { appendRunLog, createRecorder, gitInfo, latestRunDir, latestRunDirForFolder, logRoot, makeRunDir, showLast, saveNotRunLogs, showWhy, writeRunReport } from './lib/runlog.mjs'
import { createModel } from './lib/tui/model.mjs'
import { spansFromRecorder } from './lib/tui/group.mjs'
import { selectForRun } from './lib/runselect.mjs'
import { ignoreLine, ignoreSources, ignoreSummary } from './lib/ignorepaths.mjs'
import { WINDOW_SKIP_REASON, createControl, runAll, selectChecks, stopOnSignals, summarise, table } from './lib/runner.mjs'
import { sweepSpawned } from './lib/exec.mjs'
import { DEFAULT_RUN_MINUTES, loadBudgets } from './lib/timeouts.mjs'
import { notProjectJson, notProjectMessage, projectCheck } from './lib/projectgate.mjs'
import { enrichResults, narrowSubs, rollup } from './lib/subchecks.mjs'
import { packOfCheck, resolveOnly, suiteIdOf, suiteInfo } from './lib/suites.mjs'
import { tipLine } from './lib/recommend.mjs'
import { firstRunNote } from './lib/firstrun.mjs'
import { runPathLines } from './lib/runpath.mjs'
import { appendRun, historyPath, loadHistory, runEntry } from './lib/tui/history.mjs'
import { canUseUi, createTui } from './lib/tui/index.mjs'
import { applyPresetExclusions, mergePresets, parseGroups, PRESETS, resolvePreset } from './lib/presets.mjs'
import { readUserConfig } from './lib/userconfig.mjs'
import { createSplash } from './lib/tui/splash.mjs'
import { loadTheme } from './lib/tui/theme.mjs'
import { VERSION } from './lib/version.mjs'

const meerkatVersion = () => VERSION // lib/version.mjs: package.json, read once

// The commit a project is on, or null (not a git repository, or git is missing). Part of the result-cache key.
function headOf(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

// The preset's one-line description for the header, without its written time claim ("5 to 10 minutes at most" was wrong for a 3 second run).
// When an earlier run of this preset in this folder exists, its measured time is added; with none, nothing is.
export function presetAboutLine(about, env, appDir, preset) {
  const text = String(about ?? '').replace(/,?\s*\d+\s*(?:to|-)\s*\d+\s*(?:minutes?|min|seconds?|s)\s*(?:at most)?/i, '')
  let prev = ''
  try {
    const dir = preset ? latestRunDirForFolder(env, appDir, { preset }) : null
    const ms = dir ? JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).ms : null
    if (Number.isFinite(ms) && ms >= 0) prev = ` (the last run of this preset here took ${ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`})`
  } catch {
    /* no earlier run: nothing is said */
  }
  return `${text}${prev}`
}

// How a time estimate reads: "about 1 second", "about 5 seconds", "about 2.5 minutes".
export function durationText(ms) {
  if (ms >= 90_000) return `${Math.round(ms / 6000) / 10} minutes`
  const s = Math.round(ms / 1000)
  return s === 1 ? '1 second' : `${s} seconds`
}

// One line per preset for --list-presets: name, where it comes from (project, personal or bundled; a project preset beats a personal one,
// which beats a bundled one of the same name), tier, kinds of check, and the about text.
export function presetLines(project = {}, personal = {}) {
  const merged = mergePresets(project, personal)
  const names = [...new Set([...Object.keys(PRESETS), ...Object.keys(personal), ...Object.keys(project)])]
  return names.map((name) => {
    const source = project[name] != null ? 'project' : personal[name] != null ? 'personal' : 'bundled'
    const { preset } = resolvePreset(name, merged)
    if (!preset) return `${name.padEnd(20)} ${source.padEnd(9)} (not usable: the preset is not an object)`
    const kinds = preset.groups.length ? preset.groups.join(', ') : 'all'
    return `${name.padEnd(20)} ${source.padEnd(9)} ${preset.tier.padEnd(9)} ${kinds.padEnd(30)} ${preset.about}`
  })
}

// A yes/no question at the terminal; false when nobody can answer (no terminal), so nothing is ever sent without a yes.
async function askYes(text) {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question('Send this to the model? [y/N] ')).trim())
  } finally {
    rl.close()
  }
}

// The findings of a run as findings.json will list them, or null when they cannot be built (accepting findings is then skipped, never fatal).
function safeBuild(args) {
  try {
    return buildFindings({ ...args, meta: { runId: 'accepted', version: '', dir: '', preset: null, tier: '', startedAt: '', endedAt: '', ms: 0 } })
  } catch {
    return null
  }
}

export function parseArgs(argv) {
  const o = { progress: null, profile: null, thorough: false, changed: false, scope: [], all: false, only: [], suites: [], include: [], list: false, selfTest: false, json: null, keepGoing: false, ui: false, theme: null, app: null, config: null, noConfig: false, preset: null, groups: [], estimate: false, init: false, listPresets: false, errors: [] }
  const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--thorough') o.thorough = true
    else if (a === '--changed') o.changed = true
    else if (a === '--scope') {
      const v = next()
      if (v === undefined || v.startsWith('--')) o.errors.push('--scope needs a folder, for example --scope apps/web')
      else o.scope.push(...v.split(',').map((x) => x.trim()).filter(Boolean))
    }
    else if (a === '--all') o.all = true
    else if (a === '--ratchet') o.ratchet = true
    else if (a === '--no-cache') o.noCache = true
    else if (a === '--format') o.format = next()
    else if (a === '--list') o.list = true
    else if (a === '--self-test') o.selfTest = true
    else if (a === '--keep-going') o.keepGoing = true
    else if (a === '--fail-fast') o.failFast = true
    else if (a === '--only') o.only.push(...list(next()))
    else if (a === '--suite') o.suites.push(...list(next()))
    else if (a === '--list-json') o.listJson = true
    else if (a === '--include') o.include.push(...list(next()))
    else if (a === '--ai') o.include.push('ai')
    else if (a === '--ai-verify') o.aiVerify = true
    else if (a === '--ai-verify-max') o.aiVerifyMax = Math.max(1, Math.floor(Number(next())) || 25)
    else if (a === '--yes' || a === '-y') o.yes = true
    else if (a === '--json') o.json = next()
    else if (a === '--profile') o.profile = next()
    else if (a === '--priority') o.priority = next()
    else if (a === '--progress') o.progress = true
    else if (a === '--no-progress') o.progress = false
    else if (a === '--ui') o.ui = true
    else if (a === '--plain') o.plain = true
    else if (a === '--verbose') o.verbose = true
    else if (a === '--full') o.full = true
    else if (a === '--no-input') o.noInput = true // a global option (meerkat describe): run.mjs never asks anything, so it changes nothing here, but it must be accepted by init, list and self-test
    else if (a === '--flat') o.grouped = false
    else if (a === '--grouped') o.grouped = true
    else if (a === '--config') o.config = next()
    else if (a === '--preset') o.preset = next()
    else if (a === '--group') o.groups.push(...parseGroups(next()))
    else if (a === '--estimate') o.estimate = true
    else if (a === '--init') o.init = true
    else if (a === '--list-presets') o.listPresets = true
    else if (a === '--last') (o.last = true, argv[i + 1] && !argv[i + 1].startsWith('-') && (o.lastProject = argv[++i]))
    else if (a === '--logs') o.logs = true
    else if (a === '--why') o.why = next()
    else if (a === '--no-config') o.noConfig = true
    else if (a === '--json-stdout') o.jsonStdout = true
    else if (a === '--quiet' || a === '-q') o.quiet = true
    else if (a === '--no-color') o.noColor = true
    else if (a === '--app') o.app = next()
    else if (a === '--timeout-scale') o.timeoutScale = clampScale(next())
    else if (a === '--no-idle-kill') o.noIdleKill = true
    else if (a === '--force') o.force = true
    else if (a === '--max-run-minutes') o.maxRunMinutes = Number(next())
    else o.errors.push(`unknown argument: ${a}`)
  }
  if (o.changed && o.all) o.errors.push('--changed and --all cannot be used together')
  if (o.scope.length && o.all) o.errors.push('--scope and --all cannot be used together')
  if (o.scope.length && o.changed) o.errors.push("--scope and --changed cannot be used together (--scope already picks the folder's files)")
  return o
}

// Small helpers that keep main() short (a refactor check holds Meerkat to its own length and complexity limits).
const subsOffMap = (list = []) => {
  const m = new Map()
  for (const ref of list) {
    const [cid, sid] = ref.split('/')
    m.set(cid, (m.get(cid) ?? new Set()).add(sid))
  }
  return m
}
const listJsonText = (checks) => JSON.stringify(checks.map((c) => ({ id: c.id, kind: c.group, tier: c.tier, lane: c.lane, seconds: c.estSeconds ?? null, title: c.title, optIn: c.optIn ?? null, pack: packOfCheck(c), suite: suiteIdOf(c), subs: c.subs ?? 1, origin: c.origin ?? 'bundled', ...(suiteInfo(suiteIdOf(c))?.project ? { suiteLabel: suiteInfo(suiteIdOf(c)).label, suitePurpose: suiteInfo(suiteIdOf(c)).purpose } : {}) })))
function logDisabled(log, applied, configFile, verbose = false) {
  // Without --verbose the left-out checks are one line, not one line each (a first run printed dozens).
  const total = applied.disabled.length + (applied.disabledSubs ?? []).length
  if (!verbose && total > 3) return log(`${total} check(s)/rule(s) left out by the preset or the config (--verbose lists them)`)
  for (const d of applied.disabled) log(`[DISABLED] ${d.id}: ${d.preset ? `left out by preset ${d.preset}` : `turned off in ${configFile}${d.by ? ` (${d.by})` : ''}`}`)
  for (const ref of applied.disabledSubs ?? []) log(`[DISABLED] sub-check ${ref}: turned off in ${configFile}`)
}
const warnUnmatched = (log, words) => words.forEach((w) => log(`warning: ${w.startsWith('suite ') ? `--suite ${w.slice(6)}` : `--only ${w}`} matches no check`))
const selfTestChecks = (checks, opts) => {
  const picked = opts.only.length || opts.suites.length ? resolveOnly(checks, opts.only, opts.suites, opts.include).ids : null
  return checks.filter((c) => (picked ? picked.has(c.id) : !c.optIn || opts.include.includes(c.optIn)))
}

// --json-stdout: stdout carries one JSON object and nothing else, so notes go to stderr. -q/--quiet: only the final result line.
function outputStreams(opts, givenLog, env) {
  const baseLog = givenLog ?? ((l) => console.log(l))
  const hush = Boolean(opts.jsonStdout || opts.quiet)
  const toErr = givenLog ?? ((l) => console.error(l))
  if (opts.noColor) env.NO_COLOR = process.env.NO_COLOR = '1'
  return { baseLog, hush, log: opts.jsonStdout ? toErr : opts.quiet ? () => {} : baseLog, fail: hush ? toErr : baseLog }
}

// The run's summary.json plus where it is saved, as the only thing on stdout.
function emitSummary(dir, fallback, givenLog) {
  let summary = fallback
  try {
    summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
  } catch {
    /* no saved summary: the short form is printed */
  }
  ;(givenLog ?? ((l) => process.stdout.write(`${l}\n`)))(JSON.stringify({ ...summary, runDir: dir ?? null }, null, 2))
}

// Runs the checks with Ctrl-C handling (lib/runner.mjs stopOnSignals); the handlers are removed when the run ends.
const stoppable = async (ctx, log, go) => {
  const undo = stopOnSignals(ctx.control, log)
  try {
    return await go()
  } finally {
    undo()
  }
}
// The whole-run deadline in ms: --max-run-minutes, else "maxRunMinutes" in .meerkat-budgets.json, else 90 minutes.
const runDeadlineMs = (ctx, opts) => {
  const fromFile = loadBudgets(ctx.appDir, ctx.repoRoot).maxRunMinutes
  const mins = Number.isFinite(opts.maxRunMinutes) && opts.maxRunMinutes > 0 ? opts.maxRunMinutes : fromFile || DEFAULT_RUN_MINUTES
  return Math.round(mins * 60_000)
}
// onControl(control) is called before the checks start, so a board can bind its keys (skip, skipAll) to the run.
export async function main(argv = process.argv.slice(2), { log: givenLog, env = process.env, interactive, onControl } = {}) {
  const opts = parseArgs(argv)
  const streams = outputStreams(opts, givenLog, env)
  const { baseLog, hush } = streams
  let { log, fail } = streams
  // The live bar is for a person at a terminal: drawn only on a real TTY with the default output (a test or a
  // pipe passes its own log, CI sets CI), or when asked for with --progress. --no-progress or MEERKAT_PLAIN=1 turns it off.
  const liveBar = opts.plain || hush ? false : opts.progress ?? (interactive ?? (givenLog === undefined && Boolean(process.stdout.isTTY) && !env.CI && env.MEERKAT_PLAIN !== '1'))
  if (opts.errors.length) {
    fail(opts.errors.join('\n'))
    return 2
  }
  // A background job: lower the priority first so every check started after this inherits it (see lib/priority.mjs).
  if (opts.priority) env.MEERKAT_PRIORITY = opts.priority
  const priorityError = priorityProblem(env.MEERKAT_PRIORITY)
  if (priorityError) {
    fail(priorityError)
    return 2
  }
  const priorityNote = lowerPriority(env)
  if (priorityNote) log(priorityNote)
  try {
    const set = applyProfile(opts.profile ?? env.MEERKAT_PROFILE, env)
    if (set.length) log(`profile ${opts.profile ?? env.MEERKAT_PROFILE}: ${set.join(' ')}`)
  } catch (e) {
    fail(String(e.message))
    return 2
  }
  for (const k of Object.keys(env)) if (k.startsWith('NV_VERIFY_') && env[`MEERKAT_${k.slice(10)}`] === undefined) env[`MEERKAT_${k.slice(10)}`] = env[k]
  for (const k of ['CARGO_LOCK', 'ELECTRON_LOCK', 'BASH']) if (env[`NV_${k}`] !== undefined && env[`MEERKAT_${k}`] === undefined) env[`MEERKAT_${k}`] = env[`NV_${k}`]
  const here = dirname(fileURLToPath(import.meta.url))
  // The app being checked. Child scripts read it from MEERKAT_APP_DIR (NV_APP_DIR is set too, for older scripts and the example pack).
  const appDir = resolve(opts.app || appDirOf(env))
  const repoRoot = repoRootOf(appDir)
  process.env.MEERKAT_APP_DIR = process.env.NV_APP_DIR = appDir
  env.MEERKAT_APP_DIR = env.NV_APP_DIR = appDir
  // Meerkat checks projects, not any folder (lib/projectgate.mjs). Reading back results, listing and --init need no project; --force runs anyway.
  const readOnly = opts.init || opts.logs || opts.last || opts.why || opts.list || opts.listJson || opts.listPresets || opts.estimate
  if (!readOnly && !opts.force && env.MEERKAT_NO_PROJECT_GATE !== '1') {
    const gate = projectCheck(appDir)
    if (gate.unreadable) {
      // A missing folder, a file given as the folder, or a folder that cannot be read: stop here (exit 2) instead of running every check against it and reporting hundreds of false failures.
      let why = 'does not exist'
      if (existsSync(appDir)) why = statSync(appDir).isDirectory() ? 'cannot be read (check its permissions)' : 'is a file, not a folder'
      fail(`${appDir} ${why}; pass the project folder to check, or run Meerkat from inside it`)
      if (opts.jsonStdout) (givenLog ?? ((l) => process.stdout.write(`${l}
`)))(JSON.stringify({ ok: false, error: 'bad-folder', folder: appDir, message: `${appDir} ${why}`, exitCode: 2 }, null, 2))
      return 2
    }
    if (!gate.ok) {
      fail(notProjectMessage(appDir))
      if (opts.jsonStdout) (givenLog ?? ((l) => process.stdout.write(`${l}\n`)))(JSON.stringify(notProjectJson(appDir), null, 2))
      return 2
    }
  }
  if (opts.init) {
    const bad = folderProblem(appDir)
    if (bad) {
      fail(bad)
      return 2
    }
    try {
      const made = initConfig(appDir)
      log(made.message)
      return 0
    } catch (e) {
      fail(`could not write meerkat.config.json in ${appDir} (${e?.code ?? 'error'}): check that the folder is writable, or create the file by hand`)
      return 1
    }
  }
  // Reading back what the last run saved: nothing is run.
  if (opts.logs) {
    log(`logs are saved in ${logRoot(env)}${latestRunDir(env) ? `\nnewest run: ${latestRunDir(env)}` : ''}`)
    return 0
  }
  if (opts.last || opts.why) {
    const shown = opts.why ? showWhy(opts.why, env, 80, { folder: appDir }) : showLast(env, opts.lastProject, { folder: appDir })
    log(shown.text)
    return shown.ok ? 0 : 1
  }
  let tier = opts.thorough ? 'thorough' : 'fast'
  let groups = [...opts.groups]
  // The board's look (theme.mjs): one look, tuned in ~/.meerkat-theme.json. A loading screen shows what is happening
  // while the run is prepared, then disappears; real terminal only.
  const theme = loadTheme({ env })
  // The full board (the meerkat, the bars, the timeline) is the default in a real terminal. --plain, a pipe, CI or MEERKAT_PLAIN=1 give plain lines.
  const uiOk = (opts.ui || (!opts.plain && opts.progress !== false)) && !hush && canUseUi({ isTTY: givenLog === undefined && Boolean(process.stdout.isTTY), env })
  // The title names what runs: the preset when one was asked for, else the tier.
  const label = opts.preset ?? (opts.thorough ? 'thorough' : 'fast')
  const splash = createSplash({ theme, env, enabled: uiOk && !opts.list && !opts.selfTest && !opts.listPresets, title: `MEERKAT · ${label}` })
  // While the splash is up, notes are held and printed when it is gone, on the normal screen, so none is lost with the splash.
  const held = []
  let splashOpen = splash.enabled
  const settleSplash = () => {
    if (!splashOpen) return
    splashOpen = false
    splash.finish()
    for (const l of held.splice(0)) streams.log(l)
  }
  if (splash.enabled) {
    log = (l) => (splashOpen ? held.push(l) : streams.log(l))
    fail = (m) => (settleSplash(), streams.fail(m))
  }
  splash.step('Loading the checks')
  // The project's own settings (meerkat.config.json, lib/config.mjs): checks turned off or swapped, tools changed, the budget. Every
  // note and every turned-off check is printed, so nothing is changed silently.
  const configFile = opts.noConfig ? null : findConfig({ explicit: opts.config, appDir, repoRoot })
  // A config file the person NAMED must exist and be JSON: running on with defaults would check something other than what they asked for (exit 2, like any usage error).
  if (opts.config && !opts.noConfig) {
    const named = resolve(opts.config)
    let why = null
    if (!existsSync(named)) why = 'does not exist'
    else {
      try {
        JSON.parse(readFileSync(named, 'utf8'))
      } catch (e) {
        why = `is not valid JSON (${String(e.message).slice(0, 120)})`
      }
    }
    if (why) {
      fail(`--config ${named} ${why}; pass the path of a meerkat.config.json, or leave --config off to use the one in the project`)
      return 2
    }
  }
  // With no config file, the packs that fit the folder (lib/init.mjs) are used, so a bare `node run.mjs` still checks something.
  const read = configFile ? readConfig(configFile) : { config: { packs: detect(appDir).config.packs, extraChecks: [], disable: [], override: {}, budget: null, presets: {} }, notes: [] }
  // The person's settings (~/.meerkat.json): personal presets and extra folders of packs. Read before the presets, since a preset can bring packs.
  const user = readUserConfig(env)
  const packDirs = Array.isArray(user.packDirs) ? user.packDirs.filter((d) => typeof d === 'string' && d.trim() !== '') : []
  // --list-presets: every preset and where it comes from. Nothing is run.
  if (opts.listPresets) {
    for (const line of presetLines(read.config.presets ?? {}, user.presets ?? {})) log(line)
    return 0
  }
  // --preset (security, ui-fast, app, ...) picks the tier, the kinds of check and any packs it brings; --group adds to it. A project's
  // preset wins over the person's, which win over the built-in ones. Resolved before the packs load, so a preset's packs load too.
  const chosen = resolvePreset(opts.preset, mergePresets(read.config.presets ?? {}, user.presets ?? {}))
  if (chosen.error) {
    fail(chosen.error)
    return 2
  }
  if (chosen.preset) {
    tier = chosen.preset.tier
    groups = [...chosen.preset.groups, ...groups]
    opts.include.push(...chosen.preset.include)
    // With no config file, a preset that picks checks by kind (security, refactor, ui, ...) has nothing to pick from in the two starting packs,
    // so every pack that applies to the folder loads, as it does for quick and full. A project's config still decides for itself.
    read.config.packs = [...new Set([...(read.config.packs ?? []), ...presetPacks(chosen.preset, appDir), ...(configFile ? [] : applicablePacks(appDir))])]
    if (!opts.list) log(`preset ${chosen.preset.name}: ${presetAboutLine(chosen.preset.about, env, appDir, opts.preset)}`)
  }
  // ignorePaths (top level, and the chosen preset's own): left out of Meerkat's own file-walking checks; one line says how many files and by which key.
  const ignoring = ignoreSummary(appDir, ignoreSources(read.config, chosen.preset?.name ?? null))
  if (ignoring.patterns.length) {
    env.MEERKAT_IGNORE_PATHS = process.env.MEERKAT_IGNORE_PATHS = JSON.stringify(ignoring.patterns)
    if (!opts.list) log(ignoreLine(ignoring))
  } else {
    delete env.MEERKAT_IGNORE_PATHS
    delete process.env.MEERKAT_IGNORE_PATHS
  }
  const applied = await applyConfig([], read.config, { file: configFile, extraPackDirs: packDirs, personalChecks: user.customChecks, projectDir: appDir, noProjectCode: Boolean(env.MEERKAT_NO_PROJECT_CODE), trust: makeTrust(env, { interactive: opts.noInput ? false : undefined }) })
  applyPresetExclusions(applied, chosen.preset)
  // The project's own tests, found without being told (lib/discover.mjs): only for full, thorough and release (thorough tier with every pack; quick also has allPacks, so the tier decides), or
  // when asked for by name (`meerkat check discovered`). Never for quick or ci. "discover": false turns it off.
  const asked = opts.only.includes('discovered')
  const found = ((tier === 'thorough' && (!chosen.preset || chosen.preset.allPacks)) || asked) && !opts.selfTest ? discoverChecks(appDir, { existing: applied.all ?? applied.checks, config: { disable: read.config.disable, override: read.config.override }, project: read.config.discover, personal: user.discover, noProjectCode: Boolean(env.MEERKAT_NO_PROJECT_CODE) }) : null
  if (asked) opts.only = [...opts.only.filter((w) => w !== 'discovered'), ...(found?.checks ?? []).map((c) => c.id)]
  if (asked && !opts.only.length) {
    fail(found && !found.enabled ? 'discovery is turned off ("discover": false), so there is nothing to run for "discovered"' : 'no tests of this project\'s own were found to run (meerkat discover shows what was looked at)')
    return 3
  }
  const checks = [...applied.checks, ...(found?.checks ?? [])]
  if (!opts.list) {
    if (configFile) log(`config: ${configFile}`)
    for (const note of [...read.notes, ...applied.notes, ...(found?.result.notes ?? [])]) log(`config: ${note}`)
    logDisabled(log, applied, configFile, opts.verbose)
    for (const d of found?.result.disabled ?? []) log(`config: found check ${d.id} is turned off by your config`)
    if (found?.checks.length) log(`found ${found.checks.length} test check${found.checks.length === 1 ? '' : 's'} of the project's own (meerkat discover lists them; "discover": false turns this off)`)
  }
  splash.step('Reading the times measured on this PC')
  // Use the times measured on this machine for the order, the bar and the time left; keep the written ones for any check not yet measured.
  const timingsFile = timingsPath(env)
  const timings = loadTimings(timingsFile, appDir)
  applyLearned(checks, timings, tier, { env })

  if (opts.listJson) settleSplash()
  if (opts.listJson) return (baseLog(listJsonText(checks)), 0)
  if (opts.list) {
    for (const c of checks) {
      log(`${c.id.padEnd(24)} ${c.group.padEnd(13)} ${c.tier.padEnd(9)} ${c.lane.padEnd(9)} ~${String(c.estSeconds ?? '?').padStart(4)}s${c.optIn ? `  opt-in:${c.optIn}` : ''}  ${c.title}`)
    }
    return 0
  }

  const ctx = { timeoutScale: opts.timeoutScale ?? 1, control: createControl(), noIdleKill: opts.noIdleKill === true, repoRoot, appDir, tier, env, platform: process.platform, exists: existsSync, changedFiles: null, scope: opts.scope ?? [], disabledSubs: subsOffMap(applied.disabledSubs), findingsSink: new Map(), logDir: opts.list || opts.estimate ? null : makeRunDir(env, opts.selfTest ? `${tier}-selftest` : tier, new Date(), undefined, appDir, opts.selfTest ? null : opts.preset) }
  onControl?.(ctx.control)
  if (!ctx.logDir && !opts.list && !opts.estimate) log(`note: this run's logs cannot be saved (${logRoot(env)} is not a folder Meerkat can write to), so meerkat last, findings and baseline will not see it. Set MEERKAT_LOG_DIR to a writable folder.`)
  let mode = opts.all || (tier === 'thorough' && !opts.changed) ? 'all' : 'changed'
  if (mode === 'changed') splash.step('Finding what changed against the base branch')
  if (mode === 'changed') ctx.changedFiles = gitChangedFiles(repoRoot, env)
  if (mode === 'changed' && ctx.changedFiles === null) log('note: git could not find a base branch to compare with (set MEERKAT_BASE), running every check')
  // Nothing differs from the base branch on a clean checkout or a release branch
  // checkout. "Nothing changed" must never mean "nothing to check", so every check of the tier runs.
  if (opts.scope?.length) {
    // --scope: the files of the given folders decide which checks run. An empty folder runs nothing, and says so.
    ctx.changedFiles = scopedFiles(repoRoot, opts.scope)
    mode = 'changed'
    if (ctx.changedFiles === null) {
      log(`note: git could not list the files in ${opts.scope.join(', ')}, running every check`)
      mode = 'all'
    } else if (ctx.changedFiles.length === 0) log(`note: no files found in ${opts.scope.join(', ')}: no check has anything to read`)
    else log(`scope: ${ctx.changedFiles.length} file(s) in ${opts.scope.join(', ')}`)
  }
  if (mode === 'changed' && !opts.scope?.length && Array.isArray(ctx.changedFiles) && ctx.changedFiles.length === 0) {
    log('note: nothing differs from the base branch (a clean checkout or a release branch), running every check of the tier')
    mode = 'all'
  }

  const started = Date.now()
  const recorder = createRecorder()
  const freeMemGBAtStart = freemem() / 2 ** 30
  let selection = null
  let schedulerUsed = null
  let results
  let skippedCount = 0
  let subOnly = new Map() // check id -> the sub-checks asked for with suite/check/sub
  let ranChecks = []
  let estimatedMs = null // how long the checks chosen were expected to take (null in a self-test)
  let status = null
  let boardShown = false // the live board ran in this terminal: its end-of-run output is the results screen, not a dump of lines
  if (!opts.list) {
    // An example pack can drive an app through that app's own harness (its pack.json says so); other packs need no such folder.
    const needsApp = examplePacks().some((p) => p.needsAppFile && read.config.packs?.includes(p.pack))
    const problem = needsApp ? appProblem(appDir) : null
    if (problem) {
      fail(problem)
      return 2
    }
  }
  if (opts.selfTest) {
    const withTest = selfTestChecks(checks, opts)
    log(`self-test: ${withTest.length} checks`)
    const bar = createProgress({ title: `MEERKAT · ${label} self-test`, checks: withTest, enabled: liveBar })
    status = createStatus({ title: `MEERKAT · ${label} self-test`, tier, checks: withTest, file: statusPath(env), say: liveBar ? null : log })
    results = await stoppable(ctx, log, () => runAll(withTest, ctx, { selfTest: true, parallel: defaultParallel(cpus().length, env), log: liveBar ? () => {} : log, hooks: fanOut(liveBar ? bar : null, status, recorder), deadlineMs: runDeadlineMs(ctx, opts) }))
    bar.stop()
    status.stop()
  } else {
    splash.step('Choosing the checks to run')
    const order = loadOrder([appDir, repoRoot])
    if (order.error) {
      settleSplash()
      fail(order.error)
      return 2
    }
    const sel = selectForRun(checks, { kindOrder: order.kinds ?? null, tier, only: opts.only, include: opts.include, mode, changedFiles: ctx.changedFiles, groups, suites: opts.suites, preset: chosen.preset, env })
    settleSplash()
    if (opts.estimate) {
      // How long this run should take on this PC: the learned times, run through the same scheduling rules (lib/eta.mjs).
      const rows = createModel({ checks: sel.run, timings, tier }).snapshot(0)
      const slots = defaultParallel(cpus().length, env)
      const ms = estimateRemaining(rows, 0, { freeSlots: slots })
      const measured = sel.run.filter((c) => c.writtenEstSeconds !== undefined).length
      log(`ESTIMATE ${opts.preset ?? tier}: about ${durationText(ms)} for ${sel.run.length} checks (${measured} with times measured on this PC, ${sel.run.length - measured} using the written guess)`)
      const lane = (l) => sel.run.filter((c) => c.lane === l).reduce((n, c) => n + (c.estSeconds ?? 0), 0)
      log(`  work by lane: cargo ${lane('cargo')} s (one at a time), windows ${lane('electron')} s (one at a time), found window tests ${lane('windows')} s (up to ${found?.result.maxWindows ?? 3} at once), everything else ${lane('free')} s (side by side)`)
      return 0
    }
    // The run's own estimate, set beside the real time in the summary line (the same sum as --estimate and the preset menu).
    estimatedMs = sel.run.length ? estimateRunMs(sel.run, timings, tier, { slots: defaultParallel(cpus().length, env) }) : null
    // Nothing to run is not a pass: say why, and what to change.
    if (!sel.run.length) {
      fail(`no checks to run: ${checks.length} loaded from the packs ${JSON.stringify(read.config.packs ?? [])}, but ${opts.preset ? `the preset ${opts.preset}` : `the ${tier} tier`}${groups.length ? ` (kinds: ${groups.join(', ')})` : ''} selects none of them. Add a pack that has such checks to "packs" in ${configFile ?? 'meerkat.config.json'}.`)
      return 3
    }
    skippedCount = sel.skipped.length + (sel.windowSkipped?.length ?? 0) + applied.disabled.length
    ranChecks = sel.run
    selection = { ran: sel.run.map((c) => c.id), skipped: [...sel.skipped.map((c) => `${c.id} (no files changed in its paths)`), ...(sel.windowSkipped ?? []).map((c) => `${c.id} (skipped: ${WINDOW_SKIP_REASON})`)], covered: (sel.superseded ?? []).map((c) => `${c.id} (by ${c.supersededBy})`), disabled: applied.disabled.map((d) => d.id), disabledSubs: applied.disabledSubs ?? [], titles: Object.fromEntries([...sel.skipped, ...(sel.windowSkipped ?? []), ...(sel.superseded ?? []), ...applied.disabled].map((c) => [c.id, (checks.find((k) => k.id === c.id) ?? c).title]).filter(([, t]) => t)) }
    for (const s of sel.superseded ?? []) log(`[COVERED ] ${s.id}: not run on its own, ${s.supersededBy} covers it`)
    for (const s of sel.skipped) log(`[SKIPPED] ${s.id}: no files changed in its paths`)
    for (const s of sel.windowSkipped ?? []) log(`[SKIPPED] ${s.id}: skipped: ${WINDOW_SKIP_REASON} (--include windows or MEERKAT_WINDOWS=1 runs them)`)
    subOnly = (warnUnmatched(log, sel.unmatched), sel.subOnly)
    // --ui: the richer terminal view (lib/tui). Real terminal only; anywhere else the plain lines stay, and say so.
    const useUi = uiOk
    boardShown = useUi
    if (opts.ui && !useUi) log('note: --ui needs an interactive terminal (not a pipe, CI or MEERKAT_PLAIN=1); using the plain lines')
    const bar = useUi
      ? createTui({ control: ctx.control, theme, folder: appDir.split(String.fromCharCode(92)).join('/'), preset: label, title: `MEERKAT · ${label}`, checks: sel.run, timings, tier, history: loadHistory(historyPath(env)), meta: `${cpus().length} threads`, profile: opts.profile ?? env.MEERKAT_PROFILE ?? '', grouped: opts.grouped, typicalHere: timings.project === appDir, showFinal: false, sink: ctx.findingsSink })
      : createProgress({ title: `MEERKAT · ${label}`, checks: sel.run, enabled: liveBar })
    const quiet = liveBar || useUi
    status = createStatus({ title: `MEERKAT · ${label}`, tier, checks: sel.run, file: statusPath(env), say: quiet ? null : log })
    log(`live status: ${statusPath(env)} (rewritten every few seconds while this runs)`)
    // How much a run may use at once: every thread by default, and 3 GB of memory left free; the config can change both.
    const budget = { cpu: read.config.budget?.cpu ?? Math.min(10, cpus().length), reserveGB: read.config.budget?.reserveGB ?? 3, maxParallel: read.config.budget?.maxParallel ?? 10, maxWindows: found?.result.maxWindows ?? 3 }
    schedulerUsed = { slots: budget.cpu, maxParallel: budget.maxParallel, reserveGB: budget.reserveGB }
    // Result cache and project guard (lib/resultcache.mjs, lib/integrity.mjs). A check that passed on this exact project recently is
    // reused, not run again. The project is compared before and after the run: a write into it fails the run.
    const cacheOn = !opts.noCache && !opts.selfTest && Boolean(repoRoot)
    // cargo writes a Cargo.lock when a project has none (cargo metadata, audit, deny): that first lockfile is not a check changing the project.
    const allowWrites = [...(Array.isArray(read.config.allowWrites) ? read.config.allowWrites.filter((x) => typeof x === 'string') : []), ...(repoRoot && !existsSync(join(repoRoot, 'Cargo.lock')) ? ['Cargo.lock'] : [])]
    const beforeSnap = opts.selfTest ? null : snapshotTree(repoRoot, { allow: allowWrites })
    const digest = beforeSnap ? snapshotDigest(beforeSnap) : null
    const head = headOf(repoRoot)
    const cacheBefore = cacheOn && digest ? readCache(cacheFile(env, appDir)) : null
    const cacheKeys = new Map()
    const cached = []
    const toRun = []
    for (const c of sel.run) {
      if (!cacheOn || !digest) {
        toRun.push(c)
        continue
      }
      const key = cacheKey({ digest, head, tier, version: meerkatVersion(), checkId: c.id })
      cacheKeys.set(c.id, key)
      const hit = cacheHit(cacheBefore, c.id, key)
      if (hit) cached.push({ ...hit.result, status: 'PASS', ms: 0, cached: true, detail: `unchanged since ${hit.at.slice(0, 16).replace('T', ' ')} UTC: passed on this exact project (--no-cache runs it again)` })
      else toRun.push(c)
    }
    // The estimate counts only what will really run: checks the cache serves take no time (lib/runestimate.mjs).
    if (cached.length) estimatedMs = estimateRunMsWithCache(toRun, cached.length, timings, tier, { slots: defaultParallel(cpus().length, env) })
    const ranNow = toRun.length ? await stoppable(ctx, log, () => runAll(toRun, ctx, { budget, progressFiles: useUi, keepGoing: !opts.failFast, parallel: defaultParallel(cpus().length, env), log: quiet ? () => {} : log, hooks: fanOut(quiet ? bar : null, status, recorder), deadlineMs: runDeadlineMs(ctx, opts) })) : []
    results = [...ranNow, ...cached]
    if (cached.length && !quiet) log(`cache: ${cached.length} passing check(s) reused from an earlier run on this exact project (--no-cache runs everything again)`)
    bar.stop()
    // The project guard: anything a check wrote into the project fails the run, and nothing from that run is cached.
    const afterSnap = beforeSnap ? snapshotTree(repoRoot, { allow: allowWrites }) : null
    const writes = beforeSnap && afterSnap ? diffSnapshots(beforeSnap, afterSnap) : null
    const wroteProject = Boolean(writes && writes.changed.length + writes.added.length + writes.removed.length)
    if (wroteProject) results.push({ id: 'project-integrity', title: 'Checks must not change the project', suite: 'other', group: 'functionality', status: 'FAIL', detail: violationText(writes), ms: 0 })
    if (cacheOn && digest && !wroteProject) {
      const passes = results.filter((r) => r.status === 'PASS' && !r.cached && cacheKeys.has(r.id)).map((r) => ({ id: r.id, key: cacheKeys.get(r.id), result: r }))
      if (passes.length) {
        const { text } = updatedCache(cacheBefore ?? { schemaVersion: 1, entries: {} }, passes)
        saveCache(env, appDir, text)
      }
    }
    // Accepted findings (lib/accepted.mjs): dismissed ones, and with --ratchet the baseline. A check whose findings are all accepted passes.
    const acceptedSetsNow = opts.selfTest ? null : acceptedSets({ env, projectPath: appDir, ratchet: Boolean(opts.ratchet) })
    const anyAccepted = Boolean(acceptedSetsNow && (acceptedSetsNow.dismissed.size || acceptedSetsNow.baseline.size || acceptedSetsNow.expired?.size))
    // The ids come from the same builder that writes findings.json, so a dismissed id matches what the run lists.
    const builtNow = anyAccepted || (!opts.selfTest && results.some((r) => r?.status === 'FAIL')) ? safeBuild({ results, checks: ranChecks.length ? ranChecks : checks, sink: ctx.findingsSink, appDir, repoRoot, env }) : null
    // A check whose every finding carries an inline meerkat-ignore comment passes (lib/accepted.mjs).
    if (builtNow) passInlineIgnored(results, builtNow, ctx.findingsSink)
    const acceptedRecords = anyAccepted && builtNow ? applyAccepted(results, ctx.findingsSink, acceptedSetsNow, builtNow.findings, builtNow.hiddenChecks) : []
    // Dismissals and baseline entries written under an old id still match; say so once (lib/findingid.mjs).
    {
      const legacy = acceptedRecords.flatMap((x) => x.matchedLegacyIds ?? [])
      const fresh = legacy.length ? unnoticedLegacy(env, appDir, legacy) : []
      const note = migrationNote(fresh)
      if (note) {
        process.stderr.write(`meerkat: ${note}
`)
        markLegacyNoticed(env, appDir, fresh)
      }
    }
    if (acceptedRecords.length) {
      try {
        writeFileSync(join(ctx.logDir, 'accepted.json'), JSON.stringify({ schemaVersion: 1, mode: opts.ratchet ? 'ratchet' : 'dismissed', items: acceptedRecords }, null, 2))
      } catch {
        /* the record of accepted findings is a convenience; the run result stands */
      }
    }
    status.stop()
    // Keep what this run measured, so the next run's order, bar and time left are closer to the truth.
    saveTimings(timingsFile, { ...recordRun(timings, results, tier), project: appDir })
  }
  // Ctrl-C (or the run deadline, which is not an interruption) ends with the results so far saved; Ctrl-C exits 130.
  const interrupted = ctx.control.interrupted === true
  results = narrowSubs(results, subOnly) // `suite/check/sub` ids report only that sub-check
  let full = enrichResults(results, ranChecks.length ? ranChecks : checks) // suite and sub-check counts for the saved files and --json
  // A check that could not run gets a short log too (why, and what to do), so `meerkat why <check>` always has something to show.
  if (!opts.selfTest) full = saveNotRunLogs(ctx.logDir, full, ranChecks.length ? ranChecks : checks)
  const { line, exitCode: summaryCode } = summarise(opts.selfTest ? `${tier} self-test` : (opts.preset ?? tier), results, skippedCount, Date.now() - started, estimatedMs ? estimateVsActualText(estimatedMs, Date.now() - started) : '')
  const exitCode = interrupted ? 130 : summaryCode
  status?.stop(line)
  // A finished real run adds one entry to the run log the terminal UI's history view reads (home folder, never the repo).
  if (!opts.selfTest) appendRun(historyPath(env), runEntry({ tier, summary: line, exitCode, ms: Date.now() - started, results }))
  if (!boardShown) log('')
  // The per-check list is hundreds of lines on a real project: only with --verbose (and always for self-test). Failures and checks that did not run are listed below either way.
  if (!boardShown && (opts.verbose || opts.selfTest)) log(table(results, { checks: ranChecks, grouped: opts.selfTest ? false : opts.grouped, spans: spansFromRecorder(recorder) }))
  else if (!boardShown) log(`${results.filter((r) => r.status === 'PASS').length} of ${results.length} checks passed (--verbose lists every check; failures are listed below)`)
  // What needs a look, repeated in full (failed output, reasons); a passing check shows nothing beyond its row above.
  if (!opts.selfTest && !boardShown) for (const l of finalReport({ results, tier, timings, totalMs: Date.now() - started, checks: ranChecks, grouped: opts.grouped, spans: spansFromRecorder(recorder) })) log(l)
  if (!boardShown) log(line)
  // One dim line when the project has no checks of its own and the folder shows tests Meerkat could run (lib/recommend.mjs). Never in --json, quiet or plain output.
  if (!opts.selfTest && !boardShown && !opts.only.length && !opts.suites.length) {
    const tip = tipLine({ dir: appDir, checks, env, quiet: hush, plain: Boolean(opts.plain) })
    if (tip) log(uiOk ? `[2m${tip}[0m` : tip)
  }
  // Every check's log, a summary and a plain-text report are saved for this run (lib/runlog.mjs).
  // The detection files (lib/findingsdoc.mjs): findings.json, findings.md, findings.sarif and detections.jsonl, then the cross-run history.
  // --scope: only findings inside the scoped folders are kept. A check that scans the whole project still runs, but its findings
  // outside the folder are dropped here, so the scoped report and the findings file agree with what was asked.
  if (opts.scope?.length) for (const entry of ctx.findingsSink.values()) entry.findings = (entry.findings ?? []).filter((f) => inScopeFile(f.file, opts.scope))
  const findingsInfo = opts.selfTest ? null : saveFindings({ dir: ctx.logDir, results: full, checks: ranChecks.length ? ranChecks : checks, sink: ctx.findingsSink, appDir, repoRoot, env, version: meerkatVersion(), preset: opts.preset, tier, startedAtMs: started, ms: Date.now() - started, recorder, note: (m) => console.error(m) })
  if (findingsInfo && !opts.selfTest && !hush && !boardShown) log(findingsInfo.line)
  // Every failure of each check (count and file:line, cut at 20), not only the first one the check printed.
  // Summary first (the blocking count, the failed checks by name, the run folder); the per-check list follows, cut to 12 checks unless --full.
  const openFindings = findingsInfo?.doc?.findings?.length ? findingsInfo.doc.findings.filter((f) => f.status !== 'fixed') : []
  const sumLines = summaryLines({ checks: groupFailures(openFindings).map((g) => ({ id: g.check, count: g.count })), runFolder: ctx.logDir, full: Boolean(opts.full) })
  const allFail = openFindings.length ? failureLines(openFindings, { logPath: ctx.logDir }) : []
  const failLines = [...sumLines, ...(opts.full || allFail.length <= 12 ? allFail : [...allFail.slice(0, 12), `  ... and ${allFail.length - 12} more failed checks (--full lists them all)`])]
  if (failLines.length && !opts.selfTest && !hush && !boardShown) for (const l of failLines.length > sumLines.length ? [...sumLines, 'Failures per check:', ...failLines.slice(sumLines.length)] : failLines) log(l)
  // --format github: one workflow annotation per open finding, so GitHub Actions shows them on the changed lines (lib/ci-output.mjs).
  if (opts.format === 'github' && findingsInfo?.doc) for (const l of githubAnnotations(findingsInfo.doc)) process.stdout.write(`${l}\n`)
  const report = writeRunReport({ checks: ranChecks.length ? ranChecks : checks, interrupted, findingsInfo, dir: ctx.logDir, tier, preset: opts.preset, results: full, line, exitCode, ms: Date.now() - started, argv, configFile, env, version: meerkatVersion(), recorder, selection, scheduler: schedulerUsed, git: gitInfo(repoRoot), startedAtMs: started, freeMemGBAtStart, estimatedMs, runKey: opts.selfTest ? 'self-test' : null })
  // Optional (--ai-verify): a model double-checks the medium, high and critical findings. Off by default; it asks first unless --yes (lib/aiverify.mjs).
  if (opts.aiVerify && findingsInfo && !opts.selfTest && ctx.logDir) {
    const v = await verifyRunDir(ctx.logDir, { env, max: opts.aiVerifyMax ?? 25, yes: Boolean(opts.yes), confirm: askYes, out: (m) => log(m) })
    log(v.text)
    appendRunLog(ctx.logDir, v.text)
  }
  if (report && !boardShown) log(`logs: ${ctx.logDir}   (meerkat last shows the report, meerkat why <check> one check's log)`)
  // Where the logs are and how long they stay (lib/runpath.mjs); the board's own summary names the folder, the plain list above does too, this adds the retention.
  if (report && !opts.selfTest && !opts.quiet) for (const l of runPathLines({ dir: ctx.logDir, env }).slice(1)) log(l)
  // First run in a project with no config: said once (lib/firstrun.mjs). Never in --plain, --json or --quiet output.
  if (!opts.selfTest && !hush) {
    const note = firstRunNote({ dir: appDir, configFile, env, quiet: hush, plain: Boolean(opts.plain) })
    if (note) for (const l of note.split('\n')) log(uiOk ? `\u001b[2m${l}\u001b[0m` : l)
  }
  // At a terminal with the board: a short summary stays in the scrollback; the results screen (meerkat) shows everything else.
  if (boardShown && !opts.selfTest && failLines.length) for (const l of failLines.length > sumLines.length ? [...sumLines, 'Failures per check:', ...failLines.slice(sumLines.length)] : failLines) log(l)
  if (boardShown && !opts.selfTest) for (const l of compactSummary({ label, results: full, ms: Date.now() - started, estimatedMs, findings: findingsInfo?.doc?.counts ?? null, dir: report ? ctx.logDir : null })) log(l)
  if (opts.json) writeFileSync(opts.json, JSON.stringify({ tier, summary: line, exitCode, subTotals: rollup(full), results: full }, null, 2))
  if (opts.jsonStdout) emitSummary(ctx.logDir, { tier, summary: line, exitCode, subTotals: rollup(full), results: full }, givenLog)
  if (interrupted) log(`Stopped by you: results so far saved to ${ctx.logDir}`)
  if (opts.quiet) baseLog(line)
  // Nothing this run started may outlive it: sweep whatever is still alive (a grandchild, a check the deadline missed).
  sweepSpawned()
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
