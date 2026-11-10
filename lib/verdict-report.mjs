// The verdict's report: the headline, the exact failure blocks, the labelled failure states (TOOL PROBLEM, NOT FINISHED, NOT RUN) and the
// internal-error path. Pure functions of the gate's rows; nothing here runs a check or decides the exit code (lib/branchcmds.mjs does).
// Every output format (text, --json, --format markdown, --format github) is built from the same report, so the verdict word, the status and
// the exit code can never differ between them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const MAX_BLOCKS = 20
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const SKIPPED_BY_LIMIT = /run deadline reached|interrupted by you/

// "(status 422)": the tag that ends the first words of every headline.
export const statusTag = (status) => `(status ${status})`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The report of one gate result. rows = the gate's rows. entries = the --known list (accepted places are left out). strict = pre-existing
// findings block too. isLayout(id) = checks about layout, not code. Returns { blocks, toolProblems, notFinished, notRun, files }.
export function collectReport(out, { entries = null, strict = false, isLayout = () => false, base = null } = {}) {
  const accepted = (id, p) => (entries ?? []).some((e) => e.check === id && e.file === p.file && (e.line === undefined || e.line === p.line))
  const blocks = []
  const toolProblems = []
  const notRun = []
  let unfinishedIds = []
  const rerun = (id) => `meerkat gate --only ${id}${base ? ` --base ${base}` : ''}`
  const findingOf = (r, p) => (r.findings ?? []).find((f) => f?.file && String(f.file).replace(/\\/g, '/').endsWith(p.file) && (Number(f.line) || 0) === (p.line || 0)) ?? (r.findings ?? [])[0]
  for (const r of out.rows ?? []) {
    if (r.kind === 'crash') {
      toolProblems.push({ check: r.id, detail: flat(r.detail).slice(0, 200) || 'the check crashed or its tool failed to start', rerun: rerun(r.id) })
    } else if (r.kind === 'notrun') {
      if (SKIPPED_BY_LIMIT.test(r.detail ?? '')) unfinishedIds.push(r.id)
      else notRun.push({ check: r.id, reason: flat(r.detail).slice(0, 160) || 'it could not run here' })
    } else if (r.kind === 'fail' && !(r.places?.length && out.baseState === 'unfinished')) {
      const places = r.places?.length ? r.places : [{ file: '(no file)', line: 0, message: r.detail || r.findings?.[0]?.message || r.id }]
      for (const p of places) {
        if (accepted(r.id, p)) continue
        const f = findingOf(r, p)
        blocks.push({ file: p.file || '(no file)', line: p.line || 0, rule: flat(f?.rule ?? f?.ruleId ?? r.id), severity: flat(f?.severity ?? 'error'), message: flat(p.message || r.detail || r.id), check: r.id, origin: 'new', rerun: rerun(r.id) })
      }
    } else if (strict && r.kind === 'wide' && !isLayout(r.id)) {
      for (const p of r.places ?? []) blocks.push({ file: p.file || '(no file)', line: p.line || 0, rule: flat(r.id), severity: 'error', message: flat(p.message || r.id), check: r.id, origin: 'pre-existing', rerun: rerun(r.id) })
    }
  }
  blocks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)))
  const total = (out.rows ?? []).length
  return { blocks, toolProblems, notRun, notFinished: { count: unfinishedIds.length, total, ids: unfinishedIds }, files: [...new Set(blocks.map((b) => b.file))] }
}

const where = (b) => `${b.file}${b.line ? `:${b.line}` : ''}`

// The text of the failure blocks: at most MAX_BLOCKS, each four lines, then a count of the rest.
export function blockLines(blocks, max = MAX_BLOCKS) {
  const lines = []
  for (const b of blocks.slice(0, max)) {
    lines.push(`${where(b)}  ${b.rule}  ${b.severity}`, `  ${b.message.slice(0, 200)}`, `  rerun: ${b.rerun}`, `  ${b.origin}`)
  }
  if (blocks.length > max) lines.push(`... and ${blocks.length - max} more (all of them are in --json)`)
  return lines
}

