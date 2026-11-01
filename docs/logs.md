# Logs

Every run saves what is needed to understand a failure long after the terminal is gone. Nothing is written inside the project being checked.

## Where

`~/.meerkat/logs/` by default, or the folder in `MEERKAT_LOG_DIR`.

```
<log folder>/
  latest.json                      points at the newest run
  runs/
    20261031-142305-plume-fast/     one folder per run: date, time, project, tier
      report.md
      summary.json
      timeline.jsonl
      run.log                        the true log of the run, one timestamped line per fact
      meerkat-prompt-<date>-<time>-<preset>.md                   written by `meerkat prompt` (or the `p` key): a prompt for an AI
      findings.json                  what the run detected (see findings.md in docs)
      findings.md
      findings.sarif
      detections.jsonl
      <check>.log                  one per check
      <check>.selftest.log         one per check, in a --self-test run
```

## Folder names

A run folder is named `<date>-<time>-<project>-<tier>`, for example `20261031-091438-plume-thorough`. The project is the app folder's own name, lowercase, letters, digits and dashes only, at most 30 characters (`project` if nothing is left). The date and time come first, so folders sort in time order. Folders from older runs have no project part (`20261031-091438-thorough`); they still work everywhere: `run list`, `last`, `why`, `findings`, history, the bug report and MCP.

You can name a project instead of a run: `meerkat last plume`, `meerkat findings plume` and `meerkat run show plume` read that project's newest run, and `meerkat run list --project plume` lists only its runs. `meerkat run list` has a PROJECT column.

## Reading it back

```
node run.mjs --last              the report of the newest run
node run.mjs --why <check>       one check's header and the end of its output
node run.mjs --logs              the folder and the newest run
```

## `<check>.log`

A header (its first line is `project:`, the project name and the full path of the app folder), then the complete output. The output is cut to its last megabyte if a tool prints more.

```
check:     eslint
title:     ESLint: the project's own lint rules
kind:      functionality   tier: fast   weight/lane: light/free
command:   eslint .
folder:    repo
result:    FAIL (2 problems)
exit code: 1
started:   2026-10-31T14:23:05.307Z   took: 4.2 s
--- output ---
...
```

## `run.log`

The true, chronological record of how the run went, written for every run next to `report.md`. One line per fact, each with the time and the seconds since the start:

- the start: preset, tier, project and folder, the Meerkat version, the machine (OS, threads, memory, Node), the command line, the config file and the git commit;
- the plan: the scheduler limits, the checks chosen in the order chosen, what was skipped, covered by a wider check or turned off, and the estimate for the whole run;
- each check: a `start` line (lane, its estimate, its time limit, its idle-kill limit) and a `finish` line (status, exit code, how long it took against the estimate and the limit, whether it was TIMED OUT, IDLE-KILLED or SKIPPED, its sub-checks, how many findings it produced, its log file); a check that never started gets a `never started` line with the reason;
- the findings line and the final summary (exit code, duration, the result line);
- later steps append to it, for example the result of `--ai-verify`.

`report.md` says what to do about a failure, `timeline.jsonl` is for programs, and `run.log` is the plain record.

## `report.md`

For a person. It starts with the result, the command that was run, the git commit and branch, the scheduler limits and how much memory was free. Then:

- **What was chosen**: what ran, what was skipped (no files changed in its paths), what a wider check covered, what the config turned off.
- **Failed**: for each failure, the reason, how long it took, the path of its full log, the last 30 lines of its output, and the command to run only that check again.
- **Could not run**: each NOT RUN and what is missing.
- **Slowest** and **Passed**.
- **Timeline**: a table of when each check started and ended (seconds from the start of the run), its result, and what it waited for (the Rust lock, a busy window lane, not enough free memory).

## `summary.json`

For a program or an AI to read. `schema` is 1.

