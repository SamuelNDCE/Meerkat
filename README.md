<div align="center">

# Meerkat

**One command that checks your project before you ship it.**<br>
It runs the checks your project needs, shows what passed, what failed and what could not run, and saves a log of every one.

<img src="docs/images/badges/licence.svg" alt="licence: PCL 1.0"> <img src="docs/images/badges/telemetry.svg" alt="telemetry: none"> <img src="docs/images/badges/dependencies.svg" alt="dependencies: zero"> <img src="docs/images/badges/node.svg" alt="node: 20+"> <img src="docs/images/badges/checks.svg" alt="checks"> <img src="docs/images/badges/tested-on.svg" alt="tested on: Windows 11">

![Meerkat running: a progress bar with the time left, what is running now, every check with its time, and a timeline](docs/images/meerkat-run.gif)

</div>

**[Why](#why-meerkat) · [Quick start](#quick-start) · [Ways to run it](#ways-to-run-it) · [Every check](#every-check) · [What it works on](#what-it-works-on) · [Speed and your PC](#speed-and-your-pc) · [Logs](#logs-and-why-something-failed) · [Add your own check](#add-your-own-check) · [Configuration](#configuration) · [AI checks](#ai-checks) · [Privacy](#privacy) · [CI](#using-it-in-ci) · [Environment variables](#environment-variables) · [Licence](#licence)**

## Why Meerkat

"Is this safe to push?" usually means running ten commands in the right order and remembering which needs which. Meerkat is one command, built on four rules:

1. **It never passes quietly.** A tool that is not installed, a budget that is not set, a check that cannot start: each is reported as **NOT RUN**, and a run with a failure or a NOT RUN exits with an error.
2. **It proves its own checks.** `--self-test` gives every check a deliberately broken case and expects a failure, for the right reason. A check that quietly stopped working is caught.
3. **It is gentle on your PC.** Light checks run together, heavy ones run alone, and only one Rust build runs at a time.
4. **It keeps the evidence.** Every check's command, exit code, timing and full output is saved, so a failure can be understood later, by you or by an AI.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer. There is nothing to install.

```
git clone https://github.com/SamuelNDCE/Meerkat.git
```

From the folder of the project you want to check, write a starting config (it detects Cargo projects), then run:

```
node path/to/Meerkat/run.mjs --init
```

```
node path/to/Meerkat/run.mjs
```

Without a config file Meerkat picks packs that fit the folder. To watch the board without a project, play a fake run: `node preview.mjs --speed 6`.

![The board after a run with one failure: the failed check in red, a timeline of what ran when](docs/images/board-fail.png)

## Ways to run it

`--preset` picks how much to run. `--list` shows every check, and `--estimate` says how long a run should take on your PC without running anything.

| Command | What it runs | Use it |
|---|---|---|
| `node run.mjs` | every quick check (same as `--preset quick` or `fast`) | before every push |
| `--preset full` (or `thorough`) | every check, the slow ones too. It contains every quick check, or a wider version of it | before a release |
| `--preset ci` | quick security and functionality checks, no windows | on a build server |
| `--preset release` | everything, plus the AI review | before shipping |
| `--preset security-fast` / `security` / `security-ai` | the security checks: quick, all, all plus the AI audit | any time / before a release |
| `--preset functionality-fast` / `functionality` | build, type check, lints and tests: quick or all | after a change |
| `--preset ui-fast` / `ui` | the UI checks: quick or complete | after a UI change |
| `--preset app-fast` / `app` | UI and functionality together | after a feature |
| `--preset performance-fast` / `performance` | size, dependencies, start-up, memory; the full one adds response time, load and build time | after a change that could slow things down |
| `--preset refactor` | duplicated code, dead code, files too long | before a clean-up |
| `--group security,ui` | any mix of `security`, `functionality`, `ui`, `performance`, `refactor` | your own mix |
| `--only eslint,tsc` | just those checks (and what they need) | re-running one failure |
| `--include ai` | also run the opt-in checks of that name | when you want them |
| `--fail-fast` | stop at the first failure (the default is to run everything) | when you only want the first error |
| `--self-test` | proves every check still fails on a broken case | after changing Meerkat or a tool |
| `--last` / `--why <check>` / `--logs` | read back the last run: the report, one check's log, the folder | after a failure |

A focused run brings what its checks need (a UI check pulls in the build it waits for). Your own named runs go in `meerkat.config.json` under `presets`.

## Every check

Generated from the checks themselves (`node tools/gen-checks.mjs`), so it cannot drift from the code. **Weight** is how much of the machine a check needs; **Time** is the written estimate, and Meerkat learns the real time on your PC. **Opt-in** checks run only when asked for. **needs** names the tool a check wraps: without it, the check is NOT RUN and says how to install it.

<!-- checks:start -->
**63 checks** across 13 packs: 50 quick, 13 thorough, 3 opt-in. [Security 17](#security-checks) · [Functionality 27](#functionality-checks) · [UI 6](#ui-checks) · [Performance 8](#performance-checks) · [Refactor 5](#refactor-checks)

### Security checks

Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review. 17 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `actionlint` | fast | tiny | 3 s | GitHub Actions workflows (actionlint) *(needs: actionlint)* | infra |
| `bandit` | fast | light | 10 s | Bandit: common Python security mistakes *(needs: bandit)* | python |
| `dependency-pinning` | fast | tiny | 3 s | Dependencies name a fixed version, not latest or * | security |
| `hadolint` | fast | tiny | 3 s | Dockerfiles (hadolint) *(needs: hadolint)* | infra |
| `license` | fast | tiny | 2 s | A license is declared, and no copyleft dependency slipped in | hygiene |
| `lockfile-integrity` | fast | tiny | 3 s | Locked packages are fetched securely and checksummed | security |
| `risky-code` | fast | tiny | 3 s | Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http | security |
| `rust-audit` | fast | light | 4 s | Rust dependency advisories (cargo audit) | rust |
| `rust-deny` | fast | light | 10 s | Rust dependency policy: licenses, banned crates, sources (cargo deny) *(opt-in: `--include deny`)* *(needs: cargo-deny)* | rust |
| `secret-scan` | fast | tiny | 3 s | Secret scan: keys, tokens and private keys in tracked files | security |
| `sensitive-files` | fast | tiny | 2 s | No environment files, private keys or tokens are tracked | hygiene |
| `shellcheck` | fast | tiny | 3 s | Shell scripts (shellcheck) *(needs: shellcheck)* | infra |
| `unsafe-rust` | fast | tiny | 2 s | Every Rust unsafe block says why it is sound | hygiene |
| `workflow-security` | fast | tiny | 3 s | GitHub Actions: pinned actions, limited permissions, no script injection | security |
| `ai-diff-review` | thorough | light | 1.0 min | AI security review of the changes against the base branch *(opt-in: `--include ai`)* | ai |
| `ai-route-audit` | thorough | light | 5.0 min | AI audit of every route, handler and IPC channel *(opt-in: `--include ai`)* | ai |
| `npm-audit-all` | thorough | tiny | 5 s | npm audit, high severity, every dependency including dev ones | security |

### Functionality checks

Does it build, type-check, lint and pass its tests; is the repository in order. 27 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `broken-imports` | fast | tiny | 2 s | Every relative import points at a file that exists | hygiene |
| `conflict-markers` | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `env-example` | fast | tiny | 2 s | Every environment variable the code reads is documented | hygiene |
| `eslint` | fast | light | 20 s | ESLint: the project's own lint rules *(needs: eslint)* | node |
| `go-test` | fast | medium | 1.0 min | go test: the test suite *(needs: go)* | go |
| `go-vet` | fast | light | 15 s | go vet: suspicious constructs *(needs: go)* | go |
| `json-valid` | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-files` | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `links` | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `local-links` | fast | tiny | 5 s | Links between documents and files (lychee, offline) *(needs: lychee)* | docs |
| `lockfiles` | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `markdownlint` | fast | tiny | 5 s | Markdown: well-formed documents *(needs: markdownlint-cli2)* | docs |
| `markers` | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `mypy` | fast | light | 30 s | mypy: type errors *(needs: mypy)* | python |
| `prettier` | fast | tiny | 10 s | Prettier: code is formatted *(needs: prettier)* | node |
| `pytest` | fast | medium | 1.0 min | pytest: the test suite *(needs: pytest)* | python |
| `ruff` | fast | tiny | 3 s | Ruff: lint and import order *(needs: ruff)* | python |
| `rust-clippy` | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `scripts-resolve` | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
| `tsc` | fast | light | 15 s | TypeScript: no type errors *(needs: tsc)* | node |
| `typos` | fast | tiny | 3 s | Typos in code and documents *(needs: typos)* | docs |
| `whitespace` | fast | tiny | 2 s | No byte-order marks or mixed line endings | hygiene |
| `yamllint` | fast | tiny | 3 s | YAML files (yamllint) *(needs: yamllint)* | infra |
| `rust-build-release` | thorough | heavy | 5.0 min | Rust release build (cargo build --release) | rust |
| `rust-doc` | thorough | heavy | 1.0 min | Rust documentation builds without warnings (cargo doc) | rust |

### UI checks

Pages and styles: accessibility basics and valid markup. 6 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `css-contrast` | fast | tiny | 3 s | Text and background colours written together have enough contrast (WCAG 4.5:1) | ui |
| `html-structure` | fast | tiny | 3 s | Pages: one h1, headings in order, unique ids, labelled inputs, keyboard-reachable click handlers | ui |
| `htmlhint` | fast | tiny | 5 s | HTML: valid, accessible markup (htmlhint) *(needs: htmlhint)* | web |
| `meta-seo` | fast | tiny | 3 s | Pages have a title and description of a useful length | ui |
| `stylelint` | fast | tiny | 5 s | CSS: no invalid styles (stylelint) *(needs: stylelint)* | web |
| `ui-static` | fast | tiny | 2 s | Pages have alt text, a language, a title and a viewport; no empty buttons | hygiene |

### Performance checks

Size, start-up, memory, response time, load and build time, against budgets you set. 8 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `image-weight` | fast | tiny | 3 s | No image is over its size limit (default 500 KB) | ui |
| `perf-deps` | fast | tiny | 3 s | Dependency weight: direct count and installed size | performance |
| `perf-memory` | fast | light | 15 s | Memory: idle and peak use of the app and everything it starts | performance |
| `perf-sizes` | fast | tiny | 2 s | Size budgets: bundles and binaries stay under their limits | performance |
| `perf-startup` | fast | light | 15 s | Start-up time: how fast the app is ready (median of several starts) | performance |
| `perf-build` | thorough | alone | 2.0 min | Build time: the build stays inside its time budget | performance |
| `perf-endpoints` | thorough | light | 20 s | Response time: p95 of each configured endpoint | performance |
| `perf-load` | thorough | medium | 30 s | Load burst: concurrent requests to a local server, error rate and p95 | performance |

### Refactor checks

Is the code itself in good shape: duplicated code, dead code, files too long, circular imports. 5 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `circular-imports` | thorough | light | 20 s | No circular imports (madge) *(needs: madge)* | node |
| `dead-code` | thorough | light | 10 s | Dead code: exported names nothing else uses (JS and TS) | refactor |
| `dead-python` | thorough | light | 10 s | Dead Python code (vulture) *(needs: vulture)* | python |
| `duplicate-code` | thorough | light | 15 s | Duplicated code: blocks copied between files | refactor |
| `file-length` | thorough | light | 3 s | Files too long to read in one sitting | refactor |
<!-- checks:end -->

A quick check runs in `quick`. The full run contains every quick check, or a wider one that replaces it. Checks come in **packs**: `security`, `hygiene`, `rust`, `ui`, `performance`, `refactor` and `ai` need no extra tools (or only the language's own); `node`, `python`, `go`, `web`, `docs` and `infra` wrap tools you install yourself, and are switched on by adding the pack name to `packs` in `meerkat.config.json`.

## What it works on

| Your project | What you get |
|---|---|
| Anything git tracks | `security` (secret scan, risky calls, workflow and dependency checks), `hygiene` (licence, large files, lockfiles, links, imports, JSON, env documentation), `ui` (static page and style checks), `refactor` (duplicate code, file length), `performance` budgets for any command you give them |
| Rust | the `rust` pack: format, lints, tests, advisories, docs, release build, `unsafe` without a reason |
| JavaScript and TypeScript | the `node` pack: ESLint, TypeScript, Prettier, circular imports; plus unused exports and `npm audit` |
| Python | the `python` pack: Ruff, mypy, pytest, Bandit, dead code |
| Go | the `go` pack: `go vet` and `go test` |
| Web pages | the `web` pack (HTML and CSS linters) and the static `ui` checks |
| Documents and config | the `docs` pack (Markdown, typos, local links) and the `infra` pack (shell scripts, Dockerfiles, Actions workflows, YAML) |
| A running app or server | `performance` checks that start it, time it, measure its memory and load it |
| Electron apps with a window harness | an [example pack](#examples) that clicks through every page in a hidden window |

Meerkat was developed and tested on Windows 11. The checks are plain Node and the tools' own command lines, so they are expected to work on macOS and Linux too, but that has not been run.

## Speed and your PC

A run has **10 slots**. Each check takes the slots its weight says, so the machine is shared like this:

| Weight | Slots | Runs together | Typical checks |
|---|---|---|---|
| `tiny` | 1 | up to 10 | a scan, a file check, a linter on a few files |
| `light` | 2 | up to 5 | a type check, an audit |
| `medium` | 4 | 2 or 3 | a test suite, a load burst |
| `heavy` | 8 | one, plus a light one | a Rust build, a mutation test |
| `alone` | all | by itself | a build timed on purpose |

For example, one medium check can run beside five tiny ones. On top of that:

- **Order:** a check that others wait on starts first, and quick checks go ahead of it so a quick failure shows up at once.
- **Memory is read each time**, so a PC busy with something else starts fewer checks. One check can always run alone, so a run never gets stuck.
- **One Rust build at a time**, machine-wide, through a lock built into Meerkat. Several cargo builds at once once froze a machine.
- **It learns your PC.** It keeps the real time of each passing check and uses it for the order, the bar and the countdown.
- `budget.cpu` and `budget.maxParallel` in the config change the limits.

## Logs and why something failed

Every run saves a folder under `~/.meerkat/logs/runs/` (or `MEERKAT_LOG_DIR`), and never writes inside your project:

| File | For | Holds |
|---|---|---|
| `report.md` | a person | what failed and why, with the last lines of each log; what could not run; a timeline table showing when each check started, ended and what it waited for |
| `summary.json` | a program or an AI | every result with its command, exit code, start and end, duration and log path; what was chosen and skipped; the scheduler limits; the git commit and branch; the machine |
| `timeline.jsonl` | a program or an AI | one line per start and end, with the time from the start of the run |
| `<check>.log` | both | the command, folder, exit code and timing, then the complete output |

```
node run.mjs --last              print the report of the newest run
node run.mjs --why eslint        print one check's log header and the end of its output
node run.mjs --logs              print where the logs are
```

Details and the `summary.json` fields: [`docs/logs.md`](docs/logs.md).

## Add your own check

Meerkat is open on purpose. There are three ways, from smallest to biggest.

**1. Turn a check off, or swap its tool (no code).** In `meerkat.config.json`:

```json
{
  "disable": ["prettier"],
  "override": { "tsc": { "run": { "cmd": "pnpm", "args": ["tsc", "--noEmit"] } } }
}
```

**2. Add a check (a small file).** Put a `.mjs` file that exports a list of checks in a folder, and point at the folder:

```json
{ "extraChecks": ["tools/meerkat-checks"] }
```

```js
// tools/meerkat-checks/lint.mjs
export default [
  {
    id: 'lint',              // kebab-case and unique; reusing another check's id replaces that check
    group: 'functionality',  // security | functionality | ui | performance | refactor
    tier: 'fast',            // fast: before every push. thorough: before a release
    lane: 'free',            // free, cargo (one Rust build at a time) or electron (one window job at a time)
    weight: 'light',         // tiny | light | medium | heavy | alone
    title: 'ESLint, no warnings',
    estSeconds: 20,          // a guess; Meerkat learns the real time
    needs: ['eslint'],       // the tool must exist, or the check is NOT RUN
    paths: ['src/**'],       // optional: only when these changed (quick tier)
    run: { cmd: 'eslint', args: ['.', '--max-warnings=0'], cwd: 'repo' },
    selfTest: { cmd: 'eslint', args: ['--no-config-lookup', '--rule', 'no-unused-vars: error', 'fixtures/broken.js'], cwd: 'repo', expectFail: true, expectMatch: 'no-unused-vars' },
  },
]
```

**Exit 0 passes, exit 1 fails, exit 75 means "could not run here" (NOT RUN).** `run` can also be a function returning `{ ok, detail }`. `expectMatch` makes the self-test fail unless the tool rejected the file for the reason you wrote the fixture for. Check it with `node run.mjs --list`, prove it with `node run.mjs --self-test --only lint`.

**3. Wrap a well-known tool in one line.** The shipped packs use a helper for this; copy a file from `packs/` and change the names:

```js
import { tool } from '../../lib/tool-check.mjs'
export default [
  tool({ id: 'ruff', bin: 'ruff', args: ['check', '.'], fixture: ['check', '--isolated', 'fixtures/tools/ruff/broken.py'], expect: 'F401', install: 'pip install ruff', title: 'Ruff: lint', weight: 'tiny' }),
]
```

Then share it as a **pack**: a folder `packs/<name>/` with check files, switched on with `"packs": ["name"]`. Choose weights honestly: a check that reads files is `tiny`, a build is `heavy`. The full guide, with the rules for good checks, is [`docs/writing-checks.md`](docs/writing-checks.md).

**Connecting an app's own test harness** is the same thing: set a check's `run` to whatever starts that app's tests. Anyone may do this, for any app.

## Configuration

Everything is a plain file. Mistakes in a file are printed as notes and never stop a run.

| File | What it is for |
|---|---|
| `meerkat.config.json` | which checks run: `packs`, `extraChecks`, `disable`, `override`, `budget`, `presets` |
| `.meerkat-budgets.json` | numbers some checks need: performance budgets, hygiene, static and refactor limits |
| `.meerkat-secrets-allow` | secret-scan findings you have accepted (a path, or `rule: text`) |
| `.meerkat-risky-allow` | risky-code findings you have accepted (a path, or `path:line`) |
| `.meerkat-env-allow` | environment variables you do not want documented |
| `.meerkat-imports-allow` | imports the broken-imports check should ignore (a path, or `path:line`) |
| `.meerkat-dead-allow` | exported names the dead-code check should ignore |
| `~/.meerkat-theme.json` | colours, spinner and speed of the board (outside any repository) |

A performance check with no budget is NOT RUN and prints the exact lines to add:

```json
{ "perf": {
    "sizes":     [{ "path": "dist", "maxKB": 2048 }],
    "startup":   { "cmd": "node", "args": ["server.js"], "readyText": "listening", "maxMs": 3000 },
    "memory":    { "cmd": "node", "args": ["server.js"], "readyText": "listening", "maxIdleMB": 200, "maxPeakMB": 400 },
    "endpoints": [{ "url": "http://127.0.0.1:3000/health", "maxMs": 200 }],
    "load":      { "url": "http://127.0.0.1:3000/", "requests": 500, "concurrency": 20, "maxP95Ms": 500 },
    "build":     { "cmd": "npm", "args": ["run", "build"], "maxSeconds": 120 } },
  "refactor": { "maxDuplicatePct": 10, "maxFileLines": 2000 },
  "static": { "maxImageKB": 500, "minContrast": 4.5 } }
```

The load burst only aims at this machine unless you add `"allowRemote": true`, so it cannot hammer a live server by mistake. More: [`docs/customizing.md`](docs/customizing.md).

**Setting up the licence check.** It fails until the repository says how others may use it. Pick a licence ([choosealicense.com](https://choosealicense.com) explains the common ones), save its text as `LICENSE`, and put the same name in `package.json` (`"license": "MIT"`) or `Cargo.toml` (`license = "MIT"`). It also lists installed dependencies under a copyleft licence (GPL, AGPL and similar) so you can decide whether that fits how you ship. Meerkat flags these; it does not give legal advice.

## AI checks

Two opt-in checks use an AI model, because some problems are about meaning, which patterns cannot see: whether a route that deletes data checks who is asking, whether user input can reach a shell command, whether a change quietly weakens a rule.

- `ai-route-audit` finds every HTTP route, IPC channel and command handler by pattern (`node thorough/ai.mjs routes` lists them and sends nothing), then asks a model to look for missing authentication, injection, path traversal and logic bugs in each.
- `ai-diff-review` does the same for what changed against your main branch.

A model can miss things and can be wrong: it is an extra reader, not a gate to rely on alone. How they stay safe:

- **Off unless you ask** (`--include ai`), and **they do not run at all** when no model can be reached or no key or login is found. The result is NOT RUN, never a pass.
- **They say what they will send, and to which model, before sending.** Secret-looking values are blanked first, and if anything in a known secret format is found, nothing is sent. Files like `.env` and `*.pem` are never included.
- **Your model, your choice.** By default your own Claude Code login, with every tool, hook and skill switched off, started in an empty folder. Set `MEERKAT_AI_CMD` (a JSON array: a command that reads a prompt on stdin and prints an answer) to use another model, such as one behind an OpenRouter key. The command comes only from the environment or `~/.meerkat-ai.json`, never from the repository being checked.
- **Strict answers.** The model must reply only with `FINDING: <severity> | <where> | <what>` lines or `OK`. Any other reply, too many routes, or a diff too large to cover is NOT RUN, so a partial review is never reported as a pass.
- The code is wrapped in a random marker and described to the model as data, never instructions.

## Privacy

Meerkat does not collect or send anything about you, your projects or your machine, and its own code makes no network calls at all (a test enforces this). The tools it runs may: `npm audit` and `cargo audit` ask their registries, and the performance checks call only the URLs you put in your budgets. The AI checks send code to a model only when you turn them on, and say so first.

## Using it in CI

Meerkat exits non-zero on any failure or NOT RUN, and writes `summary.json` for every run. A minimal GitHub Actions job:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: git clone https://github.com/SamuelNDCE/Meerkat.git "$RUNNER_TEMP/meerkat"
- run: node "$RUNNER_TEMP/meerkat/run.mjs" --init
- run: node "$RUNNER_TEMP/meerkat/run.mjs" --preset ci --json meerkat.json
```

## Environment variables

| Variable | Meaning |
|---|---|
| `MEERKAT_LOG_DIR` | where run logs go (default `~/.meerkat/logs`) |
| `MEERKAT_APP_DIR` | the folder to check, if not given with `--app` |
| `MEERKAT_BASE` | the branch changes are measured against (default: what `origin/HEAD` points at, else `main`, `master`, `dev`) |
| `MEERKAT_PLAIN=1` | plain lines instead of the live board |
| `NO_COLOR` | no colour |
| `MEERKAT_PROFILE` | a named set of limits for a slower PC |
| `MEERKAT_TIMINGS`, `MEERKAT_HISTORY`, `MEERKAT_STATUS`, `MEERKAT_THEME_FILE` | where the learned times, run history, live status and board theme are kept |
| `MEERKAT_CARGO_LOCK`, `MEERKAT_CARGO_LOCK_DIR`, `MEERKAT_LOCK_MAX_WAIT` (older name `CARGO_LOCK_MAX_WAIT`) | use your own cargo lock script; move the built-in lock; how long a job waits for it (seconds, default 900) |
| `MEERKAT_FONT` | a `.ttf` file for `tools/screenshot.py`, which draws the board's pictures |
| `MEERKAT_AI_CMD`, `MEERKAT_AI_BASE` | the model command for the AI checks (a JSON array); the branch the diff review compares with |

The old `NV_VERIFY_*` names are still read.

## Examples

`examples/neuralvault/` holds the checks of one real app, an Electron and Rust desktop app that clicks through every page in a hidden window, runs fuzzing and mutation tests, and queues its window and Rust jobs. It is there to copy from, and it is switched on like any pack (`"packs": ["neuralvault"]`). Its own notes are in `examples/neuralvault/docs/`.

## Licence

Meerkat is under the [Perpetual Community Licence 1.0](LICENSE), written for this project and meant to be for people rather than for companies to take from:

- **People** can use, change and share it for anything, free.
- **Organisations** can use it free too, but must say publicly that they use it, with a link to this repository.
- **Nobody may sell Meerkat itself**, or run it as a paid service for others. A company that builds it into its own product and sells *that* may, if it credits Meerkat and links here. Extensions you write for it are yours to sell.
- **No telemetry**, and nothing is sent to an AI model unless you turn that check on.

The numbered terms in [`LICENSE`](LICENSE) are what counts; the summary above is only a guide. [`docs/licence-notes.md`](docs/licence-notes.md) shows how the text was compared with Apache 2.0, MPL 2.0, Elastic 2.0, PolyForm Shield and the Business Source License, and what is still open. It is not open source in the strict sense (it restricts selling), and it has not been reviewed by a solicitor.

## Project layout

| Path | What is in it |
|---|---|
| `run.mjs` | the command line |
| `packs/` | the packs: each a folder of check files |
| `thorough/` | the zero-dependency scripts the packs call (scanners, budgets, static checks, AI) |
| `lib/` | the scheduler, lock, logs, config, presets, estimate and the board (`lib/tui/`) |
| `fixtures/` | the small broken files every check proves itself on |
| `examples/` | the checks of one real app, with its docs |
| `docs/` | [writing checks](docs/writing-checks.md), [logs](docs/logs.md), [customizing](docs/customizing.md), [every check](docs/checks.md), [licence notes](docs/licence-notes.md) |
| `tools/` | makes the check list, the badges, the screenshots and the GIF |

Meerkat's own tests: `npm test`. After adding or changing a check, run `node tools/gen-checks.mjs` to refresh the list above. Rules for working in this repository: [`PROJECT.md`](PROJECT.md).
