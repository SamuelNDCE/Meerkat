// The read-only resources and the prompts of the MCP server (protocol 2025-11-25: server/resources and server/prompts).
// Resources only read files of the newest run in Meerkat's log folder. Prompts are text for the person to pick; they run nothing.
// Neither adds a tool or a write path: running a check still goes through meerkat_run, which the client asks the person to approve.
// Nothing here explains why a finding matters: a finding is shown as rule, evidence and place only.
const NAME = /^[a-z0-9][a-z0-9-]*$/
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$/
const REF_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/

export const RESOURCE_NOT_FOUND = -32002
const FINDINGS_URI = 'meerkat://run/latest/findings'
const REPORT_URI = 'meerkat://run/latest/report'
const LOG_PREFIX = 'meerkat://run/latest/log/'
const MAP_URI = 'meerkat://map/latest'
const CATALOG_URI = 'meerkat://tests/catalog'

export const RESOURCES = [
  { uri: FINDINGS_URI, name: 'latest-findings', title: 'Findings of the newest run', description: 'Every finding of the newest run (findings.json in the log folder): id, severity, rule, check, place, status and evidence. No explanations.', mimeType: 'application/json' },
  { uri: REPORT_URI, name: 'latest-report', title: 'Report of the newest run', description: "The newest run's report.md: the result, each failure with the end of its log, what could not run, and timings.", mimeType: 'text/markdown' },
  { uri: MAP_URI, name: 'latest-codemap', title: 'Code map of the newest map', description: 'codemap.md of this project from the newest meerkat_map (or `meerkat map`): files with functions and line numbers, routes, tests, imports and the most imported files. Call meerkat_map first (it refreshes a stale map) if none exists.', mimeType: 'text/markdown' },
  { uri: CATALOG_URI, name: 'test-catalog', title: 'Catalog of the checks', description: 'Every kind of check, family and check Meerkat has, what each proves, its cost and when it runs (commit, pr, gate, promote). Same as meerkat_tests with detail "full".', mimeType: 'application/json' },
]
export const RESOURCE_TEMPLATES = [
  { uriTemplate: `${FINDINGS_URI}{?folder,run,preset}`, name: 'findings-of-a-run', title: 'Findings of a run of one project', description: 'The same as latest-findings, for the project in folder (inside the folder the server was started in or one added with meerkat root add), optionally a run (run folder name) or the newest run of a preset, for example meerkat://run/latest/findings?folder=%2Fwork%2Fproj&preset=quick. Without folder it is the newest run of any project.', mimeType: 'application/json' },
  { uriTemplate: `${LOG_PREFIX}{check}`, name: 'latest-check-log', title: 'Log of one check in the newest run', description: 'The log header and the end of the output of one check, for example meerkat://run/latest/log/build.', mimeType: 'text/plain' },
]

const PROMPT_ARGS_FOLDER = { name: 'folder', description: 'The project folder to check. Defaults to the folder the server was started in.', required: false }
export const PROMPTS = [
  { name: 'triage_newest_run', title: 'Triage the newest run', description: 'Go through the findings of the newest run, worst first.', arguments: [] },
  { name: 'check_one_fix', title: 'Check one fix', description: 'After a fix, run only the check that found it and confirm its finding is gone.', arguments: [{ name: 'check', description: 'The check id or suite/check that reported the finding, for example "build".', required: true }, PROMPT_ARGS_FOLDER] },
  { name: 'scan_diff', title: 'Scan the diff', description: 'Run the quick checks and keep only the findings in the files you changed.', arguments: [PROMPT_ARGS_FOLDER] },
  { name: 'pre_commit_check', title: 'Check before a commit', description: 'Gate the staged files and report whether it is safe to commit.', arguments: [PROMPT_ARGS_FOLDER] },
  { name: 'pre_pr_check', title: 'Check before a pull request', description: 'Gate everything changed on this branch against the base ref and report whether it is ready for a PR.', arguments: [{ name: 'base', description: 'The git ref the PR targets. Default "origin/main".', required: false }, PROMPT_ARGS_FOLDER] },
  { name: 'scan_for_secrets', title: 'Scan for secrets before posting', description: 'Run the secrets checks before you push, post or share code, and report any finding.', arguments: [PROMPT_ARGS_FOLDER] },
  { name: 'blast_before_edit', title: 'Blast radius before an edit', description: 'See what depends on a file or symbol before you change it.', arguments: [{ name: 'target', description: 'A file path, or file#symbol, for example "lib/gate.mjs#runGate".', required: true }, PROMPT_ARGS_FOLDER] },
  { name: 'map_unfamiliar_repo', title: 'Map an unfamiliar repo', description: 'Build the code map and the check list of a codebase you have not seen before.', arguments: [PROMPT_ARGS_FOLDER] },
  { name: 'red_test_scenario', title: 'Red-test one scenario', description: "Run one kind of Meerkat's red tests and report what, if anything, no longer gets caught.", arguments: [{ name: 'kind', description: 'mutation, faults, adversarial, regression or cleantwin.', required: true }] },
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
  if (name === 'pre_commit_check') {
    return { description: 'Check before a commit', messages: [message(`Stage what you mean to commit first. Then call meerkat_gate with staged set to true${folder.text}. If it fails, call meerkat_findings, then meerkat_finding for each id, and fix the cause. Run meerkat_gate again until exit 0. Do not call meerkat_dismiss or meerkat_baseline to make it pass. Only then commit.`)] }
  }
  if (name === 'pre_pr_check') {
    const base = args.base ?? 'origin/main'
    if (typeof base !== 'string' || !GIT_REF.test(base) || base.includes('..')) return { error: 'base must be a git ref such as "origin/main"' }
    return { description: `Check before a pull request against ${base}`, messages: [message(`Call meerkat_gate with base set to "${base}"${folder.text}. Then call meerkat_run with the preset "ci" (the checks a build server would run) and read ${FINDINGS_URI}. If anything fails, use meerkat_finding on each id and meerkat_why on each failed check, fix it, and repeat. Report the final result in two lines. Do not open the PR until both pass.`)] }
  }
  if (name === 'scan_for_secrets') {
    return { description: 'Scan for secrets', messages: [message(`Call meerkat_run with suite set to ["secrets"]${folder.text}. Then read ${FINDINGS_URI}. For each finding give the place only; never print the secret itself. If there are findings, stop and tell me before anything is pushed, posted or shared. If there are none, say so in one line.`)] }
  }
  if (name === 'blast_before_edit') {
    const target = args.target
    if (typeof target !== 'string' || !target || target.length > 500 || /[\0\r\n]/.test(target) || target.startsWith('-') || target.startsWith('#')) return { error: 'target is required: a file path, optionally file#symbol (not starting with a dash)' }
    return { description: `Blast radius of ${target}`, messages: [message(`Call meerkat_blast with target ${JSON.stringify(target)}${folder.text}. List what depends on it, then say which of those files need to be re-read or tested after the edit. If found is false, call meerkat_map once and try again. After the edit, run meerkat_gate with staged set to true.`)] }
  }
  if (name === 'map_unfamiliar_repo') {
    return { description: 'Map an unfamiliar repo', messages: [message(`Call meerkat_map${folder.text}, then read ${MAP_URI}. Then call meerkat_tests with detail "summary" and meerkat_list${folder.text} to see which checks apply here. Report: the main folders, the most imported files, the language mix, and the checks that apply. Use meerkat_blast before you edit any file that is imported by many others.`)] }
  }
  if (name === 'red_test_scenario') {
    const kind = args.kind
    if (!['mutation', 'faults', 'adversarial', 'regression', 'cleantwin'].includes(kind)) return { error: 'kind is required: mutation, faults, adversarial, regression or cleantwin' }
    return { description: `Red-test: ${kind}`, messages: [message(`Call meerkat_redtest with kind "${kind}". If it fails, read the end of its output, name the test that failed and what it says is no longer caught. Do not weaken or delete a test to make it pass. Then call meerkat_smoke to confirm the toolchain itself still works.`)] }
  }
  return { missing: true }
}