// The labelled lines for the states that are not code findings. A tool problem is never a finding; a check that did not finish is counted.
export function stateLines(report, { resumeCommand = null } = {}) {
  const lines = []
  for (const t of report.toolProblems) lines.push(`TOOL PROBLEM: check ${t.check} did not work (${t.detail}). This is not a finding in your code. rerun: ${t.rerun}`)
  if (report.notFinished.count) lines.push(`NOT FINISHED: ${report.notFinished.count} of ${report.notFinished.total} checks did not finish${resumeCommand ? `. rerun: ${resumeCommand}` : ''}`)
  for (const n of report.notRun.slice(0, MAX_BLOCKS)) lines.push(`NOT RUN: ${n.check}: ${n.reason}`)
  if (report.notRun.length > MAX_BLOCKS) lines.push(`NOT RUN: ... and ${report.notRun.length - MAX_BLOCKS} more`)
  return lines
}

const REASON_SENTENCE = {
  timeout: 'the time limit stopped the run',
  'lock-held': 'another job held the cargo lock for longer than the wait limit',
  interrupted: 'the run was interrupted',
  'tool-missing': 'a required tool is missing or failed to start',
  'tool-problem': 'a check crashed or its tool failed, so the run cannot be judged',
  'check-unfinished': 'some checks did not run or did not finish',
  unknown: 'the run stopped early',
}

// The first line of every answer: the answer in plain words, its status, and the single next action.
//   kind: 'PASS' | 'FAIL' | 'INCOMPLETE'. status: the HTTP-style status. next: one command or sentence.
export function headline({ kind, status, blocking = 0, files = 0, pre = 0, reason = null, notFinished = null, toolProblems = 0, next = null, strict = false }) {
  const tag = statusTag(status)
  if (kind === 'PASS') {
    const preText = pre > 0 ? `; ${plural(pre, 'pre-existing finding')} ${pre === 1 ? 'is' : 'are'} not in this change` : ''
    return `PASS${strict ? ' STRICT' : ''} ${tag}: nothing new blocks${preText}. Next: ${next ?? 'nothing to fix'}`
  }
  if (kind === 'FAIL') {
    const strictText = strict ? ' (strict: pre-existing findings count)' : ''
    return `FAIL${strict ? ' STRICT' : ''} ${plural(blocking, 'new blocking finding')} in ${plural(files, 'file')}${strictText} ${tag}. Next: ${next ?? 'fix the first block below, then run meerkat verdict again'}`
  }
  const why = REASON_SENTENCE[reason] ?? REASON_SENTENCE.unknown
  const count = notFinished && notFinished.count ? `; ${notFinished.count} of ${notFinished.total} checks did not finish` : toolProblems ? `; ${plural(toolProblems, 'check')} did not work` : ''
  return `INCOMPLETE ${tag}: ${why}${count}. Next: ${next ?? 'meerkat verdict --resume'}`
}

// The headline of a finished verdict, chosen from the exit code (1 FAIL, 75 INCOMPLETE, else PASS).
export function verdictHead({ code, incompleteCode, status, incompleteReason, failCount, report, strict, pre, toolOnly }) {
  if (code === 1) {
    const f = report.blocks[0]
    return headline({ kind: 'FAIL', status, blocking: failCount, files: Math.max(report.files.length, 1), strict, next: f ? `fix ${f.file}${f.line ? `:${f.line}` : ''}, then run meerkat verdict again` : null })
  }
  if (code === incompleteCode) return headline({ kind: 'INCOMPLETE', status, reason: incompleteReason ?? 'check-unfinished', notFinished: report.notFinished, toolProblems: report.toolProblems.length, next: toolOnly ? report.toolProblems[0].rerun : 'meerkat verdict' })
  return headline({ kind: 'PASS', status, pre, strict })
}

