// The AI prompt of a run: `ai-prompt.md` in the run folder, written for an AI that has never seen Meerkat (docs/reference.md, "AI prompts and
// verification"). buildAiPrompt is a pure function: the run's data in, markdown out. Nothing is cut: every message, explanation and fix is
// written in full (the caps are the ones in docs/findings.md, 8000 characters per message). writeAiPrompt / promptForRun do the I/O.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readFindings } from './findingsdoc.mjs'
import { SEVERITIES } from './findings.mjs'
import { stripControl } from './tui/safe.mjs'
import { writeAtomic } from './findingshistory.mjs'

export const PROMPT_FILE = 'ai-prompt.md'
export const VERDICT_FALSE = 'probably false alarm'
const clean = (t) => stripControl(String(t ?? ''))
const SLASH = (p) => String(p ?? '').split('\\').join('/')

const SEVERITY_MEANING = {
  critical: 'must be fixed first: a leaked secret, a serious security hole, or something that breaks the project outright',
  high: 'a real problem that is likely to cause harm or a failure: fix it soon',
  medium: 'worth fixing: a defect, a risk, or a correctness problem with a limited effect',
  low: 'a minor issue or a style or hygiene point: fix it if it is cheap, and do not treat it as a bug',
  info: 'for information only: not a bug and not a failure; mention it, do not "fix" it unless it is clearly wrong',
}

export const shortPromptText = (file) => `This is a Meerkat report. Read the full prompt in ${SLASH(resolve(String(file)))} and follow it.`

