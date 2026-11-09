// What a run leaves behind, so a failure can be understood long after the terminal is gone.
//   <log root>/runs/<date>-<time>-<tier>/
//       summary.json    for a program or an AI to read: every result with its command, exit code, start and end, how long and which log;
//                       what was chosen and skipped and why; why checks waited; the scheduler limits; the git commit; the machine
//       timeline.jsonl  one line per start and end, in order, with the time from the start of the run
//       report.md       for a person: what failed and why, with the last lines of each log, what could not run, a timeline table
//       <check>.log     for every check: the command, working folder, exit code, how long, then the full output
//   <log root>/latest.json   points at the newest run
// The log root is MEERKAT_LOG_DIR, else ~/.meerkat/logs. Nothing is written inside the project being checked.
// `node run.mjs --last` prints the newest report, `--why <check>` prints one check's log, `--logs` prints the folder.
import { execFileSync } from 'node:child_process'
import { cpus, homedir, platform, release, totalmem } from 'node:os'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { cleanText, stripControl } from './tui/safe.mjs'
import { readJsonStore } from './corrupt.mjs'
import { withFileLock, writeFileAtomic } from './lockfile.mjs'
import { isOwn, originLabel } from './customchecks.mjs'
import { VERSION } from './version.mjs'
import { attachRunDir } from './progresslog.mjs'
import { rollup, SUB_BLOCK_MARK, subBlockText, subCounts, suiteRollup } from './subchecks.mjs'

export const logRoot = (env = process.env, home = homedir()) => resolve(env.MEERKAT_LOG_DIR || join(home, '.meerkat', 'logs'))

const pad = (n) => String(n).padStart(2, '0')
export const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

// A short, safe name for the project a run was on: the folder's own name, lowercase, [a-z0-9-], at most 30 characters, else "project".
export function slugProject(name) {
  const s = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '')
  return s || 'project'
}

// The name and full path of the project a run was on, from the app folder.
// `id` names the run folders: the name plus a short hash of the full path, so two projects called "repo" never share runs.
export const pathHash = (path) => createHash('sha256').update(String(path).split('\\').join('/').replace(/\/+$/, '').toLowerCase()).digest('hex').slice(0, 6)
export function projectInfo(appDir) {
  if (!appDir) return null
  const path = resolve(String(appDir)).split('\\').join('/')
  const name = slugProject(basename(path))
  return { name, path, id: `${name}-${pathHash(path)}` }
}
// The project name inside a run folder's project part: `repo-1a2b3c` is `repo`; an older folder (no hash) comes back as it is.
export const runProjectName = (part) => (part == null ? null : String(part).replace(/-[0-9a-f]{6}$/, '') || String(part))

// Run folder names come in two shapes: `<stamp>-<tier>` (older runs) and `<stamp>-<project>-<tier>`. Returns { stamp, project, tier }.
// The tier is fast, thorough or run, optionally followed by -selftest; everything between the stamp and the tier is the project (null for the old shape).
export function parseRunName(name) {
  const m = /^(\d{8}-\d{6})(?:-(.*))?$/.exec(String(name ?? ''))
  if (!m) return { stamp: null, project: null, tier: null }
  const rest = m[2] ?? ''
  // Newest shape: `<stamp>-<project>--<command>` (a project name never holds two dashes in a row), so the folder says which command ran.
  if (/^-[a-z0-9][a-z0-9-]*$/.test(rest)) return { stamp: m[1], project: null, tier: rest.slice(1) }
  const named = /^(.+?)--([a-z0-9][a-z0-9-]*)$/.exec(rest)
  if (named) return { stamp: m[1], project: named[1], tier: named[2] }
  const t =/^(?:(.+)-)?((?:fast|thorough|run)(?:-selftest)?)$/.exec(rest)
  if (!t) return { stamp: m[1], project: null, tier: rest || null }
  return { stamp: m[1], project: t[1] ?? null, tier: t[2] }
}

// Run folder names, newest first. The stamp comes first in both shapes, so this is chronological.
export const sortRunNames = (names) => [...names].sort((a, b) => (parseRunName(b).stamp ?? '').localeCompare(parseRunName(a).stamp ?? '') || (b < a ? -1 : b > a ? 1 : 0))

// What a run folder's own name says about its project (the name only; the full path is in summary.json), or null for an older folder.
export function runDirProject(dir) {
  const p = parseRunName(basename(String(dir ?? '').replace(/[\\/]+$/, '')))
  return p.project ? { name: p.project, path: null } : null
}

