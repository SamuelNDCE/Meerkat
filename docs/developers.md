# Developing Meerkat, and extending it safely

This page is for people who want to change Meerkat itself, or add their own checks to it. For using Meerkat on your project, read the [README](../README.md). For writing one check in detail, read [writing-checks.md](writing-checks.md).

## Where things are

| Folder | What is in it | Change it when |
|---|---|---|
| `lib/` | The engine: the menu, the runner, the updater, reports, findings | You change how Meerkat behaves |
| `packs/` | Checks, grouped in folders by topic (one folder per pack) | You add or change a check |
| `thorough/` | The slow checks: mutation testing, clean-copy builds, flaky tests | You add a deep check |
| `examples/` | Example projects and their own checks. Not part of the core tool | You want a worked example |
| `fixtures/` | Bad and good sample files that prove each rule | Every new rule needs one |
| `tools/` | Maintenance scripts (generate the docs, make the badges, measure accuracy) | You change the counts or the docs |
| `tests/` | Meerkat's own tests (`npm test`) | Every behaviour change needs one |
| `docs/` | The guides. Some files are generated, see below | You change anything a user can see |

## Set up

Needs Node 20 or newer. From a clone of the repository (`cd Meerkat`):

```
npm ci
npm test
```

`npm test` runs the whole suite (several minutes). To run one file while you work: `npx vitest run lib/cli.test.ts`.

Before a pull request, run Meerkat on itself: `node run.mjs --app . --preset quick --plain`. It must show no failures.

### Scoped and smoke runs

`--preset project-smoke` is the build, type check, lints and quick tests (the same checks as `functionality-fast`), and `--scope <folder>` (or `--changed`) narrows any preset to part of a project. Scope works in two steps in `run.mjs`: `scopedFiles` in `lib/changed.mjs` lists the files under the folders, and that list picks which checks run, the same way the changed-files list does for `--changed`. Afterwards `inScopeFile` drops every finding whose `file` is outside the folders.

When you write a check that respects scope:

- Which checks run is decided by the file list and the paths the check declares, so declare the paths the check reads (see [writing-checks.md](writing-checks.md)) and read only those. A check with no file in the folders is skipped.
- Give every finding a repo-relative `file`, with forward slashes. After the run, findings whose `file` is outside the folders are dropped, and a finding with no `file` is never inside a folder. A check that prints only file paths in its output is matched by those paths instead.
- A check that fails only on findings outside the folders passes for that run. A check that fails with no findings at all (a crash, a missing tool) still fails.
- Repo-wide checks (git history, commit messages, dependency counts) are not limited by scope. That is expected: do not try to make them folder-aware.

Try it with `node run.mjs --app . --preset project-smoke --scope lib --plain`.

## Generated files: change the source, then regenerate

Some docs are written by scripts, so they cannot drift from the code. Do not edit these by hand:

| After changing | Run |
|---|---|
| A check, a pack or a preset | `node tools/gen-checks.mjs` (`docs/checks.md`, the counts in the README) |
| A suite | `node tools/gen-coverage.mjs` (`docs/coverage.md`) |
| Counts or the planted-defect recall | `node tools/make-badges.mjs` |

## Add a check, the short way

1. Pick the pack folder under `packs/` that fits the topic (or add a new one).
2. Write the check, following [writing-checks.md](writing-checks.md). Every check ships with a `selfTest` on a small broken fixture and an `expectMatch` for the reason it must fail.
3. Run `node tools/gen-checks.mjs`, then `npm test`.

Checks you write for your own project never need a change here: put them in your project's `meerkat.config.json` (see [customizing.md](customizing.md)).

## Update safety: why an update cannot break your setup

Meerkat's update (`u` in the menu, or `meerkat update`) changes only Meerkat's own folder. It is built to be safe to run at any time:

- **A file you changed is never overwritten.** If you edited a file the update also changes, the update stops, names that file, and changes nothing. Edits to other files are kept exactly as they are.
- **The update is tried in a copy first.** Meerkat saves your uncommitted changes as a patch in the log folder (`update-patches/`, named with the time and the new version), builds a temporary copy of your folder in the log folder (`update-verify/`) with your changes and the new version, and runs `meerkat self-test` and `meerkat --help` there. Only if both pass does your folder move; otherwise it is left untouched, the reason is shown, and the copy is deleted.
- **Commits you have made are kept.** If the folder is on another branch with commits GitHub does not have, the update moves the folder onto the default branch and leaves those commits on their branch. The result names that branch.
- **Your settings live outside the folder.** Per-user settings are in `~/.meerkat*.json`, logs in `~/.meerkat/logs` (or `MEERKAT_LOG_DIR`). Project settings are in your project (`meerkat.config.json`, `.meerkat/`). The update touches none of them.
- **Your project is never edited.** Meerkat reads your project from outside.
- **It only moves forward.** The update is a fast-forward, or a move onto the default branch. It never rewrites history.

If you keep your own checks in Meerkat's folder, put them in a folder of their own and commit them on a branch. The update will then leave them alone, and tell you the branch. Keeping them in your project is the safer choice.

## Progress and feedback

Every step that can take time shows something on screen: a spinner while the menu looks for a new version, a line while an update is installed, and a live board while checks run. A check that takes too long shows its time and can be skipped with a key. If you add a step that waits on the network or on git, use the same pattern: draw a label before the work, and clear it when the work settles.

## Where to make a change, in order

1. Add a test that fails without your change.
2. Make the change.
3. Update the docs and the generated files (table above).
4. Add a line under `## Unreleased` in [CHANGELOG.md](../CHANGELOG.md).
5. Open a pull request. The [CONTRIBUTING.md](../CONTRIBUTING.md) rules on false alarms and missed problems apply.
