# Meerkat improvements plan

Planning only. Nothing here is being built yet. Each open item from docs/improvements-backlog.md has a goal, the approach, the files it touches, the tests that must pass, the risks, and a place in the order. Status lives in the backlog table; this file says how each item will be done.

Order: items that unblock others first, then the gate-correctness items, then the rest. Each item is one change, reviewed, tested file by file, then merged.

## Wave 1: gate correctness (blocks trust in every verdict)

1. **29q, one failed count per run; base-diff scope under a base.**
   - Goal: the summary text, counts.fail, the FAIL result rows and the tool headline give the same number; a gate given a base runs only over the base diff.
   - Approach: derive every count from one function over the final rows (as syncRunSummary does for blocking); count sub-checks separately; for a base, pass the diff to the scope step before running checks.
   - Files: lib/gate.mjs (countsLine, syncRunSummary, scopeToChanged), lib/runlog.mjs, lib/gate-output.mjs, the MCP headline.
   - Tests: a new file with a fixture where the four counts would differ; a base run that must not touch unchanged files.
   - Risks: changing the headline text breaks tests that match it; update only the assertions that check the text, and report each one.

2. **29n and 29r, onBase always present; a regression test for blockingFindings.**
   - Goal: every blocking finding carries onBase (true, false or null), and summary.json always has blockingFindings.
   - Approach: set onBase on every entry in blockingFindingsOf; add a test that fails if the field is missing.
   - Files: lib/gate.mjs, tests/summary-names-blocking.test.ts.
   - Risks: onBase true is never written today (a blocker also on base is hidden); document that rather than change the comparison.

3. **29j and 29k, "no check covers" names what was considered; a stopped gate records the last finished check.**
   - Goal: an empty run says which files and checks it considered; a stopped run's summary names the last check it finished.
   - Approach: the no-check result lists the changed files and the checks the selection rejected, with the reason; the orphan seal and the cap reason add lastFinished from the per-check logs.
   - Files: lib/gate.mjs (no-check result), lib/orphanseal.mjs, lib/runlog.mjs.
   - Tests: a fixture with no matching check; a stopped run with three finished checks.

4. **25j, confirm the project-wide blocker (rp-async).**
   - Goal: say which finding blocks, and whether it is in the diff.
   - Approach: a read-only reproduction on a NeuralVault run folder (use the product session's folder, not a new heavy run); if confirmed, the change is the scope rule in 29q.
   - Files: none until confirmed.

## Wave 2: gate usability

5. **29o, gate by git ref without a checkout (top request).**
   - Goal: gate a sha, branch or PR number directly; print the ref and folder checked; name the allowed root in any refusal.
   - Approach: resolve the ref to a temporary detached worktree under the gate's own folder, run the gate there, and remove it afterwards (never a user's checkout); remove it in a finally block; the worktree report must not treat it as user work.
   - Files: lib/gate.mjs entry, lib/worktreeowner.mjs (record it as a gate worktree), the MCP tool.
   - Tests: gate a ref in a temp repo with no checkout; a refusal names the root.
   - Risks: leaked temporary worktrees; cleanup must run in a finally block.

6. **29p, not-yet-wired marker and a new-versus-pre-existing blocking split.**
   - Goal: a staged file can say it is not yet wired (the unused-files check then reports it as not applicable, not a failure); blocking is printed as new and pre-existing.
   - Approach: a marker line the unused-files check reads; in the printed line and summary, split blocking by whether the finding's file is in the change.
   - Files: packs (unused-files check), lib/gate.mjs (printed line, summary).
   - Risks: a marker must not silence a real problem; the check still reports a wired-but-unused file.

7. **29m and 22d, a progress line during long runs; print on change.**
   - Goal: a stall is visible; progress is not spammy.
   - Approach: merge the gateout2 branch (22d is there); add a periodic line every few minutes even when nothing changed.
   - Files: lib/gate.mjs, lib/runprogress.mjs.
   - Tests: an injected clock test.

8. **gateproc and gateout2 merge.**
   - Goal: the two unmerged gate branches land cleanly.
   - Approach: merge each into roadmap-orchestration, resolve conflicts, run their tests file by file.
   - Risks: they touch lib/gate.mjs, which wave 1 also changes. Do this after wave 1.

## Wave 3: environment and tool robustness

9. **29g and 29l, a worktree with a node_modules junction.**
   - Goal: documented, and detected in the summary (the junction and the tool versions it resolves to).
   - Approach: detect a junction in the gate's environment check and record it in the summary; document it in the README.
   - Files: lib/gate.mjs (environment), docs.

10. **29e, spawned tools run from a clean folder.**
    - Goal: no spawn of a user tool from a shared folder picks up a stray file.
    - Approach: audit each spawn in lib/ for its working directory; run tools with a clean working folder where they accept one; report the rest.
    - Tests: a fixture folder with a file named like a stdlib module.

11. **29h, a Rust lane wait reported as WAITING with seconds.**
    - Goal: a wait on the cargo lane is not a failure.
    - Approach: the lane wait already exists (cargo-lock); report it as WAITING with the seconds waited, and do not count it as a failure.
    - Files: packs/rust, lib/runner.mjs.

12. **28a remainder, git calls without timeouts.**
    - Goal: no silent hang in gateFiles, touchedLines, filesInTree and commitsBehind.
    - Approach: pass a timeout to each spawnSync; on timeout the step reports NOT RUN with the reason.
    - Tests: a fake git that sleeps.

13. **29d, click-through step asserts final URL and title.**
    - Goal: a step fails on a URL or title mismatch.
    - Approach: extend the scenario step contract in lib/clickthrough.mjs with expect.url and expect.title; the driver reports both.
    - Files: lib/clickthrough.mjs, docs/click-through.md.

14. **29t and 29u, batch exit 3 reasons; a partial verdict per branch at the limit.**
    - Goal: exit 3 names each branch and reason; a batch cut off by its limit writes what it has.
    - Approach: collect per-branch refusal reasons in lib/batch.mjs; write the partial summary before exit.
    - Tests: a 13-branch fixture with a conflicting branch.

15. **26d second half, a generic result marker.**
    - Goal: a check that exits 0 with no result is a crash for every check that should print one.
    - Approach: a per-check "expects a result" marker, set on checks known to print one; the opt-in test-runner rule (merged) becomes the first set.
    - Files: lib/runner.mjs, packs.
    - Risks: silent-success checks must not be flagged; each marker is reviewed one check at a time.

16. **26a, the hang on a worktree folder.**
    - Goal: reproduce on NeuralVault with the exact call (the product session holds the repro); if it is the MCP wrapper, the wrapper streams progress.
    - Approach: no code until the repro exists.
    - Status: held for the repro go.

## Held: decisions or go-aheads needed

- **27a**, full-gate repro on a fresh checkout: needs your go, because it loads the machine.
- **28h**, exit code when a check is NOT RUN with nothing blocking: needs your answer on whether you meant the printed status codes or real exit codes. Real exit codes are 0 to 255, so the HTTP-style codes cannot be exit codes as written.
- **Release**: the merged work on roadmap-orchestration is not in the installed release. Cutting a release is a human decision; the draft PR into main (ownerNDCE/Meerkat#107) is open for review.
- **Other repos**: 25l and 26b are NeuralVault's queue and scripts, owned by its session.

## Out of scope for Meerkat

- **29f**, a GPU device check in the TikTok session's transcription tooling: recorded for reference only.
