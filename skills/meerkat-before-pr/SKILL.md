---
name: meerkat-before-pr
description: |-
  Use when about to open or update a pull request, git push, or post a PR body, comment, issue or release notes; it runs the gate against the base, the full gate and a secrets scan, then writes the summary.
  Not for single commits (meerkat-before-commit).
---

# Meerkat before a pull request

Replace `<base>` with the branch the pull request targets (for example `main`, or `origin/main`).

## When to use

- You are about to open a PR, update one with new commits, or `git push` a branch for review.
- You are about to write a PR description, a PR comment, an issue, or release notes about a change.

## Not for

- A single local commit: use `meerkat-before-commit`.
- Posting text that is not a PR (a paste, a log, a file, a repo): use `meerkat-secrets-before-post`.
- Deciding whether an edit is safe: use `meerkat-blast-before-edit`.

## Steps

1. Run the gate against the base.
   - CLI: `meerkat gate --base <base>`
   - MCP: `meerkat_gate` with `{"folder": "<folder>", "base": "<base>"}`; `meerkat_summary` gives a verdict in a few lines.

| Code | Meaning | What you do |
|---|---|---|
| 0 | Passed. | Go on. |
| 1 | A check failed or could not run. | Read `meerkat findings --json` (MCP `meerkat_findings`), fix the cause, rerun. |
| 2 | Usage or configuration problem. | Fix what the message says. |
| 75 | Not run (no base found, not a git repo, no checks loaded). | Not a pass. Fix the base or report it. |

2. Run the full merge gate when the change is large or touches build, security or config.
   - CLI: `meerkat full`. MCP: `meerkat_run` with `{"folder": "<folder>", "preset": "full"}`. It takes minutes: start it in the background and poll `meerkat_last`. Only one run at a time.
   - `meerkat full` exits 0, 1, 2, 3 or 130. Exit 3 means nothing was selected to run, which is not a pass.
   - Legacy project with many old findings: `meerkat_run` with `ratchet: true` fails only on findings not in the baseline (see `meerkat_baseline`, which the person must ask for).
3. Scan exactly what the pull request will show, for secrets and personal data.
   - CLI: `meerkat check secrets` then `meerkat findings --suite secrets --json`. MCP: `meerkat_run` with `{"folder": "<folder>", "suite": ["secrets"]}` then `meerkat_findings` with `suite: "secrets"`.
   - Then read the diff yourself (`git diff <base>...HEAD`) for what a scanner can miss: personal absolute paths (a home folder, a user name in a path) and personal data (names, emails, addresses, phone numbers). Remove them before posting.
4. State the result in the PR in these words, only when it is true:

```
Checks: no secrets, no personal paths.
```

If a finding was dismissed, name it and the reason instead of claiming a clean result.

5. Write the PR summary from the newest run's report.
   - CLI: `meerkat last`, and for a ready-made comment `meerkat pr-comment` (`--run-url <url>` adds a link). MCP: `meerkat_last` and `meerkat_pr_comment` (optional `run_url`).
   - It returns markdown only: the result, new findings and next steps. Posting is a separate step the user approves.
   - To hand the remaining findings to another AI to fix, use `meerkat_prompt` (WRITES one markdown file in the run folder). To say whether the project is getting better, `meerkat_trend`.

## What the output means

- Gate exit 0: the changed files pass the checks that cover them. `meerkat full` exit 0: every selected check passed.
- `new` findings are what this branch introduced; fix those first.
- NOT RUN or exit 75 or 3: nothing was proven. Say so in the PR; never write "all checks pass".

## Tools used

CLI: `meerkat gate --base`, `meerkat full`, `meerkat check secrets`, `meerkat findings`, `meerkat last`, `meerkat pr-comment`.
MCP: `meerkat_gate`, `meerkat_summary`, `meerkat_run`, `meerkat_last`, `meerkat_findings`, `meerkat_finding`, `meerkat_pr_comment`, `meerkat_prompt`, `meerkat_trend`, `meerkat_baseline`.

## Rules

- A NOT RUN is never a pass.
- Do not post until step 3 is clean.
- Never edit the Meerkat config or turn a check off to pass.
- Run one Meerkat run at a time.
- Never put a found secret value in the PR; name the file and line.

Related: `meerkat-secrets-before-post`, `meerkat-before-commit`, `meerkat` (overview).
