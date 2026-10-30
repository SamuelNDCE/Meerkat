# Terminal UI: a proposal

**This is a PROPOSAL for Samuel to approve. Nothing here is built.** Samuel asked on 2026-10-30 for "a terminal UI, would be good for the app", with how long each check takes on his PC. How it would also show up inside the NeuralVault app is an open question (see the end).

## What exists today

The code is in NeuralVault, `apps/desktop-electron/scripts/verify/lib/` (read on `origin/dev`, 2026-10-30):

- `progress.mjs` draws a small live block in a real terminal: a bar weighted by each check's expected time, time spent, "about N left" (shown after a tenth of the work), what is running now, and one line per finished check printed above the block. It is off when output is piped, when `CI` is set, with `--no-progress` or `NV_VERIFY_PLAIN=1`; `--progress` forces it.
- `status.mjs` rewrites a JSON status file every few seconds and on every start and finish (percent, elapsed, ETA, running checks with elapsed and expected time and an "overran" flag, waiting checks with the reason, finished checks). In plain output it prints a heartbeat line every 30 seconds.
- `timings.mjs` keeps the last 5 passing times per check per tier on the machine and uses their middle value for order, bar weights and ETA.

So the data a terminal UI needs already exists. The proposal is mostly a better view of it.

## What the screen shows

```
MEERKAT fast   [##########--------------]  47%   6/13 checks   elapsed 1:52   about 2:05 left
  12 cores, 31.4 GB   profile normal   branch dev   lock: cargo free, window held by us

  CHECK                   STATUS     NOW      TYPICAL   LAST RUN
  rule-scan               PASS       2.4s     1s        2.4s
  sidecar-clippy          RUNNING    1:05     1:30      3:08
  ui-axe                  WAITING    -        1:24      -        (needs build-sidecar)
  cargo-audit             FAIL       2.7s     3s        2.7s     (Enter: open output)

  Running now: sidecar-clippy   cargo lock held 1:05
  Output of selected check: <last 8 lines>
```

Regions:

1. **Header.** Overall progress bar, counts (passed, failed, not run), elapsed, about-time-left, the machine line and the profile in use.
2. **Check list.** One row per check: status (PASS, FAIL, NOT RUN, RUNNING, WAITING, COVERED, SKIPPED) as a word plus a colour, never colour alone; elapsed time; typical time on this PC (the middle of the saved samples, or "not measured"); the last run's time. A running check that passes 1.5 times its typical time is marked "slower than usual" (the status file already has this flag).
3. **Now running.** Which checks run, in which lane, and what each waits for (cargo lock, window lock, a build).
4. **Output pane.** The tail of the selected check's saved output; Enter opens the whole saved file (the path every non-passing check already prints).
5. **History view.** Past runs and per-check timings, so a check that has become slow is visible: last N runs as a list, and for one check a small sparkline of its saved samples. Today only 5 samples per check are kept and runs are not stored; a history view needs a small run log (see decisions).

## Keyboard controls

| Key | Does |
|---|---|
| Up / Down, j / k | Move the selection |
| Enter | Open the full saved output of the selected check |
| Tab | Switch between the live view and the history view |
| f | Filter: all, failed or not run only, running |
| l | Show or hide the output pane |
| Ctrl+C | Stop the run (cleanly: stop child processes, release the locks, restore the cursor) |
| q | Quit the viewer after the run ends |

The viewer never changes a result. It only reads events and the status file.

## Fallbacks

- **Not a TTY, or `CI` set, or `NV_VERIFY_PLAIN=1`:** plain lines exactly as today (`[start  ]`, `[PASS   ]`, the 30-second heartbeat). Nothing that reads the log changes.
- **Narrow terminal (under about 60 columns) or `NO_COLOR`:** drop the columns TYPICAL and LAST RUN, drop colour, keep the words.
- **Screen reader or dyslexia-friendly mode:** an option for plain one-line-per-change output with no redraws (redrawing text is hard to read for some people; Samuel is dyslexic, so this should be easy to turn on and the default should be calm, not flickering).
- **Viewer crashes:** the run must continue. The viewer is a separate reader of events and of the status file, not part of the runner.

## How it relates to the existing progress bar

Keep `progress.mjs` as the default compact display. The terminal UI would be a second, richer renderer behind a flag (for example `--ui`) fed by the same events the bar and the status file already receive (`start`, `settle`, `queue`, `note`, `stop`). The calculations (`computeProgress`, `etaMs`) stay shared so the numbers cannot disagree. Result: no change to results, exit codes or the plain log.

## Implementation options

None of the libraries below has been checked against its own documentation for this page. Every library claim is **UNVERIFIED** and must be checked (current version, licence, Windows terminal support, maintenance) before a choice.

| Option | Idea | Trade-offs |
|---|---|---|
| A. Extend the current hand-written ANSI renderer | No new dependency; add the list, selection and keys on top of `progress.mjs` | Smallest and keeps the zero-dependency, proprietary-safe tool. More code to maintain; keyboard input and resize handling by hand |
| B. A React-style terminal renderer such as Ink | Describe the screen as components | UNVERIFIED: maturity, size, Windows behaviour. Adds a dependency tree to a tool that has none; good fit if the tool later gets a web or app view with shared components |
| C. A full-screen widget toolkit such as blessed or terminal-kit | Ready-made lists and panes | UNVERIFIED: maintenance state and Windows support. Heavier and more opinionated |
| D. A separate viewer that reads the status file | `meerkat watch` in a second terminal, or a local page | The runner stays untouched and cannot be broken by the UI; also the natural bridge to a view inside the NeuralVault app. Needs the status file to carry more (history, output tails) |

A reasonable first step, for Samuel to confirm: option D's data contract (a richer status file and a small run log) plus option A's renderer, because both reuse what exists and add no dependency. This is a suggestion, not a verified recommendation.

## Open questions

- **Inside the NeuralVault app:** should the same view appear as a section of the app, for example a Settings or developer page reading the status file? Not decided. It raises the question of whether a developer tool belongs in a customer product at all, and whether it would be limited to a dev build.
- **Run history:** where it is stored (home folder is the current pattern for the timings file) and how long it is kept.
- **Triggering after a build:** whether the UI starts by itself when a build ends, or only on request (see `docs/roadmap.md`).
