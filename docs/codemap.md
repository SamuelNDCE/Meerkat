# The code map

`meerkat map` writes a map of a project that an AI (or a person) reads before touching the code: `codemap.json` (everything, for tools) and `codemap.md` (the same, short, for reading). `meerkat blast` and `meerkat brief` are built on it.

## What is in it

| Part | Content |
|---|---|
| Header | Schema version, project name, counts (files, symbols, routes, test files), the git commit it was built from, when, and a content hash. |
| Routes | Method, path and `file:line` for each route of a recognised framework. The header names every framework it recognised and every one it saw but did not parse. |
| Files | Path, language, lines, a one-line purpose (from a leading comment only), exports, functions, classes and methods with line numbers, imports resolved to project files, and the test files that import it. |
| Tests | Which test file imports which source files. |
| Entry points, modules, edges, most imported files, unresolved imports | As before. An import that cannot be pointed at a file is listed as unresolved with a reason; it is never guessed. |

Routes are read for Express, Fastify, Hono, Koa router, Restify, hapi and Polka (a method call with a string path, `.route('/p').get(...)`, or `route({ method, url })`), Next.js (app router `route` files and `pages/api`, from the file path), and Flask, Quart, FastAPI and Sanic (decorators). Not followed: mounted prefixes (`app.use('/api', router)`), template-string paths, routes built at run time, NestJS, Django and other frameworks. Test files are skipped.

## Always current

- The output is sorted and holds no clock, so an unchanged project gives byte-identical files. The build time is kept from the earlier map while nothing changed, and a run that finds nothing new writes no new run folder.
- The per-file facts are cached by size, modification time and content hash in the Meerkat data folder (`<cache>/map-<project>.json`, next to the other caches, never in your repo). A run trusts a file whose size and time are unchanged, hashes one that looks different, and parses again only when the hash changed. Touching a file or switching branches back does not cause a re-read.
- `meerkat map --check` exits 0 when the saved map matches the working tree, and 1 with the list of new, changed and removed files when it does not. It reads no file contents except those whose time changed.
- `meerkat blast`, `meerkat brief` and the MCP tools refresh only the stale files before answering and print one line, for example `map: refreshed 2 files first (11 ms)`.

## Running it from a git hook

`meerkat map --quiet` prints nothing unless it fails, exits 0 when it worked and 1 if it could not save, and does nothing visible to the working tree. Put it in `.git/hooks/post-commit` (and `post-merge`, `post-checkout` if you switch branches a lot):

```sh
#!/bin/sh
meerkat map --quiet || echo "meerkat map failed" >&2
```

It is incremental, so a commit costs a stat of each source file plus a re-read of the files that changed. To fail a CI job when the committed map is behind, run `meerkat map --check`.

## Limits, honestly

Regular expressions, not a full parser. The map does not follow tsconfig aliases, `package.json` imports maps, computed `require` or `import` calls, generated code or mounted route prefixes. A test is shown as covering a file only when it imports it; a test that starts your program as a child process is not seen. A function that is defined by a pattern the parser does not know (for example an object-literal method) is not listed. The commit in the header is the commit checked out when the map was built; the content comes from the working tree, so uncommitted edits are included. A file is trusted as unchanged when its size and modification time are unchanged, so a tool that rewrites a file in place with the same size and a preserved time is not noticed until the next real edit.
