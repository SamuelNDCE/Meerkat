# Meerkat features

Each feature below has the same short block: what it is, why it is good, what it does, what it does NOT do, and its command or tool name. The command list in `meerkat describe` is the full, current one (JSON), and `meerkat help <command>` gives the options of one command. The checks themselves are listed in [checks.md](checks.md).

| Feature | Command or tool |
|---|---|
| Checks and presets | `meerkat verify`, `meerkat full`, `meerkat run <preset>`, `meerkat check <id>`; MCP `meerkat_run`, `meerkat_list`, `meerkat_presets` |
| Findings and prompt | `meerkat findings`, `meerkat finding`, `meerkat prompt`; MCP `meerkat_findings`, `meerkat_finding` |
| Accepted findings and ratchet | `meerkat dismiss`, `undismiss`, `dismissals`, `baseline`, `--ratchet`; MCP `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_dismissals`, `meerkat_baseline` |
| Trend, suggestions and PR comment | `meerkat trend`, `meerkat suggest`, `meerkat pr-comment`; MCP `meerkat_trend`, `meerkat_suggest`, `meerkat_pr_comment` |
| Gate (checks for changed files) | `meerkat gate`; MCP `meerkat_gate` |
| Smoke | `meerkat run smoke` (preset), `meerkat smoke` (self-check); MCP `meerkat_smoke` |
| Blast radius | `meerkat blast <file>[#symbol]`; MCP `meerkat_blast` |
| Codebase map | `meerkat map`; MCP `meerkat_map` |
| Red testing | `meerkat redtest --kind <kind>` (or `node lib/redtest/run.mjs --kind <kind>`); MCP `meerkat_redtest` |
| Catalog and tests command | `meerkat tests --json`, `meerkat.order.json`; MCP `meerkat_tests` |
| Doctor, tools, discover and recommend | `meerkat doctor`, `meerkat tools`, `meerkat discover`, `meerkat recommend`; MCP `meerkat_doctor`, `meerkat_tools`, `meerkat_discover`, `meerkat_recommend` |
| MCP tools | `meerkat mcp serve`: 28 tools |
| MCP resources and prompts | `meerkat://run/latest/...`, `meerkat://map/latest`, `meerkat://tests/catalog`, nine prompts |
| Hook safety | `meerkat hook install\|remove\|status`; MCP `meerkat_hook`, `meerkat_hook_status` |
| AI verification of findings | `--ai-verify`, `meerkat ai` |

