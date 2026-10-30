> **Moved 2026-10-30** from NeuralVault `docs/testing/` into this repository. Paths of the form `apps/desktop-electron/scripts/verify/...` in the text below now live at this repository's root (`run.mjs`, `lib/`, `checks/`, `thorough/`, `fixtures/`, `rules/`). The app is found with `--app`, `NV_APP_DIR` or the folder you start in. The text below is otherwise unchanged and may still describe the old layout.

# Meerkat, the validation tool: what it is and why to use it

Meerkat is one command that checks the app before you push, before a promotion and before a build. Two sizes: **fast** (under 5 minutes) and **thorough** (about 20 minutes). The contract for people who change the tool itself is [`validation-tool.md`](validation-tool.md). This page is for people who just use it.

## Run it

```bash
npm --prefix apps/desktop-electron run verify
```

That is the fast tier. In a terminal it shows a progress bar with the time spent, about how long is left, what is running now, and each check as it passes or fails. For the deep one, add `-- --thorough`:

```bash
npm --prefix apps/desktop-electron run verify -- --thorough
```

Is a promotion due? This only reports, it never promotes:

```bash
npm --prefix apps/desktop-electron run verify:promotion
```

## Why use it

- **It is one command, not a list to remember.** Before, "is it safe?" meant running about ten separate commands in the right order and knowing which ones needed the Rust build first.
- **It looks at the real app.** It opens the real Electron window, walks every page, Settings section and Business page, presses the controls, and reads the screen. A passing unit test cannot see a heading covered by a banner. This can.
- **It never passes quietly when something is missing.** A tool that is not installed, or a check that cannot start, is reported as NOT RUN and fails the run. Nothing is skipped to look green.
- **It never interrupts you.** Test windows are parked off-screen and cannot open File Explorer, file pickers, save dialogs, downloads or take focus. (The stray Explorer window people kept seeing was a native file picker; it is blocked now and the tool proves it.)
- **It checks itself.** `node scripts/verify/run.mjs --self-test` feeds each check a deliberately broken case and expects a failure. A check that cannot fail is not a check.
- **It finds things reviews miss.** On its first real runs (2026-10-27) it found: a File Explorer popup in our own test runs, four shell-guard rules that no test pins down (#3129), a race in the tool itself, and the 4 dependency advisories (#3115). It also showed the Chat page covering its own heading at the smallest window size (#3123).

## What it checks

| Check | Fast | Thorough | What it catches |
|---|---|---|---|
| Type check, rustfmt, clippy | yes | yes | Code that does not compile or is not clean |
| Unit tests | only files you changed | every test | Broken logic |
| Short click-through, 6 windows at once | yes | replaced by the full one | A page that crashes, a control that does nothing |
| Full click-through, every control, 4 looks (normal, light, black, smallest window with reduced motion) | no | yes | Look-specific bugs, hidden controls, overlap |
| Accessibility scan (axe) | yes | yes | New serious accessibility problems |
| Screenshots of the main pages | yes | yes | Blank pages, clipping, errors |
| npm audit, cargo audit, rule scan | yes | yes | Known vulnerable dependencies, our own past mistakes |
| Vault parser property tests | yes | yes | A note that crashes the parser |
| Parser fuzzing | no | yes | Inputs nobody thought of |
| Mutation testing of the shell guard | no | one slice per run | Guard rules that no test pins down |
| Real-window app, UI integrity, sidecar, shell | no | yes | Whole-app regressions |

## How long it takes

Measured 2026-10-27 on the dev machine (12 cores, 31 GB). These rot, so re-measure with `--json file`.

| Run | Time |
|---|---|
| Old single-window click-through alone | 495 s |
| Short click-through now (6 windows) | 111 s |
| Whole fast tier, sidecar already built | about 220 s |
| Whole fast tier, sidecar rebuilt | about 300 s |
| Full click-through, 12 windows, 4 at a time | about 590 s |
| Whole thorough tier (checks without mutation testing) | about 18 minutes (1077 s measured) |
| Mutation testing, one slice (about a dozen mutants) | about 14 minutes, runs alongside the window checks; the first run in a new folder also compiles dependencies |

## When to run which

- **Before every push of real work:** fast.
- **When `verify:promotion` says a hop is due** (a branch other than `stable` is about 100 commits behind its source, set by `NV_PROMOTE_LAG`): thorough on the source branch, then promote if it is green.
- **On `test`, `beta` and `dev`:** both work. When nothing differs from `origin/dev` there is nothing to compare, so the tool runs every check of the tier instead of none.

## Tuning for a slower or busier PC

The tool sizes its window count from your machine: half your cores, 1.5 GB of free memory per window, never above 6. Most people change nothing. If a PC struggles, pick one:

| I want | Do this |
|---|---|
| Fewer windows at once, normal look only | `npm --prefix apps/desktop-electron run verify -- --profile low` |
| A specific window count | set `NV_CLICKS_SHARDS=3` (windows per look) and `NV_CLICKS_JOBS=3` (windows open at once) |
| A big machine to go faster | `--profile high` (8 windows) |
| Fewer controls pressed per page in the fast tier | `NV_CLICKS_CAP=12` (default 25) and `NV_CLICKS_TARGET_MS=15000` (default 30000) |
| Other looks in the full click-through | `NV_CLICKS_CELLS="default;theme=light"`; names are `theme=light/dark/black`, `size=1024x720`, `motion=1` |
| Mutation testing on one chosen slice, or all of it | `NV_MUTANTS_SHARD=5/80`, or `1/1` for all (takes hours) |
| Longer fuzzing | `NV_FUZZ_SECONDS=300` |
| Mutation testing in another folder | `NV_MUTANTS_TARGET=D:/some/folder` (default: a folder next to the repo; it is cleared of `nv-agents` before each run) |
| Promotion threshold | `NV_PROMOTE_LAG=50` |

Any `NV_` variable you set wins over a check's built-in default and over a profile. A bad value stops the run with a message; it is never quietly replaced.

## What it does not do

- It does not replace review, the soak period or the clean-machine install test that the step into `stable` needs ([`promotion-gate.md`](../release/promotion-gate.md)).
- It does not promote anything. `verify:promotion` only reports.
- Fast is not a security audit. The deep security checks (mutation testing, fuzzing, and the opt-in staging scan and Snyk scan) are in thorough.
- Tools that are not installed (Docker for ZAP, Nuclei, Snyk) are opt-in and report NOT RUN until installed.
