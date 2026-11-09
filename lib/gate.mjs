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
import { folderBanner } from './folderbanner.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { cpus, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { appendStepSummary, gateAnnotations, gateSummary } from './github.mjs'
import { applyConfig, findConfig, readConfig } from './config.mjs'
import { sweepSpawned } from './exec.mjs'
import { applicablePacks } from './init.mjs'
import { makeTrust } from './trust.mjs'
import { applyPresetExclusions, GATE_DEFAULT_PRESET, resolvePreset } from './presets.mjs'
import { appDirOf, repoRootOf } from './paths.mjs'
import { defaultParallel } from './priority.mjs'
import { hideBaseFindings, onNonDefaultBranch } from './newfindings.mjs'
import { createControl, runAll, runOne, selectChecks, stopOnSignals } from './runner.mjs'
import { readUserConfig } from './userconfig.mjs'
import { failureLines, summaryLines } from './failsummary.mjs'
import { parseOutputLines } from './findings.mjs'
import { buildFindings, saveFindings } from './findingsdoc.mjs'
import { passInlineIgnored } from './accepted.mjs'
import { gateCacheFile, gateCacheHit, gateKey, gitStateDigest, layoutDigest, readGateCache, settingsDigest, stateDigest, updatedGateCache } from './gatecache.mjs'
import { cacheHome } from './resultcache.mjs'
import { writeAtomic } from './findingshistory.mjs'
import { gatePathsFor, layoutClassOf } from './gatepaths.mjs'
import { matchesAny } from './glob.mjs'
import { VERSION } from './version.mjs'
import { logRoot, makeRunDir, parseRunName, projectInfo, writeRunReport } from './runlog.mjs'

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
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).error) return { error: 'git was not found on PATH, so the changed files cannot be listed; install git or add it to PATH (meerkat gate needs it)' }
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
  return files === null ? { error: `git could not compare with ${ref}` } : { files: norm([...files, ...untracked]), desc: `changes since the merge-base with ${ref}`, ref, mb }
}

// ---------- classifying a result ----------

// What a tool prints when it dies instead of reporting: a stack trace, a panic, a Python traceback, a segfault.
const CRASH_TEXT = /^\s+at .+[(:]\d+:\d+\)?\s*$|Traceback \(most recent call last\)|panicked at|thread '.+' panicked|Segmentation fault|SIGSEGV|Unhandled(Promise)?Rejection|FATAL ERROR:|core dumped/m
const HANG_TEXT = /^timed out after|^no output for/

// 'pass' | 'fail' | 'crash' | 'hang' | 'notrun' | 'skipped' (nothing to check in this project: not a failure, not blocking). A crash is the tool dying (Meerkat marked it broken, it never started, it exited with a code other
// than 0 or 1, or it exited 1 printing a stack trace). A hang is a stop by the time limit or the idle limit. exit 1 with findings is a plain fail.
export function classify(result, output = '') {
  if (!result) return 'crash'
  if (result.status === 'PASS') return 'pass'
  if (result.status === 'SKIPPED') return 'skipped'
  if (result.status === 'NOT RUN') return HANG_TEXT.test(String(result.detail ?? '')) ? 'hang' : 'notrun'
  if (result.broken) return 'crash'
  if (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0 && result.exitCode !== 1) return 'crash'
  if (result.exitCode === null) return 'crash'
  if (CRASH_TEXT.test(String(output))) return 'crash'
  return 'fail'
}

// The logs of a gate or smoke run are kept under the log folder (runs/<stamp>-<project>--gate), not in a temp folder that is deleted before
// anyone can open it. Only the last run of each kind per project is kept: older ones of the same kind are removed.
function keepLogDir(env, kind, appDir) {
  const dir = makeRunDir(env, 'fast', new Date(), undefined, appDir, kind)
  if (!dir) return null
  try {
    const root = join(logRoot(env), 'runs')
    const want = projectInfo(appDir)?.id ?? null
    const mine = dir.split('/').pop()
    for (const n of readdirSync(root)) {
      const p = parseRunName(n)
      // Only a run that has finished (it has its summary.json) is removed: a gate running at the same moment in this project is still writing there.
      if (n !== mine && p.tier === kind && p.project === want && existsSync(join(root, n, 'summary.json'))) rmSync(join(root, n), { recursive: true, force: true })
    }
  } catch {
    /* an old log that cannot be removed is only clutter */
  }
  return dir
}

function makeCtx({ repoRoot, appDir, env, files, logDir, tier, smokeSeconds }) {
  const ctx = { timeoutScale: 1, control: createControl(), noIdleKill: false, repoRoot, appDir, tier, env, platform: process.platform, exists: existsSync, changedFiles: files, scope: [], findingsSink: new Map(), logDir }
  // The tiny limit of smoke: every check gets the same few seconds (the budgets file would otherwise raise single checks).
  if (smokeSeconds) ctx.timeoutPolicy = { facts: {}, budgets: { timeouts: {}, idleKill: {}, timeoutScale: 1 }, scale: 1, load: 1 }
  return ctx
}

// A gate saves a real run record in the run store (findings.json with stable ids, summary.json, report.md), so `meerkat findings`, `finding`,
// `dismiss`, `last` and `why` work after a gate exactly as after a run. Cached rows (not run this time) are written from the findings they were saved with.
const STATUS_OF_KIND = { pass: 'PASS', skipped: 'SKIPPED', notrun: 'NOT RUN', hang: 'NOT RUN' }
function saveGateRecord({ logDir, ctx, results, cachedRows, rows, checks, appDir, repoRoot, env, tier, exitCode, startedAt, all }) {
  if (!logDir) return null
  try {
    const sink = new Map(ctx.findingsSink)
    const synth = cachedRows.map((r) => {
      sink.set(r.id, { findings: r.findings ?? [], output: String(r.detail ?? '') })
      return { id: r.id, status: STATUS_OF_KIND[r.kind] ?? 'FAIL', detail: r.detail ?? '', ms: 0 }
    })
    const full = [...results, ...synth]
    const ms = Date.now() - startedAt
    const info = saveFindings({ dir: logDir, results: full, checks, sink, appDir, repoRoot, env, version: VERSION, preset: 'gate', tier, startedAtMs: startedAt, ms, note: () => {} })
    const failed = rows.filter((r) => r.kind === 'fail' || r.kind === 'crash').length
    const line = `gate: ${rows.length} check(s), ${failed} failed${all ? ' (all failures block)' : ''}`
    writeRunReport({ checks, dir: logDir, tier, preset: 'gate', results: full, line, exitCode, ms, argv: ['gate'], env, version: VERSION, startedAtMs: startedAt, findingsInfo: info, appDir })
    return { runId: basename(logDir), runDir: logDir, findingsFile: info ? `${logDir}/findings.json` : null }
  } catch {
    return null
  }
}

