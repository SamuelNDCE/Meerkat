# Findings: what a run detected, and what detected it

A check that fails says "this failed". A **finding** says what was found, where, which rule, which check (and which script or tool) found it, how sure Meerkat is, and whether it is new. Every run compiles all of them into one place.

## What a run saves

In the run folder (see [logs.md](logs.md)), next to `summary.json`:

| File | For | Holds |
|---|---|---|
| `findings.json` | a program or an AI (read this first) | every finding with all its facts, the counts, what was fixed since the last run, what could not run |
| `findings.md` | a person | a summary table by severity, then the findings grouped by suite, then what was fixed |
| `findings.sarif` | GitHub code scanning and other SARIF tools | the same findings as SARIF 2.1.0 |
| `detections.jsonl` | a program or an AI | one line per detection event in time order: every rule hit, every failed check, every failed sub-check, every NOT RUN with its reason |

`summary.json` names them in `files: { findings, report, sarif, detections }` and carries `findings: { total, bySeverity, new, known, fixed }`. The end of a run prints one line:

```
findings: 3 high, 5 medium (2 new)  details: <run folder>/findings.md
```

Nothing here is ever written inside the project. Writing these files never changes a run's result: if a file cannot be written, a note goes to stderr and the run carries on. No file holds a secret: text is cleaned, a value that looks like a secret is blanked, and the `secrets` suite never keeps a sample or the source line.

## Reading them

```
meerkat findings                          the newest run: severity, rule, file:line, message, new or known
meerkat findings --severity high --new    only high and critical, only what is new
meerkat findings --suite secrets          one suite (also --check <id>, --limit <n>)
meerkat findings --fixed                  what was fixed since the previous comparable run
meerkat findings --fail-on high           exit 1 when any finding at or above high exists (for CI)
meerkat findings --export sarif out.sarif copy findings.sarif (or md, json) of the run to a file; without a file it prints it
meerkat finding <id>                      one finding in full: what, evidence, who detected it, the log, the fix, first seen
```

`meerkat findings` takes a run id or a project folder as its first word (`meerkat findings 20261031-142305-fast`, `meerkat findings ../my-app` = the newest run of that project). `--json` prints `{ run, runFolder, counts, total, findings[] }`. In the menu: **Show findings** and **Copy findings path** after a run, and **Findings from the last run** on the home screen. Through MCP, `meerkat_last` returns the counts and the 20 most severe findings in `structuredContent.findings`.

## Nothing is shortened in the files

Short forms exist only on the terminal screens, where the width forces them. The files keep the full text. The caps are generous and fixed:

| What | Cap |
|---|---|
| a finding's `message` (findings.json, findings.md, findings.sarif, detections.jsonl, ai-prompt.md) | 8000 characters |
| the reason of a sub-check (`MEERKAT-SUB`) | 2000 characters |
| a NOT RUN reason | 8000 characters |
| a suggested fix | 2000 characters |
| the source line shown as evidence | 1000 characters |
| the raw output kept for a tool failure | 200 lines of up to 2000 characters |
| the output of a check kept in its `<check>.log` | the last 1,000,000 characters (Meerkat keeps up to 4,000,000 in memory while the check runs) |

A message that would be cut is cut at the cap, never earlier. A line in a saved file that redaction cannot clean (a single line over 4000 characters) is blanked rather than kept, because a secret could hide in it. A finding also carries `explanation` (why the rule matters, from the suite it belongs to) and, only when AI verification ran, `aiVerdict` and `aiReason`.

## `findings.json`

`schemaVersion` is 1. Fields are only ever added.

| Field | Holds |
|---|---|
| `meerkat.version` | the Meerkat version |
| `run` | `id` (the folder name), `dir`, `project: { name, path }` (folder name and full path), `preset`, `tier`, `startedAt`, `endedAt`, `ms`, `machine: { os, node }`, `comparedWith` (the earlier run used for new/known/fixed, or null) |
| `counts` | `total`, `bySeverity` (critical, high, medium, low, info), `bySuite`, `byCheck`, `new`, `known`, `fixed` |
| `findings[]` | see below, most severe first |
| `fixed[]` | findings of the previous comparable run that are gone now: `id`, and `severity`, `title`, `file`, `line`, `check`, `rule` when known, `fixedIn`, `previousRun` |
| `notRun[]` | `{ check, reason }`: checks that could not run. A check that did not run is not a finding, and nothing is known about it |

