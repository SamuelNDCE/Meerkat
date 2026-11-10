---
name: meerkat-smoke-and-red
description: |-
  Use when Meerkat itself seems broken, a check hangs, a result looks wrong or empty, or you must test against deliberately broken inputs; it picks smoke, self-test or red tests to prove the tool works.
  Not for judging your own code.
---

# Meerkat smoke and red testing

Two different questions. Pick by the question.

## When to use

- A check seems stuck, hangs, or a run looks empty or too good to be true.
- You doubt a check can fail at all (a pass that means nothing).
- You changed Meerkat or a check and must prove it still catches what it should.
- A check is skipped and you need to know why (missing tool).

## Not for

- Asking whether your project is healthy: use `meerkat gate` / `meerkat verify` (`meerkat-before-commit`, `meerkat-before-pr`).
- Planting defects in the real working tree. Never.

| Question | Use |
|---|---|
| Do the checks chosen for my changes start, finish and not misbehave? | `meerkat smoke` / `meerkat_smoke` |
| Does every check fail on a broken case, so a pass means something? | `meerkat self-test` / `meerkat_self_test` |
| Does Meerkat catch planted bugs, survive faults and odd inputs, and stay quiet on clean code? | the red tests in `lib/redtest` / `meerkat_redtest` |
| Is a check skipped or unable to run? | `meerkat doctor` / `meerkat_doctor`, `meerkat_tools` |
| Is my project healthy? | not these. Use `meerkat gate` or `meerkat verify`. |

## Steps

### Smoke

CLI: `meerkat smoke`. MCP: `meerkat_smoke` (pass `folder`; options `staged`, `base`, `against`, `thorough`, `timeout`).

It runs each check selected for the changed files with a tiny time limit. It fails when the tool misbehaves, not when your project has problems. CLI options: `--staged`, `--base <ref>`, `--against <ref>`, `--app <folder>`, `--thorough`, `--timeout <seconds>`, `--json`.

| Code | Meaning |
|---|---|
| 0 | The selected checks started and finished sanely. |
| 1 | A check misbehaved. |
| 2 | Usage or configuration problem. |
| 75 | Not run (no base, no checks loaded). Not a pass. |

Do not confuse it with the preset named `project-smoke`, which asks whether a change breaks the project. List presets with `meerkat presets` / `meerkat_presets`.

### Self-test

CLI: `meerkat self-test`. MCP: `meerkat_self_test` (`only` limits it to some check ids). It runs every check on a broken sample and expects it to fail, and takes minutes. If a check passes its own broken case, that check cannot be trusted.

### Why is a check skipped or not running

`meerkat doctor` / `meerkat_doctor` reports what would run and which outside tools are missing; `meerkat_tools` lists the tools found or missing with install steps and installs nothing. A skipped check is NOT RUN, never a pass.

### Red testing

Red testing attacks the tool on purpose. Each kind builds throwaway projects, breaks them, runs the real tool, and checks it reports the right thing.

```
node lib/redtest/run.mjs --kind mutation
node lib/redtest/run.mjs --kind faults
node lib/redtest/run.mjs --kind adversarial
node lib/redtest/run.mjs --kind regression
node lib/redtest/run.mjs --kind cleantwin
node lib/redtest/run.mjs --kind all
```

MCP: `meerkat_redtest` with a `kind`. It runs from a checkout of the Meerkat repository, takes minutes, so run one kind at a time. Details: `lib/redtest/README.md`.

| Kind | What it checks |
|---|---|
| mutation | A planted defect is reported by the right check. |
| faults | A check that throws, hangs or cannot start is reported as FAIL or NOT RUN, never a pass. |
| adversarial | Odd inputs (empty folder, huge file, odd names) cause no crash or hang. |
| regression | A past fixed bug stays fixed. |
| cleantwin | Clean code gives no false alarms. |

To red-test your own project: run `meerkat self-test`, then plant one known defect in a scratch copy of the project (never the real one), run `meerkat gate --base <ref>`, and confirm it is found. Delete the scratch copy after.

## What the output means

- Smoke exit 0: the machinery works for these files. It says nothing about your code quality.
- Self-test lists checks that did not fail on their broken sample: do not trust a pass from those.
- A red test failure means Meerkat missed, or falsely raised, something: that is a bug in Meerkat; report it with the kind and case name.

## Tools used

CLI: `meerkat smoke`, `meerkat self-test`, `meerkat doctor`, `meerkat presets`, `node lib/redtest/run.mjs`.
MCP: `meerkat_smoke`, `meerkat_self_test`, `meerkat_redtest`, `meerkat_doctor`, `meerkat_tools`, `meerkat_presets`.

## Rules

- A NOT RUN is never a pass.
- Never plant a defect in the real working tree.
- Run one Meerkat run at a time.

Related: `meerkat` (overview), `meerkat-before-commit`.