// ---------- the pure cores ----------

function select(checks, files, tier, env) {
  return selectChecks(checks, { tier, only: [], include: [], mode: 'changed', changedFiles: files, groups: [], suites: [], windows: env.MEERKAT_WINDOWS === '1', skipCompile: false })
}

// The repo-relative places a failing check points at ({ file, line, message }): its structured findings, else the file paths in its saved output.
function placesOfFailure(findings, output, ctx) {
  const toRepo = (f) => {
    const n = String(f).replace(/\\/g, '/')
    if (ctx.appDir === ctx.repoRoot) return n
    const viaApp = relative(ctx.repoRoot, join(ctx.appDir, n)).replace(/\\/g, '/')
    return viaApp.startsWith('..') ? n : viaApp
  }
  const structured = (findings ?? []).filter((f) => f?.file)
  const found = structured.length ? structured : parseOutputLines(output ?? '', (p) => (existsSync(join(ctx.appDir, p)) ? p : existsSync(join(ctx.repoRoot, p)) ? p : null))
  const seen = new Set()
  const places = []
  for (const f of found) {
    const place = { file: toRepo(f.file), line: Number(f.line) > 0 ? Number(f.line) : 0, col: Number(f.col ?? f.column) > 0 ? Number(f.col ?? f.column) : 0, message: String(f.message ?? f.detail ?? '').split(String.fromCharCode(10))[0].slice(0, 200) }
    const key = place.file + ':' + place.line + ':' + place.message
    if (!seen.has(key)) (seen.add(key), places.push(place))
  }
  return places
}
const filesOf = (places) => [...new Set((places ?? []).map((p) => p.file))]

// Scoped gate (the default): a check that FAILS only blocks when one of its findings is in a file that changed. A failure that points at
// nothing (no SECURITY.md, no licence) or only at files nobody touched is a project-wide matter: it is listed ("wide"), not blocking.
// `all: true` is the old behaviour: every failure blocks.
const isWide = (row, changed) => row.kind === 'fail' && !(row.files ?? []).some((f) => changed.has(f))