// Make this run's folder. Returns its path, or null if it cannot be made (a run is never stopped because logs could not be saved).
// With a project (the app folder), the name says what it was run on: 20261031-091438-plume-thorough.
// `label` is the command or preset that was run (full, security, release): when it differs from the tier the folder is named after it.
export function makeRunDir(env = process.env, tier = 'run', now = new Date(), home = homedir(), appDir = null, label = null) {
  try {
    const p = projectInfo(appDir)
    const lab = label ? slugProject(label) : null
    const tail = lab && lab !== tier ? `${p ? p.id : ''}--${lab}` : `${p ? `${p.id}-` : ''}${tier}`
    const runs = join(logRoot(env, home), 'runs')
    mkdirSync(runs, { recursive: true, mode: 0o700 })
    // The folder name carries the second the run started. Two runs started in the same second on the same project (a hook and a hand run,
    // two agents) must not share a folder and overwrite each other's logs: take the first free second instead.
    for (let i = 0; i < 120; i++) {
      const dir = join(runs, `${stamp(new Date(now.getTime() + i * 1000))}-${tail}`)
      try {
        mkdirSync(dir, { mode: 0o700 })
        attachRunDir(dir.split('\\').join('/')) // lib/progresslog.mjs: starts the run's progress log when one is armed
        return dir.split('\\').join('/')
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e
      }
    }
    return null
  } catch {
    return null
  }
}

// Every run folder ends with a summary.json. A command that writes its own files (map, smoke, a gate that stopped early) calls this when it is
// done: if summary.json is already there nothing changes; if the folder holds nothing it is removed; otherwise a short complete summary is written.
// Returns 'kept', 'written' or 'removed'. Never throws: a summary that cannot be written is reported by the return value 'failed'.
export function sealRunDir(dir, { tier = 'run', preset = null, summary = '', exitCode = 0, status = 'complete', appDir = null, argv = [], startedAtMs = null, files = [] } = {}) {
  if (!dir) return 'removed'
  try {
    if (existsSync(join(dir, 'summary.json'))) return 'kept'
    if (!readdirSync(dir).length) {
      rmSync(dir, { recursive: true, force: true })
      return 'removed'
    }
    const now = Date.now()
    const t0 = startedAtMs ?? now
    const project = projectInfo(appDir) ?? runDirProject(dir) ?? undefined
    const doc = { schema: 1, version: VERSION, status, interrupted: false, project, tier, preset, summary, exitCode, startedAt: new Date(t0).toISOString(), endedAt: new Date(now).toISOString(), ms: now - t0, argv, counts: { pass: 0, fail: 0, notRun: 0, skipped: 0 }, files: files.length ? files : undefined, results: [] }
    writeFileAtomic(join(dir, 'summary.json'), JSON.stringify(doc, null, 2))
    return 'written'
  } catch {
    return 'failed'
  }
}

const MAX_LOG_BYTES = 1_000_000

// The text of one check's log file.
export function checkLogText({ check, spec, result, code, ms, startedAt, output, subs = [], findingCount = 0, project = null }) {
  const proj = project && typeof project === 'object' ? project : projectInfo(project)
  const cmd = spec && typeof spec === 'object' ? [spec.cmd, ...(spec.args ?? [])].join(' ') : '(a function inside Meerkat, no command)'
  const text = String(output ?? '')
  const body = text.length > MAX_LOG_BYTES ? `[the first ${text.length - MAX_LOG_BYTES} characters were left out, the file keeps the last ${MAX_LOG_BYTES}]\n${text.slice(-MAX_LOG_BYTES)}` : text
  return [
    ...(proj ? [`project:   ${proj.name}   (${proj.path})`] : []),
    `check:     ${check.id}`,
    `title:     ${check.title ?? ''}`,
    `kind:     ${check.group ?? ''}   tier: ${check.tier ?? ''}   weight/lane: ${check.weight ?? ''}/${check.lane ?? ''}`,
    `command:   ${cmd}`,
    `folder:    ${spec?.cwd ?? ''}`,
    `result:    ${result.status}${result.detail ? ` (${stripControl(result.detailFull ?? result.detail).slice(0, 8000)})` : ''}`,
    `exit code: ${code ?? 'n/a'}`,
    `started:   ${new Date(startedAt ?? Date.now()).toISOString()}   ended: ${new Date((startedAt ?? Date.now()) + (ms ?? 0)).toISOString()}   took: ${(ms / 1000).toFixed(1)} s`,
    ...(findingCount > 0 ? [`findings:  ${findingCount} (see findings.md in this folder)`] : []),
    '--- output ---',
    body,
    ...(subs.length ? ['', subBlockText(subs)] : []),
  ].join('\n')
}

// The log of a check that could not run: the same header as any log, then why, so the reader is never left with no file.
export function notRunLogText({ check, result, project = null }) {
  const why = stripControl(result.detail ?? 'no reason was given')
  return [
    ...(project ? [`project:   ${project.name}${project.path ? `   (${project.path})` : ''}`] : []),
    `check:     ${result.id}`,
    `title:     ${result.title ?? check?.title ?? ''}`,
    `kind:      ${check?.group ?? ''}   suite: ${result.suite ?? ''}`,
    `result:    NOT RUN (${why.slice(0, 8000)})`,
    'exit code: n/a (the check never started)',
    `took:      ${((result.ms ?? 0) / 1000).toFixed(1)} s to decide it could not run`,
    '--- output ---',
    `This check did not run, so it is NOT RUN and never counted as a pass. Reason: ${why}`,
    'To run it: fix what is missing (the reason says what), then run the same command again.',
  ].join(String.fromCharCode(10))
}

