# Changelog

Every released version of Meerkat, newest first. Versions follow semantic versioning: a patch fixes, a minor adds, a major changes how you use it.

## Unreleased

## 0.5.3 (2026-11-08)

Safer by default, quieter output, fewer false alarms.

- Gate: `meerkat gate` applies every pack that fits the folder and uses the `bugs` preset by default (no style or documentation rules). `--all` runs everything. The output is the failures plus one summary line; `--verbose` lists every check.
- Project code is never run unasked. Check files in `extraChecks` and `.meerkat/checks` need a one-time yes in a terminal; operators can set `MEERKAT_TRUST_PROJECT=1`. CI and runs with no terminal refuse project code and say so.
- Trust covers the check files, the files they import by a relative path, and `package.json`. It refuses a `node_modules` folder or a symlinked folder inside a check folder, and fails closed when the file or size cap is hit.
- The pre-push hook fails closed: if Meerkat cannot run, the push is blocked and the message says so. `MEERKAT_ALLOW_HOOK_FAIL=1` pushes anyway, and the bypass is written to `hook.log`.
- `meerkat update` fetches the release tarball and checks its SHA-256 against the GitHub release, then checks that the commit matches the release tag, and installs that exact commit. It fails closed and has no bypass.
- The last run is kept per project and per preset. Self-tests never replace it, and read commands (`last`, `findings`, `why` and the like) say which run they used.
- First-run note, and log paths are printed.
- `--no-input` is accepted by every command. `meerkat dismiss` and `meerkat rules test` exit 2 on usage errors. Unknown config keys are warned about. A cut-off findings list is named as truncated.
- False-alarm fixes: an `innerHTML` set from a constant on one line, `break` inside loops, markers inside quotes, history rules judging new commits only, and `merge-commit-noise` and `large-commits` using the same commit range.
- The `quick` preset no longer runs style-only and documentation-only checks.
- Verdict JSON: a stopped run and a finished run carry the same fields: `blocking`, `known`, `knownFindings`, `stale`, `behindBy` (commits the base is ahead) and a `checks` array (one row per check with status, seconds, cached, detail and places). The verdict word matches the exit code (INCOMPLETE for 75, NO-RESULT for 2).
- Verdict: a branch more than 20 commits behind its base returns NO-RESULT (exit 2) in every outcome, unless `--allow-stale` is given. Timing lines print by themselves for runs over 60 seconds.
- Verdict: the overall run limit is 1500 seconds by default (`MEERKAT_VERDICT_TIMEOUT_S` overrides it). Before, it was 300 seconds, which cut Rust tests short.
- Verdict: each complete run writes its summary to `<data folder>/verdicts/<repo>-<branch>.json`.
- Verdict: an explicit line says whether the base comparison finished.
- `rust-test` runs only the crates the change touches when the change is inside crates (a workspace-level change still runs everything), waits at most 300 s for the cargo lock, and says which crates and target directory it used.
- Exit codes follow one table (0 pass, 1 fail, 2 nothing judged, 75 incomplete), and `docs/neuralvault-gate.md` describes it for NeuralVault use.
- Added a Linux CI job. It has not been verified on GitHub yet.

