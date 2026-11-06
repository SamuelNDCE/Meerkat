---
name: meerkat-map-unfamiliar-code
description: |-
  Use when you start work in a codebase you do not know, when you are asked to read or explain unfamiliar code, or when you are planning a refactor or a new feature and do not yet know where it belongs.
  Runs Meerkat's code map, then you read the entry points and the most imported files first, before opening anything else.
  Follow it with blast radius on the files you plan to change.
---

# Meerkat map for unfamiliar code

## Order

1. Write the map:

```
meerkat map --app <folder>
```

Leave `--app <folder>` off to use the current folder. Add `--json` for a machine-readable result.

2. The command writes `codemap.json` and `codemap.md` into a run folder. Read the path it prints, or print the folder with `meerkat logs`. Open `codemap.md`.

3. Read in this order:
   1. The entry points: where the program starts. Open these files first.
   2. The most imported files: shared code that many modules depend on. A change here has the widest reach.
   3. The module list, to see how the code is split.
4. Only then open other files, guided by the entry points.
5. For each file you plan to change, run blast radius:

```
meerkat blast <file>
```

See `meerkat-blast-before-edit` for how to read it.

6. For a refactor, also run the checks once before you start, so you know which failures were already there:

```
meerkat verify
```

Save the run summary (`--json`) or note the failing checks, so you can tell later what you broke and what was already broken.

## Rules

- Do not guess the architecture from file names. Read the map.
- A file the map does not list cannot be blasted (exit 75). Check the path.
- Unresolved imports in the map are not proof a file is unused.

Related: `meerkat-blast-before-edit`, `meerkat` (overview).