// Writes a log for every NOT RUN result that has none, and returns the results with their logFile set.
export function saveNotRunLogs(dir, results, checks = [], project = null) {
  if (!dir) return results
  const byId = new Map(checks.map((c) => [c.id, c]))
  const proj = project ?? runDirProject(dir)
  return results.map((r) => {
    if (!r || r.status !== 'NOT RUN' || r.logFile) return r
    const file = saveCheckLog(dir, r.id, notRunLogText({ check: byId.get(r.id), result: r, project: proj }))
    return file ? { ...r, logFile: file } : r
  })
}

export function saveCheckLog(dir, id, text) {
  if (!dir) return null
  try {
    const file = join(dir, `${id.replace(/[^a-z0-9._-]/gi, '_')}.log`).split('\\').join('/')
    writeFileSync(file, text)
    return file
  } catch {
    return null
  }
}

const tail = (text, n) => text.split('\n').slice(-n).join('\n')

function readTail(file, n) {
  try {
    const text = readFileSync(file, 'utf8')
    const at = text.indexOf('--- output ---\n')
    const body = at >= 0 ? text.slice(at + 15) : text
    const subAt = body.lastIndexOf(`\n${SUB_BLOCK_MARK}`)
    return tail((subAt >= 0 ? body.slice(0, subAt) : body).trimEnd(), n)
  } catch {
    return '(the log could not be read)'
  }
}

// Remembers when each check started and ended and why it waited, for the timeline in the report. Plug it into the runner's hooks.
export function createRecorder(now = Date.now) {
  const events = []
  const waits = new Map()
  return {
    events,
    waits,
    start(c) {
      events.push({ t: now(), event: 'start', id: c.id, lane: c.lane ?? null })
    },
    settle(c, r, ms) {
      // `files` (how many files the check examined) is there only when the check reported it.
      const sc = subCounts(r)
      events.push({ t: now(), event: 'end', id: c.id, status: r.status, ms, subs: { total: sc.total, pass: sc.pass, fail: sc.fail, na: sc.na }, ...(r.files ? { files: { total: r.files.total } } : {}) })
    },
    queue(w) {
      const t = now()
      for (const x of w ?? []) if (!waits.has(x.id)) waits.set(x.id, { reason: x.reason, since: t })
    },
  }
}

