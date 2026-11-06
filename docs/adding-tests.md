# Adding tests to Meerkat

The first part below is for people who extend Meerkat on their own project. The rest is for people who change Meerkat. Each section names the file to edit and the test to add. For the full field list of a check, read [writing-checks.md](writing-checks.md). For the folder layout, read [developers.md](developers.md).

Before a pull request, run `npx vitest run <file>` for the file you touched, then `node run.mjs --app . --preset quick --plain`. It must show no failures.

## Extend Meerkat with your own checks

Legend: OK works / PARTIAL works with limits / PLANNED not built.

| I want to | How | Status |
|---|---|---|
| Run a project command as a check, no JavaScript | `customChecks` in `meerkat.config.json` | OK |
| Write a check in JavaScript | A pack file | OK |
| Add a pack | `meerkat pack add`, `meerkat pack enable` | OK |
| Choose groups and packs for a run | A preset | OK |
| Click through my app's UI | A window check that you write per app | PARTIAL: no generic built-in click-through |
| Find my existing scripts | `meerkat discover` | OK |
| See custom checks over MCP | `meerkat_list` | PARTIAL: should appear, not fully verified |

### 1. A command, no JavaScript

Add `customChecks` to `meerkat.config.json`. Keys: `cmd`, `args`, `suite`, `group`, `tier`, `cwd`, `timeoutSeconds`, `weight`, `needs`, `install`. Code: `lib/customchecks.mjs`. `meerkat check new` creates one in a single line.

### 2. A check in JavaScript (a pack file)

A pack file is a `.mjs` whose default export is an array of checks. `lib/load-checks.mjs` validates each one.

- Required: `id` (kebab-case), `group` (security, functionality, ui, performance or refactor), `tier` (fast or thorough), `lane` (free, cargo, electron or windows), `title`, and `run` (a function, or `{cmd, args, cwd}`).
- Optional, validated if present: `weight`, `suite`, `subs`, `scale`, `severity`, `fix`.
- Not validated, but required by Meerkat's own proof rule: a `selfTest` with `expectMatch`.

A complete example is `packs/a11y/a11y.mjs`. Its `make()` helper shows the shape: `run: { cmd: 'node', args: [SCRIPT, id], cwd: 'repo' }`, and a `selfTest` that runs the same script with `--fixtures`.

### 3. Add the pack

```
meerkat pack add <folder>
```

```
meerkat pack enable <name>
```

`pack enable` writes the packs list to `meerkat.config.json`. Per-user settings live in `~/.meerkat.json`, or in the file named by the `MEERKAT_USER_CONFIG` environment variable. The lookup order is in `applyConfig` in `lib/config.mjs`.

### 4. A preset

```
meerkat preset new
```

A preset selects groups and packs. It does not register checks: a check must already be in an enabled pack or in `customChecks`. The built-in presets are in `lib/presets.mjs`.

### 5. A suite

A check is listed under its suite. Set the check's `suite` field, or add an entry to `CHECK_SUITE` or `PACK_SUITE` in `lib/suites.mjs`. With neither, it is listed under "other".

### 6. Click-through UI steps

Meerkat has no generic built-in headless UI click-through. Each app needs its own steps. You write the click path for your app; Meerkat runs it and reports.

The mechanism is a window check: lane `electron` or `windows`, with a `weight`. Window checks run only with `--include windows` or `MEERKAT_WINDOWS=1` (`windowsOn` in `lib/runner.mjs`; [reference.md](reference.md)). Otherwise they are listed as skipped, not as failures. The worked example is `examples/neuralvault/screens-checks.mjs`. It is NeuralVault's own and specific to that project: copy its structure, not its steps.

### 7. Let Meerkat find your scripts

`meerkat discover` reads `package.json` scripts, the Makefile, Playwright and Cypress configs, and `scripts/`. Turn it off with `"discover": false` in config. Details: [discover.md](discover.md).

### 8. Prove it

Give every new check a `selfTest` on a small broken sample, with `expectFail: true` and an `expectMatch`. `expectMatch` must match the output of the broken case. PASS means the broken case was caught (`lib/runner.mjs`); a check that fails for another reason does not pass. For a script built on `thorough/kit.mjs`, use `withFixture` to build the broken sample and `main` to run it; the script then accepts `--fixtures`.

```
node run.mjs --self-test
```

### 9. MCP

`meerkat_run` and `meerkat_list` (`lib/mcp.mjs`) should show checks from packs and config. Confirm with `meerkat_list`. This was only partly verified.

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
