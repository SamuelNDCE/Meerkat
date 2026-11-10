---
name: meerkat-click-through
description: |-
  Use when you built or changed a screen and must prove each page opens and each button works. PLANNED: does point to docs/click-through.md, invents no commands.
---

# Meerkat click-through (planned)

Status: planned. The full guide is being written on a separate branch by another worker. This skill will be completed from that guide. Nothing here is a confirmed command.

## What exists now

- `docs/click-through.md` in this repository describes how to wire a click-through driver into a project as a check. Read it first. Use only what it documents.
- Meerkat does not ship a browser driver. It runs the project's own command, schedules it so only one window group runs at a time, times it, and reports a finding. The driver command must exit 0 when every page loaded and every control reacted, 1 on a problem, 75 when it could not start here.
- To see what checks exist for a project, run `meerkat tests --json` and `meerkat doctor`.
- To add the driver as a check, see `docs/writing-checks.md` and `meerkat check` (list, show, add, edit, remove or run).

## What is planned

- A short, tested command sequence for running the click-through on a web app and on a desktop app.
- How to read the result when a page crashes or a control does nothing.

Do not write those commands from memory. When the guide lands, replace this section with its exact commands and exit codes, and remove the word "planned" above.

## Rules

- Run one Meerkat run at a time. A click-through opens windows and fights other heavy checks.
- A NOT RUN (exit 75, for example no display or app not built) is never a pass.

Related: `meerkat` (overview), `meerkat-smoke-and-red`.
