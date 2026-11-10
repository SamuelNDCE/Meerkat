// `meerkat verdict` (one line for a branch) and `meerkat top` (one table of the worst findings in the changed files). Both run the gate on the
// folder (lib/gate.mjs gatherGate) and read its rows; neither starts a check of its own.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { defaultSeverity, isSeverity, SEVERITY_RANK } from './findings.mjs'
import { EXIT, firstBlocking, gatherGate } from './gate.mjs'
import { lockWaitOf, waitingLine } from './lockwait.mjs'
import { layoutClassOf } from './gatepaths.mjs'
import { headOf, readResume, resumedArgs, resumeLine, saveResume } from './resume.mjs'
import { recordBranchResult } from './memorybranch.mjs'
import { FORMATS, rangeInfo, rangeLine, rerunCommand, strictLine, VERDICT_JSON_SCHEMA } from './verdict-out.mjs'
import { runExplain } from './verdict-explain.mjs'
import { BEHIND_LIMIT } from './gate.mjs'
import { VERDICT_EXIT, exitName, verdictWord, statusFields } from './exitcodes.mjs'
import { dataDir } from './datadir.mjs'
import { basename } from 'node:path'
import { blockLines, collectReport, githubReport, headline, headlineFromLine, logInternalError, markdownReport, stateLines } from './verdict-report.mjs'
import { baseInfo, baseLineOf, failedCheckIds, readFailedRecord, timingLines, timingRows, writeFailedRecord, checkRows, writeVerdictSummary, checkCounts } from './verdict-extra.mjs'
import { cacheHome } from './resultcache.mjs'

// A crashed check is a tool problem (TOOL PROBLEM), never a finding in the code, so it is not "failing" here.
const failing = (r) => r.kind === 'fail'

// { blocking, preExisting }: blocking = findings in files the branch changed; preExisting = findings in code it did not change (other files,
// and findings that were already on the base). Layout notes (a missing lockfile, say) are not code and count for neither.
export function verdictCounts(out) {
  let blocking = 0
  let preExisting = out.hidden ?? 0
  let wide = 0
  let unknown = 0
  let toolProblems = 0
  for (const r of out.rows ?? []) {
    if (r.kind === 'crash') toolProblems++
    // The base comparison did not finish: a failing place cannot be told apart from one already on the base, so it is unknown, not blocking.
    if (r.kind === 'fail' && out.baseState === 'unfinished' && r.places?.length) unknown += r.places.length
    else if (failing(r)) blocking += r.places?.length || r.findings?.length || 1
    if (r.kind === 'fail') preExisting += r.outside ?? 0
    // A check whose findings are all in untouched files is listed as project-wide; its places are pre-existing code, except for layout/history checks (a missing lockfile is not code).
    // Findings outside the diff (kind wide) are listed as pre-existing, not in this diff, and never fail the verdict.
    if (r.kind === 'wide' && !layoutClassOf(r.id)) wide += r.places?.length ?? 0
  }
  return { blocking, preExisting, wide, unknown, toolProblems }
}

export function verdictLine({ blocking, preExisting, toolProblems = 0, unknown = 0 }) {
  // A crashed check or a tool problem is never a pass: with no real finding the line is INCOMPLETE (status 503), whatever else is clean.
  if (blocking === 0 && toolProblems > 0) return `INCOMPLETE ${toolProblems} check(s) crashed or their tool failed (status 503), not a pass`
  if (blocking === 0 && unknown > 0) return `INCOMPLETE ${unknown} finding(s) could not be classified as new or pre-existing (status 206), not a pass`
  if (blocking > 0) return `FAIL ${blocking} blocking in changed files`
  if (preExisting > 0) return `FAIL-PRE-EXISTING only: ${preExisting} findings in code this branch did not change`
  return 'PASS'
}

// Never silent: a run with no result prints one line naming the reason and the next step. Exit 2 for a usage or environment problem (a bad base ref,
// not a git repo), 1 when there is simply no result (nothing changed, no check could run, the run timed out).
const noResult = (out, reason, next, code) => {
  out(`NO-RESULT: ${reason}. next: ${next}`)
  return code
}

// The extra status fields of every verdict answer (lib/exitcodes.mjs): status, statusText and, for a run that stopped early, incompleteReason and notRun.
const statusDoc = (exitCode, verdict, info = {}) => ({
  ...statusFields({ ...info, exitCode, verdict }),
  ...(info.incompleteReason ? { incompleteReason: info.incompleteReason, notRun: info.notRun ?? 'unknown' } : {}),
})

