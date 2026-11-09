<div align="center">

# Meerkat

<img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/version.svg" alt="version"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/licence.svg" alt="licence"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/planted-defect-recall.svg" alt="planted-defect recall"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/checks.svg" alt="checks"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/sub-checks.svg" alt="sub-checks"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/suites.svg" alt="suites"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/dependencies.svg" alt="dependencies"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/telemetry.svg" alt="telemetry"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/node.svg" alt="node"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/tested-on.svg" alt="tested on"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/works-with.svg" alt="works with">

<a href="https://www.npmjs.com/package/@samuelndce/meerkat"><img src="https://img.shields.io/npm/v/@samuelndce/meerkat" alt="npm version"></a> <a href="https://github.com/SamuelNDCE/Meerkat"><img src="https://img.shields.io/github/stars/SamuelNDCE/Meerkat" alt="GitHub stars"></a><br>
[npm package](https://www.npmjs.com/package/@samuelndce/meerkat) | [GitHub repository](https://github.com/SamuelNDCE/Meerkat) | Install: `npm install -g @samuelndce/meerkat`

**A scanner for people, and a tool and scaffolding for AIs.**<br>
Meerkat checks, maps and tests a project: security, correctness, accessibility, performance and code health, with every result saved and explained.

![Meerkat running: what is running now, a status line, every check with its time, and a timeline](https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/meerkat-run.gif)

<sub>Sample data: a made-up project, drawn by Meerkat's real screens.</sub>

</div>

## What is new in 0.5.3

This release refines the workflows (batch gating, frontend checks, verdict JSON) and improves how an AI uses the tool. Please re-read the docs, starting with [docs/batch.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) and [docs/neuralvault-gate.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault-gate.md). The full list is in [CHANGELOG.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CHANGELOG.md).

- `meerkat batch` gates several branches in one run and names the culprit.
- `meerkat frontend` runs typecheck, test and build steps from a trusted commands block.
- Verdict JSON carries `checks` rows, `behindBy`, `unmatchedKnown` and a verdict word that matches the exit code.

## 💡 Why Meerkat

- **One command, an honest answer.** `meerkat verify` works out what applies to your project and says whether it is safe to ship. A check that could not run is NOT RUN, and the run fails.
- **Two ways to use it.** Standalone in a terminal (no AI, no account, no network), or with an AI over MCP, which uses the same checks to verify its own work.
- **Read-only and private.** It never edits your project, has no telemetry, and uploads nothing.

## 🚀 Quick start

You need [Node.js](https://nodejs.org) 20 or newer. No other dependencies. Three commands, run in a git repository:

```
npm install -g @samuelndce/meerkat
```

```
meerkat gate
```

```
meerkat verdict --base main
```

`gate` runs the checks that match the files you changed and prints a summary like this (a branch with one new file):

```
MEERKAT gate: 3 blocking, 9 pre-existing (not in the change), 209 passed, 0 not run, exit 1, scanned b.js, 5.5s
FAIL  risky-code (1)
FAIL  unused-files (1)
FAIL  js-eqeqeq (1)
```

`verdict` gives the one-line answer for the branch, for example `FAIL 3 blocking in changed files` (the section below explains each answer). `meerkat verify` is the quick everyday run, `meerkat full` adds the slow checks, `meerkat last` shows the saved results, `meerkat why <check>` shows one check's log and `meerkat findings` lists every finding, worst first. Exit codes for `verdict`, `top`, `batch` and `gate`: 0 pass, 1 fail, 2 nothing judged or a usage error, 75 incomplete (never a pass). Every command: [commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md).

## 🏁 Is this branch safe to merge?

`meerkat verdict` answers with one line and an exit code. It counts only findings in files the branch changed.

```
meerkat verdict --base origin/main
```

```
FAIL 3 blocking in changed files
```

- `--base <ref>` is the branch to compare with (default: main or master). `--json` prints one object: `schema`, `verdict`, `exitCode`, `blocking`, `preExisting`, `known`, `knownFindings`, `stale` (also `unmatchedKnown`, the same value), `behindBy`, `checksTotal`, `checksFinished`, `skippedByPath` and a `checks` array (status, seconds, cached, detail, places). The verdict word matches the exit code: PASS 0, FAIL 1, NO-RESULT 2, INCOMPLETE 75.
- `--first` prints only the first blocking `file:line: message`, or `PASS`. `--ready` prints one `READY` or `NOT READY` line. `--branches a b` prints one verdict line per branch.
- Findings the branch did not add (already on the base, or outside the diff) do not fail the verdict: it prints `PASS` and a second line `pre-existing: N (not in this diff, does not block)`. Exit 1 only for a new blocking finding in a changed file.
- `--known <file>` is a JSON list of failures your team accepted, `[{ "check", "file", "line"? }]`. A match is printed as `KNOWN` and does not block; an entry that matches nothing is printed as `STALE`.
- `NO-RESULT: <reason>. next: <step>` means there is no answer (nothing changed, a bad ref, a timeout). It is never a pass.
- `INCOMPLETE n of m checks finished, not a pass` means the run stopped early. Exit 75.

## 📋 The worst findings in your change

`meerkat top` prints one table of the worst findings in the files this branch changed, worst first (`--limit`, default 10).

```
meerkat top --base origin/main
```

```
file  check         line  message
----  ------------  ----  -------
b.js  risky-code    2     eval() runs text as code
b.js  js-eqeqeq     2     uses ==, which converts types before comparing
b.js  unused-files  -     is not imported by any file and is not an entr
```

## 🔨 Your repo's test and build commands

`meerkat commands` lists the repo's own test, build and typecheck commands from the `commands` block of `meerkat.config.json`, or from the `package.json` scripts when there is no block. It runs nothing. `meerkat trust` approves the block, after which `meerkat build` runs `commands.build` and `meerkat test` runs `commands.test` (with no `commands.test` set, `meerkat test` is the same as `meerkat verify`).

```
meerkat commands
```

```
no commands block (there is no meerkat.config.json); these are the package.json scripts (nothing here is run):
test   npm run test   (runs: node --test)
build  npm run build   (runs: node -e 0)
to pin them: add { "commands": { "test": "npm run test", "build": "npm run build" } } to meerkat.config.json, then run meerkat trust
```

In a monorepo with no root scripts the first line is instead `no commands block (there is no meerkat.config.json) and no root scripts; these are the scripts of the packages one level down (nothing here is run):`, followed by rows like `packages/a  test  npm --prefix packages/a run test   (runs: echo)`.

## 🧰 More commands for a branch

Each is described in [commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md).

- `meerkat fix`: a patch for a finding when its check can fix it safely. A dry run unless you add `--apply`.
- `meerkat handoff`: one short file a new session can resume from.
- `meerkat test-run`: run one test file or test name with a time limit, through the repo's own runner.
- `meerkat lock status`: who holds the machine-wide cargo lock and who waits.
- `meerkat who-calls`, `meerkat deps` and `meerkat tests-for`: ask the code map who calls a function, what a file imports and which tests cover it.

## 🤏 Short output by default

`meerkat gate` prints one summary line, one line per failed check (its name and count) and the log folder. `--full` lists every finding, and `findings.json` in the run folder always has them all. The MCP tools `meerkat_summary` and `meerkat_gate` are short in the same way, which keeps an AI's context small; `full: true` asks for everything.

## ⏱ Progress and timeouts

`verdict` and `top` print one progress line per check on stderr, `[12/218] risky-code ... 0.2s FAIL`, and `still running after 30s: <check>` for a slow one. The answer goes to stdout, so piping it is safe. They give up after the overall limit (1500 seconds by default) with `NO-RESULT: the gate did not finish in 1500s`. Raise the limit with `MEERKAT_VERDICT_TIMEOUT_S` (seconds), or stop a run on purpose with `--max-seconds`, which ends in `INCOMPLETE`. More: [docs/faq.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/faq.md).

## 🤖 Using Meerkat from an AI assistant

`meerkat mcp install` registers the MCP server with Claude Code; the AI then calls the same checks as tools. Tools that read a run take `folder`, `run` and `preset`, and a NOT RUN is never a pass. Guide: [docs/ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md), and for NeuralVault [docs/neuralvault.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md).

## 🧩 Features at a glance

| Feature | What it does |
|---|---|
| [🔍 Checks and presets](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#checks-and-presets) | Runs the checks that fit your project; presets pick a set (`quick`, `bugs`, `full`, `ci`, `release`) |
| [🚦 Gate on changed files](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#gate) | Runs only the checks matching the files you changed; only failures in those files block |
| [🏁 Branch verdict](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | One line for a branch: `PASS` or `FAIL`; findings the branch did not add are counted, not blocking |
| [💨 Smoke](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#smoke) | Proves the checks chosen for your changes start and stop in time (it tests Meerkat, not your project) |
| [💥 Blast radius and brief](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#blast-radius) | What an edit to a file or symbol affects, and a one-call pre-edit brief |
| [🗺 Codebase map](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md) | Files, functions with line numbers, routes, tests and imports; only changed files are re-read |
| [🧭 Workflow profiles](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#workflow-profiles) | `meerkat init --profile` prints a starting config for solo, team, ai-agent, legacy, monorepo or ci-only |
| [📝 Memory hook](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md) | Hands the newest run to an adapter you name in the config, outside the project |
| [🧪 Red testing and benchmark](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md) | Attacks Meerkat with planted bugs and measures false alarms on real Rust code (repository checkout only) |
| [🔌 MCP server and skills](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md) | Offers the checks to an AI as tools, resources and prompts, with short guides for when to use them |
| [🖱 Click-through](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md) | Opens your real app and presses controls through a driver you supply |
| [🪝 Hook safety](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#hook-safety) | A git pre-push hook that runs the quick preset; removable cleanly |

<!-- counts:start -->
**403 checks · 1446 sub-checks · 50 suites.** A check is one scan or tool run; a sub-check is one rule inside it, so a failure names the exact rule. These are the checks Meerkat ships: any you add yourself are extra.
<!-- counts:end -->

## 🎯 Accuracy (summary)

Measured 2026-11-06 with `tools/corpus/gen-planted.mjs`, `tools/corpus/measure.mjs` (planted bugs and clean twins) and `benchmarks/real-rust/measure.mjs` (real code).

- Planted-bug recall, default run: 99.77% (1735 of 1739). The 4 misses are lock-unwrap defects, hidden by design in the default run. Pedantic run (`--all`): 100%.
- False alarms on real code (NeuralVault Rust benchmark): 4.6%, 6 of 130 labelled findings were false. On clean twins: 0 of 1739.
- Real-code mutation run (200 mutants): default 37%, all rules 98%.

**Caveat.** The planted corpus is built from each rule's own samples, so high recall there shows the rules do what they were written to do, not that they find every real bug. The real-code numbers matter more, and they cover one project in one language. Details: [docs/accuracy.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md).

## ⚠ Known limits

- Rust findings are leads to check, not verdicts; the false-alarm figure is from one project.
- Click-through: the driver protocol is built, but the reference drivers have not run against a real app, so treat the shipped examples as unproven ([guide](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md)).
- `meerkat update` and the trusted-publishing workflow are unit-tested but not verified in this build against a real newer published release.
- Red testing, the real-code benchmark and the release tools run from a repository checkout. The advisory scan (an offline match of declared packages against an advisory snapshot) is planned and not built as a command.
- The smoke and red test files run on a copy of a small fixture project, not on yours ([details](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md#smoke-and-red-suites)).
- If Meerkat reports something fine, open a [false alarm](https://github.com/SamuelNDCE/Meerkat/issues/new?template=false-positive.yml) issue; if it misses a real problem, open a [missed problem](https://github.com/SamuelNDCE/Meerkat/issues/new?template=missed-bug.yml) issue.

## ✅ What it does

- Scans for bugs, security problems, accessibility, performance and code health: [capabilities.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/capabilities.md)
- Runs only the checks that match your changed files (`meerkat gate`): [features.md#gate](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#gate)
- Answers "is this branch safe to merge?" in one line: [commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md)
- Shows what an edit would affect before you make it: [features.md#blast-radius](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#blast-radius)
- Maps your codebase for people and AIs: [codemap.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md)
- Saves every run with a log per check and one findings file: [logs.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/logs.md), [findings.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/findings.md)
- Runs your own tests and build commands once you approve them: [discover.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/discover.md)
- Works as an MCP server and skill for AI assistants: [ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md)
- Takes your own checks, packs and presets: [extending.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/extending.md)

## 🚫 What it does not do

- It never edits your project, sends telemetry or uploads anything.
- It does not scan declared packages for known vulnerabilities by itself yet. That is planned: [issue #26](https://github.com/SamuelNDCE/Meerkat/issues/26).
- A clean run does not prove the code is bug-free: it covers what the checks can see ([coverage.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/coverage.md)).
- It does not treat a check that could not run as a pass: that is NOT RUN, and the run fails.

## 📚 All the docs

- **Getting started:** [how-to.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/how-to.md) (short daily guide), [discover.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/discover.md) (finding your project's own tests), [customizing.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/customizing.md)
- **Daily use:** [everyday.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/everyday.md), [findings.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/findings.md), [logs.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/logs.md), [scheduling.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/scheduling.md), [editor.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/editor.md) (use Meerkat from your editor), [tiers.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/tiers.md) (time limits), [github.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/github.md) (GitHub Actions)
- **Batch gating (one gate for several branches):** [batch.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md)
- **Commands:** [commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md), [checks.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/checks.md) (every check, generated)
- **Capabilities:** [capabilities.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/capabilities.md), [features.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md), [suites.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/suites.md), [codemap.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md), [coverage.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/coverage.md), [compatibility.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/compatibility.md), [functionality-run.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/functionality-run.md), [robustness.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/robustness.md), [mutation.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/mutation.md), [click-through.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md)
- **Accuracy:** [accuracy.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md), [accuracy-results.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy-results.md), [readme-accuracy-section.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/readme-accuracy-section.md)
- **NeuralVault gate page:** [neuralvault-gate.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault-gate.md)
- **AI use (MCP, skills, NeuralVault):** [ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md), [for-ai-agents.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/for-ai-agents.md), [neuralvault.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md)
- **Extending:** [extending.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/extending.md), [writing-checks.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/writing-checks.md), [adding-tests.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/adding-tests.md), [developers.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/developers.md), [CONTRIBUTING.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CONTRIBUTING.md)
- **Reference:** [reference.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/reference.md) (the full manual), [credits.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/credits.md), [licence-notes.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/licence-notes.md)
- **FAQ:** [faq.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/faq.md)
- **Release:** [release.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/release.md), [CHANGELOG.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CHANGELOG.md)

Licence: [Perpetual Community Licence 1.0](https://github.com/SamuelNDCE/Meerkat/blob/main/LICENSE) ([notes](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/licence-notes.md)). Security problems: [SECURITY.md](https://github.com/SamuelNDCE/Meerkat/blob/main/SECURITY.md).
