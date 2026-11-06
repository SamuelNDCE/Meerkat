<div align="center">

# Meerkat

<img src="docs/images/badges/version.svg" alt="version"> <img src="docs/images/badges/licence.svg" alt="licence: PCL 1.0"> <a href="https://github.com/SamuelNDCE/Meerkat/blob/main/docs/accuracy.md"><img src="docs/images/badges/planted-defect-recall.svg" alt="planted-defect recall"></a> <img src="docs/images/badges/checks.svg" alt="checks"> <img src="docs/images/badges/sub-checks.svg" alt="sub-checks"> <img src="docs/images/badges/suites.svg" alt="suites"> <img src="docs/images/badges/dependencies.svg" alt="dependencies: zero"> <img src="docs/images/badges/telemetry.svg" alt="telemetry: none"> <img src="docs/images/badges/node.svg" alt="node: 20+"> <img src="docs/images/badges/tested-on.svg" alt="tested on: Windows 11"> <img src="docs/images/badges/works-with.svg" alt="works with NeuralVault and MCP">

**A scanner for people, and a tool and scaffolding for AIs.**<br>
Meerkat checks, maps and tests a project: security, correctness, accessibility, performance and code health, with every result saved and explained.

<a href="https://www.npmjs.com/package/@samuelndce/meerkat"><img src="https://img.shields.io/badge/npm-package-CB3837?style=for-the-badge" alt="npm package"></a> <a href="https://github.com/SamuelNDCE/Meerkat"><img src="https://img.shields.io/badge/GitHub-repository-181717?style=for-the-badge" alt="GitHub repository"></a>

<!-- counts:start -->
{{COUNTS: filled in by tools/gen-checks.mjs}}
<!-- counts:end -->

![Meerkat running: what is running now, a status line, every check with its time, and a timeline](docs/images/meerkat-run.gif)

<sub>Sample data: a made-up project, drawn by Meerkat's real screens.</sub>

