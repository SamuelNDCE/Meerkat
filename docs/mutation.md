# Mutation testing

A passing test suite only proves the tests pass. Mutation testing asks a harder question: **would the tests notice if the code were wrong?**

Meerkat's `mutation-testing` check changes your code in small ways (a `+` becomes a `-`, a `>=` becomes a `>`, an `if` condition becomes `false`), one change at a time, and runs your own tests after each change. If the tests fail, the change was **killed** (good). If the tests still pass, the change **survived**: the tests never looked at that behaviour. The idea is the one behind Stryker; the code is Meerkat's own (`thorough/mutation.mjs` and `thorough/mutation-support.mjs`, no dependencies).

Four cheap cousins live beside it: `test-quality-static`, `assertion-strength` and `test-to-code-ratio` read the test files without running anything, and `tests-fail-without-source` is a coarse mutation check (see the end of this page).

## Turn it on

It runs your tests many times, so it is opt-in and always runs alone:

```
meerkat verify --include mutation
meerkat check mutation-testing
node thorough/mutation.mjs mutation-testing --root <folder> --max-mutants 20
node thorough/mutation.mjs mutation-testing --diff origin/main
```

It lives in the `test-hygiene` suite. Tier thorough, weight alone, about 300 seconds by default (the check's own limit is 900 seconds).

## Diff mode: "your change is under-tested"

When the project is a git repository with a base to compare with, only the lines **changed against that base** are mutated, and the score is the score of the changed code. A pull request run takes seconds instead of minutes.

- **The base** is, in order: the ref you give (`--diff <ref>`, or `"diff": "<ref>"`), the merge-base with `origin/main`, `main`, `origin/master` or `master` (when it is not the current commit), then `HEAD~1`. If `HEAD~1` changed no mutable source line, the last 10 commits are used instead.
- **What counts as changed** is `git diff -U0` against the base, working tree included, plus files git does not track yet. The changed lines are read with fixed arguments (no shell); a ref that starts with `-` or has odd characters is refused.
- **Nothing changed** is a PASS: `mutation-testing: PASS, no changed source lines`.
- It is on by default when a base exists. Turn it off with `--no-diff` or `"diff": false` to mutate the whole project again. Outside a git repository nothing changes: it is a full run.

## Safety: it never edits your files

- It works on a **temporary copy** of the project (the files git knows about, or a walk that skips `node_modules`, `.git`, `target`, `dist`, `build`, `venv`; files over 2 MB are left out; the copy is capped at 200 MB, above that it says NOT RUN). With parallel workers there is one copy per worker.
- One change is applied in a copy, the tests run in that copy, the file is restored, then the next change.
- The temporary folders are deleted at the end, also on Ctrl-C, on a crash and on exit. A killed test run is cleaned up too.
- `node_modules` is **linked** into each copy (a junction on Windows, a symlink elsewhere) so the tests can find their tools. The mutation itself never writes there. A test runner may write its own cache folder there (for example `node_modules/.vite`); that is the one place a run can leave a trace in your project. If the link cannot be made, the check says NOT RUN and why.
- Your project is never written to by Meerkat: its files are hashed before and after in the test suite (`mutation.test.ts`, `mutation-diff.test.ts`). The result files and the history go to the run folder and to `~/.meerkat/mutation/` (or `MEERKAT_LOG_DIR`), never into the project.
- The tests run **without a shell** (a fixed program and argument list), and the whole process tree is killed on timeout (`taskkill /T` on Windows, a process group elsewhere).
- Output is cleaned of control characters, and test output is never printed.

## What it runs

1. **The test command.** From the config (`testCommand` always wins), else detected: `npm test` (the `test` script), else vitest, jest or mocha from `package.json`, else `go test ./...`, `cargo test`, `mvn -q test`, `gradle test` (the wrapper when there is one), `dotnet test`, or `python -m pytest -x -q`. If there is none, the result is NOT RUN (exit 75) with a message.
2. **A baseline run** in the first copy must pass first. If it fails, the result is NOT RUN: "tests fail before mutation, fix them first".
3. **The mutants.** Each one runs with a time limit. A test run that times out counts as killed (an infinite loop is a change the tests noticed).
4. **Fewer tests per mutant** (switch off with `"scopeTests": false` or `--no-scope`): with an auto-detected command, a JavaScript or TypeScript mutant runs only the test files that reach the mutated module through relative imports (a cheap import scan, transitive); a Go mutant runs `go test ./<package>/...`; a Rust mutant runs `cargo test -p <crate>` when the file belongs to a member crate. When no test can be determined, or the mutant survives a narrowed run, the full command runs, so a narrowed run never invents a survivor (`confirmScoped`, on by default).

### The mutators

Text-level, applied to one site at a time, never inside comments, strings or regex literals, never in test files, config files, `import` lines or log/print calls. A site that two mutators both produce is kept once. The table below is generated from the registry (`node thorough/mutation.mjs list-mutators`) and a test keeps it equal.

<!-- MUTATORS:START -->
| Family | Mutator | Languages | Change |
|---|---|---|---|
| arithmetic | `arith-plus-minus` | js, py, go, rs, java, cs | + becomes - |
| arithmetic | `arith-times-divide` | js, py, go, rs, java, cs | * becomes / |
| arithmetic | `arith-modulo-times` | js, py, go, rs, java, cs | % becomes * |
| arithmetic | `arith-minus-plus` | js, py, go, rs, java, cs | - becomes + |
| comparison | `boundary-less` | js, py, go, rs, java, cs | < and <= swap |
| comparison | `boundary-greater` | js, py, go, rs, java, cs | > and >= swap |
| null-safety | `go-err-flip` | go | err != nil and err == nil swap |
| comparison | `equality-flip` | js, py, go, rs, java, cs | == and != swap |
| logical | `logical-and-or` | js, py, go, rs, java, cs | && becomes \|\| |
| logical | `logical-or-and` | js, py, go, rs, java, cs | \|\| becomes && |
| logical | `logical-not-removed` | js, py, go, rs, java, cs | a negation is removed |
| literal | `literal-boolean` | js, py, go, rs, java, cs | true and false swap |
| literal | `literal-zero-one` | js, py, go, rs, java, cs | 0 becomes 1 |
| literal | `literal-empty-string` | js, py, go, rs, java, cs | an empty string becomes "x" |
| literal | `literal-array-emptied` | js, py | a non-empty array literal becomes empty |
| conditional | `conditional-true` | js, py, go, rs, java, cs | an if condition is replaced by true |
| conditional | `conditional-false` | js, py, go, rs, java, cs | an if condition is replaced by false |
| return | `return-nulled` | js, py, java, cs | a returned value becomes null, None or undefined |
| statement | `statement-removed` | js, py, java, cs, rs | a standalone call statement is removed |
| increment | `increment-flip` | js, go, java, cs | ++ and -- swap |
| string-method | `string-method-swap` | js, py, java, cs | startsWith and endsWith swap |
| argument | `args-swap` | js, py, go, rs, java, cs | two simple arguments of a call swap places |
| async | `await-removed` | js | an await is removed |
| control | `return-guard-removed` | js, py, java, cs | the return of a one-line guard (if (x) return y) is removed |
| index | `index-shift` | js, py, go, rs, java, cs | an index [i] becomes [i + 1] or [i - 1] |
| literal | `numeric-negated` | js, py, go, rs, java, cs | a number assigned, returned or passed becomes negative |
| argument | `minmax-swap` | js, py, go, rs, java, cs | min and max swap |
| string-method | `collection-contains-negated` | js, java, cs | a .includes(x) test is negated |
| comparison | `compare-reversed` | js, py, go, rs, java, cs | a comparison is reversed (< becomes >, <= becomes >=, and back) |
| assign | `assign-logical-flip` | js | &&=, \|\|= and ??= change |
| default | `default-param-changed` | js, py | a default parameter value changes (a number plus one, a flag flipped) |
| null-safety | `optional-chain-removed` | js, cs | a ?. becomes . |
| null-safety | `nullish-to-or` | js | ?? becomes \|\| |
| control | `loop-control-swap` | js, go, java, cs, rs, py | break and continue swap |
| control | `loop-bound-shrunk` | js, java, cs, go | a for loop bound n becomes n - 1 |
| literal | `literal-string-emptied` | js, py, go, rs, java, cs | a non-empty string assigned or returned becomes empty |
| control | `else-removed` | js, java, cs, rs, go | a one-line else branch is emptied |
| python | `py-is-flip` | py | is and is not swap |
| python | `py-in-flip` | py | in and not in swap |
| python | `py-range-extended` | py | range(n) becomes range(n + 1) |
| python | `py-return-keyword-removed` | py | the return keyword is removed, so the function gives back None |
| arithmetic | `plusone-removed` | js, py, go, rs, java, cs | a + 1 or - 1 is dropped |
| null-safety | `rs-some-none` | rs | a returned Some(x) becomes None |
| null-safety | `rs-try-removed` | rs | a ? that passes an error up is removed |
| conditional | `conditional-negated` | js, py, go, rs, java, cs | an if condition is negated |
<!-- MUTATORS:END -->

Languages: JavaScript and TypeScript, Python, Go, Rust, Java, C#. A mutator only applies to the languages in its row, so Python `is`/`in`/`range` and Go `err` checks are not tried on other files. Some mutators that the request list mentions are covered by an older one: the `>=`/`<=` boundary pairs are `boundary-less` and `boundary-greater`, an `err != nil` flip in Go is `go-err-flip`, `&&`/`||` and `<` exist for every language, and `return true` or `false` flips are `literal-boolean`. Not built: swapping `let` and `const`, and regex quantifier changes (both too often equivalent or a syntax error to be worth a test run).

The sites are picked with a **seeded** random draw (seed 1 by default) so the same run picks the same mutants. Files changed recently in git are more likely to be picked, and a file with many sites does not crowd out the others. Mutants then run in an order that puts the usually-killed families first, so a time cap or fail-fast stop leaves the doubtful ones undone.

## Reading the result

```
[7/20] KILLED  comparison src/price.js:14 >= -> >
[8/20] SURVIVED conditional src/price.js:22 qty > 0 -> true
...
MEERKAT-SUB FAIL arithmetic 2 of 5 survived
mutation score: 70% (14 killed, 6 survived, 0 ignored because they did not compile; 20 tested)
mode: diff against merge-base with origin/main: only changed lines were mutated, so this score is for the changed code
trend: 70% (up 5 since 2026-10-30, when it was 65%; 3 earlier runs kept)
weakest files (score, killed of tested):
   40%  2/5  src/price.js
weakest functions:
   33%  1/3  src/price.js applyDiscount()
SURVIVED mutants (6): the tests still passed with the code changed here
  src/price.js:22 'qty > 0' -> 'true'  (conditional-true)
    suggestion: in applyDiscount() at src/price.js:22 (if (qty > 0) {): add a test that asserts the behaviour when the condition is false
MEERKAT-FINDING medium mut-conditional-true src/price.js:22 mutant survived: 'qty > 0' -> 'true' (no test failed)
```

- **mutation score** = killed / (killed + survived). The check fails (exit 1) when it is below `minScore` (default 60).
- A change that does not parse or compile is **ignored**, not counted either way.
- **Likely equivalent** mutants (`x * 1`, `x + 0`, code inside `if (false)`, a line that only feeds a log call, a line with `meerkat-mutation-ignore`, `istanbul ignore`, `c8 ignore` or `pragma: no cover`) are not run, are left out of the score, and are listed on their own.
- One `MEERKAT-SUB` line per family: PASS when every mutant of that family was killed, FAIL with the count when any survived, NA when none were tested. A last line `mutation-score` carries the threshold.
- Every survivor prints a `MEERKAT-FINDING medium mut-<mutator>` line (the finding protocol, `docs/findings.md`), so a survivor shows up in the findings views.
- **The suggestion** is a template, not AI: the nearest enclosing function (found by a simple scan), the line, and what a test should assert for that kind of change.
- **How to read a survivor:** open the file at that line, apply the change by hand, and ask "which test should have failed?". Usually the fix is a test for the edge: the boundary value (`18` for `age >= 18`), the empty case, the case where the condition is false.
- **Equivalent mutants** that the heuristics miss are still possible: `i < n` to `i <= n` where `i` can never reach `n`, for example. Treat the survivors as a list to look through, not as a verdict.
- **NOT RUN (exit 75)** means no honest score: no test command, the baseline failed, the project is too big to copy, the link to `node_modules` failed, or the time cap was reached with fewer than 5 mutants tested.

### Result files and history

- `mutation.json` and `mutation.md` are written to the folder in `MEERKAT_RUN_DIR` when it is set (the runner sets it), else to `~/.meerkat/mutation/<project>.last/`; the path is printed as `results: ...`. `mutation.json` (schema 1) lists **every mutant**: `id`, `file`, `line`, `mutator`, `from`, `to`, `result` (`killed`, `survived`, `timeout`, `error` or `equivalent`), `durationMs`, `killedBy` (the failing test name when the runner's summary line can be read: vitest, jest, pytest, go, cargo, node:test), and `notCovered` for a survivor that never ran. `mutation.md` is a plain-text summary of the survivors and of which test killed which mutant. Files are written atomically (a temporary file, then a rename).
- The **history** of the last 20 runs per project (date, score, mutants, full or diff) is kept in `~/.meerkat/mutation/<project>-<hash>.json` (or `<MEERKAT_LOG_DIR>/mutation/`), capped at 64 KB and written atomically. The output shows a `trend:` line (up, down or unchanged against the previous run of the same mode).

## Speed

- **Parallel workers** (`parallel`, default 2, at most the CPU count minus 1), each in its own copy. The same seed gives the same result as a serial run. Tests that share a port, a database or a fixed temporary path can collide when run in parallel: set `"parallel": 1` for those.
- **Coverage hint.** If the project already produced `coverage/lcov.info`, `lcov.info` or `coverage/coverage-final.json` (or you name a file in `coverageFile`), a mutant on a line that no test runs is reported as `survived (not covered)` **without running anything**. The report is used only when it is newer than the source file. `"coverage": false` or `--no-coverage` ignores it.
- **Fail fast** (`failFast`, `--fail-fast`, off by default): the run stops as soon as the minimum score can no longer be reached even if every remaining mutant were killed.
- The `totalSeconds` cap is respected by every worker.

## Config

In `.meerkat-budgets.json`:

```json
{
  "mutation": {
    "testCommand": ["npx", "vitest", "run"],
    "maxMutants": 40,
    "timeoutSeconds": 60,
    "totalSeconds": 600,
    "files": ["src/**/*.js"],
    "minScore": 60,
    "seed": 1,
    "diff": "auto",
    "parallel": 2,
    "failFast": false
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `testCommand` | detected | A program and its arguments, as a list. Run without a shell. Never narrowed. |
| `maxMutants` | 40 | How many mutants to test at most. |
| `timeoutSeconds` | 60 | Limit for one mutant's test run. It is also capped at three times the baseline plus a few seconds, so a hang is found quickly. |
| `totalSeconds` | 600 | The whole run, baseline included. When it is reached the run stops and reports what it has (NOT RUN if fewer than 5 were tested). |
| `files` | all source | Glob patterns (`*` within a folder, `**` across folders) of the files to mutate. |
| `minScore` | 60 | The lowest score that passes. |
| `seed` | 1 | The seed of the draw. A different seed samples different mutants. |
| `diff` | `auto` | `auto` (changed lines when a git base exists), `false` (whole project) or a git ref to compare with. |
| `parallel` | 2 | Worker copies running at once (1 to CPU count minus 1). |
| `failFast` | false | Stop when the minimum score is out of reach. |
| `coverage`, `coverageFile` | true, detected | Use an existing coverage report to skip uncovered lines. |
| `scopeTests`, `confirmScoped` | true, true | Narrow the test command per mutant, and re-check a narrowed survivor with the full command. |

The same keys can be given on the command line (`--max-mutants`, `--timeout`, `--total-seconds`, `--min-score`, `--seed`, `--files a,b`, `--test-command '["npm","test"]'`, `--diff [ref]`, `--no-diff`, `--parallel N`, `--fail-fast`, `--no-coverage`, `--no-scope`) or as JSON in the `MEERKAT_MUTATION` environment variable. Command line wins over the environment, the environment over the file.

## Limits

- The mutators work on **text, line by line**, not on a syntax tree. A construct that spans lines is mostly left alone, and some mutants are equivalent (they change nothing observable). The equivalent-mutant flags are heuristics, not proof.
- Masking comments and strings is a scanner, not a parser: unusual quoting (Rust raw strings, C# verbatim strings, shell here-documents) can be misread.
- Only a sample (`maxMutants`) is tested, not every possible mutant. A big project needs `files` pointed at one area per run, or diff mode.
- The import scan that narrows the tests follows relative imports only. A test that starts your program as a child process does not "import" it, so it is found only by the full-command re-check of a survivor.
- The suggestion's function name comes from a regular-expression scan: an unusual declaration is reported as `(top level)`.
- Coverage hints depend on the report matching the current source; a report older than the file is ignored, one from a different branch of the same age is not detected.
- Mutating a file the tests read through a build step (compiled output, bundles) shows nothing: mutate the source the tests actually import.
- Tests that depend on the project's folder name, git history, or files that are not copied (ignored files, files over 2 MB) can fail in the copy. That shows as "tests fail before mutation".
- `node_modules` of nested packages is linked only for folders that have a `package.json` next to them.

## test-quality-static

A fast check (tier fast, runs in a normal run, no test is executed) that reads the test files and reports tests that cannot fail or hide a failure. Thirteen rules, one `MEERKAT-SUB` line each: `tautology-assert`, `commented-out-test`, `sleep-based-test`, `network-in-unit-test`, `file-without-assertions`, `test-without-assertion`, `empty-test-body`, `snapshot-only`, `swallowed-failure`, `assertion-only-in-catch`, `never-imports-source`, `skip-ratio`, `duplicate-test-name`. A project with no tests gets NA on every rule. To accept a finding, add `rule-id path` (or `rule-id *`) to `.meerkat-test-quality-allow`.

It is a proxy: a test that calls a helper which asserts is counted as asserting (a call to anything named `assert`, `expect`, `check`, `verify` or `ensure` counts), and a test that passes a function by name is not looked into. Mutation testing is the real measure.

## assertion-strength

Fast and static (`thorough/mutation-quality.mjs`). Assertions that exist but cannot fail for a wrong value, five rules, one `MEERKAT-SUB` line and one `MEERKAT-FINDING low` per hit:

| Rule | Finds |
|---|---|
| `defined-after-assignment` | `expect(x).toBeDefined()` or `assert x is not None` on the line right after `x` was assigned |
| `truthy-on-object` | `toBeTruthy()` on an object, array or `new` value, which is always truthy |
| `only-defined-or-truthy` | a test whose every assertion is defined, truthy or not-None |
| `only-not-throw` | a test whose only assertion is `not.toThrow()` |
| `mock-call-only` | a test that only checks a mock was called, never what came out |

Accept a finding with `rule-id path` in `.meerkat-assertion-strength-allow`.

## test-to-code-ratio

Fast, static and informational (it never fails). Test lines per source line for each folder, and a list of folders with 30 or more source lines and **no tests**: none in the folder and none anywhere that mention the folder's path. Each such folder is also a `MEERKAT-FINDING info folder-without-tests`.

## tests-fail-without-source

A coarse mutation check, opt-in with `--include mutation`. In a temporary copy it **empties one source file at a time** (at most 10, the most imported first; `--max-files N`, at most 50) and requires that at least one test fails. A file whose removal changes no test result is an **untested file** (`MEERKAT-FINDING medium untested-file`, exit 1). JavaScript, TypeScript and Python only: in a compiled project an emptied file fails the build, which proves nothing. A test that fails only because of an import error counts as "needs the file", so it shows reachability, not good assertions: that is what mutation testing and `assertion-strength` are for.
