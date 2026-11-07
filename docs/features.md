# Meerkat features

Each feature below has the same short block: what it is, why it is good, what it does, what it does NOT do, and its command or tool name. The command list in `meerkat describe` is the full, current one (JSON), and `meerkat help <command>` gives the options of one command. The checks themselves are listed in [checks.md](checks.md).

| Feature | Command or tool |
|---|---|
| Checks and presets | `meerkat verify`, `meerkat full`, `meerkat run <preset>`, `meerkat check <id>`; MCP `meerkat_run`, `meerkat_list`, `meerkat_presets` |
| Findings and prompt | `meerkat findings`, `meerkat finding`, `meerkat prompt`; MCP `meerkat_findings`, `meerkat_finding` |
| Accepted findings and ratchet | `meerkat dismiss`, `undismiss`, `dismissals`, `baseline`, `--ratchet`; MCP `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_dismissals`, `meerkat_baseline` |
| Trend, suggestions and PR comment | `meerkat trend`, `meerkat suggest`, `meerkat pr-comment`; MCP `meerkat_trend`, `meerkat_suggest`, `meerkat_pr_comment` |
| Workflow profiles | `meerkat init --profile <name>` |
| Memory hook | `meerkat memory` |
| Gate (checks for changed files) | `meerkat gate`; MCP `meerkat_gate` |
| Smoke | `meerkat run smoke` (preset), `meerkat smoke` (self-check); MCP `meerkat_smoke` |
| Blast radius | `meerkat blast <file>[#symbol]`; MCP `meerkat_blast` |
| Pre-edit brief | `meerkat brief <file>[#symbol]`; MCP `meerkat_brief` |
| Codebase map | `meerkat map`; MCP `meerkat_map` |
| Red testing | `meerkat redtest --kind <kind>` (or `node lib/redtest/run.mjs --kind <kind>`); MCP `meerkat_redtest` |
| Catalog and tests command | `meerkat tests --json`, `meerkat.order.json`; MCP `meerkat_tests` |
| Doctor, tools, discover and recommend | `meerkat doctor`, `meerkat tools`, `meerkat discover`, `meerkat recommend`; MCP `meerkat_doctor`, `meerkat_tools`, `meerkat_discover`, `meerkat_recommend` |
| MCP tools | `meerkat mcp serve` (the count: `meerkat_list`, or `node bin/meerkat-mcp.mjs --list-tools`) |
| MCP resources and prompts | `meerkat://run/latest/...`, `meerkat://map/latest`, `meerkat://tests/catalog`, nine prompts |
| Hook safety | `meerkat hook install\|remove\|status`; MCP `meerkat_hook`, `meerkat_hook_status` |
| AI verification of findings | `--ai-verify`, `meerkat ai` |

