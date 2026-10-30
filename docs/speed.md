# Can Meerkat run faster?

Analysis and proposals only. No code was changed anywhere. Code was read on NeuralVault `origin/dev` on 2026-10-30, under `apps/desktop-electron/scripts/verify/`. Times are the measured ones in [`checks.md`](checks.md) (Run A = fast tier 2026-10-28, Run B = thorough tier 2026-10-28).

**Rule that must not be traded for speed:** Meerkat never passes quietly when something is missing. A NOT RUN is a failure, a check is never skipped to look green, and no baseline or allow-list is edited to get green. Ideas that would weaken this are marked WEAKENS and are not recommended.

## What the code already does (VERIFIED)

- **Only changed areas run in the fast tier.** `lib/runner.mjs` line 28: in `changed` mode a check whose `paths` match no changed file is skipped. The unit-test check uses `vitest --changed origin/dev`. If nothing differs from `origin/dev` (a promotion branch), every check of the tier runs instead (`run.mjs`), on purpose.
- **Overlap checks are not run twice.** `runner.mjs` lines 37 to 39: the short click-through is dropped when the full one runs, and the changed-files unit tests when every unit test runs, because running both starved each other.
- **Lanes.** `runner.mjs` lines 131 and 162: one cargo job at a time, one Electron job at a time, "free" checks in parallel up to CPU count minus one (`run.mjs`, the `parallel` option). So type check, audits, builds of the renderer and unit tests already run beside the Rust work.
- **One Rust build at a time machine-wide.** `lib/cargo-lock-run.mjs` lines 5 to 10: every cargo job takes the lock because several builds at once froze a machine once. `lib/lanes.mjs` line 71 uses it when no machine lock script is set.
- **Windows sized from the PC.** `click-shards.mjs` lines 33 to 41: half the cores, 1.5 GB free memory per window, never above the ceiling (6 by default). `lib/profiles.mjs`: `low`, `normal`, `high`.
- **Learned times.** `lib/timings.mjs` keeps the last 5 passing times per check and uses them for order and the progress bar.
- **Order.** `runner.mjs` lines 40 and 41: cheapest estimated check first.

## Where the time goes (derived from measured numbers)

- **Run A (fast, cold), 1070.5 s.** The cargo lane ran in sequence: parser tests 292.8 + clippy 188.5 + sidecar build 378.3 = 859.6 s. The window checks could only start after the sidecar build (`after` in the check files), and then ran one at a time: screenshots 13.3 + accessibility 83.4 + short click-through 111.9 = 208.6 s. 859.6 + 208.6 = 1068.2 s, within 2.3 s of the measured total. So cold, the run is one long chain, not a parallel one.
- **Warm fast sweep, 221 s (2026-10-27 handoff).** Close to the window chain alone (208.6 s in Run A), so warm, the windows are the limit.
- **Run B (thorough, warm builds), 1184.5 s.** The window chain was verify-shell 1.7 + verify-app 7.7 + screenshots 14.5 + accessibility 84.0 + UI integrity 316.4 + full click-through 568.4 = 992.7 s. The mutation slice took 1090.2 s and, because the total is 1184.5 s, must have started about 94 s in (derived, not logged). Mutation testing was the last thing running.

## Ranked ideas

Ranked by derived saving, then by risk. "Where" is whether the change belongs in NeuralVault now or in this future repo after extraction.