- Gate cache: the cache key includes a digest of the result code, so a code fix never reuses an old cached result.
- Verdict JSON on a cargo-lock wait: `verdict` is INCOMPLETE (exit 75) and the object carries `checksTotal`, `checksFinished`, `checks` and `lockHolder`, the same fields as every other verdict.
- The WAITING line names the lock holder's pid and command in both wordings the lock uses. It printed `?` and `unknown job` before.
- Gate: a failed test always blocks, and a panic outside the diff is not treated as wide. A cargo test failure is a failing check named by its test, not a crash (it needs exit 101 and cargo's failure summary).
- Timeouts: a written per-check time limit is a hard ceiling. Load or size no longer stretches it (`rust-test` is 1200 s).
- Dev baseline: results are stored per exact base commit, and a new base commit is checked again.
- Verdict JSON: `unmatchedKnown` carries the same value as `stale`, `skippedByPath` lists checks skipped because no changed file matched, and `checksTotal` and `checksFinished` count the same checks everywhere. Unclassified findings are INCOMPLETE (75), never PASS.
- First-run note: shown once per machine.
- `meerkat frontend`: a source file maps to its sibling test, and a test step takes only test files. Skipped steps are never a pass.
- `meerkat batch`: the run cap is 12 gate runs (`MEERKAT_BATCH_MAX_RUNS`), and the status line names the cap when it is hit. Progress and lock-wait lines reach the terminal, and the result file records timings.

### Renamed or changed output

- `stale` keeps its meaning (known-file entries that matched nothing). `unmatchedKnown` is the same value under a clearer name.
- `line 0` in `places` and `knownFindings` means a file-level finding, not a line.
- Exit codes follow one table: 0 pass, 1 fail, 2 nothing judged or a usage error, 75 incomplete.

### New commands

- `meerkat batch --base <ref> --app <repo> <branch1> <branch2> ...`: gates several branches together in one run, names the branch whose change fails (and whether the same check fails on the base), re-gates without it, and writes a result file per batch plus a `latest.json` per repo. Refuses a batch over 3000 changed lines or 15 PRs unless `--max-lines`/`--max-prs` say otherwise; `--dry-run` only plans, and a refusal exits 75. Exit 0 all pass, 1 a branch blocked, 75 incomplete or refused.
- `meerkat frontend --app <folder> [--files <list>]`: runs the commands block's typecheck, test and build steps and writes `frontend.json`. A step with no command, or a test step with no test file, is skipped and the run is not a pass (exit 75). The commands block must be trusted (`meerkat trust`).
- `meerkat verdict`: one line for a branch, `PASS` or `FAIL n blocking in changed files`. Options: `--base <ref>`, `--json` (one object), `--known <file>` (accepted failures print `KNOWN`, an entry that matches nothing prints `STALE`), `--first` (only the first blocking `file:line: message`, or `PASS`), `--ready` (one `READY` or `NOT READY` line, no claim about tests) and `--branches a b` (one line per branch, each checked out in its own temporary worktree).
- `meerkat top`: one table of the worst findings in the files the branch changed (`--limit`, `--line`).
- `meerkat commands`: lists the repo's own test, build and typecheck commands, from the `commands` block of `meerkat.config.json` or the `package.json` scripts. `meerkat trust` approves the block; `meerkat test` and `meerkat build` run it.
- `meerkat fix`: a unified diff for a finding when its check has a safe fix. A dry run by default; `--apply` writes only if the line is still the one the finding was made from.
- `meerkat handoff`: one markdown file of under 60 lines (verdict, open findings in changed files, branch, commit, next command) written in the run folder. `--read` prints its header and next command.
- `meerkat test-run`: run one test file or test name with a time limit through the repo's own runner (vitest, jest, cargo test or pytest). Exit 124 on a timeout.
- `meerkat lock status`: who holds the machine-wide cargo lock and who waits, with pid, command and time. Read-only.
- `meerkat who-calls`, `meerkat deps` and `meerkat tests-for`: answers read from the code map, which refreshes only changed files first.

### Behaviour changes

- Verdict exit codes: exit 1 only for a new blocking finding in a changed file. A finding the branch did not add prints `PASS` and a second line `pre-existing: N (not in this diff, does not block)`. `NO-RESULT` is exit 1 or 2 and never a pass; a run stopped early is `INCOMPLETE n of m checks finished, not a pass`, exit 75.
- `meerkat gate` uses the `bugs` preset unless you pass `--all`. Gate output is compact by default, in the command line and over MCP (`full: true` or `--full` asks for everything).
- Progress lines (`[12/218] check ... 0.2s FAIL`) and a 5 second still-running line go to stderr, so the answer on stdout can be piped.
- `gate`, `verdict` and `top` print the merge base they compared against, and the folder, branch and whether it is a worktree, on stderr.
- `verdict` and `top` run with the result cache off, so they do the whole work each time. The default time limit is set by `MEERKAT_VERDICT_TIMEOUT_S`, and `--max-seconds` stops a run on purpose.
- A damaged store file is moved aside and said so; an unreadable `meerkat.config.json` stops gate and verdict with exit 2. Every run folder gets a `summary.json`.

### Fixes

- Security: repo commands run only after `meerkat trust`; control characters and Unicode format and separator characters are rejected in them and stripped from everything printed; the `handoff` folder is always single-quoted and must be a real directory, and every written value is sanitised.
- Security: `meerkat lock status` refuses a linked waiters folder and strips control characters.
- #82: example scripts' imports of `cargoCmd`, `findBin` and `looksLikeStaging` from `thorough/lib.mjs` resolve, and a test checks every example import.
- #83: discovery skips project scripts that start Meerkat, and a nested run discovers nothing.
- #60: the Tauri fs-path guard clears only the variable it checked, and the Electron range uses its lowest allowed version.
- #55: `docker-dockerignore-missing` reads the build context from CI workflows and Makefiles.
- Fewer false alarms from several checks (`risky-code`, `unicode-control-chars`, `js-unhandled-promise`, `env-example`, `typosquat-names`, `pii-patterns-in-source`, `telemetry-calls`, `dead-code`, `unused-files`), and `gitattributes-eol` reads committed line endings.

- verdict: `--branches` gives the same result as a plain verdict, and `--json` prints only JSON (one object, or an array for several branches). Every verdict JSON carries `schema: 1`.
- verdict: `--known` also applies when the run is INCOMPLETE; accepted places are counted, not blocking.
- Unknown options stop the small commands with exit 2 and write nothing.
- `smoke` exits 1 on blocking findings, the same as `gate`.
- `test` with no test command prints one line and exits 2 instead of running the quick check.
- Exit codes: bad, unknown or missing ids, missing folders and non-git folders exit 2 (table in docs/reference.md).
- Electron: a preload loaded by basename from its folder, and files named in package.json `build`/`files`, count as used. A constant template in executeJavaScript is not flagged.
- Timing and history files live in the Meerkat data folder (`MEERKAT_LOG_DIR`, else `~/.meerkat`). Old `~/.meerkat-*.json` files are not migrated.

_Not yet tested on real PRs (TBD):_ verdict exit for a no-diff branch (B17), `top` NO-RESULT exit (B12), the behind-base note, and the hadolint and actionlint messages.

### Known limits

- Not on this branch: `meerkat cost`, `meerkat team`, `meerkat impact`, evidence on `meerkat dismiss`, and editor output (`--format vscode` and `--format jetbrains`). They live on separate branches and are not part of this release. So the refusal of symlinked evidence and team files is not part of it either.
- The whole test suite has not been run on this final head by this change. Run the checklist in docs/release-0.5.3-checklist.md before you tag.
- `meerkat verdict --help` does not yet list `--first`, `--ready` or `--branches`; they are in docs/commands.md.
- `meerkat update` and the trusted-publishing workflow are unit-tested but not verified against a real newer published release. Click-through reference drivers have not run against a real app. The Linux CI job has not been verified on GitHub. Rust findings are leads, and the false-alarm figure is from one project.

Not in 0.5.3: a re-measure of recall, batching and speed work, designs aimed at AI use, a run of the GitHub Action, team features, and the gap features.

## 0.5.2 (2026-11-07)

- Integration 6 sweep: the README has an Everyday commands table (scoped gate, pre-commit use, brief, blast, map, ratchet, run flags, findings for CI, MCP scope, SKIPPED, commit-message scope, workflow profiles, memory adapter, release tools, update, Windows guard, estimate) and its stale 'gate and smoke are not routed' notes are gone; `meerkat redtest` is listed in docs/commands.md; docs/reference.md describes the careful update path. Fixes found by merging: the release pack list now allows the `profiles/` folder that package.json ships (tools/release/pack-list.mjs, tests/release-tools.test.ts), a SKIPPED check's time is learned so the run estimate no longer keeps its written guess (lib/timings.mjs, lib/timings.test.ts), and four tests were updated to the new result shapes (`counts.skipped`, the MCP status line). PLACEHOLDER: the smoke and red suites (smoke-red-2026-11) are not merged.

- MCP parity with the command line (lib/mcpparity.mjs, lib/mcpruns.mjs, lib/mcpscope.mjs; tests lib/mcpparity.test.ts). `meerkat_last`, `meerkat_why`, `meerkat_findings`, `meerkat_finding`, `meerkat_suggest` and `meerkat_pr_comment` take `folder`, `run` and `preset`, so a call reads the newest run of that project (or of that preset in it) and not the newest run of any project; without them they behave as before and say which project and run they read. `meerkat_run` takes `ratchet` and the run flags `config`, `noConfig`, `group`, `failFast`, `keepGoing`, `maxRunMinutes` and `timeoutScale`; `meerkat run --help` lists `--ratchet`. `meerkat findings --fail-on <severity> --new` counts only new findings, `--export markdown` is accepted and `--export <fmt> --json` prints the path of the saved file; `meerkat_findings` takes `failOn`, `new` and `export`. New tools `meerkat_version`, `meerkat_check_list`, `meerkat_prompt` and `meerkat_run_list`; `node bin/meerkat-mcp.mjs --list-tools` prints the version and tool count. Every tool result starts with one status line and carries `structuredContent.schemaVersion`, and each tool lists an `outputSchema`. The resource template `meerkat://run/latest/findings{?folder,run,preset}` reads one project. The docs no longer type the tool count.
- Fixes from a real run on the Plume project (tests: tests/git.test.ts, tests/skipped-state.test.ts, tests/config.test.ts, tests/lock-parents.test.ts, tests/risky-allow.test.ts). (1) `commit-message-format` now judges only the commits that are not yet on the default branch (`git log <base>..HEAD`, base = origin/HEAD, origin/main, origin/master, main, master); an old long subject already on main is no longer reported. With no base, or with HEAD on a local default branch and no remote, it checks the last 20 commits and says so. (2) A style tool the project never configured (eslint, prettier, stylelint) is now SKIPPED with the reason on the same line, not NOT RUN; NOT RUN stays for a configured tool that cannot run. SKIPPED is counted apart in the summary line, `summary.json` (`counts.skipped`), `findings.json` (`skipped[]`), the report and the gate, and does not change the exit code (check exit code 74; lib/toolconfig.mjs). (3) `gitattributes-eol` says that mixed line endings are a style choice, not a defect, names the `.gitattributes` entry and the `.meerkat-config-allow` line that settle it, and stays low. (4) `deprecated-deps` and the `wh-supply` lockfile rules (deprecated entry, duplicate versions) name the direct dependency that pulls a package in, read from the lockfile (lib/lockparents.mjs), or say "transitive, parent unknown". (5) `risky-code` prints the exact line to paste into `.meerkat-risky-allow`, and that file accepts `path:line # reason`; it is read from the scanned project's own folder. A precise escape-helper recognition (seeing that an innerHTML value came from a function that escapes its input) is not built.
- Gate: scoped by default, and quicker on repeat runs. `meerkat gate --staged` and `--base <ref>` now block only on failures that point into a changed file; failures about the whole project (a missing SECURITY.md, licence or README) are listed under "project-wide, not blocking" with a count. `--all` restores the old behaviour (everything blocks, every passing check is listed). The output starts with one line (blocking count, files scanned, time) and passing checks are a count instead of one line each. A new result cache (`lib/gatecache.mjs`, `--no-cache` to skip) reuses a check's result when its inputs are unchanged; repo-document, CI-config and git-history checks ignore source edits; language-specific checks wait for a changed file of their language (`lib/gatepaths.mjs`). Tests: tests/gate-scope.test.ts.
- Windows: `!` in a command run through cmd.exe is now refused when delayed expansion is on (registry value DelayedExpansion = 1 under HKCU or HKLM SoftwareMicrosoftCommand Processor), and when the registry cannot be read within 3 seconds (fail closed). `quote()` still allows `!`; the check runs in `runCommand` (lib/exec.mjs `bangRefusal`). No change on Linux or macOS. Tests: tests/exec-bang.test.ts.
- Code map (`meerkat map`, schema version 2), reworked so it is clean, stable and keeps itself current (lib/codemap.mjs, lib/mapparse.mjs, lib/mapsync.mjs, lib/githead.mjs; tests lib/mapsync.test.ts, lib/mapparse.test.ts, lib/codemap.test.ts, lib/blast.test.ts). New in the map: a build header (commit, time, content hash), every file's purpose (from a leading comment, never guessed), functions, classes and methods with line numbers, routes (Express, Fastify, Hono, Koa router, Restify, hapi, Polka, Next.js app router and pages/api, Flask, Quart, FastAPI, Sanic; a framework seen but not parsed is named in the header), and which test files import which source files. The output is sorted and has no clock in its content: an unchanged project gives byte-identical files and no new run folder. Per-file facts are cached by content hash in the Meerkat data folder, so a second run re-reads only changed files; `meerkat map --check` exits 1 and lists stale files; `--quiet` is safe in a git hook (docs/codemap.md). `meerkat blast`, `meerkat brief` and the MCP map tool refresh changed files first and say so in one line. `meerkat://map/latest` now returns the map of the current project. A brief outside a git work tree is no longer cached (nothing could tell which other files changed).
- New: release gate and release tests (tools/release/, documented in docs/release.md, covered by tests/release-tools.test.ts, 30 tests). `node tools/release/gate.mjs` runs the changelog check (Unreleased section, dated versions, newest version equals package.json), the `npm pack` file-list allow rule, `npm audit --audit-level=high --omit=dev`, the secret scan and the fix-needs-a-test check (a warning, `--strict` fails). `tools/release/tarball-smoke.mjs` packs, installs the tarball in a fresh project and runs the installed bin; `tools/release/upgrade-smoke.mjs --previous <spec>` installs the old version, saves state, installs the new one over it and reads the state back. CI runs the gate on every change and the publish workflow runs it before `npm publish`. The Scorecard workflow is documented, not added (the repository is private). The trusted-publishing workflow needs its one-time setup on npm and has not been run end to end
- New: workflow profiles. `profiles/` holds six starting configurations as data (`solo`, `team`, `ai-agent`, `legacy`, `monorepo`, `ci-only`), each naming its preset, scope, blocking severity and suites, output format, cache use and commands. `meerkat init --profile <name>` prints the config it would write and the commands of that workflow; it writes `meerkat.config.json` only with `--write`, and refuses to replace an existing one without `--force` (lib/workflow-profiles.mjs, tests/workflow-profiles.test.ts). Config files may now carry a `workflow` record and a `memory` key.
- New: `meerkat memory`, a thin hook that calls the memory adapter named by `"memory": { "adapter": ... }` in `meerkat.config.json` and does nothing without it (lib/memory.mjs). The first adapter, `examples/neuralvault/export.mjs`, writes the findings summary, the code map summary and the run's pass and fail counts into one note in a NeuralVault vault folder (found through `NV_VAULT_PATH` or `~/.neuralvault-vault-path`), with a "what changed since last export" section. It refuses to write outside the vault and refuses a note in which redaction finds a secret-like value (tests/memory-adapter.test.ts).
- New checks in the hygiene pack, found missing by an end-to-end test on a planted app (thorough/gap-rules.mjs, covered by tests/gap-rules-2026-11.test.ts, 33 tests): `key-in-config` (a key-shaped string such as sk_, ghp_, AKIA or xox assigned to a key-like name; the message says so when the value contains FAKE or TEST; environment reads and test fixtures are left alone), `test-no-assert` (a JavaScript or TypeScript test that calls code and never asserts; helpers defined in the file that assert count; skipped and todo tests are left alone), `img-alt-missing` (an img with no alt attribute in .html, .tsx, .jsx, .vue or .svelte; alt="" is accepted as decoration), `scripts-binaries` (a package.json script that starts with a program that is not in node_modules/.bin, not on PATH and not a shell builtin; it never runs the script, and without node_modules it judges from the dependency list), and `payment-status-unchecked` (a candidate, not a failure: an awaited, assigned chargeCard, charge, transfer or refund call whose result is never checked for .status, .ok or an error, with no try block). Accept a finding in `.meerkat-gap-allow`. Run on the planted app each rule gives exactly one finding and the decoys stay quiet
- New: `meerkat brief <file>[#symbol]` (and MCP `meerkat_brief`, one of the MCP tools). One fast pre-edit call: declaration and signature, callers (count and the first 10 with the calling function), tests that reference it, findings from the last saved run (no scan is started), recent git churn, a risk tier with every reason written out, and a before-you-edit checklist. `--json` adds a `version` field. Cached by content hash, so a repeat call is quick. Covered by lib/brief.test.ts and lib/mcptools.test.ts.

## 0.5.1 (2026-11-06)

A hotfix release. Items marked unverified were not proven against a real newer release or a live client.

- Smart update: `meerkat update` now verifies the new version in a copy first, keeps your local changes, and saves a patch of them before it changes anything. It refuses only when a file the update changes overlaps files you edited. Unverified against a real newer published release; covered by unit tests (lib/smartupdate.test.ts, lib/updatedirty.test.ts)
- Update banner fixed: the "update available" banner was hidden by a network timeout and by a stale cache entry. Both cases are handled now (lib/updatenotice.test.ts). Unverified against a real newer release
- MCP: `meerkat mcp serve` now offers 28 tools, 12 added. The new tools are covered by unit tests (lib/mcp.test.ts, lib/mcptools.test.ts, lib/mcpextras.test.ts); unverified against a live MCP client
- New commands and their help: the added commands are listed in `meerkat --help` and have their own help text (lib/help.test.ts, lib/cli.test.ts, lib/extras.test.ts)
- Hook injection fix: `hook install` refuses folder paths containing shell characters, and the installed hook quotes the path it uses (lib/hook-safety.test.ts)

## 0.5 (2026-11-06)

A minor release: it adds an MCP surface, skills, click-through drivers, new commands and a measured accuracy story. Everything below is taken from the code and docs on the release branch. Items marked unverified were not proven here.

- MCP: `meerkat mcp serve` now offers 16 tools (6 in lib/mcp.mjs, 10 in lib/mcptools.mjs): run, list, presets, last, why, self_test, gate, smoke, blast, map, tests, findings, finding, redtest, dismiss, baseline. It also serves 5 resources (latest findings, latest report, per-check log template, latest code map, test catalog) and 9 prompts (triage, one fix, scan diff, pre-commit, pre-PR, secrets, blast before edit, map unfamiliar repo, red-test scenario). `meerkat_dismiss` and `meerkat_baseline` write to the home folder, so keep the client's approval step on. The ten added tools are covered by unit tests; unverified against a live MCP client in this release
- Skills: a `skills/` folder of 9 short guides for an AI (meerkat, before a commit, before a PR, blast radius before an edit, mapping unfamiliar code, click-through, docs check, secrets before posting, smoke and red tests)
- Click-through protocol 2: the driver stays alive for a whole scenario and talks newline-delimited JSON over stdin and stdout (hello, ready); protocol 1 is deprecated and kept for one release. Reference drivers are in examples/drivers: CDP (browser or Electron) and Windows UI Automation. They have NOT yet been run against a real app: unverified, treat as unproven. Only a fake driver and unit tests (tests/clickthrough.test.ts, tests/cdpdriver.test.ts) have run
- rust-plus: the runtime rules (panics, unwraps, blocking, spawning, channels, locks, swallowed errors) skip `#[cfg(test)]` modules and `#[test]` functions; 17 pedantic rules were narrowed because they flagged correct real code; pedantic rules with a labelled sample were promoted into the default run (79 per docs/accuracy.md)
- Real-code benchmark for the Rust rules: `benchmarks/real-rust/` compares the rust-plus checks with findings a person labelled TRUE or FALSE by reading the source. Labelled false alarms fell from 20 to 6 of 130 labelled findings (4.6%) with no labelled true finding lost. One project (NeuralVault), one language
- New commands: `meerkat gate` (only the checks that cover the changed files), `meerkat smoke` (proves each check starts and stops in time), `meerkat blast <file>[#symbol]`, `meerkat map`, `meerkat tests` (the catalog, `--json`). Gate, smoke and blast exit 75 when they could not start, which is never a pass. The old preset `smoke` is now `project-smoke`
- Hook safety: `meerkat hook status`; `hook install` refuses unsafe hook files; the pre-push block lets a push go with a message on stderr when node or run.mjs is missing or the run times out, and still blocks on a real Meerkat failure
- Accuracy, measured 2026-11-06 (docs/accuracy.md): planted-bug recall 99.77% (1735 of 1739) in the default run and 100% in the pedantic run; 0 false alarms on 1739 clean twins; 4.6% false alarms on real Rust code (6 of 130 labelled); real-code mutation run 37% (default rules) and 98% (all rules) on 200 mutants, from one run whose raw output is not stored here (unverified, re-run before quoting). The planted corpus is built from the rules' own samples, so those figures are near the ceiling by construction
- Not verified in this release: a full `npm test` run, and the click-through drivers against a real app

The entries under "Carried-over notes of the minor release above" below are part of this release. \*

> \*Corrected 2026-11-07: that section was headed "Unreleased" by mistake after the release; it is renamed so the changelog has one Unreleased section, at the top.

## 0.4.1 (2026-11-04)

- Updates: U works from the project picker, updates survive a folder on another branch, a spinner while checking. New smoke preset and --scope to check one folder. Accuracy corpus is opt-in.

## Carried-over notes of the minor release above

### Added

- `bugs` preset (`meerkat bugs`): the quick run without style, documentation and housekeeping rules (undocumented public items, markdownlint, missing Debug derive, String error types, `push_str(&format!)` and others), so a finding is likely a real bug. The excluded checks and rules, one reason each, are in `lib/bugs-preset.mjs` and docs/checks.md; presets can carry `excludeChecks` and `excludeSubs`. A rule that is turned off (by this preset or by `disableSubs`) is now also left out of the findings, not only the verdict (tests/bugs-preset.test.ts)
- Five rules from real NeuralVault bug-fix commits that Meerkat had missed: `rapi-debug-secret-enum-field` (a secret field in an enum variant of an enum that derives Debug), `rerr-swallowed-read-then-write` (a heuristic: `read_to_string(..).unwrap_or_default()` feeding a plain `fs::write` in the same function, promoted to the default Rust rules), and in `cp-js` `js-deno-handler-raw-error` (a `Deno.serve` handler that returns `String(e)` or `e.message` with no caller check before it), `js-await-after-debit` (a heuristic: an awaited `fetch` or body read after a reserve or debit call with no `try` around it) and `js-duplicate-import-binding` (the same name imported twice, a SyntaxError in a module and TS2300 in TypeScript, so no type checker is needed). Each has a bad and a clean sample proven by `--fixtures`. The `code-patterns` sub-check counts are now computed from the rule tables
- `meerkat gate` runs only the checks that cover the changed files (`--staged`, `--base <ref>` or `--against <ref>`); `meerkat smoke` proves each selected check starts and stops in time. Both exit 75 when they could not start (no base, not a git repo, no checks loaded), which is not a pass (lib/gate.mjs, wired in bin/meerkat.mjs)
- `meerkat hook status`: shows the hook file, whether the Meerkat block is installed and whether an install would be allowed. `hook install` now refuses unsafe hook files, and the block is tool-fault safe: if node or run.mjs is missing, or the run times out (600 s when a working `timeout` exists), it says so on stderr and lets the push go; a real Meerkat failure still blocks with its own exit code (lib/hook-safety.mjs)
- Planted-defect corpus generator and measurement: `tools/corpus/gen-planted.mjs` writes every planted defect and its clean twin into a complete base project, `tools/corpus/measure.mjs` reports recall and false alarms per family (the `corpus/` folder is gitignored and is generated, not committed)
- Real-code benchmark for the Rust rules: `benchmarks/real-rust/` (labels, baseline, `measure.mjs`) compares the six rust-plus checks with 387 findings labelled TRUE or FALSE by reading the source
- docs: `docs/features.md` and `docs/ai.md`; README and docs rewritten to say what Meerkat is now (a scanner for people and a tool for AIs)
- tests for each fix below (tests/innerhtml-precision, tests/testcode-secrets, tests/secsupply, tests/rustplus-testskip, tests/rustplus-wrongrules, lib/hook-safety)

### Changed

- Commands load lazily: the command words live in `lib/extras-words.mjs` and the heavy modules are loaded only when a command needs them. The commit message records `--help` loading 17 modules instead of 85 and `tests --json` 109 instead of 141 (counts taken from that message, not re-measured here)
- One command surface: the build-and-test preset `smoke` was renamed `project-smoke` (the word `smoke` is now also a command), help lists every command, and one exit-code table covers all commands (docs/commands.md, lib/help.mjs)
- rust-plus: the runtime rules (panics, unwraps, blocking, spawning, channels, locks, swallowed errors) skip `#[cfg(test)]` modules and `#[test]` functions; documentation, Debug, readability and unsafe-contract rules still report there
- rust-plus: 17 pedantic rules were narrowed because they flagged correct real code
- planted-corpus work raised the recall of the generator-companion and column-0 variants, and the wasm panic-hook rule now reports on the first code line

### Fixed

- secret-scan: files are read in chunks (1,000,000 bytes by default, `MEERKAT_SECRET_SCAN_CHUNK`) so a large file is no longer skipped silently with "no secrets found"; a file above 50,000,000 bytes (`MEERKAT_SECRET_SCAN_MAX`) is reported NOT SCANNED instead of passing
- risky-code: the innerHTML scanner fails closed. A region it cannot read with certainty (an unterminated string, a `/` that may be a regex, a statement with no clear end, or an exhausted scan window) is reported, never treated as safe; scans are bounded (200,000 characters and 2,000 lines per assignment, 4,000,000 characters per file)
- workflow security: each checkout is judged by its own step, and YAML comments are ignored when looking for `persist-credentials`
- Not yet verified on the full suite in this release branch: the full `npm test` result and the accuracy corpus (see the pull request notes); generated counts in the README and docs/checks.md are refilled by a separate step

- accepted findings: `meerkat dismiss <id> --reason "..."` accepts one finding (kept with its reason in the home folder, never in the project); `meerkat undismiss`, and `meerkat dismissals` (or `--stats` for each rule across every project, so a rule dismissed again and again shows as a review candidate). A check whose every finding is accepted passes, and the run records what was accepted in `accepted.json`
- `meerkat baseline` accepts the newest run's findings as they are; `meerkat run --ratchet` then fails only on findings that are not in the baseline
- project integrity: a check that writes into the project now fails the run (`project-integrity`), listing the files. Intended writes can be allowed with `"allowWrites": [globs]` in meerkat.config.json
- result cache: a check that passed on the exact same project (file snapshot, commit, tier, version) within six hours is reused and marked as cached; `--no-cache` runs everything again. Only passes are cached
- `--format github` prints GitHub Actions annotations for open findings
- `meerkat pr-comment` prints a markdown summary of the newest run for a pull request; `meerkat hook install|remove` manages a pre-push hook (quick preset, --ratchet)
- `meerkat suggest` prints suggested commands for findings (cargo-audit advisories get `cargo update -p <crate>`); Meerkat never runs them
- `meerkat trend` lists recent runs: findings by severity, new and fixed
- data rules: a language can be covered by JSON rules with a bad and a good sample each (`meerkat rules test <file.json>` checks them). New pack `c-cpp` (off by default): gets, strcpy, strcat, sprintf, system, unbounded scanf, rand for secrets
- doctor lists missing tools with the number of checks each would unlock, most useful first
- an Electron install that is damaged in node_modules is NOT RUN with the fix, not a failed window check

- smoke: a new preset, `meerkat smoke`, that answers "does my change break anything": the build, the type check, the lints and the quick tests, for any project. It is the same checks as `functionality-fast` under a clearer name; use it after changing code, with `--changed` or `--scope` to narrow it
- scope: `--scope <folder>` works with any preset (repeatable, or comma separated). It runs only the checks that read files in that folder and keeps only the findings inside it. A failing check whose findings are all outside the folder passes for that run. Repo-wide checks (git history, commit messages, dependency counts) still run and are not limited by it. `--changed` and `--scope` cannot be combined
- scope: the verdict of a check is taken from its findings inside the scope, read from the structured findings or the file paths in its saved output, so the scoped verdict and the findings file agree
- tests: unit tests for the scope helpers (tests/scope.test.ts) and for the regex escaping (tests/project-ctx.test.ts)
- docs: README and the reference name `smoke` and `--scope`; CONTRIBUTING gains a "Check your change" section; developers.md explains how a check should respect a scope
- scope: `--scope <folder>` (repeatable, or comma separated) runs only the checks that read that folder, and keeps only the findings inside it; a failing check whose every finding is outside the scope passes for that scope. A repo-wide check (git history, commit messages, dependency counts) still runs and is not limited by the scope
- fix: the path-traversal check crashed on a parameter name with a `(`, and the crash was reported as a FAIL (found on NeuralVault); the name is now escaped
- updates: `U` now starts the update from the project picker too (only while no filter text is typed, so letters still filter); the menu hint says so
- updates: a Meerkat folder that is on a branch with commits GitHub does not have no longer shows the misleading "has changes of its own" error. Those commits stay on their branch, the folder moves onto the default branch, and the result says which branch was left. A detached HEAD with its own commits is still refused, and so is a local default branch with commits of its own
- updates: a spinner shows while the menu checks GitHub (it no longer looks frozen), and a line says the update is being installed
- docs: docs/developers.md for people changing Meerkat: folder map, generated files to regenerate, and what an update does and never touches
- tests: the slow accuracy corpus no longer runs in a normal `npm test` (it timed out there). Run it with `npm run test:accuracy`; CI still runs it on every change
- tests: the compatibility matrix gets 150 seconds locally (it was 55, too tight on a busy machine), and its temp folder is cleaned up with retries on Windows
- tests: the version test names its recorded exceptions (dated accuracy records, a fixture), and fails if one of them stops naming a version
- updates: after a folder moves off its branch, the result prints the exact command to push that branch
- docs: README has a one-line try-it under the tagline, separate clone and `cd` steps, a version check after install, and macOS/Linux path examples; CONTRIBUTING runs `npm test` and the self-check with `node run.mjs`, and sends changelog entries to `## Unreleased`; developers.md states the Node requirement and spells the update key `u`

## 0.4.0 (2026-11-03)

- Accuracy, measured on the final corpus: 1540 planted defects; 1533 detected by a check (99.5%) and 1532 found in the findings file (99.5%). By impact: critical 484 of 484, high 465 of 466, medium 349 of 352, low 235 of 238. By difficulty to find: easy 1021 of 1021, medium 323 of 324, hard 118 of 120, extreme 71 of 75. Seven planted defects are known gaps, listed in docs/accuracy.md. Clean and trap twins: that run reported 601 false alarms across 166 twins, **before** the test-quality fix and the later guard changes listed below; the final false-alarm rate was not re-measured, because the corpus was not re-run for this release. Recall on planted bugs measures what was planted, not real-world accuracy.
- The accuracy corpus grew: 45 low-impact planted defects, hundreds of false-alarm trap projects (clean code that looks like a bug to a naive rule) with a verifier (`tools/trap-lang-verify.mjs`), clean twins that carry their own tests, and clean-twin false alarms recorded in the run and in docs/accuracy-results.md.
- Two labels on every planted defect: impact (critical, high, medium, low) and difficulty to find (easy, medium, hard, extreme), read from tools/accuracy-tier-fragments and printed by the corpus run; the older single tier (critical, hard, medium, easy) is kept for the results table. See docs/tiers.md.
- Documentation sweep: every document checked against the code; stale counts, preset contents and measured times corrected or marked with their date; the README pictures regenerated from the current code.

- The quick preset (and fast) no longer runs compile-heavy checks: cargo clippy and test, go test, mvn compile and test, dotnet build, swift build, pytest, rspec, a project's build and test scripts, and any check that waits on a build. On a large Rust/Tauri app quick took 10 to 16 minutes and barely differed from full; it now states a 5 to 10 minute budget. `full`, `thorough`, `release` and the functionality presets keep every one of them. A new preset field `skipCompile`, the named list `COMPILE_HEAVY_IDS` and `COMPILE_HEAVY_COMMAND`, and a test that fails if quick selects a compile-heavy check.

- Quick keeps the JavaScript unit-test runners that run no compiler or build (`npx vitest run`, `npx jest`; for example unit-tests-changed). `npm test` stays out of quick, because that script may build first. The window checks (click-through, ui-screens) stay out too.
- Fourteen rules whose only signal is the shape of the code are reported as info, not as bugs: py-bind-all-interfaces, py-jinja-autoescape-off, py-shelve-open, js-template-no-escape, js-helmet-csp-off, rb-csrf-skipped, rb-weak-digest, go-weak-crypto-import, go-md4-md5-sha1, go-math-rand-import, java-weak-digest, cs-weak-hash, cs-cookie-insecure and cs-antiforgery-ignored. They are still found and listed in the report (the detection is unchanged); see `RULE_SEVERITY` in `lib/findings.mjs`.

- Fewer false alarms found by a full scan of a desktop app: electron-devtools-prod reports a DevTools toggle inside a user-invoked handler (an ipc handler, a key handler, a menu click) as info, and a forced openDevTools() still fails; install-scripts reports the install script of a development-only lockfile package (dev: true) as info, and a runtime dependency still fails; risky-code accepts innerHTML = fn(...) when fn is a local builder whose template holds only lookups in a table of plain strings; js-unhandled-promise accepts a call to an async function whose every await sits inside a try with a catch that does not rethrow, and a .then on a promise that was built with .catch. Every planted defect is still found.
- Fewer false alarms from the repository and configuration checks: sensitive-files and env-files-in-history ignore an environment file that holds only placeholders (${VAR}), empty values or plain settings, and a key file that holds only comments; ui-static accepts rel="noreferrer" as well as noopener and no longer asks a desktop app window for a viewport tag; the crate-root docs lint (rapi-missing-docs-lint) is asked of src/lib.rs only and is info; the compose read-only and no-new-privileges hints are info; debug-leftovers is low and tsconfig-strict is info. The clean twins of the accuracy corpus now keep their lockfile in step with package.json, resolve every import and carry the lang attribute their planted page lacks.
- Fewer false alarms on safe code in the web-security family: risky-code (a method named eval on another object, new Function and os.system with fixed text, a text constant passed to insertAdjacentHTML, DOMPurify around dangerouslySetInnerHTML, verify=False on a call that is not an HTTP request, yaml CSafeLoader, pickle after an HMAC check, host.docker.internal and the sitemap namespace, key: Math.random() as a list key), sql-concat (text constants and tables of text in a template, tagged templates, placeholder lists, Date.now(), help sentences that start with Select), cookie-flags (options held in a constant), hardcoded-ip (public DNS resolvers), local-storage-pii (setting keys such as passwordHintShown), open-redirect-pattern and path-traversal-pattern (route and file tables, path-only and strict-id patterns, the page's own pathname), regex-dos ((ab|a)+), weak-crypto-modes (a comment about passwords above an MD5 checksum), js-unhandled-promise (ipcMain.handle, a synchronous method with the same name) and gha-contents-write (a tag-gated job that runs gh release create). NODE_ENV=development in docker-compose.override.yml is now info. Every planted defect is still found.

- Two header and workflow rules now see layouts they missed: nginx settings (autoindex on, server_tokens not off, the other nginx rules) in any .conf inside a folder named nginx, and the pull_request_target trigger written inline (on: { pull_request_target: ... }). The accuracy corpus names the real rule ids for the HttpOnly, X-Powered-By and source-map defects, and its nginx clean twin is now properly hardened.

- Six more split-across-files shapes are caught: a recursive merge written as for (const key of Object.keys(...)) (and a guard written as a string no longer hides itself), an async helper called without await or catch, a helper that returns err.stack or err.message and a response that sends it, an options dict with verify False unpacked with ** into requests calls, requests.Session() calls with no timeout, and a blocking fs call in a helper that a handler calls.

- Text checks now follow a value or helper across files: a CORS, JWT algorithm, cipher, key or regex constant defined in one file and used in another, a file path or redirect target passed to a helper by its caller, SQL text grown with +=, and a safe-looking guard that is only imported no longer hides a path traversal. Also new: Caddyfile headers, app.enable x-powered-by, httpOnly false, helmet protections off, multi-line iframes without sandbox, source maps in a published folder, strict-ssl off, open-ended and x-range dependency versions, positive tabindex in single quotes, http scripts on any page, and ignored os.Rename style errors in Go.

- Four Rust tool checks in the detectors pack: cargo-geiger (unsafe usage), cargo-semver-checks (library API breaks, libraries only), and the opt-in nightly ones cargo-udeps (unused dependencies) and cargo-miri (undefined behaviour), `--include rust-nightly`. Findings of the same family collapse into one (unused-dependency, api-break, undefined-behavior classes).

- accuracy corpus recall 97.4% at that point (was 95.0%; the final 0.4.0 figure is in the first bullet of this section): the web, CI and infrastructure, and code and config gaps are closed; the accuracy thresholds were raised to match; the update-feed check exempts only timestamp servers by host, not any line that says timestamp
- Detection gaps closed in web security and packages: Caddy CSP unsafe-inline, helmet with HSTS or CSP off, session cookie with httpOnly false, app.enable('x-powered-by'), multi-line iframes without sandbox, shipped .map files, strict-ssl off, open >= and x-ranges, plain-http scripts and single-quoted positive tabindex.

## 0.3.15 (2026-11-02)

- Fewer false alarms and a much faster scan: noisy rule families rolled up or off by default, a detectors preset with cross-tool confirmation, a ground-truth benchmark, window checks left out of full
- cross-tool confirmation fixes: findings join a group only when they match every member, never chain through a third finding, two different secrets on neighbouring lines and file-level findings with no line are no longer merged; the accuracy corpus counts every reporter of a merged finding
- the whole Rust style family (documentation, error style, performance and async hints) is off by default, whatever its severity: an audit of 36 sampled medium findings judged 1 useful, 16 false and 18 noise; MEERKAT_FINDINGS=all turns it back on
- the pedantic Rust style rules (undocumented items, string errors, println in libraries, ...) are no longer evaluated by default, so they cost no time and add no raw detections; MEERKAT_FINDINGS=all turns them back on
- faster full scans: the window checks found in a project (Electron, Playwright, click-through) no longer run in full and thorough and are listed as skipped, not failed; release, `--include windows` or MEERKAT_WINDOWS=1 run them. Eighteen quality, performance and hygiene rules that audits judged mostly false (empty-catch, line-length, regex-in-loop and others) are hidden by default and shown again with MEERKAT_FINDINGS=all
- fewer false alarms in the security and Electron/Rust rules (NeuralVault audits): window.open is fine when the app denies all windows; constant or escaped executeJavaScript/loadURL arguments, allowlisted IPC channels and non-handler `return true` are not reported; Rust secret-log, env::set_var, Vec::set_len and unwrap rules ignore test code, message words and File::set_len; Docker USER is judged on the final stage; changelog prose, comments, timestamp URLs, Electron shells and boolean-guarded merges are not reported
- a new opt-in detectors pack and `--preset detectors` run mature tools when installed and keep their own rule ids: osv-scanner (advisories with the fixed version), Semgrep security-audit, cargo clippy correctness and suspicious lints, and tsc --strict (capped at 200 with a rollup); a missing tool is NOT RUN with an install hint (issue 72); also gitleaks, staticcheck, govulncheck and actionlint checks; Semgrep runs with metrics off, MEERKAT_DETECTORS_OFFLINE=1 and MEERKAT_SEMGREP_CONFIG limit network use; see docs/credits.md
- a ground-truth benchmark on real code: `node tools/benchmark.mjs nodegoat` scans OWASP NodeGoat (pinned commit, expected vulnerabilities stored in benchmarks/nodegoat.json) and prints recall, the missed vulnerabilities and the findings that match none; first numbers in docs/accuracy.md
- detection gaps closed: `cp-js` reports `require` of a template literal with an interpolation or of a string joined to a variable, `cp-dotnet-php-ruby` reports `System.Random` for a camelCase `resetToken`, `toml-valid` reports an array left open at the end of the file, `csv-consistent` reads semicolon-separated files, `spell-common-typos` reads plain `.txt` prose, `notebook-secrets` knows npm tokens and `notebook-absolute-paths` sees doubled backslashes; Makefiles under `build/` and a changelog without dates stay unflagged on purpose
- CI and infrastructure gaps closed: SSH open to ::/0 (IPv6) in Terraform, quoted `permissions: "write-all"`, a pull_request_target checkout of refs/pull/N/merge, GitLab files named `*.gitlab-ci.yml` (docker-in-docker with TLS off), CircleCI executor images on the latest tag, and a Jenkinsfile sh step piping curl into a shell
- the code-pattern checks of the security-plus pack (cookie flags, JWT, SQL, CORS, XML, weak crypto, regex, redirects, paths) skip lines that are only string literals and punctuation, such as a detector table of sample vulnerable code; the credentials-in-URL check does not, because there the string is the problem
- PII in a Rust test module is not reported; meta-seo leaves mockups, prototypes and generated code maps alone
- documentation and markup hygiene findings (links, final newline, code fence language, headings, whitespace, HTML structure, SEO tags) and two Rust style rules are low, not medium
- fewer false alarms: "no .dockerignore beside the Dockerfile" now also accepts the .dockerignore of the real build context (a compose `context:` such as `../..`, or a Dockerfile that says it is built from the workspace/project root)
- js-timing-unsafe-compare no longer flags a confirm field next to a password (password !== confirm) or a bare "signature" kept as UI state (seenSignature !== signature); real secret, token, HMAC and webhook compares are still reported (found on NeuralVault)
- AI prompt: a new section lists every check with its time, status, findings and sub-check counts, slowest first
- fewer false alarms: a Tauri path check only fires on a command's own parameter outside tests, contextIsolation left out is fine (Electron 12+ default), user:password@host is not an email, and generated notice files and git@ links are not broken links
- a first scan lists far less: size and complexity measures (line length, long functions, complexity, nesting, parameters) roll up to one finding per rule and file, and pedantic Rust style and markup nitpicks are counted in the run (hidden) instead of listed. MEERKAT_FINDINGS=all lists everything again; security rules are never hidden
- the everyday presets (quick, fast, full, thorough, release) no longer run the code-shape measures (the refactor group: line length, function size, complexity, nesting, duplicated and dead code); run `--preset refactor` for them
- round 5a false alarms (NeuralVault audit): js-await-in-loop skips polling, retry, sleep, early-exit and dependent while loops; js-unhandled-promise accepts a .catch nested in the then callback (and long callbacks); json-parse-in-loop leaves test files out and names a real line; empty-catch ignores catch {} written inside comments and accepts a same-line or preceding best-effort comment; debug-leftovers treats probe folders and programs that call process.exit as CLIs
- round 5b false alarms (audit of a real scan): pii-in-logs reads only interpolated values (template and Rust raw-string text is skipped, a UI "card" is not a payment card, a name passed into a sanitise/redact call is not a leak, Rust test modules are skipped); ui-static, table-headers and render-blocking skip test files and mockup/prototype folders; duplicate-test-names compares titles per describe scope; broken-imports ignores imports named in comments or quoted in strings
- false alarms from the NeuralVault audit (round 5c): the security pattern rules (cors-wildcard, cookie-flags, sql-concat, jwt-weak, regex-dos, xxe-and-deserialize, open-redirect-pattern, path-traversal-pattern, weak-crypto-modes) no longer report insecure sample text held as Rust string literals in files named insecure_code*, vulnerable_samples* or bad_examples* (code outside a string there still reports); sql-destructive-migrations ignores DROPs inside block comments and undo_/down migrations that raise unless a confirm setting is present; ep-fuses-not-configured, ep-builder-product-name-missing and ep-builder-copyright-missing only apply to a package.json that names electron, electron-builder or Electron Forge, not a VS Code extension or Tauri package
- a guide to how a run is scheduled and tuned: docs/scheduling.md
- gentle by default, review fixes: CI=false or CI=0 is not a CI runner, the priority name is not case sensitive, an unknown --priority value is an error, and the time-left estimates use the same default parallelism as the run
- gentle by default: Meerkat lowers its own priority to below normal (checks inherit it), runs about half as many checks at once as there are cores (2 to 8; all but one on CI), and accepts --priority normal|idle and MEERKAT_PARALLEL. Meerkat's own tests do the same and put every temp project under one folder, meerkat-tests-<your user name>, in the temp folder (private to you), so one antivirus exclusion covers them
- scheduling: while the longest waiting check is held for room, short checks that fit now run beside the running one (backfilling) instead of all waiting behind it. On the first full NeuralVault run 97 percent of the 26 minutes had exactly one check running while 300 or more checks waited
- review fixes: the plain-http exemption looks at the URL itself (its host, or being the direct argument of a prefix helper), not the whole line; probe folders are test code only under scripts, tools, supabase, qa or e2e; serde_json unwrap and spawn_blocking findings keep their medium severity
- risky-code ignores comments, strings in Rust and Python files, Rust unit-test modules, test and fixture files, XML namespace names and URL-prefix trims; an MD5 with no secret or signature nearby is an info note and does not fail the check (NeuralVault: 39 high findings down to 0)
- the JavaScript await-in-loop, var, == and unhandled-promise checks, the PII check and the size and complexity checks leave test and probe files alone; the SQL-concat check leaves probe scripts alone
- Rust documentation and error-style rules (undocumented pub items, String errors, discarded results, spawn handles) are low, not medium
- meerkat doctor and the NeuralVault click-shards script start again: lib/paths.mjs now exports importFromApp (0.3.13 and 0.3.14 died with "does not provide an export named importFromApp")

## 0.3.14 (2026-11-01)

- fewer false alarms: a hit the surrounding code already makes safe is skipped (a QA-only executeJavaScript, a path checked by need() before it reaches the shell, a require helper called only with fixed strings, markup from a constant table)
- meerkat tools install works on Windows (it found the bare npm script instead of npm.cmd)
- the CI job is allowed 30 minutes
- installing the outside tools no longer changes a clean project's result: markdownlint uses lenient style rules when the project has no markdownlint config, and eslint, prettier and stylelint are NOT RUN when the project has not configured them (thorough/config-guard.mjs)
- a tool that cannot reach its service (cargo audit's advisory database, the npm registry) is NOT RUN instead of a failed check (thorough/offline-guard.mjs)
- the results screen names every check that did not run (skipped, covered by a wider check, turned off) instead of leaving its description empty
- ep-ipc-handler-no-sender-check no longer flags handlers whose sender is checked through a helper in the same file, or registered through an ipcMain parameter that every caller fills with a wrapper that checks the sender (found scanning Plume)
- secret checks leave test code alone: Rust unit tests after #[cfg(test)], *_tests.rs, probe folders, values that say they are fake (FAKE_TOKEN, SUPERSECRET, the AWS documentation keys), and a private key header in a comment with no key under it. On NeuralVault this removed all 25 critical findings, every one of them a test fixture
- the rule-table checks (Electron, Rust, secrets and the rest) leave test files, tests.rs and probe-* scripts alone
- Rust unit tests are found by matching the braces of the #[cfg(test)] module, so code after it is scanned again
- the secret scan looks eight lines below a key header (armor headers, blank lines, comment prefixes) before calling it a mention, so an encrypted or commented-out key is still reported
- innerHTML set from a local helper's parameter is not reported when every call of the helper passes a literal or an ALL_CAPS constant (found on Plume's find bar)
- Rust test code is found by the exact #[cfg(test)] module in the Rust rule tables too, and env::set_var in tests is no longer reported
- test_support and probe-* scripts are left alone by the Electron context-isolation and secrets-plus checks
- markdownlint no longer reads node_modules, .claude (agent worktrees), vendor, dist, build or target folders at any depth (on Plume this removed 498 findings from dependency documents)
- a first scan does not fail on Meerkat's own default limits: line-length, long-functions, deep-nesting, many-parameters, cyclomatic-complexity, file-length, duplicate-code, dead-code, commented-out-code, ts-any-overuse and http-timeouts pass as advisory notes (findings become info) until the project has a .meerkat-budgets.json
- a guide for adding a click-through test for your own app: docs/click-through.md
- markdownlint skips the folders named fixtures, where documents are broken on purpose


## 0.3.13 (2026-11-01)

- The package is on npm: npm install -g @samuelndce/meerkat
- releases publish to npm through trusted publishing (no stored token)

## 0.3.12 (2026-11-01)

- Findings Meerkat itself calls notes (low, info, low confidence, probably a false alarm) are no longer counted as bugs
- presence-style rules are rated low or medium instead of high
- innerHTML through a sanitiser is trusted
- the same fact is reported once
- the longest check starts first and small checks run beside it instead of waiting
- the badge says made with Perpetual Technologies

## 0.3.11 (2026-11-01)

- Hot fix: the key hints at the bottom of the results screen now always fit and keep quit and help
- finding places keep their line numbers
- the prompt file is named with the run's date and preset
- the package is ready to install with npm

## 0.3.1 (2026-11-01)

- README pictures: the running GIF is bigger with no empty block below it
- the results GIF scrolls slower, one row at a time
- GIF frames are trimmed of empty space

## 0.3.0 (2026-11-01)

- every update shows the yellow update line, including a fix published without a new version number
- AI prompt: press p on the results screen (or run meerkat prompt) for a file that hands every finding in full to an AI
- optional AI verification of findings (meerkat verify --ai-verify), fail-closed
- findings, logs and the prompt keep full text (no 200 character cut); every run saves run.log
- the live board shows the full scanned folder; settings files moved into .meerkat/
- Longest checks start first and timeouts have more leeway
- the live board never flickers and shows every group with its time in ALL CHECKS
- fewer checks end NOT RUN (meerkat tools, built-in fallbacks)
- projects are checked before a run
- fake-app end-to-end tests
- estimate shown against actual time
- CI green on Windows, macOS and Linux
- false positives fixed on real projects

## 0.2.0 (2026-11-01)

- Stuck-test guard: idle kill, skip keys, run deadline
- found project tests run as checks
- quick runs every short check
- findings files with severity
- happy results screen and scrollable timeline
- version and update line on every screen
- fewer false positives on real projects
- Meerkat now runs clean on itself