| Field | Holds |
|---|---|
| `project` | `{ name, path }`: what the run was on (the name is the one in the folder name). `latest.json` carries it too |
| `version`, `tier`, `preset`, `argv` | what was run, with which Meerkat |
| `summary`, `exitCode`, `counts` | the one-line result, the exit code, passes, failures and NOT RUNs |
| `startedAt`, `endedAt`, `ms` | when, and how long the whole run took |
| `machine`, `freeMemGBAtStart` | operating system, threads, memory, Node version; free memory when the run began |
| `git` | `commit`, `branch`, `changedFiles` (uncommitted files) |
| `scheduler` | `slots`, `maxParallel`, `reserveGB` |
| `selection` | `ran`, `skipped`, `covered`, `disabled` |
| `waited` | for each check that waited: `reason` and `waitedMs` |
| `configFile` | the config that applied, or null |
| `files` | `{ findings, report, sarif, detections }`: the paths of the four detection files (`findings.json`, `findings.md`, `findings.sarif`, `detections.jsonl`) |
| `findings` | `{ total, bySeverity, new, known, fixed }` |
| `results` | one entry per check: `id`, `title`, `status`, `detail`, `ms`, `command`, `exitCode`, `startedAt`, `logFile`, `outputFile` (failures only), `files.total` (how many files the check examined; only when it reported it) |

## `timeline.jsonl`

One JSON object per line, in order: `{ "t": 1840, "event": "end", "id": "eslint", "status": "FAIL", "ms": 4210, "at": "..." }`. `t` is milliseconds from the start of the run. Events are `start` (with the lane) and `end`. An `end` event carries `files: { "total": 940 }` when the check reported how many files it examined, and no `files` field otherwise.

## The detection files

Every run also writes `findings.json` (every finding: what, where, which rule, which check, script or tool found it, evidence, fix hint, new or known, first seen), `findings.md` (the same for a person), `findings.sarif` (SARIF 2.1.0 for GitHub code scanning) and `detections.jsonl` (one line per detection event in time order, including every failed sub-check and every NOT RUN with its reason). A cross-run history in `~/.meerkat/findings/` makes new, known and fixed survive the pruning of old runs. A check can print `MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>` lines, which are taken out of the output like the lines below. Schema, protocol and a GitHub upload example: [findings.md](findings.md).

## Sub-checks (`MEERKAT-SUB`)

A check script can report one result per rule by printing, one per line, to stdout: `MEERKAT-SUB <PASS|FAIL|NA> <rule-id> <short reason>` (rule id `/^[a-z0-9][a-z0-9-]{0,60}$/`, reason up to 200 characters, control characters removed, anything else that starts with `MEERKAT-SUB` is dropped, at most 2000 per check). The runner takes the lines out of the output like the file-progress lines, so they never reach the shown last line; they are kept apart and written into the check's `<check>.log` after the output under `--- sub-checks ---`, one line per rule. The exit code still decides: exit 0 with a `FAIL` line fails the check (`sub-check <id> failed`). `summary.json` has `suite`, `subs`, `subTotal`, `subPass`, `subFail`, `subNa` on each result plus `subTotals` and `suites` for the run, `report.md` has a "Suites" table with every failed sub-check, and the `end` events of `timeline.jsonl` carry `subs: { total, pass, fail, na }`. A check with no sub lines counts as one sub-check. Full description for check authors: docs/suites.md.

## File progress (`MEERKAT-FILE`)

A check script can tell the live board which file it is reading by printing, one per line, to stderr: `MEERKAT-FILE <relative path>` for the current file and `MEERKAT-FILES <done>/<total>` for the count. Meerkat reads these lines out of the output and removes them, so they never appear in a saved log or in `--json` output. The scripts in `thorough/` print them through `thorough/kit.mjs`, and only when Meerkat sets `MEERKAT_PROGRESS` (`1` when the live board is on, `count` otherwise, which sends only the count). A path with control characters or longer than 120 characters is ignored.

## Safety

Log text is data. When Meerkat prints it, control characters are removed so nothing in a log can move the cursor or rewrite earlier lines, and Meerkat opens a log path only if it is inside its own log folder.

## Check log format

Every check's `<check>.log` starts with a header (project, check, title, kind, command, folder, result, exit code, `started` and `ended` times and how long it took, and a `findings:` line when it produced any), then a line `--- output ---`, then everything the check printed, then the sub-check block. A check that could not run (NOT RUN) gets a short log too: the same header, `exit code: n/a (the check never started)`, then the reason and what to do, so `meerkat why <check>` always has something to show.
