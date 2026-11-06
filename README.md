<div align="center">

# Meerkat

**A scanner for people, and a tool and scaffolding for AIs.**<br>
Meerkat checks, maps and tests a project: security, correctness, accessibility, performance and code health, with every result saved and explained.

<img src="https://img.shields.io/badge/version-0.5-blue" alt="version 0.5"> <img src="https://img.shields.io/badge/checks-see%20docs%2Ffeatures.md-informational" alt="checks: see docs/features.md"> <img src="https://img.shields.io/badge/use-standalone-success" alt="use: standalone"> <img src="https://img.shields.io/badge/use-with%20AI%20(MCP)-8A2BE2" alt="use: with AI over MCP"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/dependencies.svg" alt="dependencies: zero"> <img src="https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/badges/telemetry.svg" alt="telemetry: none">

![Meerkat running: what is running now, a status line, every check with its time, and a timeline](https://raw.githubusercontent.com/SamuelNDCE/Meerkat/main/docs/images/meerkat-run.gif)

<sub>Sample data: a made-up project, drawn by Meerkat's real screens.</sub>

</div>

## 💡 Why Meerkat

- **One command, an honest answer.** `meerkat verify` works out what applies to your project and says whether it is safe to ship. A check that could not run is NOT RUN, and the run fails.
- **Two ways to use it.** Standalone in a terminal (no AI, no account, no network), or with an AI over MCP, which uses the same checks to verify its own work.
- **Read-only and private.** It never edits your project, has no telemetry, and uploads nothing.

## 🚀 Quick start

You need [Node.js](https://nodejs.org) 20 or newer. No other dependencies.

```
npm install -g @samuelndce/meerkat
```

```
meerkat verify
```

```
meerkat full
```

```
meerkat last
```

`verify` is the quick everyday run, `full` adds the slow checks, and `last` shows the saved results. `meerkat why <check>` shows one check's log and `meerkat findings` lists every finding, worst first. Exit codes: 0 passed, 1 a check failed or could not run, 2 usage error, 3 nothing to run. Every command: [docs/commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md).

## 🧩 Features at a glance

Legend: ✔ OK works / ◐ PARTIAL works with limits / ✖ BROKEN built but not working / ○ PLANNED not built.

| Feature | What it does | Status |
|---|---|---|
| 🔍 [Checks and presets](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#checks-and-presets) | Runs the checks that fit your project; presets pick a set (`quick`, `full`, `ci`, `release`) | ✔ OK |
| 🚦 [Gate on changed files](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#gate) | Runs only the checks matching the files you changed | ◐ PARTIAL |
| 💨 [Smoke](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#smoke) | The `smoke` preset works; the tool self-check is not routed as a command yet | ◐ PARTIAL |
| 💥 [Blast radius](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#blast-radius) | Lists what an edit to a file or symbol affects | ✔ OK |
| 🗺 [Codebase map](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#codebase-map) | Writes a map of entry points, modules and imports | ✔ OK |
| 🧪 [Red testing](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#red-testing) | Attacks Meerkat itself with planted bugs and clean twins (repository checkout only) | ◐ PARTIAL |
| 📏 [Real-code benchmark](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md#real-code-benchmark) | Measures false alarms on real Rust code (repository checkout only) | ◐ PARTIAL |
| 📡 [Advisory scan](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#advisory-scan) | Offline match of declared packages against an advisory snapshot (library, no command) | ○ PLANNED |
| 📚 [Test catalog](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#catalog-and-tests-command) | `meerkat tests --json` lists every kind of test and what it proves | ✔ OK |
| 🔌 [MCP server](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#mcp-tools) | Offers the checks to an AI as tools, resources and prompts | ✔ OK |
| 🧠 [Skills](https://github.com/SamuelNDCE/Meerkat/blob/main/skills/README.md) | Short guides that tell an AI when to reach for Meerkat | ✔ OK |
| 🖱 [Click-through](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md) | Opens your real app and presses controls through a driver you supply | ◐ PARTIAL |
| 🪝 [Hook safety](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md#hook-safety) | A git pre-push hook that runs the quick preset; removable cleanly | ✔ OK |

How many checks exist: see [docs/features.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md), or run `meerkat tests --json`.

## 🎯 Accuracy (summary)

Measured 2026-11-06 with `tools/corpus/gen-planted.mjs` and `tools/corpus/measure.mjs` (planted bugs and clean twins) and `benchmarks/real-rust/measure.mjs` (real code). Legend as above.

| Measure | Result | Status |
|---|---|---|
| Planted-bug recall, default run | 99.77% (1735 of 1739). The 4 misses are lock-unwrap defects, hidden by design in the default run | ✔ OK |
| Planted-bug recall, pedantic run (`--all`) | 100% | ✔ OK |
| False alarms on real code (NeuralVault Rust benchmark) | 4.6%: 6 of 130 labelled findings were false, 124 true | ✔ OK |
| False alarms on clean twins | 0 of 1739 | ✔ OK |
| Real-code mutation run (200 mutants) | default 37%, all rules 98% | ◐ PARTIAL |

**Caveat.** The planted corpus is built from each rule's own samples, so high recall there shows the rules do what they were written to do, not that they find every real bug. The real-code numbers matter more, and they cover one project in one language. Details, commands and what is not measured yet: [docs/accuracy.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md).

## 🤖 Using it with AI

- **MCP server:** `meerkat mcp serve` offers 16 tools, read-only resources (`meerkat://run/latest/...`) and prompts. `meerkat mcp install` registers it with Claude Code.
- **Skills:** the [skills](https://github.com/SamuelNDCE/Meerkat/blob/main/skills/README.md) folder holds short guides (before a commit, before a PR, blast radius before an edit, mapping unfamiliar code, and more).
- **Rule for agents:** a NOT RUN is never a pass, and never edit the config or turn a check off to make a run pass.

Everything an AI needs: [docs/ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md).

## 🔧 Extending Meerkat

Add a command as a check in one line (`meerkat check new`), write a check in JavaScript in a pack, make a preset (`meerkat preset new`), or silence a known finding with a reason (`meerkat dismiss`). Prove a new check with a `selfTest` on a broken sample. How-to: [docs/adding-tests.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/adding-tests.md) and [CONTRIBUTING.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CONTRIBUTING.md).

## 🖱 Click-through

Status: ◐ PARTIAL. The driver protocol is built and Meerkat schedules, times and reports a driver like any check. The reference drivers have not yet run against a real app, so treat the shipped examples as unproven. Exit 75 from a driver means it could not start, never a pass. Guide: [docs/click-through.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/click-through.md).

## ⚠ Known limits

- Rust findings are leads to check, not verdicts; the false-alarm figure is from one project.
- `gate` and the tool self-check `smoke` are not routed as `meerkat` words yet; blast and map are available as commands.
- Red testing, the real-code benchmark and the advisory scan run from a repository checkout or a library, not as everyday commands.
- Recall on planted bugs measures what was planted, not real-world accuracy.
- If Meerkat reports something fine, open a [false alarm](https://github.com/SamuelNDCE/Meerkat/issues/new?template=false-positive.yml) issue; if it misses a real problem, open a [missed problem](https://github.com/SamuelNDCE/Meerkat/issues/new?template=missed-bug.yml) issue.

## 🔗 Links

| Read | For |
|---|---|
| [docs/features.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/features.md) | every feature: use, command, exit codes, limits, status |
| [docs/ai.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/ai.md) | everything an AI needs |
| [docs/adding-tests.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/adding-tests.md) | adding checks, packs, presets |
| [docs/accuracy.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md) | how accuracy is measured, with figures and caveats |
| [docs/commands.md](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/commands.md) | every command and flag |
| [CONTRIBUTING.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CONTRIBUTING.md) | how to contribute |
| [CHANGELOG.md](https://github.com/SamuelNDCE/Meerkat/blob/main/CHANGELOG.md) | what changed |

Licence: [Perpetual Community Licence 1.0](https://github.com/SamuelNDCE/Meerkat/blob/main/LICENSE) ([notes](https://github.com/SamuelNDCE/Meerkat/blob/main/docs/licence-notes.md)). Security problems: [SECURITY.md](https://github.com/SamuelNDCE/Meerkat/blob/main/SECURITY.md).
