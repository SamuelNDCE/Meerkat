# Open issues and fix plans

Planning only. Nothing here is built yet. Each entry says what is wrong, the plan (checked against the code by reading it), the test that proves the fix, and any decision a person must make first. Status: PLANNED (plan written), NEEDS DECISION (cannot build until a person decides), BUILD (small, ready).

## Summary

| # | Issue | Status | Who decides |
|---|---|---|---|
| 1 | Suppressed findings are invisible in the gate summary | BUILD | none |
| 2 | Count drift can reach a release (no counts step in the release gate) | BUILD, needs generator check mode | none |
| 3 | speed-065 heartbeat test flakes under parallel load | PLANNED | none |
| 4 | Worktree folders are not protected by claims (a NeuralVault collision) | PLANNED, needs 2 decisions | Samuel |
| 5 | Plan file and `plan check` / `plan brief` (orchestration R1 and R2) | PLANNED, needs 6 decisions | Samuel |
| 6 | Auto-added pack NOT RUN exit code (gate exits 0) | NEEDS DECISION | Samuel |
| 7 | Electron fuse check: expected value per project | NEEDS DECISION | Samuel |
| 8 | Batch fix (8502f4a) not in a released version | NEEDS DECISION | Samuel |
| 9 | Plume `.catch` false positive | NEEDS REPRO | Plume |

## 1. Suppressed findings are invisible

**Problem.** A finding suppressed by an inline `// meerkat-ignore <check> <reason>` is dropped with no count, so a reader cannot see that anything was suppressed.

**Plan (verified by reading `lib/findingsdoc.mjs`, around line 223).**
1. In `findingsdoc.mjs`, count suppressed findings (a counter, not the existing Set of check names) and expose it on the doc.
2. In `lib/gate.mjs`, where the findings doc reaches the run output, copy the count onto `out.suppressed`. Check that path first; it was inferred, not confirmed.
3. In `compactGateText` (`lib/gate.mjs`, around line 636), append `, N suppressed by meerkat-ignore` to the first line when N > 0.

**Test.** Add to `tests/meerkatignore.test.ts` (or `lib/inline-ignore.test.ts`): a fixture with one suppressed finding asserts the count and the wording.

## 2. Count drift can reach a release

**Problem.** The README, `docs/checks.md`, `docs/coverage.md` and the badges can drift from the real counts. This happened in 0.5.4 (403 vs 404). The release gate does not check it.

**Plan.**
1. Add a check-only mode to the generators (`tools/gen-checks.mjs`, `tools/gen-coverage.mjs`, `tools/make-badges.mjs`) that compares instead of writing. Today they have no such flag (inferred from reading the tools; confirm before building). Without it, a gate run would dirty the tree.
2. Add a `counts` step to `tools/release/gate.mjs`, after `pack-list`. It runs the check-only generators and `tests/count-audit.test.ts -t "generated documents"` (the fast document-only tests). It skips the slow sub-check tests.
3. Export the step's exit mapping as a pure function so a unit test covers it.

**Test.** A unit test for the counts step's exit mapping (0 when current, 1 when a document drifts, 75 when a generator cannot run).

## 3. speed-065 heartbeat test flakes under load

**Problem.** "a sleeping check is named in a heartbeat within 6 seconds" in `tests/speed-065.test.ts` fails when several test files run in parallel, and passes alone. This is a timing flake, not a verified bug. The fix should not just raise the limit.

**Plan (test-only; the limit is not raised).** The heartbeat ticks every 5000 ms on a grid anchored to gate start (`lib/gate.mjs`, HEARTBEAT_MS, overridable by MEERKAT_GATE_HEARTBEAT_MS). A check that starts just after a tick is first named up to 5 s later, which leaves about 1 s of slack against the 6 s assertion. The fix: set MEERKAT_GATE_HEARTBEAT_MS explicitly in the test, derive the deadline from it (beat interval plus 2 s), assert a "running: sleepy" beat appears before the "[done ... sleepy" line, and add a second test with a 500 ms beat and a 1500 ms deadline. Verified: the code constants. Inferred: the cause (not reproduced under load). Prove it by running the file alongside another file.

## 4. Worktree folders are not protected by claims

**Problem.** A NeuralVault agent removed another session's worktree folder. The collision was reported by Neural Vault.

**Findings (verified by reading the code).**
- `worktrees close` (`lib/claims.mjs`, around lines 275 to 298) checks only main, missing, dirty and merged (`closeProblem` in `lib/worktrees.mjs`, lines 80 to 87). It never reads live claims. It then removes the worktree and deletes that worktree's claims, so it silently erases another owner's claim.
- `tools/worktrees.mjs` (line 52) has its own `git worktree remove` close with no claim check. This is the likely path an agent would use.
- The temp-tree deletions in `lib/batch.mjs`, `lib/branchcmds.mjs`, `lib/brief.mjs` and `lib/gate.mjs` remove only the folders they created. Low risk, but `worktree prune` runs repo-wide.
- Claims store `owner` as free text (`--by` or `MEERKAT_CLAIM_BY`), with no pid or session id. The only staleness is the 4-hour TTL.

