# Adding tests to Meerkat

For people who change Meerkat. Each section names the file to edit and the test to add. For the full field list of a check, read [writing-checks.md](writing-checks.md). For the folder layout, read [developers.md](developers.md).

Before a pull request, run `npx vitest run <file>` for the file you touched, then `node run.mjs --app . --preset quick --plain`. It must show no failures.

## A check

A check proves one thing about a project.

1. Pick the pack folder in `packs/` that fits the topic, or make `packs/<name>/` for a new one. Add the check to a file there, or add a new `.mjs` file that exports an array of checks.
2. Give it the fields in writing-checks.md. Wrap an outside tool with `tool()` from `lib/tool-check.mjs`; write a script in `thorough/` for a check that needs no tool.
3. Give it a `selfTest`: a small broken sample in `fixtures/` (for a `tool()` check, the `fixture` argument), with `expectFail: true`.
4. Give the selfTest an `expectMatch`: a regex the output must match, so the check fails for the right reason and not because something else broke.
5. Load test: add a case to the test file of the pack, or to a new file in `tests/`. Follow `tests/docdrift.test.ts`: load the pack with `loadChecks(join(ROOT, 'packs/<name>'))`, then expect each of your checks to have `selfTest.expectFail` true and an `expectMatch` that its own output matches.
6. Counts: the generated counts (README line, `docs/checks.md`) come from `node tools/gen-checks.mjs`. That belongs to the README sweep in PROJECT.md. Run it in the pull request that adds the check, not while writing the check.

## A smoke test

`node lib/gate.mjs smoke` (the `meerkat smoke` word is not wired yet) tests Meerkat, not the project: it runs each selected check on the changed files with a tiny time limit and fails when a check crashes, hangs, or none is selected for a non-empty change.

- Code: `lib/gate.mjs` (`runSmoke`, `classify`, `gateFiles`).
- Test: `lib/gate.test.ts`. Build a throwaway git repository with the `repo()` helper, define a check object like `crashes` or `hangs` (a `run` that throws or never returns), call `runSmoke` with it and the changed files, and expect the exit code from `EXIT` (`fail` for a crashed or hung check, `pass` for a check that only finds problems in the project).
- A fix to what `node lib/gate.mjs gate` selects goes in the same file with `runGate` and `gateFiles`.

## A red test

A red test attacks Meerkat itself. The suite is in `lib/redtest/`; read `lib/redtest/README.md` there for the five kinds (`mutation`, `faults`, `adversarial`, `regression`, `cleantwin`).

- A planted defect: add it to the defect list of a fake app in `tools/fake-apps`, and give its check a family in `lib/redtest/mutation.test.ts`.
- A fixed bug: add a test to `lib/redtest/regression.test.ts`, named with the CHANGELOG wording, with the fixed shape and the real shape.
- A crash or hang: add a case to `lib/redtest/faults.test.ts` (a check that throws, never returns, or loses a file) or `lib/redtest/adversarial.test.ts` (odd inputs). A known gap that is not fixed yet is written as `test.fails` with a comment, so the suite turns red when someone fixes it.
- Helpers are in `lib/redtest/harness.mjs`; build projects with `makeProject`.
- Run one kind: `node lib/redtest/run.mjs --kind <kind>`.

## A blast-radius rule

The blast radius is what `meerkat blast <file>` reports: importers, modules touched, tests that reach the target, and unresolved imports.

- Code: `lib/refactorctx.mjs` (`refactorCtx`, `parseTarget`). It is built on the code map in `lib/codemap.mjs`, which decides what an import resolves to. A rule about how files import each other (a new language, a new import form) belongs in `lib/codemap.mjs`; a rule about how the result is counted or worded belongs in `lib/refactorctx.mjs`.
- Never drop an import the map could not resolve: list it as unresolved, so the blast radius is never claimed safe by accident.
- Fixture: add sample files to `fixtures/codemap` (shared) or build a small tree in the test itself, as the "own fixture" tests do.
- Test: `lib/refactorctx.test.ts`. Add a `test(...)` that calls `refactorCtx(dir, 'src/a.js')` (or `'src/a.js#name'`) and expects the importers, tests or `unresolved` entries your rule adds. Codemap changes also get a case in `lib/codemap.test.ts`.
