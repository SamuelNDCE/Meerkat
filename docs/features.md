# Meerkat features

Every feature, what it does, when to use it, how to call it, what it returns, what it does not do, and whether it works today. Facts here were checked against `lib/cli.mjs`, `lib/help.mjs`, `lib/mcp.mjs`, `lib/mcpextras.mjs`, `lib/extras-cli.mjs` and `lib/gate.mjs`. `meerkat describe` prints the full, current command list as JSON.

Status legend: OK works / PARTIAL works in part / BROKEN built but not working / PLANNED not built / blank not applicable.

| Feature | Command or tool | Status |
|---|---|---|
| Checks and presets | `meerkat verify`, `meerkat full`, `meerkat run <preset>`, `meerkat check <id>` | OK |
| Findings and prompt | `meerkat findings`, `meerkat finding`, `meerkat prompt` | OK |
| Accepted findings and ratchet | `meerkat dismiss`, `meerkat baseline`, `--ratchet` | OK |
| Gate (checks for changed files) | `node lib/gate.mjs gate` (`meerkat gate` not routed yet) | PARTIAL |
| Smoke preset (did my change break anything) | `meerkat run smoke` | OK |
| Smoke self-check (does the tool behave) | `node lib/gate.mjs smoke` (`meerkat smoke` not routed yet) | PARTIAL |
| Blast radius | `meerkat blast <file>[#symbol]` | OK |
| Codebase map | `meerkat map` | OK |
| Red testing | `node lib/redtest/run.mjs --kind <kind>` (repository checkout only) | PARTIAL |
| Advisory scan | `lib/advisory.mjs` (library only, no command) | PLANNED |
| Catalog and tests command | `meerkat tests --json`, `meerkat.order.json` | OK |
| MCP tools | `meerkat mcp serve`: six tools | OK |
| MCP resources and prompts | `meerkat://run/latest/...`, three prompts | OK |
| Hook safety | `meerkat hook install\|remove` | OK |
| AI verification of findings | `--ai-verify`, `meerkat ai` | PARTIAL |

"OK" means the command exists in the command registry or the MCP server and was seen to run on this branch (`meerkat blast`, the hook usage text and the MCP tool list were run; the rest are read from the code and covered by the repository tests). PARTIAL and PLANNED rows say why below.

## Checks and presets

- **What it does:** runs the checks that apply to your project (secrets, web security, accessibility, build, tests, performance, code shape and more) and saves a report, a findings file and one log per check. A check that cannot run is NOT RUN, never a pass.
- **When to use it:** `quick` (also `verify`) before every push; `full` before a release or a merge you cannot undo; `ci` on a build server; `release` just before shipping; `security`, `ui`, `performance`, `refactor` for one kind. `meerkat presets` lists them.
- **Command:** `meerkat verify [folder]`, `meerkat full [folder]`, `meerkat run <preset> [folder]`, `meerkat check <id|suite|suite/check|suite/check/sub>... [folder]`, `meerkat self-test [folder]` (proves each check fails on its broken sample). The list of checks is [checks.md](checks.md).
- **Exit codes:** 0 everything passed; 1 a check failed or could not run; 2 a usage or configuration error; 3 nothing to run (the preset selected no checks here); 130 interrupted.
- **Does not:** edit your project, install anything without a yes, or call an AI unless you opt in. `quick` skips builds and compiled test suites on purpose; `full` does not include the AI review (`release` adds it).
- **Status:** OK.

## Findings and prompt

- **What it does:** every run saves `findings.json`, `findings.md`, `findings.sarif` and `detections.jsonl`. `meerkat findings` lists them worst first; `meerkat finding <id>` shows one in full; `meerkat prompt` writes a prompt for an AI that has never seen the project.
- **When to use it:** after any run that did not pass; in CI with `--fail-on`; to hand the results to an AI.
- **Command:** `meerkat findings [folder|run-id] [--severity s] [--suite s] [--check id] [--new] [--fixed] [--limit n] [--fail-on s] [--export sarif|md|json [file]] [--json]`, `meerkat finding <id> [run-id]`, `meerkat prompt [folder|run-id] [--print] [--no-copy]`.
- **Exit codes:** 0 done; 1 with `--fail-on` when a finding at or above that severity exists, or when `prompt` finds no run with a `findings.json`; 2 usage error.
- **Does not:** decide a finding is a false alarm for you. Medium and above can be double-checked by an AI only if you opt in.
- **Status:** OK.

