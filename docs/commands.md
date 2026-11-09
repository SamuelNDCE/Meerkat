# The meerkat command

New here? Start with [how-to.md](how-to.md).

How the commands are laid out, and why. It follows the Command Line Interface Guidelines (clig.dev) and the habits of `gh`, `cargo` and `docker`: a small set of nouns, the same verbs on each, `--help` everywhere, and machine-readable output for scripts and AI agents.

## Shape

```
meerkat <preset> [folder]               run a preset: the most common thing, so it has no verb
meerkat <noun> <verb> [arguments]       manage something: checks, presets, packs, roots, runs, ai, update
meerkat <command> --help                help for any command (also: meerkat help <command>)
```

`[folder]` is a pasted path or the name of a project. Leave it off for the current folder.

## Run

| Command | Does | Also |
|---|---|---|
| `meerkat verify [folder]` | the quick checks (since the gate-output release, without the documentation and style-only checks: markdown, spelling, README and changelog form, whitespace, line length, `var`, `!important`, `@ts-ignore` notes; `full` still runs them) | alias of `meerkat quick`, `meerkat test` |
| `meerkat full [folder]` | every check | alias of `meerkat thorough`. Any run command (`verify`, `full`, `run <preset>`) takes `--ratchet` (fail only on findings not in the baseline) and the flags `--config`, `--no-config`, `--group`, `--fail-fast`, `--keep-going`, `--max-run-minutes` and `--timeout-scale`; `meerkat run --help` lists them |
| `meerkat <preset> [folder]` | any preset: `bugs`, `security`, `ui`, `functionality`, `performance`, `refactor`, `ci`, `release`, and your own | `meerkat preset list` shows them |
| `meerkat check <id>... [folder]` | only these checks | same as `--only` |
| `meerkat gate [--staged or --base <ref> or --against <ref>] [--all] [--no-cache] [--verbose]` | only the checks that cover the files you changed, and only failures in those files block (for a pre-commit hook or a pull request). It adds every pack that applies to the folder, not only the packs in `meerkat.config.json`. The output is the failures plus one summary line; `--verbose` lists every check. A project's own code (`extraChecks`, `.meerkat/checks`) runs only after a one-time yes in a terminal; without a terminal (or with `--no-input`, or in CI) it is left out and Meerkat says so. `--all` also blocks on project-wide failures; `--no-cache` runs every check again | exit 75 when it could not start |
| `meerkat smoke [--timeout <seconds>]` | prove that the checks selected for your changes start, finish and are not broken (it tests Meerkat, not your project) | the preset that asks whether a change breaks your project is `project-smoke` |
| `meerkat verdict [folder] [--base <ref>] [--known <file>] [--json] [--first] [--ready] [--branches <a> <b>...]` | one line for a branch: `PASS` or `FAIL n blocking in changed files`. Findings the branch did not add print `PASS` and a second line `pre-existing: N (not in this diff, does not block)`. `--first` prints only the first blocking `file:line: message` (or `PASS`); `--ready` prints one `READY` or `NOT READY` line and makes no claim about tests; `--branches` prints one verdict line per branch, each checked out in its own temporary worktree. `--known` takes a JSON list of accepted failures (`[{ "check", "file", "line"? }]`); a match prints as `KNOWN` and does not block, an entry that matches nothing prints as `STALE`. Progress goes to stderr; the limit is `MEERKAT_VERDICT_TIMEOUT_S` | exit 0 PASS (also with pre-existing findings only), 1 a new blocking finding or `NO-RESULT`, 2 a bad ref, option or `--known` file, 75 for `INCOMPLETE n of m checks finished, not a pass` |
| `meerkat fix [<finding-id>] [--dry-run] [--apply]` | a patch for a finding of the newest run when its check has a safe fix (today: `sql-concat` with a known driver). `--dry-run` (the default) prints the unified diff only; `--apply` writes it only if the line still matches the finding's saved source line (sha256). Otherwise `no automatic fix: <reason>`; nothing is guessed | exit 0 a patch shown or applied, 2 no safe fix, unknown id or a changed file refused |
| `meerkat handoff [folder] [--base <ref>] [--out <file>]` / `--read <file>` | writes `meerkat-handoff.md` (under 60 lines) into the project's newest run folder: verdict, open findings in changed files (first five), branch, commit and the exact next command. `--read` prints its header and the next command. Uses the same gate as `meerkat verdict` | exit 0 written or read, 1 the gate stopped early, 2 a bad ref, option or file |
| `meerkat commands [folder] [--json]` | the repo's own test, build and typecheck commands: the `commands` block of `meerkat.config.json`, or the `package.json` scripts when there is no block. Runs nothing | |
| `meerkat trust [folder]` | trust the `commands` block of this repo's `meerkat.config.json` so `meerkat test` and `meerkat build` may run it | |
| `meerkat build [folder]` | run the repo's own build command (`commands.build`), after `meerkat trust` | exit 1 and NOT RUN without trust |
| `meerkat test-run <name-or-file> [--timeout <seconds>] [--folder <path>]` | run ONE test file or test name with a time limit, through the repo's own test runner | |
| `meerkat lock status [--json]` | who holds the machine-wide cargo lock and who waits for it | |
| `meerkat redtest [--kind mutation\|faults\|adversarial\|regression\|cleantwin\|all]` | Meerkat's own red tests: deliberate attacks on its checks, to prove they still catch defects (needs the development install) | exit 2 for an unknown kind |
| `meerkat repos [--scan <folder>]` | the git repositories Meerkat can find: name, path, branch (`--json` for scripts) | `--scan` looks in that folder too, once |
| `meerkat recent` / `recent clear` | the last 12 projects you used, newest first (`--json`); `clear` empties the list | stored as paths only in `~/.meerkat.json` |

