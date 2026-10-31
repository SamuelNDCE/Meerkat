> **Moved 2026-10-30** from NeuralVault `docs/testing/` into this repository. Paths of the form `apps/desktop-electron/scripts/verify/...` in the text below now live at this repository's root (`run.mjs`, `lib/`, `checks/`, `thorough/`, `fixtures/`, `rules/`). The app is found with `--app`, `NV_APP_DIR` or the folder you start in. The text below is otherwise unchanged and may still describe the old layout.

# Setting up and using Meerkat, the validation tool (written so an AI assistant can do it for you)

If you are a person: copy the prompt below to your AI assistant and let it work.

> Read `docs/testing/validation-tool-setup.md` in the NeuralVault repo and set the validation tool up on this machine. Run the doctor, do every fix it prints in order, then run the fast tier and tell me exactly what passed, failed or could not run. Do not change any check to make it pass.

If you are the AI assistant: follow "Set it up" below, then "Use it while working on an issue". Plain overview first: [`validation-tool-overview.md`](validation-tool-overview.md). The contract for people who change the tool itself: [`validation-tool.md`](validation-tool.md).

## What it is, in one paragraph

One command checks the app before you push: type check, unit tests, rustfmt, clippy, dependency audits, a rule scan built from past mistakes, an accessibility scan, screenshots of the main pages, and a real-window click-through of every page. A second, slower tier adds the full click-through in four looks, every unit test, fuzzing and mutation testing of the shell guard. It runs real Electron windows, parked off-screen, that cannot open folders, file pickers, dialogs or downloads. A check that cannot run is reported as NOT RUN and fails the run; nothing is skipped to look green.

## Set it up

Do these in order, from the repo root. Each command is for PowerShell 5.1 or bash and is one line.

1. Get the repo and the branches the tool compares against.

```bash
git fetch origin
```

2. Install the packages. This also downloads the Electron binary and the accessibility library.

```bash
npm --prefix apps/desktop-electron ci
```

3. Ask the doctor what is missing. It changes nothing; it prints the fix for each gap.

```bash
npm --prefix apps/desktop-electron run verify:doctor
```

4. Do every `fix:` line it prints for an item marked `MISSING (required)`, then run the doctor again until it says `READY for the fast tier`. The usual fixes:

| Missing | Fix |
|---|---|
| Rust | install with rustup (stable toolchain), then `rustup component add rustfmt clippy` |
| `cargo-audit` | `cargo install cargo-audit --locked` |
| `cargo-mutants` (thorough tier only) | `cargo install cargo-mutants --locked` |
| Built app | `npm --prefix apps/desktop-electron run build:all` |
| Electron binary | delete `apps/desktop-electron/node_modules/electron` and run the `ci` step again |
| Git branches | `git fetch origin` |

5. Optional, for faster rebuilds: share one cargo build folder between worktrees by setting `CARGO_TARGET_DIR` to a folder outside the repo (it needs 5 to 50 GB). Do not make a new one per task.

6. Run the fast tier. The first run builds the sidecar and takes several minutes; later runs are about 4 to 5 minutes.

