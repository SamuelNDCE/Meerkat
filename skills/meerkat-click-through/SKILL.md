---
name: meerkat-click-through
description: |-
  Use when you built or changed a web or desktop screen and must prove each page opens and each button works; PLANNED, so it points to docs/click-through.md and invents no commands.
  Not for backend-only changes.
---

# Meerkat click-through (planned)

Status: planned. The full guide is being written on a separate branch by another worker. This skill will be completed from that guide. Nothing here is a confirmed command.

## When to use

- You built or changed a screen, page, dialog or button and are about to say "the UI works".
- A web or desktop app needs a walkthrough that opens every page and presses every control.

## Not for

- Backend-only or library changes: use `meerkat-before-commit`.
- Proving Meerkat itself works: use `meerkat-smoke-and-red`.

## What exists now

- `docs/click-through.md` in this repository describes how to wire a click-through driver into a project as a check. Read it first. Use only what it documents.
- Meerkat does not ship a browser driver. It runs the project's own command, schedules it so only one window group runs at a time, times it, and reports a finding. The driver command must exit 0 when every page loaded and every control reacted, 1 on a problem, 75 when it could not start here.
- To see what checks exist for a project and whether a UI check is wired:
  - `meerkat tests --json` / `meerkat_tests` (kinds of check), `meerkat doctor` / `meerkat_doctor` (what would run, what is missing), `meerkat_check_list` (the project's own checks), `meerkat_discover` and `meerkat_recommend` (the project's tests and coverage gaps).
- To add the driver as a check, see `docs/writing-checks.md` and `meerkat check` (list, show, add, edit, remove or run).
- Once a driver check exists, run it like any check: `meerkat check <id>` or MCP `meerkat_run` with `only: ["<id>"]` (run in the background and poll `meerkat_last`; it opens windows).

## What the output means

- Driver exit 0: every page loaded and every control reacted. Exit 1: a problem, shown as a finding. Exit 75: it could not start (no display, app not built), which is NOT RUN and never a pass.
- If no UI check is wired, there is no click-through result. Say so; do not claim the UI works.

## What is planned

- A short, tested command sequence for running the click-through on a web app and on a desktop app.
- How to read the result when a page crashes or a control does nothing.

Do not write those commands from memory. When the guide lands, replace this section with its exact commands and exit codes, and remove the word "planned" above.

## Tools used

CLI: `meerkat tests`, `meerkat doctor`, `meerkat check`.
MCP: `meerkat_tests`, `meerkat_doctor`, `meerkat_check_list`, `meerkat_discover`, `meerkat_recommend`, `meerkat_run`, `meerkat_last`.

## Rules

- Run one Meerkat run at a time. A click-through opens windows and fights other heavy checks.
- A NOT RUN (exit 75, for example no display or app not built) is never a pass.

Related: `meerkat` (overview), `meerkat-smoke-and-red`.
