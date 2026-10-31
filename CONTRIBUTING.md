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

## Licence

Meerkat is released under PCL-1.0. By sending a contribution you agree to the terms in section 11 of the [LICENSE](LICENSE).

## Writing style

- No em dashes. Use periods, commas and colons.
- Short sentences. Plain words. One idea per sentence.
- Update the docs in the same change as the code.