// ctx.latestFindings() -> { ok, dir, doc } | { ok: false, text }; ctx.showLast(); ctx.showWhy(id, lines)
export async function readResource(uri, ctx, safe, pickFolder = null) {
  const one = (v) => (typeof v === 'string' ? safe(v) : (v ?? null))
  const query = typeof uri === 'string' && uri.startsWith(`${FINDINGS_URI}?`) ? uri.slice(FINDINGS_URI.length + 1) : null
  if (uri === FINDINGS_URI || query !== null) {
    let pick
    if (query !== null) {
      const params = new URLSearchParams(query)
      for (const k of params.keys()) if (!['folder', 'run', 'preset'].includes(k)) return { error: `Resource not found: unknown parameter ${k}` }
      const folder = params.get('folder')
      const run = params.get('run') ?? undefined
      const preset = params.get('preset') ?? undefined
      for (const v of [run, preset]) if (v !== undefined && !/^[0-9A-Za-z._-]+$/.test(v)) return { error: 'run and preset must be a run folder name or preset name (letters, digits, dots, dashes)' }
      if (folder !== null) {
        if (!pickFolder || !ctx.resolveRun) return { error: 'This server cannot read the runs of a folder.' }
        const f = pickFolder({ folder }, ctx)
        if (f.error) return { error: f.error }
        const res = ctx.resolveRun({ folder: f.folder, run, preset })
        if (!res.ok) return { error: res.text }
        pick = { run: res.id }
      } else pick = { ...(run ? { run } : {}), ...(preset ? { preset } : {}) }
    }
    const r = ctx.latestFindings?.(pick)
    if (!r?.ok) return { error: r?.text ?? 'No run has been saved yet.' }
    const findings = r.doc.findings.map((f) => ({ id: f.id, severity: f.severity, rule: f.rule ?? null, check: f.check, suite: f.suite, file: one(f.file), line: f.line ?? null, status: f.status, message: one(f.message), ...(f.evidence ? { evidence: one(f.evidence) } : {}) }))
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ run: r.doc.run?.id ?? null, counts: r.doc.counts, findings }, null, 2) }] }
  }
  if (uri === REPORT_URI) {
    const r = ctx.showLast()
    return r.ok ? { contents: [{ uri, mimeType: 'text/markdown', text: safe(r.text) }] } : { error: r.text }
  }
  if (uri === MAP_URI) {
    const m = ctx.latestMap?.()
    if (!m) return { error: 'No code map has been saved yet. Call meerkat_map first.' }
    return { contents: [{ uri, mimeType: 'text/markdown', text: safe(ctx.readFile(m.md)) }] }
  }
  if (uri === CATALOG_URI) {
    const d = await ctx.buildCatalog?.()
    return d ? { contents: [{ uri, mimeType: 'application/json', text: safe(JSON.stringify(d, null, 2)) }] } : { error: 'The catalog could not be built.' }
  }
  if (typeof uri === 'string' && uri.startsWith(LOG_PREFIX)) {
    const check = uri.slice(LOG_PREFIX.length)
    if (!NAME.test(check)) return { error: 'Resource not found' }
    const r = ctx.showWhy(check, 80)
    return r.ok ? { contents: [{ uri, mimeType: 'text/plain', text: safe(r.text) }] } : { error: r.text }
  }
  return { error: 'Resource not found' }
}
