# Real-code benchmark for the Rust rules

The accuracy corpus (`tools/accuracy-corpus.mjs`) is built from each rule's own samples, so it cannot show false alarms on real code. This benchmark can: it runs the six rust-plus checks (`rp-safety`, `rp-errors`, `rp-async`, `rp-perf-style`, `rp-cargo`, `rp-api-ffi-wasm`) on a real Rust project and compares what they report with findings that a person has labelled TRUE (a real instance of what the rule says) or FALSE (a false alarm).

## Files

| File | What it is |
|---|---|
| `measure.mjs` | Runs the checks on a Rust tree and reports precision. Exits 1 if precision is below the baseline. |
| `labels.json` | One entry per labelled finding: `rule`, `check`, `file` (relative to the project), `line`, `message`, `label` (`TRUE` or `FALSE`), `reason`. |
| `baseline.json` | The precision the labels gave when the baseline was written, per rule too, and a digest of the Rust tree it was made on. |
| `known-findings.txt` | A short hash of every finding the baseline run reported, so a later run can tell which findings are new. |

The labels are a seeded random sample of the findings that are hidden by default (the pedantic rules, shown with `MEERKAT_FINDINGS=all`) in a copy of the NeuralVault project, 387 findings over 48 rules. Labels are tied to exact files and lines, so they only apply to the snapshot they were made on. `baseline.json` stores a digest of that snapshot; a run on a different tree prints a NOTE and only matches labels whose lines did not move.

The per-finding assignment inside rules that have both TRUE and FALSE labels was reconstructed in November 2026 from the recorded per-rule TRUE and FALSE counts of the first real-code review and a re-read of the lines. The reasons are one sentence each.

## Run it

Build the read-only copy once (Rust and Cargo files of `apps/`, `packages/` and `tools/`, without `target/` and `.worktrees/`):

```
node benchmarks/real-rust/measure.mjs --copy-from <project folder> <tree folder>
```

The tree folder comes from the argument, then the `MEERKAT_REALBENCH_TREE` environment variable, then `meerkat-real-rust-tree` in the system temp folder. If the tree does not exist and `MEERKAT_REALBENCH_SOURCE` names a project folder, the copy is built from it. The copy must not be inside the project or inside this repository. Nothing here contains a machine path.

Then measure (about 30 seconds):

```
node benchmarks/real-rust/measure.mjs <tree folder>
```

It prints the number of findings, how many labelled findings are still reported (TRUE and FALSE), the precision `TRUE / (TRUE + FALSE)` with the baseline beside it, the count of new unlabelled findings, and the precision per rule. Add `--json` for a machine-readable result.

Exit codes: 0 precision at or above the baseline, 1 precision below the baseline, 2 a usage or setup error. `--strict` also fails when a labelled TRUE finding is no longer reported, or when there is a new unlabelled finding.

## Reading the numbers

- Precision counts only labelled findings that the current run still reports. A fix that removes false alarms raises it; a fix that removes only true findings lowers it.
- Labelled findings that disappear are listed as "lost" (TRUE and FALSE separately). Losing FALSE ones is the goal. Losing TRUE ones means the fix may have gone too far.
- Unlabelled findings are everything the sample never covered. "New unlabelled" means findings that are neither labelled nor in `known-findings.txt`. They do not count until they are labelled.

## Add labels

1. Run with `--json` and take the new findings' rule, file and line, or read them from the text output.
2. Open each one in the project copy and read the code around it. Decide TRUE (the rule's claim is right here) or FALSE (it is a false alarm, for example test code, a deliberate discard, or the rule misreading the code).
3. Add an entry to `labels.json` with the same fields as the others and a one-sentence `reason`. A rule, file and line may appear only once.
4. Re-run. When the labels are final, and the change is meant to move the baseline, run with `--write-baseline` and commit `labels.json`, `baseline.json` and `known-findings.txt` together.

## Use it as a gate

Run `node benchmarks/real-rust/measure.mjs <tree folder>` after each change to a Rust rule. A change must not lower precision. When it raises precision on purpose, write a new baseline in the same pull request and say so in the changelog notes.

## Rules promoted to the default run, and what they still get wrong

All 79 pedantic Rust rules that have a labelled sample are in the default run (`PROMOTED_RUST_RULES` in `lib/rollup.mjs`). In the November 2026 narrowing pass the labelled false alarms fell from 20 to 6 of 130 labelled findings (4.6%) with no labelled TRUE finding lost. The six that remain cannot be removed without losing a labelled TRUE finding of the same shape:

| Rule | Remaining false alarm | Why it stays |
|---|---|---|
| `rerr-len-narrowing-cast` | `.count() as u32` on an in-memory filter | a labelled TRUE has the same `.count() as u32` shape (`fs_tools/diff.rs`) |
| `rerr-unit-error-type` | private fn whose doc says `Err` means no answer | labelled TRUEs are private fns with the same doc line |
| `rerr-error-no-display` | serialized wire enum | a labelled TRUE is a serialized enum too |
| `rasync-global-mutable-state` | a cache in a `OnceLock<Mutex<..>>` | every labelled TRUE is the same static shape |
| `rerr-lock-unwrap-poison` | `live.lock().unwrap().clone()` | no labelled TRUE to separate it from |
| `rperf-vec-new-in-loop` | per-root dedup `Vec` that is only `contains`/`push`ed | a labelled TRUE (`emitted`) has the same shape |
