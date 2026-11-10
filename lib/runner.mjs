// Selecting, scheduling and executing checks. Pure functions plus one async scheduler, so the tests can
// drive it with fake checks (including a deliberately hanging one).
import { projectFacts } from './eta.mjs'
import { noteStopReason, progressCheckEnd, progressCheckStart, progressPlan } from './progresslog.mjs'
import { isCompileHeavy } from './presets.mjs'
import { effectiveTimeoutSeconds, idleKillMsFor, idleKillText, isCompileCheck, loadBudgets, machineLoadFactor, timeoutText } from './timeouts.mjs'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { freemem, homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand, lastLine } from './exec.mjs'
import { closeInprocPool } from './inproc.mjs'
import { bashFor, wrapForLane, resolveCwd } from './lanes.mjs'
import { noConfigText, toolConfigured } from './toolconfig.mjs'
import { matchesAny } from './glob.mjs'
import { localPath, missingBinaries, missingReason } from './which.mjs'
import { notApplicable } from './applies.mjs'
import { checkLogText, saveCheckLog } from './runlog.mjs'
import { parseProgressLine } from './progress-files.mjs'
import { countsText, groupResults, timeText } from './tui/group.mjs'
import { judge, normaliseSubs, withSubs } from './subchecks.mjs'
import { defaultSeverity, normaliseFindings, parseOutputLines } from './findings.mjs'
import { inScopeFile } from './changed.mjs'
import { resolveOnly, suiteIdOf } from './suites.mjs'
import { createStrikes, toolOf } from './broken-tools.mjs'
import { orderByKind } from './testorder.mjs'

const DEFAULT_TIMEOUT_SECONDS = 600

// MEERKAT_JOBS: how many checks may run at once, as a positive whole number; anything else is ignored (null). It changes timing only, never what is checked.
export function jobsFromEnv(env = process.env) {
  const v = String(env?.MEERKAT_JOBS ?? '').trim()
  return /^[1-9][0-9]*$/.test(v) ? Math.min(Number(v), 64) : null
}

// The run control object. Passed as ctx.control (lib/runner.mjs runAll binds it while a run is going). Shape, kept stable for the board:
//   control.runningIds()  -> [{ id, lane, startedAt (ms), estSeconds, lastOutputAt (ms or null) }] oldest first
//   control.skip(id)      -> boolean. Stops that check (its process tree), records it NOT RUN "skipped by you after M:SS"; the others go on.
//   control.skipAll()     -> number skipped.
//   control.stop()        -> graceful stop (what Ctrl-C does): no new checks, running ones stopped, the rest NOT RUN; sets control.interrupted.
//   control.interrupted   -> true once stop() ran (bin/meerkat.mjs shows the results and exits 130).
export function createControl() {
  let impl = null
  const control = {
    interrupted: false,
    runningIds: () => (impl ? impl.runningIds() : []),
    skip: (id) => (impl ? impl.skip(id) : false),
    skipAll: () => (impl ? impl.skipAll() : 0),
    stop() {
      control.interrupted = true
      impl?.stop('interrupted by you')
    },
    bind(next) {
      impl = next
    },
  }
  return control
}

// M:SS, for the messages a stopped check shows.
export const clock = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Ctrl-C, Ctrl-Break, console close and SIGTERM (where the platform has them): the first one stops the run gracefully and saves its results;
// a second one within 3 s exits at once with 130. Returns a function that removes the handlers.
export function stopOnSignals(control, log = () => {}, exit = (code) => process.exit(code)) {
  const names = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']
  let first = 0
  const onSig = (sig) => {
    const now = Date.now()
    if (first && now - first <= 3000) exit(130)
    if (!first) {
      first = now
      log(`${sig}: stopping. Running checks are stopped and the results so far are saved. Press Ctrl-C again within 3 s to quit at once.`)
    }
    noteStopReason('interrupt')
    control?.stop()
  }
  const handlers = names.map((n) => [n, () => onSig(n)])
  for (const [n, h] of handlers) {
    try {
      process.on(n, h)
    } catch {
      /* this platform has no such signal */
    }
  }
  return () => {
    for (const [n, h] of handlers) process.off(n, h)
  }
}

