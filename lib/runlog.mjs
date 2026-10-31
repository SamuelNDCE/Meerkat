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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cleanText, stripControl } from './tui/safe.mjs'
import { isOwn, originLabel } from './customchecks.mjs'
import { rollup, SUB_BLOCK_MARK, subBlockText, subCounts, suiteRollup } from './subchecks.mjs'

export const logRoot = (env = process.env, home = homedir()) => resolve(env.MEERKAT_LOG_DIR || join(home, '.meerkat', 'logs'))

const pad = (n) => String(n).padStart(2, '0')
export const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

// Make this run's folder. Returns its path, or null if it cannot be made (a run is never stopped because logs could not be saved).
export function makeRunDir(env = process.env, tier = 'run', now = new Date(), home = homedir()) {
  try {
    const dir = join(logRoot(env, home), 'runs', `${stamp(now)}-${tier}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir.split('\\').join('/')
  } catch {
    return null
  }
}

const MAX_LOG_BYTES = 1_000_000

// The text of one check's log file.
export function checkLogText({ check, spec, result, code, ms, startedAt, output, subs = [], findingCount = 0 }) {
  const cmd = spec && typeof spec === 'object' ? [spec.cmd, ...(spec.args ?? [])].join(' ') : '(a function inside Meerkat, no command)'
  const text = String(output ?? '')
  const body = text.length > MAX_LOG_BYTES ? `[the first ${text.length - MAX_LOG_BYTES} characters were left out, the file keeps the last ${MAX_LOG_BYTES}]\n${text.slice(-MAX_LOG_BYTES)}` : text
  return [
    `check:     ${check.id}`,
    `title:     ${check.title ?? ''}`,
    `kind:      ${check.group ?? ''}   tier: ${check.tier ?? ''}   weight/lane: ${check.weight ?? ''}/${check.lane ?? ''}`,
    `command:   ${cmd}`,
    `folder:    ${spec?.cwd ?? ''}`,
    `result:    ${result.status}${result.detail ? ` (${stripControl(result.detail).slice(0, 300)})` : ''}`,
    `exit code: ${code ?? 'n/a'}`,
    `started:   ${new Date(startedAt ?? Date.now()).toISOString()}   ended: ${new Date((startedAt ?? Date.now()) + (ms ?? 0)).toISOString()}   took: ${(ms / 1000).toFixed(1)} s`,
    ...(findingCount > 0 ? [`findings:  ${findingCount} (see findings.md in this folder)`] : []),
    '--- output ---',
    body,
    ...(subs.length ? ['', subBlockText(subs)] : []),
  ].join('\n')
}

// The log of a check that could not run: the same header as any log, then why, so the reader is never left with no file.
export function notRunLogText({ check, result }) {
  const why = stripControl(result.detail ?? 'no reason was given')
  return [
    `check:     ${result.id}`,
    `title:     ${result.title ?? check?.title ?? ''}`,
    `kind:      ${check?.group ?? ''}   suite: ${result.suite ?? ''}`,
    `result:    NOT RUN (${why.slice(0, 300)})`,
    'exit code: n/a (the check never started)',
    `took:      ${((result.ms ?? 0) / 1000).toFixed(1)} s to decide it could not run`,
    '--- output ---',
    `This check did not run, so it is NOT RUN and never counted as a pass. Reason: ${why}`,
    'To run it: fix what is missing (the reason says what), then run the same command again.',
  ].join(String.fromCharCode(10))
}

// Writes a log for every NOT RUN result that has none, and returns the results with their logFile set.
export function saveNotRunLogs(dir, results, checks = []) {
  if (!dir) return results
  const byId = new Map(checks.map((c) => [c.id, c]))
  return results.map((r) => {
    if (!r || r.status !== 'NOT RUN' || r.logFile) return r
    const file = saveCheckLog(dir, r.id, notRunLogText({ check: byId.get(r.id), result: r }))
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
export function writeRunReport({ dir, tier, preset, results, line, exitCode, ms, argv = [], configFile = null, env = process.env, version = '', recorder = null, selection = null, scheduler = null, git = null, startedAtMs = null, freeMemGBAtStart = null, findingsInfo = null }) {
  if (!dir) return ''
  const events = recorder?.events ?? []
  const startOf = new Map(events.filter((e) => e.event === 'start').map((e) => [e.id, e.t]))
  const waited = {}
  for (const [id, w] of recorder?.waits ?? []) if (startOf.has(id)) waited[id] = { reason: w.reason, waitedMs: Math.max(0, startOf.get(id) - w.since) }
  const t0 = startedAtMs ?? events[0]?.t ?? Date.now()
  const done = results.filter(Boolean)
  const by = (s) => done.filter((r) => r.status === s)
  const machine = `${platform()} ${release()}, ${cpus().length} threads, ${Math.round(totalmem() / 2 ** 30)} GB, node ${process.version}`
  const md = []
  md.push(`# Meerkat run: ${preset ?? tier}`, '')
  md.push(`- result: **${exitCode === 0 ? 'all passed' : 'needs attention'}** (exit code ${exitCode})`)
  md.push(`- ${line}`)
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
    writeFileSync(join(dir, 'report.md'), report)
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify(
        { schema: 1, version, tier, preset: preset ?? null, summary: line, exitCode, startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + ms).toISOString(), ms, machine, freeMemGBAtStart, git, scheduler, selection, configFile, argv, waited, counts: { pass: by('PASS').length, fail: by('FAIL').length, notRun: by('NOT RUN').length }, files: findingsInfo ? { ...findingsInfo.files, report: findingsInfo.files.report } : undefined, findings: findingsInfo ? { total: findingsInfo.doc.counts.total, bySeverity: findingsInfo.doc.counts.bySeverity, new: findingsInfo.doc.counts.new, known: findingsInfo.doc.counts.known, fixed: findingsInfo.doc.counts.fixed } : undefined, subTotals: { total: totals.total, pass: totals.pass, fail: totals.fail, na: totals.na, checksWithSubs: totals.withSubs }, suites, results: done },
        null,
        2,
      ),
    )
    if (events.length) writeFileSync(join(dir, 'timeline.jsonl'), events.map((e) => JSON.stringify({ ...e, at: new Date(e.t).toISOString(), t: e.t - t0 })).join('\n') + '\n')
    writeFileSync(join(logRoot(env), 'latest.json'), JSON.stringify({ dir, at: new Date().toISOString() }))
  } catch {
    /* a report that cannot be written never changes the run's result */
  }
  return report
}

export function latestRunDir(env = process.env) {
  try {
    const dir = JSON.parse(readFileSync(join(logRoot(env), 'latest.json'), 'utf8')).dir
    return existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

// `--last`: the newest report. `--why <id>`: one check's log from the newest run (its header and the end of its output).
export function showLast(env = process.env) {
  const dir = latestRunDir(env)
  if (!dir) return { ok: false, text: `no run has been saved yet (logs go to ${logRoot(env)})` }
  try {
    return { ok: true, text: readFileSync(join(dir, 'report.md'), 'utf8') }
  } catch {
    return { ok: false, text: `the newest run (${dir}) has no report` }
  }
}

export function showWhy(id, env = process.env, lines = 80) {
  const dir = latestRunDir(env)
  if (!dir) return { ok: false, text: `no run has been saved yet (logs go to ${logRoot(env)})` }
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