const dur = (ms) => {
  if ((ms ?? 0) < 10000) return `${((ms ?? 0) / 1000).toFixed(1)} s`
  const s = Math.round((ms ?? 0) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
}

// A finding the AI should check before believing it: its own confidence is low, or the optional AI verification judged it a false alarm.
export const isDoubtful = (f) => f.confidence === 'low' || f.aiVerdict === VERDICT_FALSE

function entry(f, n) {
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}${f.occurrences > 1 ? ` (and ${f.occurrences - 1} more place(s)${f.lines?.length > 1 ? `: lines ${f.lines.join(', ')}` : ''})` : ''}` : '(no file: the check reported this for the project as a whole)'
  const by = f.detectedBy ?? {}
  const out = [`#### Finding ${n}: [${f.severity}] ${clean(f.title)}`, '']
  out.push(`- id: ${f.id}`)
  out.push(`- rule: ${f.rule ?? '(none)'}`)
  out.push(`- check: ${f.check}${by.checkTitle ? ` (${clean(by.checkTitle)})` : ''}   suite: ${f.suite}`)
  out.push(`- where: ${where}`)
  if (f.evidence) out.push(`- the code line: \`${clean(f.evidence).replace(/`/g, "'")}\``)
  out.push(`- message (in full): ${clean(f.message)}`)
  out.push(`- why it matters: ${f.explanation ? clean(f.explanation) : `(no explanation was recorded; the check "${f.check}" in the "${f.suite}" suite reported it)`}`)
  out.push(`- suggested fix: ${f.fix ? clean(f.fix) : '(the check gave no fix; work it out from the code)'}`)
  out.push(`- confidence: ${f.confidence}${f.confidence === 'high' ? ' (the check itself reported this as a finding)' : f.confidence === 'medium' ? ' (read from the check\'s output, so the location or wording may be approximate: verify it)' : ' (low: it may be wrong)'}`)
  out.push(`- new since the last run: ${f.status === 'new' ? 'yes' : 'no, it was already there'}`)
  if (f.aiVerdict) out.push(`- AI verification: ${f.aiVerdict}${f.aiReason ? `: ${clean(f.aiReason)}` : ''} (a model's opinion, not proof: still read the code)`)
  if (f.rawOutput?.length) out.push('- raw output of the tool:', '', '```', ...f.rawOutput.map((l) => clean(l).replace(/```/g, "'''")), '```')
  out.push(`- log file of the check: ${f.logFile ? SLASH(f.logFile) : '(none)'}`, '')
  return out
}

// doc = findings.json (readFindings), summary = summary.json or null. Returns the markdown.
export function buildAiPrompt({ doc, summary = null, runDir = null }) {
  const run = doc.run
  const dir = SLASH(runDir ?? run.dir ?? '')
  const findings = doc.findings ?? []
  const doubtful = findings.filter(isDoubtful)
  const firm = findings.filter((f) => !isDoubtful(f))
  const md = []
  md.push('# A Meerkat report: read this and act on it', '')
  md.push('## 1. What Meerkat is', '')
  md.push('This is a report from Meerkat (https://github.com/SamuelNDCE/Meerkat), a verification tool that runs checks on a project; the repository README explains the tool.', '')
  md.push('Meerkat runs many checks on a project folder: its own tests and linters, security and secret scans, dependency and licence checks, code-quality and robustness rules, UI and accessibility rules, and more. A check is one program or script. Many checks contain sub-checks (single rules); a sub-check passes, fails, or is "not applicable" when the project has nothing of that kind. Checks are grouped into suites (for example secrets, risky calls, dependencies), and a preset is a ready-made list of checks.')
  md.push('Every problem a check detects is a finding with a severity: critical, high, medium, low or info (section 3 says what each means). **NOT RUN means the check could not run** (a tool was missing, a time limit passed, or the user stopped it). It is NOT a pass: nothing is known about those checks, and you must not read it as "no problems there".', '')
  md.push('## 2. This run', '')
  md.push(`- project: ${clean(run.project?.name)}`, `- folder: ${clean(run.project?.path)}`, `- preset / tier: ${clean(run.preset ?? run.tier)}`, `- date: ${clean(run.startedAt)}`, `- Meerkat version: ${clean(doc.meerkat?.version)}`)
  const est = summary?.estimatedMs
  md.push(`- duration: ${dur(run.ms)}${est ? ` (Meerkat had estimated ${dur(est)})` : ' (no estimate was recorded)'}`)
  const c = doc.counts
  md.push(`- findings: ${c.total} in total (${SEVERITIES.map((s) => `${c.bySeverity?.[s] ?? 0} ${s}`).join(', ')}); ${c.new} new, ${c.known} known from the previous run, ${c.fixed} fixed since it`)
  if (summary?.counts) md.push(`- checks: ${summary.counts.pass} passed, ${summary.counts.fail} failed, ${summary.counts.notRun} NOT RUN`)
  if (summary?.subTotals) md.push(`- sub-checks: ${summary.subTotals.total} in all, ${summary.subTotals.pass} passed, ${summary.subTotals.fail} failed, ${summary.subTotals.na} not applicable`)
  if (summary?.git?.commit) md.push(`- code state: branch ${summary.git.branch ?? '?'} at ${summary.git.commit.slice(0, 10)}${summary.git.changedFiles ? `, ${summary.git.changedFiles} uncommitted file(s)` : ''}`)
  md.push(`- run folder: ${dir || '(unknown)'}  (findings.json is the full machine-readable list; findings.md and report.md are for reading; run.log is the true log of the run; each check has its own <check>.log)`, '')
  md.push('## 3. How to read a finding', '')
  md.push('Each finding below has these fields:', '', '- id: a stable 16-character fingerprint (the same problem keeps its id between runs)', '- rule: the rule that fired (a sub-check), or "(none)"', '- check and suite: which check found it, and the group it belongs to', '- where: file:line (line 0 or no line means the whole file or the whole project)', '- the code line: the source line, when Meerkat could show it safely', '- message (in full): exactly what the check said; nothing is shortened', '- why it matters: what the rule and suite are for', '- suggested fix: the check\'s own hint, when it has one', '- confidence: high = the check reported it as a finding; medium = Meerkat read it from the check\'s output; low = may be wrong', '- new since the last run: yes or no', '- AI verification: present only when an optional model judged it (real, probably false alarm, or unsure); it is an opinion', '- log file of the check: the full output of the check that found it (open it when the message is not enough)', '')
  md.push('Severity:', '', ...SEVERITIES.map((s) => `- ${s}: ${SEVERITY_MEANING[s]}`), '')
  md.push('Findings of severity low and info are labelled as such. Do not describe them as bugs unless the code shows a real defect.', '')

  md.push(`## 4. The findings (${firm.length})`, '')
  if (!findings.length) md.push('Nothing was detected in this run.', '')
  let n = 0
  for (const sev of SEVERITIES) {
    const list = firm.filter((f) => f.severity === sev)
    if (!list.length) continue
    md.push(`### ${sev.toUpperCase()} (${list.length}): ${SEVERITY_MEANING[sev]}`, '')
    for (const f of list) md.push(...entry(f, ++n))
  }
  if (doubtful.length) {
    md.push(`## 5. Check these first, they may be false alarms (${doubtful.length})`, '')
    md.push('These findings have low confidence, or an optional AI check judged them probable false alarms. They are listed in full and are not deleted. Read the code first; say clearly which are false alarms and show the evidence.', '')
    for (const f of doubtful) md.push(...entry(f, ++n))
  } else md.push('## 5. Check these first, they may be false alarms (0)', '', 'No finding was flagged as a probable false alarm.', '')

  const withFindings = new Set(findings.map((f) => f.check))
  const failedBare = (summary?.results ?? []).filter((r) => r?.status === 'FAIL' && !withFindings.has(r.id))
  md.push(`## 6. Checks that failed but produced no findings (${failedBare.length})`, '')
  if (failedBare.length) for (const r of failedBare) md.push(`- ${r.id}${r.title ? ` (${clean(r.title)})` : ''}: ${clean(String(r.detailFull ?? r.detail ?? 'no reason was recorded').replace(/\s*\[full output: [^\]]+\]\s*$/, ''))}${r.logFile ? `   log: ${SLASH(r.logFile)}` : ''}`)
  else md.push('None: every failed check is represented by findings above.')
  md.push('')

  const notRun = doc.notRun ?? []
  md.push(`## 7. NOT RUN: checks that could not run (${notRun.length})`, '')
  if (notRun.length) {
    md.push('Nothing is known about these. They are not passes.', '')
    for (const x of notRun) {
      const r = (summary?.results ?? []).find((y) => y?.id === x.check)
      const install = x.install ?? r?.install ?? null
      md.push(`- ${x.check}${x.title ? ` (${clean(x.title)})` : ''}: ${clean(x.reason)}${install ? `   to make it runnable: ${clean(install)}` : ''}${x.logFile ?? r?.logFile ? `   log: ${SLASH(x.logFile ?? r.logFile)}` : ''}`)
    }
  } else md.push('Every selected check ran.')
  md.push('')

  md.push('## 8. What to do', '')
  md.push(
    '1. Read the code before changing anything. For each finding, open the file at the line given (and the check\'s log if the message is not enough) and decide whether the problem is real.',
    '2. Say which findings are false positives, with the evidence (the code you read and why it is fine). Do not silently skip any finding, and do not "fix" a false positive.',
    '3. Fix the true ones, starting with the highest severity (critical, then high, then medium). Low and info items only when cheap and clearly right.',
    '4. Do not touch unrelated code. Keep each change small and explain it.',
    '5. Do not suppress a check, add an allow-list entry or weaken a rule just to make a finding go away, unless you have shown it is a false positive.',
    `6. When you are done, run \`meerkat verify\` again in ${clean(run.project?.path) || 'the project folder'} to confirm that the fixed findings are gone and nothing new appeared. (Checks in section 7 will stay NOT RUN until their tool is installed.)`,
    '7. Report: what you checked, what was a false alarm (with evidence), what you fixed, what you left and why, and the result of the second run.',
    '',
  )
  return md.join('\n')
}

// Reads the run folder and writes ai-prompt.md in it. Returns { ok, file, text, doc } or { ok: false, text }.
export function writeAiPrompt(runDir, { io = {} } = {}) {
  const dir = String(runDir ?? '')
  const doc = dir ? readFindings(dir) : null
  if (!doc) return { ok: false, text: `The run ${clean(dir)} has no findings.json (it was saved by an older Meerkat, or the run did not finish), so there is nothing to write a prompt from.` }
  let summary = null
  try {
    summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
  } catch {
    /* the prompt is still written without the extra run facts */
  }
  const text = buildAiPrompt({ doc, summary, runDir: dir })
  const file = SLASH(resolve(join(dir, PROMPT_FILE)))
  if (!writeAtomic(file, text, io)) return { ok: false, text: `Could not write ${clean(file)}` }
  return { ok: true, file, text, doc, short: shortPromptText(file) }
}

export const hasPrompt = (dir) => {
  try {
    return existsSync(join(dir, PROMPT_FILE)) && statSync(join(dir, PROMPT_FILE)).isFile()
  } catch {
    return false
  }
}
