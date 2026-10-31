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

Options for every run: `--ai` (include the AI checks), `--json` (print the result as JSON on stdout), `--plain` (no board), `--no-color`, `-q/--quiet` (only the result line), `--fail-fast`, `--keep-going`, `--group <kinds>`, `--include <name>`, `--only <ids>`, `--config <file>`, `--no-config`.

## Look at results

| Command | Does | Also |
|---|---|---|
| `meerkat run list` | past runs, newest first | `meerkat runs` |
| `meerkat run show [id]` | the report of a run (default: the newest) | `meerkat last` |
| `meerkat run log <check> [id]` | one check's log | `meerkat why <check>`, `meerkat log <check>` |
| `meerkat run open [id]` | print the run's folder | `meerkat logs` |

## Checks, presets, packs

| Command | Does |
|---|---|
| `meerkat check list [folder]` | every check that applies, with kind, tier, weight and time (`--json` for scripts) |
| `meerkat check show <id>` | what one check does, the tool it needs, how to install it, its limits and its time here |
| `meerkat preset list` | every preset, with where it comes from (bundled, personal, project) |
| `meerkat preset show <name>` | what a preset runs: its checks and the time it should take |
| `meerkat preset new` | create a preset (asks; `--name`, `--tier`, `--group`, `--pack`, `--personal`, `--project` make it scriptable) |
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
| `meerkat update [check\|apply\|auto\|notify\|off\|status]` | updating Meerkat; off by default |
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
