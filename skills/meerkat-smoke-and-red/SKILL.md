---
name: meerkat-smoke-and-red
description: |-
  Use when checking that Meerkat itself works, a result looks wrong or empty, or testing against deliberately broken inputs. Does explain smoke and red tests; not for your own code.
---

# Meerkat smoke and red testing

Two different questions. Pick by the question.

| Question | Use |
|---|---|
| Do the checks chosen for my changes start, finish and not misbehave? | `meerkat smoke` |
| Does every check fail on a broken case, so a pass means something? | `meerkat self-test` |
| Does Meerkat catch planted bugs, survive faults and odd inputs, and stay quiet on clean code? | the red tests in `lib/redtest` |
| Is my project healthy? | not these. Use `meerkat gate` or `meerkat verify`. |

## Smoke

```
meerkat smoke
```

It runs each check selected for the changed files with a tiny time limit. It fails when the tool misbehaves, not when your project has problems. Options: `--staged`, `--base <ref>`, `--against <ref>`, `--app <folder>`, `--thorough`, `--timeout <seconds>`, `--json`.

| Code | Meaning |
|---|---|
| 0 | The selected checks started and finished sanely. |
| 1 | A check misbehaved. |
| 2 | Usage or configuration problem. |
| 75 | Not run (no base, no checks loaded). Not a pass. |

Do not confuse it with the preset named `project-smoke`, which asks whether a change breaks the project. List presets with `meerkat presets`.

## Self-test

```
meerkat self-test
```

Runs every check on a broken sample and expects it to fail. If a check passes its own broken case, that check cannot be trusted. The MCP tool `meerkat_self_test` does the same.

## Red testing

Red testing attacks the tool on purpose. Each kind builds throwaway projects, breaks them, runs the real tool, and checks it reports the right thing.

```
node lib/redtest/run.mjs --kind mutation
node lib/redtest/run.mjs --kind faults
node lib/redtest/run.mjs --kind adversarial
node lib/redtest/run.mjs --kind regression
node lib/redtest/run.mjs --kind cleantwin
node lib/redtest/run.mjs --kind all
```

| Kind | What it checks |
|---|---|
| mutation | A planted defect is reported by the right check. |
| faults | A check that throws, hangs or cannot start is reported as FAIL or NOT RUN, never a pass. |
| adversarial | Odd inputs (empty folder, huge file, odd names) cause no crash or hang. |
| regression | A past fixed bug stays fixed. |
| cleantwin | Clean code gives no false alarms. |

These run from a checkout of the Meerkat repository. They are slow, so run one kind at a time. Details: `lib/redtest/README.md`.

To red-test your own project: run `meerkat self-test`, then plant one known defect in a scratch copy of the project (never the real one), run `meerkat gate --base <ref>`, and confirm it is found. Delete the scratch copy after.

## Rules

- A NOT RUN is never a pass.
- Never plant a defect in the real working tree.

Related: `meerkat` (overview), `meerkat-before-commit`.
