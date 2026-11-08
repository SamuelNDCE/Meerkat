# Using Meerkat from NeuralVault

How a NeuralVault session, agent or CI job uses Meerkat as an MCP tool and as a command line tool. Short steps, each checked on this build. What every tool does: [capabilities.md](capabilities.md). Questions: [faq.md](faq.md).

Paths below use `<meerkat>` for the folder Meerkat is installed in and `<repo>` for the NeuralVault checkout.

## 1. Start the MCP server

The server speaks MCP over stdin and stdout. Start it with either command; both run the same code.

```
meerkat mcp serve
```

```
node <meerkat>/bin/meerkat-mcp.mjs
```

It prints `meerkat-mcp <version> ready (folder: <folder>)` on stderr and waits. Only JSON-RPC goes to stdout. The folder it was started in is the default `folder` for every tool.

To register it with Claude Code for you:

```
meerkat mcp install
```

`meerkat mcp install --dry-run` prints the command it would run (`claude mcp add --scope user meerkat -- node <meerkat>/bin/meerkat-mcp.mjs`). `meerkat mcp status` says whether it is registered. To list the tools without starting a session: `node <meerkat>/bin/meerkat-mcp.mjs --list-tools` (version, count, names).

## 2. Load the skills

The folder `<meerkat>/skills` holds short instruction files, one `SKILL.md` per folder: `meerkat`, `meerkat-before-commit`, `meerkat-before-pr`, `meerkat-blast-before-edit`, `meerkat-map-unfamiliar-code`, `meerkat-secrets-before-post`, `meerkat-smoke-and-red`, `meerkat-docs-check` and `meerkat-click-through`. The MCP server does not serve them in this build, so copy the folders to wherever your agent loads skills from. Start with `meerkat`.

## 3. Ask for the promotion verdict

Before a branch is promoted, ask for one line:

```
meerkat verdict --base origin/main
```

It prints one of three lines, or a NO-RESULT line. Exit code 0 means PASS, 1 means a FAIL or NO-RESULT, 2 means a usage problem such as a base ref git does not know. The verdict reads only files the branch changed. Findings already on the base are not counted against the branch, and findings in other files are reported as pre-existing. Use `meerkat top --base origin/main --limit 5` to see which findings they are.

## 4. Keep results compact

MCP results are short by default. `meerkat_summary` answers in a few lines: pass or fail, the blocking count, the pre-existing count, the failed check names and the run folder. `meerkat_gate` is compact the same way; pass `full: true` to list every check and finding. `meerkat_findings` takes `limit`. Ask for the long form only when you are about to fix something, and use `meerkat_finding` with an id for one finding in full.

## 5. Known failures

This build has no single "known failures" list and `verdict` has no option for one; `meerkat verdict --help` shows its only options. Three things come closest, and each is a CLI command or MCP tool you can run:

- Pre-existing findings. `verdict` and `gate` already separate findings the branch did not cause. `meerkat gate --base origin/main --all-findings` lists the ones hidden.
- Dismissals. `meerkat dismiss <id> --reason "..."` accepts one finding with a reason; `meerkat dismissals` lists them. MCP: `meerkat_dismiss`, `meerkat_dismissals`.
- Baseline. `meerkat baseline` accepts all current findings; `meerkat verify --ratchet` then fails only on new ones.

## 6. Project code needs trust

A project can carry its own code for Meerkat to run: `extraChecks` folders, `.meerkat/checks/*.mjs`, and the `commands` block of `meerkat.config.json`. Meerkat will not run it until someone trusts it.

- In a terminal: run `meerkat trust` in the repo. It lists the commands and asks once. A changed command asks again.
- Without a terminal (an agent, a pipe, CI): nothing is trusted, `meerkat trust` exits 1, and `meerkat build` prints that the command was NOT run. In CI, set `MEERKAT_TRUST_PROJECT=1`, but only for a repo you own.

## 7. Read results as an AI

| What you see | What to do |
|---|---|
| `PASS` | Go on. |
| `FAIL n blocking in changed files` | Run `meerkat top --base origin/main` or the MCP tool `meerkat_findings`, fix each one or dismiss it with a reason, run the verdict again. |
| `FAIL-PRE-EXISTING only: n findings ...` | The branch did not cause these. Do not fix them in this branch unless asked. Report the count. |
| `NO-RESULT: nothing changed compared with main ...` | Nothing to judge. Commit the change, or pass `--base <ref>`. Do not report PASS. |
| `NO-RESULT: the gate did not finish in 900s ...` | Run `meerkat gate` in the background, or raise `MEERKAT_VERDICT_TIMEOUT_S`. Do not report PASS. |
| `NO-RESULT: ... git does not know that ref` | Fix the base name, for example `origin/main`. In CI fetch full history first. |
| `NOT RUN` on a check | A tool or setting is missing. Run `meerkat doctor`, report what it says. A NOT RUN is never a pass. |
| `this project's own check code was NOT run` | Section 6. Ask a person to run `meerkat trust`, or set `MEERKAT_TRUST_PROJECT=1` in CI. |

A NO-RESULT line always names a reason and a next step. Read both, act on the next step once, and if it still gives no result, stop and report the line. Never turn a NO-RESULT into a pass, and never retry in a loop.
