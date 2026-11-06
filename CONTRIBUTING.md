# Contributing to Meerkat

New here? [docs/developers.md](docs/developers.md) maps the folders, lists the generated files to regenerate and explains why an update never overwrites your changes.

## Good first contributions

- **Write a check for a tool you already use.** Find a rule your team argues about and turn it into a check with a bad and a good fixture. [writing-checks.md](docs/writing-checks.md) walks through it.
- **Fix a false alarm.** Run `meerkat verify` on a project you know well, and open a "False alarm" issue for anything that is not a real problem.
- **Improve a doc.** Anything in `docs/` that a newcomer found confusing is a fair change.

## Build and run

Meerkat is plain Node (no build step). Install the one dev dependency once, then run the tool from the repository:

```
npm ci
```

```
node run.mjs --app . --preset quick --plain
```

`--app <folder>` is the project to check; `bin/meerkat.mjs` is the `meerkat` command (`node bin/meerkat.mjs help`).

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

Every check proves itself. Give it a `selfTest` that runs it on a small broken file in `fixtures/` with `expectFail: true`, and an `expectMatch` regex for the reason it must fail, so it fails for the right reason and not because something else broke. Details and an example are in [docs/writing-checks.md](docs/writing-checks.md). After adding or changing checks, the generated counts and docs are refilled with `node tools/gen-checks.mjs` (see "Commits and pull requests" below).

Files that legitimately hold bad examples (rule tables, fixture text) belong in `.meerkatignore`, not in a weaker check.

## Add a smoke or red test

Red tests attack Meerkat itself: planted bugs, injected faults, odd inputs, past regressions and clean twins. [lib/redtest/README.md](lib/redtest/README.md) lists the kinds and how to add a test to each. Run one kind with `node lib/redtest/run.mjs --kind <kind>`. A known gap that is not fixed yet is written as `test.fails` with a comment, so the suite turns red when someone fixes it. [docs/adding-tests.md](docs/adding-tests.md) says which file a new test belongs in.

## Add a blast rule

The blast radius is what `meerkat blast <file>[#symbol]` reports. A rule about how files import each other belongs in `lib/codemap.mjs`; a rule about how the result is counted or worded belongs in `lib/refactorctx.mjs`. Never drop an import the map could not resolve: list it as unresolved, so a blast radius is never claimed safe by accident. Tests: `lib/refactorctx.test.ts` and `lib/codemap.test.ts`; fixtures: `fixtures/codemap`. See the "blast-radius rule" section of [docs/adding-tests.md](docs/adding-tests.md).

## The real-code benchmark

The accuracy corpus is built from each rule's own samples, so it cannot show false alarms on real code. `benchmarks/real-rust/` can: it runs the six rust-plus checks on a real Rust project and compares the findings with ones a person has labelled TRUE or FALSE. Build the read-only copy and measure as described in [benchmarks/real-rust/README.md](benchmarks/real-rust/README.md):

```
node benchmarks/real-rust/measure.mjs <tree folder>
```

Run it after every change to a Rust rule. It exits 1 if precision falls below the baseline, and `--strict` also fails when a labelled TRUE finding is no longer reported.

## The accuracy gate

A change to a rule must not make Meerkat worse at finding real problems:

- **No labelled TRUE finding is lost.** If a rule change drops a finding that the real-code benchmark labels TRUE, the change went too far. Losing labelled FALSE findings is the goal.
- **Planted recall is held.** `npm run test:accuracy` (and `lib/accuracy.test.ts`) fails when the recall of a suite falls under its floor in `docs/accuracy-thresholds.json`. Never lower a floor to pass a test: fix the rule, or move the defect to the known gaps with a reason. Raise a floor with `--write-thresholds` when a rule improves. The planted corpus tooling is `tools/corpus/gen-planted.mjs` and `tools/corpus/measure.mjs` (the generated `corpus/` folder is gitignored).
- Do not hide a false alarm by weakening a rule that also catches real defects; fix the rule and add the safe code as a good sample.

## The labelling rule

Read the source before you label. Open the file at the reported line in the project copy, read the code around it, and only then decide TRUE (the rule's claim is right here) or FALSE (a false alarm: test code, a deliberate discard, the rule misreading the code). Never label from the message text alone. Give every label a one-sentence `reason`. A rule, file and line may appear once in `labels.json`.

## Rules for changing Meerkat itself

- **Pack rule.** A check lives in a pack folder in `packs/` (a `.mjs` whose default export is an array of checks) and passes the validation in `lib/load-checks.mjs`. A new pack gets a load test (follow `tests/docdrift.test.ts`). Extending Meerkat for your own project is in [docs/adding-tests.md](docs/adding-tests.md).
- **Proof rule.** Every new check has a `selfTest` on a broken sample, with `expectFail: true` and an `expectMatch` that matches the output of the broken case. The loader does not enforce it, so a reviewer does. Run `node run.mjs --self-test`.
- **Labelling rule.** A claim about a command or feature says where it works: OK on `main`, PARTIAL (name the branch, for example `meerkat-040-integration`, or write "not yet merged"), or PLANNED. Do not write "release branch".
- **README sweep rule.** A change that adds or removes a check, command or feature updates the README, `docs/checks.md` and `docs/features.md` in the same pull request (see PROJECT.md). Counts come from `node tools/gen-checks.mjs`, never from typing. Never state a figure (recall, false-alarm rate, a count) without its source and date.
- **Known doc error.** The first line of `lib/load-checks.mjs` says it loads `checks/*.mjs`. The real input is a pack folder passed in by the caller. Fix the comment when you next change that file.

## Keeping the rules accurate

The rules are the heart of Meerkat, and they are meant to change.

- **A rule that reports a problem where there is none** (a false alarm) is a bug. Open a "False alarm" issue with the smallest code that triggers it. The fix goes in the rule, together with the code added as a good sample, so it cannot come back. `tests/falsepositives.test.ts` holds these.
- **A real problem nothing caught** is a "Missed problem" issue. The fix is a new or widened rule with a bad sample that proves it.
- Every rule has a bad and a good sample, and `meerkat self-test` proves each one. `docs/accuracy.md` explains the planted-defect corpus that measures misses and false alarms, and the thresholds that must not drop.
- Every change to the rules goes in CHANGELOG.md under `## Unreleased`; the release script moves it under the new version, so people can see what became stricter or looser.

## Commits and pull requests

- Commit as yourself, with no AI co-author line. Stage files by name, not with `git add -A`.
- Open a pull request for anything beyond README and PROJECT.md edits.
- Any change that adds, improves or removes something sweeps the README and the docs in the same pull request: regenerate counts with `node tools/gen-checks.mjs`, `node tools/gen-coverage.mjs` and `node tools/make-badges.mjs` (never type a count), check that presets, flags and environment variables named in the docs match the code, and add a note under `## Unreleased` in CHANGELOG.md. The full list is in PROJECT.md.
- No secrets and no absolute machine paths in any file. Do not add copyright headers to source files.
- Releases are batched, at most one a day, and only when the maintainer says so.

## Licence

Meerkat is released under PCL-1.0. By sending a contribution you agree to the terms in section 11 of the [LICENSE](LICENSE).

## Writing style

- No em dashes. Use periods, commas and colons.
- Short sentences. Plain words. One idea per sentence.
- Update the docs in the same change as the code.
