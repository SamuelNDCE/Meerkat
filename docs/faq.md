# Meerkat FAQ

Questions teams have actually asked. Each answer was checked by running the command on this build, or by reading the code. See also [capabilities.md](capabilities.md) and [neuralvault.md](neuralvault.md).

## Why is `meerkat verdict` slow, or why does it look stuck?

`verdict` and `top` run the full set of gate checks with the result cache off, so they do the whole work every time. They print progress lines on stderr while they work (`[12/218] risky-code ... 0.2s FAIL`, and `still running after 30s: <check>` for a slow one), and the answer, one line or one table, on stdout when they finish. They stop after 1500 seconds by default and print `INCOMPLETE n of m checks finished, b blocking so far (not a pass)` with the first 5 blocking findings, and exit 75. Start them in the background, or raise the limit: `MEERKAT_VERDICT_TIMEOUT_S=1800 meerkat verdict --base origin/main` (in PowerShell: set `$env:MEERKAT_VERDICT_TIMEOUT_S = '1800'` first).

## Why is `meerkat gate` faster the second time?

`gate` reuses results of checks whose inputs did not change. If a result looks stale, run `meerkat gate --no-cache` to run every check again.

## Why does my branch show failures it did not cause?

Two rules. First, `verdict` counts only findings in files the branch changed, and counts the rest as pre-existing: it prints `PASS` and a second line `pre-existing: N (not in this diff, does not block)`. Second, a gate on a feature branch hides findings that were already on the base; `meerkat gate --base origin/main` prints how many it hid. To see them: `meerkat gate --base origin/main --all-findings`. If you still see failures in files you did not touch, check which branch you are on (next question).

## Why does a worktree path read the wrong branch?

Meerkat reads the folder you give it, and the branch checked out there. `meerkat gate` and `meerkat brief` print a first line that says which: `folder: <path> | branch <name> | git worktree` (or `main checkout (not a worktree)`). Read that line first. `meerkat brief --ref <ref>` is different: its first line is `# ref <ref> (<sha>)` and it prints no folder line. Pass the worktree path with `--app <folder>` or as the folder argument: `meerkat gate --app ../my-worktree --base origin/main`. `verdict` and `top` do not print the folder line in this build, so run them from inside the worktree or pass the folder.

## Why does `meerkat commands` say there is no config?

Without a `meerkat.config.json` it reads the `package.json` scripts instead and prints `no commands block (there is no meerkat.config.json); these are the package.json scripts (nothing here is run):`. In a monorepo with no root scripts the line is `no commands block (there is no meerkat.config.json) and no root scripts; these are the scripts of the packages one level down (nothing here is run):`, followed by one row per package. It lists test, build and typecheck scripts and the exact `commands` block to add. Run `meerkat commands` again after adding the block.

## Why does `meerkat build` say the command was NOT run?

The repo's commands run through a shell, so they need a one-time yes. Run `meerkat trust` in a terminal. Without a terminal and without `--yes` it approves nothing and exits 2. A new git worktree of a repository you already trusted inherits the approval when its commands are identical (`meerkat trust --status` says so); change the commands and it asks again. In CI, set `MEERKAT_TRUST_PROJECT=1`, only for a repo you own. With no `commands.build` in the config, `meerkat build` says so and nothing runs.

## Why are MCP results big, or why are they small?

They are small by default. `meerkat_summary` and `meerkat_gate` answer in a few lines (pass or fail, blocking count, pre-existing count, failed check names, run folder). Pass `full: true` to `meerkat_gate` for every check and finding. For findings use `meerkat_findings` with `limit`, then `meerkat_finding` with an id. Big output means someone asked for the full form.

## How do I get progress on a long run?

Today it depends on the command. A run started in a terminal draws a live board with a progress bar. With `--plain`, in CI or from an agent there is no board. `verdict` and `top` print a progress line on stderr for each check (`[n/total] check ... 0.2s FAIL`) and one line every 30 seconds for a check that is still running (`MEERKAT_GATE_HEARTBEAT_MS` changes the interval); the answer goes to stdout. `meerkat gate` shows progress in a terminal. For a long `meerkat_run` over MCP, start it and poll `meerkat_last`; do not sleep. `meerkat logs` prints the log folder, and each run has its own folder there.

## What does the cargo lock waiter output mean?

Meerkat's built-in cargo lock makes cargo jobs wait for each other on one machine. A waiting job prints `wait started: the lock at <dir> is held by process <pid> (<command>)`, a reminder every 30 seconds, then `wait ended: got the lock after <n> s`. If the holder is still there after the limit (default 900 seconds, `MEERKAT_LOCK_MAX_WAIT`), it prints `NOT RUN: waited ... another job still holds it. Stop and report, do not retry in a loop.` and exits 75. A holder that has died is cleared at once. This build prints one holder, not a list of everyone waiting.

## How do I add a known failure?

Put it in the known-failures file and pass it: `meerkat verdict --base origin/main --known known-failures.json`. Each entry is `{ "check": "<id>", "file": "<path>", "line": <optional number> }`. A match prints `KNOWN: ...` and does not block; an entry that no longer matches prints `STALE: ...`, so delete it. `--json` gives the same result as one object. To accept a single finding with a reason instead: `meerkat dismiss <id> --reason "why this is fine"`. Take it back with `meerkat undismiss <id>`. Details: [neuralvault.md](neuralvault.md).

## What does NO-RESULT mean?

`verdict` could not judge, so it will not say PASS. The line holds a reason and a next step: `NO-RESULT (status N): <reason>. Next: <step>`, and it is the first line. Exit code 3 means no result (nothing changed, no files to judge, an unknown base ref, no check could run); exit 4 means the base is too far ahead (STALE); exit 2 means a usage problem such as a bad flag or a bad `--known` file. `top` prints the same NO-RESULT lines. They are never silent. Do the next step once. Never read it as a pass.

## What does exit code 75 mean?

Incomplete, never a pass: a wait for the cargo lock ran out, or the run stopped before its record was saved. A missing base, no checks loaded or a bad ref is exit 3 and a non-git folder is exit 2. For `blast` and `brief`: the file is not in the code map, so run `meerkat map` first. It is never a pass.

## Why does it say my folder is not a project?

Meerkat only checks projects. Move into the repository, or add `--force`. The exit code is 2.

## Why does the gate say nothing changed?

The gate looks at changed files. With `--staged` it needs staged files (`git add` first). With `--base <ref>` it needs commits or edits since that ref.

## Does Meerkat change my code?

No. Checks only read. Some commands write files elsewhere: a run folder under the log folder, `codemap.json` and `codemap.md` (`meerkat map`), a prompt file (`meerkat prompt`), your dismissals (in your home folder), and the pre-push hook (`meerkat hook install`). [capabilities.md](capabilities.md) says which MCP tools do this.

## Which tools can an AI call safely without asking?

The read-only ones: `meerkat_findings`, `meerkat_finding`, `meerkat_blast`, `meerkat_brief`, `meerkat_doctor` and the other read-only tools in the table in [capabilities.md](capabilities.md). Ask a person before `meerkat_dismiss`, `meerkat_baseline`, `meerkat_undismiss` and `meerkat_hook`, which carry a destructive hint.

## Is there an MCP tool for `verdict`?

Not in this build. `node bin/meerkat-mcp.mjs --list-tools` shows the 36 tools and none is `verdict` or `top`. Use `meerkat_summary` over MCP, or call the CLI.

## Where are the logs, and how do I keep them?

`meerkat logs` prints the log folder (default `~/.meerkat/logs`). Set `MEERKAT_LOG_DIR` to a folder you keep so run history survives a temp cleanup.
