> **Moved 2026-10-30** from NeuralVault `docs/testing/` into this repository. Paths of the form `apps/desktop-electron/scripts/verify/...` in the text below now live at this repository's root (`run.mjs`, `lib/`, `checks/`, `thorough/`, `fixtures/`, `rules/`). The app is found with `--app`, `NV_APP_DIR` or the folder you start in. The text below is otherwise unchanged and may still describe the old layout.

# Meerkat, the validation tool: one command, two tiers

Start with the plain-language overview: [`validation-tool-overview.md`](validation-tool-overview.md) (what it is, why to use it, how to tune it for a slower PC). This page is the contract for people who change the tool.

Tracking issue: #3114. Status: **under construction**. The orchestrator and the core checks (this branch) are built; the fast and thorough check parts add their files to `checks/`. This page is the contract the parts are built to.

## The name, and using it in another project

The tool is called **Meerkat**, after the one that stands up on its hind legs and watches while the rest eat (chosen by Samuel, 2026-10-29). Everything that already worked keeps working: the file and folder names (`scripts/verify/`, `docs/testing/validation-tool*.md`), the `verify` npm scripts and the `NV_VERIFY_*` settings are unchanged. `npm run meerkat`, `meerkat:thorough` and `meerkat:doctor` are the same commands under the new name. The summary line now starts with `MEERKAT fast:` or `MEERKAT thorough:`.

What is generic and what is not, for a Rust plus Electron project that wants its own copy:

- **Generic (copy as is):** `run.mjs`, everything in `lib/` (the scheduler and its lanes, the live bar, the status file and heartbeat, the measured times, the cargo and electron locks), `click-shards.mjs` and `doctor.mjs`.
- **Specific to NeuralVault (rewrite):** the check files in `checks/` and `thorough/`, `rules/` (the failure-derived scan rules), the Electron driver files in `electron/verify-*.cts`, and the paths and commands inside each check.
- **Not decided:** whether Meerkat is ever released as open source. Until Samuel decides, it stays in this private repo, and the files carry the proprietary header. Nothing here has been published.

## How to use it

From the repo root. One command per line.

```
npm --prefix apps/desktop-electron run verify
```

The **fast** tier. Run it after every change. Target: as fast as it can be made while still catching about 90% of problems.

```
npm --prefix apps/desktop-electron run verify -- --thorough
```

The **thorough** tier. Run it before a release or after a risky change. It runs everything in fast, then the slow, deep checks. Also as fast as it can be made, but it is allowed to take much longer.

Other flags:

| Flag | What it does |
|---|---|
| `--changed` | Skip any check whose files did not change against `origin/dev`. Default for fast. |
| `--all` | Run every check even if its files did not change. Default for thorough. |
| `--only <id,id>` | Run just those checks. |
| `--include <name>` | Also run checks marked `optIn: '<name>'`. These need a target or an approval, so they never run by default and are not counted as NOT RUN when left out. Names: `staging` (ZAP, Nuclei, load test against a staging server), `snyk` (agent scan, after the data-handling check), `rust` (every Rust test in the workspace, `cargo test --workspace`; opt-in because two tests use a local Ollama model when one is running and it can compete with the build for memory). |
| `--list` | Print every check, its group, tier and estimated time, then stop. |
| `--self-test` | Run each check's deliberately broken case. Every one must FAIL, or the check is not trusted. |
| `--json <file>` | Also write the result as JSON. |

`verify:all` is unchanged and stays the gate that `dist:signed` uses.

## What a result means

Every check ends in exactly one status.

| Status | Meaning | Fails the run? |
|---|---|---|
| PASS | The check ran and found nothing wrong. | No |
| FAIL | The check ran and found a problem. | Yes |
| SKIPPED | Fast tier only, `--changed`: none of the check's files changed. | No |
| NOT RUN | The check could not run (a tool is missing, a service is down, a setting is absent). | **Yes.** A check that did not run is never a pass. |

