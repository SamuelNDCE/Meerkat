---
name: meerkat-blast-before-edit
description: |-
  Use when about to change, rename, move or delete a function, class, file or export, or refactor code with callers. Does show importers, affected modules and tests first.
---

# Meerkat blast radius before an edit

## Order

1. Run blast on the file, or on one symbol in it:

```
meerkat blast <file>
meerkat blast <file>#<symbol>
```

Add `--app <folder>` when the project is not the current folder. Add `--json` for the full result.

2. Read the exit code.

| Code | Meaning | What you do |
|---|---|---|
| 0 | Result printed. | Go to step 3. |
| 2 | Usage problem (for example no target given). | Fix the command. |
| 75 | The file is not in the code map. | Not a pass. Check the path, or run `meerkat map --app <folder>` and look for it. |

3. Read the result in this order:
   - Importers: every file that imports the target. These are the places your change can break.
   - Modules touched: how far the change spreads.
   - Tests that reach it: open and read these before editing. They state what the code must keep doing.
   - Unresolved imports: imports Meerkat could not follow. They may be importers. They are never counted as safe, so check them by hand.
4. Make the edit.
5. Run the tests that reach the target, then the gate:

```
meerkat gate
```

For a large change, run `meerkat gate --base <ref>` instead.

## Rules

- If blast shows many importers for a small edit, say so before making it, and consider adding a new function instead of changing the old one.
- Do not treat an empty importer list as proof of safety when there are unresolved imports.
- The code map is cached per git commit and rebuilt when a source file changed, so a repeat run is quick.

Related: `meerkat-map-unfamiliar-code`, `meerkat-before-commit`, `meerkat` (overview).