// "WORD: reason. next: cmd" (the lines noResult and the stale refusal print) as "WORD (status N): reason. Next: cmd".
export function headlineFromLine(line, status) {
  const m = /^(NO-RESULT|STALE|INCOMPLETE|PASS|WAITING)(?:: | )(.*)$/s.exec(String(line))
  if (!m) return `${line} ${statusTag(status)}`
  const body = m[2].replace(/\. next: /, '. Next: ')
  return `${m[1]} ${statusTag(status)}: ${body}`
}

// --format markdown: a pull request comment. Same headline, same blocks, plus the status tag.
const cell = (s) => flat(s).slice(0, 200).replace(/[\\`*_[\]()!<>#|&~]/g, '\\$&')
// Inline code that survives backticks and pipes in the text: a fence longer than any backtick run inside, pipes escaped for table cells.
const code = (s) => {
  const t = flat(s).replace(/\|/g, '\\|')
  const runs = t.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(0, ...runs.map((x) => x.length)) + 1)
  return `${fence} ${t} ${fence}`
}
const plain = (s) => flat(s).replace(/[\\`*_[\]<>|]/g, '\\$&')
export function markdownReport({ head, report, pre, rerun, extra = [], states = [] }) {
  const out = [`**Meerkat verdict: ${plain(head)}**`]
  for (const l of extra) out.push('', l)
  if (report.blocks.length) {
    out.push('', '| File | Line | Rule | Severity | Message | Origin | Rerun |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const b of report.blocks.slice(0, MAX_BLOCKS)) out.push(`| ${cell(b.file)} | ${b.line || ''} | ${cell(b.rule)} | ${cell(b.severity)} | ${cell(b.message)} | ${b.origin} | ${code(b.rerun)} |`)
    if (report.blocks.length > MAX_BLOCKS) out.push('', `and ${report.blocks.length - MAX_BLOCKS} more`)
  }
  if (states.length) out.push('', ...states.map((s) => `- ${cell(s)}`))
  if (pre !== null && pre !== undefined) out.push('', `Pre-existing findings (not in this diff, do not block): ${pre}`)
  if (rerun) {
    // A fenced block with a fence longer than any backtick run inside, so no command can close it early.
    const cmd = flat(rerun)
    const fence = '`'.repeat(Math.max(2, ...(cmd.match(/`+/g) ?? []).map((x) => x.length)) + 1)
    out.push('', 'Re-run:', '', fence, cmd, fence)
  }
  return out
}

// --format github: workflow commands. The headline is the ::notice:: (or ::error:: for a non-pass), so the status travels in this format too.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
export function githubReport({ head, kind, report, extra = [], states = [] }) {
  const out = report.blocks.slice(0, MAX_BLOCKS).map((b) => `::error file=${escProp(b.file)}${b.line ? `,line=${b.line}` : ''},title=${escProp(`${b.rule} ${b.severity}`)}::${escData(`${b.message} (${b.origin}; rerun: ${b.rerun})`)}`)
  for (const s of states) out.push(`::warning::${escData(s)}`)
  out.push(kind === 'FAIL' ? `::error::${escData(head)}` : kind === 'INCOMPLETE' ? `::warning::${escData(head)}` : `::notice::${escData(head)}`)
  for (const l of extra) out.push(`::notice::${escData(l)}`)
  return out
}

// An unexpected exception in Meerkat itself: the detail goes to a log file, the terminal gets one line and the log's path. Returns the headline.
export function logInternalError(e, { env = process.env, argv = [] } = {}) {
  const dir = env.MEERKAT_LOG_DIR ? resolve(env.MEERKAT_LOG_DIR) : join(homedir(), '.meerkat', 'logs')
  const file = join(dir, `verdict-error-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
  let saved = file
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `meerkat verdict ${argv.join(' ')}\n${e?.stack ?? e}\n`)
  } catch {
    saved = null
  }
  const short = flat(String(e?.message ?? e).split('\n')[0]).slice(0, 120)
  return { file: saved, short, line: `INCOMPLETE ${statusTag(500)}: Meerkat itself failed (${short}).${saved ? ` Details: ${saved}.` : ' The error log could not be written.'} Next: meerkat doctor` }
}
