# Logs

Every run saves what is needed to understand a failure long after the terminal is gone. Nothing is written inside the project being checked.

## Where

`~/.meerkat/logs/` by default, or the folder in `MEERKAT_LOG_DIR`.

```
<log folder>/
  latest.json                      points at the newest run
  runs/
    20261031-142305-fast/          one folder per run: date, time, tier
      report.md
      summary.json
      timeline.jsonl
      <check>.log                  one per check
      <check>.selftest.log         one per check, in a --self-test run
```

## Reading it back

```
node run.mjs --last              the report of the newest run
node run.mjs --why <check>       one check's header and the end of its output
node run.mjs --logs              the folder and the newest run
```

## `<check>.log`

A header, then the complete output. The output is cut to its last megabyte if a tool prints more.

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
| `version`, `tier`, `preset`, `argv` | what was run, with which Meerkat |
| `summary`, `exitCode`, `counts` | the one-line result, the exit code, passes, failures and NOT RUNs |
| `startedAt`, `endedAt`, `ms` | when, and how long the whole run took |
| `machine`, `freeMemGBAtStart` | operating system, threads, memory, Node version; free memory when the run began |
| `git` | `commit`, `branch`, `changedFiles` (uncommitted files) |
| `scheduler` | `slots`, `maxParallel`, `reserveGB` |
| `selection` | `ran`, `skipped`, `covered`, `disabled` |
| `waited` | for each check that waited: `reason` and `waitedMs` |
| `configFile` | the config that applied, or null |
| `results` | one entry per check: `id`, `title`, `status`, `detail`, `ms`, `command`, `exitCode`, `startedAt`, `logFile`, `outputFile` (failures only), `files.total` (how many files the check examined; only when it reported it) |

## `timeline.jsonl`

One JSON object per line, in order: `{ "t": 1840, "event": "end", "id": "eslint", "status": "FAIL", "ms": 4210, "at": "..." }`. `t` is milliseconds from the start of the run. Events are `start` (with the lane) and `end`. An `end` event carries `files: { "total": 940 }` when the check reported how many files it examined, and no `files` field otherwise.

## File progress (`MEERKAT-FILE`)

A check script can tell the live board which file it is reading by printing, one per line, to stderr: `MEERKAT-FILE <relative path>` for the current file and `MEERKAT-FILES <done>/<total>` for the count. Meerkat reads these lines out of the output and removes them, so they never appear in a saved log or in `--json` output. The scripts in `thorough/` print them through `thorough/kit.mjs`, and only when Meerkat sets `MEERKAT_PROGRESS` (`1` when the live board is on, `count` otherwise, which sends only the count). A path with control characters or longer than 120 characters is ignored.

## Safety

Log text is data. When Meerkat prints it, control characters are removed so nothing in a log can move the cursor or rewrite earlier lines, and Meerkat opens a log path only if it is inside its own log folder.