The final line is always: `VERIFY <tier>: <n> passed, <n> failed, <n> not run, <n> skipped in <time>`. The process exits 0 only if failed and not run are both 0.

## Seeing the progress (any terminal, an AI session, a pipe)

The coloured bar only draws in a real terminal. Everywhere else the tool does three things so a long check never looks like a hang:

- **A status file**, rewritten on every start and finish and every 5 seconds: percent done, time spent, about how long is left, what is running (with how long it has run against how long it usually takes, and a `overran` flag when it is 1.5 times slower), what is waiting and why (`the cargo lane is busy`, `after build-all`), and every finished check. The path is printed at the start (`live status: ...`). Read it with any JSON reader; `state` is `running` until the run ends, then `done` with the summary line.
- **A heartbeat line** every 30 seconds in plain output: `[working] 42% · 7:12 spent · about 9:40 left · 3/12 done · running: build-sidecar 5:01/6:20, ui-axe 0:40/1:30`.
- **Measured times.** After each run the real time of every check that passed is saved (the last 5 per tier). The next run uses the middle value for the order checks start in, the weight of each check in the bar and the time left, instead of the `estSeconds` written in the check file. `--list` still shows the written values. A check never measured keeps its written estimate.

## Speed rules

1. Cheap checks first, and stop at the first failure (`--keep-going` shows all failures instead).
2. Checks in the `free` lane run in parallel (up to CPU count minus one).
3. Checks in the `cargo` lane go through `scripts/cargo-lock.sh` so only one Rust build runs on the machine.
4. Checks in the `electron` lane (anything that opens a real window) run one at a time, through the machine electron lock, with the test window hidden and titled `NV TEST DRIVER, ignore`.
5. Build once: the sidecar and renderer builds are a shared step that later checks wait on, not repeated.
6. `--changed` uses `git diff --name-only origin/dev...HEAD` plus the working tree to decide.

## The check format (the contract)

The orchestrator is `apps/desktop-electron/scripts/verify/run.mjs`. It loads every file matching `apps/desktop-electron/scripts/verify/checks/*.mjs`. Each file default-exports an array of checks.

```js
export default [
  {
    id: 'rule-scan',                 // unique, kebab-case, stable
    group: 'security',               // security | functionality | ui | performance
    tier: 'fast',                    // fast | thorough. A fast check also runs in thorough.
    title: 'Failure-derived rule scan',   // plain English, shown in the summary
    lane: 'free',                    // free | cargo | electron
    optIn: undefined,                // or 'staging' | 'snyk': only runs with --include <name>
    estSeconds: 3,                   // rough, used for ordering and --list
    needs: ['node'],                 // binaries that must be on PATH, else NOT RUN. e.g. 'k6', 'cargo-mutants'
    paths: ['apps/desktop-electron/electron/**', 'apps/desktop-electron/src/**'],  // for --changed. Omit = always run.
    run: { cmd: 'node', args: ['scripts/verify/rule-scan.mjs'], cwd: 'app' },       // cwd: 'repo' | 'app'. Exit 0 = pass.
    selfTest: { cmd: 'node', args: ['scripts/verify/rule-scan.mjs', '--fixtures'], cwd: 'app', expectFail: true },
  },
];
```

`run` may also be an async function `(ctx) => ({ ok: boolean, detail: string })` for checks that are easier in JS. `ctx` has `repoRoot`, `appDir`, `changedFiles`, `tier`, `env`.

**Exit codes for command checks** (`run.cmd`): `0` = PASS, `1` (or any other non-zero) = FAIL, `75` = NOT RUN. On exit 75 the last output line is the reason, written `NOT RUN: <why>`, and the summary shows it. Exit 75 is also what `cargo-lock.sh` and `electron-lock.sh` return when they waited too long, so a busy lane is NOT RUN, never a quiet pass. A command that outlives its timeout (default 10 minutes, per-check `timeoutSeconds`) is killed with its whole process tree and reported FAIL.