**Plan, in phases.**
1. A shared guard `claimProblem(worktree, liveClaims, by)` in `lib/claims.mjs`. It refuses when a live claim names the worktree folder or a path inside it. Call it from `worktrees close` before removal. Refuse unless `--force-claimed --by <owner>` matches the claim's owner.
2. Record the worktree folder as an implicit claimed path when a claim is made inside it.
3. Apply the same guard in `tools/worktrees.mjs` close.
4. Stale policy: keep the TTL, but treat an expired claim as advisory: warn, name the old holder, and refuse for a grace period (for example one hour) after expiry.
5. Never fall back to `rmSync` after git refuses to remove a folder (Windows junctions into `node_modules`, and locked folders).

**Tests.** `claimed worktree survives close` (exit 1, folder and claim intact); `own claim with --force-claimed removes it`; `expired claim is advisory within the grace period`; `a path inside the folder counts as a claim`; `tools/worktrees.mjs close refuses a claimed worktree`.

**Decisions for Samuel.** (a) Stale policy: a grace period, or record a pid for a liveness check. (b) Whether `--force-claimed` should exist at all. (c) Whether a claim on a path inside a worktree protects the whole folder.

## 5. Plan file, `plan check` and `plan brief` (roadmap R1 and R2)

**Plan (design read from the code, not built).**
- Plan file: JSON, `version: 1`. Each task has `id`, `goal`, `owns` (at least one path), `done` (a shell command), `timeMinutes` and `maxTurns`. Optional: `dependsOn`, `gate` (default `quick`), `notes`. Top level: `name`, `base`.
- `plan check` rules, all errors listed in one pass. Unknown field, wrong type, duplicate id, unknown `dependsOn` id, invalid JSON: exit 2. Missing `done`, `timeMinutes` or `maxTurns`: exit 1. Cycle: exit 1. Ownership overlap (using `normalizePath` and `overlaps` from `lib/claims.mjs`): exit 1. Zero tasks or missing file: exit 3. Clean: exit 0. Only the existing exit codes are used.
- `plan brief <file> <task-id>`: sections in fixed order (goal, dependencies, owned files, done when, gate, limits, report format). Fixed sections are never cut. Default size limit 4000 characters (inferred; a human sets it).
- Code: new `lib/plan.mjs` and `lib/planbrief.mjs`. Register the word in `lib/extras-words.mjs` and `lib/cli.mjs`, dispatch beside the `claim` branch in `lib/extras-cli.mjs` (around line 181), add a help entry in `lib/help.mjs`, and keep `docs/commands.md` in step. `lib/brief.mjs` already exists for files, so the plan brief needs its own module.

**Phases and tests.** P1 schema (`tests/plan-schema.test.ts`); P2 cycles (`tests/plan-cycles.test.ts`); P3 ownership overlap, including a directory prefix and `a-b` not overlapping `a` (`tests/plan-ownership.test.ts`); P4 rule, exit codes and `--json` (`tests/plan-check-cli.test.ts`); P5 brief sections and size cap (`tests/plan-brief.test.ts`); P6 help and docs truth (`lib/help.test.ts`).

**Decisions for Samuel.** (a) JSON only, or markdown too. (b) Missing `done` or limits: FAIL (1) or USAGE (2). (c) Whether tasks linked by `dependsOn` may share files. (d) How a worktree folder is detected, and whether `plan check` also consults live claims. (e) Brief size limit and what is cut first. (f) Whether `done` is a shell string or an argument list (it runs later in R3, so this is a security question). (g) Default time and turn limits, and whether the 25-minute cap is a hard maximum. (h) `plan brief` with no task id: print all, or require one.

## 6. Auto-added pack NOT RUN exit code

**Problem.** A check from a pack the gate added on its own (for example electron-plus on an Electron project) that cannot run (no trust, no build, no tool) is shown as "not configured" and the gate exits 0.

**Decision for Samuel.** Should such a NOT RUN exit 1? The summary now names the count and `--verbose` lists the checks.

## 7. Electron fuse check: expected value per project

**Problem.** `ep-fuses-binary` treats GrantFileProtocolExtraPrivileges "off" as secure. Electron packaged apps need it on to load a page. Plume dismissed the finding with a reason, which works, but there is no per-project expected value.

**Decision for Samuel.** Build a per-project expected value (documented, with a reason), or keep dismissal as the path.

## 8. Batch fix not in a released version

**Problem.** The batch dry-run fix (8502f4a) is on `release-0.5.4` but not in 0.5.4, which is already published.

**Decision for Samuel.** Ship it in a patch release (0.5.5), or wait for the next version.

## 9. Plume `.catch` false positive

**Problem.** Plume reported that `js-missing-await` and unhandled-promise still fire on handled calls. No repro exists on current main.

**Needed.** A repro from Plume: the file, the line, and the rule that fires.

## 10. Neural Vault feedback on Meerkat (from their sub-agents)

Received after the 0.5.4 release. Status of each item, checked on release-0.5.4 at 8502f4a.

- **10a. Verdict first line.** Asked: first line is the answer and the file counts, with no note line first. Status: the 0.5.4 order already puts the answer first and the note after. Needs a sample line from them to confirm.
- **10b. Gate FAIL line for a cut-off Rust test says "cargo:nv-agents" with no reason.** Status: OPEN, a real gap. Plan: the FAIL line carries the reason the check was cut off (time limit, lock wait, or compile error), taken from the check's own result. Test: a check cut by the time limit shows its reason on the FAIL line.
- **10c. Batch line limit and exclusion text should match the help.** Status: already matches on 8502f4a (help and code both 3000; the exclusion text names the limit). Needs their build to be checked; they may be on an older build.
- **10d. Trust for a non-interactive shell.** Status: the flag already exists: `meerkat trust <folder> --yes` approves that folder's commands block and prints it. Decision for Samuel: automating this removes the human check the trust gate exists for. Whether a sub-agent may run it is his call, not a code change.
- **10e. Verdict text slower than JSON on large staged changes.** Status: OPEN, not reproduced on large input. Plan: measure on their staged change, sizes and seconds, then profile the text path against the JSON path. Waiting for their numbers.

