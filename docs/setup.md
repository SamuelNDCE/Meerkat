# Setting Meerkat up on a new machine

This is a short summary. The full guide, written so an AI assistant can follow it, is `docs/testing/validation-tool-setup.md` in the NeuralVault repo (on `dev`). Do not copy it here; follow it there. Meerkat runs inside a NeuralVault clone until it is extracted (see `README.md`).

## Prerequisites

Checked by the doctor, read from `apps/desktop-electron/scripts/verify/doctor.mjs` on `origin/dev` (2026-10-30):

| Item | Needed for | Fix the doctor prints |
|---|---|---|
| Node 20 or newer (the repo uses 24) | everything | install Node |
| A clone with an `origin` remote and `origin/dev` | comparing your branch | `git fetch origin` |
| Installed packages, including `axe-core` and the Electron binary | window checks | `npm --prefix apps/desktop-electron ci` |
| Rust stable, `rustfmt`, `clippy` | cargo checks | install with rustup, then `rustup component add rustfmt clippy` |
| `cargo-audit` | dependency audit | `cargo install cargo-audit --locked` |
| `cargo-mutants` | thorough tier only | `cargo install cargo-mutants --locked` |
| Built renderer and Electron shell | window checks | `npm --prefix apps/desktop-electron run build:all` |
| Built sidecar | optional; the tool builds it itself | saves the first wait only |
| `gh`, `k6`, Docker, Nuclei, `uvx` | optional; only promotion work and opt-in scans | install when needed |

## Steps

1. `git fetch origin`
2. `npm --prefix apps/desktop-electron ci`
3. `npm --prefix apps/desktop-electron run verify:doctor` and do each `fix:` line for an item marked `MISSING (required)`, then run it again until it says `READY for the fast tier`. The doctor changes nothing; it only prints commands.
4. Run `npm --prefix apps/desktop-electron run verify`. The first run builds the sidecar and is slow (see "How long it takes" in `README.md`).

One command per line; the shell on Samuel's PC is Windows PowerShell 5.1, which has no `&&`.

## The lock config: `~/.nv-verify.json`

Machine-specific settings never go in the repo. If a PC has its own lock scripts for builds and test windows, a file in the home folder points to them, with these keys (names read from `lib/lanes.mjs`):

- `cargoLock`: path to the cargo lock script
- `electronLock`: path to the one-window lock script

The environment variables `NV_CARGO_LOCK` and `NV_ELECTRON_LOCK` do the same and win over the file. `NV_BASH` names the bash that runs those scripts (on Windows the `bash` on PATH is sometimes Microsoft's WSL launcher). With none of these set, the tool uses its own built-in locks, so a new machine usually needs no file.

## What "NOT RUN" means

A check could not start or could not finish: a tool is missing, a build it needs did not pass, or a lock was not available. It counts as a failure and the run exits non-zero. It is not a pass and it is not skipped. Run the doctor, fix the gap, run again. Never edit a check, baseline or allow-list to get green. A failed or not-run check saves its full output; the result line names the file (the folder is `NV_VERIFY_LOG_DIR`).

## Per-machine tuning variables

Names read from the NeuralVault repo (`lib/profiles.mjs`, `lib/lanes.mjs`, `lib/timings.mjs`, `lib/status.mjs`, `run.mjs`, `doctor.mjs` and the overview doc on `origin/dev`). Any `NV_` variable you set wins over a profile and a check's default.

| Variable | Does |
|---|---|
| `NV_VERIFY_PROFILE` or `--profile low / normal / high` | Preset window counts. `low`: 2 shards, 2 jobs, normal look only. `high`: 8 and 8 |
| `NV_CLICKS_SHARDS`, `NV_CLICKS_JOBS` | Windows per look, and windows open at once |
| `NV_CLICKS_CELLS` | Which looks the click-through uses (for example `default;theme=light`) |
| `NV_CLICKS_CAP`, `NV_CLICKS_TARGET_MS` | Controls pressed per page and time target in the fast tier |
| `NV_FUZZ_SECONDS` | Length of parser fuzzing |
| `NV_MUTANTS_SHARD`, `NV_MUTANTS_TARGET` | Which mutation slice, and the folder it builds in |
| `NV_PROMOTE_LAG` | Commits behind before a promotion is "due" |
| `NV_VERIFY_PLAIN=1` | Turn the live bar off |
| `NV_VERIFY_STATUS` | Where the status file is written (default a temp-folder file) |
| `NV_VERIFY_TIMINGS` | Where measured times are kept (default `~/.nv-verify-timings.json`) |
| `NV_VERIFY_LOG_DIR` | Where full outputs of failed checks are saved |
| `CARGO_TARGET_DIR` | One shared Rust build folder (5 to 50 GB), not one per task |
| `NV_SYNC_URL`, `NV_SYNC_TOKEN` | Only the opt-in sync load test; the token is a secret and stays out of files |

The doctor also prints how many windows the machine will use at once from its cores and free memory.
