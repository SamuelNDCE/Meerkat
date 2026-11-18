# Gate and merge optimisation research (2026-11-18)

Research only. Nothing here is built. Claims marked [verified] were confirmed in code or a command; [unverified] were not, and need a dry run or a measurement before anyone relies on them.

## 1. Merge throughput (queue, stacks, batches, conflicts)

**Why it is slow today**
- The NeuralVault queue (fixgate-queue.sh) gates PRs one at a time, and each PR re-merges into the new trunk, so N PRs cost N full gates. [verified in the scripts]
- queue-prs.sh skips any PR whose base is not dev, so stacked PRs are merged one by one by hand. [verified]
- conflict-preflight.sh finds files two PRs both touch, not real conflicts. [verified]

**Conflict prediction without a gate**
- `git merge-tree --write-tree --no-messages <base> <branch>` decides textual clean or conflict with no checkout. Exit 0 is clean, 1 is a conflict; on a conflict it lists the conflicted paths. Git here is 2.54.0 (merge-tree is available). [verified that git and merge-tree exist; the exit codes and speed are [unverified] until one dry run]
- It writes objects only, no refs. [unverified]
- Limit: textually clean is not semantically clean. Only the gate catches a renamed function that another PR calls. [reasoning]
- Treat a CHANGELOG-only conflict as its own class: changelog-fix-v2.py resolves those by hand today. [verified in the scripts]

**Stacks (A to B to C)**
- Gate the top once, then prove the parts merge in order: merge-tree trunk with A, then B, then C, and check the final tree equals the gated tree. If equal, one gate covers the chain. [proposal, unverified]
- Unsafe when a part must be a good state on trunk alone (bisect, revert, partial landing), after a squash merge (compare trees, not commits), if trunk moved since the top was gated, or if a part is edited later. [reasoning]
- Safer variant: land the chain as one merge of the top, so no intermediate state exists. merge-pr-lite.sh already keeps a branch alive when other PRs stack on it. [verified in the scripts]

**Batches (gate runs for N PRs)**
- Union gate with bisection (`meerkat batch --split`): 1 run if all pass; on failure, halves are gated, and a passing half is never searched again. [verified in code]
- The default run cap is 12 (lib/batch.mjs DEFAULT_MAX_RUNS, overridable with MEERKAT_BATCH_MAX_RUNS). A 13-branch batch with several bad branches can hit the cap and leave the rest NO-RESULT. This is the likely cause of the 13-branch stop the merge session saw. [verified in code; the cause in their run is [unverified] because I did not read their batch log]
- Rebase-chain (merge in order, gate the tip, bisect prefixes): about 1 + ceil(log2 N) runs for one culprit, but it assumes a single culprit. [estimate]
- Both need the same precondition: the gated tree is exactly what lands. Merging afterwards into a moving trunk breaks that unless the queue holds trunk still. [reasoning]

**Re-gate after a base move**
- Today nothing is reused across a base move. The gate cache key covers the whole tree, so a one-file edit invalidates every non-layout check. [verified in code]
- A check's verdict can stay valid when the merged content of its declared inputs is identical. Needs per-check input sets (section 2). [proposal]

**Proposed queue order**
1. Pin the candidate head SHAs.
2. Triage with merge-tree against trunk in queue order, carrying the result tree forward: zero gates. Classes: clean, CHANGELOG-only conflict, real conflict (owner fixes), stack member.
3. Gate stack chains as units (top gated once, tree-equality proof), then independent clean PRs, smallest and most independent first.
4. Group clean PRs into batches of 6 to 8 by disjoint area, so a failure bisects inside one area and stays under the run cap.
5. Gate each batch union once. On pass, merge the batch in the same order under the queue lock. On fail, bisect and merge only the passing branches.
6. Re-triage the remaining batches after each merge (seconds) and gate the next union.
Expected: about one gate per batch plus bisection extras, not one gate per PR. [estimate; verify with the dry run]

Safety rails: a final full gate on the merged tip before announcing done; never merge a PR whose head differs from the gated SHA; do not keep an inferred "adds no finding" verdict for a check that is not per-file without a second look.

## 2. Incremental verdicts (per-check inputs)

**What a check declares today** [verified]
- `paths` and `appliesTo` globs decide whether a check runs for a change. Neither feeds the cache key.
- Hard-coded id lists mark layout checks (LAYOUT_CHECKS) and git checks (GIT_CHECKS). They are not check fields.
- A check does not declare the files it reads, its config files, its tool version, whether it reads git history or the network, its environment variables, or whether it is deterministic.

**The current key** [verified]
- sha256(digest | tier | version and codeDigest | checkId), where the default digest is a hash of the whole tree snapshot plus HEAD, settings and the changed-file list.
- Snapshot signatures are size, mtime and sha256, and content is hashed only for files up to 256 KB, so a large edit that keeps size and mtime is missed.
- codeDigest hashes 7 Meerkat files only, so an edit to a thorough/ script or most pack files does not invalidate a cached result.
- Tool upgrades are not in the key.
- Fail verdicts are cached as well as passes. Crash, hang and not-run results are never stored.
- Entries expire after 6 hours, and the file is capped at 512 KB.

**Proposed per-check inputs** [proposal]
- Add `inputs: { files, config, tool, env, scope }`, where scope is files, repo, git or net.
- Key = hash of: check id and definition, codeDigest, tier, Meerkat version, tool version output and resolved path, path plus content hash of each input file, config files found by walking up (including markers for absent ones), declared env values, settings, and the keys of upstream checks.
- Use full content hashes, not size or mtime.
- Default for a check with no `inputs` stays scope repo, so the change is additive.
- Each scope narrower than repo must pass a mutation self-test: change a file outside its inputs and require the output to stay the same.

**Checks that cannot be keyed per file** [reasoning]
- Whole-repo scanners (secrets, dead code, licence graph, size budgets): scope repo.
- Git-history checks: key on git state plus the base and merge-base.
- Network checks (advisories, registry, link checks): never reuse a pass, or key with a time bucket.
- Execution checks (tests, builds, mutation): scope repo.
- A check that writes into the project keeps the existing guard that refuses to cache its run.

**Failure modes that would reuse a wrong verdict** [reasoning; the key must prevent each]
1. A check reads a file not in its inputs. The largest risk; the mutation self-test is the guard.
2. A config changes or appears in a parent directory.
3. A tool is upgraded or a different binary is on PATH.
4. The check definition or its script is edited.
5. A large file keeps its size and mtime.
6. A file matching a glob is renamed, added or deleted.
7. A tool-specific environment variable changes.
8. The changed set or base differs. Store the raw row, and reapply scoping on every read.
9. A time-dependent or network result.
10. An upstream check changed.
11. A corrupt cache file (a malformed entry is already a miss).
12. Two worktrees sharing one cache file (unverified).

Rollout: keep the whole-tree key as the fallback. Add `inputs` first to the single-language checks, which the BY_ID table already tags by file kind, and require the mutation self-test before any check leaves scope repo.

## 3. Gate time: measured (open)

The timing memo for the NeuralVault gate is still running; its numbers will go here once it reports. [open]

## 4. Open verification before adopting any of this

- A merge-tree dry run on two real PRs: attributes, CRLF, and CHANGELOG conflicts.
- The real cause of the 13-branch stop, from the batch's summary.json under the Meerkat data folder (batches/<batchId>/summary.json).
- Per-check input lists for the scoped cache, starting with a few checks.
- The time shares by check from real NeuralVault runs (section 3).