Optional extra field: `after: ['build-all']` names checks that must PASS first (build once, share the result). If a dependency did not pass, the check is NOT RUN and says which one.

How a bad check file is handled: a file in `checks/` that fails to import, or exports something that is not an array of well-formed checks, becomes one FAIL named `bad-check-file-<name>` that names the file. It never crashes the run, and it does not hide the other files.

Rules every check follows:
- **Exit non-zero and print one plain line saying what is wrong** (file and line where there is one). Do not print pages.
- **Every check has a `selfTest`**: a deliberately broken input (a fixture file under `apps/desktop-electron/scripts/verify/fixtures/<id>/`, never in real source) that the check must FAIL on. If it passes the broken case, the check is broken.
- **No network unless the check is about the network** (k6, ZAP, Nuclei, Snyk), and those say so in `needs` and read their target from an env var, never a hardcoded host.
- **Never touch the real home, vault, licence or keyring.** Temp dirs only. Never hardcode a machine path.
- **A missing tool is NOT RUN, never a quiet pass.** The orchestrator does this from `needs`; a check that shells out to something not listed in `needs` is a bug.

## File ownership (so parts do not clash)

| Part | Files it owns |
|---|---|
| Orchestrator | `apps/desktop-electron/scripts/verify/run.mjs`, `lib/*.mjs`, `checks/core.mjs` (wrappers for the existing gates and the dependency audits), the `"scripts"` block of `apps/desktop-electron/package.json`, this page, the baseline timing |
| Fast checks | `scripts/verify/checks/fast-*.mjs`, `scripts/verify/rules/*`, `scripts/verify/rule-scan.mjs`, the axe-core addition in `electron/verify-ui-integrity.cts`, the proptest module in the vault parser crate |
| Thorough checks | `scripts/verify/checks/thorough-*.mjs`, `scripts/verify/thorough/*`, `fuzz/`, `.cargo/mutants.toml` (or `mutants.toml`), k6 scripts under `tools/loadtest/` |

Nobody edits another part's files. `package.json` is shared in two separate places: the orchestrator edits only the `"scripts"` block, and the fast-checks part may add dev dependencies (axe-core) and the lockfile, nothing else.

## Lanes, locks and environment

| Variable | Meaning | Default |
|---|---|---|
| `NV_CARGO_LOCK` | A machine lock script every `cargo` lane command is wrapped in (`bash <script> cargo ...`). Order: this variable, then `cargoLock` in `~/.nv-verify.json`, then the built-in lock (`scripts/verify/lib/cargo-lock-run.mjs`). A configured script that is missing is NOT RUN; nothing configured means the built-in lock, so a new machine needs no setup. Nothing machine-specific is kept in the repo. | built-in lock |
| `NV_ELECTRON_LOCK` | A machine lock for the `electron` lane, same order (`electronLock` in `~/.nv-verify.json`). Without one the app's own `scripts/electron-lock.mjs` still serializes the window. | in-repo lock |
| `NV_VERIFY_LOG_DIR` | Where a failed check's full output is saved (the table line ends with `[full output: <file>]`). | `nv-verify-logs` in the temp folder |
| `CARGO_TARGET_DIR` | Pass through to cargo; use the shared target dir so builds are reused. | unset |

While a check runs the runner prints `[start  ] <id>` and, when it ends, `[PASS   ] <id> (<seconds>)`, so there is never a silent pause. The final table lists every check with its time.

## What is in fast and what is in thorough

