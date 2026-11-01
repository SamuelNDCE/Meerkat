# Contributing to Meerkat

## Run the tests

```
npm ci
npx vitest run
```

Before you open a pull request, run Meerkat on itself:

```
meerkat verify
```

## Add a check

A check is a small script plus an entry that says when it runs. Read [docs/writing-checks.md](docs/writing-checks.md) to write one, and [docs/customizing.md](docs/customizing.md) to wire it into a pack or preset. Each check needs a failing fixture, a passing fixture and a test. Keep false negatives out: a check may be noisy, but it must not stay silent on a real defect.

Files that legitimately hold bad examples (rule tables, fixture text) belong in `.meerkatignore`, not in a weaker check.

## Keeping the rules accurate

The rules are the heart of Meerkat, and they are meant to change.

- **A rule that reports a problem where there is none** (a false alarm) is a bug. Open a "False alarm" issue with the smallest code that triggers it. The fix goes in the rule, together with the code added as a good sample, so it cannot come back. `tests/falsepositives.test.ts` holds these.
- **A real problem nothing caught** is a "Missed problem" issue. The fix is a new or widened rule with a bad sample that proves it.
- Every rule has a bad and a good sample, and `meerkat self-test` proves each one. `docs/accuracy.md` explains the planted-defect corpus that measures misses and false alarms, and the thresholds that must not drop.
- Every change to the rules goes in CHANGELOG.md under the version that ships it, so people can see what became stricter or looser.

## Licence

Meerkat is released under PCL-1.0. By sending a contribution you agree to the terms in section 11 of the [LICENSE](LICENSE).

## Writing style

- No em dashes. Use periods, commas and colons.
- Short sentences. Plain words. One idea per sentence.
- Update the docs in the same change as the code.
