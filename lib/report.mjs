// The end-of-run report, in the manner of the better test runners: one summary line with the counts and how many were slow,
// the slowest checks, and then ONLY what needs a look repeated in full: each failed check with its output file and the end
// of its output, each NOT RUN with the reason. A check that passed shows nothing more than its row in the table above
// (passing output is hidden). Pure: results in, lines out.
import { formatShort as formatDuration } from './progress.mjs'
import { tailOf } from './tui/index.mjs'
import { typicalMs } from './tui/model.mjs'
import { safeLogPath, stripControl } from './tui/safe.mjs'
import { countsText, groupResults, timeText } from './tui/group.mjs'
import { subSummaryText } from './subchecks.mjs'
import { isOwn } from './customchecks.mjs'

// A passing check is "slow" when it took this many times its usual time on this PC.
export const SLOW_FACTOR = 1.5

// The last lines of a check's output, not of its log header (the log starts with the command, folder and exit code).
const outputTail = (file) => {
  const lines = tailOf(file, 80)
  const at = lines.lastIndexOf('--- output ---')
  return at >= 0 ? lines.slice(at + 1) : lines
}

// How many of the results are your own checks (a personal or project check, lib/customchecks.mjs), from the result itself or its definition.
const ownCount = (done, checks) => {
  const own = new Set(checks.filter(isOwn).map((c) => c.id))
  return done.filter((r) => own.has(r.id) || isOwn(r)).length
}

// `checks` (the check definitions that ran) lets the summary name each result's kind; `grouped` is true, false or undefined (fold when
// there are more than 24 checks). Display only: the saved summary, report and timeline files are written from the full results.
export function finalReport({ results, tier, timings = { checks: {} }, totalMs, tail = outputTail, logTail = 0, env = process.env, checks = [], grouped, spans = null }) {
  const done = results.filter(Boolean)
  const count = (s) => done.filter((r) => r.status === s).length
  const slow = done.filter((r) => {
    const typical = typicalMs(timings, r.id, tier)
    return r.status === 'PASS' && typical !== null && r.ms > 2000 && r.ms > typical * SLOW_FACTOR
  })
  const lines = ['']
  lines.push(`SUMMARY [ ${formatDuration(totalMs)} ] ${done.length} checks${subSummaryText(done) ? ` (${subSummaryText(done)})` : ''}: ${count('PASS')} passed${slow.length ? ` (${slow.length} slow)` : ''}, ${count('FAIL')} failed, ${count('NOT RUN')} not run${ownCount(done, checks) ? `, ${ownCount(done, checks)} of them your own` : ''}`)
  // Above 24 checks the passed ones fold into one line per kind; failures and checks that did not run stay individual below.
  const cats = groupResults(done, { checks, grouped, spans })
  if (cats) for (const cat of cats) lines.push(`${cat.suite ? 'SUITE     ' : 'KIND      '}${cat.label.padEnd(26)} ${cat.suite ? `${cat.total} checks, ${cat.subTotal} sub-checks`.padEnd(28) : `${String(cat.total).padStart(3)} checks`}  ${countsText(cat.counts).replace(/  0 running  0 waiting$/, '')}  [ ${timeText(cat, formatDuration)} ]`)
  const slowest = [...done].filter((r) => r.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 3)
  if (slowest.length) lines.push(`SLOWEST   ${slowest.map((r) => `${r.id} ${formatDuration(r.ms)}`).join('  ·  ')}`)
  for (const r of slow) lines.push(`SLOW      ${r.id} took ${formatDuration(r.ms)}, usually ${formatDuration(typicalMs(timings, r.id, tier))}`)
  for (const r of done.filter((x) => x.status === 'FAIL')) {
    // The path is the runner's own field, and is opened only if it is inside Meerkat's log folder.
    const file = r.outputFile ? safeLogPath(r.outputFile, { env }) : null
    lines.push(`FAIL      ${r.id}: ${stripControl(String(r.detail ?? '').replace(/\s*\[full output: [^\]]+\]\s*$/, ''))}`)
    for (const x of (r.subs ?? []).filter((y) => y.status === 'FAIL').slice(0, 5)) lines.push(`          sub-check ${x.id}${x.reason ? `: ${stripControl(x.reason)}` : ''}`)
    if (file) {
      lines.push(`          output: ${stripControl(file)}`)
      // Output lines are not repeated here by default: the full log is one key away (meerkat why <check>, or the menu after a run).
      if (logTail > 0) for (const l of tail(file).slice(-logTail)) lines.push(`          | ${l}`)
    }
  }
  for (const r of done.filter((x) => x.status === 'NOT RUN')) lines.push(`NOT RUN   ${r.id}: ${stripControl(r.detail ?? '')}`)
  return lines
}