// Where the code being checked stands: enough to say which version a result belongs to.
export function gitInfo(repoRoot) {
  const git = (...a) => {
    try {
      return execFileSync('git', ['-C', repoRoot, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim()
    } catch {
      return null
    }
  }
  const status = git('status', '--porcelain')
  return { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), changedFiles: status === null ? null : status.split('\n').filter(Boolean).length }
}

// Write summary.json, report.md and timeline.jsonl, and point latest.json at this run. Returns the report text.
export function writeRunReport({ checks = [], interrupted = false, dir, tier, preset, results, line, exitCode, ms, argv = [], configFile = null, env = process.env, version = VERSION, recorder = null, selection = null, scheduler = null, git = null, startedAtMs = null, freeMemGBAtStart = null, findingsInfo = null, appDir = null, estimatedMs = null, runKey = null }) {
  if (!dir) return ''
  const fp = findingsInfo?.doc?.run?.project
  const project = projectInfo(appDir) ?? (fp?.path ? { name: slugProject(fp.name), path: fp.path } : null) ?? runDirProject(dir)
  const events = recorder?.events ?? []
  const startOf = new Map(events.filter((e) => e.event === 'start').map((e) => [e.id, e.t]))
  const waited = {}
  for (const [id, w] of recorder?.waits ?? []) if (startOf.has(id)) waited[id] = { reason: w.reason, waitedMs: Math.max(0, startOf.get(id) - w.since) }
  const t0 = startedAtMs ?? events[0]?.t ?? Date.now()
  const done = results.filter(Boolean)
  const by = (s) => done.filter((r) => r.status === s)
  // "incomplete": the run was stopped, or its deadline cut checks off, so what is saved is what finished (a check that cannot run for want of a tool is NOT RUN, but the run is complete).
  const incomplete = interrupted === true || done.some((r) => r.status === 'NOT RUN' && /run deadline reached|interrupted by you|timed out/i.test(String(r.detail ?? '')))
  const machine = `${platform()} ${release()}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GB, node ${process.version}`
  const md = []
  md.push(`# Meerkat run: ${preset ?? tier}${project ? ` on ${project.name}` : ''}`, '')
  if (project) md.push(`- project: ${project.name}${project.path ? ` (${project.path})` : ''}`)
  md.push(`- result: **${exitCode === 0 ? 'all passed' : 'needs attention'}** (exit code ${exitCode})`)
  md.push(`- ${line}`)
  if (incomplete && !interrupted) md.push('- **status: incomplete**: the run stopped early (its deadline or a time limit), so the results below are only the checks that finished. Checks marked NOT RUN did not run.')
  if (interrupted) md.push('- **stopped by you (Ctrl-C)**: checks marked interrupted did not run to the end. The results so far are kept.')
  md.push(`- ran: ${new Date().toISOString()}, took ${(ms / 1000).toFixed(0)} s`)
  if (done.some(isOwn)) md.push(`- your own checks: ${done.filter(isOwn).length} of ${done.length} (${done.filter(isOwn).map((r) => r.id).join(', ')})`)
  md.push(`- machine: ${machine}`)
  md.push(`- config: ${configFile ?? 'none (defaults)'}`)
  md.push(`- command: \`node run.mjs ${argv.join(' ')}\``)
  if (git?.commit) md.push(`- code: ${git.branch ?? '?'} at ${git.commit.slice(0, 10)}${git.changedFiles ? `, ${git.changedFiles} uncommitted file(s)` : ''}`)
  if (scheduler) md.push(`- scheduler: ${scheduler.slots} slots, at most ${scheduler.maxParallel} at once, ${scheduler.reserveGB} GB kept free${freeMemGBAtStart !== null ? ` (${freeMemGBAtStart.toFixed(1)} GB free at the start)` : ''}`)
  if (findingsInfo) md.push(`- ${findingsInfo.line}`)
  md.push('')
  if (selection) {
    md.push('## What was chosen', '', `- ran ${selection.ran.length}: ${selection.ran.join(', ') || 'none'}`)
    for (const [label, list] of [['skipped', selection.skipped], ['covered by a wider check', selection.covered], ['turned off in the config', selection.disabled]]) if (list?.length) md.push(`- ${label}: ${list.join(', ')}`)
    md.push('')
  }
  const totals = rollup(done)
  const suites = suiteRollup(done)
  if (suites.length) {
    md.push('## Suites', '', `${done.length} checks, ${totals.total} sub-checks: ${totals.pass} passed, ${totals.fail} failed, ${totals.na} not applicable here. A check that reports no rules counts as one sub-check.`, '', '| Suite | Checks | Sub-checks | Passed | Failed | Not applicable | Result |', '|---|---|---|---|---|---|---|')
    for (const s of suites) md.push(`| ${s.label} (${s.id}) | ${s.checks} | ${s.subTotal} | ${s.subPass} | ${s.subFail} | ${s.subNa} | ${s.checkFail || s.subFail ? 'FAIL' : s.notRun ? 'NOT RUN' : 'PASS'} |`)
    md.push('')
    const bad = suites.filter((s) => s.failedSubs.length)
    if (bad.length) {
      md.push('### Failed sub-checks', '')
      for (const s of bad) for (const f of s.failedSubs) md.push(`- ${s.id}/${f.check}/${f.id}: ${stripControl(f.reason || 'failed')}   (run it again: \`meerkat check ${s.id}/${f.check}/${f.id}\`)`)
      md.push('')
    }
  }
  if (by('FAIL').length) {
    md.push(`## Failed (${by('FAIL').length})`, '')
    for (const r of by('FAIL')) {
      md.push(`### ${r.id}${isOwn(r) ? ` (${originLabel(r.origin)})` : ''}`, '', `Why: ${stripControl(String(r.detail ?? '').replace(/\s*\[full output: [^\]]+\]\s*$/, ''))}`, `Took: ${(r.ms / 1000).toFixed(1)} s`)
      if (r.logFile) md.push(`Full log: ${r.logFile}`, '', 'Last lines of its output:', '', '```', cleanText(readTail(r.logFile, 30)).replace(/```/g, "'''"), '```')
      md.push('', `Run only this check again: \`node run.mjs --only ${r.id}\``, '')
    }
  }
  if (by('SKIPPED').length) {
    md.push(`## Skipped (${by('SKIPPED').length})`, '', 'A check that has nothing to look at in this project (for example, a style tool the project never configured) is SKIPPED. It is not a failure and not a pass:', '')
    for (const r of by('SKIPPED')) md.push(`- **${r.id}**: ${stripControl(r.detail ?? '')}`)
    md.push('')
  }
  if (by('NOT RUN').length) {
    md.push(`## Could not run (${by('NOT RUN').length})`, '', 'A check that could not start is reported, never passed. Each one says what is missing:', '')
    for (const r of by('NOT RUN')) md.push(`- **${r.id}**: ${stripControl(r.detail ?? '')}`)
    md.push('')
  }
  const slow = [...done].filter((r) => r.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 5)
  if (slow.length) md.push('## Slowest', '', ...slow.map((r) => `- ${r.id}: ${(r.ms / 1000).toFixed(1)} s`), '')
  if (events.length) {
    // One line per check, in start order: when it started and ended (seconds from the start of the run), and what it waited for.
    const ends = new Map(events.filter((e) => e.event === 'end').map((e) => [e.id, e]))
    md.push('## Timeline', '', 'Seconds from the start of the run.', '', '| Check | Started | Ended | Took | Result | Waited for |', '|---|---|---|---|---|---|')
    for (const e of events.filter((x) => x.event === 'start')) {
      const end = ends.get(e.id)
      const w = waited[e.id]
      md.push(`| ${e.id} | ${((e.t - t0) / 1000).toFixed(1)} | ${end ? ((end.t - t0) / 1000).toFixed(1) : '-'} | ${end ? (end.ms / 1000).toFixed(1) : '-'} | ${end?.status ?? 'unfinished'} | ${w && w.waitedMs > 500 ? `${(w.waitedMs / 1000).toFixed(0)} s: ${stripControl(w.reason ?? '')}` : ''} |`)
    }
    md.push('')
  }
  if (by('PASS').length) md.push(`## Passed (${by('PASS').length})`, '', by('PASS').map((r) => `${r.id} (${(r.ms / 1000).toFixed(1)} s)`).join(', '), '')
  const report = md.join('\n')
  try {
    writeFileAtomic(join(dir, 'report.md'), report)
    writeFileSync(join(dir, 'run.log'), runLogText({ dir, tier, preset, project, results: done, events, t0, ms, exitCode, line, argv, configFile, version, selection, scheduler, git, freeMemGBAtStart, estimatedMs, findingsInfo, checks, interrupted, machine }))
    writeFileAtomic(
      join(dir, 'summary.json'),
      JSON.stringify(
        { schema: 1, version, status: incomplete ? 'incomplete' : 'complete', interrupted: interrupted === true, project: project ?? undefined, tier, preset: preset ?? null, selfTest: isSelfTestRun({ preset, tier, runKey }) || undefined, summary: line, exitCode, startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + ms).toISOString(), ms, estimatedMs, machine, freeMemGBAtStart, git, scheduler, selection, configFile, argv, waited, counts: { pass: by('PASS').length, fail: by('FAIL').length, notRun: by('NOT RUN').length, skipped: by('SKIPPED').length }, files: findingsInfo ? { ...findingsInfo.files, report: findingsInfo.files.report } : undefined, findings: findingsInfo ? { total: findingsInfo.doc.counts.total, bySeverity: findingsInfo.doc.counts.bySeverity, new: findingsInfo.doc.counts.new, known: findingsInfo.doc.counts.known, fixed: findingsInfo.doc.counts.fixed } : undefined, subTotals: { total: totals.total, pass: totals.pass, fail: totals.fail, na: totals.na, checksWithSubs: totals.withSubs }, suites, results: done },
        null,
        2,
      ),
    )
    if (events.length) writeFileSync(join(dir, 'timeline.jsonl'), events.map((e) => JSON.stringify({ ...e, at: new Date(e.t).toISOString(), t: e.t - t0 })).join('\n') + '\n')
    // Written beside and renamed over, so a reader (or a second run finishing at the same moment) never sees half a file.
    // A self-test (smoke, red tests, --self-test) tests Meerkat, not the project: it never becomes "the last run" that findings, dismiss,
    // undismiss and suggest read. It is still remembered under its own preset key.
    if (!isSelfTestRun({ preset, tier, runKey })) {
      const pointer = join(logRoot(env), 'latest.json')
      writeFileAtomic(pointer, JSON.stringify({ dir, ...(project ? { project } : {}), at: new Date().toISOString() }))
      if (project?.name) rememberKeyedRun(env, 'latest-by-project.json', project.id ?? project.name, dir)
    }
    rememberPresetRun(env, runKey ? slugProject(runKey) : presetKey({ preset, tier }), dir)
  } catch {
    /* a report that cannot be written never changes the run's result */
  }
  return report
}

// run.log: the true log of the run, one timestamped line per fact, in the order they happened. Pure: data in, text out.
// report.md says what to do about a failure and timeline.jsonl is for a program; this is the plain record of how the run went.
export function runLogText({ dir, tier, preset, project, results, events, t0, ms, exitCode, line, argv = [], configFile = null, version = VERSION, selection = null, scheduler = null, git = null, freeMemGBAtStart = null, estimatedMs = null, findingsInfo = null, checks = [], interrupted = false, machine = '' }) {
  const byId = new Map(results.map((r) => [r.id, r]))
  const info = new Map(checks.map((c) => [c.id, c]))
  const rows = []
  const at = (t, text) => rows.push({ t, text })
  const secs = (v) => (v === null || v === undefined ? 'n/a' : `${(v / 1000).toFixed(1)} s`)
  const counts = findingsInfo?.doc?.counts?.byCheck ?? {}
  at(t0, `run started: ${preset ?? tier}${project ? ` on ${project.name}` : ''} (tier ${tier})`)
  if (project?.path) at(t0, `folder: ${project.path}`)
  at(t0, `Meerkat ${version}; ${machine}`)
  at(t0, `command: node run.mjs ${argv.join(' ')}; config: ${configFile ?? 'none (defaults)'}`)
  if (git?.commit) at(t0, `code: ${git.branch ?? '?'} at ${git.commit.slice(0, 10)}${git.changedFiles ? `, ${git.changedFiles} uncommitted file(s)` : ''}`)
  if (scheduler) at(t0, `scheduler: ${scheduler.slots} slots, at most ${scheduler.maxParallel} at once, ${scheduler.reserveGB} GB kept free${freeMemGBAtStart !== null ? ` (${freeMemGBAtStart.toFixed(1)} GB free)` : ''}`)
  if (selection) {
    at(t0, `checks chosen, in this order (${selection.ran.length}): ${selection.ran.join(', ') || 'none'}`)
    for (const [label, list] of [['skipped', selection.skipped], ['covered by a wider check', selection.covered], ['turned off in the config', selection.disabled]]) if (list?.length) at(t0, `${label} (${list.length}): ${list.join(', ')}`)
  }
  if (estimatedMs) at(t0, `estimated time for the whole run: ${secs(estimatedMs)}`)
  const ends = new Map(events.filter((e) => e.event === 'end').map((e) => [e.id, e]))
  for (const e of events) {
    const r = byId.get(e.id)
    const c = info.get(e.id)
    if (e.event === 'start') {
      at(e.t, `start  ${e.id}${e.lane ? ` (lane ${e.lane})` : ''}; estimate ${c?.estSeconds ? `${c.estSeconds} s` : 'n/a'}; time limit ${r?.limitMs ? secs(r.limitMs) : 'n/a'}${r?.idleKillMs ? `; idle-kill after ${secs(r.idleKillMs)} of silence` : ''}`)
    } else if (e.event === 'end') {
      const d = String(r?.detail ?? '')
      const flags = [/^timed out/.test(d) ? 'TIMED OUT' : null, /^no output for/.test(d) ? 'IDLE-KILLED (no output, probably stuck)' : null, /^skipped by you/.test(d) ? 'SKIPPED by you' : null].filter(Boolean)
      const sc = e.subs ?? {}
      at(e.t, `finish ${e.id}: ${e.status}; exit code ${r?.exitCode ?? 'n/a'}; took ${secs(e.ms)}; estimate ${c?.estSeconds ? `${c.estSeconds} s` : 'n/a'}; limit ${r?.limitMs ? secs(r.limitMs) : 'n/a'}${flags.length ? `; ${flags.join(', ')}` : ''}; sub-checks ${sc.pass ?? 0} passed, ${sc.fail ?? 0} failed, ${sc.na ?? 0} n/a; findings ${counts[e.id] ?? 0}${r?.logFile ? `; log ${r.logFile}` : ''}`)
    }
  }
  // A result with no start/finish events (it never started: NOT RUN before its turn) still gets its line.
  for (const r of results) if (!ends.has(r.id)) at(t0 + ms, `finish ${r.id}: ${r.status}; never started${r.detail ? `; ${stripControl(r.detail)}` : ''}${r.logFile ? `; log ${r.logFile}` : ''}`)
  if (findingsInfo) at(t0 + ms, `${findingsInfo.line}`)
  if (interrupted) at(t0 + ms, 'the run was stopped by the user (Ctrl-C); results so far are kept')
  const st = runState({ results, exitCode, findingsTotal: findingsInfo?.doc?.counts?.total ?? 0 })
  at(t0 + ms, `run state: ${st.state}${st.ids.length ? ` (${st.ids.join(', ')})` : ''}${st.why ? `; ${st.why}` : ''}`)
  at(t0 + ms, `run finished: exit code ${exitCode}; took ${secs(ms)}; ${line}`)
  rows.sort((a, b) => a.t - b.t)
  return `${rows.map((x) => `[${new Date(x.t).toISOString()}] +${((x.t - t0) / 1000).toFixed(1).padStart(7)} s  ${x.text}`).join('\n')}\n`
}

// How a run ended, for run.log: finished, stuck (a check was stopped after no output for the stall time), timed out (a check hit its time
// limit), or crashed (a non-zero exit with no findings behind it). Pure. Tested in that order, so one run gets one state.
export function runState({ results = [], exitCode = 0, findingsTotal = 0 } = {}) {
  const hit = (re) => results.filter((r) => re.test(String(r?.detail ?? '')))
  const stuck = hit(/^no output for/)
  if (stuck.length) return { state: 'stuck', ids: stuck.map((r) => r.id), why: 'no output for the stall time' }
  const slow = hit(/^timed out/)
  if (slow.length) return { state: 'timed out', ids: slow.map((r) => r.id), why: 'a check ran past its time limit' }
  const failed = results.filter((r) => r?.status === 'FAIL')
  if (exitCode !== 0 && exitCode !== 130 && findingsTotal === 0 && failed.length > 0) return { state: 'crashed', ids: failed.map((r) => r.id), why: 'non-zero exit with no findings' }
  return { state: 'finished', ids: [], why: '' }
}

// Adds one timestamped line to run.log (AI verification, for one, happens after the report is written). Never throws.
export function appendRunLog(dir, text) {
  try {
    appendFileSync(join(dir, 'run.log'), `[${new Date().toISOString()}] ${stripControl(text)}\n`)
  } catch {
    /* the log is a record, never a reason to fail */
  }
}

// The last run of each preset (or command, or tier), so a later run of another kind does not hide it.
export const presetKey = ({ preset, tier }) => slugProject(preset ?? tier ?? 'run')
const byPresetFile = (env) => join(logRoot(env), 'latest-by-preset.json')
function rememberKeyedRun(env, file, key, dir) {
  const path = join(logRoot(env), file)
  // Several runs finishing together each add their own key: read, change and write under a short lock (lib/lockfile.mjs).
  withFileLock(path, () => rememberKeyedRunLocked(path, key, dir))
}
function rememberKeyedRunLocked(path, key, dir) {
  const got = readJsonStore(path) // a damaged map is moved aside, not silently replaced by a new one
  let map = got.ok && got.value && typeof got.value === 'object' && !Array.isArray(got.value) ? got.value : {}
  map[key] = { dir, at: new Date().toISOString() }
  writeFileAtomic(path, JSON.stringify(map, null, 2))
}
const rememberPresetRun = (env, key, dir) => rememberKeyedRun(env, 'latest-by-preset.json', key, dir)

// Runs that test Meerkat itself. They never count as "the last run" for the commands that read a run's findings.
const SELF_TEST_NAMES = new Set(['smoke', 'red', 'redtest', 'selftest', 'self-test'])
export function isSelfTestRun({ preset = null, tier = null, runKey = null, selfTest = false, argv = [] } = {}) {
  const low = (v) => String(v ?? '').toLowerCase()
  return selfTest === true || low(runKey) === 'self-test' || SELF_TEST_NAMES.has(low(preset)) || SELF_TEST_NAMES.has(low(tier)) || low(tier).endsWith('-selftest') || (Array.isArray(argv) && argv.includes('--self-test'))
}
function isSelfTestDir(dir) {
  const name = parseRunName(basename(String(dir ?? '').replace(/[\\/]+$/, '')))
  if (name.tier && isSelfTestRun({ tier: name.tier })) return true
  try {
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    return isSelfTestRun({ preset: s?.preset, tier: s?.tier, selfTest: s?.selfTest, argv: s?.argv })
  } catch {
    return false
  }
}
// One line that says which run a read command used: the run folder name and its preset.
export function usedRunLine(dir) {
  let preset = null
  try {
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    preset = s?.preset ?? s?.tier ?? null
  } catch {
    /* an older or unfinished run has no summary */
  }
  return `using run ${stripControl(basename(String(dir).replace(/[\\/]+$/, '')))}${preset ? ` (preset ${stripControl(String(preset))})` : ''}`
}
export function presetRuns(env = process.env) {
  try {
    const got = readJsonStore(byPresetFile(env))
    const map = got.ok ? got.value : null
    return Object.entries(map ?? {}).filter(([, v]) => v && typeof v.dir === 'string' && existsSync(v.dir)).map(([key, v]) => ({ key, dir: v.dir, at: v.at }))
  } catch {
    return []
  }
}
export const latestRunDirOfPreset = (env = process.env, preset) => presetRuns(env).find((r) => r.key === slugProject(preset))?.dir ?? null

// Which run folder a tool means: `run` (a run folder name, or a path to one inside the log folder's runs/) beats `preset`; neither = the newest run.
export function pickRunDir(env = process.env, { run = null, preset = null, folder = null } = {}) {
  if (run) {
    const root = join(logRoot(env), 'runs')
    const name = basename(String(run).replace(/[\\/]+$/, ''))
    if (!/^[0-9A-Za-z._-]+$/.test(name)) return { ok: false, text: `"${stripControl(String(run))}" is not a run folder. See: meerkat run list` }
    let names = []
    try {
      names = readdirSync(root)
    } catch {
      /* no runs yet */
    }
    const starts = names.filter((n) => n.startsWith(name))
    const hit = names.includes(name) ? name : starts.length === 1 ? starts[0] : null
    return hit ? { ok: true, dir: join(root, hit).split('\\').join('/') } : { ok: false, text: `No run folder called "${stripControl(name)}" in ${root}. See: meerkat run list` }
  }
  if (preset) {
    const dir = folder ? latestRunDirForFolder(env, folder, { preset }) : latestRunDirOfPreset(env, preset)
    return dir ? { ok: true, dir } : { ok: false, text: `No run has been saved for the preset "${stripControl(String(preset))}" yet. Known: ${presetRuns(env).map((r) => r.key).join(', ') || 'none'}` }
  }
  const dir = latestRunDir(env, folder)
  return dir ? { ok: true, dir } : { ok: false, text: folder ? `no run has been saved for ${stripControl(String(folder))} yet (logs go to ${logRoot(env)}). Run: meerkat verify` : `no run has been saved yet (logs go to ${logRoot(env)})` }
}

// The newest real run of one folder (matched by the hash of its full path in the folder name; an older folder name is matched by its summary's path).
export function latestRunDirForFolder(env = process.env, folder, { preset = null, withFindings = false } = {}) {
  const p = projectInfo(folder)
  if (!p) return null
  const root = join(logRoot(env), 'runs')
  const want = preset ? slugProject(preset) : null
  try {
    for (const n of sortRunNames(readdirSync(root))) {
      const parsed = parseRunName(n)
      const dir = join(root, n).split('\\').join('/')
      if (parsed.project !== p.id) {
        // An older folder name (no hash, or no project at all): it is this folder's only when the path the run saved says so.
        if (parsed.project !== null && parsed.project !== p.name) continue
        let sp = null
        for (const f of ['summary.json', 'findings.json']) {
          try {
            const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
            sp = j?.project?.path ?? j?.run?.project?.path ?? null
          } catch {
            /* try the next file */
          }
          if (sp) break
        }
        if (!sp || pathHash(sp) !== pathHash(p.path)) continue
      }
      if (isSelfTestDir(dir)) continue
      // A run with no findings.json (a map run, say) has nothing to read: skip it for commands that read findings.
      if (withFindings && !existsSync(join(dir, 'findings.json'))) continue
      if (want) {
        let sp = null
        try {
          sp = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
        } catch {
          continue
        }
        if (slugProject(sp?.preset ?? sp?.tier ?? 'run') !== want) continue
      }
      return dir
    }
  } catch {
    /* no runs yet */
  }
  return null
}

// With a folder: the newest run of that folder only. Without: the newest run of any project (the old behaviour, kept for callers that have no folder).
export function latestRunDir(env = process.env, folder = null, { withFindings = false } = {}) {
  if (folder) return latestRunDirForFolder(env, folder, { withFindings })
  if (withFindings) {
    const first = latestRunDir(env, null)
    if (first && existsSync(join(first, 'findings.json'))) return first
    // The newest run has no findings.json (a map run, say): the newest run that has one.
    try {
      const root = join(logRoot(env), 'runs')
      const hit = sortRunNames(readdirSync(root)).find((n) => !isSelfTestDir(join(root, n)) && existsSync(join(root, n, 'findings.json')))
      return hit ? join(root, hit).split(String.fromCharCode(92)).join('/') : null
    } catch {
      return null
    }
  }
  const ptr = readJsonStore(join(logRoot(env), 'latest.json')) // a damaged pointer is moved aside and said so
  const dir = ptr.ok ? ptr.value?.dir : null
  if (typeof dir === 'string' && existsSync(dir) && !isSelfTestDir(dir)) return dir
  // The pointer was left on a self-test by an older Meerkat (or is missing): the newest run of any real preset instead.
  const real = presetRuns(env).filter((r) => !isSelfTestDir(r.dir)).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  if (real[0]) return real[0].dir
  // The pointer was damaged: the run folders themselves still say which run is newest.
  if (ptr.corrupt) {
    try {
      const root = join(logRoot(env), 'runs')
      const hit = sortRunNames(readdirSync(root)).find((n) => !isSelfTestDir(join(root, n)))
      if (hit) return join(root, hit).split('\\').join('/')
    } catch {
      /* no runs folder */
    }
  }
  return null
}

// The newest run folder of one project, by the project name (any case, or a path: its last part is used). Null when there is none.
export function latestRunDirOf(env = process.env, project) {
  const want = slugProject(basename(String(project ?? '').replace(/[\\/]+$/, '')))
  try {
    const root = join(logRoot(env), 'runs')
    const hit = sortRunNames(readdirSync(root)).find((n) => runProjectName(parseRunName(n).project) === want && !isSelfTestDir(join(root, n)))
    return hit ? join(root, hit).split('\\').join('/') : null
  } catch {
    return null
  }
}

// `--last`: the newest report (of one project when it is named). `--why <id>`: one check's log from the newest run (its header and the end of its output).
export function showLast(env = process.env, project = null, pick = {}) {
  if (pick.run || pick.preset || (pick.folder && !project)) {
    const p = pickRunDir(env, pick)
    if (!p.ok) return p
    try {
      return { ok: true, text: readFileSync(join(p.dir, 'report.md'), 'utf8') }
    } catch {
      return { ok: false, text: `the run (${p.dir}) has no report` }
    }
  }
  const dir = project ? latestRunDirOf(env, project) : latestRunDir(env)
  if (!dir) return { ok: false, text: project ? `no run has been saved for the project "${stripControl(String(project))}" yet. See: meerkat run list` : `no run has been saved yet (logs go to ${logRoot(env)})` }
  try {
    return { ok: true, text: readFileSync(join(dir, 'report.md'), 'utf8') }
  } catch {
    return { ok: false, text: `the newest run (${dir}) has no report` }
  }
}

export function showWhy(id, env = process.env, lines = 80, pick = {}) {
  const p = pickRunDir(env, pick)
  if (!p.ok) return p
  const dir = p.dir
  const base = id.replace(/[^a-z0-9._-]/gi, '_')
  const file = [join(dir, `${base}.log`), join(dir, `${base}.selftest.log`)].find((f) => existsSync(f)) ?? join(dir, `${base}.log`)
  if (!existsSync(file)) {
    const have = readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => f.replace(/\.log$/, ''))
    return { ok: false, text: `the newest run has no log for "${id}". It has: ${have.join(', ') || 'none'}` }
  }
  const text = readFileSync(file, 'utf8')
  const at = text.indexOf('--- output ---\n')
  const head = at >= 0 ? text.slice(0, at) : ''
  return { ok: true, text: `${cleanText(head)}\n--- last ${lines} lines of output (full log: ${file}) ---\n${cleanText(readTail(file, lines))}` }
}