// Which checks run, and which are skipped. `mode` is 'changed' | 'all'.
// `groups` (security, functionality, ui, performance) limits a run to those kinds of check; what a chosen check needs (a build) comes with it.
// `only` words are check ids, suite names, `suite/check` or `suite/check/sub` (lib/suites.mjs resolveOnly); `suites` are suite names. A sub id runs its parent
// check and `subOnly` (Map checkId -> Set(subId)) tells the caller to report only that sub-check. `unmatched` lists the words that matched nothing.
// `windows: false` leaves out the project's own discovered window checks (found-* on the windows lane); they come back with `--include windows`,
// MEERKAT_WINDOWS=1 (the caller passes windows: true) or by naming them in `only`. They are listed in `windowSkipped`, not as failures.
export const WINDOW_SKIP_REASON = 'window checks run in the ui, app and release presets'
// The ids a quick run leaves out: every compile-heavy check (lib/presets.mjs isCompileHeavy), and whatever waits on one (`after`), such as a window test that
// needs the build. Naming a check with --only still runs it. They are not listed as skipped: they belong to the deeper presets.
export function compileHeavyWithDependants(checks) {
  const out = new Set(checks.filter(isCompileHeavy).map((c) => c.id))
  for (let grew = true; grew; ) {
    grew = false
    for (const c of checks) if (!out.has(c.id) && (c.after ?? []).some((d) => out.has(d))) { out.add(c.id); grew = true }
  }
  return out
}
export function selectChecks(checks, { tier, only, include = [], mode, changedFiles, groups = [], suites = [], windows = true, skipCompile = false, kindOrder = null }) {
  const picked = (only && only.length) || (suites && suites.length) ? resolveOnly(checks, only ?? [], suites ?? [], include) : null
  let run = []
  const skipped = []
  const windowSkipped = []
  const eligible = []
  const windowsOn = windows !== false || include.includes('windows')
  const compileSkipped = skipCompile && !picked ? compileHeavyWithDependants(checks) : new Set()
  for (const c of checks) {
    if (picked) {
      if (picked.ids.has(c.id)) run.push(c)
      continue
    }
    if (!windowsOn && c.found && c.lane === 'windows') {
      windowSkipped.push(c)
      continue
    }
    if (c.optIn && !include.includes(c.optIn)) continue
    if (compileSkipped.has(c.id)) continue
    if (tier === 'fast' && c.tier !== 'fast' && !(mode === 'all' && c.fastWhenAll)) continue
    if (mode === 'changed' && c.paths && c.paths.length && Array.isArray(changedFiles) && !matchesAny(c.paths, changedFiles)) {
      skipped.push(c)
      continue
    }
    eligible.push(c)
    if (!groups.length || groups.includes(c.group)) run.push(c)
  }
  if (!picked && groups.length) {
    // Bring in everything a chosen check waits for, and what that waits for in turn.
    const byId = new Map(eligible.map((c) => [c.id, c]))
    const have = new Set(run.map((c) => c.id))
    const queue = [...run]
    while (queue.length) {
      for (const dep of queue.shift().after ?? []) {
        const d = byId.get(dep)
        if (d && !have.has(dep)) {
          have.add(dep)
          run.push(d)
          queue.push(d)
        }
      }
    }
  }
  // A check that a bigger one in the same run fully covers does not run on its own (the short click-through next
  // to the full one, the changed-files unit tests next to every unit test). Running both only made them compete
  // for the machine: the changed-files run died with "Failed to start threads worker" beside the full run.
  const ids = new Set(run.map((c) => c.id))
  const superseded = run.filter((c) => c.supersededBy && ids.has(c.supersededBy))
  const kept = run.filter((c) => !superseded.includes(c))
  return { run: orderByKind(orderForSpeed(kept), kindOrder), skipped, windowSkipped, superseded, subOnly: picked?.subOnly ?? new Map(), unmatched: picked?.unmatched ?? [] }
}

// Start order: longest processing time first. The wall time of a run is decided by its longest check (and by how well the rest
// fills the other slots), so the longest work must START first; a long check that starts last runs alone while every other slot
// is idle (a 6-minute windows check that began at minute 5 kept the whole machine waiting for 5 minutes). Ranking:
//   1. a check that others wait on (`after`) ranks by the longest chain that waits on it (its own time plus the tail), so on a cold
//      run the sidecar build starts before the parser tests and the window checks that wait for it overlap its work;
//   2. every other check ranks by its own estSeconds, which run.mjs has already replaced with the learned time (lib/timings.mjs);
//   3. a handful of QUICK checks (QUICK_SECONDS or less, nothing waits on them: formatting, a lint) still go first, at most
//      QUICK_LEAD of them, so a quick failure shows up at once without delaying the long work by more than a few seconds.
// Nothing is dropped or reordered across `after`; the scheduler still enforces every dependency, every lane limit (one cargo build,
// one electron run, discover.maxWindows windows) and the cpu/memory budget. Ties keep the written order.
const QUICK_SECONDS = 10
const QUICK_LEAD = 3

export function orderForSpeed(checks) {
  const ids = new Set(checks.map((c) => c.id))
  const est = (c) => c.estSeconds ?? 30
  const dependents = new Map(checks.map((c) => [c.id, []]))
  for (const c of checks) for (const d of c.after ?? []) if (ids.has(d)) dependents.get(d).push(c)
  const memo = new Map()
  // Seconds of work from the start of this check to the end of the longest chain that waits on it.
  const chain = (c, seen = new Set()) => {
    if (memo.has(c.id)) return memo.get(c.id)
    if (seen.has(c.id)) return est(c) // a dependency cycle: do not recurse forever, the scheduler reports it
    seen.add(c.id)
    const tail = Math.max(0, ...dependents.get(c.id).map((d) => chain(d, seen)))
    memo.set(c.id, est(c) + tail)
    return est(c) + tail
  }
  const index = new Map(checks.map((c, i) => [c.id, i]))
  const weight = (c) => (dependents.get(c.id).length ? chain(c) : est(c))
  const byWeight = (a, b) => weight(b) - weight(a) || index.get(a.id) - index.get(b.id)
  const quick = checks.filter((c) => !dependents.get(c.id).length && est(c) <= QUICK_SECONDS).sort((a, b) => est(a) - est(b) || index.get(a.id) - index.get(b.id)).slice(0, QUICK_LEAD)
  const rest = checks.filter((c) => !quick.includes(c)).sort(byWeight)
  return [...quick, ...rest]
}

// The limit for one check: see lib/timeouts.mjs. ctx.timeoutScale is --timeout-scale; the budgets file can raise single checks.
export function timeoutMsFor(check, ctx = {}) {
  ctx.timeoutPolicy ??= { facts: ctx.appDir ? projectFacts(ctx.appDir) : {}, budgets: loadBudgets(...[ctx.appDir, ctx.repoRoot].filter(Boolean)), scale: ctx.timeoutScale ?? 1, load: ctx.machineLoad ?? machineLoadFactor }
  return effectiveTimeoutSeconds(check, ctx.timeoutPolicy) * 1000
}

