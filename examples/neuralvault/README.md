# Example: the NeuralVault app

These are the checks of one real application: an Electron and Rust desktop app. They are an example of a pack for an app with its own test harness, not part of Meerkat's general checks.

What is here:

| Path | What it holds |
|---|---|
| `*.mjs` in this folder | the checks: type check, unit tests, Rust format, lints and tests, builds, real-window click-through, accessibility scan, fuzzing, mutation testing, staging and load scans |
| `scripts/` | the scripts those checks call (`rule-scan`, `click-shards`, `guard-mutants`, `parser-fuzz` and others), and `doctor.mjs`, which says whether a machine is ready to run them |
| `fixtures/`, `rules/` | their broken cases and rule files |
| `docs/` | the notes written for this app: the contract, set-up, measured times and speed analysis |

Switch it on in the app's `meerkat.config.json` with `{ "packs": ["neuralvault", "security", "hygiene"] }` and run Meerkat from the app folder (`--app` names it). The window checks need the app's own harness (`scripts/electron-run.mjs`), which Meerkat does not ship.
