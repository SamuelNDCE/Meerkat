# Finding the project's own tests

`meerkat full`, `thorough` and `release` also run the tests a project already has, found without being told. They are never added to `quick`, `verify` or `ci`.

```
meerkat discover [folder] [--json]
```

It lists what a full run WOULD add and why. It reads package.json, the Makefile and folder listings; it runs nothing and writes nothing.

## What is found

| Where | Found |
|---|---|
| package.json scripts | `test`, `e2e`, `test:e2e`, `verify`, `verify:*`, `smoke`, `click*`, `playwright`, `cypress`, `screenshots`, `a11y`, `integration` and similar |
| Makefile | targets `test`, `check`, `e2e`, `verify`, `smoke` |
| Config files | `playwright.config.*` and `cypress.config.*` when no script already runs them |
| `scripts/` | files named like `click`, `smoke`, `e2e`, `verify` or `shard` |
| `tests/` | runner scripts no package script points at (only if there is no test script) |
| `node:test` files | when the project has no test script |
| Monorepos | `apps/*` and `packages/*` one level down, when the top has no scripts |

Left out: build, lint, dev, watch and install scripts, scripts that only chain other scripts (their parts are found on their own), helper files, and any command a check Meerkat already has runs (the bundled ones, yours, and the ones your config turned off).

## How they run

Each one becomes a check written as data, `found-<script>`, shown tagged `found`: tier thorough, weight `alone` for e2e, click, playwright, cypress and screenshot scripts and `heavy` otherwise, timeout 900 s, a program and its arguments (no shell).

Anything that opens windows goes on the `windows` lane: electron, playwright, cypress, puppeteer or click in the name, the script line, or the first 4000 characters of the script file it names (and of local files that file requires). On that lane Meerkat sets `HEADLESS=1` and `CI=1`, runs several at once up to `discover.maxWindows` (default 3, never above the CPU count minus one). Every found check gets `MEERKAT_SHARD=<i>/<n>` (`1/1` when not split).

## Shards

A script that takes `--shard` runs as N checks side by side, `found-<script>-shard-<i>`, each with `MEERKAT_SHARD=<i>/<n>` (and `--shard=<i>/<n>` for the flag style). A script that reads `SHARD` or `SHARDS`, or a `scripts/*shard*` file, gets `SHARD=<i>/<n>`. N is 3 by default, never above the window cap. To split any script:

```json
{ "discover": { "maxWindows": 4, "shards": { "script": "test:clicks", "count": 4 } } }
```

## Your config still rules

Found checks obey `disable` and `override` like any other: `"disable": ["found-verify-ui"]` (also turns off every shard of that script), `"disable": ["suite:found"]`, or an `override` of `timeoutSeconds`, `tier` and so on. A command you turned off is never found again. Turn all of it off with `"discover": false` in `meerkat.config.json` or `~/.meerkat.json`. A project setting beats a personal one.

## Safety

- Reading only: names, package.json, the Makefile and (unless `MEERKAT_NO_PROJECT_CODE=1`) the first 4000 characters of referenced script files inside the project. With `MEERKAT_NO_PROJECT_CODE=1` (tab completion sets it) items are still listed, from names and package.json alone, but no script file is opened, so lanes come from names only.
- Every printed string is stripped of control characters, escape sequences included. Items that cannot become a valid check are dropped, not listed.
- Run just these with `meerkat check discovered`.

`--json` fields: `folder`, `enabled`, `maxWindows`, `items[]` (`id`, `title`, `script`, `source`, `why`, `command`, `lane`, `weight`, `estimateSeconds`, `shard`, `note`), `skipped[]`, `turnedOff[]`, `notes[]`.