Planned (not built as a command or tool): [Advisory scan](#advisory-scan).

## Checks and presets

- **What it is:** the main job of Meerkat: a set of checks (secrets, web security, accessibility, build, tests, performance, code shape and more) that fit your project, grouped into presets.
- **Why it is good:** one command tells a person or an AI whether a project is safe to push, and a check that could not run says so instead of passing.
- **What it does:** runs the checks that apply, then saves a report, a findings file and one log per check. `quick` (also `verify`) before a push; `full` before a release; `ci`, `release`, `security`, `ui`, `performance`, `refactor` for one purpose. Exit codes: 0 passed, 1 a check failed or could not run, 2 usage or configuration error, 3 nothing to run, 130 interrupted.
- **What it does NOT do:** edit your project, install anything without a yes, or call an AI unless you opt in. `quick` skips builds and compiled test suites on purpose; `full` leaves out the AI review.
- **Command or tool:** `meerkat verify [folder]`, `meerkat full [folder]`, `meerkat run <preset> [folder]`, `meerkat check <id|suite|suite/check> [folder]`, `meerkat self-test`; MCP `meerkat_run`, `meerkat_list`, `meerkat_presets`, `meerkat_self_test`, `meerkat_last`, `meerkat_why`.

## Findings and prompt

- **What it is:** the saved result of a run, as data a person or an AI can read, filter and hand on.
- **Why it is good:** an AI that never saw the project gets every problem with its place, evidence and fix hint, worst first, without scrolling a log.
- **What it does:** every run saves `findings.json`, `findings.md`, `findings.sarif` and `detections.jsonl`. `meerkat findings` lists them (filters: severity, suite, check, new, fixed), `meerkat finding <id>` shows one in full, `meerkat prompt` writes a prompt for an AI. `--fail-on <severity>` sets the exit code for CI.
- **What it does NOT do:** decide for you that a finding is a false alarm. An AI double-check happens only if you opt in.
- **Command or tool:** `meerkat findings [folder|run-id] [--json]`, `meerkat finding <id>`, `meerkat prompt [--print]`; MCP `meerkat_findings`, `meerkat_finding`.

## Accepted findings and ratchet

- **What it is:** a way to record that a finding is not a problem, or to accept today's findings as a baseline.
- **Why it is good:** a known false alarm stops blocking, and an old project can adopt Meerkat so that only new findings fail.
- **What it does:** `dismiss` keeps a finding out of the failures with a written reason; `undismiss` takes it back; `dismissals` lists them (`--stats` counts per rule); `baseline` accepts the newest run's findings and `--ratchet` then fails only on new ones. All are saved in your home folder.
- **What it does NOT do:** delete the finding. The reason stays recorded. The MCP write tools need a folder and refuse a run that belongs to another folder.
- **Command or tool:** `meerkat dismiss <id> --reason "..."`, `meerkat undismiss <id>`, `meerkat dismissals [--stats]`, `meerkat baseline [--clear]`; MCP `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_dismissals`, `meerkat_baseline`.

## Trend, suggestions and PR comment

- **What it is:** three small readers of the newest run and the run history.
- **Why it is good:** you see whether a project is getting better, get a starting fix per finding, and get a ready summary to paste into a pull request.
- **What it does:** `trend` prints one line per recent run (findings by severity, new, fixed); `suggest` prints suggested commands as markdown; `pr-comment` prints markdown for a pull request comment, with an optional link to the CI run.
- **What it does NOT do:** run a suggested command, or post the comment anywhere.
- **Command or tool:** `meerkat trend [folder]`, `meerkat suggest [run-folder]`, `meerkat pr-comment [run-folder] [--run-url <url>]`; MCP `meerkat_trend`, `meerkat_suggest`, `meerkat_pr_comment`.

## Gate

- **What it is:** a run limited to the files you changed.
- **Why it is good:** a commit or a pull request is checked in seconds, not minutes, and the answer covers exactly what you touched.
- **What it does:** runs only the checks whose paths match the files changed (`--staged`, `--base <ref>` or `--against <ref>`; `--thorough` for the slower tier). Exit codes: 0 passed, 1 a check failed or crashed, 2 usage error, 75 could not run (no base found, no checks loaded, or a selected check could not run). 75 is not a pass.
- **What it does NOT do:** check files that did not change, or read the staged copy of a partly staged file (it checks the file as saved).
- **Command or tool:** `meerkat gate [--staged | --base <ref> | --against <ref>] [--app <folder>] [--json]`; MCP `meerkat_gate`.

## Smoke

- **What it is:** two things that share a word: the `smoke` preset (did my change break the basics?) and the smoke self-check (does the tool behave?).
- **Why it is good:** the preset is the fastest sanity check of a project; the self-check finds a broken or hanging check before you trust a gate result.
- **What it does:** the preset runs build, type check, lints and quick tests, and `--changed` or `--scope <folder>` narrows it. The self-check runs each check selected for your changes with a short time limit and fails when a check crashes, hangs, or none is selected for a non-empty change. Exit codes 0, 1, 2, 75 as for the gate.
- **What it does NOT do:** the preset does not look at security, looks or speed; the self-check tests Meerkat, not your project, so a check that finds problems in your project is fine.
- **Command or tool:** `meerkat run smoke [folder]`; `meerkat smoke [--staged | --base <ref>] [--timeout <seconds>]`; MCP `meerkat_smoke`.

## Blast radius

- **What it is:** the list of what an edit to a file or symbol affects.
- **Why it is good:** before changing code you know what imports it and which tests reach it, so you edit with less guessing.
- **What it does:** lists importers, modules touched, tests that reach it and imports it could not resolve (shown as "could also be importers", never counted as safe). The code map is cached per git commit. Exit codes: 0 done, 2 usage error, 75 the file is not in the map (the answer is unknown).
- **What it does NOT do:** run any code, follow dynamic imports or computed paths it cannot resolve, or read languages other than JavaScript, TypeScript and Python.
- **Command or tool:** `meerkat blast <file>[#symbol] [--app <folder>] [--json]`; MCP `meerkat_blast`.

## Codebase map

- **What it is:** a written map of a project: entry points, modules and their imports.
- **Why it is good:** a person or an AI meeting unfamiliar code gets its shape in one file before reading any of it.
- **What it does:** writes `codemap.json` (files, imports, exports, entry points, module edges) and `codemap.md` (entry points, modules, most imported files, unresolved imports, blast radius of the top five) into a new run folder.
- **What it does NOT do:** import or run your code (it reads text with regular expressions), guess an import it cannot resolve (it is marked unresolved with a reason), or map more than a fixed number of files.
- **Command or tool:** `meerkat map [--app <folder>] [--json]`; MCP `meerkat_map`, then the resource `meerkat://map/latest`.

## Red testing

- **What it is:** Meerkat attacking itself with throwaway projects.
- **Why it is good:** it proves the checks still catch real defects and do not cry wolf, so a pass can be trusted.
- **What it does:** planted bugs (recall per family), injected faults (a check that throws or hangs, a missing program), odd inputs (empty folder, huge file, symlink loop), one test per past fixed bug, and clean twins that must give no false alarms. Known gaps are recorded in [lib/redtest/README.md](../lib/redtest/README.md).
- **What it does NOT do:** exist as a `meerkat` command word, or touch any folder the test did not create. It needs a repository checkout.
- **Command or tool:** `meerkat redtest --kind mutation|faults|adversarial|regression|cleantwin|all` (the same as `node lib/redtest/run.mjs --kind ...`); MCP `meerkat_redtest`.

## Catalog and tests command

- **What it is:** a generated list of every kind of test and family of check.
- **Why it is good:** it answers "which check proves this?" and "what will this cost?" and cannot drift, because it is built from the check registry.
- **What it does:** prints what each kind proves, what triggers it (`commit`, `pr`, `gate`, `promote`, `manual`), its cost (`fast`, `medium`, `slow`) and what it needs. `meerkat.order.json` (`{"version": 1, "kinds": [...]}`) sets which kinds start first.
- **What it does NOT do:** run anything. The order file changes what starts first, never what runs. Exit code 2 when the order file is wrong.
- **Command or tool:** `meerkat tests [folder] [--json]`; MCP `meerkat_tests`, resource `meerkat://tests/catalog`.

## Doctor, tools, discover and recommend

- **What it is:** four read-only questions about a project and this computer.
- **Why it is good:** when a check could not run, or a project has tests Meerkat does not use yet, you find out why and what to do next.
- **What it does:** `doctor` says what would run here, what is missing and how to fix it; `tools` lists the optional outside tools found or missing; `discover` lists the project's own tests that `full`, `thorough` and `release` would run too; `recommend` lists tests the project could run that no check covers.
- **What it does NOT do:** run tests or install anything. Installing is `meerkat tools install` and adding a recommendation is `meerkat recommend --add`, both a person's step and neither offered as an MCP tool.
- **Command or tool:** `meerkat doctor`, `meerkat tools`, `meerkat discover`, `meerkat recommend` (each `[folder] [--json]`); MCP `meerkat_doctor`, `meerkat_tools`, `meerkat_discover`, `meerkat_recommend`.

## MCP tools

- **What it is:** a stdio MCP server that offers Meerkat to an AI client as tools.
- **Why it is good:** an AI can run the checks, read the findings and look up a blast radius itself, with inputs that are checked before anything starts.
- **What it does:** offers 28 tools. Read-only: `meerkat_list`, `meerkat_presets`, `meerkat_last`, `meerkat_why`, `meerkat_blast`, `meerkat_tests`, `meerkat_findings`, `meerkat_finding`, `meerkat_doctor`, `meerkat_discover`, `meerkat_recommend`, `meerkat_tools`, `meerkat_trend`, `meerkat_suggest`, `meerkat_pr_comment`, `meerkat_dismissals`, `meerkat_hook_status`, `meerkat_describe`. They run the project's own commands: `meerkat_run`, `meerkat_self_test`, `meerkat_gate`, `meerkat_smoke`, `meerkat_redtest`, and `meerkat_map` writes a map into the log folder. Writes (description starts with WRITES, folder required): `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_baseline`, `meerkat_hook`. Folders must be inside the folder the server started in or one added with `meerkat root add`. Text read from logs is withheld if it looks like it contains a secret.
- **What it does NOT do:** run any command except Meerkat's own, or offer `root add`, `update`, `init`, check or preset edits, `recommend --add`, `tools install`, `rules test`, `logs`, `repos` or `recent`.
- **Command or tool:** `meerkat mcp serve`, `meerkat mcp install [claude] [--dry-run]`, `meerkat mcp status`, or `node bin/meerkat-mcp.mjs`. The tools are defined in `lib/mcp.mjs`, `lib/mcptools.mjs` and `lib/mcpmore.mjs`.

## MCP resources and prompts

- **What it is:** read-only data and ready-made requests an MCP client can pick.
- **Why it is good:** the client can read the latest result directly and start a common job (triage, pre-commit check) with one choice.
- **What it does:** resources `meerkat://run/latest/findings`, `meerkat://run/latest/report`, `meerkat://map/latest`, `meerkat://tests/catalog` and the template `meerkat://run/latest/log/{check}`. Nine prompts: `triage_newest_run`, `check_one_fix`, `scan_diff`, `pre_commit_check`, `pre_pr_check`, `scan_for_secrets`, `blast_before_edit`, `map_unfamiliar_repo`, `red_test_scenario`.
- **What it does NOT do:** run anything (a prompt is text to pick), explain why a finding matters beyond rule, evidence and place, or add a way to write.
- **Command or tool:** served by `meerkat mcp serve`.

## Hook safety

- **What it is:** a git pre-push hook that runs the quick preset.
- **Why it is good:** a push is checked without anyone remembering to, and the hook can be removed cleanly.
- **What it does:** `install` adds one block between marker lines (creates the hook if missing, appends to an existing hook, replaces only its own block on a second install); `remove` takes out only that block; `status` shows the hook file, whether the block is there and whether an install would be allowed. The hook runs the quick preset with `--ratchet`. Exit codes: 0 done, 1 not a git repository or the hook could not be written.
- **What it does NOT do:** overwrite your own hook lines, or push anything. Install and remove are not run unless asked.
- **Command or tool:** `meerkat hook install|remove|status [folder]`; MCP `meerkat_hook` (WRITES), `meerkat_hook_status`.

## AI verification of findings

- **What it is:** an optional second opinion on findings from a model you choose.
- **Why it is good:** it can mark a medium, high or critical finding as a likely false alarm before a person spends time on it.
- **What it does:** with `--ai-verify` (or `v` on the results screen) it asks the model chosen by `meerkat ai use` to double-check each medium, high and critical finding. It says what it will send first and asks unless `--yes`. Verdicts add notes. A model error counts as not run, never as a pass. Details in [reference.md](reference.md).
- **What it does NOT do:** run unless you ask, delete a finding, or send anything before you agree.
- **Command or tool:** `--ai-verify`, `meerkat ai status|use|test`.

## Planned

### Advisory scan

- **What it is:** `lib/advisory.mjs`, a library that reads a project's manifests and matches its packages against a local OSV snapshot.
- **Why it is good:** it would flag known-vulnerable dependencies offline, with no network call except an optional refresh of the snapshot.
- **What it does:** nothing you can call yet: no command, menu entry or MCP tool uses it. Dependency advisories today come from the `npm-audit-all`, `rust-audit` and opt-in `detectors` (osv-scanner) checks.
- **What it does NOT do:** change, stop or update anything, even when finished.
- **Command or tool:** none yet.
