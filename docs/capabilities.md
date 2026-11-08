# What Meerkat can do

Meerkat is a checker for a code project. You use it two ways: as a command line tool (`meerkat ...`) and as an MCP tool server that an AI agent calls (`meerkat_...`). This page lists what it does, grouped by the job you want done. For every flag see [commands.md](commands.md). For the AI side see [for-ai-agents.md](for-ai-agents.md). For the NeuralVault setup see [neuralvault.md](neuralvault.md). Questions: [faq.md](faq.md).

Every command and tool name below was run, or read in the code, on this build. Anything not run is marked "not run in this build".

## Scan for bugs and security

Use these to find problems in the whole project.

- `meerkat verify`: the quick checks. Aliases: `meerkat quick`, `meerkat test` (when no `commands.test` is set, see below).
- `meerkat full`: every check, the slow ones too.
- `meerkat bugs`, `meerkat security`, `meerkat ui`, `meerkat performance`, `meerkat refactor`, `meerkat ci`, `meerkat release`: one kind of check per preset. `meerkat preset list` shows them all. Not run in this build: only the `quick` preset was run (see the end of this page).
- `meerkat check list`, `meerkat check show <id>`: what a check does and whether it applies here.
- MCP: `meerkat_run` runs a preset (changes state: it writes a run folder), `meerkat_list` lists the checks that would run, `meerkat_presets` lists the presets.

## Check changes before commit

- `meerkat gate --staged`: only the checks that cover the files you staged. Only failures in those files block.
- `meerkat gate`: the same, for the files you changed. It prints one line naming the folder, the branch and whether it is a worktree, then the failures and a summary line.
- `meerkat smoke`: proves the selected checks start and stop (it tests Meerkat, not your project). Not run in this build.
- MCP: `meerkat_gate` (full gate), `meerkat_summary` (the gate answer in a few lines), `meerkat_smoke`. All three write a run record.

## Check a branch before merge

- `meerkat verdict --base origin/main`: one line. `PASS`, `FAIL n blocking in changed files`, or `FAIL-PRE-EXISTING only: n findings in code this branch did not change`. Exit 0 only for PASS. When it cannot judge it prints `NO-RESULT: <reason>. next: <step>` (exit 1 or 2). `--known <file>` accepts listed pre-existing failures (lines `KNOWN:` and `STALE:`), and `--json` prints one object.
- `meerkat top --base origin/main --limit 5`: a table of the worst findings in the files the branch changed (file, check, line, message).
- `meerkat gate --base origin/main --json`: the full answer for a pull request. `--all-findings` also shows findings that were already on the base.
- `meerkat pr-comment`: markdown for a pull request comment from the newest run. Not run in this build.
- MCP: `meerkat_summary` with `base`, `meerkat_pr_comment`. There is no MCP tool for `verdict` or `top` in this build; call the CLI.

## Map code and brief before an edit

- `meerkat map`: writes `codemap.json` and `codemap.md` for the project. Only changed files are read again. `meerkat map --check` exits 1 when the map is stale.
- `meerkat blast <file>`: what imports a file or symbol, which modules it touches, which tests reach it. Read only. Exit 75 when the file is not in the map.
- `meerkat brief <file>`: callers, tests, last-run findings, churn, a risk tier (LOW, MEDIUM, HIGH) and a checklist. Read only. It prints the folder line first.
- MCP: `meerkat_map` (writes the map files), `meerkat_blast` (read only), `meerkat_brief` (read only).

## Run the repo's own tests and build

- `meerkat commands`: lists the repo's test, build and typecheck commands. With no config it lists the `package.json` scripts and runs nothing.
- `meerkat trust`: trusts the `commands` block of `meerkat.config.json`. It asks once in a terminal.
- `meerkat build`, `meerkat test`: run `commands.build` and `commands.test` after trust. Without trust they print that the command was NOT run and exit 1.
- `meerkat discover`: the project's own tests that `full` would also run. Runs nothing.
- `meerkat recommend`: tests the project could run that no check covers. Writes nothing unless you add one.
- MCP: `meerkat_discover`, `meerkat_recommend` (both read only). No MCP tool runs `build` or `test`.