// Why a run stopped early, read from the rows that did not run. The order matters: a held lock, an interruption, the time limit, a missing tool, else unfinished.
const TOOL_MISSING = /not installed|not found on (?:the )?path|command not found|ENOENT|failed to start|could not start/i
function incompleteInfo(rows = []) {
  const notrun = rows.filter((r) => r.kind === 'notrun')
  const has = (re) => notrun.some((r) => re.test(String(r.detail ?? '')))
  const incompleteReason = lockWaitOf(rows) ? 'lock-held' : has(/interrupted by you/) ? 'interrupted' : has(/run deadline reached/) ? 'timeout' : has(TOOL_MISSING) ? 'tool-missing' : 'check-unfinished'
  return { incompleteReason, notRun: notrun.length }
}
// Every blocking place as "file:line check: message"; past 20 only the first 20 and a count.
export function printPlaces(out, rows, max = 20) {
  for (const r of rows.slice(0, max)) out(`  ${r.file}${r.line ? ':' + r.line : ''} ${r.check}: ${String(r.message ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
  if (rows.length > max) out(`  ... and ${rows.length - max} more (meerkat top --base <ref> lists all)`)
}
export const DEFAULT_VERDICT_SECONDS = 1500 // long enough for the scoped rust-test run (its own limit is 1200 s)
export const HARD_SECONDS = (env) => (Number(env.MEERKAT_VERDICT_TIMEOUT_S) > 0 ? Number(env.MEERKAT_VERDICT_TIMEOUT_S) : DEFAULT_VERDICT_SECONDS)

// --resume <file>: { args, resume } for gather, or { error }. The saved folder and options are used; the person may add the time limit.
function prepareResume(file, rest, cwd) {
  if (!file) return { error: '--resume needs the resume file a stopped run printed' }
  const saved = readResume(file, cwd)
  if (saved.error) return { error: saved.error }
  const again = resumedArgs(saved.doc, rest, cwd)
  return again.error ? { error: again.error } : { args: again.args, resume: { doc: saved.doc } }
}

// verdict and top record their result in the branch's memory (lib/memorybranch.mjs). A failed write is one line on stderr, never a changed result.
function remember(info, err) {
  const r = recordBranchResult(info)
  if (!r.ok) err(`note: the branch memory was not saved (${r.reason})`)
}

// Runs the gate with a time limit. Returns { g } or { stop: <exit code> } after printing the reason.
async function gather(word, argv, { env, cwd, out, err, resume = null, entries = null, allowStale = false }) {
  let timer
  const limit = HARD_SECONDS(env)
  const timeout = new Promise((res) => {
    timer = setTimeout(() => res({ timedOut: true }), (limit + 30) * 1000) // backstop only: the gate itself stops at the limit and keeps its partial results
    timer.unref?.()
  })
  const partial = {}
  let g
  try {
    g = await Promise.race([gatherGate(argv, { env, cwd, err, progress: err, maxSeconds: limit, partial, resume }), timeout])
  } catch (e) {
    clearTimeout(timer)
    if (word === 'verdict') throw e // an exception inside Meerkat: runVerdict logs it, answers status 500 in one line and never prints a stack
    return { stop: noResult(out, `the gate failed to run (${String(e?.message ?? e).split(String.fromCharCode(10))[0].slice(0, 120)})`, `run meerkat gate --no-input to see the full error`, 1), info: { internal: true } }
  }
  clearTimeout(timer)
  // The stale-base refusal applies to every outcome, including a partial run: a partial run on an old base is not a verdict either.
  const behind = g.error ? null : commitsBehind(g.repoRoot, g.changed?.ref)
  if (!allowStale && behind !== null && behind > BEHIND_LIMIT) {
    out(`STALE: ${g.changed?.ref} is ${behind} commits ahead of this branch (more than ${BEHIND_LIMIT}). next: rebase onto ${g.changed?.ref}, or pass --allow-stale to accept an old base`)
    return { stop: VERDICT_EXIT.stale }
  }
  if (g.timedOut && partial.done?.length) {
    // The backstop fired before the gate could report: say what had finished, with every blocking place that is known.
    const bad = partial.done.filter((r) => r.status === 'FAIL')
    out(`INCOMPLETE ${partial.done.length} of ${partial.total} checks finished, ${bad.length} blocking check(s) so far (not a pass)`)
    out('unclassified (base comparison did not finish): these may already exist on the base, do not read them as new')
    printPlaces(out, bad.flatMap((r) => (partial.sink?.get(r.id)?.findings ?? []).map((x) => ({ file: x.file ?? '(no file)', line: x.line ?? 0, check: r.id, message: x.message ?? '' })).concat(partial.sink?.get(r.id)?.findings?.length ? [] : [{ file: '(no file)', line: 0, check: r.id, message: r.detail }])))
    out(resumeLine(word, { reason: 'the gate did not report in time, so the finished results are not complete enough to carry over. Run it again with MEERKAT_VERDICT_TIMEOUT_S raised' }))
    return { stop: VERDICT_EXIT.incomplete, info: { incompleteReason: 'timeout', notRun: Number.isFinite(partial.total) ? partial.total - partial.done.length : 'unknown' } }
  }
  if (g.timedOut) return { stop: noResult(out, `the gate did not finish in ${limit}s`, `run meerkat gate in the background, or raise MEERKAT_VERDICT_TIMEOUT_S`, 1), info: { incompleteReason: 'timeout', notRun: 'unknown' } }
  if (!g.error && g.out?.stoppedEarly) {
    const rows = g.out.rows ?? []
    const left = rows.filter((r) => r.kind === 'notrun' && /run deadline reached|interrupted by you/.test(r.detail ?? '')).length
    const kn = entries ? applyKnown(g.out, entries) : null
    const blockingNow = kn ? kn.blocking : verdictCounts(g.out).blocking
    const unknownNow = kn ? kn.unknown : verdictCounts(g.out).unknown
    const cnt = checkCounts(g.out)
    out(`INCOMPLETE ${cnt.checksFinished} of ${cnt.checksTotal} checks finished, ${blockingNow} blocking so far (not a pass)`)
    const skipped = rows.filter((r) => r.kind === 'notrun' && /run deadline reached|interrupted by you/.test(r.detail ?? '')).map((r) => r.id)
    if (skipped.length) out(`not run (${skipped.length}): ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ` and ${skipped.length - 20} more` : ''}`)
    // One explicit line for the base comparison, so a reader never has to infer it from silence.
    out(g.out.baseState === 'done' ? 'base comparison: finished' : g.out.baseState === 'unfinished' ? 'base comparison: NOT finished (the findings below are not yet told apart from the base)' : 'base comparison: not needed (no base to compare)')
    if (g.out.baseState === 'unfinished') out(`unclassified (base comparison did not finish): ${unknownNow} finding(s) may already exist on ${g.changed?.ref ?? 'the base'}, they are not counted as blocking`)
    // --known applies to the partial result too: a place the team accepted is shown as known, not as blocking.
    const isKnown = (pl) => !!entries && entries.some((e) => e.check === pl.check && e.file === pl.file && (e.line === undefined || e.line === pl.line))
    const rowsShown = topRows(g.out, g.checks).filter((r) => !isKnown({ file: r.file, line: r.line, check: r.check ?? r.id }))
    if (kn) out(`known: ${kn.known.length} place(s) match the --known file and are not counted`)
    printPlaces(out, rowsShown)
    // The finished checks are kept, so the next run does only the rest.
    const saved = saveResume({ out: g.out, word, args: argv, cwd, changed: g.changed, repoRoot: g.repoRoot, appDir: g.appDir, key: g.key })
    out(resumeLine(word, saved))
    return { stop: VERDICT_EXIT.incomplete, info: incompleteInfo(rows), resume: saved.file ? { file: saved.file } : null, summary: { blocking: blockingNow, unknown: unknownNow, baseState: g.out.baseState ?? null, known: kn?.known ?? [], stale: kn?.stale ?? [], behindBy: commitsBehind(g.repoRoot, g.changed?.ref), checks: checkRows(g.out), skippedByPath: Array.isArray(g.out?.skipped) ? g.out.skipped : [] } }
  }
  // A lock wait is not a result and not a failed run: one WAITING line, exit 75.
  const lockWait = !g.error && !g.timedOut ? lockWaitOf(g.out?.rows) : null
  if (lockWait) {
    out(waitingLine(lockWait, env))
    // The counts and rows travel in the summary so the --json reader gets the same checks as every other verdict.
    return { stop: VERDICT_EXIT.incomplete, info: incompleteInfo(g.out?.rows), summary: { blocking: 0, known: [], stale: [], ...checkCounts(g.out), checks: checkRows(g.out), lockHolder: lockWait.pid ?? null } }
  }
  if (g.error && g.resumeRefused) return { stop: noResult(out, `--resume refused: ${g.error}`, `run meerkat ${word} without --resume to start again`, 2) }
  if (g.error) {
    const ref = /git does not know that ref|share no history|no base to compare/.test(g.error)
    const nope = /not inside a git work tree|git was not found/.test(g.error)
    const notFound = ref || /not inside a git work tree|config.*(?:not found|no such)/i.test(g.error)
    const info = /git was not found/.test(g.error) ? { incompleteReason: 'tool-missing', notRun: 'unknown' } : { notFound }
    return { stop: noResult(out, g.error.slice(0, 200), ref ? 'pass a base that exists, for example --base origin/main' : nope ? 'run it inside a git repository' : `see meerkat ${word} --help`, ref ? VERDICT_EXIT.noResult : 2), info }
  }
  if (!g.out.files?.length && word === 'verdict') {
    const base = g.changed.ref ?? 'the base'
    const here = spawnSync('git', ['-C', g.repoRoot, 'branch', '--show-current'], { encoding: 'utf8' }).stdout?.trim()
    // "already on main" is only true when the checked-out branch IS the base; a branch that merely equals it has no diff.
    out(here && here === base ? `PASS: already on ${base} (no diff to judge)` : `PASS: no diff against ${base} (nothing to judge)`)
    return { stop: 0 }
  }
  if (!g.out.files?.length) return { stop: noResult(out, `nothing changed compared with ${g.changed.ref ?? 'the base'}, so there is nothing to judge`, 'commit or save a change, or pass --base <ref> to compare with another ref', word === 'top' ? EXIT.usage : VERDICT_EXIT.noResult) }
  if (!g.out.rows?.length) return { stop: noResult(out, g.out.note || 'no check could run on the changed files', 'run meerkat doctor, or meerkat gate --verbose', word === 'top' ? EXIT.usage : VERDICT_EXIT.noResult) }
  return { g }
}

// --known <file>: pre-existing failures a team has accepted, [{ check, file, line? }] (or { "known": [...] }). A finding that matches is KNOWN, not blocking.
export function readKnown(file, cwd) {
  let doc
  try {
    const text = readFileSync(resolve(cwd, file), 'utf8')
    // A zero-byte (or blank) file is an empty list, not invalid JSON.
    doc = text.trim() === '' ? [] : JSON.parse(text)
  } catch (e) {
    return { error: e?.code === 'ENOENT' ? `the --known file ${file} does not exist` : `the --known file ${file} is not valid JSON` }
  }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.known) ? doc.known : null
  if (!list) return { error: `the --known file ${file} must be a JSON list of { "check", "file" } entries` }
  const entries = []
  for (const [i, e] of list.entries()) {
    if (!e || typeof e.check !== 'string' || !e.check || typeof e.file !== 'string' || !e.file || (e.line !== undefined && !Number.isInteger(e.line))) return { error: `the --known file ${file}: entry ${i + 1} needs a string "check", a string "file" and, optionally, an integer "line"` }
    entries.push({ check: e.check, file: e.file.replace(/\\/g, '/'), ...(e.line !== undefined ? { line: e.line } : {}) })
  }
  return { entries }
}

// { blocking, known: [{check,file,line}], stale: [entry] }: blocking places that no entry matches, the ones an entry matches, and the entries that matched nothing.
export function applyKnown(out, entries) {
  const used = new Set()
  const known = []
  let blocking = 0
  let unknown = 0
  const unfinished = out.baseState === 'unfinished'
  const hits = (id, p) => entries.map((e, i) => (e.check === id && e.file === p.file && (e.line === undefined || e.line === p.line) ? i : -1)).filter((i) => i >= 0)
  for (const r of out.rows ?? []) {
    if (failing(r)) {
      // A row with no places still names its files in the findings: match those, so a known finding is not counted as blocking.
      const places = r.places?.length ? r.places : (r.findings ?? []).filter((f) => f?.file).map((f) => ({ file: String(f.file).replace(/\\/g, '/'), line: Number(f.line) || 0 }))
      if (!places.length) { blocking += r.findings?.length || 1; continue }
      for (const p of places) {
        const h = hits(r.id, p)
        h.forEach((i) => used.add(i))
        if (h.length) known.push({ check: r.id, file: p.file, line: p.line })
        else if (unfinished && r.kind === 'fail') unknown++
        else blocking++
      }
    } else if (r.kind === 'wide') for (const p of r.places ?? []) hits(r.id, p).forEach((i) => used.add(i))
  }
  // A place the base comparison hid (it is on the base) still counts as known when an entry names it, so the count does not depend on whether the comparison ran.
  for (const p of out.hiddenPlaces ?? []) {
    const h = hits(p.check, p)
    h.forEach((i) => used.add(i))
    if (h.length) known.push({ check: p.check, file: p.file, line: p.line, preExisting: true })
  }
  return { blocking, known, unknown, stale: entries.filter((_, i) => !used.has(i)) }
}

// The public entry. An unexpected exception inside Meerkat is status 500: one line on the terminal, the detail in a log file, never a stack trace.
export async function runVerdict(argv, opts = {}) {
  const { env = process.env, out = (t) => process.stdout.write(`${t}\n`) } = opts
  try {
    return await runVerdictInner(argv, opts)
  } catch (e) {
    const bad = logInternalError(e, { env, argv })
    const code = VERDICT_EXIT.incomplete
    if (argv.includes('--json')) out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: 'INCOMPLETE', exitCode: code, exitName: exitName(code), ...statusFields({ exitCode: code, verdict: 'INCOMPLETE', internal: true }), headline: bad.line, next: 'meerkat doctor', blocking: 0, known: 0, stale: [], blocks: [], reason: bad.short, log: bad.file }, null, 2))
    else out(bad.line)
    return code
  }
}

async function runVerdictInner(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`), memory = true } = {}) {
  const started = Date.now()
  const rest = []
  let resumeFile = null
  let knownFile = null
  let json = false
  let first = false
  let ready = false
  let bad = null
  let format = 'text'
  let since = null
  let explainId = null
  let strict = false
  let timings = false
  let allowStale = false
  let rerunFailed = false
  let onlyChecksArg = null
  const original = [...argv]
  const branches = []
  const plain = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ready') {
      ready = true
      continue
    }
    if (a === '--branches') {
      // Names may be comma-separated or space-separated (--branches main feature x): take every value up to the next flag, so a later name is never mistaken for the folder.
      const vals = []
      while (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('-')) vals.push(argv[++i])
      branches.push(...vals.join(',').split(',').map((b) => b.trim()).filter(Boolean))
      continue
    }
    if (a === '--branch') {
      if (argv[i + 1]) branches.push(argv[++i])
      continue
    }
    plain.push(a)
  }
  if (branches.length) return runVerdictBatch(plain, branches, { env, cwd, out, err })
  argv = plain
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--resume') resumeFile = argv[++i] ?? ''
    else if (a === '--first') first = true
    else if (a === '--known') knownFile = argv[++i] ?? ''
    else if (a === '--format') format = argv[++i] ?? ''
    else if (a === '--since') since = argv[++i] ?? ''
    else if (a === '--explain') explainId = argv[++i] ?? ''
    else if (a === '--strict') strict = true
    else if (a === '--timings') timings = true
    else if (a === '--allow-stale') allowStale = true
    else if (a === '--rerun-failed') rerunFailed = true
    else if (a === '--only-checks') onlyChecksArg = argv[++i] ?? ''
    else if (a.startsWith('-') && !['--base', '--app', '--no-cache', '--max-seconds'].includes(a) && argv[i - 1] !== '--base' && argv[i - 1] !== '--app') bad ??= a
    else rest.push(a)
  }
  const lines = []
  const emit = (t) => lines.push(t)
  const stopWith = (code, verdict, reason, extra = {}) => {
    if (json) out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict, exitCode: code, blocking: 0, known: 0, stale: [], reason, ...extra }, null, 2))
    return code
  }
  const noRes = (reason, next, code, info = {}) => {
    const doc = statusDoc(code, 'NO-RESULT', info)
    noResult(json ? emit : (t) => out(headlineFromLine(t, doc.status)), reason, next, code)
    return stopWith(code, 'NO-RESULT', `${reason}. next: ${next}`, doc)
  }
  if (bad) return noRes(`unknown option ${bad}`, 'usage: meerkat verdict [folder] [--base <ref> | --since <ref>] [--known <file>] [--json | --format markdown|github] [--strict] [--explain <finding-id>]', EXIT.usage)
  const usage = (reason) => noRes(reason, 'usage: meerkat verdict [folder] [--base <ref> | --since <ref>] [--format markdown|github] [--strict] [--explain <finding-id>]', EXIT.usage)
  if (explainId !== null) {
    const skip = ['--base', '--since', '--app', '--max-seconds', '--known', '--format']
    const folder = rest.find((a, i) => !a.startsWith('-') && !skip.includes(rest[i - 1]))
    return runExplain(explainId, { folder: folder ?? null, env, cwd, out, err })
  }
  if (rerunFailed && (resumeFile !== null || knownFile !== null || first || ready)) return usage('--rerun-failed cannot be used with --resume, --known, --first or --ready')
  if (!FORMATS.includes(format)) return usage(`--format must be markdown, github or text, not "${format}"`)
  if (format !== 'text' && json) return usage('--format and --json cannot be used together')
  if ((first || ready) && (format !== 'text' || strict)) return usage('--first and --ready print their own single line, so --format and --strict do not apply to them')
  if (since !== null) {
    if (!since || since.startsWith('-')) return usage('--since needs a ref, for example --since origin/main')
    if (rest.includes('--base')) return usage('--since and --base both name the comparison ref: use one')
    rest.push('--base', since)
  }
  let entries = null
  if (knownFile !== null) {
    const k = knownFile ? readKnown(knownFile, cwd) : { error: '--known needs a file' }
    if (k.error) return noRes(k.error, 'pass a JSON list such as [{ "check": "js-eqeqeq", "file": "src/a.js" }]', EXIT.usage, { notFound: /does not exist/.test(k.error) })
    entries = k.entries
  }
  let gateArgs = rest
  let resume = null
  if (resumeFile !== null) {
    const p = prepareResume(resumeFile, rest, cwd)
    if (p.error) return noRes(p.error, 'run meerkat verdict without --resume to start again', EXIT.usage)
    ;({ args: gateArgs, resume } = p)
  }
  // --rerun-failed: only the checks that failed in the last verdict of this folder and base (the record is per folder and base ref).
  const flagVal = (name) => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const skipVals = ['--base', '--app', '--max-seconds']
  const folderArg = flagVal('--app') ?? rest.find((a, i) => !a.startsWith('-') && !skipVals.includes(rest[i - 1])) ?? '.'
  const recordFile = join(cacheHome(env), 'verdict-last.json')
  const recordKey = `${resolve(cwd, folderArg)}|${flagVal('--base') ?? '(default base)'}`
  let rerunIds = null
  if (rerunFailed) {
    const rec = readFailedRecord(recordFile, recordKey)
    if (!rec) return noRes('--rerun-failed found no earlier verdict run for this folder and base', 'run meerkat verdict once (with the same --base) so there is a run to repeat', 1, { notFound: true })
    if (!rec.failed.length) {
      const msg = `RERUN-FAILED: the last verdict for this folder and base (${String(rec.commit ?? '').slice(0, 12)}) had no failing checks, so nothing was run again. next: meerkat verdict`
      if (json) out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: 'PASS', exitCode: 0, ...statusDoc(0, 'PASS'), blocking: 0, known: 0, stale: [], reason: msg, rerunFailed: [] }, null, 2))
      else out(`${msg} [200]`)
      return 0
    }
    rerunIds = rec.failed
  }
  // With --known the team's list replaces the base comparison, so every finding in a changed file is judged against the list.
  const r = await gather('verdict', [...gateArgs, ...(rerunIds ? ['--only-checks', rerunIds.join(',')] : onlyChecksArg ? ['--only-checks', onlyChecksArg] : [])], { env, cwd, out: emit, err, resume, entries, allowStale })
  if (r.stop !== undefined) {
    const pass = lines.find((l) => l.startsWith('PASS:'))
    if (pass && json) {
      out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: 'PASS', exitCode: 0, ...statusDoc(0, 'PASS'), blocking: 0, known: 0, stale: [], reason: pass }, null, 2))
      return 0
    }
    const first = lines.find((l) => l.startsWith('NO-RESULT') || l.startsWith('STALE') || l.startsWith('INCOMPLETE') || l.startsWith('WAITING'))?.replace(/^NO-RESULT: /, '') ?? 'no result'
    // The verdict word and the exit code must agree: 75 is INCOMPLETE, 4 is STALE, 3 is NO-RESULT. The counts come from the same data as the text output.
    const word = r.stop === 0 ? 'PASS' : r.stop === VERDICT_EXIT.incomplete ? 'INCOMPLETE' : r.stop === VERDICT_EXIT.stale ? 'STALE' : 'NO-RESULT'
    const sum = r.summary ?? { blocking: 0, known: [], stale: [] }
    const info = word === 'INCOMPLETE' && !r.info?.incompleteReason ? { incompleteReason: 'unknown', notRun: 'unknown' } : (r.info ?? {})
    const doc = statusDoc(r.stop, word, info)
    // One report from the checks the run knows about: what did not finish, what could not run, what crashed.
    const stopReport = collectReport({ rows: (sum.checks ?? []).map((c) => ({ id: c.check, kind: c.status, detail: c.detail })) }, { base: null })
    const counted = /(\d+) of (\d+) checks finished/.exec(lines[0] ?? '')
    if (counted && !stopReport.notFinished.count) stopReport.notFinished = { count: Number(counted[2]) - Number(counted[1]), total: Number(counted[2]), ids: [] }
    const resumeCmd = (lines.find((l) => l.startsWith('resume: ')) ?? '').replace(/^resume: /, '') || null
    const head = word === 'PASS'
      ? `${headlineFromLine(lines[0] ?? 'PASS', doc.status)}. Next: nothing to fix`
      : word === 'INCOMPLETE'
        ? headline({ kind: 'INCOMPLETE', status: doc.status, reason: info.incompleteReason, notFinished: stopReport.notFinished, toolProblems: stopReport.toolProblems.length, next: resumeCmd ?? 'meerkat verdict --resume' })
        : headlineFromLine(lines[0] ?? first, doc.status)
    if (!json) {
      out(head)
      for (const l of stateLines(stopReport, { resumeCommand: resumeCmd })) out(l)
      // The detail lines stay under the headline (counts, what did not run, the unclassified note, the resume command). NO-RESULT and STALE are one line: the headline is that line.
      if (word === 'INCOMPLETE') lines.forEach((l) => out(l))
      else lines.slice(1).forEach((l) => out(l))
      return r.stop
    }
    {
      out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: word, exitCode: r.stop, exitName: exitName(r.stop), ...doc, headline: head, next: resumeCmd ?? null, blocking: sum.blocking, preExisting: null, known: sum.known.length, knownFindings: sum.known, stale: sum.stale, unmatchedKnown: sum.stale, ...(sum.baseState ? { baseState: sum.baseState, unknown: sum.unknown ?? 0 } : {}), behindBy: sum.behindBy ?? null, checks: sum.checks ?? [], checksTotal: sum.checksTotal ?? null, checksFinished: sum.checksFinished ?? null, ...(sum.lockHolder !== undefined ? { lockHolder: sum.lockHolder } : {}), skippedByPath: sum.skippedByPath ?? [], blocks: [], toolProblems: stopReport.toolProblems, notFinished: stopReport.notFinished, notRun: stopReport.notRun, reason: first, ...(r.resume ? { resume: r.resume.file } : {}) }, null, 2))
      return r.stop
    }
  }
  const c = verdictCounts(r.g.out)
  const baseNow = baseInfo(r.g.changed)
  err(baseLineOf(baseNow))
  {
    const why = writeFailedRecord(recordFile, recordKey, failedCheckIds(r.g.out), headOf(r.g.repoRoot))
    if (why) err(`note: the failed-check record was not saved (${why}), so --rerun-failed has nothing to repeat`)
  }
  const rerunNote = rerunIds ? `rerun-failed: ran only the ${rerunIds.length} check(s) that failed last time: ${rerunIds.join(', ')}` : null
  // Past 60 seconds the per-check table is shown without asking: a slow run is where the time goes.
  const timingExtra = () => (!json && (timings || Date.now() - started > 60000) ? timingLines(r.g.out) : [])
  const keep = (blocking, line) => memory && remember({ env, repoRoot: r.g.repoRoot, source: 'verdict', line, exit: blocking > 0 ? 1 : 0, commit: headOf(r.g.repoRoot), blocking, preExisting: c.preExisting + (c.wide ?? 0) }, err)
  if (first) {
    keep(c.blocking, c.blocking > 0 ? verdictLine({ blocking: c.blocking, preExisting: c.preExisting }) : c.toolProblems > 0 ? verdictLine(c) : 'PASS')
    const f = firstBlocking(r.g.out)
    if (!f && c.toolProblems > 0) {
      out(verdictLine(c))
      return VERDICT_EXIT.incomplete
    }
    out(f ? `${f.file}${f.line ? ':' + f.line : ''}: ${f.message}`.replace(/[ ]{2,}/g, ' ') + ' (status 422)' : 'PASS (status 200)')
    return f ? 1 : 0
  }
  let blocking = c.blocking
  let known = []
  let stale = []
  let unknown = c.unknown ?? 0
  if (entries) ({ blocking, known, stale, unknown } = applyKnown(r.g.out, entries))
  const baseState = r.g.out.baseState ?? null
  // A branch far behind its base can pass only against an old base: refuse unless --allow-stale says the reader accepts that.
  const behindBy = commitsBehind(r.g.repoRoot, r.g.changed?.ref)
  if (!allowStale && behindBy !== null && behindBy > BEHIND_LIMIT) {
    const text = `STALE: ${r.g.changed?.ref} is ${behindBy} commits ahead of this branch (more than ${BEHIND_LIMIT}). next: rebase onto ${r.g.changed?.ref}, or pass --allow-stale to accept an old base`
    if (json) out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: 'STALE', exitCode: VERDICT_EXIT.stale, exitName: exitName(VERDICT_EXIT.stale), ...statusDoc(VERDICT_EXIT.stale, 'STALE'), blocking: 0, known: 0, stale: [], reason: text, behindBy }, null, 2))
    else out(headlineFromLine(text, 409))
    return VERDICT_EXIT.stale
  }
  if (ready) {
    // One line, nothing about tests: Meerkat reads code, it cannot see whether a test run passed.
    if (blocking === 0 && (c.toolProblems ?? 0) > 0) {
      out(`NOT READY: ${verdictLine({ ...c, blocking: 0 })}`)
      return VERDICT_EXIT.incomplete
    }
    if (blocking === 0) out(`READY: no new blocking findings in changed files (verdict PASS, pre-existing ${c.preExisting + (c.wide ?? 0)}) (status 200)`)
    else {
      const f = firstBlocking(r.g.out)
      out(`NOT READY: ${blocking} new blocking findings in changed files, first at ${f ? `${f.file}${f.line ? ':' + f.line : ''}` : 'unknown'} (status 422)`)
    }
    return blocking > 0 ? 1 : 0
  }
  const suffix = entries ? ` (${known.length} known)` : ''
  const base = verdictLine({ blocking, preExisting: c.preExisting })
  const range = since !== null ? rangeInfo(r.g.repoRoot, since) : null
  // Pre-existing findings (already on the base, or outside the diff) are neither a pass nor a block: exit 1 only for a new blocking finding in a changed file.
  const pre = c.preExisting + (c.wide ?? 0)
  const strictFail = strict && pre > 0
  // Fail closed: findings that could not be classified (the base comparison did not finish) are never a pass. Exit 75 is INCOMPLETE.
  const unclassified = unknown > 0 && blocking === 0 && !strictFail
  // A check that crashed or whose tool failed is a TOOL PROBLEM: never a finding, never a pass. With no real finding the run is INCOMPLETE (status 503).
  const toolOnly = (c.toolProblems ?? 0) > 0 && blocking === 0 && !strictFail && !unclassified
  const line = unclassified ? `INCOMPLETE: ${unknown} finding(s) could not be classified as new or pre-existing (base comparison did not finish); not a pass${suffix}` : toolOnly ? `INCOMPLETE: ${c.toolProblems} check(s) crashed or their tool failed (TOOL PROBLEM, not a finding in the code); not a pass${suffix}` : strict ? `${strictLine({ blocking, pre })}${suffix}` : blocking === 0 ? `PASS${suffix}` : `${base}${suffix}`
  keep(blocking + (strictFail ? pre : 0), line)
  const preLine = pre > 0 ? `pre-existing: ${pre} (not in this diff, does not block)` : null
  const code = blocking > 0 || strictFail ? 1 : unclassified || toolOnly ? VERDICT_EXIT.incomplete : 0
  const finalVerdict = code === VERDICT_EXIT.incomplete ? 'INCOMPLETE' : code > 0 ? 'FAIL' : 'PASS'
  const finalStatus = statusDoc(code, finalVerdict, code === VERDICT_EXIT.incomplete ? (toolOnly ? { incompleteReason: 'tool-problem', notRun: 0 } : incompleteInfo(r.g.out.rows)) : {})
  // One report feeds the text, the JSON and both --format outputs, so they carry the same verdict, status and exit code.
  const report = collectReport(r.g.out, { entries, strict, isLayout: layoutClassOf, base: r.g.changed?.ref ?? null })
  const failCount = blocking + (strictFail ? pre : 0)
  const first1 = report.blocks[0]
  const head = code === 1
    ? headline({ kind: 'FAIL', status: finalStatus.status, blocking: failCount, files: Math.max(report.files.length, 1), strict, next: first1 ? `fix ${first1.file}${first1.line ? `:${first1.line}` : ''}, then run meerkat verdict again` : null })
    : code === VERDICT_EXIT.incomplete
      ? headline({ kind: 'INCOMPLETE', status: finalStatus.status, reason: finalStatus.incompleteReason ?? 'check-unfinished', notFinished: report.notFinished, toolProblems: report.toolProblems.length, next: toolOnly ? report.toolProblems[0].rerun : 'meerkat verdict' })
      : headline({ kind: 'PASS', status: finalStatus.status, pre, strict })
  const states = stateLines(report)
  {
    // The last verdict of this repo and branch, at a fixed path, so a queue can read it without parsing the output.
    const branch = String(spawnSync('git', ['-C', r.g.repoRoot, 'symbolic-ref', 'HEAD'], { encoding: 'utf8' }).stdout ?? '').trim().replace(/^refs\/heads\//, '') || 'detached'
    const summary = { schema: VERDICT_JSON_SCHEMA, verdict: finalVerdict, exitCode: code, exitName: exitName(code), ...finalStatus, headline: head, blocking, preExisting: pre, known: known.length, stale, reason: line, base: baseNow, branch, ...checkCounts(r.g.out), checks: checkRows(r.g.out) }
    const where = writeVerdictSummary(dataDir(env), basename(r.g.repoRoot || cwd), branch, summary)
    if (!where) err('note: the verdict summary file was not written')
  }
  if (json) {
    out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, verdict: finalVerdict, exitCode: code, exitName: exitName(code), ...finalStatus, headline: head, blocking, preExisting: pre, known: known.length, knownFindings: known, stale, unmatchedKnown: stale, ...(baseState ? { baseState, unknown } : {}), behindBy: commitsBehind(r.g.repoRoot, r.g.changed?.ref), reason: line, ...(strict ? { strict: true } : {}), ...(range ? { range } : {}), base: baseNow, ...(rerunIds ? { rerunFailed: rerunIds } : {}), ...(timings ? { timings: timingRows(r.g.out) } : {}), ...checkCounts(r.g.out), checks: checkRows(r.g.out), blocks: report.blocks, toolProblems: report.toolProblems, notFinished: report.notFinished, notRun: report.notRun, skippedByPath: Array.isArray(r.g.out?.skipped) ? r.g.out.skipped : [] }, null, 2))
    return code
  }
  if (format === 'markdown') {
    for (const l of markdownReport({ head, report, pre, rerun: rerunCommand(original), extra: [baseLineOf(baseNow), ...(range ? [rangeLine(range)] : [])], states })) out(l)
    if (rerunNote) err(rerunNote)
    for (const l of timingExtra()) err(l)
    return code
  }
  if (format === 'github') {
    for (const l of githubReport({ head, kind: finalVerdict, report, extra: [baseLineOf(baseNow), ...(range ? [rangeLine(range)] : [])], states })) out(l)
    if (rerunNote) err(rerunNote)
    for (const l of timingExtra()) err(l)
    return code
  }
  if (rerunNote) out(rerunNote)
  out(head)
  for (const l of blockLines(report.blocks)) out(l)
  for (const l of states) out(l)
  if (range) out(rangeLine(range))
  if (preLine) out(preLine)
  if (baseState === 'unfinished') out(`base comparison did not finish: ${unknown} finding(s) in changed files are unclassified (new or pre-existing unknown) and not counted as blocking`)
  for (const k of known) out(`KNOWN: ${k.check} ${k.file}${k.line ? `:${k.line}` : ''}${k.preExisting ? ' (pre-existing on the base)' : ''}`)
  for (const e of stale) out(`STALE: ${e.check} ${e.file}${e.line ? `:${e.line}` : ''} matches no finding any more; remove it from ${knownFile}`)
  for (const l of timingExtra()) out(l)
  return code
}