```bash
npm --prefix apps/desktop-electron run verify
```

   In a terminal you get a live display: a progress bar, the time spent and about how long is left, what is running now, and each check as it passes or fails. Piped output (CI, an AI session) gets plain lines instead. `-- --ui` shows a fuller view instead (every check with its status, time, typical time on this PC and last run; Enter shows a failed check's saved output, Tab shows past runs, `f` filters, `l` hides the output pane), only in a real terminal; past runs are kept in `~/.nv-verify-history.json` (`NV_VERIFY_HISTORY` to move it). `-- --progress` forces the bar, `-- --no-progress` or `NV_VERIFY_PLAIN=1` turns it off. The time left is a guess from each check's measured time and shows after a tenth of the work is done.

7. Read the result. The last line is `VERIFY fast: N passed, N failed, N not run`. Exit code 0 only when nothing failed and nothing could not run.

Machine-specific settings are never edited into the repo. If the machine has its own build lock script, point `NV_CARGO_LOCK` (and `NV_ELECTRON_LOCK`) at it with an environment variable. If they are not set, the tool uses its own built-in locks, so there is nothing to configure.

## Use it while working on an issue

- **Before you push real work:** run the fast tier. Fix what it names; do not edit a check, a baseline or an allow-list to get green. A baseline or allow-list entry needs a reason a reviewer can read.
- **Before a promotion** (`dev` to `test` to `beta`): run `npm --prefix apps/desktop-electron run verify -- --thorough` on the source branch. `npm --prefix apps/desktop-electron run verify:promotion` says when a promotion is due (a branch other than `stable` is about 100 commits behind its source).
- **If a check fails:** read its one-line detail, then the full output. If the failure is a real defect, file an issue with the three parts the repo asks for (the problem, the expected fix, what fixed looks like). If it is the tool's own bug, fix the tool and add a test.
- **If the machine is slow or busy:** add `-- --profile low`. The window count already sizes itself from the free memory and cores.
- **Machine-readable result:** add `-- --json result.json`.

## Where each part lives

All paths are under `apps/desktop-electron` unless they start with `docs/` or `packages/`.

| Part | What it does |
|---|---|
| `scripts/verify/run.mjs` | The command. Reads the options, picks the checks (fast, thorough, changed files, one id), runs them and prints the table. |
| `scripts/verify/lib/runner.mjs` | Schedules checks: cheap first, one cargo job and one window job at a time, free ones in parallel. Applies the hard timeout. Decides which checks a bigger one covers. |
| `scripts/verify/lib/lanes.mjs` | Wraps a command for its lane: cargo jobs go through a build lock, window jobs through the one-window lock and the test safety layer. |
| `scripts/verify/lib/load-checks.mjs` | Loads every file in `checks/` and rejects a malformed check as a failing check, never a crash. |
| `scripts/verify/lib/exec.mjs`, `which.mjs`, `glob.mjs`, `changed.mjs` | Run a command with a timeout and process-tree kill; find a program on PATH; match changed-file patterns; list files changed against `origin/dev`. |
| `scripts/verify/lib/profiles.mjs` | The `low`, `normal`, `high` machine profiles. |
| `scripts/verify/doctor.mjs` | The setup check described above. |
| `scripts/verify/checks/core.mjs` | Checks that wrap existing commands: type check, unit tests, rustfmt, clippy, builds, audits, the window checks. |
| `scripts/verify/checks/fast-checks.mjs` | Rule scan, accessibility scan (axe), vault parser property tests. |
| `scripts/verify/checks/screens-checks.mjs` | Screenshots and layout checks of the main pages. |
| `scripts/verify/checks/safety-checks.mjs` | Proof that test windows cannot open folders, pickers, dialogs or take focus. |
| `scripts/verify/checks/thorough-checks.mjs` and `scripts/verify/thorough/` | Parser fuzzing, mutation testing of the shell guard, and the opt-in sync load, staging scan and Snyk scan. |
| `scripts/verify/click-shards.mjs` | Runs the click-through as several windows at once and merges the result. |
| `scripts/verify/promotion-due.mjs` | Reports how far each branch is behind its source. |
| `scripts/verify/rule-scan.mjs` and `scripts/verify/rules/` | A dependency-free scanner whose rules come from past failures. |
| `scripts/verify/fixtures/` | Deliberately broken inputs for each check's self-test. |
| `scripts/electron-run.mjs`, `scripts/electron-lock.mjs` | Start an Electron driver under the one-window lock and the safety layer; clean up its scratch folder. |
| `electron/test-safety.cts`, `test-safety-boot.cts` | Block dialogs, folders, file pickers, downloads, focus; park windows off-screen. |
| `electron/verify-click-through.cts`, `click-knobs.cts`, `click-pages.cts` | The click-through itself, its settings (size, theme, shard) and the page list. |
| `electron/verify-screens.cts`, `verify-ui-integrity.cts` | The screenshot check and the UI integrity and accessibility checks. |
| `electron/axe-baseline.json`, `click-through-baseline.json`, `scripts/verify/thorough/guard-mutants-allowlist.json` | Known and accepted findings, each with a reason. |
| `.cargo/mutants.toml`, `packages/vault/src/proptests.rs` | Mutation test scope; the parser property tests the fuzz check loops. |

## The checks

Run `npm --prefix apps/desktop-electron run verify -- --list` for the live list with times. A check is `fast` or `thorough`, and in the `free`, `cargo` or `electron` lane.

## Keeping it up to date

The tool is ordinary code in the repo, so `git pull` updates it. After a pull: run `npm --prefix apps/desktop-electron ci` (the dependencies may have changed) and the doctor. If a pull changes the page list, `src/lib/guards/click-through-pages.test.ts` fails until `electron/click-pages.cts` matches; fix the list, not the test. When you add a check, follow the format in `validation-tool.md` and give it a self-test; `npm --prefix apps/desktop-electron run verify -- --self-test` must pass.

## When a check fails

The table line shows only the last line of the output, which is often not the cause. Every check that did not pass saves its whole output and names the file at the end of the line: `[full output: <file>]`. Read that file before guessing. `NV_VERIFY_LOG_DIR` changes the folder.

## Things that have gone wrong, and the fix

| What you see | What it means | What to do |
|---|---|---|
| `NOT RUN: missing on PATH` | A tool is not installed | Run the doctor and do its fix |
| `needs build-sidecar, which did not pass` | The sidecar build failed, so the window checks could not start | Read the build error; the cause is rarely the checks |
| Cargo waits on the lock | Another build is running on the machine | Wait; it is not a hang |
| `Failed to start threads worker` | Too many heavy jobs at once | Use `-- --profile low` |
| A window or File Explorer appears | The safety layer is not loaded | Run `npm --prefix apps/desktop-electron run build:all`, then the `test-safety` check |
| `The paging file is too small` (os error 1455) or `fork: Resource temporarily unavailable` | Windows ran out of virtual memory with many builds and windows open | Close other apps, or raise the page file size; the mutation check retries once by itself |
| `cargo audit` fails | Real dependency advisories | Triage them; do not hide them |
| Mutation test survivor | A guard rule has no test | Add a test that fails when the rule is broken; allow-list only a mutant proven equivalent, with the proof |