// gate: { exitCode, files, ran, skipped, rows: [{id, kind, detail}], note }
export async function runGate({ checks, files, repoRoot, appDir = repoRoot, projectDir = appDir, env = process.env, tier = 'fast', parallel = defaultParallel(cpus().length, env), log = () => {}, all = false, useCache = false, timings = null, autoPacks = [], scratch = false, progress = null, control = null, deadlineMs = 0, heartbeatMs = HEARTBEAT_MS }) {
  const t0 = Date.now()
  const lap = (name) => timings?.push([name, Date.now() - t0])
  if (!checks.length) return { exitCode: EXIT.notRun, files, rows: [], ran: [], skipped: [], note: 'no checks are loaded for this project (meerkat init, or add a pack to meerkat.config.json), so nothing was checked' }
  if (!files.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: [], note: 'nothing changed, so no check has anything to read (for --staged, stage files with git add first; or compare against a commit with --base <ref>)' }
  const sel = select(checks, files, tier, env)
  // Scoped gate: a check with no paths of its own that is plainly about one kind of file (a Rust check, a notebook check) waits for such a file.
  const skippedIds = sel.skipped.map((c) => c.id)
  if (!all) {
    const keep = []
    for (const c of sel.run) {
      const g = c.paths?.length ? null : gatePathsFor(c)
      if (g && !matchesAny(g, files)) skippedIds.push(c.id)
      else keep.push(c)
    }
    sel.run = keep
  }
  lap('select')
  if (!sel.run.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: skippedIds, note: `${files.length} file(s) changed but no check covers their paths (${skippedIds.length} check(s) skipped)` }
  const logDir = scratch ? mkdtempSync(join(tmpdir(), 'meerkat-scratch-')) : keepLogDir(env, 'gate', projectDir)
  try {
    const ctx = makeCtx({ repoRoot, appDir, env, files, logDir, tier })
    const budget = { cpu: Math.min(10, cpus().length), reserveGB: 3, maxParallel: 10, maxWindows: 3 }
    // The result cache: a check whose inputs are exactly as at its last run is not run again (lib/gatecache.mjs).
    const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null
    const digest = useCache ? stateDigest({ repoRoot, appDir, head, env }) : null
    lap('digest')
    // Checks that never read source text (lib/gatepaths.mjs) are keyed without it: names, document and config contents, and for git checks the history.
    const narrowMemo = {}
    const narrow = (cls) => (narrowMemo[cls] ??= createHash('sha256').update([cls === 'git' ? gitStateDigest(repoRoot) : '-', layoutDigest(repoRoot) ?? Math.random(), head ?? '-', settingsDigest([repoRoot, appDir], env)].join('|')).digest('hex'))
    const cacheBefore = digest ? readGateCache(gateCacheFile(env, appDir)) : null
    const keys = new Map()
    const cachedRows = []
    const toRun = []
    for (const c of sel.run) {
      if (!digest) {
        toRun.push(c)
        continue
      }
      const cls = all ? null : layoutClassOf(c.id)
      const key = gateKey({ digest: cls ? narrow(cls) : digest, tier, version: VERSION, checkId: c.id })
      keys.set(c.id, key)
      const hit = gateCacheHit(cacheBefore, c.id, key)
      if (hit) cachedRows.push({ ...hit.row, ms: 0, cached: true })
      else toRun.push(c)
    }
    // Live progress (the real CLI only): one line when a check starts and one when it ends, on stderr, and a "still running" line for every check
    // that has run 30 s or more, repeated every 30 s, so a gate that takes minutes never looks hung. See gateProgress.
    const prog = progress && toRun.length ? gateProgress(toRun.length, progress, heartbeatMs) : null
    let results
    try {
      results = toRun.length ? await runAll(toRun, ctx, { budget, keepGoing: true, parallel, log, deadlineMs, control, hooks: prog?.hooks ?? {} }) : []
    } finally {
      prog?.stop()
    }
    const stoppedEarly = !!(control?.interrupted || results.some((r) => r?.detail && STOPPED_RE.test(r.detail)))
    lap('run')
    // A check whose every finding carries an inline meerkat-ignore comment passes, as in a run.
    if (results.some((r) => r?.status === 'FAIL')) {
      try {
        const doc = buildFindings({ results, checks: sel.run, sink: ctx.findingsSink, appDir, repoRoot, env, meta: { runId: 'gate', version: '', dir: '', preset: null, tier, startedAt: '', endedAt: '', ms: 0 } })
        passInlineIgnored(results, doc, ctx.findingsSink)
      } catch {
        /* a findings document that cannot be built only means nothing is ignored */
      }
    }
    const ran = results.map((r) => {
      const sink = ctx.findingsSink.get(r.id)
      const kind = classify(r, sink?.output)
      const row = { id: r.id, kind, detail: r.detail ?? '', ms: r.ms ?? 0, findings: sink?.findings ?? [] }
      if (kind === 'fail') (row.places = placesOfFailure(row.findings, sink?.output, ctx), (row.files = filesOf(row.places)))
      return row
    })
    // Keep what this run learned, unless a check wrote into the project (then the inputs the key describes are no longer the ones that were read).
    if (digest) {
      const after = stateDigest({ repoRoot, appDir, head, env })
      if (after === digest) {
        const { text } = updatedGateCache(cacheBefore, ran.filter((r) => keys.has(r.id)).map((r) => ({ key: keys.get(r.id), row: r })))
        try {
          mkdirSync(cacheHome(env), { recursive: true, mode: 0o700 })
          writeAtomic(gateCacheFile(env, appDir), text)
        } catch {
          /* a cache that cannot be written only costs time */
        }
      }
    }
    lap('cache')
    for (const r of cachedRows) if (r.kind === 'fail' && !r.files) (r.places = placesOfFailure(r.findings, r.detail, ctx), (r.files = filesOf(r.places)))
    const order = new Map(sel.run.map((c, i) => [c.id, i]))
    const rows = [...ran, ...cachedRows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    // A check from a pack the gate added on its own (not in the project's config) never fails the gate because its tool is missing: it counts as not configured.
    const auto = new Set((autoPacks ?? []).map((p) => `pack ${p}`))
    const sourceOf = new Map(checks.map((c) => [c.id, c.source]))
    for (const r of rows) if ((r.kind === 'notrun' || r.kind === 'hang') && auto.has(sourceOf.get(r.id))) r.kind = 'skipped'
    const changed = new Set(files)
    if (!all) {
      for (const r of rows) {
        if (isWide(r, changed)) r.kind = 'wide'
        else if (r.kind === 'fail' && r.places?.length) {
          // Only the findings in the changed files block. The rest of the check's findings (an old unused file, say) are counted, not listed as yours.
          const mine = r.places.filter((p) => changed.has(p.file))
          if (mine.length < r.places.length) {
            r.outside = r.places.length - mine.length
            r.places = mine
            r.files = filesOf(mine)
            const d = mine[0]
            r.detail = d.message ? d.file + (d.line ? ':' + d.line : '') + ' ' + d.message : r.detail
          }
        }
      }
    }
    const bad = rows.some((r) => r.kind === 'fail' || r.kind === 'crash')
    const exitCode = bad ? EXIT.fail : rows.some((r) => r.kind === 'notrun' || r.kind === 'hang') ? EXIT.notRun : EXIT.pass
    const record = scratch ? null : saveGateRecord({ logDir, ctx, results, cachedRows, rows, checks: sel.run, appDir, repoRoot, env, tier, exitCode, startedAt: t0, all })
    return { exitCode, files, rows, ran: sel.run.map((c) => c.id), skipped: skippedIds, note: '', stoppedEarly, logDir, ms: Date.now() - t0, cached: cachedRows.length, all, timings: timings ?? undefined, ...(record ?? {}) }
  } finally {
    if (scratch && logDir) rmSync(logDir, { recursive: true, force: true }) // a base-side comparison run leaves no record; every other log folder is kept on purpose
  }
}

const STOPPED_RE = /run deadline reached|interrupted by you/

// The progress lines of a gate. hooks.start / hooks.settle feed runAll; the timer names every check that has been running a while.
// --first: one line, the first blocking finding in the changed files (file:line: message), or PASS.
export function firstBlocking(out) {
  const found = []
  for (const r of out.rows ?? []) {
    if (r.kind !== 'fail' && r.kind !== 'crash') continue
    const detail = String(r.detail ?? '').split(String.fromCharCode(10))[0].slice(0, 200)
    for (const p of r.places?.length ? r.places : [{ file: '', line: 0, message: detail }]) found.push({ file: p.file || '(no file)', line: p.line || 0, message: p.message || detail || r.id })
  }
  found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
  return found[0] ?? null
}
export function firstLine(out) {
  const f = firstBlocking(out)
  if (f) return `${f.file}${f.line ? ':' + f.line : ''}: ${f.message}`.replace(/[ ]{2,}/g, ' ')
  return out.exitCode === EXIT.pass ? 'PASS' : `NO-RESULT: exit ${out.exitCode}, no blocking finding in the changed files`
}
// One line naming what the run compares against: the merge-base sha and the ref it came from (stderr, so stdout stays the answer).
export const mergeBaseLine = (changed) => (changed?.mb ? `comparing against merge base ${String(changed.mb).slice(0, 12)} (${changed.ref ?? 'base'})` : `comparing: ${changed?.desc ?? 'the working tree'} (no merge base)`)
export const HEARTBEAT_MS = 5000
export function gateProgress(total, say, heartbeatMs = HEARTBEAT_MS, now = Date.now) {
  let started = 0
  let finished = 0
  const t0 = now()
  const live = new Map() // id -> startedAt
  const secs = (ms) => (ms / 1000).toFixed(1)
  const clock = (ms) => {
    const s = Math.floor(ms / 1000)
    return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
  }
  // One line every heartbeatMs while a check runs: time spent, checks done of the total, and the check that has run longest.
  const timer = heartbeatMs > 0 ? setInterval(() => {
    if (!live.size) return
    const t = now()
    const [id, at] = [...live].sort((x, y) => x[1] - y[1])[0]
    const more = live.size > 1 ? ` and ${live.size - 1} more` : ''
    say(`… ${clock(t - t0)}: ${finished}/${total} checks done, running: ${id} (${Math.round((t - at) / 1000)}s)${more}`)
  }, heartbeatMs) : null
  timer?.unref?.()
  return {
    hooks: {
      start: (c) => {
        started++
        live.set(c.id, Date.now())
        say(`[${started}/${total}] ${c.id} ...`)
      },
      settle: (c, r, ms) => {
        live.delete(c.id)
        finished++
        say(`[${finished}/${total}] ${c.id} ... ${secs(ms)}s ${r.status === 'PASS' ? '' : r.status}`.trimEnd())
      },
    },
    stop: () => clearInterval(timer),
  }
}

// smoke: each selected check runs alone and in turn on the changed files, with `seconds` as its whole limit. The verdict is about the tool:
// pass and fail (findings) are both fine; crash, hang and an empty selection are failures. Not-run (a missing tool) is reported, not failed.
export async function runSmoke({ checks, files, repoRoot, appDir = repoRoot, env = process.env, tier = 'fast', seconds = SMOKE_TIMEOUT_SECONDS }) {
  if (!checks.length) return { exitCode: EXIT.notRun, files, rows: [], ran: [], skipped: [], note: 'no checks are loaded for this project, so there is nothing to smoke-test' }
  if (!files.length) return { exitCode: EXIT.pass, files, rows: [], ran: [], skipped: [], note: 'nothing changed, so no check was selected and none needed' }
  const sel = select(checks, files, tier, env)
  if (!sel.run.length) return { exitCode: EXIT.fail, files, rows: [], ran: [], skipped: sel.skipped.map((c) => c.id), note: `${files.length} file(s) changed but zero checks were selected: Meerkat would check nothing here. A selection that is empty for a real change is a bug in the selection, the packs or the paths` }
  const logDir = keepLogDir(env, 'smoke', appDir)
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
      rows.push({ id: c.id, kind: classify(result, ctx.findingsSink.get(c.id)?.output), detail: result.detail ?? '', findings: ctx.findingsSink.get(c.id)?.findings ?? [] })
    }
    const toolBad = rows.some((r) => r.kind === 'crash' || r.kind === 'hang')
    const exitCode = toolBad ? EXIT.fail : rows.every((r) => r.kind === 'notrun') ? EXIT.notRun : EXIT.pass
    return { exitCode, files, rows, ran: sel.run.map((c) => c.id), skipped: sel.skipped.map((c) => c.id), note: '', logDir }
  } finally {
    /* the log folder is kept on purpose */
  }
}

