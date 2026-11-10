// Descriptions for every tool, in the form "Use when <situations>. Does <one line>." (WRITES: first for tools that write), at most 160 characters.
// Situations are listed per tool in docs/ai-triggers.md. A test (lib/mcpcompact.test.ts) holds every description under MAX_DESCRIPTION.
export const MAX_DESCRIPTION = 280

export const SHORT_DESCRIPTIONS = {
  meerkat_run: 'Use when you need a full preset run (minutes: start in the background, poll meerkat_last). Does run the project\'s own commands; trusted projects only.',
  meerkat_list: 'Use when you want to see which checks would run before running them. Does list checks and suites, runs none; loads project config, trusted projects only.',
  meerkat_last: 'Use when a run finished and you need its result, failures and log ends. Does return the run report; reads files only, pass folder.',
  meerkat_self_test: 'Use when you doubt a check can fail at all. Does run each check on a broken sample; runs the project\'s commands, trusted projects only, takes minutes.',
  meerkat_gate: 'Use before a commit or PR to check only the changed files (staged or base). Does return blocking counts and findings; runs the project\'s commands.',
  meerkat_summary: 'Use when you want a pass or fail verdict in a few lines. Does run the gate and return counts and failed check names; trusted projects only.',
  meerkat_smoke: 'Use when a check seems stuck or broken and you need to know it starts and stops. Does run each selected check briefly; runs the project\'s commands.',
  meerkat_map: 'Use when starting in unfamiliar code or planning a refactor. Does build the code map (files, symbols, imports, tests); writes only to the log folder.',
  meerkat_tests: 'Use when you need to know which kinds of tests Meerkat has and what each proves. Does list kinds, cost and triggers; reads files only.',
  meerkat_findings: 'Use when a run has findings and you need the worst first or a CI gate. Does list findings with filters and failOn; reads files only.',
  meerkat_finding: 'Use when you need one finding\'s evidence and fix hint, by id from meerkat_findings. Does return it in full; reads files only.',
  meerkat_redtest: 'Use when changing Meerkat or doubting a check. Does run its attack tests (mutation, faults, adversarial, regression, cleantwin); all takes minutes.',
  meerkat_dismiss: 'WRITES: Use when the person agreed a finding is a false alarm. Does mark it dismissed with your reason; needs an id and a reason.',
  meerkat_baseline: 'WRITES: Use when the person asks to adopt a legacy project. Does accept all open findings as the baseline so only new ones fail; clear: true removes it.',
  meerkat_pr_comment: 'Use when writing a pull request comment from a run. Does return markdown (result, new findings, next steps); posts nothing, pass folder.',
  meerkat_hook: 'WRITES: Use when the person asks for a pre-push check. Does install or remove the git pre-push hook; check meerkat_hook_status first.',
  meerkat_brief: 'Use before editing a file or symbol (file#symbol). Does return callers, tests, findings, churn and a risk tier; starts no scan.',
  meerkat_version: 'Use when you need the Meerkat server version or tool count. Does return version, build commit and tool count; reads no project.',
  meerkat_check_list: 'Use when you need the project\'s own checks and check packs. Does list them with enabled state and needed outside tools; read-only.',
  meerkat_prompt: 'WRITES: Use when handing a run\'s findings to another AI. Does write one markdown file grouped by severity and return its path; folder required.',
  meerkat_undismiss: 'WRITES: Use when a dismissal was wrong or its reason no longer holds. Does restore the finding so it fails checks again; needs id and folder.',
  meerkat_why: 'Use when one check failed and you need its log tail (id from meerkat_last). Does return its log header and output end; reads a file only.',
  meerkat_run_list: 'Use when you need a run id or want to know if a project is run regularly. Does list past runs, newest first; reads files only.',
  meerkat_dismissals: 'Use before dismissing a finding, or to spot a rule dismissed again and again. Does list dismissals with reasons; stats: true counts per rule.',
  meerkat_blast: 'Use before changing, moving or deleting a file or symbol with callers (src/a.js#name). Does list importers, imports and what could break.',
  meerkat_suggest: 'Use after meerkat_findings when you want a starting fix per finding kind. Does return suggested commands as markdown; runs nothing.',
  meerkat_doctor: 'Use when a check could not run or before a first run in a project. Does report what would run and which outside tools are missing.',
  meerkat_tools: 'Use when a check is skipped because a linter or scanner is missing. Does list outside tools found or missing with install steps; installs nothing.',
  meerkat_recommend: 'Use when hunting coverage gaps. Does list tests this project could run that no check covers, with why; adds nothing, reads files only.',
  meerkat_first_failure: 'Use when you want only the first blocking problem in the changed files. Does run the gate and return one line: file:line check: message, or PASS.',
  meerkat_discover: 'Use before picking a preset, to learn the project\'s own tests and scripts. Does list what full, thorough and release would run; runs nothing.',
  meerkat_describe: 'Use before telling a person which Meerkat command to run. Does return every command, option, output field and exit code as JSON; reads no project.',
  meerkat_presets: 'Use when choosing a preset for meerkat_run. Does list preset names with tier, check kinds and a description; reads files only.',
  meerkat_hook_status: 'Use before meerkat_hook to see what is installed. Does say whether the pre-push hook exists and may be installed; reads one hook file.',
  meerkat_trend: 'Use when asking whether the project is getting better or worse. Does return one line per recent run: findings by severity, new and fixed.',
}

// The house style is two lines: what it returns, then when to use it or what to watch for. Split after the first sentence.
for (const [k, v] of Object.entries(SHORT_DESCRIPTIONS)) SHORT_DESCRIPTIONS[k] = v.replace('. ', '.\n')