## Accepted findings and ratchet

- **What it does:** keeps a finding you have judged not to be a problem (with a reason), or accepts today's findings as a baseline so only new ones fail.
- **When to use it:** a known false alarm; adopting Meerkat on an old project.
- **Command:** `meerkat dismiss <id> --reason "..."`, `meerkat undismiss <id>`, `meerkat dismissals [--stats]`, `meerkat baseline [--clear]`, `meerkat trend`, `meerkat suggest`, `meerkat pr-comment`, and `--ratchet` on a run.
- **Exit codes:** 0 done; 1 the action failed (for example, no run yet or a finding id not found).
- **Does not:** delete the finding; the reason and the dismissal are kept. These commands are handled in `lib/extras-cli.mjs` and are not yet in `meerkat help`.
- **Status:** OK.

## Gate

- **What it does:** runs only the checks whose paths match the files changed since a base ref, so a commit or pull request is checked fast.
- **When to use it:** before committing (`--staged`, for a pre-commit hook) or on a pull request (`--base <ref>`). The Claude skill tells an AI to use it before every commit.
- **Command:** `node lib/gate.mjs gate [--staged | --base <ref> | --against <ref>] [--app <folder>] [--thorough] [--json]`. The word `meerkat gate` is not routed by `bin/meerkat.mjs` on this branch (it answers "Unknown command"), so use the file path until it is wired.
- **Exit codes:** 0 pass; 1 a check failed or a check's tool crashed; 2 usage error; 75 not run (no base ref found, no checks loaded, or every selected check could not run). 75 is not a pass.
- **Does not:** check files that did not change, or read the staged version of a partly staged file (it checks the file as saved).
- **Status:** PARTIAL. The logic and its tests exist; the `meerkat gate` command word is not wired here.

## Smoke

Two different things use the word.

- **Smoke preset.** Asks "did my change break the build, type check, lints and quick tests?". `meerkat run smoke [folder]` (add `--changed` or `--scope <folder>` to focus it). Exit codes as for any run. Does not look at security, looks or speed. **Status: OK.**
- **Smoke self-check.** Runs each selected check on the changed files with a tiny time limit and fails when the tool misbehaves (a check crashes, hangs, or none is selected for a non-empty change). It tests Meerkat, not your project, so a check that finds problems in your project is fine. `node lib/gate.mjs smoke [--staged | --base <ref>] [--timeout <seconds>]`. Exit codes 0, 1, 2, 75 as for the gate. **Status: PARTIAL** (`meerkat smoke` is not routed here yet).

## Blast radius

- **What it does:** for a file or a symbol, lists the importers, the modules touched, the tests that reach it, and imports it could not resolve (listed as "could also be importers", never counted as safe).
- **When to use it:** after an edit, to see what it affects; before a refactor, to choose the tests to run.
- **Command:** `meerkat blast <file>[#symbol] [--app <folder>] [--json]`. The file is relative to the app folder. The code map is cached per git commit, so a repeat run is fast; `--json` adds `map.source` (`cache`, `built` or `built-uncached`).
- **Exit codes:** 0 done; 2 usage error; 75 the file is not in the map (not a pass or a fail: the answer is unknown).
- **Does not:** run any code, follow dynamic imports or computed paths it cannot resolve, or read languages other than JavaScript, TypeScript and Python.
- **Status:** OK.

## Codebase map

- **What it does:** writes `codemap.json` (every file, import, export, entry point and module edge) and `codemap.md` (entry points, modules and edges, most imported files, unresolved imports, blast radius of the top five) into a new run folder.
- **When to use it:** first, on an unfamiliar codebase or before a refactor.
- **Command:** `meerkat map [--app <folder>] [--json]`.
- **Exit codes:** 0 done; 2 usage error.
- **Does not:** import or run your code (it reads text with regular expressions), guess an import it cannot resolve (it is marked unresolved with a reason), or map more than a fixed number of files.
- **Status:** OK.

## Red testing

