# How to run Meerkat efficiently

A short guide for daily use. Every command below was run on a small test repository. Every command and flag is listed in [commands.md](commands.md).

## 1. Install and first run in five minutes

You need Node.js 20 or newer. Install, then run the everyday check inside your project:

```
npm install -g @samuelndce/meerkat
```

```
meerkat verify
```

```
meerkat last
```

`verify` is the quick run. `last` shows the report of the newest run. To try it without installing, use `npx -y @samuelndce/meerkat verify` (the GitHub Action example uses `npx -y` the same way).

The version printed by `meerkat --version` is the one this page describes. Some things here (the `bugs` preset as the gate default, a quick run without style rules, asking before running a project's own check code) are recent additions.

## 2. Pick a preset

Read the preset list with `meerkat presets`. Details come from `lib/presets.mjs`.

| Use it for | Preset | What it is |
|---|---|---|
| First look | `quick` (same as `fast`, and `verify` runs it) | Short static checks only. No builds and no test runs. It also leaves out documentation and style-only rules. |
| Before a commit | `meerkat gate --staged` | Not a preset name. It runs the `bugs` preset on the files you changed. |
| Before a push | `quick` | The pre-push hook runs it with `--ratchet`. |
| Pull request | `meerkat gate --base <ref>` | Same as above, against the branch you merge into. |
| Nightly | `full` (same as `thorough`) | Every check, including builds, your own tests and slow scans. |
| Build server | `ci` | Security and does-it-work checks. No windows. |
| Before shipping | `release` | Everything in `full`, plus the AI review. |

`bugs` is the quick run without style, documentation and housekeeping rules, so a finding is likely a real bug. Run any preset with `meerkat <preset>`. To see what one runs and how long each check takes before you start it, use `meerkat preset show quick`.

## 3. The daily loop

Stage your change, then run the gate:

```
meerkat gate --staged
```

It runs only the checks that cover your changed files. Only failures inside those files block. Failures about the whole project are listed as "project-wide, not blocking". Exit 0 means pass, 1 means a check failed, and nothing staged prints "nothing changed" and exits 0.

Example of a failure line:

```
FAIL     risky-code  app.js:2 eval() runs text as code
```

The last lines are `gate: 212 passed, 2 failed, ...` and a `logs:` folder with one log per check. The gate checks the file as saved on disk, not as staged.

To read the full detail of a finding, use a normal run, because the gate's run is not the one `findings` reads:

```
meerkat verify
```

```
meerkat findings
```

```
meerkat finding <id>
```

`meerkat findings --json` has the id of every finding. `meerkat finding <id>` shows the evidence, the check that found it, its log and how to fix it.

Three ways to deal with a finding:

- Fix it, then run the gate again.
- Dismiss it with a reason. It then stops failing a check:

```
meerkat dismiss <id> --reason "test input is trusted"
```

- Take a dismissal back with `meerkat undismiss <id>`. `meerkat dismissals` lists them. A dismiss with no id prints the usage line and exits 2.

Some checks print their own way out. The risky-code failure above says to add a line such as `app.js:2 # reason: say why it is safe` to the file `.meerkat-risky-allow`. The reason is part of the line.

## 4. Pull request check

```
meerkat gate --base origin/main
```

The gate compares your branch with that ref. Add `--json` for one JSON object, or `--format github` for annotations on the changed files and a summary in the job. The GitHub Action example in [examples/github/meerkat.yml](../examples/github/meerkat.yml) does this:

- It checks out with `fetch-depth: 0`, because the gate needs history to find the base.
- It runs `npx -y @samuelndce/meerkat gate --base "$BASE_SHA" --format github`. A failing check fails the job.
- On pull requests it then does a full `run --format github` and posts one comment with `pr-comment --post`. That step has `continue-on-error`, so only the gate fails the job.

Copy the file to `.github/workflows/meerkat.yml`. It needs no secrets of your own. More in [github.md](github.md).

## 5. Speed

Fast: `meerkat gate`, `meerkat verify` (quick), `meerkat list`, `meerkat preset show`, `meerkat findings`, `meerkat last`.

Slow: `meerkat full`, `release` and `security`, which also scans git history. On the small test repository the gate took about 2.5 seconds and `verify` about 3.5 seconds. On a large project the quick run is budgeted at 5 to 10 minutes at most.

The fastest safe setup for a big repository:

- Use `meerkat gate --staged` before a commit and `meerkat gate --base <ref>` in review. Both run only the checks that match your changed files.
- Do not add `--all` or `--thorough` to the gate unless you want project-wide failures to block.
- Repeat runs reuse earlier results where nothing changed. `--no-cache` forces every check to run again.
- Use `meerkat verify` (quick) for the whole project. It skips builds and test runs. Leave `full` for a nightly job.
- Run one kind of check with `--group security`, or specific checks with `meerkat check <id>`.
- Cap a run with `--max-run-minutes <n>` (default 90) and stop at the first failure with `--fail-fast`. `--timeout-scale <n>` (1 to 10) gives slow machines more time.

Meerkat has no batching switch that this page could verify, so none is described.

## 6. Check Meerkat itself on known bugs

Build and measure the planted corpus. These two commands need a repository checkout. The numbers it reports are explained in [accuracy.md](accuracy.md).

```
node tools/corpus/gen-planted.mjs --out corpus/planted --seed 20261106 --per-rule 4
```

```
node tools/corpus/measure.mjs --corpus corpus/planted --out result.json
```

Add `--all` to the second command to include the pedantic rules. To attack the checks with other tests, run `meerkat redtest --kind cleantwin` (kinds: mutation, faults, adversarial, regression, cleantwin, all).

To add a check, see [writing-checks.md](writing-checks.md). The shortest way is `meerkat check new`, which takes a command and no code. Prove a new check with a `selfTest` on a broken sample, then run `meerkat self-test`. To add your own check, pack, preset or tool wrapper and keep it through updates, read [extending.md](extending.md).

## 7. Using an AI assistant

1. Give the assistant this page of rules: [for-ai-agents.md](for-ai-agents.md).
2. Run `meerkat mcp install` to register the tool server with Claude Code.
3. It then calls the tools, or runs `meerkat verify --json` and `meerkat findings --json`.
4. `meerkat prompt` writes a ready prompt with every finding of the last run.
5. `meerkat describe` prints every command and option as JSON.
6. It should treat exit 1 as "fix this", 2 as "wrong usage", and a NOT RUN as not a pass.

## 8. Trust and safety

- A project's own check code (`extraChecks` and `.meerkat/checks`) runs inside Meerkat, so it is never run unasked.
- In a terminal, Meerkat lists the files and asks `Trust this project and run that code? [y/N]`. Answer `y` once. It is remembered until those files change.
- Without a terminal, or in CI, Meerkat does not ask. It leaves that code out and says so. To run it on a build server you control, set `MEERKAT_TRUST_PROJECT=1`.
- `meerkat hook install` adds a pre-push hook that runs `quick` with `--ratchet`. It fails closed: if Meerkat cannot run, it prints `TOOL FAULT` and blocks the push.
- To push anyway, once: `MEERKAT_ALLOW_HOOK_FAIL=1 git push`. The bypass is written to `hook.log`. `meerkat hook remove` takes the hook out.

## 9. Where things are

- Logs are in `~/.meerkat/logs`, or in the folder named by `MEERKAT_LOG_DIR`. `meerkat logs` prints it.
- Each run has its own folder under `runs/`, named date, time, project and preset. It holds `report.md`, `findings.json` and one log per check.
- The newest run per project is in `latest-by-project.json`, and per preset in `latest-by-preset.json`.
- Run folders are kept until you delete them. The only exception is that gate and smoke runs keep just the newest per project.
- To clean up, delete old folders under `runs/` yourself. Nothing else needs cleaning.
- Dismissals and baselines live in the same data folder, so deleting the whole folder removes them too.

## 10. Common problems

- `<folder> is not a project: no git repository, no package.json, ...` (exit 2): you are outside a project. Move into it, or add `--force`.
- `No run has been saved yet ... Try: meerkat verify`: no normal run exists in this log folder. Run `meerkat verify`. A gate run does not count.
- `nothing changed, so no check has anything to read`: nothing is staged. Run `git add`, or use `--base <ref>`.
- `meerkat gate: --base <ref>: git does not know that ref` (exit 75): check the ref name. In CI, use `fetch-depth: 0`.
- `meerkat gate: --staged cannot be used with --base or --against` (exit 2): pick one.
- `Unknown command "..."`: the message lists every command and preset.
- `this project's own check code was NOT run`: answer the question once in a terminal, or set `MEERKAT_TRUST_PROJECT=1` in CI.
- `TOOL FAULT: meerkat not found. The push is BLOCKED`: fix the install, or push once with `MEERKAT_ALLOW_HOOK_FAIL=1 git push`.
- `Warning: that folder is inside the temp folder`: set `MEERKAT_LOG_DIR` to a folder you keep.
- `usage: meerkat dismiss <finding-id> --reason "..."` (exit 2): give an id and a reason.

## Tips

- The gate blocks only on your files. Do not add `--all` just to see more. Read the "project-wide" list instead.
- Repeat gate runs reuse earlier results. If a result looks stale, use `--no-cache`.
- Put the reason in a dismiss or an allow line. It shows the next person why.
- Run `meerkat baseline` once on an old project, then `meerkat verify --ratchet`. It then fails only on new findings.
- `meerkat findings --fail-on high --new` exits 1 only for new high findings. Use it in CI.
- Run `meerkat preset show quick` before a big run to see what runs and how long it takes.
- Set `MEERKAT_LOG_DIR` to a folder you keep, so run history survives a temp cleanup.
- Stage whole files. The gate reads files as saved, so a file staged in part is checked in full as it is on disk.

## More pages

- [capabilities.md](capabilities.md): what Meerkat does, by job.
- [neuralvault.md](neuralvault.md): using Meerkat from NeuralVault.
- [faq.md](faq.md): questions teams have asked.