function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((resolve) => {
    t = setTimeout(() => resolve({ ok: false, timedOut: true, detail: timeoutText(ms / 1000, ms / 1000) + ` (${label})` }), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

// Every check gets its own scratch folder (ctx.scratchDir for a function, MEERKAT_SCRATCH for a command) and it is removed when the check
// ends, however it ends: pass, fail, throw, timeout or kill. A check that writes anything on the side writes it there, never in the project.
async function execute(spec, check, ctx, opts = {}) {
  timeoutMsFor(check, ctx) // fills ctx.timeoutPolicy once on the shared ctx, so the per-check copy below reuses it
  let dir = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'meerkat-check-'))
  } catch {
    /* no scratch folder: the check still runs */
  }
  try {
    return await executeIn(spec, check, dir ? { ...ctx, scratchDir: dir, env: { ...ctx.env, MEERKAT_SCRATCH: dir } } : ctx, opts)
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } catch {
        /* a leftover temp folder never fails a run */
      }
    }
  }
}

// Execute one command spec or function. Returns { status, detail }. `expectFail` inverts for self-tests.
// The project files a check's findings are in, for --scope: its structured findings when it gave any, else the file paths in its saved output.
function scopeFilesOf(r, ctx) {
  const structured = Array.isArray(r?.findings) ? r.findings.map((f) => f?.file).filter(Boolean) : []
  if (structured.length) return structured
  return parseOutputLines(r?.output ?? '', (p) => (existsSync(join(ctx.appDir, p)) ? p : null)).map((f) => f.file)
}