Fast: type check, unit tests related to the changed files, sidecar rustfmt and clippy, `npm audit`, `cargo audit`, and the build step plus a SHORT real-window click-through split across 6 windows at once (`scripts/verify/click-shards.mjs`: every page, Settings section, named surface and Business page is visited, 25 controls per page at most, 30 seconds per page at most). The builds and the click-through only run when files they depend on changed (`--changed`); when nothing differs from `origin/dev` (a promotion branch such as `test` or `beta`, or a clean `dev`) every check of the tier runs instead, because "nothing changed" must never mean "nothing checked". Thorough adds the full click-through (`click-through-full`: every control, 3 windows per look, in the default look, light, black, and the smallest window with reduced motion), the full unit test suite, `verify:sidecar`, `verify:shell`, `verify:app`, `verify:ui`, and whatever the other parts register. The core checks use exactly the commands in `verify:all`, in the same order of dependency; `verify:all` itself is untouched.

The thorough tier also runs `cargo test -p nv-sidecar` (`sidecar-tests`): the fast tier compiles the sidecar's tests with clippy but never runs them. Its time is not measured yet.

Self-test limits, stated honestly: the type check, unit test, rustfmt, clippy, build and cargo audit self-tests feed a real broken fixture. The window checks (`verify:shell`, `verify:app`, `verify:ui`, `verify:clicks`, `verify:sidecar`) cannot be given a broken app cheaply, so their self-test only proves a driver that cannot start produces a FAIL through the same wrapper and lock.

## Tools and licences

Rule (Samuel, 2026-10-27): tune every tool for our own use. Order of preference: configuration, then our own rule files, then a thin wrapper around the tool's CLI. Fork or patch an open-source tool only when configuration cannot do the job, and say why here. Never copy a tool's source into the repo without checking its licence. A tool that is not open source is wrapped through its CLI and none of it is copied. Licences below were read from each tool's own repository or package metadata on 2026-10-27, not from memory.

| Tool | Licence (source checked) | How it is tuned for us | Wrap or modify |
|---|---|---|---|
| TypeScript (`tsc`) | Apache-2.0 (npm package metadata) | Our `tsconfig*.json`; self-test uses `--ignoreConfig --strict` on a fixture | Wrap (CLI) |
| Vitest | MIT (npm package metadata) | Our `vite.config.ts` projects; fast tier runs `--changed origin/dev` | Wrap (CLI) |
| Electron | MIT (npm package metadata) | Our drivers run hidden, titled `NV TEST DRIVER, ignore`, under the machine lock | Wrap (CLI) |
| cargo-audit (RustSec) | Apache-2.0 OR MIT (`cargo-audit/Cargo.toml`, rustsec/rustsec) | Reads our `.cargo/audit.toml` allow-list; run from the repo root; same invocation as `security-audit.yml` | Wrap (CLI) |
| axe-core | MPL-2.0 (dequelabs/axe-core LICENSE) | Run inside our real-window harness (`verify-ui-integrity.cts`, axe-only mode); only NEW serious or critical findings fail; accepted findings live in `electron/axe-baseline.json`, each with a reason | Wrap (npm dev dependency used as a library, not modified) |
| proptest | MIT OR Apache-2.0 (read from `cargo metadata`, version 1.12.0, 2026-10-27) | Our own property tests in `packages/vault/src/proptests.rs` (dev-dependency of `nv-vault` only); the fast tier runs them once, the fuzz check loops them with `PROPTEST_CASES` | Wrap (dev-dependency) |
| cargo-mutants | MIT (`Cargo.toml`, sourcefrog/cargo-mutants) | `.cargo/mutants.toml` limits it to the three guard files and the `nv-agents` tests that pin them; one slice of 80 per run, rotating by day; survivors fail unless allow-listed with a reason; the baseline is retried once | Wrap (CLI) |
| cargo-fuzz | MIT OR Apache-2.0 (`Cargo.toml`, rust-fuzz/cargo-fuzz) | Not used: libFuzzer needs nightly Rust and ASan, which does not work on Windows MSVC, and WSL has no distro here. The fuzz check loops the proptest module instead (`fuzz/README.md`) | Not used |
| k6 | AGPL-3.0 (grafana/k6 LICENSE.md) | `tools/loadtest/sync-load.js` with synthetic notes only, opt-in (`--include staging`). Run only as a separate process; none of its code is copied or linked into this repo | Wrap (CLI) only |
| OWASP ZAP | Apache-2.0 (zaproxy/zaproxy LICENSE) | Baseline scan with our `thorough/zap-baseline.conf`, against staging only, opt-in; needs Docker | Wrap (CLI in a container) |
| Nuclei | MIT (projectdiscovery/nuclei LICENSE.md) | Our own templates in `thorough/nuclei-templates`, staging only, opt-in | Wrap (CLI) |
| Snyk CLI | Apache-2.0 for the CLI source (snyk/cli LICENSE); the Snyk scanning service is proprietary | `thorough/agent-scan.mjs` prints what would be sent first; needs `SNYK_TOKEN` and `NV_AGENT_SCAN_APPROVED=yes`. Wrap the CLI; copy nothing | Wrap (CLI) only |