| Rank | Idea | Speeds up | Expected saving | Risk (could it hide a real failure?) | Effort | Where | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | **Start the sidecar build first on a cold run.** Today the cheapest check starts first, so parser tests and clippy take the cargo lane before the build the window checks wait for. Build first lets the 208.6 s window chain overlap the 481.3 s of parser tests plus clippy | Whole cold fast sweep | Up to about 208 s of 1070.5 s on a cold run (derived from Run A). Nothing on a warm run, where those cargo checks take seconds | Low. Same checks, same pass rules. Window checks then run while cargo compiles, so they compete for CPU and RAM (the starvation seen before). Needs a trial, not a guess | Small: an ordering rule (critical path first) | NeuralVault now | Ordering VERIFIED `runner.mjs` 40 to 41; the dependency VERIFIED by the `after` lists of `ui-screens`, `ui-axe`, `click-through` in `checks/`. The saving is derived; the contention cost is unmeasured |
| 2 | **Start mutation testing first in the thorough tier.** It is the longest check and the last to finish | Thorough sweep | About 80 s of 1184.5 s (the roughly 94 s it started late, minus extra contention), derived | Low. Same mutants, same slice. Needs a build already warm | Small: same ordering rule | NeuralVault now | Ordering VERIFIED `runner.mjs` 40 to 41. The 94 s start offset is derived, not logged | \*
| 3 | **Keep one shared, warm Rust build folder** (`CARGO_TARGET_DIR`, outside the repo) between runs | Sidecar build, clippy, parser tests | Measured gap: sidecar build 378.3 s cold vs 1.2 s warm; clippy 188.5 s vs 2.0 s; parser tests 292.8 s vs 0.7 s (Run A vs Run B). So up to about 860 s on a first run of a fresh folder | Medium. A stale shared folder has produced false results across worktrees (rule in the NeuralVault agent rules). It must be keyed to the checkout, or the checks must fail if artifacts are older than sources | Small to document; medium to make safe | Both | Gap measured. The doctor reads `CARGO_TARGET_DIR` (VERIFIED, `doctor.mjs`). Safety rule UNVERIFIED in code |
| 4 | **Let the accessibility scan overlap the short click-through** instead of waiting for the one-window lane | Fast sweep, warm | At most 83.4 s of 221 s (the scan's own time) | Medium. Two groups of windows at once is the pattern that exhausted CPU and RAM on 2026-10-30 (reported by the coordinating session; UNVERIFIED in code). Slower windows can cause false timeouts | Medium: a lane that allows N windows with a memory check | NeuralVault now | Lane rule VERIFIED `runner.mjs` 131 and 162. Saving is an upper bound; contention unmeasured |
| 5 | **Result cache keyed by commit** (plus a hash of the uncommitted diff and the tool version): an unchanged tree is not re-run | Any repeat run, for example after a build with no code change | Whole sweep on a repeat, for the cacheable checks. Unmeasured how often repeats happen | High if careless. WEAKENS the tool if it caches `npm-audit` or `cargo-audit` (their answer changes with the advisory database, not the code), or any check whose input includes the machine, the toolchain or the network. Only deterministic checks of the tree may be cached, and a cached pass must be shown as CACHED, never as a fresh PASS | Medium | Future repo (the cache belongs to the tool) | Absence VERIFIED: `run.mjs` and `runner.mjs` read here have no result cache; only times are stored (`timings.mjs`) |
| 6 | **Split the full click-through further / more windows at once** (`NV_CLICKS_SHARDS`, `NV_CLICKS_JOBS`, `--profile high` = 8) | Full click-through, 568.4 s | Unmeasured. The 2026-10-27 figures (12 windows, 4 at a time) and the formula are known, but no run at 8 windows was found | Low for coverage (same controls). Medium for stability: more windows is the thing that exhausted the PC | Small, it is a setting | Setting exists in NeuralVault | Settings and formula VERIFIED `click-shards.mjs` 33 to 41 and 154 to 155, `profiles.mjs`. Saving unmeasured |
| 7 | **Run the unit tests with fewer competing jobs.** In Run A the changed-files unit tests took 350.9 s while the samples are 239.9 and 124.1 s, so the cold cargo work was slowing them | Fast sweep, cold | Unmeasured (the gap to the samples is not a clean measure) | Low | Small | NeuralVault now | Times from `checks.md`. Cause UNVERIFIED |
| 8 | **Shorter fuzzing, a smaller mutation slice, fewer click-through looks, skipping a check "when nothing changed" in a thorough run** | Thorough sweep | Would save time, size unmeasured | **WEAKENS the tool.** Less coverage per run. Skipping on a promotion branch is the opposite of the rule in `run.mjs` ("nothing changed must never mean nothing to check"). Not recommended | n/a | n/a | `NV_FUZZ_SECONDS`, `NV_MUTANTS_SHARD` exist (docs) but are for chosen runs, not for making a default run faster |
| 9 | **Treat a missing tool as a skip instead of NOT RUN** | None really | Seconds | **WEAKENS the tool.** Directly breaks the rule. Never | n/a | n/a | Rule VERIFIED `runner.mjs` 89 and `summarise` (exit 1 on any NOT RUN) |

> \*Corrected 2026-10-30: rank 2 saves nothing. The cargo lane runs one check at a time, so its total is the sum of its checks whatever the order, and mutation testing is already the last check in that lane. The "about 94 s late" was the other cargo checks running first, which still have to run. Only making the cargo work itself shorter (for example `NV_MUTANTS_JOBS`, to be measured) can shorten the thorough tier. Rank 1 stands; the change is written in NeuralVault issue 3207.

## Already done, so not an idea

- Changed-area selection for the fast tier (above).
- Free checks running in parallel with the Rust build (above).
- Window count sized from the PC, and the `low` profile for a busy one.
- Short click-through in 6 windows instead of one: 495 s down to 111 s (2026-10-27, NeuralVault overview doc).
- Dropping overlapping checks (above).
- Learned times for order and progress.

## What to do first

1. Ranks 1 and 2 are one small ordering change with a derived saving and no loss of coverage; try them on this PC and compare the total against Run A and Run B. Nothing is promised until re-measured.
2. Rank 3 is mostly a habit and a guard: use one warm build folder, and make a stale one fail loudly.
3. Everything that reduces coverage (ranks 8 and 9) stays out.

## Not found or not verified

- The 2026-10-30 incident of 25 windows exhausting CPU and RAM: reported by the coordinating session, not read from a log here.
- Whether `cargo clippy` and `cargo build` of the sidecar can share compiled work: UNVERIFIED.
- How often a run repeats on an unchanged commit: unmeasured.

## Exact place to change in NeuralVault (`apps/desktop-electron/scripts/verify/`)

| Rank | File and function | Change |
|---|---|---|
| 1 and 2 | `lib/runner.mjs`, `selectChecks` (the `byCost` sort, lines 40 to 41) and the pick order in `runAll` (lines 143 to 189) | Order by longest remaining chain (a check that others wait on via `after`, or the longest lane work), not cheapest estimate. Keep the lane and `after` rules as they are |
| 3 | `doctor.mjs`, `requirements` (the `built-sidecar` row and `CARGO_TARGET_DIR`); `lib/lanes.mjs`, `wrapForLane` | Warn when the target folder is per-worktree; fail a window check if the sidecar is older than its sources |
| 4 | `lib/runner.mjs`, `runAll` (`laneBusy`, line 131, and `laneFree`, line 162) | Let the `electron` lane hold a count instead of a flag; gate it on free memory like `resolveWidth` |
| 5 | New module beside `lib/timings.mjs`; hook in `run.mjs` before `runAll` and after `recordRun` | Store results keyed by commit plus diff hash; never for `npm-audit` or `cargo-audit`; print CACHED |
| 6 | `click-shards.mjs`, `resolveWidth` (lines 33 to 41) and the `NV_CLICKS_*` reads (lines 154 to 155); `lib/profiles.mjs`, `PROFILES` | Settings only |
| 7 | `checks/core.mjs`, `unit-tests-changed` (`run` args) | Limit vitest workers when the cargo lane is busy; cause unverified |

Unfinished in this page: no re-measurement of any proposed change was done.