async function executeIn(spec, check, ctx, { expectFail = false } = {}) {
  const ms = timeoutMsFor(check, ctx)
  const startedAt = Date.now()
  if (typeof spec === 'function') {
    let r
    let broken = null
    try {
      r = await withTimeout(Promise.resolve().then(() => spec(ctx)), ms, check.id)
    } catch (e) {
      // The check threw inside Meerkat's runner: Meerkat's own code path failed, not the project (a BROKEN strike, lib/broken-tools.mjs).
      broken = String(e?.message ?? e)
      r = { ok: false, detail: broken }
    }
    if (!expectFail && !broken && (r === null || typeof r !== 'object')) {
      broken = 'the check returned a result Meerkat cannot read'
      r = { ok: false, detail: broken }
    }
    if (!expectFail && !broken && r.timedOut) return keepLog({ status: 'NOT RUN', detail: r.detail }, { check, spec, ctx, expectFail, code: null, ms: Date.now() - startedAt, startedAt, output: r.detail })
    if (!expectFail && !broken && typeof r.notRun === 'string') return keepLog({ status: 'NOT RUN', detail: r.notRun }, { check, spec, ctx, expectFail, code: null, ms: Date.now() - startedAt, startedAt, output: r.notRun })
    // A function check may return `subs` (the sub-check protocol, lib/subchecks.mjs); it is judged like a script's sub lines.
    const subsIn = expectFail ? [] : normaliseSubs(r.subs)
    const jf = subsIn.length ? judge({ subs: subsIn, code: r.ok ? 0 : 1, disabled: ctx.disabledSubs?.get(check.id) ?? new Set() }) : null
    let okF = r.ok
    let detailF = r.detail ?? ''
    if (jf?.status === 'FAIL') [okF, detailF] = [false, jf.detail]
    else if (jf?.status === 'PASS') [okF, detailF] = [true, jf.detail]
    else if (jf?.detail && !okF) detailF = jf.detail
    // --scope (see the verdict below): every finding outside the scoped folders means this failure is not in the scope.
    const scopedAway = !expectFail && !okF && Array.isArray(ctx.scope) && ctx.scope.length > 0 && scopeFilesOf(r, ctx).length > 0 && scopeFilesOf(r, ctx).every((f) => !inScopeFile(f, ctx.scope))
    if (scopedAway) [okF, detailF] = [true, `passed for the scope: its findings are outside ${ctx.scope.join(', ')}`]
    const result = { ...withSubs(finish(okF, detailF, expectFail), jf?.subs ?? []), ...(broken ? { broken: true, brokenError: broken } : {}) }
    if (!expectFail) ctx.findingsSink?.set(check.id, { findings: normaliseFindings(r.findings), output: r.detail ?? '' })
    return keepLog(result, { check, spec, ctx, expectFail, code: okF ? 0 : 1, ms: Date.now() - startedAt, startedAt, output: r.detail ?? '', subs: result.subs })
  }
  // A check's own env is its DEFAULT: an NV_* variable the person set (or a profile set) wins, so a slower PC can
  // lower the window count without editing the check. A self-test env is a requirement and always wins.
  // {repo} and {app} in a command's arguments and environment are the repository root and the app folder (forward slashes), so a check can
  // name a folder without any machine's path in it.
  const expand = (v) => (typeof v === 'string' ? v.split('{repo}').join(String(ctx.repoRoot).replace(/\\/g, '/')).split('{app}').join(String(ctx.appDir).replace(/\\/g, '/')) : v)
  const specEnv = Object.fromEntries(Object.entries(spec.env ?? {}).map(([k, v]) => [k, expand(v)]))
  if (!expectFail) for (const k of Object.keys(specEnv)) if (k.startsWith('NV_') && ctx.env?.[k] !== undefined && ctx.env[k] !== '') specEnv[k] = ctx.env[k]
  // A check may narrow its own arguments to the changed part of the project (rust-test runs only the changed crates). Self-tests always run as written.
  const scope = !expectFail && typeof check.scopeArgs === 'function' ? check.scopeArgs(ctx) : null
  const args = scope?.args ?? spec.args ?? []
  const wrapped = wrapForLane(check.lane, spec.cmd, args.map(expand), { ...ctx.env, ...specEnv }, ctx.exists)
  if (wrapped.missing) return keepLog({ status: 'NOT RUN', detail: wrapped.missing }, { check, spec, ctx, expectFail, code: null, ms: 0, startedAt, output: wrapped.missing })
  // The file-progress protocol (lib/progress-files.mjs). The child is asked for file lines only when the live board is on; otherwise it
  // is asked only for its file count, which is saved as `files.total`. The lines are taken out of the output either way.
  let files = null
  const idleMs = idleKillMsFor(check, { budgets: ctx.timeoutPolicy?.budgets, noIdleKill: ctx.noIdleKill })
  const r = await runCommand({
    cmd: wrapped.cmd,
    args: wrapped.args,
    cwd: resolveCwd(spec.cwd, ctx),
    env: { ...localPath(ctx.env, [ctx.appDir, ctx.repoRoot]), ...(ctx.scratchDir ? { MEERKAT_SCRATCH: ctx.scratchDir } : {}), MEERKAT_NESTED: '1', MEERKAT_PROGRESS: ctx.progressFiles ? '1' : 'count', MEERKAT_DEFAULT_SEVERITY: defaultSeverity(check, suiteIdOf(check)), ...specEnv, ...wrapped.env },
    timeoutMs: ms,
    idleKillMs: idleMs,
    onSpawn: ctx.onSpawn,
    extendWhileActive: isCompileCheck(check),
    onLine: ctx.onLine,
    onProgress: (line) => {
      const p = parseProgressLine(line)
      if (!p) return
      if (p.total !== undefined) files = { total: p.total }
      ctx.onProgress?.(p)
    },
  })
  const withFiles = (res) => (files ? { ...res, files } : res)
  // A scan that ran out of time is NOT RUN with that reason: not a finding, and not a broken tool (lib/broken-tools.mjs).
  if (!expectFail && r.timedOut) return keepLog(withFiles({ status: 'NOT RUN', detail: timeoutText(r.ms / 1000, ms / 1000) }), { check, spec, ctx, expectFail, code: r.code, ms: Date.now() - startedAt, startedAt, output: r.output, limitMs: ms, idleMs: idleMs || null })
  // A check may name `parseOutput(output)`: Meerkat's reader for what the tool prints. When it throws, the tool returned output Meerkat cannot read: a BROKEN strike.
  if (!expectFail && r.code !== 75 && typeof check.parseOutput === 'function') {
    try {
      check.parseOutput(r.output)
    } catch (e) {
      const why = `unreadable output: ${String(e?.message ?? e)}`
      return keepLog(withFiles({ status: 'FAIL', detail: why, broken: true, brokenError: why }), { check, spec, ctx, expectFail, code: r.code, ms: Date.now() - startedAt, startedAt, output: r.output, limitMs: ms, idleMs: idleMs || null })
    }
  }
  // The findings the check printed (lib/findings.mjs) and its output go to the run's side table, not into the result, so summary.json stays small.
  // A check that only compares the project with Meerkat's own default limits is advice until the project writes its own budgets: it passes, and what it found is info.
  const advisory = !expectFail && r.code === 1 && !r.timedOut && ADVISORY_WITHOUT_BUDGETS.has(check.id) && !hasBudgetsFile(ctx)
  // A rule turned off (config disableSubs, or left out by a preset such as bugs) is not reported as a finding either, only passed over in the verdict.
  const offRules = ctx.disabledSubs?.get(check.id)
  const rawFindings = offRules?.size ? (r.findings ?? []).filter((f) => !offRules.has(f.rule)) : (r.findings ?? [])
  const findingsOut = advisory ? rawFindings.map((f) => ({ ...f, severity: 'info' })) : rawFindings
  if (!expectFail) ctx.findingsSink?.set(check.id, { findings: findingsOut, output: r.output })
  // --scope: a failing check whose every finding is outside the scoped folders is not a failure of the scope. A check that failed with no
  // findings (a crash, a missing tool) still fails. The findings themselves are kept in the run's files, only the verdict is scoped.
  const scopeOnly = !expectFail && !advisory && !r.timedOut && r.code === 1 && Array.isArray(ctx.scope) && ctx.scope.length > 0 && scopeFilesOf(r, ctx).length > 0 && scopeFilesOf(r, ctx).every((f) => !inScopeFile(f, ctx.scope))
  let detail = r.timedOut ? timeoutText(r.ms / 1000, ms / 1000) : r.killed === 'idle' ? idleKillText(idleMs / 1000) : lastLine(r.output)
  // A failing test names itself: the detail carries the test name, not "error: test failed".
  const failedTest = /^test (.+) \.\.\. FAILED$/m.exec(String(r.output ?? ''))
  if (!r.timedOut && failedTest) detail = `test failed: ${failedTest[1]}`
  // The sub-check protocol (lib/subchecks.mjs): the exit code decides, unless a script that exits 0 printed a FAIL sub line (a script lying is a bug)
  // or every FAIL sub line was turned off in the config. A FAIL sub line also makes the shown reason better.
  const judged = !expectFail && !r.timedOut && r.code !== 75 && r.subs?.length ? judge({ subs: r.subs, code: r.code, disabled: ctx.disabledSubs?.get(check.id) ?? new Set() }) : null
  const ok = advisory || scopeOnly ? true : judged?.status === 'PASS' ? true : judged?.status === 'FAIL' ? false : r.code === 0
  if (judged?.detail) detail = judged.detail
  if (scope?.note) detail = `${scope.note}${detail ? `; ${detail}` : ''}`
  if (scopeOnly) detail = `passed for the scope: its finding(s) are in ${scopeFilesOf(r, ctx).length} file(s), none inside ${ctx.scope.join(', ')}`
  if (advisory) detail = `advisory, not enforced (no .meerkat-budgets.json yet): ${detail}`
  const subs = judged?.subs ?? []
  // The table shows one line, which is often not the cause (a click-through failure once showed only its own
  // summary). A check that did not pass keeps its whole output in a file, and the line names the file.
  // The saved path is also returned as its own field (outputFile), so nothing downstream has to dig it out of free text.
  let saved = null
  if (!expectFail && !ok && r.code !== 75) {
    // With a run folder the check's log is written there below; the path is known now so the table row can name it.
    saved = ctx.logDir ? logPathFor(ctx.logDir, check.id, expectFail) : saveFailureLog(check.id, r.output, ctx.env)
    if (saved) detail += `  [full output: ${saved}]`
  }
  // Exit 75 means NOT RUN (a tool, service or setting is missing; cargo-lock and electron-lock use it for "waited too long").
  const logged = { check, spec, ctx, expectFail, code: r.code, ms: Date.now() - startedAt, startedAt, output: r.output, subs, limitMs: ms, idleMs: idleMs || null }
  if (r.code === 74 && !r.timedOut && !expectFail) return keepLog(withFiles({ status: 'SKIPPED', detail: detail.replace(/^SKIPPED:\s*/i, '') }), logged)
  if (r.code === 75 && !r.timedOut) return keepLog(withFiles({ status: 'NOT RUN', detail: detail.replace(/^NOT RUN:\s*/i, '') }), logged)
  // A damaged Electron install (its binary missing from node_modules) is a tool that cannot run here, not a failing window (found 2026-11-05).
  if (!expectFail && !r.timedOut && /Electron failed to install correctly/.test(r.output ?? '')) return keepLog(withFiles({ status: 'NOT RUN', detail: 'Electron is not installed correctly in this project (node_modules/electron is damaged). Delete node_modules/electron and run: npx install-electron --no' }), logged)
  // A self-test must fail for the reason the fixture was written for, not because the tool broke or a flag was wrong.
  if (expectFail && r.code !== 0 && spec.expectMatch && !new RegExp(spec.expectMatch, 'i').test(String(r.output ?? ''))) return keepLog({ status: 'FAIL', detail: `self-test: the tool failed, but not for the expected reason (output did not match /${spec.expectMatch}/): ${detail}` }, { check, spec, ctx, expectFail, code: r.code, ms: Date.now() - startedAt, startedAt, output: r.output })
  let result = withSubs(withFiles(finish(ok, detail, expectFail)), subs)
  if (advisory) result = { ...result, advisory: true }
  // `detail` is the one short line the screens show (200 characters). The whole line is kept beside it for the files a person or an AI reads.
  const fullLine = r.timedOut || r.killed === 'idle' || judged?.detail ? null : lastLine(r.output, 8000)
  if (fullLine && fullLine.length > 200 && !expectFail) result = { ...result, detailFull: fullLine }
  return keepLog(saved ? { ...result, outputFile: saved } : result, logged)
}