### Neural Vault answers (received after the 10a to 10e entries above)

- **10a, closed.** Neural Vault sent a sample first line from 37c827f: the answer comes first ("PASS (status 200): nothing new blocks; ... judged 2 changed file(s); 1 matched no check. Next: nothing to fix"). The order is as they want.
- **10c, closed.** Neural Vault is on the newer batch build, so the mismatch they reported is resolved.
- **10d, closed for Meerkat.** Neural Vault's agents will not run `meerkat trust`; approval stays with Samuel.
- **10e, still open, no repro.** At 37c827f a 16,119-byte markdown file plus the config (about 16 KB) runs 6 s text and 7 s JSON, so no gap at that size. The 137 s gap was on release-rc2. A larger staged change is needed to test the text path; Neural Vault will build one and send lines and seconds.

## 11. False positives from `meerkat verify` on a large tree (reported by Neural Vault)

Eight findings on tools/, scripts/, .github/ and docs/ that Neural Vault checked and judged wrong. Grouped by the rule that needs narrowing. Each is a rule scope or precision fix, not a suppression, unless noted.

| # | Rule | Location | Why it is wrong | Planned fix |
|---|---|---|---|---|
| 11a | weak-crypto-modes | tools/loadtest/sync-load.js:44 | Math.random picks a request type in a load test; it makes no token or secret | Flag only when the random value flows into a name that is a token, secret, key, nonce or password. Test: a load-test random choice is not flagged; a random token is. |
| 11b | empty-catch | tools/gate/changelog-fix-v2.py:218 | Best-effort rmdir of a temp dir that may be non-empty; ignoring OSError is intended | Allow an empty handler that has a comment saying why, or a specific expected exception. Test: a commented best-effort handler passes; a bare one still fails. |
| 11c | js-unhandled-promise | tools/claude-code-bridge.mjs:303 | Line 303 is inside listen(), a Promise wrapper. The only async main() (line 321) already has .catch | The rule must follow the call, not the line. Test: a call inside a function that returns a promise and is awaited or chained is not flagged. |
| 11d | json-parse-in-loop | tools/generate-notices.mjs:175 | One package.json per directory is parsed each iteration, inside try/catch; nothing to hoist | Flag only when the parsed input is the same across iterations. Test: distinct inputs per iteration pass. |
| 11e | skipped-tests | scripts/test_progress_report.py:246 | A conditional skip with a stated reason (missing tz database) | Do not flag a conditional skip that carries a reason argument. Test: skipUnless with a reason passes; a bare skip still fails. |
| 11f | shell-hygiene | tools/gate/queue-prs.sh | The script continues past a failing PR on purpose and guards its cd with `|| exit 1`; set -e would break the queue | Judgement, not a clear bug. Plan: the rule accepts a script that guards critical steps explicitly, or Neural Vault adds an ignore with a reason. Samuel decides which. |
| 11g | inline-event-handlers | docs/design/mockups/earlier/2026-09-16-settings-redesign-mockup-v3.html:288 | A static design mockup in docs, never served as a product page | Exclude docs/ from web-security rules by default, or let a path rule be set in meerkat.config.json. Decision: the default scope. |
| 11h | robots-sitemap | docs/codemap/index.html | Generated internal docs, not a public site | Same as 11g: docs/ is not a public site. |

**Also reported, a real bug.** `meerkat gate --base origin/dev` on a clean detached worktree prints "nothing changed" when the branch has changes against the base. Neural Vault used `verify` as a workaround. Plan: reproduce on a detached worktree, find where the changed-file list comes from (it likely reads the current branch, not the detached HEAD), and add a test with a detached HEAD. Priority: high, because it makes the gate silently pass.

**Also reported, environment.** Logs were not saved because `C:\Users\Futur\.meerkat\logs` was not writable on their machine. Plan: a NOT RECORDED line already exists (0.5.4); check that it names the folder and the fix.

**Decision for Samuel.** Default scope for docs/ and tools/ under web-security rules (11g, 11h), and whether 11f gets an explicit guard rule or an ignore.

### 11 (second batch) and the no-change gate report

Twelve more verify findings from Neural Vault's dev tree, grouped by rule. Each is a rule-precision fix; none is a suppression.

