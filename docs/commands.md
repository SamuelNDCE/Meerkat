# The meerkat command

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
| `meerkat verify [folder]` | the quick checks | alias of `meerkat quick`, `meerkat test` |
| `meerkat full [folder]` | every check | alias of `meerkat thorough` |
| `meerkat <preset> [folder]` | any preset: `security`, `ui`, `functionality`, `performance`, `refactor`, `ci`, `release`, and your own | `meerkat preset list` shows them |
| `meerkat check <id>... [folder]` | only these checks | same as `--only` |
| `meerkat repos [--scan <folder>]` | the git repositories Meerkat can find: name, path, branch (`--json` for scripts) | `--scan` looks in that folder too, once |
| `meerkat recent` / `recent clear` | the last 12 projects you used, newest first (`--json`); `clear` empties the list | stored as paths only in `~/.meerkat.json` |

Options for every run: `--ai` (include the AI checks), `--json` (print the result as JSON on stdout), `--plain` (no board), `--no-color`, `-q/--quiet` (only the result line), `--fail-fast`, `--keep-going`, `--group <kinds>`, `--include <name>`, `--only <ids>`, `--config <file>`, `--no-config`.

## Look at results

| Command | Does | Also |
|---|---|---|
| `meerkat run list` | past runs, newest first | `meerkat runs` |
| `meerkat run show [id]` | the report of a run (default: the newest) | `meerkat last` |
| `meerkat run log <check> [id]` | one check's log | `meerkat why <check>`, `meerkat log <check>` |
| `meerkat run open [id]` | print the run's folder | `meerkat logs` |
| `meerkat findings [folder\|run-id] [--severity high] [--suite s] [--check id] [--new] [--fixed] [--limit n]` | what the run detected: severity, rule, file:line, message, new or known (`--json` for scripts) | |
| `meerkat findings --fail-on <severity>` | exit 1 when any finding at or above that severity exists (for CI) | |
| `meerkat findings --export sarif\|md\|json [file]` | copy the run's `findings.sarif`, `findings.md` or `findings.json` to a file, or print it | |
| `meerkat finding <id> [run-id]` | one finding in full: what, evidence, who detected it (check, rule, pack, script, tool), the log, how to fix it, first seen | |

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

## Set up and look after

| Command | Does |
|---|---|
| `meerkat init [folder]` | write a starting `meerkat.config.json` |
| `meerkat doctor [folder]` | for this project: which checks would run, which would be NOT RUN and what to install; `--json` |
| `meerkat self-test [folder]` | prove every check fails on its broken case |
| `meerkat ai status` / `use <provider> [model]` / `test` | choose the model for the AI checks; `use claude haiku`, `use openrouter deepseek/deepseek-chat` |
| `meerkat update [check\|apply\|auto\|notify\|off\|status]` | updating Meerkat; looks up the latest version once a day (turn off with `meerkat update off`), never installs without you |
| `meerkat mcp install [claude]` / `serve` / `status` | register or run the tool server for AI agents |
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
| 3 | nothing to run (the preset selected no checks here) |
| 130 | interrupted |

## Output and machine use

- Results go to stdout; progress, notes and errors go to stderr. `--json` prints one JSON object on stdout and nothing else.
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

Keys: `c` copies the findings folder path (in a check detail: that check's log path), `l` shows the log, `y` copies the selected log path, `o` shows the report, `d` shows the repo changes, `r` runs again, `m` goes back to the menu, `q`, Esc or Ctrl+C is done, `?` lists the keys. `MEERKAT_OLD_MENU=1` brings back the old list.
