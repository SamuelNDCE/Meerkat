# Contributing to Meerkat

New here? [docs/developers.md](docs/developers.md) maps the folders, lists the generated files to regenerate and explains why an update never overwrites your changes.

## Good first contributions

- **Write a check for a tool you already use.** Find a rule your team argues about and turn it into a check with a bad and a good fixture. [writing-checks.md](docs/writing-checks.md) walks through it.
- **Fix a false alarm.** Run `meerkat verify` on a project you know well, and open a "False alarm" issue for anything that is not a real problem.
- **Improve a doc.** Anything in `docs/` that a newcomer found confusing is a fair change.

## Run the tests

- `npm test` runs everything except the slow accuracy corpus (a few minutes).
- `npm run test:accuracy` runs the accuracy corpus on its own (around 15 minutes). CI runs it on every change.

```
npm ci
npm test
```

Run `npm ci` once first: vitest is the only dev dependency.

## Check your change

Meerkat checks itself. While you work, a quick build-and-test check (build, type check, lints and the quick tests):

```
node run.mjs --app . --preset project-smoke --plain
```

Before you open a pull request, the quick preset:

```
node run.mjs --app . --preset quick --plain
```

To focus a run on part of the project, add `--scope <folder>` (repeat it, or separate folders with commas), for example `--scope lib`. Only checks that read files in that folder run, and only findings inside it are kept. Repo-wide checks (git history, commit messages, dependency counts) are not limited by it. `--changed` instead limits a run to files changed against the base branch; the two cannot be combined. More in [docs/reference.md](docs/reference.md#focused-runs).

## Add a check

A check is a small script plus an entry that says when it runs. Read [docs/writing-checks.md](docs/writing-checks.md) to write one, and [docs/customizing.md](docs/customizing.md) to wire it into a pack or preset. Each check needs a failing fixture, a passing fixture and a test. Keep false negatives out: a check may be noisy, but it must not stay silent on a real defect.

Files that legitimately hold bad examples (rule tables, fixture text) belong in `.meerkatignore`, not in a weaker check.

## Keeping the rules accurate

The rules are the heart of Meerkat, and they are meant to change.

- **A rule that reports a problem where there is none** (a false alarm) is a bug. Open a "False alarm" issue with the smallest code that triggers it. The fix goes in the rule, together with the code added as a good sample, so it cannot come back. `tests/falsepositives.test.ts` holds these.
- **A real problem nothing caught** is a "Missed problem" issue. The fix is a new or widened rule with a bad sample that proves it.
- Every rule has a bad and a good sample, and `meerkat self-test` proves each one. `docs/accuracy.md` explains the planted-defect corpus that measures misses and false alarms, and the thresholds that must not drop.
- Every change to the rules goes in CHANGELOG.md under `## Unreleased`; the release script moves it under the new version, so people can see what became stricter or looser.

## Licence

Meerkat is released under PCL-1.0. By sending a contribution you agree to the terms in section 11 of the [LICENSE](LICENSE).

## Writing style

- No em dashes. Use periods, commas and colons.
- Short sentences. Plain words. One idea per sentence.
- Update the docs in the same change as the code.
