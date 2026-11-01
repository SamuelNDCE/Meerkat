# Changelog

Every released version of Meerkat, newest first. Versions follow semantic versioning: a patch fixes, a minor adds, a major changes how you use it.

## 0.3.0 (2026-11-01)

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