## Tuning (the knobs)

Every setting is an `NV_` variable or a profile; a check's own value is only a default. Precedence: a variable you set, then `--profile` / `NV_VERIFY_PROFILE` (`low`, `normal`, `high`, in `scripts/verify/lib/profiles.mjs`), then the check's default, then the machine-sized value (`auto`: half the cores, 1.5 GB free memory per window, capped at the check's ceiling). A self-test's own env is never overridden. A check that a bigger one covers (`supersededBy`, for example the short click-through next to the full one, and the changed-files unit tests next to every unit test) does not run on its own, and the run prints `[COVERED ]` for it.

| Variable | Meaning | Default |
|---|---|---|
| `NV_CLICKS_SHARDS` | Windows per look in the click-through; a number or `auto:N` | `auto:6` fast, `3` full |
| `NV_CLICKS_JOBS` | Windows open at once across all looks | the shard count (`auto:4` full) |
| `NV_CLICKS_CELLS` | Looks for the full click-through: `default`, `theme=light/dark/black`, `size=1024x720`, `motion=1`, separated by `;` | `default` fast; four looks full |
| `NV_CLICKS_CAP`, `NV_CLICKS_TARGET_MS` | Controls pressed per page, and time per page | 25 and 30000 fast; 60 and 60000 full |
| `NV_MUTANTS_SHARD` | Mutation slice `k/n`; `1/1` is all of it | rotates by day through `n=80` |
| `NV_FUZZ_SECONDS` | Parser fuzzing time | 60 |
| `NV_PROMOTE_LAG` | Commits behind that make a promotion due | 100 |
| `NV_VERIFY_PROFILE` | `low`, `normal` or `high` | none |
| `NV_VERIFY_HISTORY` | Where the run log for the `--ui` history view is kept | `~/.nv-verify-history.json` |
| `NV_VERIFY_PLAIN` | `1` turns the live progress bar off (the bar is drawn only on a real terminal; `--progress` forces it, `--no-progress` disables it) | off |
| `NV_VERIFY_STATUS` | where the live status file is written (default: `nv-verify-status.json` in the system temp folder) | temp folder |
| `NV_VERIFY_TIMINGS` | where measured check times are kept (default: `.nv-verify-timings.json` in your home folder) | home folder |
| `NV_BASH` | The bash that runs a machine lock script. On Windows, `bash` on PATH is often the WSL launcher, so Git for Windows' bash is looked for first; none found means the built-in locks | auto |

## Test windows never open real dialogs or folders

`electron/test-safety.cts` (loaded by `scripts/electron-run.mjs` for every driver) blocks `shell.openPath`, `showItemInFolder`, `openExternal`, every `dialog` call, focus stealing, notifications, and, added 2026-10-27, native file pickers and downloads. A press on an `<input type="file">` makes Chromium open a native "Open" window without going through `dialog`, which was the File Explorer window that kept appearing during click-through runs. The layer cancels the click on file inputs in the page and cancels every download. Proof, measured the same day with a window watcher (class `#32770` and `CabinetWClass`): with `NV_TEST_SAFETY_PICKER=off` one "Open" window appeared in a 113 second run; with the guard on, none. The `test-safety` check keeps a control for this: an iframe (which the guard does not patch) must open a picker and the guarded page must not. Only the main frame is guarded; a picker opened from a sub-frame is not covered.

## When promotion is due

`npm --prefix apps/desktop-electron run verify:promotion` reports how far each branch lags its source in the order `dev` -> `test` -> `beta` -> `stable`, and exits 10 when a hop is due. Rule (Samuel, 2026-10-27): once any branch except `stable` is about 100 commits behind its source (`NV_PROMOTE_LAG`, default 100), run `verify -- --thorough` on the source branch and, if it is green, promote. `stable` is reported but never triggers, because it moves by hand. The report only reports; promoting is a separate step that waits for Samuel.

## Measured

Snapshot taken 2026-10-27 on the dev machine, in a fresh worktree. These numbers rot: re-measure with the commands below instead of trusting them.

Today's `verify:all` stages, run one by one (cargo stages through the cargo lock, shared target dir). INCOMPLETE: the cargo lane was busy with other agents, so the sidecar build waited in the queue and the window stages after it were not reached inside the time box.

| Stage | Seconds | Result |
|---|---|---|
| check (tsc, both configs) | 2 | OK |
| check:sidecar rustfmt | 1 | OK |
| check:sidecar clippy (cold cache) | 230 | OK |
| npm test (whole suite) | 204 | OK |
| build:all | 5 | OK |
| build:sidecar, verify:sidecar, verify:shell, verify:app, verify:ui | not measured | blocked behind the cargo lock |

Fast tier (`verify --all --keep-going`), also INCOMPLETE for the same reason: type-check 25.5 s, npm-audit 2.2 s, cargo-audit 3.4 s, build-all 71 s (machine busy). The rustfmt, clippy, build-sidecar and click-through checks were still queued on the cargo lock when stopped.

Real finding from the first run: `cargo-audit` FAILS today with 4 vulnerabilities in the dependency tree (for example RUSTSEC-2026-0405 and 0406 on zstd-safe, output of `cargo audit`). The check is doing its job; the advisories need triage.

To re-measure: `npm --prefix apps/desktop-electron run verify -- --all` for fast and `... -- --thorough` for thorough; `--json <file>` keeps per-check times.

Click-through speed, measured 2026-10-27 on the dev machine (warm build, shared cargo target): the old single-window `verify:clicks` took 495 s alone (420 controls pressed) inside a 771 s cold fast tier. The sharded short version takes 111 s (373 controls, 6 windows) and the whole fast tier takes 221 s with only the known `cargo-audit` failure (#3115). `click-through-full` takes 557 s for 1654 controls across four looks (12 windows, 4 at a time). The slowest single target (Chat, hits its 60 s budget in a full walk) bounds how far more windows can help.

Thorough tier, measured 2026-10-27 (dev plus the tool, 12 cores, 31 GB): 1077 s for everything except the mutation check, which died early that time (see below); the window checks are the long pole (UI integrity 313 s and the full click-through 561 s, one after another in the electron lane, while unit tests, fuzzing and builds run beside them). One mutation slice (about a dozen mutants) took 860 s on its own and runs on the cargo lane in parallel with the window checks. Two bugs found by those runs and fixed: `parser-fuzz` counted other test programs' "running 0 tests" as a failure, and `guard-mutants` reused test programs from a deleted temp folder (the baseline died with `corpus dir: NotFound` on the second run), so it now has its own target folder with `nv-agents` cleared before each run, and it retries once when the baseline fails.

Self-tests, all run 2026-10-27: every check's self-test passes. The window checks' self-test gives them a driver that does not exist; `scripts/electron-run.mjs` now refuses a missing driver at once (before, Electron opened an error window and waited for a click, which hung a self-test for nine minutes). `ui-axe` is proven by injecting a real violation into the page.
