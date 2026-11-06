# Red tests: trying to break Meerkat

This folder holds a suite that attacks Meerkat itself. It builds small throwaway projects, breaks them or the environment on purpose, runs the real `run.mjs` on them, and checks that Meerkat reports what it should and survives what it should survive. Nothing here touches a folder the test did not create, and everything is removed afterwards.

Each kind is its own file and runs on its own.

| Kind | File | What it tries | What must hold |
|---|---|---|---|
| `mutation` (planted bugs) | `mutation.test.ts` | Takes the clean twin of each fixture app (`tools/fake-apps`), plants one known defect by swapping in a single defective file, and runs only the checks that should see it. | Every planted defect is reported by the right check, file and severity. Recall is printed per family (`REDTEST-RECALL`): injection, web headers and cookies, secrets, JS correctness, UI and accessibility, Rust, Python config, desktop. |
| `faults` (fault injection) | `faults.test.ts` | A check that throws, a check that never returns (hard timeout), a missing program, a command that cannot start, a file that disappears mid-run (a check removes it, the next one reads it), a tracked file already gone, a read-only folder, an unwritable log folder. | Each is reported as a FAIL or NOT RUN with a reason (never a PASS, never a crash), the healthy sibling check still runs, and the run ends on its own. |
| `adversarial` (odd inputs) | `adversarial.test.ts` | Empty folder, only binaries, a 5 MB file, CRLF and BOM files, unicode and right-to-left file names, a path with spaces, brackets and an apostrophe, a symlink loop, a token inside a file over 1 MB. | No crash, no stack trace, no hang, and the output says what happened. A known gap is recorded with `test.fails` (see below). |
| `regression` | `regression.test.ts` | One test per past bug that `CHANGELOG.md` records with a clear "fixed" line, rebuilt as a tiny project and run end to end. | The fix still holds, and where the changelog says the real defect is still found, it is. |
| `cleantwin` (false alarms) | `cleantwin.test.ts` | Runs the quick preset on the clean version of every fixture and on the tiny base project. | Zero critical, high or medium findings and zero failed checks. The count is printed as `REDTEST-FALSE-ALARMS`; low and info findings are counted apart as notes. |

## Running

```
node lib/redtest/run.mjs --kind mutation
node lib/redtest/run.mjs --kind faults
node lib/redtest/run.mjs --kind adversarial
node lib/redtest/run.mjs --kind regression
node lib/redtest/run.mjs --kind cleantwin
node lib/redtest/run.mjs --kind all
```

`--kind` picks one file; anything else on the line goes to vitest. The files are also picked up by the normal `npm test` because the vitest config includes `lib/**/*.test.ts`. They are slow (each runs the real tool many times), so run a kind at a time while working on it.

## Known gaps the suite found

A gap that is real and not yet fixed is written as a `test.fails` test with a comment saying what is wrong. The suite stays green while the gap is open and turns red the moment it is fixed, which is the signal to remove the marker.

- `secret-scan` skips every file over 1 MB without saying so, and reports "no secrets found". A token inside a large file passes. (`adversarial.test.ts`)

## Adding a test

- A new planted defect: add it to the defect list of a fake app in `tools/fake-apps` and give its check a family in `mutation.test.ts`.
- A new fixed bug: add a test to `regression.test.ts` named with the changelog wording, with the fixed shape and the real shape.
- Helpers live in `harness.mjs`. Projects are built with `makeProject`, which ignores the machine's global git ignore rules so a fixture file is always tracked.
