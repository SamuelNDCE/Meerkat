# Roadmap: workflows and orchestration

Logged, not built. Planned for the next update. Each item says what exists today, what is missing, and what would count as done.

## Why

Meerkat already gates, verdicts and batches changes, and it already isolates work in git worktrees with claims that keep sessions off each other's files. What it does not do is plan work for several agents, hand each agent a brief, run them with limits, and bring the results back together. The aim is to let one lead plan a job, split it into briefs, run tens or hundreds of agents safely, and gate every result the same way.

## Research (one search pass, not verified against primary docs)

- Lead-and-workers is the common core: one lead plans and delegates, subagents work independently and return results, and the lead combines them. [Anthropic: five coordination patterns](https://claude.com/resources/articles/multi-agent-coordination-patterns), [developersdigest overview](https://www.developersdigest.tech/blog/multi-agent-orchestration-patterns)
- Sequential runs add token cost without speed unless deliberately parallelised. Wave-based runs (groups of independent steps, then a gate) are a common middle. [Anthropic](https://claude.com/resources/articles/multi-agent-coordination-patterns), [Codex patterns](https://codex.danielvaughan.com/2026/03/27/multi-agent-orchestration-patterns)
- Direct agent-to-agent coordination gets hard as the count grows; a shared record (a message bus or a plan file) is the usual answer. [Anthropic](https://claude.com/resources/articles/multi-agent-coordination-patterns)
- Parallel agents need non-overlapping file ownership. Two agents editing one file is the usual failure. [Claude Code parallel guide](https://zencoder.ai/blog/claude-code-parallel-agents), [parallel worktrees](https://www.skills.lc/SpillwaveSolutions/parallel-worktrees/spillwavesolutions-parallel-worktrees-skill-md)
- Isolate each agent in its own git worktree and compare or merge afterwards. [Parallel worktrees](https://www.skills.lc/SpillwaveSolutions/parallel-worktrees/spillwavesolutions-parallel-worktrees-skill-md)
- Batch large jobs (one guide suggests about five at a time for 50+ tasks) and start with one agent before scaling. [Claude Code subagent practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices), [Claude Code parallel subagents guide](https://claude-skills-guide-3lc.pages.dev/parallel-subagents-claude-code-best-practices-2026/)
- Extra agents add cost, latency and harder tracing. Use them only where work splits cleanly into stages. [scrumlaunch](https://www.scrumlaunch.com/blog/ai-subagents-guide-2026)
- Unverified: the speedup figures quoted in some of these sources (for example "10 hours to 1.5 hours") come from secondary pages. Do not quote them.
- Primary reference to read before building: Anthropic's subagent documentation at code.claude.com/docs/en/sub-agents (not yet opened).

## Items

### R1. Plan file (`meerkat plan`)
- Today: none. A run is one command over the whole change.
- Build: the lead writes a plan file (JSON or markdown) listing tasks, each with its files it owns, its dependencies, the command that proves it done, its time box and its turn cap.
- Done when: `meerkat plan check <file>` rejects overlapping file ownership, dependency cycles and tasks with no done-check.

### R2. Briefs from the plan (`meerkat plan brief <task>`)
- Today: each agent brief is written by hand.
- Build: one brief per task, generated from R1: goal, owned files, done-when command, the gate to run, the time box, and the rule to report the gate's blocking count.
- Done when: a brief can be pasted into an agent with no other context, and the test checks every required section is present.

### R3. Orchestrated run (`meerkat orchestrate <plan>`)
- Today: none. Batches gate several branches; they do not start agents.
- Build: start agents from the plan in waves (independent tasks together, then gate), each in its own worktree with a claim on its files, a concurrency limit, and a per-agent time limit.
- Done when: a dry run prints the waves, the files and the limits, and a real run reports each agent's result and gate outcome.

### R4. Per-agent gate and aggregate verdict
- Today: `meerkat verdict` and `meerkat gate` work per worktree.
- Build: after each agent finishes, gate its worktree; then combine all results into one verdict with the failing agents named.
- Done when: one failing agent gives a single FAIL that names it, and its worktree is kept, not deleted.

### R5. Limits, watchdog and partial results
- Today: a single gate has a time limit (exit 124) and a resume file.
- Build: each agent has a time limit and a turn cap; a watchdog stops an agent that is over and keeps its partial state as a patch on its branch.
- Done when: a stopped agent leaves a readable partial state and the run continues with the others.

### R6. Status and resume (`meerkat orchestrate status`, `--resume`)
- Today: `meerkat run-list` and `--resume` exist for gates only.
- Build: show running, finished, stopped and failed agents, and resume the failed ones from their saved state.
- Done when: a run stopped half way resumes without redoing finished tasks.

### R7. Cost and load guard for hundreds of agents
- Today: none.
- Build: before a run starts, print the number of agents, the waves, and a rough token estimate from the plan; refuse above a limit unless told to go on.
- Done when: a 200-task plan prints its estimate before any agent starts.

### R8. File-ownership preflight
- Today: the `conflict-preflight` script lives in NeuralVault's tooling, not in Meerkat.
- Build: move the check into Meerkat so `plan check` and `orchestrate` refuse two agents on the same file.
- Done when: the preflight test fails on an overlapping plan.
- Worktree folders are owned too. A claim covers the worktree folder as well as its files. Seen in practice (reported by NeuralVault): one agent removed another session's worktree folder. Done when: a worktree with another session's claim cannot be removed by `worktrees close` or by any cleanup command.

### R9. MCP tools for orchestration
- Today: `meerkat_gate`, `meerkat_verdict`-style tools exist; none start or track agents.
- Build: `meerkat_plan_check`, `meerkat_orchestrate_status`, and a dry-run orchestrate tool, so an AI client can plan and inspect a run.
- Done when: each new tool is listed in `docs/ai.md` and the docs-truth test covers it.

## Open questions

1. Do agents run through the host's own agent API, or through `claude -p` processes that Meerkat starts? (Choice affects R3's limits and R5's watchdog.)
2. Who owns a plan's file list if two plans overlap across sessions? (Claims in the shared git directory are the current answer, and they do not yet cover worktree folders; see R8.)
3. Should a plan's cost estimate be a hard limit or a warning?
