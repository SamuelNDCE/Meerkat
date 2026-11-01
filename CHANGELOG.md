# Changelog

Every released version of Meerkat, newest first. Versions follow semantic versioning: a patch fixes, a minor adds, a major changes how you use it.

## Unreleased

- fewer false alarms: a hit the surrounding code already makes safe is skipped (a QA-only executeJavaScript, a path checked by need() before it reaches the shell, a require helper called only with fixed strings, markup from a constant table)
- meerkat tools install works on Windows (it found the bare npm script instead of npm.cmd)
- the CI job is allowed 30 minutes
- installing the outside tools no longer changes a clean project's result: markdownlint uses lenient style rules when the project has no markdownlint config, and eslint, prettier and stylelint are NOT RUN when the project has not configured them (thorough/config-guard.mjs)
- a tool that cannot reach its service (cargo audit's advisory database, the npm registry) is NOT RUN instead of a failed check (thorough/offline-guard.mjs)
- the results screen names every check that did not run (skipped, covered by a wider check, turned off) instead of leaving its description empty
- ep-ipc-handler-no-sender-check no longer flags handlers whose sender is checked through a helper in the same file, or registered through an ipcMain parameter that every caller fills with a wrapper that checks the sender (found scanning Plume)
- secret checks leave test code alone: Rust unit tests after #[cfg(test)], *_tests.rs, probe folders, values that say they are fake (FAKE_TOKEN, SUPERSECRET, the AWS documentation keys), and a private key header in a comment with no key under it. On NeuralVault this removed all 25 critical findings, every one of them a test fixture
- markdownlint skips the folders named fixtures, where documents are broken on purpose

## 0.3.13 (2026-11-01)

- The package is on npm: npm install -g @samuelndce/meerkat
- releases publish to npm through trusted publishing (no stored token)

## 0.3.12 (2026-11-01)

- Findings Meerkat itself calls notes (low, info, low confidence, probably a false alarm) are no longer counted as bugs
- presence-style rules are rated low or medium instead of high
- innerHTML through a sanitiser is trusted
- the same fact is reported once
- the longest check starts first and small checks run beside it instead of waiting
- the badge says made with Perpetual Technologies

## 0.3.11 (2026-11-01)

- Hot fix: the key hints at the bottom of the results screen now always fit and keep quit and help
- finding places keep their line numbers
- the prompt file is named with the run's date and preset
- the package is ready to install with npm

## 0.3.1 (2026-11-01)

- README pictures: the running GIF is bigger with no empty block below it
- the results GIF scrolls slower, one row at a time
- GIF frames are trimmed of empty space

## 0.3.0 (2026-11-01)

- every update shows the yellow update line, including a fix published without a new version number
- AI prompt: press p on the results screen (or run meerkat prompt) for a file that hands every finding in full to an AI
- optional AI verification of findings (meerkat verify --ai-verify), fail-closed
- findings, logs and the prompt keep full text (no 200 character cut); every run saves run.log
- the live board shows the full scanned folder; settings files moved into .meerkat/
- Longest checks start first and timeouts have more leeway
- the live board never flickers and shows every group with its time in ALL CHECKS
- fewer checks end NOT RUN (meerkat tools, built-in fallbacks)
- projects are checked before a run
- fake-app end-to-end tests
- estimate shown against actual time
- CI green on Windows, macOS and Linux
- false positives fixed on real projects

## 0.2.0 (2026-11-01)

- Stuck-test guard: idle kill, skip keys, run deadline
- found project tests run as checks
- quick runs every short check
- findings files with severity
- happy results screen and scrollable timeline
- version and update line on every screen
- fewer false positives on real projects
- Meerkat now runs clean on itself