// ---------- the command ----------

const validOptions = (smoke) => `--staged, --base <ref>, --against <ref>, --app <folder>, --thorough, --verbose, --full, --no-input, --json${smoke ? ', --timeout <seconds>' : ', --all, --all-findings, --no-cache, --first, --max-seconds <seconds>'} (or a folder: meerkat ${smoke ? 'smoke' : 'gate'} <folder>)`

export function parseGateArgs(argv, { smoke = false } = {}) {
  const o = { staged: false, base: null, against: null, app: null, json: false, format: null, thorough: false, verbose: false, full: false, all: false, noCache: false, allFindings: false, first: false, seconds: SMOKE_TIMEOUT_SECONDS, maxSeconds: 0, errors: [] }
  const value = (i, flag) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) o.errors.push(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--staged') o.staged = true
    else if (a === '--json') o.json = true
    else if (a === '--format') {
      o.format = value(i++, a)
      if (o.format !== undefined && o.format !== 'github' && o.format !== 'editor') o.errors.push('--format only supports: github, editor')
    }
    else if (a === '--thorough') o.thorough = true
    else if (a === '--verbose') o.verbose = true
    else if (a === '--full') o.full = true
    else if (a === '--no-input') o.noInput = true
    else if (a === '--all' && !smoke) o.all = true
    else if (a === '--no-cache' && !smoke) o.noCache = true
    else if (a === '--all-findings' && !smoke) o.allFindings = true
    else if (a === '--first' && !smoke) o.first = true
    else if (a === '--max-seconds' && !smoke) {
      const n = Number(value(i++, a))
      if (Number.isFinite(n) && n >= 1) o.maxSeconds = n
      else o.errors.push('--max-seconds needs a number of seconds, 1 or more')
    }
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
export async function loadProjectChecks(appDir, repoRoot, env = process.env, opts = {}) {
  const configFile = findConfig({ appDir, repoRoot })
  const read = configFile ? readConfig(configFile) : { config: { packs: applicablePacks(appDir), extraChecks: [], disable: [], override: {}, budget: null, presets: {} }, notes: [] }
  const user = readUserConfig(env)
  const packDirs = Array.isArray(user.packDirs) ? user.packDirs.filter((d) => typeof d === 'string' && d.trim() !== '') : []
  // The gate always adds every pack that applies to this folder, so a project set up by `meerkat init` (security, hygiene) still gets
  // security-plus and the rest for the files it checks. Only checks whose paths match a changed file run (selectChecks).
  const configured = new Set(read.config.packs ?? [])
  const autoPacks = applicablePacks(appDir).filter((p) => !configured.has(p))
  const config = { ...read.config, packs: [...(read.config.packs ?? []), ...autoPacks] }
  const applied = await applyConfig([], config, { file: configFile, extraPackDirs: packDirs, personalChecks: user.customChecks, projectDir: appDir, noProjectCode: Boolean(env.MEERKAT_NO_PROJECT_CODE), trust: makeTrust(env, opts) })
  // The gate runs the default preset (bugs, lib/presets.mjs GATE_DEFAULT_PRESET) so a finding is likely a real defect, not a style note.
  // `gate` has no --preset flag, so only --all (opts.all) turns this off: --all means every check, as before.
  if (!opts.all) applyPresetExclusions(applied, resolvePreset(GATE_DEFAULT_PRESET).preset)
  // A pack that is missing is only an automatic addition, not a mistake in the project: no note for it.
  const notes = applied.notes.filter((n) => !autoPacks.some((p) => n === `pack "${p}": not found or empty`))
  return { checks: applied.checks, notes: [...read.notes, ...notes], autoPacks }
}

const LIST_CAP = 10
// [{ id, count }] of the checks that block: a count of places, else findings, else 1.
export function failedChecks(out) {
  return (out.rows ?? []).filter((r) => r.kind === 'fail' || r.kind === 'crash').map((r) => ({ id: r.id, count: r.places?.length || r.findings?.length || 1 }))
}
// Findings in the checks that do not block: whole checks whose findings are all outside the change ("wide"), plus the part of a blocking check that sits in files nobody touched.
export function preExistingChecks(out) {
  const list = []
  for (const r of out.rows ?? []) {
    if (r.kind === 'wide') list.push({ id: r.id, count: r.places?.length || r.findings?.length || 1 })
    else if ((r.kind === 'fail' || r.kind === 'crash') && r.outside) list.push({ id: r.id, count: r.outside })
  }
  return list
}
export const preExistingCount = (out) => preExistingChecks(out).reduce((n, c) => n + c.count, 0)
export const gateStatus = (code) => (code === EXIT.pass ? 'passed' : code === EXIT.fail ? 'failed' : code === EXIT.notRun ? 'not-run' : 'error')
// The --json shape: a status, the counts, the run folder and a compact row per check. The long per-finding lists stay in findings.json (run folder); --full keeps them here too.
export function gateJson(kind, desc, out, full = false) {
  const checks = failedChecks(out)
  const rows = full ? out.rows : (out.rows ?? []).map((r) => ({ id: r.id, kind: r.kind, detail: String(r.detail ?? '').split('\n')[0].slice(0, 300), ms: r.ms, ...(r.files?.length ? { files: r.files.slice(0, 10) } : {}), ...(r.places?.length ? { places: r.places.length } : {}), ...(r.outside ? { outside: r.outside } : {}) }))
  const pre = preExistingChecks(out)
  return { kind, desc, ...out, status: gateStatus(out.exitCode), blocking: checks.reduce((n, c) => n + c.count, 0), failedChecks: checks, preExisting: pre.reduce((n, c) => n + c.count, 0), preExistingChecks: pre, runFolder: out.runDir ?? out.logDir ?? null, runId: out.runId ?? null, findingsFile: out.findingsFile ?? null, rows }
}

const ICON = { pass: 'PASS   ', fail: 'FAIL   ', crash: 'TOOL   ', hang: 'HANG   ', notrun: 'NOT RUN', skipped: 'SKIPPED', wide: 'WIDE   ' }

// "1.4s" / "12.3s" / "2m05s"
const took = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`)
const fileList = (files) => {
  const f = files ?? []
  return f.length <= 3 ? f.join(', ') || 'no files' : `${f.slice(0, 3).join(', ')} and ${f.length - 3} more`
}

// One line per place a failure points at: "path:line  message", or "path (no line)  message" when the check did not say which line.
export const PLACE_CAP = 10
export function placeLines(r, cap = PLACE_CAP) {
  const places = r.places ?? []
  if (!places.length) return ['    (no file, no line)']
  const lines = places.slice(0, cap).map((p) => `    ${p.line ? `${p.file}:${p.line}` : `${p.file} (no line)`}${p.message ? `  ${p.message}` : ''}`)
  if (places.length > cap) lines.push(`    ... and ${places.length - cap} more`)
  if (r.outside) lines.push(`    (${r.outside} more in files you did not change: not blocking)`)
  return lines
}

// --format editor: one "path:line:col: check: message" per blocking finding, for an editor's quickfix list. A finding with no line says 1:1.
export function editorLines(out) {
  const lines = []
  for (const r of out.rows ?? []) {
    if (r.kind !== 'fail' && r.kind !== 'crash') continue
    const first = String(r.detail ?? '').split('\n')[0].slice(0, 200)
    const places = r.places?.length ? r.places : [{ file: '', line: 0, col: 0, message: first }]
    for (const p of places) lines.push(`${p.file || '(no file)'}:${p.line || 1}:${p.col || 1}: ${r.id}: ${p.message || first}`)
  }
  return lines
}

// The default text of a gate: one line of counts, one line per failed check (its name and count only), the log folder. The per-finding list is --full.
export function compactGateText(out) {
  const n = (k) => out.rows.filter((r) => r.kind === k).length
  const failed = failedChecks(out)
  const blocking = failed.reduce((a, c) => a + c.count, 0)
  const pre = preExistingChecks(out)
  const preN = pre.reduce((a, c) => a + c.count, 0)
  const lines = [`MEERKAT gate: ${blocking} blocking, ${preN} pre-existing (not in the change), ${n('pass')} passed, ${n('notrun') + n('hang')} not run, exit ${out.exitCode}, scanned ${fileList(out.files)}${out.ms !== undefined ? `, ${took(out.ms)}` : ''}`]
  const cap = LIST_CAP * 3
  for (const c of failed.slice(0, cap)) lines.push(`FAIL  ${String(c.id).slice(0, 60)} (${c.count})`)
  if (failed.length > cap) lines.push(`... and ${failed.length - cap} more failed checks (--full lists them all)`)
  for (const r of out.rows.filter((x) => x.kind === 'notrun' || x.kind === 'hang').slice(0, LIST_CAP)) lines.push(`${ICON[r.kind].trim()}  ${r.id}`)
  if (preN) lines.push(`pre-existing: ${preN} finding(s) in ${pre.length} check(s) are not in the files you changed and do not block (--verbose or --full lists them)`)
  if (out.note) lines.push(out.note)
  if (out.exitCode === EXIT.pass && blocking === 0 && out.files?.length && !out.note) lines.push(`PASS: nothing blocking in ${out.files.length} changed file(s)`)
  if (out.exitCode === EXIT.fail) lines.push('next: fix the failed checks above first (--full lists every finding; findings.json in the run folder has them all)')
  if (out.runDir || out.logDir) lines.push(`logs: ${out.runDir ?? out.logDir}`)
  return lines.join('\n')
}

export function gateText(kind, out, desc, { verbose = kind !== 'gate', showWide = true, full = false } = {}) {
  if (kind === 'gate' && !full && !verbose) return compactGateText(out)
  const n = (k) => out.rows.filter((r) => r.kind === k).length
  const blocking = n('fail') + n('crash')
  const wide = out.rows.filter((r) => r.kind === 'wide')
  const scoped = kind === 'gate' && !out.all && (wide.length > 0 || out.ms !== undefined)
  // Line 1: how many failures block, which files were scanned, and how long it took.
  const first = `MEERKAT ${kind}: ${blocking} blocking, scanned ${fileList(out.files)}${out.ms !== undefined ? `, ${took(out.ms)}` : ''}${out.cached ? ` (${out.cached} check(s) reused from the cache)` : ''}`
  const lines = [first, `${desc}, ${out.files.length} file(s)${out.all ? ', all checks (--all)' : ''}`]
  // Summary first (the blocking count, the failed checks by name, the run folder); the long lists follow, cut unless --full.
  lines.push(...summaryLines({ checks: failedChecks(out), runFolder: out.runDir ?? out.logDir ?? null, full }))
  if (out.hidden !== undefined) lines.push(`${out.hidden} pre-existing finding(s) hidden: already on ${out.hiddenRef ?? 'the base'} (--all-findings shows them)`)
  let listed = 0
  for (const r of out.rows) {
    // The scoped gate shows what needs a look; passes are a count. --all keeps the full list.
    // The gate's default is failures only: a pass, a project-wide note or a check that is not configured is a count. --verbose lists every check.
    if (!verbose && (r.kind === 'pass' || r.kind === 'wide' || r.kind === 'skipped')) continue
    if (verbose && scoped && (r.kind === 'pass' || r.kind === 'wide')) continue
    if ((r.kind === 'fail' || r.kind === 'crash') && !full && ++listed > LIST_CAP) {
      if (listed === LIST_CAP + 1) lines.push(`... and ${failedChecks(out).length - LIST_CAP} more failed checks (--full lists them all)`)
      continue
    }
    lines.push(`${ICON[r.kind]}  ${r.id}${r.detail ? `  ${String(r.detail).split('\n')[0].slice(0, 200)}` : ''}`)
    // Every place of the failure, not only the first: file:line, or "(no line)" when the check does not know it.
    if (r.kind === 'fail' || r.kind === 'crash') {
      if (r.places?.length || r.kind === 'fail') lines.push(...placeLines(r, full ? Infinity : PLACE_CAP))
      else if (r.findings?.length) lines.push(...failureLines(r.findings.map((f) => ({ ...f, check: r.id })), { logPath: out.logDir }))
    }
  }
  // A gate run with --all runs project-wide checks, so most failures may be old. Say which ones point into the files that changed: those are yours to fix now.
  const changed = new Set((out.files ?? []).map((f) => String(f).replace(/\\/g, '/')))
  const mine = out.rows.filter((r) => (r.kind === 'fail' || r.kind === 'crash') && changed.has(String(/^([^\s:]+?)(?::\d+)?(?:[\s:]|$)/.exec(String(r.detail ?? '').split('\n')[0].trim())?.[1] ?? '').replace(/\\/g, '/')))
  if (mine.length) {
    lines.push(`in the files you changed (${mine.length} check(s)):`)
    for (const r of mine) lines.push(`  ${r.id}: ${String(r.detail).split('\n')[0].replace(/\s*\[full output:.*$/, '').slice(0, 160)}`)
  }
  if (wide.length && !showWide) lines.push(`${wide.length} project-wide items, not blocking; "meerkat gate --verbose" lists them`)
  else if (wide.length) {
    lines.push(`project-wide, not blocking (${wide.length}): these look at the whole project, not at your files (--all makes them block)`)
    for (const r of wide) lines.push(`  ${r.id}: ${String(r.detail).split('\n')[0].replace(/\s*\[full output:.*$/, '').slice(0, 140)}`)
  }
  if (out.skipped.length) lines.push(`not selected (no changed file in their paths): ${out.skipped.length}`)
  if (out.note) lines.push(out.note)
  const tool = n('crash') + n('hang')
  lines.push(`${kind}: ${n('pass')} passed, ${n('fail')} failed${wide.length ? `, ${wide.length} project-wide (not blocking)` : ''}, ${tool} tool failure(s), ${n('notrun')} not run${n('skipped') ? `, ${n('skipped')} not configured` : ''}, exit ${out.exitCode}`)
  if (kind === 'gate' && out.exitCode === EXIT.pass && blocking === 0 && out.files?.length) lines.push(`PASS: nothing blocking in ${out.files.length} changed file(s)`)
  if (out.logDir) lines.push(`logs: ${out.logDir}`)
  if (out.exitCode === EXIT.fail) {
    if (scoped) lines.push('next: fix the failures listed above first. Each log file above says why it failed.')
    else lines.push(mine.length ? 'next: fix the checks listed under "in the files you changed" first. The others look at the whole project; each log file above says why it failed.' : 'next: no failure points into the files you changed, so these look at the whole project. Each log file above says why it failed; fix them or accept them in the allow file the message names.')
  }
  return lines.join('\n')
}

// What "git commit" would record: a detached worktree of HEAD with every staged file replaced by its INDEX version (git checkout-index), so a file
// staged in part is checked as staged, not as saved. Returns { repoRoot, appDir, done() } or null when it cannot be made (the caller then checks the working tree).
export function stagedSnapshot(repoRoot, appDir, files) {
  if (git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === null) return null
  let tmp = null
  const cleanup = () => {
    if (!tmp) return
    spawnSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', join(tmp, basename(repoRoot))], { encoding: 'utf8' })
    spawnSync('git', ['-C', repoRoot, 'worktree', 'prune'], { encoding: 'utf8' })
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  try {
    tmp = mkdtempSync(join(tmpdir(), 'meerkat-staged-'))
    const wt = join(tmp, basename(repoRoot))
    const add = spawnSync('git', ['-C', repoRoot, 'worktree', 'add', '--detach', '--force', wt, 'HEAD'], { encoding: 'utf8' })
    if (add.status !== 0) throw new Error(add.stderr)
    // Nothing is written or removed through a link: a parent folder that is a link refuses the snapshot, a link at the file itself is unlinked first.
    const wtReal = realpathSync(wt)
    const noLinkParents = (f) => {
      let p = wt
      for (const part of f.split('/').slice(0, -1)) {
        p = join(p, part)
        let st = null
        try {
          st = lstatSync(p)
        } catch {
          return
        }
        if (st.isSymbolicLink()) throw new Error(`${f}: a parent folder is a link`)
      }
      const parent = dirname(join(wt, f))
      if (existsSync(parent) && !realpathSync(parent).startsWith(wtReal)) throw new Error(`${f} resolves outside the snapshot`)
    }
    for (const f of git(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=D']) ?? []) (noLinkParents(f), rmSync(join(wt, f), { force: true }))
    for (const f of files) {
      noLinkParents(f)
      try {
        if (lstatSync(join(wt, f)).isSymbolicLink()) unlinkSync(join(wt, f))
      } catch {
        /* nothing there yet */
      }
    }
    // git writes the index version itself (git checkout-index): it creates a link as a link and never writes through one.
    for (let i = 0; i < files.length; i += 200) {
      const c = spawnSync('git', ['-C', repoRoot, 'checkout-index', '-f', `--prefix=${wt.split(String.fromCharCode(92)).join('/')}/`, '--', ...files.slice(i, i + 200)], { encoding: 'utf8' })
      if (c.status !== 0) throw new Error(`git checkout-index failed: ${c.stderr}`)
    }
    // Checks list files with git: the snapshot's own index (a worktree has one of its own) must know the new and changed files too.
    for (let i = 0; i < files.length; i += 200) spawnSync('git', ['-C', wt, 'add', '-f', '--', ...files.slice(i, i + 200)], { encoding: 'utf8' })
    // Tools that need the installed packages find them through a link; nothing is copied.
    for (const base of new Set([repoRoot, appDir])) {
      const nm = join(base, 'node_modules')
      const target = join(wt, relative(repoRoot, base), 'node_modules')
      if (existsSync(nm) && !existsSync(target)) {
        try {
          symlinkSync(nm, target, 'junction')
        } catch {
          /* a missing link only means a tool reports it is not installed */
        }
      }
    }
    return { repoRoot: wt, appDir: join(wt, relative(repoRoot, appDir)), done: cleanup }
  } catch {
    cleanup()
    return null
  }
}

// The project-wide list is printed in full when it differs from the last run's (kept in the Meerkat data folder, one file per project), else as a count.
function wideChanged(env, appDir, out) {
  const wide = (out.rows ?? []).filter((r) => r.kind === 'wide').map((r) => `${r.id}|${String(r.detail ?? '').split('\n')[0].split('[full output:')[0].trim()}`).sort()
  const file = `${gateCacheFile(env, appDir)}.wide.json`
  let before = null
  try {
    before = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    /* first run in this project */
  }
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeAtomic(file, JSON.stringify(wide))
  } catch {
    /* a list that cannot be kept only means it is shown in full again */
  }
  return !Array.isArray(before) || before.join('\n') !== wide.join('\n')
}


// The checks named in ids plus everything they wait on (`after`), in their loaded order.
export function checksNamed(checks, ids) {
  const want = new Set(ids)
  const byId = new Map(checks.map((c) => [c.id, c]))
  const queue = [...want]
  while (queue.length) for (const dep of byId.get(queue.shift())?.after ?? []) if (!want.has(dep) && byId.has(dep)) (want.add(dep), queue.push(dep))
  return checks.filter((c) => want.has(c.id))
}

// A branch gate (--base <ref>, or a feature branch checked against main) shows only what the branch adds; --all-findings shows everything (lib/newfindings.mjs).
async function keepNewOnly(out, { o, changed, repoRoot, appDir, env, tier, err, progress = null }) {
  if (o.allFindings || o.all || o.staged || o.against || !changed.mb || !out.rows?.length) return
  if (!o.base && !onNonDefaultBranch(repoRoot, changed.ref)) return
  // The base-side comparison can take as long as the branch run: say so every few seconds, so the output never goes quiet after the last check.
  const t0 = Date.now()
  const beat = progress ? setInterval(() => progress(`… ${Math.round((Date.now() - t0) / 1000)}s: comparing with ${changed.ref} (the findings already there are being worked out)`), HEARTBEAT_MS) : null
  beat?.unref?.()
  try {
    const runBase = async (wtRoot, wtApp, files, ids) => {
      const l = await loadProjectChecks(wtApp, wtRoot, env, { interactive: false, say: () => {} })
      return runGate({ checks: ids ? checksNamed(l.checks, ids) : l.checks, files, repoRoot: wtRoot, appDir: wtApp, projectDir: appDir, env, tier, autoPacks: l.autoPacks, scratch: true, ...(progress ? { progress: (l) => progress(`base side: ${l}`) } : {}) })
    }
    const r = await hideBaseFindings({ out, mb: changed.mb, repoRoot, appDir, runBase })
    if (r.ok) out.hiddenRef = changed.ref
  } catch (e) {
    err(`meerkat gate: the findings already on ${changed.ref} could not be worked out (${String(e?.message ?? e).split(String.fromCharCode(10))[0]}), so all findings are shown`)
  } finally {
    clearInterval(beat)
  }
}

// The note config.mjs leaves when meerkat.config.json is not valid JSON (the file is then ignored), or null.
const unreadableConfig = (loaded) => (loaded?.notes ?? []).find((n) => /could not be read as JSON/.test(n)) ?? null

// What verdict and top read: the gate run on a folder, with the same new-findings rule, without printing. Returns { error, code } or { out, changed, appDir }.
export async function gatherGate(argv, { env = process.env, cwd = process.cwd(), err = () => {}, progress = null, maxSeconds = 0 } = {}) {
  const o = parseGateArgs(argv)
  if (o.errors.length) return { error: o.errors.join('; '), code: EXIT.usage }
  const appDir = o.app ? resolve(cwd, o.app) : resolve(appDirOf(env, cwd))
  const repoRoot = repoRootOf(appDir)
  const changed = gateFiles(repoRoot, o)
  if (changed.error) return { error: changed.error, code: EXIT.notRun }
  if (progress) err(mergeBaseLine(changed))
  const loaded = await loadProjectChecks(appDir, repoRoot, env, { interactive: false, say: err, all: o.all })
  const badConfig = unreadableConfig(loaded)
  if (badConfig) return { error: `${badConfig}. This command would ignore its config and could pass checks the config adds, so it stops here. Fix the file, or move it away to use the default checks`, code: EXIT.usage }
  try {
    const control = progress ? createControl() : null
    const undo = control ? stopOnSignals(control, err) : null
    let out
    try {
      out = await runGate({ checks: loaded.checks, files: changed.files, repoRoot, appDir, projectDir: appDir, env, all: o.all, useCache: false, autoPacks: loaded.autoPacks, ...(progress ? { progress, control, deadlineMs: (o.maxSeconds || maxSeconds || Number(env.MEERKAT_GATE_MAX_SECONDS) || 0) * 1000, heartbeatMs: Number(env.MEERKAT_GATE_HEARTBEAT_MS) || HEARTBEAT_MS } : {}) })
    } finally {
      undo?.()
    }
    if (out.stoppedEarly && progress) err(`stopped early: ${out.rows.filter((r) => r.kind === 'fail' || r.kind === 'crash').length} blocking so far, ${out.rows.filter((r) => !(r.kind === 'notrun' && STOPPED_RE.test(r.detail ?? ''))).length} of ${out.rows.length} checks finished`)
    await keepNewOnly(out, { o, changed, repoRoot, appDir, env, tier: 'fast', err, progress })
    return { out, changed, appDir, repoRoot, checks: loaded.checks }
  } finally {
    sweepSpawned()
  }
}

// gateMain(['--staged'], { smoke: false }) -> exit code. `log` and `err` are injectable for tests.
export async function gateMain(argv, { smoke = false, env = process.env, cwd = process.cwd(), log = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`), interactive, ask, banner = false } = {}) {
  const kind = smoke ? 'smoke' : 'gate'
  const o = parseGateArgs(argv, { smoke })
  if (o.errors.length) {
    err(`meerkat ${kind}: ${o.errors.join('; ')}`)
    return EXIT.usage
  }
  const realAppDir = o.app ? resolve(cwd, o.app) : resolve(appDirOf(env, cwd))
  const realRoot = repoRootOf(realAppDir)
  // One line naming the folder, its branch and whether it is a worktree. Only the real CLI asks for it (banner), and it goes straight to stderr, so stdout and the captured output of in-process callers stay exactly the gate output.
  if (banner) process.stderr.write(`${folderBanner(realAppDir)}\n`)
  const changed = gateFiles(realRoot, o)
  if (changed.error) {
    err(`meerkat ${kind}: ${changed.error}`)
    return EXIT.notRun
  }
  if (banner && !smoke) err(mergeBaseLine(changed))
  // --staged checks what is staged (the index version of each file), not the working tree.
  const snap = o.staged && !smoke && changed.files.length ? stagedSnapshot(realRoot, realAppDir, changed.files) : null
  const appDir = snap?.appDir ?? realAppDir
  const repoRoot = snap?.repoRoot ?? realRoot
  let loaded
  try {
    loaded = await loadProjectChecks(appDir, repoRoot, env, { interactive: o.noInput || o.json || o.format ? false : interactive, ask, say: err, all: o.all })
  } catch (e) {
    snap?.done()
    err(`meerkat ${kind}: the checks could not be loaded: ${String(e?.message ?? e)}`)
    return EXIT.notRun
  }
  const badConfig = unreadableConfig(loaded)
  if (badConfig) {
    snap?.done()
    err(`meerkat ${kind}: ${badConfig}. A ${kind} that ignored its config could pass checks the config adds, so it stops here (exit 2). Fix the file, or move it away to use the default checks.`)
    return EXIT.usage
  }
  const base = { checks: loaded.checks, files: changed.files, repoRoot, appDir, projectDir: realAppDir, env, tier: o.thorough ? 'thorough' : 'fast' }
  try {
    // The real CLI (banner) shows live progress, and stops cleanly on Ctrl-C or after --max-seconds / MEERKAT_GATE_MAX_SECONDS, keeping the results so far.
    const control = banner && !smoke ? createControl() : null
    const undo = control ? stopOnSignals(control, err) : null
    const limit = o.maxSeconds || Number(env.MEERKAT_GATE_MAX_SECONDS) || 0
    const beat = Number(env.MEERKAT_GATE_HEARTBEAT_MS) || HEARTBEAT_MS
    let out
    try {
      out = smoke ? await runSmoke({ ...base, seconds: o.seconds }) : await runGate({ ...base, all: o.all, useCache: !o.noCache && !snap, autoPacks: loaded.autoPacks, ...(banner ? { progress: err, control, deadlineMs: limit * 1000, heartbeatMs: beat } : {}) })
    } finally {
      undo?.()
    }
    if (!smoke) await keepNewOnly(out, { o, changed, repoRoot: realRoot, appDir: realAppDir, env, tier: base.tier, err, progress: banner ? err : null })
    const showWide = kind !== 'gate' || o.verbose || wideChanged(env, realAppDir, out)
    // Stopped by Ctrl-C or the per-run limit: say how far it got, with the blocking count of the checks that did finish.
    if (out.stoppedEarly && banner) {
      const finished = out.rows.filter((r) => !(r.kind === 'notrun' && STOPPED_RE.test(r.detail ?? '')))
      err(`stopped early: ${out.rows.filter((r) => r.kind === 'fail' || r.kind === 'crash').length} blocking so far, ${finished.length} of ${out.rows.length} checks finished`)
    }
    if (o.first) log(firstLine(out))
    else if (o.format === 'editor') for (const l of editorLines(out)) log(l)
    else log(o.json ? JSON.stringify(gateJson(kind, changed.desc, out, o.full), null, 2) : gateText(kind, out, changed.desc, { verbose: o.verbose || kind !== 'gate', showWide, full: o.full }))
    // --format github: workflow annotations on stdout and a Markdown block appended to the step summary (lib/github.mjs).
    if (o.format === 'github') {
      for (const l of gateAnnotations(out)) log(l)
      appendStepSummary(gateSummary(kind, out, changed.desc), env)
    }
    if (!out.runDir && !out.logDir) err(`note: this ${kind}'s logs were not saved (${logRoot(env)} is not a folder Meerkat can write to), so meerkat last, findings and why will not see it. Set MEERKAT_LOG_DIR to a folder you can write to.`)
    if (o.staged && !snap && !o.json && !smoke && o.format !== 'editor' && changed.files.length) log('note: the staged versions could not be exported, so the checks read the working tree (a file staged in part is checked as saved)')
    return control?.interrupted ? 130 : out.exitCode
  } finally {
    sweepSpawned()
    snap?.done()
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