// verdict --branches a,b,c: the verdict once per branch, each in its own checkout (a temporary worktree) so each has its own changed-file set.
// One line per branch, prefixed with its name. Exit 1 if any branch has a new blocking finding; a branch that cannot be read is a NO-RESULT line and the rest still run.
async function runVerdictBatch(argv, branches, { env, cwd, out, err }) {
  const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  const folder = argv.find((a, i) => !a.startsWith('-') && !['--base', '--known', '--app', '--max-seconds'].includes(argv[i - 1]))
  const start = resolve(cwd, folder ?? '.')
  const top = git(start, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) {
    out('NO-RESULT: not inside a git work tree. next: run it inside a git repository')
    return EXIT.usage
  }
  const root = top.stdout.trim()
  const sub = relative(root, start)
  const rest = argv.filter((a) => a !== folder)
  const json = rest.includes('--json')
  // The base is worked out here, in the real repository, the way a plain verdict does (--base, else --since, else the first of main, master, origin/main, origin/master),
  // and handed to every branch's run: a detached temporary checkout must not pick its own.
  if (!rest.includes('--base') && !rest.includes('--since')) {
    const ref = ['main', 'master', 'origin/main', 'origin/master'].find((r) => git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).status === 0)
    if (ref) rest.push('--base', ref)
  }
  const results = []
  let code = 0
  const skip = (b, text) => {
    if (json) results.push({ schema: VERDICT_JSON_SCHEMA, branch: b, verdict: 'NO-RESULT', exitCode: EXIT.usage, ...statusDoc(EXIT.usage, 'NO-RESULT', { notFound: true }), blocking: 0, known: 0, stale: [], reason: text })
    else out(`${b}: NO-RESULT: ${text}`)
  }
  // meerkat-ignore js-await-in-loop sequential by design: one temporary worktree at a time, so branches never race on git or the disk
  for (const [i, b] of branches.entries()) {
    err(`[${i + 1}/${branches.length}] ${b} ...`)
    if (b.startsWith('-') || git(root, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`]).status !== 0) {
      skip(b, `git does not know the branch ${b}. next: pass a branch that exists`)
      continue
    }
    const tmp = mkdtempSync(join(tmpdir(), 'meerkat-verdict-'))
    const wt = join(tmp, 'wt')
    try {
      const add = git(root, ['worktree', 'add', '--detach', '--force', wt, b])
      if (add.status !== 0) {
        skip(b, `could not check out ${b} (${String(add.stderr).split(String.fromCharCode(10))[0].slice(0, 120)}). next: check the branch with git log ${b}`)
        continue
      }
      for (const dir of new Set([root, start])) {
        const nm = join(dir, 'node_modules')
        const target = join(wt, relative(root, dir), 'node_modules')
        if (existsSync(nm) && !existsSync(target)) {
          try {
            symlinkSync(nm, target, 'junction')
          } catch {
            /* a missing link only means a tool reports it is not installed */
          }
        }
      }
      const lines = []
      const notes = []
      const c = await runVerdict(rest, { env, cwd: join(wt, sub), out: (t) => lines.push(t), err: (t) => notes.push(t), memory: false })
      const baseLine = notes.find((n) => /^base /.test(n))
      if (json) {
        let doc = null
        try {
          doc = JSON.parse(lines.join(String.fromCharCode(10)))
        } catch {
          /* not JSON: reported below as a NO-RESULT */
        }
        results.push(doc ? { schema: VERDICT_JSON_SCHEMA, branch: b, ...doc } : { schema: VERDICT_JSON_SCHEMA, branch: b, verdict: 'NO-RESULT', exitCode: c ?? 1, blocking: 0, known: 0, stale: [], reason: lines[0] ?? 'no output. next: run meerkat verdict on the branch' })
        if (doc?.verdict === 'FAIL') code = 1
      } else {
        out(`${b}: ${lines[0] ?? 'NO-RESULT: no output. next: run meerkat verdict on the branch'}`)
        if (baseLine) err(`${b}: ${baseLine}`)
        if (c === 1 && lines[0] && !lines[0].startsWith('NO-RESULT') && !lines[0].startsWith('INCOMPLETE')) code = 1
      }
    } finally {
      git(root, ['worktree', 'remove', '--force', wt])
      git(root, ['worktree', 'prune'])
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }
  if (json) out(JSON.stringify(results.length === 1 ? results[0] : results, null, 2))
  return code
}

// Every blocking place of the changed files, worst first: severity, then check id, then file and line.
export function topRows(out, checks = []) {
  const byId = new Map(checks.map((c) => [c.id, c]))
  const rows = []
  for (const r of out.rows ?? []) {
    if (!failing(r)) continue
    const places = r.places?.length ? r.places : [{ file: '', line: 0, message: String(r.detail ?? '').split(String.fromCharCode(10))[0].slice(0, 200) }]
    for (const p of places) {
      const f = (r.findings ?? []).find((x) => x?.file && String(x.file).replace(/\\/g, '/').endsWith(p.file) && Number(x.line) === p.line)
      const severity = isSeverity(f?.severity) ? f.severity : defaultSeverity(byId.get(r.id))
      rows.push({ file: p.file || '(no file)', check: r.id, line: p.line, message: p.message, severity })
    }
  }
  return rows.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || a.check.localeCompare(b.check) || a.file.localeCompare(b.file) || a.line - b.line)
}

export function topTable(rows, limit) {
  if (!rows.length) return 'no findings in the changed files'
  const shown = rows.slice(0, limit).map((r) => [r.file, r.check, r.line ? String(r.line) : '-', (r.message || '').replace(/\s+/g, ' ').slice(0, 90)])
  const head = ['file', 'check', 'line', 'message']
  const width = head.map((h, i) => Math.max(h.length, ...shown.map((r) => r[i].length)))
  const fmt = (r) => r.map((c, i) => (i === 3 ? c : c.padEnd(width[i]))).join('  ').trimEnd()
  const lines = [fmt(head), `${width.slice(0, 3).map((w) => '-'.repeat(w)).join('  ')}  -------`, ...shown.map(fmt)]
  if (rows.length > shown.length) lines.push(`(${rows.length - shown.length} more; --limit ${rows.length} shows all)`)
  return lines.join('\n')
}

export async function runTop(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let limit = 10
  let oneLine = false
  let json = false
  let resumeFile = null
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--line') oneLine = true
    else if (argv[i] === '--json') json = true
    else if (argv[i] === '--resume') resumeFile = argv[++i] ?? ''
    else if (argv[i] === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 1) return noResult(out, '--limit needs a whole number, 1 or more', 'usage: meerkat top [folder] [--base <ref>] [--limit <n>]', EXIT.usage)
      limit = n
    } else rest.push(argv[i])
  }
  let gateArgs = rest
  let resume = null
  if (resumeFile !== null) {
    const p = prepareResume(resumeFile, rest, cwd)
    if (p.error) return noResult(out, p.error, 'run meerkat top without --resume to start again', EXIT.usage)
    ;({ args: gateArgs, resume } = p)
  }
  const r = await gather('top', [...gateArgs, '--all-findings'], { env, cwd, out, err, resume })
  if (r.stop !== undefined) return r.stop
  const rows = topRows(r.g.out, r.g.checks)
  const topCounts = verdictCounts(r.g.out)
  if (!rows.length && topCounts.toolProblems > 0) {
    // A crashed check is not a clean tree: never print PASS for it.
    if (json) out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, command: 'top', verdict: 'INCOMPLETE', exitCode: VERDICT_EXIT.incomplete, blocking: 0, toolProblems: topCounts.toolProblems, findings: [] }, null, 2))
    else out(verdictLine(topCounts))
    return VERDICT_EXIT.incomplete
  }
  remember({ env, repoRoot: r.g.repoRoot, source: 'top', line: rows.length ? `FAIL ${rows.length} blocking in changed files` : 'PASS', exit: rows.length ? 1 : 0, commit: headOf(r.g.repoRoot), blocking: rows.length, preExisting: null }, err)
  if (json) {
    // The same rows as the table, all of them (--limit does not cut JSON), as one object.
    out(JSON.stringify({ schema: VERDICT_JSON_SCHEMA, command: 'top', blocking: rows.length, findings: rows }, null, 2))
    return 0
  }
  if (oneLine) {
    // One line for a client that wants only the first thing to fix: file:line check: message, or PASS. NO-RESULT and INCOMPLETE come from gather().
    const f = rows[0]
    out(f ? `${f.file}${f.line ? `:${f.line}` : ''} ${f.check}: ${(f.message || '').replace(/\s+/g, ' ').slice(0, 160)}` : 'PASS')
    return f ? 1 : 0
  }
  out(topTable(rows, limit))
  return 0
}

// Commits the base has that this branch does not (null when the base cannot be read).
export function commitsBehind(repoRoot, ref) {
  if (!ref || !repoRoot) return null
  const res = spawnSync('git', ['-C', repoRoot, 'rev-list', '--count', `HEAD..${ref}`], { encoding: 'utf8' })
  const n = Number(String(res.stdout ?? '').trim())
  return res.status === 0 && Number.isInteger(n) ? n : null
}
