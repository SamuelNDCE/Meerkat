# Meerkat improvements backlog

One table of every improvement asked for by the sessions that use Meerkat, with its status. The detail and the reasons are in docs/issues.md (sections 25 to 29). Update this table in the same commit as the change it describes.

Legend: OK done and merged; PARTIAL part of it done, the rest open; PLANNED asked for, not built; HELD waiting on a decision; OTHER lives in another repo or session.

| Item | What is wanted | Source | Status |
|---|---|---|---|
| 25b, 25g | One blocking count for exit code, printed line and summary.json | gate reports | OK |
| 25i | Failures outside the change labelled as such | gate reports | OK |
| 25j | Project-wide sub-check counted as blocking (likely rp-async) | promotion run | PARTIAL (not confirmed) |
| 25k | A printed log folder always exists | gate reports | PARTIAL (second half open) |
| 25h | Repo-layout facts (tsconfig, rimraf, vsce) reported as failures | sidebar and sync runs | PLANNED |
| 25l | Queue gate writes a summary; queue stops pushing others' branches | queue run | OTHER (NeuralVault queue) |
| 26a | Gate on a worktree folder never hangs without a verdict | NV session | PARTIAL (scope named; hang not reproduced) |
| 26b | npx segfault in the guard step | queue run | OTHER (NeuralVault scripts) |
| 26d | A check that dies or exits 0 without a result is a crash | gate reports | OK (test runners only, opt-in) |
| 27a | Full gate on a checkout does not stall silently | NV session | HELD (Samuel's repro go) |
| 27b | binary-in-history honours ignorePaths and .meerkatignore | NV session | OK |
| 27b | links check honours ignore keys; root-relative links | NV session | PLANNED |
| 28a | Run limit covers the base comparison; heartbeat per stage | NV session | PARTIAL (git calls without timeouts) |
| 28c | Summary names each blocking finding and its base side | NV session | OK |
| 28d | Long Rust step names itself on a cut-off | NV session | PARTIAL |
| 28e | A timeout is FAIL, not NOT RUN | promotion run | OK |
| 28f | Rust tests per touched crate; full workspace opt-in | promotion run | OK |
| 28g | Compile check and clippy before tests | promotion run | OK |
| 28h | NOT RUN exit code, and status codes as exit codes | Website, NV | HELD (Samuel to decide) |
| 29b | Summary failed count, failed list and blocking agree | 4173 run | PARTIAL (fixed on the branch; the 4173 run predates it; re-check on a current build) |
| 29c | A cap-stopped run writes a reason | NV session | OK |
| 29d | Click-through steps assert the final url and title | UI and product sessions | OK (on roadmap-orchestration; exact match only) |
| 29e | Spawned tools run from a clean folder | TikTok session | PLANNED |
| 29h | Cargo lane wait reported as WAITING with seconds | product session | OK (on roadmap-orchestration; cargo-lock wording not verified) |
| 29i | Failure on an unchanged file labelled outside the change | 4173 run | PARTIAL (fixed on the branch; no base label seen in the 4173 run; re-check) |
| 29j | "No check covers" names the files and checks considered | product session | PLANNED |
| 29k | A stopped gate writes a reason and the last finished check | product session | PARTIAL (orphan seal done; last check open) |
| 29g, 29l | Junction: a gate on a worktree with a node_modules junction is documented or detected in the summary | product session | PLANNED |
| 29m | Progress line during long runs even when nothing else printed | product session | OK (merged locally; not in a release) |
| 29n | blockingFindings kept in every summary (regression test) | product session | PLANNED (feature OK) |
| 29r | onBase is always present on each blocking finding, never missing | product session | PLANNED |
| 29s | 738 killed-from-outside gate: sealed summary with a reason (orphan seal) | product session | OK (orphan seal); last finished check open under 29k |
| 29o | Gate by git ref without a checkout; name folder and ref | merge-and-verify | PLANNED (top request, per the merge session) |
| 29p | Not-yet-wired files marker; new versus pre-existing blocking | Website session | PLANNED |
| 29q | One failed count per run; sub-checks labelled apart | merge-and-verify | PARTIAL (count fixed on the branch; the base-diff scope under a base is not reproduced) |
| 22d | Progress printed only on change | gate reports | PARTIAL (on an unmerged branch) |
| gate lifecycle | Child reaping and run ids (gateproc) | earlier work | PARTIAL (on an unmerged branch) |
| batch split | Per-branch verdicts from one union gate | NV session | PARTIAL (on roadmap-orchestration; not in the 0.5.4 release, so NV cannot use --split yet) |
| 29t | Batch exit 3 names each branch and reason | merge-and-verify | OK (on roadmap-orchestration) |
| 29u | Batch at its limit writes a partial verdict per branch | merge-and-verify | PARTIAL (split run limit covered; time-limit kill is not) |
| runs prune | Retention for the run store, dry run by default | early request | OK |
| worktrees report and prune | Verdicts; prune only clean merged and prunable | early request | OK |
| ps and stop | Live runs; stop one run's process tree | early request | OK |
| space and worktrees new | One overview; owner and purpose for new worktrees | early request | OK |
| orphan seal | Runs killed from outside get a sealed summary | product session | OK |
| 29y | Lane wait shows the holder pid, age, command and queue position | merge-and-verify | PLANNED |
| 29z | Re-gate after a base move, cached by head SHA, base SHA and version | merge-and-verify | PLANNED |
| 29aa | Stacked PRs: gate the chain, or a one-command stack merge | merge-and-verify | PLANNED |
| 29ab | Conflict check as a verdict before any gate time (meerkat merge-check) | merge-and-verify | OK (merged locally; not in a release) |
| 29ac | Test filter that matches no tests is reported, not a silent pass | merge-and-verify | OK (merged locally; not in a release) |
