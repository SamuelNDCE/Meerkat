<div align="center">

# Meerkat

<img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/version.svg" alt="version"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/licence.svg" alt="licence"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/planted-defect-recall.svg" alt="planted-defect recall"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/checks.svg" alt="checks"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/sub-checks.svg" alt="sub-checks"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/suites.svg" alt="suites"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/dependencies.svg" alt="dependencies"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/telemetry.svg" alt="telemetry"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/node.svg" alt="node"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/tested-on.svg" alt="tested on"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/works-with.svg" alt="works with">

<a href="https://www.npmjs.com/package/@samuelndce/meerkat"><img src="https://img.shields.io/npm/v/@samuelndce/meerkat" alt="npm version"></a> <a href="https://github.com/SamuelNDCE/Meerkat"><img src="https://img.shields.io/github/stars/SamuelNDCE/Meerkat" alt="GitHub stars"></a>

[npm package](https://www.npmjs.com/package/@samuelndce/meerkat) · [GitHub repository](https://github.com/SamuelNDCE/Meerkat)

**A scanner for people, and a tool and scaffolding for AIs.**<br>
Meerkat checks, maps and tests a project: security, correctness, accessibility, performance and code health. Every result is saved and explained.

![Meerkat running: what is running now, a status line, every check with its time, and a timeline](https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/meerkat-run.gif)

<sub>Sample data: a made-up project, drawn by Meerkat's real screens.</sub>

</div>

## Install

Requires [Node.js](https://nodejs.org) 20 or newer. No other dependencies.

```bash
npm install -g @samuelndce/meerkat
```

## What is new in 0.5.3

- `meerkat batch` gates several branches in one run and names the branch that causes a failure.
- `meerkat frontend` runs typecheck, test and build steps from a trusted commands block.
- Verdict JSON carries per-check rows, `behindBy`, and a verdict word that matches the exit code.

Full list: [CHANGELOG.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CHANGELOG.md). Read [docs/batch.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) and [docs/neuralvault-gate.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault-gate.md) first.

## Why Meerkat

- **One command, an honest answer.** `meerkat verify` works out what applies to your project and says whether it is safe to ship. A check that could not run is reported as NOT RUN, and the run fails.
- **Two ways to use it.** On its own in a terminal (no AI, no account, no network), or with an AI over MCP, which runs the same checks to verify its own work.
- **Read-only and private.** It never edits your project, has no telemetry, and uploads nothing.

## Quick start

Run these in a git repository:

```bash
meerkat gate
```

`gate` runs the checks that match the files you changed and prints a summary like this (a branch with one new file):

```
MEERKAT gate: 3 blocking, 9 pre-existing (not in the change), 209 passed, 0 not run, exit 1, scanned b.js, 5.5s
FAIL  risky-code (1)
FAIL  unused-files (1)
FAIL  js-eqeqeq (1)
```

Other everyday runs: `meerkat verify` (quick), `meerkat full` (every check, including the slow ones), `meerkat last` (show the saved results).

## Is this branch safe to merge?

```bash
meerkat verdict --base origin/main
```

```
FAIL 3 blocking in changed files
```

The verdict counts only findings in files the branch changed.

| Answer | Meaning | Exit |
|---|---|---|
| `PASS` | Nothing new blocks. Pre-existing findings are listed as `pre-existing: N (does not block)`. | 0 |
| `FAIL n blocking in changed files` | A finding the branch added. | 1 |
| `NO-RESULT: <reason>. next: <step>` | No answer: nothing changed, a bad ref, or a timeout. Never a pass. | 2 |
| `INCOMPLETE n of m checks finished` | The run stopped early. Never a pass. | 75 |

Options: `--base <ref>`, `--json` (one object, with `checks` rows), `--first`, `--ready`, `--branches a b`, and `--known <file>` for failures your team has accepted.

## The worst findings in your change

```bash
meerkat top --base origin/main
```

```
file  check         line  message
----  ------------  ----  -------
b.js  risky-code    2     eval() runs text as code
b.js  js-eqeqeq     2     uses ==, which converts types before comparing
b.js  unused-files  -     is not imported by any file and is not an entry point
```

## Features at a glance

| Feature | What it does |
|---|---|
| [Checks and presets](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#checks-and-presets) | Runs the checks that fit your project. Presets pick a set: `quick`, `bugs`, `full`, `ci`, `release`. |
| [Gate on changed files](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#gate) | Runs only the checks for the files you changed. Only failures in those files block. |
| [Branch verdict](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | One line for a branch: `PASS`, `FAIL`, `NO-RESULT` or `INCOMPLETE`. |
| [Batch gating](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) | Gates several branches in one run and names the one that fails. |
| [Frontend steps](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | Typecheck, test and build steps from a block you approve. A step with no test file is skipped, never passed. |
| [Smoke](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#smoke) | Checks that the checks chosen for your changes start and stop in time. Tests Meerkat, not your project. |
| [Blast radius and brief](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#blast-radius) | What an edit to a file or symbol affects, and a brief before you edit. |
| [Codebase map](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md) | Files, functions with line numbers, routes, tests and imports. Only changed files are re-read. |
| [Workflow profiles](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#workflow-profiles) | `meerkat init --profile` gives a starting config: solo, team, ai-agent, legacy, monorepo or ci-only. |
| [AI assistants (MCP)](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md) | 35 MCP tools, resources and prompts, plus short guides for when to use each. |
| [NeuralVault memory hook](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md) | Hands the newest run to an adapter you name in the config, outside the project. |
| [Red testing and benchmark](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md) | Plants bugs and measures false alarms on real code. Repository checkout only. |
| [Click-through](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md) | Opens your real app and presses controls through a driver you supply. |
| [Hook safety](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#hook-safety) | A git pre-push hook that runs the quick preset. Removable cleanly. |

<!-- counts:start -->
**403 checks · 1446 sub-checks · 50 suites.** A check is one scan or tool run. A sub-check is one rule inside it, so a failure names the exact rule. These are the checks Meerkat ships; any you add are extra.
<!-- counts:end -->

Output is short by default: one summary line, one line per failed check, and the log folder. `--full` lists every finding. `findings.json` in the run folder always has them all.

## Accuracy

Measured 2026-11-06 with the corpus tools in `tools/corpus/` and the real-code benchmark in `benchmarks/real-rust/`.

| Measure | Result | Notes |
|---|---|---|
| Planted-bug recall, default run | 99.77% (1735 of 1739) | The 4 misses are lock-unwrap defects, off by design in the default run. |
| Planted-bug recall, pedantic run (`--all`) | 100% | |
| False alarms on real code (NeuralVault Rust) | 4.6% (6 of 130 labelled findings) | One project, one language. |
| False alarms on clean twins | 0 of 1739 | |
| Real-code mutation run (200 mutants) | 37% default, 98% with all rules | |

**Caveat:** the planted corpus is built from each rule's own samples. High recall there shows the rules do what they were written to do, not that they find every real bug. The real-code numbers matter more, and they cover one project. Details: [accuracy.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md), [accuracy-results.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy-results.md).

## Limits and what Meerkat does not do

- Rust findings are leads to check, not verdicts.
- Click-through drivers are built but not yet run against a real app.
- `meerkat update` and the trusted-publishing workflow are unit-tested, not yet verified against a real newer release.
- Red testing, the real-code benchmark and the release tools need a repository checkout.
- The advisory scan of declared packages is not a command yet ([issue #26](https://github.com/SamuelNDCE/Meerkat/issues/26)).
- A clean run does not prove the code is bug-free. It covers what the checks can see ([coverage.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/coverage.md)).
- It never edits your project, sends telemetry or uploads anything.
- A check that could not run is never a pass.

Found a false alarm? [Open a false-alarm issue](https://github.com/SamuelNDCE/Meerkat/issues/new?template=false-positive.yml). Missed a real problem? [Open a missed-problem issue](https://github.com/SamuelNDCE/Meerkat/issues/new?template=missed-problem.yml).

## Documentation

| Guide | For |
|---|---|
| [How-to](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/how-to.md) | Short daily guide |
| [Everyday use](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/everyday.md) | Routine runs, findings and logs |
| [Commands](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | Every command and flag |
| [Checks](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/checks.md) | Every check (generated) |
| [Batch gating](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) | Gating several branches at once |
| [Capabilities](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/capabilities.md) | What Meerkat covers |
| [AI use](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md) | MCP, skills and AI assistants |
| [NeuralVault](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md) | Memory hook and the gate page |
| [Extending](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/extending.md) | Your own checks, packs and presets |
| [Developers](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/developers.md) | Contributing to Meerkat |
| [Reference](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/reference.md) | The full manual |
| [FAQ](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/faq.md) | Common questions |
| [Release](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/release.md) | How a version ships |

**Licence:** [Perpetual Community Licence 1.0](https://github.com/SamuelNDCE/Meerkat/blob/main/LICENSE) ([notes](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/licence-notes.md)). **Security:** [SECURITY.md](https://github.com/SamuelNDCE/Meerkat/blob/main/SECURITY.md).