Planned (not built as a command or tool): [Advisory scan](#advisory-scan).

## Checks and presets

- **What it is:** the main job of Meerkat: a set of checks (secrets, web security, accessibility, build, tests, performance, code shape and more) that fit your project, grouped into presets.
- **Why it is good:** one command tells a person or an AI whether a project is safe to push, and a check that could not run says so instead of passing.
- **What it does:** runs the checks that apply, then saves a report, a findings file and one log per check. `quick` (also `verify`) before a push; `bugs` for findings that are likely real defects (quick minus style and documentation rules); `full` before a release; `ci`, `release`, `security`, `ui`, `performance`, `refactor` for one purpose. Exit codes: 0 passed, 1 a check failed or could not run, 2 usage or configuration error, 3 nothing to run, 130 interrupted.
- **What it does NOT do:** edit your project, install anything without a yes, or call an AI unless you opt in. `quick` skips builds and compiled test suites on purpose; `full` leaves out the AI review.
- **Command or tool:** `meerkat verify [folder]`, `meerkat full [folder]`, `meerkat run <preset> [folder]`, `meerkat check <id|suite|suite/check> [folder]`, `meerkat self-test`; MCP `meerkat_run`, `meerkat_list`, `meerkat_presets`, `meerkat_self_test`, `meerkat_last`, `meerkat_why`.

## Findings and prompt

- **What it is:** the saved result of a run, as data a person or an AI can read, filter and hand on.
- **Why it is good:** an AI that never saw the project gets every problem with its place, evidence and fix hint, worst first, without scrolling a log.
- **What it does:** every run saves `findings.json`, `findings.md`, `findings.sarif` and `detections.jsonl`. `meerkat findings` lists them (filters: severity, suite, check, new, fixed), `meerkat finding <id>` shows one in full, `meerkat prompt` writes a prompt for an AI. `--fail-on <severity>` sets the exit code for CI (with `--new` only new findings count), `--export sarif|markdown|json` points at the saved file.
- **What it does NOT do:** decide for you that a finding is a false alarm. An AI double-check happens only if you opt in.
- **Command or tool:** `meerkat findings [folder|run-id] [--json]`, `meerkat finding <id>`, `meerkat prompt [--print]`; MCP `meerkat_findings` (also `failOn`, `new`, `export`), `meerkat_finding`, `meerkat_prompt`.

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
- **Scoped by default:** the first line says how many failures block, which files were scanned and how long it took. A failure blocks only when it points into a file that changed. A failure that points at nothing or at files nobody touched (no `SECURITY.md`, no licence, no README) is listed under "project-wide, not blocking" with a count, so it is visible but not in the way. `--all` restores the full behaviour: every failure blocks and every passing check is listed. Passing checks are a count, not 270 lines.
- **Fast repeat runs:** a check whose inputs are exactly as at its last run is not run again (`lib/gatecache.mjs`; stored in `~/.meerkat/cache/`, `--no-cache` turns it off). The inputs are every tracked file's content, the commit, the Meerkat version, the tier, the `.meerkat*` settings files and the `MEERKAT_*` environment. Checks that never read source text (repo documents, CI config, git history; listed in `lib/gatepaths.mjs`) are keyed without source files, so a one-file source edit does not run them again. A check that is plainly about one language (a Rust check, a notebook check) waits for a changed file of that kind.
- **What it does NOT do:** check files that did not change, or read the staged copy of a partly staged file (it checks the file as saved).
- **Command or tool:** `meerkat gate [--staged | --base <ref> | --against <ref>] [--all] [--no-cache] [--app <folder>] [--json]`; MCP `meerkat_gate`.

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

## Pre-edit brief

- **What it is:** one fast call that gathers what you need before editing a file or a function.
- **Why it is good:** the blast radius is only part of it. An AI or a person also needs the signature, who calls it, which tests touch it, what is already flagged, and how often the file changes. This puts it in one short answer without a scan.
- **What it does:** prints the declaration (line, first line of the signature, exported or not), the callers (count and the first 10 as file:line with the calling function), the tests that reference it, findings on the file from the last saved run only, commits in the last 90 days (a bounded `git log`), a risk tier (low, medium, high) with every reason and its points written out, and a before-you-edit checklist. `--json` prints the same facts with a `version` field. The result is cached by content hash under `~/.meerkat/cache/brief`, so a repeat call on an unchanged repo is quick.
- **How callers and tests are found:** callers are the files the import graph says import the target (the same logic as `meerkat blast`), and with a symbol only those that name it; the line and function are the first non-import use in each file. Tests are the test files that import the file (directly or through other files) plus test files whose text names the symbol (or the file name).
- **What it does NOT do:** start a scan (no saved run means "no findings" is said in one line), prove that a name match is a real call, or follow dynamic imports. A text match can be a different thing with the same name, and the symbol line range used to place findings is approximate. Unresolved imports are reported and never counted as safe.
- **Command or tool:** `meerkat brief <file>[#symbol] [--app <folder>] [--json]`; MCP `meerkat_brief`. Exit codes: 0 done, 2 usage error or unknown symbol, 75 the file is not in the code map.

## Workflow profiles

- **What it is:** a starting configuration for a kind of workflow, kept as data in `profiles/<name>.json`: `solo`, `team`, `ai-agent`, `legacy`, `monorepo` and `ci-only`.
- **Why it is good:** the same scanner is used very differently by one person before a commit, a team gating pull requests, an AI agent editing code, a project adopting Meerkat on old code, a monorepo and a CI-only setup. A profile names the choices (preset, scope, which findings block, output format, cache use) and the exact commands, so nobody has to work them out.
- **What it does:** `meerkat init --profile <name>` prints the `meerkat.config.json` it would write (the packs found for the folder plus a `workflow` record), then the commands of that workflow and a few notes. Every command in a profile is checked by a test to be one Meerkat accepts.
- **What it does NOT do:** change how a run behaves (the `workflow` record is read by people and tools; use the printed commands), install hooks, or write anything without `--write`. `--write` refuses to replace an existing `meerkat.config.json`; `--force` replaces it. These are workflow profiles, not the machine profiles of `--profile low|normal|high` on `run.mjs`.
- **The six:** `solo` (staged files only, before a commit), `team` (staged files plus a changed-files gate on pull requests, existing findings accepted as a baseline), `ai-agent` (a `meerkat brief` before an edit, a `meerkat gate` after it, JSON output), `legacy` (accept everything now, fail only on new findings), `monorepo` (one package folder at a time with `--scope`), `ci-only` (the `full` preset in CI, no hooks, no cache).
- **Command:** `meerkat init --profile <name> [folder] [--write] [--force]`. Exit codes: 0 printed or written, 1 refused or could not write, 2 usage error or unknown profile.

## Memory hook

- **What it is:** `meerkat memory`, a thin hook that hands the newest run of a project to a memory adapter, a module that keeps the results as a note outside the project.
- **Why it is good:** what Meerkat found stays in the place where a person or an AI already keeps project knowledge, with what changed since the last time.
- **What it does:** reads `"memory": { "adapter": "<name>" }` from `meerkat.config.json`, loads that adapter from `examples/`, and calls it with the project and the newest run. The adapter shipped in `examples/neuralvault/` writes one markdown note into a NeuralVault vault folder: frontmatter (`type`, `project`, `updated`, `source_run`), the latest run's pass and fail counts, the findings summary, the code map summary when the run has a `codemap.json`, and a "what changed since last export" section. The vault folder comes from `NV_VAULT_PATH` or the first line of `~/.neuralvault-vault-path`, never from the config or the code.
- **What it does NOT do:** run anything when no adapter is set, write outside the vault folder (a path that leaves it, an absolute note path or a folder that is a link out are refused), write evidence or raw tool output, or write a note in which redaction still finds a secret-like value (nothing is written then). Findings are already redacted by Meerkat; the adapter keeps only short fields and redacts them again. Lines in the old note marked as corrections (a trailing `\*`) are kept.
- **Command:** `meerkat memory [folder] [--app <folder>] [--run <run folder>] [--dry-run] [--json]`. Exit codes: 0 done, 1 the adapter refused or failed, 2 no adapter set or a usage error. `--dry-run` checks everything and writes nothing.

## Codebase map

- **What it is:** a written map of a project: every file with its purpose, functions and classes (with line numbers), exports and imports, plus routes, entry points, modules and which tests cover which files.
- **Why it is good:** a person or an AI meeting unfamiliar code gets its shape in one file before reading any of it, and the map keeps itself current as the code changes.
- **What it does:** writes `codemap.json` (schema version 2: a build header with the commit and time, files, symbols, imports resolved to project files, routes, tests, entry points, module edges) and `codemap.md` (the same, short) into a run folder. The output is sorted and has no clock in its content, so an unchanged project gives byte-identical files and no new run folder. The per-file facts are cached by content hash in the Meerkat data folder (never in your repo), so a second run re-reads only the files that changed. `meerkat map --check` says in about 50 ms whether the saved map is current, and lists the stale files if not. `meerkat blast`, `meerkat brief` and the MCP tools refresh the changed files first and say so in one line ("map: refreshed 2 files first").
- **Routes:** Express, Fastify, Hono, Koa router, Restify, hapi, Polka (a method call with a string path), Next.js app router and pages/api (from the file path), Flask, Quart, FastAPI and Sanic (decorators). A framework that is imported but not parsed (for example NestJS or Django) is named in the header instead of guessed.
- **What it does NOT do:** import or run your code (it reads text with regular expressions), guess an import it cannot resolve (it is marked unresolved with a reason), follow mounted route prefixes, template-string paths, tsconfig aliases or computed requires, see a test that starts your program as a child process (only imports count), or map more than a fixed number of files. See [docs/codemap.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md).
- **Command or tool:** `meerkat map [--app <folder>] [--json] [--quiet] [--check]`; MCP `meerkat_map`, then the resource `meerkat://map/latest`.

## Red testing

- **What it is:** Meerkat attacking itself with throwaway projects.
- **Why it is good:** it proves the checks still catch real defects and do not cry wolf, so a pass can be trusted.
- **What it does:** planted bugs (recall per family), injected faults (a check that throws or hangs, a missing program), odd inputs (empty folder, huge file, symlink loop), one test per past fixed bug, and clean twins that must give no false alarms. Known gaps are recorded in [lib/redtest/README.md](../lib/redtest/README.md).
- **What it does NOT do:** touch any folder the test did not create, or work without a repository checkout (`meerkat redtest` needs the development install, vitest).
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
- **What it does:** offers its tools (the count and the names: `meerkat_list`, `meerkat_version` or `node bin/meerkat-mcp.mjs --list-tools`). The tools that read a run take `folder`, `run` and `preset`, so a call stays on one project; `meerkat_run` takes `ratchet` and the run flags; `meerkat_findings` takes `failOn`, `new` and `export`; every result starts with a status line and has a `schemaVersion`. Read-only: `meerkat_list`, `meerkat_presets`, `meerkat_last`, `meerkat_why`, `meerkat_blast`, `meerkat_brief`, `meerkat_tests`, `meerkat_findings`, `meerkat_finding`, `meerkat_doctor`, `meerkat_discover`, `meerkat_recommend`, `meerkat_tools`, `meerkat_trend`, `meerkat_suggest`, `meerkat_pr_comment`, `meerkat_dismissals`, `meerkat_hook_status`, `meerkat_describe`, `meerkat_version`, `meerkat_check_list`, `meerkat_run_list`. They run the project's own commands: `meerkat_run`, `meerkat_self_test`, `meerkat_gate`, `meerkat_smoke`, `meerkat_redtest`, and `meerkat_map` writes a map into the log folder. Writes (description starts with WRITES, folder required): `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_baseline`, `meerkat_hook`. Folders must be inside the folder the server started in or one added with `meerkat root add`. Text read from logs is withheld if it looks like it contains a secret.
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
