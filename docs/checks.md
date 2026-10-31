# Every check, and how long it takes

<!-- checks:start -->
**57 checks** (33 fast, 24 thorough, 6 opt-in). Security 14, Functionality 23, UI 9, Performance 8, Refactor 3.

| Check | Kind | Tier | Weight | Typical time | What it does | Comes from |
|---|---|---|---|---|---|---|
| `cargo-audit` | Security | fast | light | 4 s | cargo audit (advisory allow-list in .cargo/audit.toml) | built in (NeuralVault app) |
| `license` | Security | fast | tiny | 2 s | A license is declared, and no copyleft dependency slipped in | hygiene |
| `npm-audit` | Security | fast | light | 2 s | npm audit, high severity, shipped dependencies only | built in (NeuralVault app) |
| `rule-scan` | Security | fast | light | 1 s | Failure-derived rule scan (IPC, note paths, raw HTML, window hardening) | built in (NeuralVault app) |
| `rust-audit` | Security | fast | light | 4 s | Rust dependency advisories (cargo audit) | rust |
| `secret-scan` | Security | fast | tiny | 3 s | Secret scan: keys, tokens and private keys in tracked files | security |
| `sensitive-files` | Security | fast | tiny | 2 s | No environment files, private keys or tokens are tracked | hygiene |
| `unsafe-rust` | Security | fast | tiny | 2 s | Every Rust unsafe block says why it is sound | hygiene |
| `agent-scan` | Security | thorough | light | 2.0 min | Snyk agent-scan of the MCP and skill setup (prints what it sends first) (opt-in: `--include snyk`) | built in (NeuralVault app) |
| `ai-diff-review` | Security | thorough | light | 1.0 min | AI security review of the changes against the base branch (opt-in: `--include ai`) | ai |
| `ai-route-audit` | Security | thorough | light | 5.0 min | AI audit of every route, handler and IPC channel (opt-in: `--include ai`) | ai |
| `guard-mutants` | Security | thorough | heavy | 14 min | Mutation test the command classifier, poisoning guard and path rules | built in (NeuralVault app) |
| `npm-audit-all` | Security | thorough | tiny | 5 s | npm audit, high severity, every dependency including dev ones | security |
| `staging-scan` | Security | thorough | light | 10 min | ZAP baseline and Nuclei against the staging sync server (never the live one) (opt-in: `--include staging`) | built in (NeuralVault app) |
| `build-all` | Functionality | fast | light | 10 s | Build renderer and Electron shell (shared by the window checks) | built in (NeuralVault app) |
| `build-sidecar` | Functionality | fast | heavy | 50 s | Build the sidecar (shared by the window checks) | built in (NeuralVault app) |
| `conflict-markers` | Functionality | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `json-valid` | Functionality | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-files` | Functionality | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `links` | Functionality | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `lockfiles` | Functionality | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `markers` | Functionality | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `rust-clippy` | Functionality | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | Functionality | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | Functionality | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `scripts-resolve` | Functionality | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
| `sidecar-clippy` | Functionality | fast | heavy | 30 s | Sidecar clippy, warnings are errors | built in (NeuralVault app) |
| `sidecar-fmt` | Functionality | fast | heavy | 5 s | Sidecar rustfmt check | built in (NeuralVault app) |
| `type-check` | Functionality | fast | light | 10 s | TypeScript type check (renderer and Electron) | built in (NeuralVault app) |
| `unit-tests-changed` | Functionality | fast | light | 1.7 min | Unit tests related to files changed against origin/dev | built in (NeuralVault app) |
| `vault-parser-proptest` | Functionality | fast | heavy | 4.9 min | Vault note parser property tests (never panics, round-trips, odd input) | built in (NeuralVault app) |
| `parser-fuzz` | Functionality | thorough | heavy | 1.3 min | Fuzz the vault markdown and frontmatter parser (NV_FUZZ_SECONDS, default 60) | built in (NeuralVault app) |
| `rust-build-release` | Functionality | thorough | heavy | 5.0 min | Rust release build (cargo build --release) | rust |
| `sidecar-tests` | Functionality | thorough | heavy | 2.5 min | Sidecar Rust tests (cargo test -p nv-sidecar) | built in (NeuralVault app) |
| `unit-tests` | Functionality | thorough | light | 2.0 min | Every unit test (vitest, npm test) | built in (NeuralVault app) |
| `verify-sidecar` | Functionality | thorough | light | 6 s | Sidecar answers over its real socket (verify:sidecar) | built in (NeuralVault app) |
| `workspace-tests` | Functionality | thorough | heavy | 10 min | Every Rust test in the workspace (cargo test --workspace); opt-in: --include rust (opt-in: `--include rust`) | built in (NeuralVault app) |
| `click-through` | UI | fast | medium | 1.9 min | Real-window click-through, short version, split across several windows (verify:clicks) | built in (NeuralVault app) |
| `test-safety` | UI | fast | medium | 8 s | Test windows cannot open folders or dialogs, or take focus | built in (NeuralVault app) |
| `ui-screens` | UI | fast | medium | 15 s | Screenshots and UX of the primary pages (blank, errors, scroll, clipping, motion) | built in (NeuralVault app) |
| `ui-static` | UI | fast | tiny | 2 s | Pages have alt text, a language, a title and a viewport; no empty buttons | hygiene |
| `click-through-full` | UI | thorough | medium | 9.5 min | Real-window click-through, every control, in the default look and in light, black and the smallest window | built in (NeuralVault app) |
| `ui-axe` | UI | thorough | medium | 1.5 min | Accessibility scan of every page (axe-core, new serious/critical only) | built in (NeuralVault app) |
| `verify-app` | UI | thorough | medium | 12 s | Whole app in a real hidden window (verify:app) | built in (NeuralVault app) |
| `verify-shell` | UI | thorough | medium | 10 s | Electron shell starts (verify:shell) | built in (NeuralVault app) |
| `verify-ui` | UI | thorough | medium | 5.0 min | UI integrity in a real hidden window (verify:ui) | built in (NeuralVault app) |
| `perf-deps` | Performance | fast | tiny | 3 s | Dependency weight: direct count and installed size | performance |
| `perf-memory` | Performance | fast | light | 15 s | Memory: idle and peak use of the app and everything it starts | performance |
| `perf-sizes` | Performance | fast | tiny | 2 s | Size budgets: bundles and binaries stay under their limits | performance |
| `perf-startup` | Performance | fast | light | 15 s | Start-up time: how fast the app is ready (median of several starts) | performance |
| `perf-build` | Performance | thorough | alone | 2.0 min | Build time: the build stays inside its time budget | performance |
| `perf-endpoints` | Performance | thorough | light | 20 s | Response time: p95 of each configured endpoint | performance |
| `perf-load` | Performance | thorough | medium | 30 s | Load burst: concurrent requests to a local server, error rate and p95 | performance |
| `sync-load` | Performance | thorough | light | 1.0 min | Load test the sync server (k6, synthetic notes). NV_SYNC_URL, NV_SYNC_TOKEN; add --local to the script for a local server (opt-in: `--include staging`) | built in (NeuralVault app) |
| `dead-code` | Refactor | thorough | light | 10 s | Dead code: exported names nothing else uses (JS and TS) | refactor |
| `duplicate-code` | Refactor | thorough | light | 15 s | Duplicated code: blocks copied between files | refactor |
| `file-length` | Refactor | thorough | light | 3 s | Files too long to read in one sitting | refactor |
<!-- checks:end -->

## Measured times, NeuralVault app

Source of the list: the check files under `apps/desktop-electron/scripts/verify/checks/` in NeuralVault, read on `origin/dev` on 2026-10-30. Run `npm --prefix apps/desktop-electron run verify -- --list` there for the live list.

## The PC these were measured on

AMD Ryzen 5 7600 6-Core Processor, 6 cores / 12 logical processors, 31.4 GB RAM (read 2026-10-30 with Get-CimInstance Win32_Processor and Win32_ComputerSystem). The doctor, run the same day, reported "12 cores, 31.4 GB memory".

## Where the times come from

- **Run A, fast tier, 2026-10-28.** NeuralVault cutover report `fast.txt`. Cold Rust caches, so builds and clippy are slow in it.
- **Run B, thorough tier, 2026-10-28.** Same folder, `thorough.txt`. Builds were already warm, so build, clippy and parser-test times are tiny in it.
- **Local samples.** The tool saves up to 5 passing times per check per tier in `~/.nv-verify-timings.json` (file last written 2026-10-30 09:12). The run date of each sample is not recorded, and old samples are mixed cold and warm. Samples are listed oldest first. Only passes are recorded.
- A cell reading "not measured" means no source has a time for it. Written guesses in the check files (`estSeconds`) are not used here.

Legend for "Needs": **window** = opens a hidden, off-screen Electron window; **sidecar** = needs the built sidecar; **cargo** = takes the cargo lock; **free** = no lock.

| Check | Tier | What it catches | Needs | Measured time (seconds) |
|---|---|---|---|---|
| rule-scan | fast, thorough | Our own past mistakes: unsafe IPC, note paths, raw HTML, window hardening | free | Run A 2.4; Run B 1.5. Samples fast 0.7, 0.9, 0.4, 0.7; thorough 6.0 |
| npm-audit | fast, thorough | Known high-severity advisories in shipped npm dependencies | free | Run A 1.8; Run B 4.7. Samples fast 2.1, 8.8; thorough 5.7 |
| cargo-audit | fast, thorough | Known advisories in Rust dependencies | free | Run A 2.7; Run B 2.6. Samples fast 8.6, 1.9; thorough 2.9 |
| type-check | fast, thorough | TypeScript errors in renderer and Electron | free | Run A 15.8; Run B 4.3. Samples fast 22.1, 4.5; thorough 6.5 |
| sidecar-fmt | fast, thorough | Rust code not formatted | cargo | Run A 2.1; Run B 3.1. Samples fast 3.2, 1.9; thorough 2.5 |
| sidecar-clippy | fast, thorough | Rust lints, warnings are errors | cargo | Run A 188.5; Run B 2.0. Samples fast 259.2, 1.4; thorough 211.3 |
| vault-parser-proptest | fast, thorough | A note that crashes or fails to round-trip in the vault parser | cargo | Run A 292.8; Run B 0.7. Samples fast 99.2, 0.6; thorough 112.7 |
| build-all | fast, thorough | Renderer or Electron shell does not build (shared by window checks) | free | Run A 10.1; Run B 5.6. Samples fast 16.3, 6.0; thorough 7.9 |
| build-sidecar | fast, thorough | Sidecar does not build (shared by window checks) | cargo | Run A 378.3; Run B 1.2. Samples fast 1.9; thorough 307.3 |
| test-safety | fast, thorough | Test windows could open folders, dialogs or take focus | window | Run A NOT RUN (build missing, see below); Run B 2.0. Samples fast 4.0, 2.9; thorough 5.5 |
| ui-screens | fast, thorough | Blank pages, errors, clipping, scroll and motion problems on main pages | window, sidecar | Run A 13.3; Run B 14.5. Samples fast 14.8; thorough 11.4 |
| ui-axe | fast, thorough | New serious or critical accessibility problems on every page | window, sidecar | Run A 83.4; Run B 84.0. Samples fast 84.5; thorough 82.9 |
| unit-tests-changed | fast only | Broken logic in unit tests related to files changed against origin/dev | free | Run A 350.9. Samples fast 239.9, 124.1 |
| unit-tests | thorough only | Broken logic in every unit test | free | Run B 115.2. Sample thorough 245.2 |
| click-through | fast only | Page that crashes or control that does nothing; short walk, 6 windows | window, sidecar | Run A 111.9 (362 controls). Sample fast 184.8 |
| click-through-full | thorough only | Look-specific bugs, hidden controls, overlap; every control in 4 looks | window, sidecar | Run B 568.4 (1,665 controls, 12 windows). Sample thorough 285.2. Handoff, 2026-10-27: about 570 |
| verify-sidecar | thorough only | The sidecar not answering over its real socket | free | Run B 7.3 (48 of 48 passed). Sample thorough 5.0 |
| verify-shell | thorough only | The Electron shell not starting | window | Run B 1.7. Sample thorough 1.9 |
| verify-app | thorough only | Whole-app regressions in a real hidden window | window, sidecar | Run B 7.7. Sample thorough 2.8 |
| verify-ui | thorough only | UI integrity problems in a real hidden window | window, sidecar | Run B 316.4. Sample thorough 314.0 |
| parser-fuzz | thorough only | Inputs nobody thought of in the markdown and frontmatter parser (60 s of fuzzing by default) | cargo | Run B 87.2. Sample thorough 76.0 |
| guard-mutants | thorough only | Shell-guard rules that no test pins down (mutation testing, one slice per run) | cargo | Run B 1090.2. Sample thorough 723.5. Handoff, 2026-10-27: one slice 14 to 38 minutes |
| sync-load | thorough, opt-in (staging) | Sync server slowing or failing under load (k6) | free | not measured |
| staging-scan | thorough, opt-in (staging) | Web security findings on the staging sync server (ZAP, Nuclei) | free | not measured |
| agent-scan | thorough, opt-in (snyk) | Risky MCP or skill setup (Snyk agent scan) | free | not measured |

## Whole-sweep totals

| Sweep | Time | Date and source |
|---|---|---|
| Fast, sidecar already built | 221 s | 2026-10-27, handoff record |
| Fast, sidecar not built | 273 to 297 s | 2026-10-27, handoff record |
| Fast, cold | 771 s | 2026-10-27, handoff record |
| Fast, Run A | 1070.5 s (12 passed, 1 failed, 1 not run) | 2026-10-28, `fast.txt` |
| Thorough without mutation testing | about 18 minutes | 2026-10-27, handoff record |
| Thorough, Run B | 1184.5 s (18 passed, 2 failed) | 2026-10-28, `thorough.txt` |

## Notes

- Run A and the handoff numbers differ. The Run A build and clippy times show cold Rust caches, which likely explains it (not verified). Both are real measurements. Ideas to cut the time: `speed.md`.
- Run A's `test-safety` was NOT RUN because the test safety layer was not built yet, and it passed on a rerun the same day. That is the "NOT RUN is a failure" rule working.
- The 2026-10-30 thorough runs (PR 3171 comments) report outcomes but not per-check times, so they add no times here.
- The two failures in Run B were 4 known `cargo audit` advisories (since allow-listed on `dev`, PR 3190, 2026-10-29) and one missed mutant (test added on `dev`, 2026-10-28).
- A 2026-10-29 thorough attempt exited with code 127 after about 13 minutes of the recorded window (19:51:59 to 20:04:59 UTC); its cause was not read for this page.
