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

## Contents

- [Install](#install)
- [What is new in 0.5.3](#what-is-new-in-053)
- [Why Meerkat](#why-meerkat)
- [Quick start](#quick-start)
- [Reading a run](#reading-a-run)
- [Is this branch safe to merge?](#is-this-branch-safe-to-merge)
- [The worst findings in your change](#the-worst-findings-in-your-change)
- [Run reports and debug summaries](#run-reports-and-debug-summaries)
- [Your repo's own commands](#your-repos-own-commands)
- [Batch gating](#batch-gating)
- [Accepting known findings](#accepting-known-findings)
- [Using Meerkat from an AI assistant](#using-meerkat-from-an-ai-assistant)
- [Features at a glance](#features-at-a-glance)
- [Accuracy](#accuracy)
- [Limits and what Meerkat does not do](#limits-and-what-meerkat-does-not-do)
- [Documentation](#documentation)

## Install

Requires [Node.js](https://nodejs.org) 20 or newer. No other dependencies, no account, and no network access during a run.

```bash
npm install -g @samuelndce/meerkat
```

Then, in any git repository, run `meerkat gate` (see [Quick start](#quick-start)).

## What is new in 0.5.3

- **`meerkat batch`** gates several branches in one run. If the combined change fails, it finds the branch that causes the failure and re-gates without it. See [Batch gating](#batch-gating).
- **`meerkat frontend`** runs typecheck, test and build steps from a commands block you approve. A step with no test file is skipped and reported as NOT RUN, never as a pass.
- **Verdict JSON** carries one row per check (status, seconds, file and line of each place), `behindBy` (how far the base has moved on), and a `verdict` word that matches the exit code.
- **Cargo lock waits** are reported as `WAITING: cargo lock held by pid N (command)`, not as a failure. The verdict is INCOMPLETE, exit 75, and the JSON names the holder.
- **Stale-base refusal:** a branch more than 20 commits behind its base returns NO-RESULT unless you pass `--allow-stale`.

Full list: [CHANGELOG.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CHANGELOG.md). Read [docs/batch.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) and [docs/neuralvault-gate.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault-gate.md) first if you use them.

## Why Meerkat

- **One command, an honest answer.** `meerkat verify` works out which checks apply to your project and says whether it is safe to ship. A check that could not run is reported as **NOT RUN**, and the run fails. Nothing is silently passed.
- **Two ways to use it.** On its own in a terminal, with no AI and no account. Or with an AI assistant over MCP, which runs the same checks to verify its own work.
- **Read-only and private.** It never edits your project, has no telemetry, and uploads nothing. Results are written to a folder on your machine.
- **Gate on what you changed.** Only the checks that match your changed files run in `meerkat gate`, and only failures in those files block a branch.

## Quick start

Run these in a git repository, on a branch that differs from `main`:

```bash
meerkat gate
```

`gate` runs the checks that match the files you changed, then prints a summary:


Read it top to bottom:

- **The first line** is the whole answer: how many findings block the branch, how many were already there and do not block, how many checks passed, and the exit code (1 means "fix before you merge").
- **The FAIL lines** name each failed check and how many findings it has. Use `--full` to list them all.
- **`next:`** says what to do first.
- **`logs:`** is the folder with the full record of this run (see [Run reports](#run-reports-and-debug-summaries)).

Other everyday runs:

| Command | When to use it |
|---|---|
| `meerkat verify` | The quick everyday run before you push. |
| `meerkat gate` | Only the checks that match your changed files. |
| `meerkat full` | Every check, including the slow ones (builds, deeper scans). |
| `meerkat last` | Show the saved report of the newest run. Nothing is re-run. |

## Reading a run

Every run writes a folder with one log per check and one `findings.json` that lists every finding. The folder path is printed at the end of each run. Runs are kept per project and per preset, so `meerkat last` shows the one you expect.

Each check is one scan or tool run. Each **sub-check** is one rule inside it, so a failure names the exact rule. The words in the summary mean:

| Word | Meaning |
|---|---|
| **passed** | The check ran and found nothing in this run. |
| **failed** | The check ran and found at least one finding. |
| **not run** | The check could not run (missing tool, time limit, skipped by path). Never a pass. |
| **pre-existing** | A finding already on the base branch. Shown, not blocking. |
| **blocking** | A finding the branch added, in a file it changed. This is what fails the run. |

## Is this branch safe to merge?

```bash
meerkat verdict --base origin/main
```


The verdict counts only findings in files the branch changed. Findings that were already there do not fail it.

| Answer | Meaning | Exit |
|---|---|---|
| `PASS` | Nothing new blocks. Pre-existing findings are listed as `pre-existing: N (does not block)`. | 0 |
| `FAIL n blocking in changed files` | The branch added a finding. | 1 |
| `NO-RESULT: <reason>. next: <step>` | No answer: nothing changed, a bad ref, a stale base, or a timeout. Never a pass. | 2 |
| `INCOMPLETE n of m checks finished` | The run stopped early (time limit, or a cargo lock wait). Never a pass. | 75 |

Options:

- `--base <ref>`: the branch to compare with (default `main` or `master`).
- `--json`: one object for scripts and queues. Its fields include `verdict`, `exitCode`, `blocking`, `preExisting`, `known`, `knownFindings`, `stale`, `behindBy`, `checksTotal`, `checksFinished`, and a `checks` array with one row per check.
- `--first`: only the first blocking `file:line: message`, or `PASS`.
- `--ready`: one `READY` or `NOT READY` line.
- `--branches a b`: one verdict line per branch.
- `--known <file>`: failures your team has accepted. See [Accepting known findings](#accepting-known-findings).

The JSON version looks like this (first lines):


## The worst findings in your change

```bash
meerkat top --base origin/main
```


`top` shows one table of the worst findings in the files your branch changed, worst first. `--limit` sets how many rows, and `--line` shows the line text.

## Run reports and debug summaries

`meerkat last` prints the saved report of the newest run. Read it when something failed and you want the reason, without re-running anything:


What each part tells you:

- **The header** gives the project, the result, the exit code, when the run started, and how long it took.
- **Findings** gives the totals by severity and how many are new.
- **Suites** is a table of checks grouped by area, with passed, failed and not-applicable counts.
- **Failed** lists each failed check with its reason (`Why:`), its time, and the one command that runs only that check again (`Run only this check again`).

The full log of each check is in the run folder. `findings.json` there holds every finding, and `findings.md` is the same list in plain text.

## Your repo's own commands

Meerkat can run your project's own tests and builds, but only after you approve the list. `meerkat commands` shows what it found and runs nothing:


- With no `meerkat.config.json`, Meerkat reads the `package.json` scripts and shows them.
- To pin them, add a `commands` block to `meerkat.config.json`, then run `meerkat trust` to approve it.
- `meerkat test-run <file or name>` runs one test with a time limit, through the repo's own runner (vitest, jest, cargo test or pytest). Exit 124 means it timed out.
- `meerkat frontend --app <folder>` runs the typecheck, test and build steps from the approved block and writes `frontend.json`. A step with no command, or a test step with no test file, is skipped and the run says so. A skipped step is never a pass.

## Batch gating

`meerkat batch` gates several branches in one run, so a queue of pull requests does not need one gate per branch:

```bash
meerkat batch --base origin/dev --app <repo> feature-a feature-b feature-c
```

- It merges the branches in order onto the base and gates the combined change once.
- If that fails, it finds the branch that causes the failure (one run per branch alone) and re-gates without it.
- A branch that conflicts when merged is left out and named.
- Caps keep one run bounded: 3000 changed lines and 15 branches by default, and at most 12 gate runs (`MEERKAT_BATCH_MAX_RUNS`). A branch over a cap is excluded with its reason.
- Each branch is pinned to the commit it had at the start. If a branch moves or disappears while the batch runs, it is marked STALE and the batch is not a pass.
- The result is saved to `batches/<id>.json`, with a `latest.json` per repository.
- Exit codes match the verdict: 0 pass, 1 fail, 75 incomplete. A run that hits the overall time limit is incomplete, not a pass.

Full guide: [docs/batch.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md).

## Accepting known findings

Some findings are real but accepted. List them in a JSON file and pass it with `--known`:

```json
[
  { "check": "risky-code", "file": "b.js", "line": 2 }
]
```

- A matching finding prints as `KNOWN` and does not block.
- An entry that matches nothing prints as `STALE`, so old acceptances cannot hide new problems.
- For a single line you can also add an allow entry in the file the check reads (for example `.meerkat-risky-allow`), with a reason. The reason is required, so the decision is written down.

## Using Meerkat from an AI assistant

`meerkat mcp install` registers Meerkat's MCP server with Claude Code. The assistant then calls the same checks as tools, under the same rules: a NOT RUN is never a pass, and every answer names the run it came from.

- Tools that read a run take `folder`, `run` and `preset`.
- `meerkat_summary` and `meerkat_gate` return short answers by default.
- The AI-use guide lists every tool and when to use it: [docs/ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md). The commands an AI should use for a branch are in [docs/for-ai-agents.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/for-ai-agents.md).

## Features at a glance

| Feature | What it does |
|---|---|
| [Checks and presets](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#checks-and-presets) | Runs the checks that fit your project. Presets pick a set: `quick`, `bugs`, `full`, `ci`, `release`. |
| [Gate on changed files](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#gate) | Runs only the checks for the files you changed. Only failures in those files block. |
| [Branch verdict](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | One line for a branch: `PASS`, `FAIL`, `NO-RESULT` or `INCOMPLETE`, with an exit code. |
| [Batch gating](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/batch.md) | Gates several branches in one run and names the one that fails. |
| [Frontend steps](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | Typecheck, test and build steps from a block you approve. A skipped step is never a pass. |
| [Run reports](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/logs.md) | A saved report and a log per check for every run, shown by `meerkat last`. |
| [Smoke](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#smoke) | Checks that the checks chosen for your changes start and stop in time. Tests Meerkat, not your project. |
| [Blast radius and brief](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#blast-radius) | What an edit to a file or symbol affects, and a brief before you edit. |
| [Codebase map](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/codemap.md) | Files, functions with line numbers, routes, tests and imports. Only changed files are re-read. |
| [Workflow profiles](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#workflow-profiles) | `meerkat init --profile` gives a starting config: solo, team, ai-agent, legacy, monorepo or ci-only. |
| [AI assistants (MCP)](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md) | MCP tools, resources and prompts, with short guides for when to use each. |
| [NeuralVault memory hook](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/neuralvault.md) | Hands the newest run to an adapter you name in the config, outside the project. |
| [Red testing and benchmark](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md) | Plants bugs and measures false alarms on real code. Repository checkout only. |
| [Click-through](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md) | Opens your real app and presses controls through a driver you supply. |
| [Hook safety](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#hook-safety) | A git pre-push hook that runs the quick preset. Removable cleanly. |

<!-- counts:start -->
**403 checks · 1446 sub-checks · 50 suites.** A check is one scan or tool run. A sub-check is one rule inside it, so a failure names the exact rule. These are the checks Meerkat ships; any you add are extra.
<!-- counts:end -->

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