// Checks whose verdict is only "over Meerkat's default limit": a project that has not written its own budgets (.meerkat-budgets.json, in the root or in .meerkat/)
// has not asked for those limits, so a first scan shows them as notes and does not fail on them.
export const ADVISORY_WITHOUT_BUDGETS = new Set([
  'line-length', 'long-functions', 'deep-nesting', 'many-parameters', 'cyclomatic-complexity', 'file-length', 'duplicate-code', 'dead-code', 'commented-out-code', 'ts-any-overuse',
  'http-timeouts',
])
const hasBudgetsFile = (ctx) => [ctx.appDir, ctx.repoRoot].filter(Boolean).some((d) => existsSync(join(d, '.meerkat-budgets.json')) || existsSync(join(d, '.meerkat', '.meerkat-budgets.json')))
const logPathFor = (dir, id, selfTest) => `${dir}/${id.replace(/[^a-z0-9._-]/gi, '_')}${selfTest ? '.selftest' : ''}.log`

// Write this check's log into the run folder (when there is one) and name it in the result as logFile.
function keepLog(result, { check, spec, ctx, expectFail, code, ms, startedAt, output, subs = [], limitMs = null, idleMs = null }) {
  if (!ctx.logDir) return result
  const file = saveCheckLog(ctx.logDir, `${check.id}${expectFail ? '.selftest' : ''}`, checkLogText({ check, spec, result, code, ms, startedAt, output, subs, findingCount: expectFail ? 0 : ctx.findingsSink?.get(check.id)?.findings?.length ?? 0, project: ctx.appDir }))
  const command = spec && typeof spec === 'object' ? [spec.cmd, ...(spec.args ?? [])].join(' ') : null
  return file ? { ...result, logFile: file, exitCode: code, startedAt: new Date(startedAt).toISOString(), command, ...(limitMs ? { limitMs } : {}), ...(idleMs ? { idleKillMs: idleMs } : {}) } : result
}

