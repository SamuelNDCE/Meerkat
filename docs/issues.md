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

**Phases and tests.** P1 schema (`tests/plan-schema.test.ts`); P2 cycles (`tests/plan-cycles.test.ts`); P3 ownership overlap, including a directory prefix and `a-b` not overlapping `a` (`tests/plan-ownership.test.ts`); P4 rules, exit codes and `--json` (`tests/plan-check-cli.test.ts`); P5 brief sections and size cap (`tests/plan-brief.test.ts`); P6 help and docs truth (`lib/help.test.ts`).

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
- **10d. Trust for a non-interactive shell.** Status: the flag already exists:  approves that folder's commands block and prints it. Decision for Samuel: automating this removes the human check the trust gate exists for. Whether a sub-agent may run it is his call, not a code change.
- **10e. Verdict text slower than JSON on large staged changes.** Status: OPEN, not reproduced on large input. Plan: measure on their staged change, sizes and seconds, then profile the text path against the JSON path. Waiting for their numbers.
