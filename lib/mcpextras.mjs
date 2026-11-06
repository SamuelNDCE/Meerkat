// The read-only resources and the prompts of the MCP server (protocol 2025-11-25: server/resources and server/prompts).
// Resources only read files of the newest run in Meerkat's log folder. Prompts are text for the person to pick; they run nothing.
// Neither adds a tool or a write path: running a check still goes through meerkat_run, which the client asks the person to approve.
// Nothing here explains why a finding matters: a finding is shown as rule, evidence and place only.
const NAME = /^[a-z0-9][a-z0-9-]*$/
const REF_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/

export const RESOURCE_NOT_FOUND = -32002
const FINDINGS_URI = 'meerkat://run/latest/findings'
const REPORT_URI = 'meerkat://run/latest/report'
const LOG_PREFIX = 'meerkat://run/latest/log/'

export const RESOURCES = [
  { uri: FINDINGS_URI, name: 'latest-findings', title: 'Findings of the newest run', description: 'Every finding of the newest run (findings.json in the log folder): id, severity, rule, check, place, status and evidence. No explanations.', mimeType: 'application/json' },
  { uri: REPORT_URI, name: 'latest-report', title: 'Report of the newest run', description: "The newest run's report.md: the result, each failure with the end of its log, what could not run, and timings.", mimeType: 'text/markdown' },
]
export const RESOURCE_TEMPLATES = [
  { uriTemplate: `${LOG_PREFIX}{check}`, name: 'latest-check-log', title: 'Log of one check in the newest run', description: 'The log header and the end of the output of one check, for example meerkat://run/latest/log/build.', mimeType: 'text/plain' },
]

const PROMPT_ARGS_FOLDER = { name: 'folder', description: 'The project folder to check. Defaults to the folder the server was started in.', required: false }
export const PROMPTS = [
  { name: 'triage_newest_run', title: 'Triage the newest run', description: 'Go through the findings of the newest run, worst first.', arguments: [] },
  { name: 'check_one_fix', title: 'Check one fix', description: 'After a fix, run only the check that found it and confirm its finding is gone.', arguments: [{ name: 'check', description: 'The check id or suite/check that reported the finding, for example "build".', required: true }, PROMPT_ARGS_FOLDER] },
  { name: 'scan_diff', title: 'Scan the diff', description: 'Run the quick checks and keep only the findings in the files you changed.', arguments: [PROMPT_ARGS_FOLDER] },
]

const FORMAT = 'Show each finding as: the rule, the evidence (as given), the place, then a short bad example and a short good example of that rule. Do not add reasons or background.'

const message = (text) => ({ role: 'user', content: { type: 'text', text } })

function folderPart(args) {
  const f = args?.folder
  if (f === undefined || f === '') return { text: '' }
  if (typeof f !== 'string' || f.length > 500 || /[\0\r\n]/.test(f)) return { error: 'folder must be a short path on one line' }
  return { text: `, folder ${JSON.stringify(f)}` }
}

export function getPrompt(name, args = {}) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return { error: 'arguments must be an object' }
  const folder = folderPart(args)
  if (folder.error) return { error: folder.error }
  if (name === 'triage_newest_run') {
    return { description: 'Triage the newest run', messages: [message(`Read the resource ${FINDINGS_URI} (use ${REPORT_URI} for what failed or could not run). Go through the findings from the most severe down, one at a time. ${FORMAT} Do not change anything or run anything until I say which finding to fix.`)] }
  }
  if (name === 'check_one_fix') {
    const check = args.check
    if (typeof check !== 'string' || !REF_RE.test(check)) return { error: 'check is required: a check id such as "build" (lowercase letters, digits and dashes; suite/check also works)' }
    return { description: `Check one fix: ${check}`, messages: [message(`I have fixed a finding from the check "${check}". Call meerkat_run with only set to ["${check}"] and no other checks${folder.text}. Then read ${FINDINGS_URI} and say whether any finding of that check is still there. ${FORMAT} Only for findings still there. Do not run any other check or any other command.`)] }
  }
  if (name === 'scan_diff') {
    return { description: 'Scan the diff', messages: [message(`List the files I changed (your own git status or diff, asking me first if it needs approval). Then call meerkat_run with the preset "quick"${folder.text}, read ${FINDINGS_URI}, and keep only findings whose place is one of those files. ${FORMAT} If none are in those files, say so in one line.`)] }
  }
  return { missing: true }
}

// ctx.latestFindings() -> { ok, dir, doc } | { ok: false, text }; ctx.showLast(); ctx.showWhy(id, lines)
export function readResource(uri, ctx, safe) {
  const one = (v) => (typeof v === 'string' ? safe(v) : (v ?? null))
  if (uri === FINDINGS_URI) {
    const r = ctx.latestFindings?.()
    if (!r?.ok) return { error: r?.text ?? 'No run has been saved yet.' }
    const findings = r.doc.findings.map((f) => ({ id: f.id, severity: f.severity, rule: f.rule ?? null, check: f.check, suite: f.suite, file: one(f.file), line: f.line ?? null, status: f.status, message: one(f.message), ...(f.evidence ? { evidence: one(f.evidence) } : {}) }))
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ run: r.doc.run?.id ?? null, counts: r.doc.counts, findings }, null, 2) }] }
  }
  if (uri === REPORT_URI) {
    const r = ctx.showLast()
    return r.ok ? { contents: [{ uri, mimeType: 'text/markdown', text: safe(r.text) }] } : { error: r.text }
  }
  if (typeof uri === 'string' && uri.startsWith(LOG_PREFIX)) {
    const check = uri.slice(LOG_PREFIX.length)
    if (!NAME.test(check)) return { error: 'Resource not found' }
    const r = ctx.showWhy(check, 80)
    return r.ok ? { contents: [{ uri, mimeType: 'text/plain', text: safe(r.text) }] } : { error: r.text }
  }
  return { error: 'Resource not found' }
}
