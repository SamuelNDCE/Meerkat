---
name: meerkat-before-pr
description: |-
  Use when you are about to open or update a pull request, about to run git push or gh pr create, or about to post anything public about a change (a PR body, a comment, an issue, release notes).
  Runs the full Meerkat gate against the base branch, then a secrets and personal-data scan of the diff, and writes the PR summary from the run's report.
  The check you state is "no secrets, no personal paths".
---

# Meerkat before a pull request

Replace `<base>` with the branch the pull request targets (for example `main`).

## Order

1. Run the gate against the base:

```
meerkat gate --base <base>
```

| Code | Meaning | What you do |
|---|---|---|
| 0 | Passed. | Go on. |
| 1 | A check failed or could not run. | Read `meerkat findings --json`, fix the cause, rerun. |
| 2 | Usage or configuration problem. | Fix what the message says. |
| 75 | Not run (no base found, not a git repo, no checks loaded). | Not a pass. Fix the base or report it. |

2. Run the full merge gate when the change is large or touches build, security or config:

```
meerkat full
```

`meerkat full` exits 0, 1, 2, 3 or 130. Exit 3 means nothing was selected to run, which is not a pass.

3. Scan exactly what the pull request will show, for secrets and personal data. Run the secrets suite and read the findings:

```
meerkat check secrets
meerkat findings --suite secrets --json
```

Then look at the diff yourself for the two things a scanner can miss: personal absolute paths (a home folder, a user name in a path) and personal data (names, emails, addresses, phone numbers). Use `git diff <base>...HEAD` and read it. If either appears, remove it before posting.

4. State the result in the PR in these words, only when it is true:

```
Checks: no secrets, no personal paths.
```

If a finding was dismissed, name it and the reason instead of claiming a clean result.

5. Write the PR summary from the newest run's report. Read it with:

```
meerkat last
```

That prints the newest `report.md`. For a ready-made comment from the same run:

```
meerkat pr-comment
```

`meerkat pr-comment --run-url <url>` adds a link to the run. It prints markdown only. Posting is a separate step the user approves.

## Rules

- A NOT RUN is never a pass.
- Do not post until step 3 is clean.
- Never edit the Meerkat config or turn a check off to pass.
- Run one Meerkat run at a time.

Related: `meerkat-secrets-before-post`, `meerkat-before-commit`, `meerkat` (overview).