Options for every run: `--max-run-minutes <n>` (stop the whole run after n minutes, default 90), `--ai` (include the AI checks), `--json` (print the result as JSON on stdout), `--plain` (no board), `--no-color`, `-q/--quiet` (only the result line), `--fail-fast`, `--keep-going`, `--group <kinds>`, `--include <name>` (`mutation` and `runtime` add the opt-in deeper checks), `--timeout-scale <n>` (1 to 10), `--only <ids>`, `--config <file>`, `--no-config`.

### Only projects are checked

Meerkat runs its checks on projects, not on any folder. A folder is a project when it is inside a git repository, or holds a project marker (`package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `go.mod`, `pom.xml`, `build.gradle`, a `.csproj` or `.sln`, `composer.json`, `Gemfile`, `pubspec.yaml`, `Package.swift`, `Dockerfile`, a `.tf` file), or has an `index.html` next to other web files, or holds at least 5 source files (in the folder or one level down). Otherwise `meerkat verify <folder>` (and every other command that runs checks, from the menu too) stops before running anything, prints

```
C:\x is not a project: no git repository, no package.json, Cargo.toml, ... found, and fewer than 5 source files; pass --force to run anyway
```

and exits with code 2. `--force` runs anyway. With `--json` (stdout) a script or an AI agent gets the same text as one JSON object: `{"ok": false, "error": "not-a-project", "folder": "...", "message": "...", "exitCode": 2}`. Listing and reading commands (`--list`, `--estimate`, `--last`, `--why`, `--logs`, `--init`) need no project. In the folder browser, folders that are not projects are marked `(not a project)`. The project picker only offers git repositories.

## Look at results

| Command | Does | Also |
|---|---|---|
| `meerkat run list` | past runs, newest first | `meerkat runs` |
| `meerkat run show [id]` | the report of a run (default: the newest) | `meerkat last` |
| `meerkat run log <check> [id]` | one check's log | `meerkat why <check>`, `meerkat log <check>` |
| `meerkat run open [id]` | print the run's folder | `meerkat logs` |
| `meerkat findings [folder\|run-id] [--severity high] [--suite s] [--check id] [--new] [--fixed] [--limit n]` | what the run detected: severity, rule, file:line, message, new or known (`--json` for scripts) | |
| `meerkat findings --fail-on <severity> [--new]` | exit 1 when any finding at or above that severity exists (for CI); with `--new` only findings not in the previous comparable run count | |
| `meerkat findings --export sarif\|markdown\|json [file]` | copy the run's `findings.sarif`, `findings.md` or `findings.json` to a file, or print it; with `--json` print the path of the file in the run folder | |
| `meerkat prompt [folder\|run-id] [--last] [--no-copy] [--print]` | write `meerkat-prompt-<date>-<time>-<preset>.md` into the run folder (every finding in full, plus what to do) and copy a short line to the clipboard that tells an AI to read it. The results screen does the same with `p` | `meerkat prompt --help` |
| `meerkat verify --ai-verify [--ai-verify-max N] [--yes]` | after the run, ask your configured model to double-check each medium, high and critical finding (off by default; asks first unless `--yes`; see `meerkat ai use`) | `v` on the results screen |
| `meerkat finding <id> [run-id]` | one finding in full: what, evidence, who detected it (check, rule, pack, script, tool), the log, how to fix it, first seen | |
| `meerkat dismiss <id> --reason "..."` / `undismiss <id>` | accept a finding as not a problem, or take it back | kept in your home folder; exit 2 when no finding id is given |
| `meerkat dismissals [folder] [--stats]` | list the dismissed findings of this project, or count them per rule | |
| `meerkat top [folder] [--base <ref>] [--limit <n>] [--line]` | one table (file, check, line, message) of the worst findings in the files this branch changed, ranked by severity; `--limit` defaults to 10; `--line` prints only the first row, or `PASS` | exit 0; with `--line`, 1 when there is a finding |
| `meerkat baseline [--clear]` | accept the newest run's findings as they are; `meerkat run --ratchet` then fails only on new ones | |
| `meerkat trend` | one line per recent run: findings by severity, new and fixed | |
| `meerkat suggest` | suggested commands for the newest run's findings (never run for you) | |
| `meerkat pr-comment [--run-url <url>]` | markdown for a pull request comment | pipe it to `gh pr comment` |
| `meerkat map [--check] [--quiet]` / `meerkat blast <file>[#symbol]` | a map of the codebase (`--check`: exit 1 if it is stale), and the blast radius of a file or symbol | map --check: exit 1 when stale; blast: exit 75 when the file is not in the map |
| `meerkat who-calls <symbol>` / `meerkat deps <file>` / `meerkat tests-for <file>` [--app <folder>] [--json] | every call site (file:line) of a function, the project files a file imports, and the test files that import a file or name it | |
| `meerkat memory [folder] [--dry-run] [--json]` | hand the newest run to the memory adapter named by `"memory": { "adapter": ... }` in `meerkat.config.json`; nothing happens without that key | exit 2 when no adapter is set |
| `meerkat brief <file>[#symbol]` | a pre-edit brief: callers, tests, last-run findings, churn, risk tier and checklist | exit 2 on an unknown symbol, 75 when the file is not in the map |

## Checks, presets, packs

| Command | Does |
|---|---|
| `meerkat suite list [folder]` | the suites (the general checks you pick): checks and sub-checks here against everything Meerkat ships, time, purpose (`--json` for scripts) |
| `meerkat suite show <name> [folder]` | one suite: its purpose, its checks (and whether each applies here) and its sub-checks |
| `meerkat check <suite>` / `<suite>/<check>` / `<suite>/<check>/<sub>` | run a whole suite, one check, or one check and report only one sub-check (see docs/suites.md) |
| `meerkat check list [folder]` | every check that applies, nested under its suite (`--flat` for one line each), with kind, tier, weight and time (`--json` for scripts; rows have `suite` and `subChecks`) |
| `meerkat check show <id>` | what one check does, the tool it needs, how to install it, its limits and its time here |
| `meerkat check new [--id <id> --title <t> --cmd "npm run test:e2e" --suite <s> --group <kind> --tier fast\|thorough --personal\|--project]` | add a check of your own, no code: asks in a terminal, or takes the flags (needs `--yes` with no terminal; `--dry-run` shows what it would write). Writes `customChecks` in `meerkat.config.json` (this project) or `~/.meerkat.json` (`--personal`, every project), keeping other keys and line endings |
| `meerkat check edit <id>` / `meerkat check remove <id> [--yes]` | change or remove a check of yours (bundled ones are refused) |
| `meerkat check mine` | your own checks, where each lives and whether its program is installed (`--json`) |
| `meerkat check try <id>` | run just that one check |
| `meerkat discover [folder]` | the project's own tests (scripts, Makefile targets, Playwright/Cypress) that `full`, `thorough` and `release` would also run, and why (`--json`); runs nothing; see [discover.md](discover.md) |
| `meerkat tests [folder] [--json]` | the catalog of every kind of test and family of check: what it proves, what triggers it, its cost, what it needs | |
| `meerkat recommend [folder]` | tests this project could run that no check covers (`--json`); `--add <id\|all>` adds them as checks of yours (`--personal`, `--dry-run`, `--yes`); never runs or writes without `--add` |
| `meerkat preset list` | every preset, with where it comes from (bundled, personal, project) |
| `meerkat preset show <name>` | what a preset is for (its purpose) and every check it runs here, grouped by kind, with the time of each and the total on this PC; `--json` has `about`, `purpose`, `source` and `checks` |
| `meerkat preset new` | create a preset (asks; `--name`, `--tier`, `--group`, `--pack`, `--about`, `--purpose`, `--personal`, `--project` make it scriptable) |
| `meerkat preset edit <name>` | change the `--about` (one line, up to 200 characters) or `--purpose` (up to 600) of a preset you own; asks when no flag is given; `--dry-run` shows the change; bundled presets are refused |
| `meerkat preset delete <name>` | remove one of yours |
| `meerkat pack list [folder]` | packs, whether each is on for this project, and whether its tools are installed |
| `meerkat pack enable <name> [folder]` / `disable` | switch a pack on or off for a project (edits `meerkat.config.json`) |
| `meerkat pack add <folder>` / `remove` | add or remove a folder of your own packs |
| `meerkat root list` / `add <folder>` / `remove <folder>` | where project names are looked up |
| `meerkat rules test <file.json>` | test a file of data rules: every bad sample is caught and every good one passes. Exit 1 when a rule is wrong; exit 2 when the action or the file is missing |

## Set up and look after

| Command | Does |
|---|---|
| `meerkat init [folder]` | write a starting `meerkat.config.json` |
| `meerkat init --profile <name> [folder] [--write] [--force]` | print the config for a workflow profile (`solo`, `team`, `ai-agent`, `legacy`, `monorepo`, `ci-only`) and the commands of that workflow; writes `meerkat.config.json` only with `--write`, never over an existing one without `--force` |
| `meerkat doctor [folder]` | for this project: which checks would run, which would be NOT RUN and what to install; `--json` |
| `meerkat tools [folder]` | every optional outside tool, whether it is found, and one install command per ecosystem (npm, pip, cargo, system); `--json` |
| `meerkat tools install [folder]` | put the missing npm-based tools in `~/.meerkat/tools` (never in the project, never global, `--ignore-scripts`); shows the list first and asks, or use `--yes`; `--dry-run` only shows the list |
| `meerkat self-test [folder]` | prove every check fails on its broken case |
| `meerkat hook install [--gate]` / `hook remove` / `hook status` [folder] | install or remove a git pre-push hook that runs the quick preset with `--ratchet` (with `--gate`: `meerkat gate` on only the commits being pushed), or show whether it is installed |
| `meerkat ai status` / `use <provider> [model]` / `test` | choose the model for the AI checks; `use claude haiku`, `use openrouter deepseek/deepseek-chat` |
| `meerkat update [check\|apply\|auto\|notify\|off\|status]` | updating Meerkat; looks up the latest version once a day (turn off with `meerkat update off`), never installs without you |
| `meerkat mcp install [claude]` / `serve` / `status` | register or run the tool server for AI agents; `node bin/meerkat-mcp.mjs --list-tools` prints the server version, its tool count and every tool name |
| `meerkat completion <powershell\|bash\|zsh>` | print a shell completion script |
| `meerkat describe` | print every command, option and output field as JSON, for AI agents |
| `meerkat bug` | a bug report to paste into an issue (secrets removed, nothing sent) |
| `meerkat version`, `meerkat help [command]` | |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | everything passed |
| 1 | a check failed or could not run |
| 2 | a usage or configuration error (the message says what to change) |
| 3 | meerkat run and the presets: nothing to run (the preset selected no checks here). Not a pass |
| 75 | meerkat gate and meerkat smoke: the run could not start (no base found, not a git repo, no checks loaded); meerkat blast and meerkat brief: the target file is not in the code map; meerkat verdict: `INCOMPLETE`, the run stopped early. Not a pass |
| 130 | interrupted |

## Output and machine use

- Results go to stdout; progress, notes and errors go to stderr. `--json` prints one JSON object on stdout and nothing else.
- The global options (`--help`, `--no-input`, `--no-color`, `--json`, `--quiet`, `--yes`, `--dry-run`) are accepted by every command; a test (`tests/global-flags.test.ts`) runs every command in `meerkat describe` with `--help` and `--no-input`. A usage error (a missing id or file, an unknown option) is always exit 2.
- Without a terminal (a pipe, CI, an AI agent) there is no board, no colour and no prompt. Every prompt has an option that does the same thing, so nothing ever waits for typing: `--yes`, `--no-input`.
- `NO_COLOR`, `MEERKAT_PLAIN=1` and `--no-color` turn colour and the board off.
- Commands that change things (`preset delete`, `pack disable`, `update apply`) ask first in a terminal and accept `--yes` when scripted; `--dry-run` shows what they would do.
- Names are lowercase and short. Aliases are explicit and listed here; there are no abbreviations of commands.

## Shell completion

Tab completion for commands, presets, nouns and verbs, and check ids (asked lazily with `meerkat check list --json`).

- PowerShell: add `meerkat completion powershell | Out-String | Invoke-Expression` to your `$PROFILE`.
- bash: add `source <(meerkat completion bash)` to `~/.bashrc`.
- zsh: add `source <(meerkat completion zsh)` to `~/.zshrc`.

## Notes on how the words are read

- `meerkat check <id>... [folder]`: the last word is the folder when it is a path (`./x`, `.`, a drive path), or a project name when two or more words are given. A single word is always a check id.
- `--json` on a run prints the run summary.json plus `runDir` on stdout (progress goes to stderr). If the run cannot start (exit 2 or 3) stdout stays empty and the reason is on stderr.
- `meerkat run open` prints the run folder; `meerkat logs` prints the log root and the newest run.
- `meerkat mcp install` runs `claude mcp add --scope user meerkat -- node <path to bin/meerkat-mcp.mjs>` for you, after checking `claude mcp list`. `--dry-run` prints the command.
- `pack disable` and `preset delete` ask in a terminal. With no terminal, or with `--no-input`, they need `--yes`. `--dry-run` always works.
- `meerkat check` on its own is no longer the quick run (it used to be an alias of `verify`). Use `verify`, `quick` or `test`.

## Config order

Flags, then environment variables, then the project's `meerkat.config.json`, then your `~/.meerkat.json`, then the defaults.

## The project picker

`meerkat` on its own, in a terminal, first asks which folder to check, then shows the preset menu with `Project: <path>` at the top. "Change project" in that menu returns to the picker. On a preset, `d` opens its details (the purpose and every check it runs here, with times); Up/Down scroll, any other key goes back. `u` updates and `q` quits. `d` works only in this menu: in the project picker and the folder browser, letters filter the list.

The picker lists "Here" (the folder you are in, or its repository), "Recent", and "Repos found", then "Browse folders...", "Type or paste a path..." (a path or a project name, resolved like `meerkat verify <name>`) and, on Windows, "Choose another drive". Up/Down and Enter move and choose; typing narrows the lists, Backspace removes a letter, Esc clears the filter (and quits when there is none). In the preset menu that follows, Esc goes back to this picker to choose another project (`q` quits); the header shows `Project: <path>   Esc to change`.

Repositories are found in the folder you are in, your recent projects, your roots (`meerkat root add <folder>`), and these places when they exist: `~/Documents`, `~/code`, `~/src`, `~/projects`, `~/dev`, `~/repos`, `~/Desktop` and the folders next to Meerkat. The search goes three levels deep, skips `node_modules`, `target`, `dist`, `build`, `AppData`, Windows system folders and hidden folders, never follows links, and stops after 400 repositories or 2 seconds. It reads only `.git/HEAD` of each repository, to show the branch.

The picker is skipped when a folder is given (`meerkat verify D:/code/app`, `meerkat menu D:/code/app`) and whenever there is no terminal, so scripts and AI agents see no change.

## The menu screens and the update bar

The project picker, the browse screen and the preset menu share one layout: the pixel-art meerkat beside the title block (MEERKAT, the version, the chosen project), the list in sections with a short grey description on each line, the highlighted row, and a one-line key hint at the bottom. The preset menu's sections are Run (quick, full, security, functionality, ui, performance, refactor, ci, release, each with an estimated time for this project on the right, such as `about 5 min`, `under 1 min` or `~40 s`), Your presets (when you have any) and More (More presets..., choose checks one by one, create a preset, last report, read a log, change project, check for updates, quit). "More presets..." opens a list of every other preset: the -fast variants, app, app-fast and your own. The estimate uses the times learned on this PC (the same numbers as `meerkat preset show`), is worked out in the background within 2 seconds, and shows `...` or `est. n/a` until it is ready. `d` shows the details of the highlighted preset. The list scrolls under the header and never makes the screen taller than the terminal.

The meerkat is drawn only in a terminal with colour that is at least 70 columns wide and 24 rows tall. In a narrower or shorter terminal, with `NO_COLOR`, `MEERKAT_PLAIN=1` or `MEERKAT_MASCOT=0`, or without a terminal, the title is plain text with no art.

Meerkat looks up the latest version once a day (turn off with `meerkat update off`); it never installs without you. The lookup is read-only, limited to 3 seconds, and its answer is kept in `~/.meerkat.json` (`updateCache`). When that answer is newer than the version you run, the first line of the menu screens, and of the screen after a run, is a yellow bar: "Update available: Meerkat 1.4.0 (you have 1.3.2). Press u to update, or choose Check for updates below". While the daily look-up runs, a small spinner line at the top of the menu says `Checking for updates...`; it turns into `Up to date (v1.2.3)` (green) or `Could not check (offline)` for a second, or into the yellow bar when a newer version exists. The look-up never holds up a key and stops after 3 seconds. In the preset menu, `u` (or the Check for updates row) starts the update, which shows what changed and asks before installing. With `meerkat update off` nothing is looked up on its own, and the bar appears only if a manual `meerkat update --check` found a newer version. `meerkat update status` shows the setting, the newest version known and when it was checked.

## The results screen (after a run in a terminal)

When a run started from `meerkat` finishes in a terminal, the live board leaves one short summary in the scrollback (the counts, the findings and the line `Findings folder created: <run folder>`) and a full-screen results view opens. The long FAIL, NOT RUN and SUITE lines are not printed there: they are in `report.md` and the logs, and a run with no terminal (a pipe, CI, `--plain`, `--json`) prints exactly the lines it always did.

Three tabs, shown as `<  Findings (95) | Checks (154) | Timeline  >` with the active one highlighted, switched with Tab, Left/Right or 1 2 3 (the first time the screen opens it also says `Press Tab or the arrow keys to see Checks and Timeline` until the first key). A small pixel meerkat head sits top left when the terminal has colour and at least 70 columns by 24 rows; otherwise the title is plain text:

- **1 Findings**: grouped worst first. Critical red, high orange, medium yellow, low and info white (the word is always shown too). Enter opens the full detail, Esc comes back, `f` cycles the severity filter (all, critical, high, medium, low, info, new).
- **2 Checks**: every check that ran or was skipped, with status, suite, time, a bar scaled to the slowest check and the reason when it did not pass. `s` cycles the status filter (all, problems, not run, passed). Enter opens the check (command, reason, findings, log path).
- **3 Timeline**: a gantt of every check on one time axis, with how many ran at once on top. Enter opens the check.

Keys: `c` copies the findings folder path (in a check detail: that check's log path), `l` shows the log, `y` copies the selected log path, `o` shows the report, `d` shows the repo changes, `r` runs again, `m` goes back to the menu, `q`, Esc or Ctrl+C is done, `?` lists the keys.
