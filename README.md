# Meerkat

Meerkat is the validation tool made for NeuralVault: one command that checks an app before you push, before a promotion and before a build. It has a fast tier and a thorough tier, opens the real app, walks every page and control, and never passes quietly when something is missing.

## How long it takes

Every number below was measured on Samuel's PC, which is the reference machine. Each carries its date and source. Nothing here is an estimate. The per-check table is in [`docs/checks.md`](docs/checks.md).

| Sweep | Time | What is included | Measured |
|---|---|---|---|
| Start-up: `meerkat:doctor` | 2.8 s | Readiness check: Node, git, Rust tools, builds, machine size. Changes nothing. | 2026-10-30, timed once with Measure-Command from an older NeuralVault worktree copy |
| Start-up: `verify --list` | 0.07 s | Loads every check file and prints the list. No checks run. | 2026-10-30, same worktree, timed once |
| Start-up: first output of a real run | not measured | | |
| Fast sweep, sidecar already built | 221 s | All fast checks | 2026-10-27, handoff record (not re-verified here) |
| Fast sweep, sidecar not built | 273 to 297 s | All fast checks plus the sidecar build | 2026-10-27, handoff record |
| Fast sweep, cold (nothing built) | 771 s | All fast checks plus every build from scratch | 2026-10-27, handoff record |
| Fast sweep, first run on a cleaned checkout | 1070.5 s | Same checks, cold Rust caches; one NOT RUN, one FAIL (4 known advisories) | 2026-10-28, NeuralVault cutover report `fast.txt` |
| Thorough sweep, no mutation testing | about 18 minutes | Every thorough check except mutation testing | 2026-10-27, handoff record |
| Thorough sweep, warm builds, with one mutation slice | 1184.5 s | 20 checks, 18 passed, 2 failed (4 known advisories; 1 mutant missed) | 2026-10-28, cutover report `thorough.txt` |
| One mutation-testing slice | 14 to 38 minutes | About a dozen mutants of the shell guard | 2026-10-27, handoff record; 1090.2 s in the 2026-10-28 run above |
| Full click-through | about 570 s (568.4 s on 2026-10-28) | About 1,660 controls (1,665 on 2026-10-28) in four looks | 2026-10-27, handoff record; 2026-10-28 report |
| Thorough run of 2026-10-30 | per-check times not found | Outcomes only: run 1 had 19 passed, 1 failed; run 2 slice 64/80 all mutants caught | 2026-10-30, comments on NeuralVault PR 3171 |

What slows it down:

- **A cold Rust build.** The sidecar build and clippy dominate: 378 s and 189 s in the 2026-10-28 cold run, about 1 s each when warm.
- **Compiling the parser tests the first time** (293 s cold, under 1 s warm, 2026-10-28).
- **Fewer free cores or less free memory.** The number of test windows at once is sized from both; `--profile low` trades time for fewer windows.
- **Mutation testing**, the single longest check.
- **Waiting on the cargo lock or the one-window lock** when something else on the PC is building or has a test window open.

Ideas for making it faster, with the evidence, are in [`docs/speed.md`](docs/speed.md).

Keep the PC otherwise idle while it runs. A run on a busy PC was stopped on 2026-10-30 because it ran out of CPU and RAM (reported by the coordinating session; the source run log was not read for this page).

## Tools it uses

Meerkat drives other tools and reports on them; it does not replace them. A tool that is missing is NOT RUN, which fails the run.

| Job | Tool | Checks that use it |
|---|---|---|
| Type check | TypeScript (`tsc`) | type-check |
| Unit tests | Vitest | unit-tests, unit-tests-changed |
| Rust format, lint, tests | rustfmt, clippy, `cargo test` (property tests) | sidecar-fmt, sidecar-clippy, vault-parser-proptest |
| Dependency advisories | `npm audit`, `cargo audit` | npm-audit, cargo-audit |
| Real windows | Electron, parked off-screen, with a test-safety layer | screens, accessibility, click-through, shell, app and UI integrity checks |
| Accessibility | an axe scan inside those windows | ui-axe |
| Fuzzing and mutation testing | parser fuzzing, `cargo-mutants` | parser-fuzz, guard-mutants |
| Opt-in extras | k6 (sync load), ZAP and Nuclei (staging scan), Snyk agent scan | sync-load, staging-scan, agent-scan |
| One heavy job at a time | a machine-wide cargo lock and a one-window lock | every cargo and window check |

