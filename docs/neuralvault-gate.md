# Gate use for NeuralVault

One page for running `meerkat verdict` on NeuralVault PRs. Commands are from the build on `m053-integration`. Run them from the Meerkat checkout, or use the installed `meerkat` once the next release is out.

## Which command for which PR

| PR | Command |
|---|---|
| Any PR | `meerkat verdict --base origin/dev --app <repo>` |
| Accept known failures | `meerkat verdict --base origin/dev --known <file> --app <repo>` |
| Stop at a time limit and continue later | `meerkat verdict ... --max-seconds 240`, then `--resume <file>` |
| Only the checks that failed last time | `meerkat verdict ... --rerun-failed` |
| Several branches at once | `meerkat verdict --branches a,b,c --app <repo>` |
| Machine-readable | `meerkat verdict ... --json` |

Rust PRs: `rust-test` and `rust-clippy` can run past the time limit. They then show as NOT RUN and the result is INCOMPLETE, not a pass. A scoped run that checks only the changed crates is not built yet.

## Known-file format

A JSON list. Each entry names a check and a file, and a line when you want to pin one place:

```json
[
  { "check": "rp-errors", "file": "apps/nv-sidecar/src/commands.rs", "line": 1744 },
  { "check": "unused-files", "file": "apps/desktop-electron/scripts/click-pages.cts" }
]
```

- `file` uses forward slashes and is relative to the repo root.
- `line` is optional. Without it, every place of that check in that file is known.
- A known place is removed from the blocking count and the printed list, and reported as `known: N place(s)`.
- An entry that matches nothing is printed as `STALE`. Remove it.
- A missing or malformed file is NO-RESULT, exit 2.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | PASS: no new blocking finding in changed files |
| 1 | FAIL: at least one new blocking finding in changed files |
| 2 | NO-RESULT or usage error: nothing was judged (bad flag, missing file, branch too far behind the base) |
| 75 | INCOMPLETE or WAITING: some checks did not finish; not a pass |

## Base too far behind

If the base is more than 20 commits ahead of the branch, the verdict returns NO-RESULT (exit 2). Rebase or merge the base first. `--allow-stale` accepts the old base and runs anyway; say so in the PR if you use it.

## Resume

A run that stops at its time limit prints a `--resume <file>` line. The resume file keeps the checks that finished. Checks that did not finish run again on resume, so a resume only helps if the slow check can now finish.

## Output files

- `<data folder>\verdicts\<repo>-<branch>.json` is written after every complete verdict. It holds the verdict, the blocking and known counts, the base, and a `checks` array. Read this file instead of parsing stdout.
- `--json` prints the same `checks` array: one row per check with `check`, `status`, `seconds`, `cached` and `places` (file and line).
- The data folder is `MEERKAT_LOG_DIR`, or `~/.meerkat` when that is not set.

## Timing

A verdict longer than 60 seconds prints the 15 slowest checks after the result. `--timings` prints them every time.

## Known limits

- Rust test runs are not scoped to changed crates, so a Rust PR can hit the time limit.
- The base comparison can take longer than the time limit on large repos.
- The count of checks shown on the progress lines and in the INCOMPLETE line can differ; the INCOMPLETE line is the total to trust.
