# How Meerkat schedules a run

A run is a list of checks. Meerkat starts them in an order and at a pace chosen to finish as early as it can without making your PC slow. This page says how, and what you can change.

## The short version

1. The longest checks start first, because a long check that starts last runs alone while every other slot sits idle.
2. A few quick checks go first of all (at most 3, 10 seconds or less each), so a quick failure shows up at once.
3. Checks that are short and cheap run **beside** a heavy one instead of waiting behind it (backfilling).
4. A heavy check is never starved: nothing may start that would delay it.
5. Meerkat itself runs at below-normal priority, so your own programs keep getting the processor first.

## Lanes: what can never overlap

| Lane | Rule |
|---|---|
| `free` | many at once, up to the parallel limit |
| `cargo` | one Rust build or test at a time, across all Meerkat runs (a machine-wide lock) |
| `electron` | one window-opening check at a time (a machine-wide lock) |
| `windows` | several window checks at once, up to the number of windows the machine can hold |

A check can also say it must wait for others to pass (`after`), for example a build before the tests that use it. That order is always kept.

## The budget: how much runs at once

Every check costs the machine some processor threads and some memory. A check can state its own cost (`cost: { cpu, memGB }`); otherwise it gets the cost of its weight class (`tiny` 1 thread, `light` 2, `medium` 4, `heavy` 8) or of its lane. A run has a budget of that many threads at once:

- threads: the number of cores, at most 10 (`budget.cpu` in `meerkat.config.json`)
- memory: what is free right now, minus 3 GB kept for you (`budget.reserveGB`)
- at most `budget.maxParallel` checks together (10)
- a check marked `alone` gets the whole machine

On top of that, how many checks of the `free` lane run at once is half the cores, at least 2 and at most 8 (all but one core on a CI runner). Change it with `MEERKAT_PARALLEL=<n>`.

## The order

`orderForSpeed` ranks checks like this:

1. a check others wait on ranks by its own time plus the longest chain after it, so a build starts before the tests that need it;
2. every other check ranks by its own time, longest first;
3. up to 3 quick checks (10 seconds or less, nothing waits on them) go first.

The times used are the **learned** ones: after a run, Meerkat keeps what each passing check really took on this machine (`MEERKAT_TIMINGS`), and the next run uses the middle value of the last few passes instead of the guess written in the check. A check that has never run falls back to its written `estSeconds`.

## Backfilling

When the longest waiting check cannot start yet (the running checks hold the room it needs), Meerkat reserves its place. Without backfilling nothing behind it could start, so one heavy check ran alone for many minutes while hundreds of one-second checks waited; on a first full run of a large project that was 97 percent of 26 minutes with exactly one check running.

Now a waiting check may start early if two things are true: it fits the free room right now, and it is expected to end before the **shadow time**, which is when enough running checks will have ended, in the order they are expected to end, for the reserved check to fit. A check that starts under that rule cannot delay the reserved one, so the heavy check is never starved. An overdue check counts as ending at once, so nothing backfills behind it. No single backfilled check may be expected to run for more than 2 minutes.

## What to change

| You want | Do this |
|---|---|
| Less load on a busy PC | `--priority idle` and `MEERKAT_PARALLEL=2` |
| The fastest run on a build server | `--priority normal` (this also uses all but one core) |
| More heavy checks together | raise `budget.cpu` and `budget.maxParallel` in `meerkat.config.json`; watch the run, because window checks slow down when the machine is crowded |
| A faster `full` run | nothing: `full` and `thorough` already leave out your project's own window checks (listed as skipped); `MEERKAT_WINDOWS=1` or `release` puts them back |
| Better order and time-left figures | nothing: they improve by themselves as runs are recorded |
| See how a run went | open `timeline.jsonl` and `summary.json` in the run folder (`~/.meerkat/logs/runs/<run>`); a run that kept one check running at a time while many waited is the signal that the budget or the weights need a look |

## What a good run looks like

Several checks running together for most of the time, the heaviest ones starting in the first seconds, and no long stretch where one check runs alone while others wait. Look at the "waited" figures in `summary.json`: a check that waited for most of the run was held back, and the reason is written next to it (`waiting for free processor or memory`, `held back so <check> can start as soon as the running checks finish`, or `after <check>`).
