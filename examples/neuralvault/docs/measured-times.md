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