Exact needs per check: [`docs/checks.md`](docs/checks.md). Set-up and the lock config: [`docs/setup.md`](docs/setup.md).

## Changes made to the tool (in NeuralVault)

The code stays in NeuralVault until it is extracted, so changes are made there and listed here.

| Date | Change | Where | State |
|---|---|---|---|
| 2026-10-30 | Checks that others wait on (the sidecar build) now start first, so the window checks overlap the Rust checks on a cold run. The parser-test time estimate was 3 s and is now 293 s. New opt-in `NV_MUTANTS_JOBS` (default 1, unchanged). | NeuralVault issue 3207, branch `meerkat-speed`, `lib/runner.mjs` | Written and committed locally, not pushed or merged. Modelled at about 1,091 s down to about 879 s on a cold fast run (a model from the 2026-10-28 durations, not a measurement). Measuring waits for the PC to be idle. |

## Terminal UI

Being set up, not built. The proposal (what it shows, how long each check takes on this PC, the library options, all marked UNVERIFIED until tried) is [`docs/terminal-ui.md`](docs/terminal-ui.md). Samuel decides when to build it.

## Status

**The tool's code now lives here** (moved from NeuralVault on 2026-10-30, at Samuel's instruction). The app being checked stays in its own repository; Meerkat finds it with `--app <folder>`, with `NV_APP_DIR`, or by being started in the app's folder (NeuralVault: `apps/desktop-electron`). Meerkat's own tests run here with `npm test` and need no app. The window lock lives with the app's own drivers (`scripts/electron-lock.mjs`), so Meerkat and the drivers queue on one lock. \*

> \*Corrected 2026-10-30: this section used to say the repository was a placeholder holding plans and documentation only, with the working tool in NeuralVault. That is no longer true. Until NeuralVault's pull request that swaps in a small launcher lands, NeuralVault still has its older copy of `scripts/verify`; do not edit it, change the tool here.

## Run it

Clone this repository next to the app's repository, then from the app's folder:

```
node ../../../meerkat/run.mjs
```

(adjust the path to where you cloned it), or from anywhere:

```
node path/to/meerkat/run.mjs --app path/to/NeuralVault/apps/desktop-electron
```

Add `--thorough` for the thorough tier, `--list` for the checks and their times, `--self-test` to prove every check still fails on a broken case, `--ui` for the terminal view, `--profile low` on a busy PC. `node doctor.mjs` (same folder rules) says what is missing on a new machine. Once NeuralVault's launcher lands, `npm --prefix apps/desktop-electron run verify` does all of it with one command.

## What it is and why

Before Meerkat, "is it safe to push?" meant running about ten commands in the right order and knowing which needed the Rust build first. Meerkat is one command that:

- **Looks at the real app.** It opens the real Electron window, parked off-screen, walks every page, Settings section and Business page, presses the controls and reads the screen. A passing unit test cannot see a heading covered by a banner. This can.
- **Never passes quietly.** A tool that is not installed, or a check that cannot start, is reported as NOT RUN and fails the run.
- **Never interrupts you.** Test windows cannot open File Explorer, pickers, dialogs or downloads, and cannot take focus. A check proves that.
- **Checks itself.** `--self-test` feeds each check a deliberately broken case and expects a failure.
- **Learns the times of the machine it runs on.** It keeps the measured time of each passing check, so order, progress and time left get closer to the truth.

## The two tiers

