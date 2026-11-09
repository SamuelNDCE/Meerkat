# Batch gating (`meerkat batch`)

`meerkat batch` gates several branches with one gate run instead of one run per branch. Most gate time is fixed cost, so one run over a batch costs about the same as one run over a single small branch.

## Usage

```bash
meerkat batch --base origin/dev --app <repo> feature-a feature-b feature-c
```

Branches can be separated by commas or spaces. Options:

| Option | Meaning |
|---|---|
| `--base <ref>` | the base to compare against (default `main`, or `origin/dev` when given) |
| `--app <repo>` | the repository |
| `--dry-run` | print the plan (what would merge, what is excluded) and run nothing |
| `--max-lines <n>` | size cap per batch in changed lines (default 3000) |
| `--max-prs <n>` | cap on branches per batch (default 15) |
| `--json` | print the result as JSON |

Environment: `MEERKAT_BATCH_MAX_RUNS` caps the gate runs in one batch (default 12). The result file goes under the Meerkat data folder (`MEERKAT_LOG_DIR`, or `~/.meerkat`).

## What it does

1. Merges each branch, in order, into a temporary checkout of the base. A branch that conflicts is excluded and named.
2. Runs one gate over the union of the merged changes.
3. If the batch passes, every included branch is `PASS`.
4. If the batch fails, finds the culprit: it re-runs only the failing check, once per branch, on that branch alone. A branch whose failing check reproduces alone is `BLOCKED`, with the file and line.
5. Compares each failing check with the base. A check that also fails on the base is reported as pre-existing, not the branch's fault.
6. Re-gates the batch without the culprit. Branches that pass are `MERGEABLE`.

## Results and exit codes

Each branch gets one status: `PASS`, `BLOCKED`, `MERGEABLE`, `EXCLUDED` (conflict, not found, too big, or over the PR cap), `INCOMPLETE`, or `STALE` (its head moved during the run).

| Exit | Meaning |
|---|---|
| 0 | every included branch is `PASS` or `MERGEABLE` |
| 1 | at least one branch is `BLOCKED` |
| 75 | incomplete, refused, or nothing could be judged. Never a pass. |

A dry run that refuses any branch also exits 75.

Every real run writes `batches/<batch-id>.json` and a `batches/<repo>/latest.json` copy. The file includes a `timing` object (`gateSeconds`, `totalSeconds`) so batch sizes can be compared.

## Progress and waits

The gate's progress lines are shown with a `[batch gate]` prefix, including any wait for the cargo lock. A batch that appears idle is waiting on something; the lock line says what and for how long.

## Fail-safes

- Unknown, skipped, timed-out or unfinished results are `INCOMPLETE` (75), never `PASS`.
- A branch whose head moves during the run is `STALE` and excluded from the result.
- The culprit rebuild is always re-gated; a batch is never merged without a fresh gate result.
- At most one culprit search per batch, and the total runs are capped.
- If the base itself fails the same check, the run stops with `DEV-RED` and no branch is blamed.
- A result file that cannot be written makes the exit non-zero.

## Limits

- The dev-baseline store (`lib/devbaseline.mjs`) keeps results per base commit; a new base commit is checked again.
- A batch whose culprit search reaches the run cap (default 12) returns 75 with the cap named in its status line; it is never read as a pass. Raise `MEERKAT_BATCH_MAX_RUNS` to allow more.
- There is no minimum batch size yet; small branches are batched only when you name them together.
- The cargo lock is still taken when a changed file matches a Rust check's path filter. A toolchain pin (`rust-toolchain.toml`) matches it on purpose.