- **wh-html and iframe-title** (PreviewPage.tsx:42): the rule read a header comment, not the tag. Plan: skip comments; read the whole tag before judging; wh-html only when srcdoc is built from variables.
- **js-find-undefined** (gate-promote.mjs:675): the value comes from the same `find` that a guard already checked. Plan: accept a truthiness guard on a value derived from the same find.
- **js-missing-await** (pr-template-check.mjs:326): a top-level `main()` at a script's entry. Plan: a rule for a script's own entry point, or an annotated accept. Decision for Samuel.
- **js-prototype-pollution** (verify-code-mode.cts:389): the keys come from an allow-listed process.env, not attacker JSON. Plan: accept a copy from a fixed allow-list. Judgement.
- **js-unhandled-promise** (main.cts:878): every awaited step inside handles its own errors. Plan: follow the handling inside the chain, not only the top call.
- **cp-rust** (shell_isolation.rs:976): `mem::forget` is the intended hand-over after ownership moved to `child`. Plan: accept mem::forget with a comment that says ownership moved, or use an explicit owner type.
- **rp-safety** (failure.rs:54): set_var at argument parsing, edition below 2024. Judgement; low risk.
- **weak-crypto-modes** (sync-load.js:44): the same rule as 11a above.
- **pii-patterns-in-source** (api.ts:3365): Google's public holiday calendar id. Plan: an allow entry for known public ids.
- **electron-open-external** (files.cts:669): a mailto from a compile-time constant. Plan: the rule follows the value's origin.
- **ep-window** (verify-*.cts, shoot-*.cts): dev-only scripts that run fixed scripts in their own test window. Plan: exclude verifier and shoot scripts by path, or annotate.

**The no-change gate report (not a new bug on this branch).** On roadmap-orchestration, `gate --base main` on a branch with no diff prints `NO-RESULT (status 204)` on line 1 and exits 3. The released v0.5.4 has the same mapping (`lib/gate.mjs` line 943), and the gate code has not changed since the tag. The exit-0 result Neural Vault saw came from an older build. Plan: ask which binary and version they ran (`meerkat --version` and the path), then confirm.

**Environment.** The default log folder `C:\Users\Futur\.meerkat\logs` is not writable on Neural Vault's machine. The gate says so on the NOT RECORDED line. Plan: none in Meerkat; they set `MEERKAT_LOG_DIR`.

**Decision for Samuel.** Whether a script's top-level `main()` call needs a rule (11, js-missing-await), and whether verifier and shoot scripts are excluded by path by default.

## 12. Third verify batch (Neural Vault, apps/desktop-electron/electron) and verify usability

**False positives (rule-precision, 10 items).**
- 12a. ep-ipc-preload and ep-ipc-handler-no-sender-check (ipc.cts:66, :75): the wrappers handleTrusted and onTrusted do the sender check, and a test enforces that every channel uses them. Plan: follow a wrapper call, not the raw ipcMain call.
- 12b. ep-ipc-preload removeAllListeners (ipc.cts:478 to 521): each register call clears its own channel first. Plan: accept a removal that is followed by re-registration of the same channel.
- 12c. ep-window permission handler (main.cts:139): line 139 is `resolve(true)` in devServerReachable, not a permission handler. Plan: the rule should only match a setPermissionRequestHandler call.
- 12d. electron-open-external (main.cts:198): an allow check and a consent dialog sit more than 10 lines above. Plan: look for the guard in the enclosing function, not a fixed 10-line window. files.cts:669 opens a constant mailto.
- 12e. ep-window shell open (files.cts:710): the function checks the string, non-empty and absolute first. Plan: the same enclosing-function rule as 12d.
- 12f. ep-window executeJavaScript and loadURL in dev harness scripts (shoot-*, verify-*.cts) and main.cts:813 (the DEV_SERVER constant). Plan: exclude dev-only harness scripts by path; treat a named constant as fixed.
- 12g. js-prototype-pollution (verify-code-mode.cts:389): copies process.env string values into a fresh object. Plan: accept a copy from process.env (string values only).
- 12h. js-unhandled-promise (shoot-*.cts startSidecar): startSidecar catches inside and never rejects; sidecar.cts:1360 and :1850 are `child.once('exit')` registrations. Plan: follow a function that catches internally; do not flag event registrations.
- 12i. js-await-in-loop (tour.cts, sidecar.cts:1399): deliberately sequential (UI steps, a poll loop). Plan: the existing `meerkat-ignore` covers it; no rule change.
- 12j. Already fixed by Neural Vault in PR 3813: the real js-unhandled-promise in main.cts whenReady.

**Usability, real problems.**
- 12k. `verify` puts a note first. Its report's first line was "priority below normal (your PC stays responsive; ...)", not the answer. Plan: the answer is line 1 for verify too, as for verdict and gate; the priority note moves after it. Test: verify's first line is the answer.
- 12l. `verify` is very slow and its progress stalls. On their worktree it ran past five minutes; rust-fmt alone went past 3:30; the progress line sat at 99% for minutes. Plan: profile the run per check; show which check is running and for how long; stop a check whose progress does not move (heartbeat exists for gate, not verify). Waiting for timings.
- 12m. Progress goes to stderr interleaved with the answer. When stderr is not dropped, the first line is not the verdict. Plan: the answer on stdout as line 1, progress on stderr only (same rule as gate, 309050c).
- 12n. With no base, verify says "git could not find a base branch ... running every check" and does not say what to set. Plan: name the exact fix (`--base <ref>` or `MEERKAT_BASE`).

**Decision for Samuel.** Whether verify should be the release-gate default (it is slow), or verdict stays the pre-PR step and verify is for whole-tree audits only.

## 13. Fourth verify batch (Neural Vault, packages/) and the verify scope question

**Real findings, fixed by Neural Vault:** unsafe-rust at vault_identity.rs:261 and :294 (no SAFETY note); test-no-assert in WarmupOverlay.test.tsx (PR 3812).

