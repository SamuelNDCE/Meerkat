# Meerkat on GitHub

Meerkat runs in GitHub Actions with only the `GITHUB_TOKEN` every workflow already has. It does not need the `gh` CLI, a personal access token or any other secret.

## 1. The Action

Copy [`examples/github/meerkat.yml`](../examples/github/meerkat.yml) to `.github/workflows/meerkat.yml`.

What it does:

- Runs on `pull_request` and on `push` to `main`.
- Checks out with `fetch-depth: 0`, because the gate compares against a base commit.
- Runs `npx -y @samuelndce/meerkat gate --base "$BASE_SHA" --format github`. `BASE_SHA` is the pull request base, or the commit before the push. A failing check fails the job.
- On pull requests from the same repository, runs a full `meerkat run` and posts one comment (step 3 below). That step has `continue-on-error: true`; only the gate fails the job.
- Pins both third-party actions by full commit SHA, read with `git ls-remote` from each action's own repository: `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0. Re-pin the same way when you upgrade.

## 2. Annotations and the job summary

`meerkat gate --format github` prints the normal gate output, then one workflow command per check that did not pass:

```
::error title=Meerkat secret-scan::secret-scan failed: FAIL: 1 possible secret(s). Remove them (and rotate the key)
```

A failed, crashed or hung check is an `::error`; a check that did not run is a `::warning`. When `GITHUB_STEP_SUMMARY` is set, a Markdown summary of the same rows is appended to the job summary. Newlines and percent signs in a message are escaped (`%0A`, `%0D`, `%25`), and file and title values also escape `:` and `,` (`%3A`, `%2C`), as GitHub's toolkit does. A message therefore cannot start a second command.

Gate rows name a check, not a file and line, so gate annotations carry a title and message only. `meerkat run --format github` prints per-finding annotations with `file=` and `line=`, so they appear on the changed lines.

## 3. The pull request comment

```
meerkat pr-comment --run-url <url> --post
```

The comment starts with the blocking count (critical plus high), then the top five findings by severity, each with a `file:line` link in the form GitHub renders (`/blob/<sha>/<path>#L<line>`). The rest are folded into a `<details>` block. It carries the hidden marker `<!-- meerkat-pr-comment -->`. With `--post` Meerkat lists the pull request's comments, updates the one with the marker, and creates a comment only when none has it. A pull request never gets two.

Without `--post`, `meerkat pr-comment` just prints the Markdown. Links use `--repo` and `--sha`, which default to `GITHUB_REPOSITORY` and `GITHUB_SHA`.

## What it does not do

- It does not fix anything. It reports.
- It does not post without a token. With no `GITHUB_TOKEN` (or no pull request number) `--post` posts nothing and says so.
- It does not comment on pull requests from forks: their token is read-only, so the example skips them. The gate and annotations still run.
- On a first push to a new branch, `github.event.before` is all zeros and the gate exits 75 (could not start). Treat it as not run, not as a pass.
- It does not call `gh`, and sends nothing anywhere except `api.github.com` with your token, only when you pass `--post`.

## Sources checked

- Workflow commands (`::error file=,line=,title=::`, `GITHUB_STEP_SUMMARY`): https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands. This page does not list the escape codes.
- Escape codes: `escapeData` and `escapeProperty` in https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts
