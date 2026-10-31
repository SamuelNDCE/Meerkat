# Writing checks

A check is a small object that says what to run and how to tell it failed. This page is the full reference; the [README](../README.md#add-your-own-check) has the short version.

## Three ways in

1. **Change an existing check** in `meerkat.config.json` (`disable`, `override`): no code.
2. **Add a check** in a file of your own, listed under `extraChecks`.
3. **Add a pack**: a folder `packs/<name>/` of check files that anyone can switch on with `"packs": ["name"]`.

## The shape of a check

```js
export default [
  {
    id: 'lint',
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    weight: 'light',
    title: 'ESLint, no warnings',
    estSeconds: 20,
    needs: ['eslint'],
    install: 'npm i -D eslint',
    after: [],
    paths: ['src/**'],
    optIn: undefined,
    timeoutSeconds: 600,
    run: { cmd: 'eslint', args: ['.'], cwd: 'repo', env: {} },
    selfTest: { cmd: 'eslint', args: ['fixtures/broken.js'], cwd: 'repo', expectFail: true, expectMatch: 'no-unused-vars' },
  },
]
```

| Field | Meaning |
|---|---|
| `id` | kebab-case and unique. Another check with the same id is replaced |
| `group` | the kind: `security`, `functionality`, `ui`, `performance` or `refactor`. `--group` and the presets select by it |
| `tier` | `fast` runs in `quick`; `thorough` runs only in `full` |
| `lane` | `free` runs beside others; `cargo` takes the Rust lock; `electron` takes the window lock |
| `weight` | `tiny`, `light`, `medium`, `heavy` or `alone`: how much of the machine it needs (10 slots per run). No weight means the lane's usual one. `cost: { cpu, memGB }` sets exact numbers instead |
| `title` | one plain line saying what it checks |
| `estSeconds` | a guess. Meerkat learns the real time and uses that |
| `needs` | programs that must exist (on PATH or in `node_modules/.bin`). A missing one makes the check NOT RUN |
| `install` | the line shown when a `needs` program is missing |
| `after` | ids that must pass first (a build, say) |
| `paths` | globs: in the quick tier the check runs only when a changed file matches |
| `optIn` | a name: the check runs only with `--include <name>` |
| `timeoutSeconds` | a hard limit (default 600) |
| `run` | `{ cmd, args, cwd, env }`, or a function `(ctx) => ({ ok, detail })`. `cwd` is `repo` or `app`. `{repo}` and `{app}` expand inside `args` and `env` |
| `selfTest` | the same shape, aimed at a deliberately broken case. `expectFail: true` means it must fail. `expectMatch` is a regex the output must match, so it fails for the right reason. `cwd: 'meerkat'` runs from Meerkat's own folder, where `fixtures/` is |

## What a command's exit code means

| Exit code | Result |
|---|---|
| 0 | PASS |
| 1 (or any other non-zero) | FAIL |
| 75 | NOT RUN: it could not start here (a tool, service or setting is missing). Print `NOT RUN: <why>` as the last line |

A run with a FAIL or a NOT RUN exits with an error. That is the point: nothing is skipped to look green.

## One check, many rules

A check that tests many rules can report each on its own by printing `MEERKAT-SUB <PASS|FAIL|NA> <rule-id> <reason>` lines to stdout; the exit code still decides. Declare `subs: <number of rules>` on the check so the catalogue counts it, and optionally `suite: '<suite>'` to choose its suite. See docs/suites.md.

## Rules for good checks

- **Say exactly what is wrong.** The last line of output is the reason shown in the table, so print the one problem that matters last.
- **Prove it.** Give it a `selfTest` with a small broken file in `fixtures/`, and an `expectMatch` for the reason it must fail.
- **Never pass because something was missing.** If a tool, file or setting is absent, exit 75.
- **Weight honestly.** A check that reads files is `tiny`. A build is `heavy`. If two heavy checks would collide (two Rust builds), use the `cargo` lane.
- **Keep it fast and offline.** A check that needs the network should say so in its title and be opt-in.
- **No machine paths, no secrets.** Use `{repo}` and `{app}`, and environment variables.

## Wrapping a tool

`lib/tool-check.mjs` turns a tool into a check in one call. The shipped packs under `packs/` are all written this way:

```js
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({
    id: 'ruff',
    bin: 'ruff',
    args: ['check', '.'],
    fixture: ['check', '--isolated', 'fixtures/tools/ruff/broken.py'],
    expect: 'F401',
    install: 'pip install ruff',
    title: 'Ruff: lint and import order',
    weight: 'tiny',
    paths: ['**/*.py'],
  }),
]
```

For tools that want file names and not a folder, add `onFiles: '\\.sh$'`: Meerkat runs the tool over the tracked files that match.

## Writing a script a check calls

The scripts in `thorough/` are the pattern for checks that need no tool. Each one:

- takes `<check>` and an optional `--root <dir>`;
- has a `--fixtures` mode that builds a throwaway folder containing one deliberate problem, runs the check on it, and exits with the check's own code (it must be 1);
- uses `thorough/kit.mjs` for the tracked-files list, the budgets file, and printing findings.

## Testing a check

```
node run.mjs --list                      does it load, with the weight and time you expect
node run.mjs --self-test --only lint     does it fail on the broken case, for the right reason
node run.mjs --only lint                 does it pass on your project
node run.mjs --why lint                  what did it print
```

A check file that fails to load becomes one failing check that names the file, so a broken module can never make a run look clean.

## When the check does not apply

A check about one kind of file (Go, Cargo, Terraform) sets `appliesTo` to the globs of those files (the `tool()` helper uses its `paths`). A folder with none of them gets a PASS that says `not applicable: ...` and the tool is never started. A check written as a script prints `not applicable: <why>` and exits 0 in the same case. Use NOT RUN (exit 75) only for a missing tool, a missing git repository or a missing setting. `node tools/compat-matrix.mjs` proves it on 20 sample projects (docs/compatibility.md).

## Reporting findings

A check can say exactly what it found, and where, by printing `MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>` lines (in `thorough/kit.mjs`: `finding(severity, ruleId, file, line, message)`). Meerkat compiles them into `findings.json` with the rule, the check that found it and whether it is new. Without them it reads `path:line message` lines from a failed check's output. Optional check fields `severity` and `fix` set the default severity and a fix hint. Protocol and schema: [findings.md](findings.md).