**False positives, grouped by rule (rule-precision fixes).**
- 13a. unsafe-rust window: the SAFETY comment sits 5 lines above the `unsafe` (export.rs:670). Plan: look for the SAFETY comment in the lines directly above the block, not a short fixed window; a multi-line comment counts.
- 13b. mem::forget as an ownership hand-over (shell_isolation.rs:976): the comment says ownership moved. Plan: accept mem::forget with such a comment (same rule as 11, cp-rust).
- 13c. from_raw_parts length (shell_isolation.rs:269): length comes from a kernel-filled buffer with a SAFETY note. Plan: a SAFETY note that names the length source satisfies the rule.
- 13d. unreachable! with a documented invariant (compiler.rs:590) and assert! as a deliberate guard (shell_tool.rs:1946). Plan: accept unreachable! and assert! when a comment above states the invariant or the guard's purpose.
- 13e. `as u32` truncation on in-memory counts (about 17 hits). Plan: the rule flags a cast only when the source is not a bounded in-memory count; it cannot tell that today. Judgement, needs a decision: keep the rule as a warning, or exempt `.len()` and `.count()`.
- 13f. debug-leftovers: todo!() inside a doc comment (vault/src/lib.rs:11). Plan: skip text inside `//!` and `///` doc comments.
- 13g. empty-catch in a test fixture string (insecure_code_classes.rs:2450). Plan: skip string literals and test fixtures.
- 13h. pii-patterns-in-source: a package-registry identity (supply_chain.rs:2345). Plan: an allow list for public service identities (npm registry, Google holiday calendar; see 12i and 11 notes).
- 13i. html-structure on a saved third-party fixture (wikipedia_gc.html). Plan: exclude packages/*/tests/fixtures/ from html-structure.
- 13j. test-presence: tests are inline (`#[cfg(test)]`, `#[test]`) in the same file (core/edition.rs has 112 tests). **A real rule bug.** Plan: count inline test modules as test coverage. Test: a Rust file with `#[cfg(test)]` passes.
- 13k. dataset-license-note: the data file carries its own source inside the JSON. Plan: accept provenance fields inside the file.
- 13l. rasync-blocking-fs on a once-per-tick background job (jobs/). Plan: accept a path that a comment marks as background and once-per-tick. Low priority.
- 13m. git-history-secrets flagged a test token (CreditMeter.test.tsx); skipped-tests flags every #[ignore] without checking for a reason. Plan: skipped-tests accepts `#[ignore = "reason"]`; git-history-secrets: an allow entry for a known test token, with a reason.

**Whole-tree versus branch (answer to Neural Vault).** `verify` scans the whole tree with every check on every file; there is no base, so it has no notion of "new". `verdict` and `gate` compare with the base and only judge changed lines. So 1150 findings and 66 failed checks from `verify --json` on a clean tree is the whole-tree view, not a regression. What is missing is a label: the JSON should say `scope: "whole tree"` and the text should say it on line 2. Plan: add that label; the verdict stays the pre-PR gate.

**Slowness, from Neural Vault.** `verify --app` took 132 s (preset quick). `verdict --base origin/dev` sits on "222/224 done, running: rust-test" for seven minutes because rust-test builds the whole workspace, with no per-crate progress. Plan: rust-test should show per-crate progress (cargo's own progress), and rust-test's time budget should follow the diff: test only the crates the change touches, plus their dependents.

**Logs not writable.** `~/.meerkat/logs` is not writable on Neural Vault's machine, so gate and last cannot see runs. The NOT RECORDED line says so, but it is not enough. Plan: when the default log folder is not writable, fall back to a temp folder and say which one.

## 14. Verdict and gate on three open dev PRs (Neural Vault, 3807, 3806, 3805)

Six problems, most serious first. None fixed yet.

- **14a. Crash, top priority.** `meerkat gate --base origin/dev` on PR 3806 exited 1 after 48 s, with stderr "meerkat: Cannot read properties of undefined (reading 'message')" and no verdict line. Plan: reproduce on the same commit (Neural Vault to send the sha), find the throw (likely a catch that reads `.message` from something undefined), make the failure exit 70 with one line naming the check and the cause, and add a test that feeds the same error shape.
- **14b. Slow.** verdict on 3807 took 127 s; on 3806, 514 s (rust-clippy 231 s); on 3805, over 604 s (rust-test 599 s). Gate on 3805 was also over 601 s. Plan: the rust-test budget follows the diff (only crates the change touches, plus dependents), and per-crate progress is shown (see 13, rust-test). Measure before and after on these three PRs.
- **14c. First line is not the answer.** Every verdict and gate run on their side printed "note: behind origin/dev by N commits" first, then 500 progress lines before the PASS line. The 0.5.4 and 309050c order puts the answer first, so their build predates it. Plan: confirm on the current build; if the note still prints first on any path, move it after the answer.
- **14d. Exit 75 without a reason on line 1.** On 3806 the verdict exited 75; the reason (INCOMPLETE 503, rust-clippy "could not compile nv-runtime") was only on a late line. Plan: INCOMPLETE puts its reason on line 1, the same way FAIL puts its finding there.
- **14e. Behind count disagrees.** On 3806 the same worktree gave "behind by 5 commits" in verdict and "behind by 9" in gate. Plan: both commands compute the base and the count from one place; test with a fixture that is behind by a known number and check both print the same count.
- **14f. Verdict does not state a changed-file count** (gate does). Plan: the verdict's line 1 carries the judged count (it does on 0.5.4 when files are judged; check the path where it does not).

**Gate on 3807** passed in 39 s with exit 0, and its first answer line stated the blocking count. That path is working.

**Not trusted message.** Not seen, so nothing to plan.

## 15. Decision for Samuel: changed binary files (matrix rows 10 and B, B2 red)

**Security review of 4778fec (fixed by reverting the binary part).** The first version classified a file as binary by a NUL byte in its first 8 KB and dropped the findings placed in it. An author could hide a finding, including a secret, by adding one byte. That part is reverted. Extension-based classification was tried next; it has the same risk, since a secret scanner would skip a file merely named `.png`. Also reverted.

**Current state.** The no-check NO-RESULT rule (every changed file matched no check, so NO-RESULT exit 3) stays. Checks run on binary files as they do on any other file. For a new `assets/logo.png` that nothing references, the `dead-assets` check reports a real finding, and the verdict FAILs.

**Matrix rows 10, B and B2 stay red on purpose.** Their expectation (NO-RESULT exit 3 for a binary) was a guess by the test author, and the security reason rules out hiding findings to satisfy it.

**Options for Samuel.**
- (a) Keep the current behaviour (a changed unreferenced binary is a dead-asset finding). Change rows 10, B and B2 to expect FAIL. This is the safest.
- (b) Exempt binary files from `dead-assets` only, in that check's own rule (it checks assets, so a changed asset is its job to judge; the exemption would be a rule decision, not a hidden drop). Rows 10 and B expect PASS or NO-RESULT accordingly.
- (c) Judge binary files as no-check everywhere. Not recommended: it hides findings in any binary file.

Nothing changes until he decides.

### 14b, new evidence (Neural Vault, fix-3289)

`verdict --base origin/dev` on one changed file in apps/sync-server ran 21+ minutes: 223 of 224 done, then stuck on rust-clippy for 850 seconds, which looks like a wait behind the shared cargo lock. Their first line was "note: behind origin/dev by 0 commits", from the meerkat-wt-integ build that predates 309050c. Plan unchanged: a lock wait shows its reason on line 1 and the rest is progress; the rust budget follows the changed crates. Neural Vault is re-running on the current build.

### 14a, my reproduction on b4a6c4e (PR 3806 head ac4a5e076)

The gate crash did NOT reproduce on the current build. The run went through 225 done, then `rust-clippy` failed after 595 s (`[done 226/226] rust-clippy ... 595.3s FAIL`). The stdout was empty, and there was no summary line on either stream. The shell's cwd reset during the run, so it may have been killed before it finished. Two follow-ups: (a) re-run with stdout and stderr in separate files and no shell interruption, to confirm whether the crash happens; (b) a gate killed mid-run must still print one INCOMPLETE line on stdout with its reason (this is the exit-75 rule in 14d). Logged as a separate problem until (a) confirms it.

## 16. Batch: crashed checks not named, no fail-fast (Neural Vault, 15 PRs)

`meerkat batch --base origin/dev --max-lines 500` on 15 PRs took 1052 s (gate 1036 s: rust-test 800 s, clippy 215 s). All 15 came back INCOMPLETE, exit 75, "2 check(s) crashed or their tool failed", and the two checks were not named in the summary; only actionlint's NOT RUN was visible. The result file is in the batches folder. Neural Vault wants: (a) the summary line names every crashed or failed-tool check; (b) a crashed tool is detected early and the run stops, rather than running 17 minutes of rust before saying INCOMPLETE. Plan: (a) collect crashed checks into the summary line and into the batch JSON, with the reason per check; (b) when a check's tool crashes (not a finding), stop the remaining heavy checks and report INCOMPLETE at once, naming the crash; (c) rust-test and clippy keep their per-crate budget (14b). Test: a fixture where one check's tool exits with a crash code; the summary names it and the run ends before the rust budget.

## 17. Batch: no culprit found, and the gate-run limit leaves branches unchecked (Neural Vault, 15 heads)

Batch took 1110 s and exited 75. Line 1: "origin/fix/3129-external-reads-in: INCOMPLETE passes the failing check(s) alone; the batch failed but no branch fails the same check alone (an interaction between branches, or a pre-existing failure): no culprit found". Neural Vault wants (a) a named culprit, or a clear "pre-existing failure" verdict, and (b) a run limit (MEERKAT_BATCH_MAX_RUNS, default 12) that does not leave 4 of 15 branches unchecked.

Plan. (a) When no single branch fails alone, say so on line 1 as a pre-existing-or-interaction case, and check the failing check on the base: if it also fails on the base, it is pre-existing and not the batch's fault; if it passes on the base, it is an interaction, and the batch names the smallest set of branches that reproduces it (bisection over the batch, about log2(N) more gate runs). (b) Bisection needs about 4 runs for 15 branches, so the search must not spend the run budget on the greedy pass first. Plan: budget the bisection explicitly, and when the limit is hit, name the branches that were NOT checked on line 1 and exit INCOMPLETE, never silently skip them. Test: a fixture where two branches together fail and neither alone; the batch names the pair within the run budget.

### 14g, compile error inside the gate (Neural Vault, PR 3805)

The gate on PR 3805 reported "could not compile nv-agents (test board_hostile_markdown)". Neural Vault has not diagnosed it. Plan: a test that fails to compile is a TOOL PROBLEM with its reason on line 1, not a finding and not a pass, and the compile output's first error line is quoted in the reason. Neural Vault should send the first error line of that compile; the test name is in the message.

### 14d and 14b, new evidence (Neural Vault, fix-3635-rust)

- 14d: the verdict's line 1 is now the answer with its reason ("INCOMPLETE (status 503): a check crashed or its tool failed, so the run cannot be judged; two checks did not work. Next: meerkat gate --only rust-test --base origin/dev"). Confirmed working on the current build; close 14d once the reason is verified on a second case.
- 14b: the run took 1012 s because the nv-sidecar test target does not compile on `dev` (phone_cmds.rs), and rust-test and rust-clippy each ran to failure. Plan: a compile failure of a crate's test target stops the other rust checks on the same crate at once and reports the compile error as a tool problem, rather than running each to its own failure. Same rule as 14g.

### 14a, result from Neural Vault (PR 3806 head ac4a5e076, build b4a6c4e, separate streams, uninterrupted)

Exit 1. Line 1: "TOOL PROBLEM (status 503): 1 check(s) crashed or hung; that is a tool problem, not a finding in the code. next: read the log folder; meerkat doctor shows missing tools". The crashed check is NOT named on line 1. Stderr is 615 lines, and its last line is "base side: [done 1/1] rp-api-ffi-wasm ... 2.7s FAIL". So the old "reading 'message'" crash did not recur, and the new fact is that a base-side check (rp-api-ffi-wasm) fails on the base side and is reported as a tool problem. Plan: (a) line 1 names the crashed check and its reason, the same rule as 16; (b) a base-side check that fails is judged as pre-existing when it also fails on the base, and only a tool failure is a tool problem; check whether rp-api-ffi-wasm is a missing tool or a real base failure. Close 14a once (a) is in place and this case gives the right answer.

### 16, confirmed case (PR 3806, same run)

The gate's line 1 for this run did not name the crashed check (see 14a). This is the same gap as section 16: the summary must name each crashed or failed-tool check.

## 18. Batch output: base versus branch attribution, a status on every done line (Neural Vault, 5 branches, base d145a5d5)

- **18a. Which side failed.** The batch streams many FAIL lines (risky-code, local-links, hadolint, duplicate-test-names and others) without saying whether each failure is on the base, on the branch, or both. Plan: every FAIL line says `base-only`, `branch-only` or `both`, from the base-side result the batch already computes. Base-only failures are pre-existing, not the branch's fault.
- **18b. No FAIL before the answer.** The progress stream prints FAIL lines before the final result line. Plan: the stream shows progress only; FAIL lines are printed once, after the answer, in the summary.
- **18c. A done line with no status.** A cyclomatic-complexity done line printed a time (13.4 s) and no PASS or FAIL. This is a bug. Plan: every `[done]` line carries a status; a check with no result prints `NOT RUN` with its reason. Test: a check that returns no status prints one.
- **18d. rust-test at 223/225 for 365 s or more.** The same rust budget issue as 14b. Plan: as 14b (per-crate budget, stop on a compile failure).
- **18e. Skip re-gating unchanged checks (unverified benefit).** A branch that touches only Rust or only docs need not re-run checks whose inputs are identical to the base (exec-bits, unicode-control-chars). Plan: measure first, on Neural Vault's 135-line batch, how many checks have identical inputs on base and branch; build only if the saving is real. The gate already caches by file content; check whether this is a gap.
- **18f. First line names the failing check.** Neural Vault asks that verdict line 1 keep naming the failing check. Plan: keep it (the answer-first order already does; regression test added with 18c).

## 19. Batch result: contradictory blocking counts, and no failing checks or base results recorded (Neural Vault, batch-20261112T133233-d13de3)

Final result: exit 75, INCOMPLETE; all 225 checks finished; rust-test FAIL at 645.6 s; 1568 s total, gate 1542 s.

- **19a. Two counts for one stop.** The log says "stopped early: 3 blocking so far", and the summary says "0 blocking so far (not a pass)". The two lines use different sources for the same count. Bug. Plan: one count, from the same rows, used by both lines; test with a run stopped at a known blocking count.
- **19b. The result file names no failing checks.** Every entry in `prs` has `failingChecks: []`, and `devBaseline` is empty for this run, so it cannot say which checks failed on the base or the branch. This is item 18a. Plan: write each failing check (id, reason, base-only / branch-only / both) into the result file and the summary.
- **19c. Earlier batch PASS verdicts.** Per-branch verdicts reported PASS for the same branches with `--allow-stale`. They do not match this batch's result. Plan: the verdict and batch result must state the base commit each one judged; a stale-base PASS is not the same as this batch's result. Needs the base commit from both runs to compare.

### 19, from the run folder (20261112-130641-wt-398654--gate)

- **19d. The count disagrees with the rows.** The report and summary say "225 check(s), 3 failed", but summary.json has 47 rows with status FAIL, 177 PASS and 1 NOT RUN, and no row marked blocking. One of the two counts is wrong. Plan: the count comes from the same rows as the list, and "blocking" is a field on each row, so the summary can say how many are blocking and how many are only failing.
- **19e. Which checks are blocking is not recorded.** The three blocking checks cannot be named from this folder; the 47 FAIL rows include rust-test (ran only the changed crates) and the ep-* checks. Plan: as 19d.
- **19f. Base sides not in this folder.** This is a whole-tree gate in a temp checkout, not the batch's base comparison; the batch's per-check base result is not written here. Plan: as 18a and 19b.

## 20. Stopped gate leaves children running; batch base side; batch to rerun (Neural Vault)

- **20a. A stopped gate leaves its children alive (bug, high).** Stopping `meerkat.mjs gate` (parent pid 16880, from meerkat-wt-integ) left `lib/cargo-lock-run.mjs cargo test --workspace` and its rustc processes running, holding the shared cargo lock; they were cleared only by killing the tree by hand. Plan: the gate records each child's pid (and its process group) when it starts it, and on exit, interrupt, or a timeout it kills the whole tree, the cargo-lock wrapper's cargo and rustc included. A test: a fake long-running child is reaped when the parent is interrupted. Windows: kill by process tree (taskkill /T), not by name.
- **20b. Batch base side still missing (bug).** The batch result has no devBaseline entries, so the three blocking checks cannot be named against dev. This is items 18a and 19b. Priority: base status per check first (blocking is decided by it), inputs-changed second (speed; rust-test took 645 s on a frontend-only change). Being built in the reportfix worktree; reply to Neural Vault when the result file records it.
- **20c. Five PRs wait on the batch.** Neural Vault will not merge on an INCOMPLETE batch and will rerun on dev head d145a5d57 once 20b lands. Plan: notify them with the commit that writes base status.
- **20d. Context tools signatures.** Neural Vault's agents call, in order: risks before editing a file, task pack for a handoff, map with a budget for orientation. `meerkat_brief` and gate keep their signatures unchanged. Plan: the MCP tools in the mcpctx worktree take the same order of use in docs/ai.md; no signature change to meerkat_brief or meerkat_gate.

## 21. Lock-wait timeout reported as FAIL; environmental findings unlabelled; a spurious exit (Neural Vault, #3739 gate run)

- **21a. A lock-wait timeout is a FAIL (bug).** rust-test exited 143 after 228 s waiting for the cargo lock (position 2 of 3, held by `cargo test -p nv-agents -p nv-runtime -p nv-sidecar` for 725 s). The check never ran, and the branch changes no Rust file. It must be NOT RUN with a lock-timeout reason, or INCOMPLETE (75), never FAIL. Plan: exit 143 (SIGTERM) and any run stopped by the time limit or the lock wait are classified as not run, with the reason "waited for the cargo lock". Test: an injected child that exits 143 with lock-wait output is NOT RUN, not FAIL.
- **21b. Environmental versus base-side (scripts-binaries).** The finding (apps/nv-vscode/package.json:60, "package" starts with "vsce", which no dependency provides) is on origin/dev too, and node_modules is not installed under nv-vscode, so the check may be partly environmental. Plan: each finding carries a `side` field (base-only, branch-only, both, environmental). environmental means the check could not see its dependencies (no node_modules, no tool on PATH); say which. This is the same field as 18a and 19b. Test: a check that cannot find its tool is environmental.
- **21c. Spurious non-zero exit at process end.** An npx segfault message appeared once at process exit after `npm run check` passed. A runner that reads npx's exit code can report a spurious failure. Plan: the gate takes the exit code of the check's own command when it is a real child, and records a crash in the child's exit separately from the tool's verdict; re-run once with the same command before reporting a crash. Test: a child that prints its result and then crashes at exit is reported with its result, and the crash is noted.

## 22. Harness phase-1 gate: cargo without the machine lock, no reason on FAIL, no log folder, repeated progress (Neural Vault)

- **22a. Cargo runs without the machine lock (bug, high).** rust-test and rust-clippy ran straight through, not via the machine cargo-lock wrapper, so they can run alongside other sessions' builds and exhaust memory. Plan: when the gate runs a cargo command, it runs it through the machine cargo lock when that lock is present (the wrapper the project's notes name); when the lock is absent, it says so on the check's line. Test: an injected command is wrapped when the lock exists.
- **22b. FAIL with no reason (rust-test, 461.8 s).** A FAIL line must say why: the failing test name when one failed, or the exit reason (time limit, lock-wait timeout, compile error, crash). Plan: the check's result carries the reason, printed on its FAIL line. Test: a check that exits with a failing test name prints that name on its FAIL line.
- **22c. No log folder on the first or answer line.** Plan: the gate prints its log folder on line 1 (after the answer) and on the answer line. This is the folder line already printed after the answer; add it to the answer line too.
- **22d. Progress repeats with no change.** Plan: progress lines print only when the state changes (a check starts or finishes, or the running set changes), and the heartbeat is throttled to every 30 s when nothing changes.
- **22e. Full rust-test takes over 7 min.** Same as 14b and 14g: scope rust-test to the changed crates. Built in the rustbudget branch (merged); the request is that the gate uses it by default.
- **Process note.** The agent killed the gate with an outer timeout at check 34 of 265, so no blocking count exists. This is 20a: the gate must reap its children when stopped.

### 22, from the #3734 gate run (Neural Vault)

- **22f. No summary until all checks finish.** A stopped run shows nothing of what it found. Plan: print a provisional summary line every N checks and at each stop (failures so far, blocking so far, checks left), labelled provisional.
- **22g. rust-test over 12 min on a frontend-only branch, with no timeout.** A frontend-only change must not run the Rust suite; if a Rust check must run, it has a per-check timeout and reports NOT RUN with the reason when it hits it. Plan: the Rust scope (rustbudget) returns "nothing to run" for a change with no Rust file; a check timeout is set and its NOT RUN line names it.
- **22h. Gate processes cannot be attributed.** Two gate processes from meerkat-wt-integ (pids 10504 and 16488) are running and nobody can tell which session started them. Plan: each gate's command line (or a run marker in its run folder) records the run id and the start time, so a later session can find and stop its own.