| Tier | When | Includes |
|---|---|---|
| Fast | Before every push of real work | Type check, rustfmt, clippy, dependency audits, rule scan, accessibility scan, screenshots of main pages, parser property tests, short click-through, unit tests for changed files |
| Thorough | Before a promotion between branches | Everything in fast (with every unit test and the full click-through instead), plus parser fuzzing, mutation testing of the shell guard, real-window app, shell, sidecar and UI integrity checks. Opt-in extras: sync load test, staging scan, Snyk agent scan |

Details of every check: [`docs/checks.md`](docs/checks.md).

## How to run it today (inside NeuralVault)

From the NeuralVault repo root:

```
npm --prefix apps/desktop-electron run verify
```

Thorough:

```
npm --prefix apps/desktop-electron run verify -- --thorough
```

Other useful forms: `-- --list` (checks and times), `-- --json result.json` (machine-readable), `-- --profile low` (busy or small PC), `-- --self-test`, and `run verify:promotion` (reports when a promotion is due; never promotes). A failed check keeps its full output in a file named on its result line. Set-up on a new machine: [`docs/setup.md`](docs/setup.md).

> \*Corrected 2026-10-30: the commands below describe the old layout, where the tool sat inside NeuralVault. See "Run it" above for how to run it from this repository.

## Current status of the tool

- Fast and thorough tiers: working in NeuralVault, last full runs 2026-10-28 and 2026-10-30.
- Terminal UI: being set up, not built; a proposal is in [`docs/terminal-ui.md`](docs/terminal-ui.md). A simple progress bar and a status file exist today.
- Run after a build finishes: not wired. The signed Beta chain still runs the older `verify:all`.
- Works with any app: not yet. Several checks are specific to NeuralVault.
- Licence: none chosen.

## Plan

1. Keep Meerkat working inside NeuralVault (PR 3122 and its follow-ups).
2. Generalise it so it no longer depends on NeuralVault's own sidecar and app windows (the checks that are specific to one app become plug-ins).
3. Move it here with its history, and have NeuralVault use it as a dependency.
4. Decide on a licence and whether to make the repository public. Not decided.
5. Add a UI: a way to see a run, its checks, their status and the saved output without reading terminal text. The form (local page, window, or a section inside the app) is not decided. A terminal UI is proposed first.
6. Make it work with any app and set up in one guided step (`meerkat:doctor` is the readiness check today).

The ordered version, with the decisions Samuel must make, is in [`docs/roadmap.md`](docs/roadmap.md).

> \*Corrected 2026-10-30: step 3 (move it here) is done; the NeuralVault side is a small launcher in a pull request there. Steps 2 and 4 to 6 are still open.

## When to run it

After a build finishes, not only before a push (Samuel, 2026-10-30). Today the NeuralVault signed Beta chain runs the older `verify:all` and not Meerkat, because Meerkat is on `dev` and not yet on `beta`.

## How this repo relates to NeuralVault

NeuralVault (private) is the source of truth for the code, the checks and their contract. This repo is where Meerkat will live once extracted. Until then, changes to the tool are made in NeuralVault and described here.

> \*Corrected 2026-10-30: this repository is now the source of truth for the tool. NeuralVault is the app it checks and keeps a launcher; changes to the tool are made here.

## Licence

None chosen yet. Until one is added, all rights are reserved and the repository stays private.

## More

- Per-check table: [`docs/checks.md`](docs/checks.md)
- Can it run faster (ranked ideas, none at the cost of coverage): [`docs/speed.md`](docs/speed.md)
- Terminal UI proposal: [`docs/terminal-ui.md`](docs/terminal-ui.md)
- Set-up on a new machine: [`docs/setup.md`](docs/setup.md)
- Roadmap and decisions: [`docs/roadmap.md`](docs/roadmap.md)
- In NeuralVault, on `dev`: `docs/testing/validation-tool-overview.md`, `validation-tool.md`, `validation-tool-setup.md`
- Rules for working in this repository: `PROJECT.md`