## Dismiss and track findings

- `meerkat findings`: every finding of the newest run: id, severity, rule, place, status (new or known). `--new`, `--severity`, `--fail-on` narrow it.
- `meerkat finding <id>`: one finding in full.
- `meerkat dismiss <id> --reason "..."`, `meerkat undismiss <id>`, `meerkat dismissals`: accept a finding as not a problem, take it back, list them. The record is kept in your home folder.
- `meerkat baseline`: accept all current findings so a ratchet run fails only on new ones. `meerkat baseline --clear` undoes it. Not run in this build.
- `meerkat trend`, `meerkat suggest`: findings over recent runs, and suggested commands (never run for you). Not run in this build.
- `meerkat prompt`: writes a markdown file for an AI with every finding in full. Not run in this build.
- MCP: `meerkat_findings`, `meerkat_finding`, `meerkat_dismissals`, `meerkat_trend`, `meerkat_suggest` (read only); `meerkat_dismiss`, `meerkat_undismiss`, `meerkat_baseline` (change state); `meerkat_prompt` (writes one file).

## Set up and look after Meerkat

- `meerkat doctor`: which checks would run and what is missing. `meerkat tools`: the optional outside tools.
- `meerkat hook install`, `hook remove`, `hook status`: a git pre-push hook that runs the quick preset with `--ratchet`. Only `hook status` was run.
- `meerkat self-test`, `meerkat redtest`: prove the checks still catch broken code. Not run in this build.
- `meerkat run list`, `meerkat run show`, `meerkat run log <check>`: look at past runs.
- `meerkat mcp install`, `meerkat mcp serve`, `meerkat mcp status`: register, run, and check the MCP server.
- `meerkat describe`: every command, option and exit code as JSON.

## The MCP tools

The server reports 34 tools (`node bin/meerkat-mcp.mjs --list-tools` prints the count and the names). "Changes state" means the tool writes something: a run folder, a map, a file, a dismissal or a hook. The first six carry no read-only hint in the code, so their line below comes from reading what they do.

| Tool | Reads only or changes state |
|---|---|
| `meerkat_run` | changes state: writes a run folder |
| `meerkat_list` | reads only |
| `meerkat_presets` | reads only |
| `meerkat_last` | reads only |
| `meerkat_why` | reads only |
| `meerkat_self_test` | changes state: runs the checks against broken samples |
| `meerkat_gate` | changes state: writes a gate run record |
| `meerkat_summary` | changes state: writes a gate run record |
| `meerkat_smoke` | changes state: writes a run record |
| `meerkat_blast` | reads only |
| `meerkat_map` | changes state: writes `codemap.json` and `codemap.md` |
| `meerkat_tests` | reads only |
| `meerkat_findings` | reads only |
| `meerkat_finding` | reads only |
| `meerkat_redtest` | changes state: runs Meerkat's own attacks |
| `meerkat_dismiss` | changes state: destructive hint set |
| `meerkat_baseline` | changes state: destructive hint set |
| `meerkat_doctor` | reads only |
| `meerkat_discover` | reads only |
| `meerkat_recommend` | reads only |
| `meerkat_tools` | reads only |
| `meerkat_trend` | reads only |
| `meerkat_suggest` | reads only |
| `meerkat_pr_comment` | reads only |
| `meerkat_dismissals` | reads only |
| `meerkat_hook_status` | reads only |
| `meerkat_describe` | reads only |
| `meerkat_undismiss` | changes state: destructive hint set |
| `meerkat_hook` | changes state: installs or removes the pre-push hook |
| `meerkat_brief` | reads only |
| `meerkat_version` | reads only |
| `meerkat_check_list` | reads only |
| `meerkat_prompt` | changes state: writes one markdown file in the run folder |
| `meerkat_run_list` | reads only |

The server also offers MCP resources (the newest findings, report and code map, and the check catalog) and prompts. Not run in this build: reading a resource or a prompt.
