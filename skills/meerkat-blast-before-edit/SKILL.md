---
name: meerkat-blast-before-edit
description: |-
  Use when you are about to change, rename, move or delete a function, class, file or export, or refactor code that has callers; it shows every importer, affected module and covering test before you touch it.
  Not for new code with no callers.
---

# Meerkat blast radius before an edit

## When to use

- You will change the behaviour, signature, name or location of a function, class, file or exported symbol.
- You will delete a file, or refactor code you did not write.
- You need to know which tests to read and rerun for a change.

## Not for

- Brand-new code that nothing imports yet.
- Learning a whole codebase: use `meerkat-map-unfamiliar-code` first, then come back here per file.
- Checking the finished change: use `meerkat-before-commit`.

## Steps

1. Get the short brief first when you are about to edit a symbol.
   - CLI: `meerkat brief <file>#<symbol>` (`--json` for the facts). MCP: `meerkat_brief` with `{"folder": "<folder>", "target": "src/a.js#name"}`.
   - It returns the declaration, callers, tests that reach it, findings from the last saved run, git churn and a risk tier with a checklist. It starts no scan.
2. Run blast on the file, or on one symbol in it, for the full list.
   - CLI: `meerkat blast <file>` or `meerkat blast <file>#<symbol>`. Add `--app <folder>` when the project is not the current folder, and `--json` for the full result.
   - MCP: `meerkat_blast` with `{"folder": "<folder>", "target": "src/a.js#name"}`.
3. Read the exit code.

| Code | Meaning | What you do |
|---|---|---|
| 0 | Result printed. | Go to step 4. |
| 2 | Usage problem (for example no target given). | Fix the command. |
| 75 | The file is not in the code map. | Not a pass. Check the path, or run `meerkat map --app <folder>` (MCP `meerkat_map`) and look for it. |

4. Read the result in this order:
   - Importers: every file that imports the target. These are the places your change can break.
   - Modules touched: how far the change spreads.
   - Tests that reach it: open and read these before editing. They state what the code must keep doing.
   - Unresolved imports: imports Meerkat could not follow. They may be importers. They are never counted as safe, so check them by hand.
5. Make the edit.
6. Run the tests that reach the target, then the gate: `meerkat gate` (MCP `meerkat_gate`). For a large change use `meerkat gate --base <ref>`.

## What the output means

- Many importers for a small edit: the change is wide. Say so before making it.
- An empty importer list is not proof of safety when there are unresolved imports.
- A high risk tier in the brief means many callers, few tests, high churn or open findings; read the listed reasons.
- Blast and brief only read the code map; they change nothing. The map is cached per git commit and rebuilt when a source file changed, so a repeat run is quick.

## Tools used

CLI: `meerkat brief`, `meerkat blast`, `meerkat map`, `meerkat gate`.
MCP: `meerkat_brief`, `meerkat_blast`, `meerkat_map`, `meerkat_gate`.

## Rules

- If blast shows many importers for a small edit, say so before making it, and consider adding a new function instead of changing the old one.
- Do not treat an empty importer list as proof of safety when there are unresolved imports.
- Run one Meerkat run at a time.

Related: `meerkat-map-unfamiliar-code`, `meerkat-before-commit`, `meerkat` (overview).
