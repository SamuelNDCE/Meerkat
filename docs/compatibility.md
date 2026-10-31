# Compatibility: does every check behave on every kind of project?

Meerkat has checks for many kinds of project (Node, Python, Rust, Go, Java, .NET, PHP, Ruby, Swift, Dart, Terraform, Kubernetes, Docker, plain web pages, documentation). A check must behave sensibly on a project it was not written for. The compatibility matrix tests that.

## What the matrix covers

`tools/compat-fixtures.mjs` builds small, clean sample projects, each a real minimal project in a git repository with one commit (a README with install and usage, a licence, a security policy, a .gitignore, no secrets, https links only):

node-cli, node-web-ts, electron-app, python-lib, rust-crate, go-module, java-maven, dotnet, php, ruby, swift, dart, terraform, kubernetes, docker-compose-app, static-site, monorepo, docs-only, empty-git-repo (one empty commit) and not-a-git-folder (the node-cli files with no `.git`).

`tools/compat-matrix.mjs` runs EVERY check (every pack, not only the packs that fit the project; the opt-in AI and `cargo deny` checks stay off) on each one through the real runner (`run.mjs --preset full`), with a time limit per check. The projects are clean, so any FAIL is a false positive to look at.

## How to run it

```
node tools/compat-matrix.mjs
node tools/compat-matrix.mjs --only node-cli,python-lib --timeout 60 --out ./matrix
```

It writes `<out>.json` and `<out>.txt` (default: the OS temp folder) with every (project, check) status, duration and reason, and prints a summary. It exits 1 when there is a crash, a false-fail, an unexplained NOT RUN or a duplicate id.

The summary lists:

- (a) CRASH: a check that exited with a code other than 0, 1 or 75, printed a stack trace, or timed out.
- (b) FALSE-FAIL: a FAIL on a clean project.
- (c) NOT RUN for a reason that is not a missing tool, a missing git repository, or a missing setting (a performance budget).
- (d) DEAD: a check that never passes on any project (here: tools not installed, or budgets not set).
- (e) DUPLICATE ids across packs.
- (f) SLOW: a check over 10 seconds on a tiny project.

`lib/compat.test.ts` runs a fast subset (node-cli, python-lib, static-site, empty-git-repo, not-a-git-folder, electron-app) inside `npx vitest run`, and asserts no crash, no false-fail, no unexplained NOT RUN and unique ids.

## How a check behaves when it does not apply

- It PASSES with a line that starts with `not applicable:` and says why (no `Cargo.toml`, no `package.json`, no release tag yet). It never fails.
- A check about one kind of file names it in `appliesTo` (same globs as `paths`; the `tool()` helper uses `paths`). If the folder has no such file, the runner reports the PASS itself and does not start the tool, even when the tool is not installed.
- NOT RUN is only for: a tool that is not installed (the line says how to install it), a folder that is not a git repository (for checks that read history), and a performance check whose budget is not written in `.meerkat-budgets.json` (the line shows what to add).

## Last run (2026-10-31)

Windows 11, Node 24. Tools that are not installed on that machine (typos, shellcheck, hadolint, markdownlint, lychee, prettier, eslint, tsc, madge, htmlhint, stylelint, ruff, mypy, pytest, go, mvn, composer, rubocop, swift, dart, kube-linter and others) show as NOT RUN with an install hint. 246 checks per project. No crashes, no false-fails, no check over 10 seconds.

| Project | PASS | FAIL | NOT RUN |
|---|---|---|---|
| node-cli | 230 | 0 | 16 |
| node-web-ts | 228 | 0 | 18 |
| electron-app | 229 | 0 | 17 |
| python-lib | 228 | 0 | 18 |
| rust-crate | 233 | 0 | 13 |
| go-module | 231 | 0 | 15 |
| java-maven | 230 | 0 | 16 |
| dotnet | 233 | 0 | 13 |
| php | 231 | 0 | 15 |
| ruby | 231 | 0 | 15 |
| swift | 231 | 0 | 15 |
| dart | 231 | 0 | 15 |
| terraform | 233 | 0 | 13 |
| kubernetes | 233 | 0 | 13 |
| docker-compose-app | 230 | 0 | 16 |
| static-site | 231 | 0 | 15 |
| monorepo | 230 | 0 | 16 |
| docs-only | 233 | 0 | 13 |
| empty-git-repo | 233 | 4 | 9 |
| not-a-git-folder | 215 | 0 | 31 |

The 4 FAILs on empty-git-repo are true: a repository with nothing in it has no README, licence, security policy or .gitignore. The 31 NOT RUN on not-a-git-folder are the checks that read git history.