export function saveFailureLog(id, output, env = process.env) {
  try {
    const dir = env.MEERKAT_LOG_DIR || join(homedir(), '.meerkat', 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}-${Date.now()}.log`).split('\\').join('/')
    writeFileSync(file, String(output ?? ''))
    return file
  } catch {
    return null
  }
}

function finish(ok, detail, expectFail) {
  if (expectFail) {
    return ok
      ? { status: 'FAIL', detail: 'self-test: the check PASSED a deliberately broken case, so it cannot be trusted' }
      : { status: 'PASS', detail: `self-test: correctly failed (${detail})` }
  }
  return { status: ok ? 'PASS' : 'FAIL', detail }
}

export async function runOne(check, ctx, { selfTest = false } = {}) {
  // A check about files this folder does not have passes with a note, before anything else: a missing tool is not a reason to report NOT RUN for it.
  if (!selfTest) {
    const na = notApplicable(check, ctx)
    if (na) return { status: 'PASS', detail: na }
  }
  // A style tool the project never configured is SKIPPED (not applicable here), decided before asking whether the tool is installed.
  // NOT RUN stays for a tool that is configured but cannot run (missing binary, timeout).
  if (!selfTest && check.configTool && !toolConfigured(check.configTool, ctx.repoRoot ?? ctx.appDir)) return { status: 'SKIPPED', detail: noConfigText(check.configTool) }
  // `bash` is found the way the lanes find it (MEERKAT_BASH, the bash next to git, Git for Windows), not only on PATH: a PowerShell window
  // usually has no bash on PATH although Git's is installed, and that must not turn every cargo check into NOT RUN.
  const needs = (check.needs ?? []).filter((b) => !(b === 'bash' && ctx.platform === 'win32' && bashFor(ctx.env, ctx.exists, ctx.platform)))
  const missing = missingBinaries(needs, { ...ctx.env, ...localPath(ctx.env, [ctx.appDir, ctx.repoRoot]) }, ctx.platform)
  if (missing.length) return { status: 'NOT RUN', detail: missingReason(missing, check.install) }
  if (selfTest) {
    const st = check.selfTest
    if (!st) return { status: 'FAIL', detail: 'no selfTest defined' }
    if (typeof st === 'function') return execute(st, check, ctx, { expectFail: true })
    return execute(st, check, ctx, { expectFail: st.expectFail !== false })
  }
  return execute(check.run, check, ctx)
}

// Schedule checks: cheap first, free lane in parallel, cargo and electron one at a time each.
// What a check costs the machine while it runs: processor threads and memory. Light checks (a scan, a lint, a quick audit) cost about
// one thread and are run side by side; heavy ones (a build, the unit tests, a window with many windows) cost a lot and are started only
// when the machine has room for them, which in practice means mostly alone. A check can state its own cost (`cost: { cpu, memGB }`);
// otherwise it gets the usual cost of its lane.
const LANE_COST = { cargo: { cpu: 6, memGB: 3 }, electron: { cpu: 4, memGB: 3 }, windows: { cpu: 3, memGB: 1.5 }, free: { cpu: 2, memGB: 0.3 } }
// Weight classes, for people writing checks: a run has 10 slots, so about 10 tiny checks, 5 light, 2 or 3 medium, or 1 heavy plus a light
// one can run together, and an "alone" check gets the machine to itself. A check with no weight gets the usual cost of its lane.
export const WEIGHTS = { tiny: { cpu: 1, memGB: 0.1 }, light: { cpu: 2, memGB: 0.3 }, medium: { cpu: 4, memGB: 1.5 }, heavy: { cpu: 8, memGB: 3 } }
export const isAlone = (check) => check.alone === true || check.weight === 'alone'
export const costOf = (check) => ({ ...(WEIGHTS[check.weight] ?? LANE_COST[check.lane] ?? LANE_COST.free), ...(check.cost ?? {}) })

// Backfilling. While the longest waiting check is reserved (it needs room the running checks hold), nothing behind it may start, or a stream of small checks would
// keep the machine full and it would never run. But holding back everything also means one heavy check runs alone for many minutes while hundreds of one-second
// checks wait. The rule (EASY backfilling): the reserved check will fit at its "shadow time", when enough of the running checks have ended, in the order they are
// expected to end. A check that already fits the free room may start now only if it is expected to end before that shadow time, so it cannot delay the reserved one.
// Times are the estimates (learned from earlier runs); an overdue check counts as ending at once, so nothing backfills behind it.
export function shadowSeconds(reservedCost, runningRecs, budget, now = Date.now()) {
  const items = [...runningRecs].map((rec) => ({ left: Math.max(0.01, (rec.check.estSeconds ?? 60) - (now - rec.startedAt) / 1000), cost: costOf(rec.check) })).sort((a, b) => a.left - b.left)
  let cpu = items.reduce((s, i) => s + i.cost.cpu, 0)
  let n = items.length
  for (const it of items) {
    cpu -= it.cost.cpu
    n--
    if ((!budget || cpu + reservedCost.cpu <= budget.cpu) && (!budget?.maxParallel || n < budget.maxParallel)) return it.left
  }
  return items.length ? items.at(-1).left : 0
}
export function canBackfill(check, shadow, { maxSeconds = 120 } = {}) {
  return Number.isFinite(shadow) && shadow > 0 && (check.estSeconds ?? 30) <= Math.min(maxSeconds, shadow)
}

// `budget` ({ cpu, reserveGB }) is how much a run may use at once; null means no limit (the old behaviour). Memory is read from the
// machine each time (freeMemGB), so a PC that is busy with something else starts fewer checks. One check can always run alone.
export async function runAll(checks, ctx, { keepGoing = false, parallel = 2, selfTest = false, log = () => {}, hooks = {}, budget = null, progressFiles = false, freeMemGB = () => freemem() / 2 ** 30, control = ctx.control ?? null, deadlineMs = 0 } = {}) {
  closeInprocPool() // a run starts with no worker (and so no cached file text) from an earlier one
  const jobs = jobsFromEnv(ctx.env ?? process.env)
  if (jobs) {
    parallel = jobs
    budget = { cpu: Infinity, reserveGB: -1e9, ...(budget ?? {}), maxParallel: jobs }
  }
  const results = new Map()
  progressPlan(checks.length)
  const strikes = createStrikes(ctx.env ?? process.env)
  const pending = [...checks]
  const running = new Map() // id -> { check, startedAt, entries } for checks running now
  const laneBusy = { cargo: false, electron: false }
  const used = new Map() // id -> cost of what is running now
  let freeRunning = 0
  let windowsRunning = 0 // the windows lane runs several window checks at once, up to budget.maxWindows (lib/discover.mjs)
  let aloneRunning = false
  const fits = (c) => {
    if (!budget || used.size === 0) return true
    const cost = costOf(c)
    // A check marked `alone` (or any check once `budget.maxParallel` are running) waits for a quiet machine; so does everything while one runs.
    if (isAlone(c) || aloneRunning) return false
    if (budget.maxParallel && used.size >= budget.maxParallel) return false
    let cpu = 0
    for (const u of used.values()) cpu += u.cpu
    if (cpu + cost.cpu > budget.cpu) return false
    return freeMemGB() - (budget.reserveGB ?? 3) >= cost.memGB
  }
  let failed = false
  const ids = new Set(checks.map((c) => c.id))

  const settle = (check, r, ms, counts = true) => {
    results.set(check.id, { id: check.id, title: check.title, ...r, ms })
    progressCheckEnd(check.id)
    log(`[${r.status.padEnd(7)}] ${check.id} (${(ms / 1000).toFixed(1)}s)${r.detail ? ': ' + r.detail : ''}`)
    hooks.settle?.(check, r, ms)
    // A check the person skipped is NOT RUN, but it does not hold back the others (even with --fail-fast).
    if (counts && (r.status === 'FAIL' || r.status === 'NOT RUN')) failed = true
  }

  // Control (see createControl). Stopping, skipping and the deadline all end a running check the same way: stop its process tree, settle it, free its slot.
  let stopping = false
  let resolveDone = () => {}
  let pump = () => {}
  let deadlineTimer = null
  const endRunning = (c, r, ms, counts) => {
    const rec = running.get(c.id)
    if (!rec) return
    running.delete(c.id)
    if (c.lane === 'free') freeRunning--
    else if (c.lane === 'windows') windowsRunning--
    else laneBusy[c.lane] = false
    used.delete(c.id)
    if (isAlone(c)) aloneRunning = false
    settle(c, r, ms, counts)
  }
  const skipOne = (id) => {
    const rec = running.get(id)
    if (!rec) return false
    const ms = Date.now() - rec.startedAt
    for (const e of rec.entries) e.kill('skipped')
    endRunning(rec.check, { status: 'NOT RUN', detail: `skipped by you after ${clock(ms)}` }, ms, false)
    pump()
    return true
  }
  const finishRun = () => {
    clearTimeout(deadlineTimer)
    control?.bind(null)
    resolveDone()
  }
  // `verb` is the words for the detail: "interrupted by you", or "run deadline reached".
  const stop = (verb) => {
    if (stopping) return
    stopping = true
    for (const rec of [...running.values()]) {
      const ms = Date.now() - rec.startedAt
      for (const e of rec.entries) e.kill('stopped')
      endRunning(rec.check, { status: 'NOT RUN', detail: `${verb} after ${clock(ms)}` }, ms, true)
    }
    for (const c of pending.splice(0)) settle(c, { status: 'NOT RUN', detail: `${verb} before it started` }, 0)
    finishRun()
  }
  const api = {
    runningIds: () => [...running.values()].map((rec) => ({ id: rec.check.id, lane: rec.check.lane, startedAt: rec.startedAt, estSeconds: rec.check.estSeconds ?? null, lastOutputAt: rec.entries.size ? Math.max(...[...rec.entries].map((e) => e.lastOutputAt)) : null })).sort((a, b) => a.startedAt - b.startedAt),
    skip: (id) => skipOne(id),
    skipAll: () => {
      let n = 0
      for (const id of [...running.keys()]) if (skipOne(id)) n++
      return n
    },
    stop,
  }
  if (deadlineMs > 0) deadlineTimer = setTimeout(() => {
    noteStopReason('time limit')
    log(`run deadline reached after ${clock(deadlineMs)}: the checks still running are stopped and the rest are not run`)
    stop('run deadline reached')
  }, deadlineMs)

  await new Promise((resolve) => {
    resolveDone = resolve
    control?.bind(api)
    pump = () => {
      if (stopping) return
      // Resolve anything that can no longer start.
      for (let i = 0; i < pending.length; ) {
        const c = pending[i]
        const deps = (c.after ?? []).filter((d) => ids.has(d))
        const badDep = deps.find((d) => results.has(d) && results.get(d).status !== 'PASS')
        if (!selfTest && strikes.isSkipped(toolOf(c))) {
          pending.splice(i, 1)
          settle(c, { status: 'NOT RUN', broken: true, detail: strikes.detail(toolOf(c)) }, 0, false)
        } else if (!keepGoing && failed && !selfTest) {
          pending.splice(i, 1)
          settle(c, { status: 'NOT RUN', detail: 'stopped after the first failure (use --keep-going)' }, 0)
        } else if (badDep) {
          pending.splice(i, 1)
          settle(c, { status: 'NOT RUN', detail: `needs ${badDep}, which did not pass` }, 0)
        } else i++
      }
      const waiting = []
      // The first check (the longest, by the order orderForSpeed gave) that is ready and has its lane but not the machine room it needs. While it waits,
      // nothing behind it starts: otherwise a stream of small checks keeps the machine full and a build that takes minutes would run last and alone.
      let reserved = null
      let reservedCheck = null
      for (let i = 0; i < pending.length; ) {
        const c = pending[i]
        const ready = (c.after ?? []).every((d) => !ids.has(d) || results.has(d))
        const laneFree = c.lane === 'free' ? freeRunning < parallel : c.lane === 'windows' ? windowsRunning < (budget?.maxWindows ?? 3) : !laneBusy[c.lane]
        const roomLeft = ready && laneFree ? fits(c) : true
        if (!ready || !laneFree || !roomLeft) {
          // Say why it waits, so a long pause reads as "queued behind X", not as a hang.
          const unmet = (c.after ?? []).filter((d) => ids.has(d) && !results.has(d))
          waiting.push({ id: c.id, reason: !ready ? `after ${unmet.join(', ')}` : !laneFree ? (c.lane === 'free' ? `all ${parallel} parallel slots busy` : c.lane === 'windows' ? `${windowsRunning} windows already open` : `the ${c.lane} lane is busy`) : 'waiting for free processor or memory' })
          if (ready && laneFree && !roomLeft && !reserved) {
            reserved = c.id
            reservedCheck = c
          }
          i++
          continue
        }
        if (reserved && !canBackfill(c, shadowSeconds(costOf(reservedCheck), running.values(), budget))) {
          waiting.push({ id: c.id, reason: `held back so ${reserved} can start as soon as the running checks finish` })
          i++
          continue
        }
        pending.splice(i, 1)
        if (c.lane === 'free') freeRunning++
        else if (c.lane === 'windows') windowsRunning++
        else laneBusy[c.lane] = true
        used.set(c.id, costOf(c))
        if (isAlone(c)) aloneRunning = true
        log(`[start  ] ${c.id}: ${c.title}${c.estSeconds ? ` (about ${c.estSeconds}s)` : ''}`)
        hooks.start?.(c)
        progressCheckStart(c.id)
        const t0 = Date.now()
        const rec = { check: c, startedAt: t0, entries: new Set() }
        running.set(c.id, rec)
        const runCtx = { ...ctx, progressFiles, onSpawn: (e) => rec.entries.add(e), ...(hooks.output ? { onLine: (line) => hooks.output(c, line) } : {}), ...(hooks.progress ? { onProgress: (p) => hooks.progress(c, p) } : {}) }
        runOne(c, runCtx, { selfTest })
          .catch((e) => ({ status: 'FAIL', detail: String(e?.message ?? e), broken: true, brokenError: String(e?.message ?? e) }))
          .then((r) => {
            // Already ended by a skip or a stop: its late result is ignored.
            if (running.get(c.id) !== rec) return
            if (!selfTest) {
              const tool = toolOf(c)
              if (r.broken) {
                const s = strikes.strike(tool, r.brokenError ?? r.detail)
                r = { ...r, detail: `BROKEN (strike ${s.strikes} of 2): ${r.detail}` }
              } else if (r.status === 'PASS') strikes.pass(tool)
            }
            endRunning(c, r, Date.now() - t0, true)
            pump()
          })
      }
      hooks.queue?.(waiting)
      if (!pending.length && !running.size) finishRun()
    }
    pump()
  })
  clearTimeout(deadlineTimer)
  closeInprocPool()
  return checks.map((c) => results.get(c.id))
}

export function summarise(tier, results, skipped, totalMs, estimateText = '') {
  const n = (s) => results.filter((r) => r.status === s).length
  const failed = n('FAIL')
  const notRun = n('NOT RUN')
  const unconfigured = n('SKIPPED')
  // `estimateText` ("estimated about 40 s, took 38.1s", lib/runestimate.mjs) is added in brackets when the run had an estimate.
  const line = `MEERKAT ${tier}: ${n('PASS')} passed, ${failed} failed, ${notRun} not run, ${unconfigured ? `${unconfigured} not configured, ` : ''}${skipped} skipped in ${(totalMs / 1000).toFixed(1)}s${estimateText ? ` (${estimateText})` : ''}`
  return { line, exitCode: failed === 0 && notRun === 0 ? 0 : 1 }
}

// The end-of-run list. Above 24 checks (see lib/tui/group.mjs) the passed ones fold into one line per kind; every FAIL and NOT RUN
// stays on its own line. `grouped: false` (--flat) restores one line per check. Display only.
export function table(results, { checks = [], grouped, spans = null } = {}) {
  const cats = groupResults(results, { checks, grouped, spans })
  if (cats) {
    const w = Math.max(...cats.map((c) => c.label.length))
    const head = cats.map((c) => `${(c.tone === 'FAIL' ? 'FAIL' : c.tone === 'NOT RUN' ? 'NOT RUN' : 'PASS').padEnd(7)}  ${c.label.padEnd(w)}  ${c.suite ? `${c.total} checks, ${c.subTotal} sub-checks`.padEnd(30) : `${String(c.total).padStart(3)} checks`}  ${countsText(c.counts).replace(/  0 running  0 waiting$/, '')}  [ ${timeText(c, (ms) => `${(ms / 1000).toFixed(1)}s`)} ]`)
    const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'NOT RUN')
    return [...head, ...(bad.length ? [''] : []), ...bad.map((r) => `${r.status.padEnd(7)}  ${r.id}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.detail ?? ''}`)].join(String.fromCharCode(10))
  }
  const w = Math.max(4, ...results.map((r) => r.id.length))
  return results
    .map((r) => `${r.status.padEnd(7)}  ${r.id.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.detail ?? ''}`)
    .join('\n')
}