- **What it does:** attacks Meerkat itself with throwaway projects: planted bugs (recall per family), injected faults (a check that throws or hangs, a missing program), odd inputs (empty folder, huge file, symlink loop), one test per past fixed bug, and clean twins that must produce no false alarms.
- **When to use it:** when changing Meerkat's checks or runner.
- **Command:** `node lib/redtest/run.mjs --kind mutation|faults|adversarial|regression|cleantwin|all` from a repository checkout. The files are also part of `npm test`.
- **Exit codes:** those of the test runner (0 all passed). Known gaps are recorded as expected failures in [lib/redtest/README.md](../lib/redtest/README.md).
- **Does not:** exist as a `meerkat` command, or touch any folder the test did not create.
- **Status:** PARTIAL (works from a checkout only; it is not part of the installed command).

## Advisory scan

- **What it does:** `lib/advisory.mjs` reads the manifests of a project, matches its packages against a local OSV snapshot offline, and advises. Only a refresh of the snapshot would use the network.
- **Where it stands:** nothing in the command line, the menu or the MCP server calls it on this branch, so there is no command to run. Dependency advisories today come from the `npm-audit-all`, `rust-audit` and opt-in `detectors` (osv-scanner) checks.
- **Does not:** change, stop or update anything, even when finished.
- **Status:** PLANNED (as a command). The library exists.

## Catalog and tests command

- **What it does:** `meerkat tests --json` prints every kind of test and family of check: what it proves, what triggers it (`commit`, `pr`, `gate`, `promote`, `manual`), its cost (`fast`, `medium`, `slow`) and what it needs (tools, network, app). It is generated from the check registry, so it cannot drift. `meerkat.order.json` in the project folder sets which kinds start first.
- **When to use it:** to pick tests, or to find which check proves a thing.
- **Command:** `meerkat tests [folder] [--json]`. Order file: `{"version": 1, "kinds": ["security", "functionality", "ui", "performance", "refactor"]}`.
- **Exit codes:** 0 done; 2 when `meerkat.order.json` is wrong (unknown kind, repeated kind, unknown key or bad JSON).
- **Does not:** run anything. The order file changes what starts first, never what runs; dependencies and lane limits still apply.
- **Status:** OK.

## MCP tools

- **What it does:** a stdio MCP server with six tools: `meerkat_run`, `meerkat_list`, `meerkat_presets`, `meerkat_last`, `meerkat_why`, `meerkat_self_test`. `meerkat_run` can take minutes (up to 30) and sets `isError` when the exit code is not 0. Folders must be inside the folder the server started in or one added with `meerkat root add`. Text read from logs is withheld if it looks like it contains a secret.
- **Command:** `meerkat mcp serve`, `meerkat mcp install [claude] [--dry-run]`, `meerkat mcp status`, or `node bin/meerkat-mcp.mjs`.
- **Exit codes:** the server speaks JSON-RPC on stdin and stdout; a failed run is reported inside the tool result.
- **Does not:** offer a gate, blast, map or catalog tool. For the merge gate call `meerkat_run` with `preset: "full"`; for blast, gate, map and the catalog use the shell commands.
- **Status:** OK (the six tool names were listed from the running server).

## MCP resources and prompts

- **What it does:** read-only resources from the newest run: `meerkat://run/latest/findings`, `meerkat://run/latest/report` and the template `meerkat://run/latest/log/{check}`. Three prompts: `triage_newest_run`, `check_one_fix`, `scan_diff`. Prompts are text to pick; they run nothing.
- **Does not:** explain why a finding matters (rule, evidence and place only) or add a write path.
- **Status:** OK.

## Hook safety

- **What it does:** `meerkat hook install [folder]` adds a git pre-push hook that runs the quick preset with `--ratchet`. It writes one block between marker lines, creates the hook if missing, appends to an existing hook without touching the rest, and replaces only its own block on a second install. `meerkat hook remove` removes only that block.
- **Exit codes:** 0 done; 1 not a git repository, or the hook could not be written.
- **Does not:** overwrite your own hook lines, or push anything. It is not listed in `meerkat help` yet.
- **Status:** OK.

## AI verification of findings

- **What it does:** optional, off by default. `--ai-verify` (or `v` on the results screen) asks the model you chose (`meerkat ai use`) to double-check each medium, high and critical finding. It says what it will send first and asks unless `--yes`. Verdicts add notes; nothing is deleted. A model error is NOT RUN, never a pass.
- **Status:** PARTIAL. Documented in [reference.md](reference.md); not re-run in this pass because it needs a model and a key.
