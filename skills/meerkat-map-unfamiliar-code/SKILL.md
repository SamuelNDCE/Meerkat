---
name: meerkat-map-unfamiliar-code
description: |-
  Use when you start in a codebase you do not know, are asked to read or explain code, or plan a refactor or feature; it builds the code map so you read entry points and the most imported files first.
  Not for a single known symbol (meerkat-blast-before-edit).
---

# Meerkat map for unfamiliar code

## When to use

- First time in a project, or asked "how does this work" / "explain this code".
- Planning a refactor, a new feature, or a migration across several files.
- You are about to grep around to find the entry point: build the map instead.

## Not for

- Editing one known function: use `meerkat-blast-before-edit` directly.
- Judging whether changes are safe to commit: use `meerkat-before-commit`.

## Steps

1. Write the map.
   - CLI: `meerkat map --app <folder>` (leave `--app` off for the current folder; `--json` for a machine-readable result; `meerkat map --check` says whether the saved map is current).
   - MCP: `meerkat_map` with `{"folder": "<folder>"}`.
2. The command writes `codemap.json` and `codemap.md` into a run folder; only files changed since the last map are re-read. `codemap.md` starts with the schema version, counts, the commit and the routes, then lists each file with its purpose and functions with line numbers, and which tests cover it. Read the path it prints (CLI: `meerkat logs` prints the folder). Open `codemap.md`.
3. Read in this order:
   1. The entry points: where the program starts. Open these files first.
   2. The most imported files: shared code that many modules depend on. A change here has the widest reach.
   3. The module list, to see how the code is split.
4. Only then open other files, guided by the entry points.
5. For each file you plan to change, get the brief and the blast radius.
   - `meerkat brief <file>#<symbol>` / `meerkat_brief` (short: callers, tests, churn, risk tier).
   - `meerkat blast <file>` / `meerkat_blast` (full list). See `meerkat-blast-before-edit` for how to read it.
6. For a refactor, learn what the project can check and what is already broken before you start.
   - Which checks exist and what they prove: `meerkat tests --json` / `meerkat_tests`; what the project's own tests and scripts are: `meerkat_discover`; coverage gaps: `meerkat_recommend`.
   - Baseline run: `meerkat verify` (MCP `meerkat_run`, default preset `quick`, takes minutes: start in the background and poll `meerkat_last`). Save the summary (`--json`) or note the failing checks, so you can tell later what you broke and what was already broken.

## What the output means

- Entry points and most imported files show where to start and where changes are widest.
- Routes and tests in the map tell you which behaviour is covered. A file with no listed test is a risk to edit.
- Unresolved imports are not proof a file is unused.
- The map writes only into the Meerkat log folder, never into your source.

## Tools used

CLI: `meerkat map`, `meerkat brief`, `meerkat blast`, `meerkat tests`, `meerkat verify`.
MCP: `meerkat_map`, `meerkat_brief`, `meerkat_blast`, `meerkat_tests`, `meerkat_discover`, `meerkat_recommend`, `meerkat_run`, `meerkat_last`.

## Rules

- Do not guess the architecture from file names. Read the map.
- A file the map does not list cannot be blasted (exit 75). Check the path.
- Run one Meerkat run at a time.

Related: `meerkat-blast-before-edit`, `meerkat` (overview).