**[What it is](#what-meerkat-is) · [Quick start](#quick-start) · [Primary features](#primary-features) · [AI section](#ai-section) · [Make it yours](#make-it-yours) · [Commands](#commands) · [Licence](#licence)**

</div>

## What Meerkat is

Meerkat is one command that looks at a project and tells you, honestly, whether it is safe to ship. It is for developers who want the answer to "is this safe to push?" without running a dozen separate tools in the right order, and for AI coding assistants that need a reliable way to check their own work.

There are two ways to use it, and the first needs no AI at all:

- **Standalone.** You run `meerkat verify` in a terminal. It works out what applies to your project, runs the checks, shows a live board and a results screen, and saves a report. No account, no network call of its own, no AI.
- **With an AI.** The same checks are offered to an AI as an MCP tool, a code map, a blast-radius lookup, a test catalog and a ready-made prompt. The AI uses Meerkat to check its changes, map an unfamiliar codebase and see what an edit affects. Meerkat does more with an AI, but it never needs one.

What it will not do: it never edits your project, never passes a check that could not run (that is NOT RUN, and the run fails), and sends nothing over the network unless you turn on an opt-in check that says what it will send first.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer. There are no other dependencies.

```
npm install -g @samuelndce/meerkat
```

```
meerkat --version
```

From the repository instead: clone it, then run `npm link` inside the folder to install the `meerkat` command.

Run the quick checks in your project folder (the everyday run, before a push):

```
meerkat verify
```

Run every check, the slow ones too (before a release or a merge you cannot undo):

```
meerkat full
```

Point it at another project by path or by name (`meerkat root add <folder>` teaches it where your projects live):

```
meerkat verify ../my-app
```

When a check fails, `meerkat last` shows the report, `meerkat why <check>` shows that check's log, and `meerkat findings` lists every finding, worst first. Exit codes: 0 passed, 1 a check failed or could not run, 2 a usage or configuration error, 3 nothing to run. See [docs/features.md](docs/features.md).

## Primary features

Each feature below has a full entry (what it does, when to use it, the command, exit codes, what it does not do, and its status) in [docs/features.md](docs/features.md).

**Checks.** Hundreds of checks in suites (secrets, web security, accessibility, build, tests, performance, code shape and more), chosen by what your project contains. A check that cannot run says NOT RUN and why, and the run fails. Every rule is proven on a bad and a good sample (`meerkat self-test`). The generated list is [docs/checks.md](docs/checks.md). Presets pick a set: `quick`, `full`, `ci`, `release`, `smoke`, `security` and more (`meerkat presets`).

**Gate.** Runs only the checks whose paths match the files you changed, for a pre-commit hook (`--staged`) or a pull request (`--base <ref>`). Partly shipped: the logic is in `lib/gate.mjs` and runs as `node lib/gate.mjs gate`; the `meerkat gate` word is not wired into the main command on this branch yet.

**Smoke.** Two different things share the name. The `smoke` preset (`meerkat run smoke`) asks "did my change break the build, type check, lints and quick tests?". The smoke self-check (`lib/gate.mjs smoke`) runs checks on the changed files with a tiny time limit to prove the tool itself behaves; it tests Meerkat, not your project.

**Blast radius.** `meerkat blast <file>[#symbol]` lists the files that import a target, the modules touched, the tests that reach it and the imports it could not resolve (never counted as safe). Run it before and after an edit.

**Codebase map.** `meerkat map` writes `codemap.json` and `codemap.md`: entry points, modules, edges between them, the most imported files and unresolved imports. Read it first on an unfamiliar codebase.

**Red testing.** A suite that attacks Meerkat itself: planted bugs, injected faults, odd inputs, past regressions and clean twins that must stay quiet. It runs from a repository checkout (`node lib/redtest/run.mjs --kind all`), not as a `meerkat` command. See [lib/redtest/README.md](lib/redtest/README.md).

**Advisory scan.** A library (`lib/advisory.mjs`) that matches the packages a project declares against an OSV snapshot, offline, and only advises. It is not wired to a command yet. Today advisories come from the `npm-audit-all`, `rust-audit` and opt-in `detectors` checks.

**Catalog and tests command.** `meerkat tests --json` prints every kind of test and family of check: what it proves, what triggers it, its cost and what it needs. It is generated from the check registry. `meerkat.order.json` sets which kinds start first.

**MCP tools and resources.** `meerkat mcp serve` (or `bin/meerkat-mcp.mjs`) is an MCP server over stdio with six tools, two read-only resources, one resource template and three prompts. `meerkat mcp install` registers it with Claude Code.

**Hook safety.** `meerkat hook install` adds a git pre-push hook that runs the quick preset with `--ratchet`. It writes one marked block, keeps anything already in the hook, and `meerkat hook remove` takes out only that block.

Also: findings files (JSON, Markdown, SARIF), accepted findings (`dismiss`, `baseline`, `--ratchet`), your project's own tests found automatically (`meerkat discover`), live board and results screen, smart time limits, and a prompt writer (`meerkat prompt`).

## AI section

Everything an AI needs is in [docs/ai.md](docs/ai.md): which tool or command for which job, the six MCP tools, the resources and prompts, the order to run tests, the exit codes, and how to read the findings JSON. The short version:

- Before committing: the gate. After an edit: `meerkat blast <file>`. On a new codebase: `meerkat map`. To know which checks exist: `meerkat tests --json`.
- Over MCP, call `meerkat_run`, then read `meerkat://run/latest/findings`.
- A NOT RUN is never a pass. Never edit the Meerkat config or turn a check off to make a run pass.

For Claude Code, the skill in [skills/meerkat/SKILL.md](skills/meerkat/SKILL.md) tells the AI when to reach for Meerkat. Add the server with:

```
claude mcp add meerkat -- node <path>/bin/meerkat-mcp.mjs
```

## Make it yours

- Add a command as a check in one line: `meerkat check new`.
- Write a check in JavaScript, in a pack: [docs/writing-checks.md](docs/writing-checks.md).
- Make a preset: `meerkat preset new`.
- Silence a known finding with a reason: `meerkat dismiss <id> --reason "..."`.
- Settings live in `meerkat.config.json` (`meerkat init` writes one): [docs/customizing.md](docs/customizing.md).

## Commands

`meerkat help` lists every command and `meerkat <command> --help` explains one. The full table is [docs/commands.md](docs/commands.md); `meerkat describe` prints all of it as JSON.

| Job | Command |
|---|---|
| Quick or full run | `meerkat verify`, `meerkat full`, `meerkat run <preset>` |
| Only some checks | `meerkat check <id or suite>` |
| Results | `meerkat last`, `meerkat why <check>`, `meerkat findings`, `meerkat finding <id>` |
| Understand the code | `meerkat map`, `meerkat blast <file>` |
| Find what exists | `meerkat tests`, `meerkat suite list`, `meerkat doctor` |
| Set up | `meerkat init`, `meerkat tools`, `meerkat mcp install`, `meerkat hook install` |

## Using Meerkat to build NeuralVault and the Perpetual Technologies website

**Why.** Samuel wants Meerkat used whenever anyone, human or AI agent, builds or works on NeuralVault and on the Perpetual Technologies website. Meerkat finds bugs in code, checks docs against code, and maps what a change affects, so problems are caught before they ship.

**How.** Legend: OK works on `main` / PARTIAL works only on a branch or by a longer command / PLANNED not wired yet.

| Moment | What to run | Status |
|---|---|---|
| Before a commit or PR | `meerkat verify` (quick) or `meerkat full` | OK on `main` |
| Before a commit or PR, only the files you changed | `meerkat gate --base <ref>` | PARTIAL: `node lib/gate.mjs gate --base <ref>` on this branch; the `meerkat gate` word is on the `wire-gate` branch, not merged |
| After an edit | `meerkat blast <file>` | PARTIAL: on the release branch, not on `main` |
| Before a release | `meerkat full` (or `meerkat run release`) | OK on `main` |
| Unfamiliar codebase or a refactor | `meerkat map` | PARTIAL: on the release branch, not on `main` |
| Check Meerkat itself | `meerkat smoke` | PARTIAL: `node lib/gate.mjs smoke` on this branch; the `meerkat smoke` word is on `wire-gate`, not merged. `meerkat self-test` is OK on `main` |
| AI agents | `meerkat mcp serve` | OK on `main`: six tools (`meerkat_run`, `meerkat_list`, `meerkat_presets`, `meerkat_last`, `meerkat_why`, `meerkat_self_test`), plus resources and prompts |

There is no gate, blast or map MCP tool. Agents call `meerkat_run` with `preset: "full"` for the merge gate and use the shell commands for the rest. `meerkat mcp install` registers the server with Claude Code. Full agent guide: [docs/ai.md](docs/ai.md).

`blast` exits 75 when the file is not in the code map. `gate` and `smoke` exit 75 when they could not run. Exit 75 is not a pass.

**Known limits.** Treat Rust findings as leads to check, not verdicts.
- Rust rules, default run: about 97.5% of planted defects found (target 99.5%).
- False alarms on real code: about 14% (target under 5%).

**Read more.** [docs/features.md](docs/features.md) (every feature and its status), [docs/ai.md](docs/ai.md) (for AI agents), [docs/adding-tests.md](docs/adding-tests.md) (adding a check), [CONTRIBUTING.md](CONTRIBUTING.md).

## CI, privacy, updates

Meerkat exits non-zero on any failure or NOT RUN and writes `summary.json` and SARIF for every run: `node run.mjs --preset ci --json meerkat.json` in a build job. It has no telemetry and never uploads your code or results; its one network call of its own is a once-a-day version look-up (`meerkat update off` turns it off). Versions follow [semantic versioning](https://semver.org); the version lives in `package.json` and [CHANGELOG.md](CHANGELOG.md) says what changed.

## Verification

Meerkat is tested against deliberately planted defects, and against clean projects that must stay quiet.

<!-- accuracy-readme:begin -->
{{ACCURACY: filled in by tools/accuracy-corpus.mjs}}
<!-- accuracy-readme:end -->

Details and caveats: [docs/accuracy.md](docs/accuracy.md). Recall on planted bugs measures what was planted, not real-world accuracy. If Meerkat reports something that is fine, open a [false alarm](https://github.com/SamuelNDCE/Meerkat/issues/new?template=false-positive.yml) issue; if it misses a real problem, open a [missed problem](https://github.com/SamuelNDCE/Meerkat/issues/new?template=missed-bug.yml) issue.

## Licence

Meerkat is under the [Perpetual Community Licence 1.0](LICENSE). People can use, change and share it free; organisations can use it free but must say publicly that they do; nobody may sell Meerkat itself. The numbered terms in `LICENSE` are what counts. See [docs/licence-notes.md](docs/licence-notes.md). To report a security problem, see [SECURITY.md](SECURITY.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## More documentation

| Read | For |
|---|---|
| [docs/features.md](docs/features.md) | every feature: use, command, exit codes, limits, status |
| [docs/ai.md](docs/ai.md) | everything an AI needs |
| [docs/reference.md](docs/reference.md) | the full manual: presets, settings, environment variables, timeouts |
| [docs/checks.md](docs/checks.md) | every check and suite |
| [docs/commands.md](docs/commands.md) | every command and flag |
| [docs/findings.md](docs/findings.md) | the findings files and protocol |
| [docs/accuracy.md](docs/accuracy.md) | how accuracy is measured |
| [docs/credits.md](docs/credits.md) | the outside tools Meerkat can run, with licences |
| [PROJECT.md](PROJECT.md) | rules for working in this repository |