One entry of `findings[]`:

| Field | Holds |
|---|---|
| `id` | the fingerprint: 16 hex characters, see below |
| `severity` | `critical`, `high`, `medium`, `low` or `info` |
| `title`, `message` | the rule's title (else the message) and the message |
| `suite`, `check`, `rule` | the suite, the check id, the rule id (the sub-check id) or null |
| `file`, `line`, `column` | the project-relative path (null when the finding is about the whole check), the line (null without a file, 0 for a whole file), `column` is always null for now |
| `lines`, `occurrences` | the same finding on several lines is one finding: its first lines (at most 20) and how many places |
| `evidence` | the source line, at most 1000 characters. Left out for the `secrets` suite and for any line that redaction would change |
| `detectedBy` | `check`, `checkTitle`, `pack`, `origin` (`bundled`, `personal`, `project`), `script` (path relative to Meerkat, for a script check), `tool` (`{ name, version }` for a check that runs a tool such as eslint, version null when not known), `rule`, `command` (`{ cmd, args }`, Meerkat's own folder shown as `<meerkat>`) |
| `fix` | the check's `fix` (else its `install`) hint, or null |
| `confidence` | `high` when the check printed a `MEERKAT-FINDING` line, `medium` when Meerkat read it from the output |
| `rawOutput` | for a tool-backed check (and a check whose output could not be read): the first 200 lines of its output (each line up to 2000 characters), instead of a guess |
| `status` | `new` or `known` (see below) |
| `firstSeen` | ISO time of the earliest run, among the last 20, that had this id; now if none |
| `logFile` | the check's log in the run folder |

## The fingerprint (`id`)

`sha256` of `ruleId|check|path|normalised message`, first 16 hex characters. The message is lower-cased with line numbers removed (`:12`, `:12:5`, `line 12`), and no line number goes into the hash, so the id **survives a line shift**. It changes when the file, the rule, the check or the wording of the message changes. The same thing found on several lines of one file is one finding.

## New, known, fixed

Meerkat keeps `~/.meerkat/findings/<project>-<hash>.json` (under `MEERKAT_LOG_DIR/findings` when that is set): the ids of the last 20 runs of the project, written atomically and never larger than 2 MB (the oldest runs go first). That is why the comparison survives the pruning of old run folders. A run is compared with the previous run of the same project **and the same kind** (its preset, else its tier), so a `security` run is not compared with a `full` run.

- `new`: not in the previous comparable run (everything, on a first run).
- `known`: in the previous comparable run too.
- `fixed`: in the previous comparable run, not in this one. Listed in `fixed[]` and in `findings.md`, not in `findings[]`.

## Severity

A finding printed with `MEERKAT-FINDING` states its own. Otherwise: the check's optional `severity` field, else by kind (security high, functionality medium, ui medium, performance low, refactor low), and always critical for the `secrets` suite. The runner passes this default to scripts as `MEERKAT_DEFAULT_SEVERITY`.

## Which findings a check produces

1. **It prints them** (best): lines on stdout, see the protocol below. Confidence `high`.
2. **It does not, and it failed**: Meerkat reads `path:line message` and `path: message` lines from the saved output (the path must be a real file in the project, so a heading such as `my-check: found 3` is never taken for one). The rule id comes from a failing sub-check whose title the message starts with, else it is null. A check with no such lines gives one finding per failed sub-check, or one for the whole check. Confidence `medium`.
3. **It runs a tool** (eslint, tsc, cargo, npm, ...): one finding for the check with the tool's first 200 lines in `rawOutput`. Meerkat does not guess at a tool's output.

## Protocol for check authors: `MEERKAT-FINDING`

A check script prints to **stdout**, one per line, exactly:

```
MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>
```

| Part | Rule |
|---|---|
| `severity` | `critical`, `high`, `medium`, `low` or `info` |
| `rule-id` | `/^[a-z0-9][a-z0-9-]{0,60}$/`, or `-` when there is none (use the same id as the `MEERKAT-SUB` line of the rule) |
| `path` | relative to the project, no control characters, at most 300 characters, no `..`, not absolute. Backslashes become `/` |
| `line` | digits; `0` for the whole file |
| `message` | one line, at most 8000 characters (longer is cut, control characters are removed) |

Anything else that starts with `MEERKAT-FINDING` is dropped. Meerkat takes the lines out of the output (also when a chunk ends in the middle of one), like `MEERKAT-SUB` lines, so they never reach the shown last line or the saved log. At most 5000 are kept per check. The exit code still decides whether the check passes: findings alone do not fail a check (use that for `info` notes). A function check may return `findings: [{ severity, rule, file, line, message }]` instead.

In a script that uses `thorough/kit.mjs`:

```js
import { finding } from './kit.mjs'
finding('high', 'eval-call', 'src/app.js', 12, 'eval() runs text as code') // prints the line; returns it, or null when an argument is invalid
```

`scanRules` (`thorough/rules.mjs`) already prints one finding per hit next to its usual output. A rule may set `severity`; otherwise the default above is used.

Two optional check fields feed the file: `severity` (the default severity of its findings) and `fix` (a hint shown with each finding, at most 2000 characters). Both are validated when the check loads.

## `detections.jsonl`

One JSON object per line, in time order. `t` is milliseconds from the start of the run, `time` the same as an ISO date.

| Field | Holds |
|---|---|
| `event` | `finding`, `rule-hit` (one per rule and check, with `count`), `sub-check-failed`, `check-failed`, `check-not-run` |
| `check`, `rule`, `file`, `line`, `severity` | what the event is about (null when it does not apply) |
| `message` | the finding, the failed sub-check's reason, the failure reason, or why a check could not run |
| `durationMs`, `tool` | how long the check took, and the tool it ran (null for a script) |
| `findingId` | on `finding` events: the `id` in `findings.json` |

Events share the time the check ended, so a whole check's detections sit together; every failed sub-check and every NOT RUN reason is there, so the file explains everything Meerkat detected and why a check could not run.

## Uploading to GitHub code scanning

`findings.sarif` is SARIF 2.1.0: `runs[0].tool.driver` is `Meerkat` with its `rules[]`, each result has `ruleId`, `level` (critical and high are `error`, medium `warning`, low and info `note`), `message.text`, a `location` with the file and `startLine`, and `partialFingerprints.meerkatFindingHash` (the finding id, so GitHub tracks a finding through line shifts).

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 20 }
  - run: git clone https://github.com/SamuelNDCE/Meerkat.git "$RUNNER_TEMP/meerkat"
  - run: node "$RUNNER_TEMP/meerkat/run.mjs" --preset ci
    env: { MEERKAT_LOG_DIR: "${{ runner.temp }}/meerkat-logs" }
    continue-on-error: true
  - run: node "$RUNNER_TEMP/meerkat/bin/meerkat.mjs" findings --export sarif meerkat.sarif
    env: { MEERKAT_LOG_DIR: "${{ runner.temp }}/meerkat-logs" }
  - uses: github/codeql-action/upload-sarif@v3 # pin to a commit SHA in real use
    with: { sarif_file: meerkat.sarif }
  - run: node "$RUNNER_TEMP/meerkat/bin/meerkat.mjs" findings --fail-on high
    env: { MEERKAT_LOG_DIR: "${{ runner.temp }}/meerkat-logs" }
```

`meerkat findings --fail-on high` exits 1 when any finding at or above high exists, and 0 otherwise, so a job can fail on findings without failing on every check.
## Reading them on the results screen

After a run in a terminal the results screen shows the findings (see [commands.md](commands.md)). Keys: Tab or 1 2 3 switch sections, Up/Down move, Enter opens a finding in full, Esc closes it, `f` cycles the severity filter, `l` shows the log of the check that found it, `c` copies the findings folder path (`Findings folder created: <path>`), `?` lists every key. In a terminal `meerkat findings` colours the severity word the same way (critical red, high orange, medium yellow, low and info white).
