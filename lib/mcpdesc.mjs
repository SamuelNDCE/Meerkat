// Short descriptions for the tools whose first wording ran past 280 characters. Each says what the tool returns and the one safety fact a client
// needs (a tool that runs the project's own commands says so). A test (lib/mcpcompact.test.ts) holds every description under MAX_DESCRIPTION.
export const MAX_DESCRIPTION = 280

export const SHORT_DESCRIPTIONS = {
  meerkat_run: 'Runs a preset of checks on a project and returns a count line, the failed checks with log paths and the run folder. Runs the project\'s own commands: trusted projects only. Can take minutes: start it in the background, poll meerkat_last. Compact; full: true for all.',
  meerkat_list: 'Returns the checks Meerkat would run for a project (id, kind, tier, seconds, title, suite) and its suites. Runs no checks. Loads the project\'s config: trusted projects only.',
  meerkat_last: 'Returns a run\'s report: result, each failure with the end of its log, what could not run, timings, and the 20 worst findings. Reads files only. Pass folder.',
  meerkat_self_test: 'Proves each check can fail by running it against a deliberately broken sample. Returns pass or fail per check. Runs the project\'s own commands: trusted projects only. Can take minutes.',
  meerkat_gate: 'Runs only the checks covering your changed files. Returns a count line (blocking, pre-existing, passed, failed), up to 10 findings as file:line, and the run folder. Runs the project\'s commands. Use staged or base. full: true for every row.',
  meerkat_summary: 'Runs the gate and returns a few lines: pass or fail, blocking and pre-existing counts, the failed check names and the run folder. Runs the project\'s own commands: trusted projects only.',
  meerkat_smoke: 'Proves each selected check starts, runs and stops within a few seconds. Returns pass or fail per check. Same file selection as meerkat_gate. Runs the project\'s own commands.',
  meerkat_map: 'Builds the code map of a project (files, symbols with lines, imports, routes, tests per file) and returns the counts and the path of codemap.json. Compact; read meerkat://map/latest for the map. Writes only to Meerkat\'s log folder.',
  meerkat_tests: 'Returns the catalog of Meerkat\'s own test kinds and families: what each proves, its cost and its triggers. detail "full" adds every check. Reads files only.',
  meerkat_findings: 'Returns the findings of a run, worst first: a count line, then up to 10 as "check file:line message", then the run folder. Filter by severity, check, suite or status; failOn gives a CI gate. full: true for all. Reads files only.',
  meerkat_finding: 'Returns one finding in full: what, where, evidence, the check that found it, its log and a fix hint. Needs an id (4+ characters) from meerkat_findings. Reads files only.',
  meerkat_redtest: 'Runs Meerkat\'s own attack tests (mutation, faults, adversarial, regression, cleantwin) and returns pass or fail per kind. Use when changing Meerkat or doubting a check. "all" takes minutes.',
  meerkat_dismiss: 'WRITES: marks one finding as "not a problem" with your reason, so it stops failing checks. Returns the saved record. Only when the person agreed it is a false alarm. Needs an id and a reason.',
  meerkat_baseline: 'WRITES: accepts every open finding of the newest run as the baseline, so a ratchet run fails only on new ones; clear: true removes it. Returns the count. Only when the person asks to adopt a legacy project.',
  meerkat_pr_comment: 'Returns markdown for a pull request comment from a run: result, new findings and what to do. Posts nothing. run_url (https) adds a CI link. Pass folder.',
  meerkat_hook: 'WRITES: installs or removes the git pre-push hook that runs the quick preset before every push. Returns what changed in .git/hooks/pre-push. Only when the person asks; check meerkat_hook_status first.',
  meerkat_brief: 'Returns a short pre-edit brief for a file or "file#symbol": declaration, callers, tests, last-run findings, git churn and a risk tier. Compact; full: true for the whole brief. Starts no scan.',
  meerkat_version: 'Returns the Meerkat server version, its build commit when known, and how many tools it registers. Takes no argument and reads nothing from a project.',
  meerkat_check_list: 'Returns the checks a project defines itself and the check packs, with whether each is enabled and which outside tools it needs. Read-only.',
  meerkat_prompt: 'WRITES one markdown file in the run folder holding every finding of a run, grouped by severity, for another AI. Returns its path and the finding count. folder is required.',
}

// The house style is two lines: what it returns, then when to use it or what to watch for. Split after the first sentence.
for (const [k, v] of Object.entries(SHORT_DESCRIPTIONS)) SHORT_DESCRIPTIONS[k] = v.replace('. ', '.\n')
