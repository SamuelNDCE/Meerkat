# Code map

What each part of the repository does, how they connect, and where external services and secrets are used. Read this before exploring the code. Keep it factual; update it in the same commit as any structural change.

Last reviewed at release 0.5.3 (`v0.5.3`). Counts are not written here: count them with `ls` or `git ls-files`.

## Entry points

| Entry | What it is |
|---|---|
| `bin/meerkat.mjs` | The `meerkat` command-line tool (package `bin`). Routes each subcommand to `lib/cli.mjs` and the `lib/*cmds.mjs` modules. |
| `bin/meerkat-mcp.mjs` | The MCP server (stdio). Exposes the checks, the run reports and the verdict as MCP tools, resources and prompts. |
| `run.mjs` | The check runner that `meerkat gate` and `meerkat verdict` drive for each run. Its header comment still names an app path from NeuralVault (`apps/desktop-electron`); that comment is out of date, the runner itself is not app-specific. |

## Folders

| Folder | What it holds |
|---|---|
| `lib/` | The engine: the CLI and its command modules (`*cmds.mjs`, `cli.mjs`, `help.mjs`), run and gate logic (`gate.mjs`, `runner.mjs`, `timeouts.mjs`, `gatecache.mjs`), the verdict and batch (`branchcmds.mjs`, `batch.mjs`, `devbaseline.mjs`, `verdict-extra.mjs`), the cargo lock (`lock.mjs`, `lockwait.mjs`), frontend steps (`frontend.mjs`), the code map (`codemap.mjs`), the MCP tool layer and AI calls (`ai*.mjs`), the findings and run logs (`findings*.mjs`, `runlog.mjs`, `runs.mjs`), and tests (`*.test.ts`). |
| `packs/` | Built-in check packs, one folder per language or area (for example `rust`, `node`, `python`, `web`, `security`, `secrets-plus`, `git`). A pack declares its checks and presets. |
| `thorough/` | The slower, deeper checks used by `meerkat full` and the thorough tier, one module per area. |
| `profiles/` | Starting configs for `meerkat init --profile`: `solo`, `team`, `ai-agent`, `legacy`, `monorepo`, `ci-only`. |
| `catalog/` | Check catalogue material for JavaScript/TypeScript, Python and Rust. |
| `examples/` | Example packs and drivers (custom checks, GitHub, NeuralVault). Read by `lib/example-packs.mjs`. |
| `fixtures/` | Planted-defect projects that `meerkat self-test` and `meerkat smoke` read at run time. Shipped on purpose. |
| `benchmarks/` | The real-code benchmark (`real-rust`) and a NodeGoat file. Repository checkout only. |
| `migrations/` | Config and data migrations (`next.json`). |
| `skills/` | Agent skills that ship with the package (for AI assistants). |
| `tools/` | Maintenance and release scripts: `tools/release/` (gate, changelog check, pack list, tarball smoke test, upgrade smoke test, fix-test rule), `tools/corpus/` (accuracy corpus), `tools/` misc. Not shipped in the package. |
| `docs/` | The guides. The README links to them. `checks.md` is generated. |
| `tests/` | Vitest suites that exercise the CLI end to end and the docs. |

## How the parts connect

- `bin/meerkat.mjs` parses the subcommand, then calls the matching module in `lib/`.
- `gate`, `verify`, `full` and `verdict` run `run.mjs`, which loads packs and profiles, runs the checks (in-process or as child processes with a per-check timeout), and writes results to the run folder.
- `verdict` and `batch` call the same run code in a temporary checkout. `batch` merges the branches first and keeps the result in `batches/`.
- The MCP server (`bin/meerkat-mcp.mjs`) calls the same `lib/` functions; it does not run a separate check engine.
- Results go to the per-user data folder (`lib/datadir.mjs`), one folder per run, with `findings.json` and per-check logs.
- The memory hook (`lib/memory.mjs`, `lib/memorybranch.mjs`, `lib/aihooks.mjs`, and `docs/neuralvault.md`) hands the newest run to an adapter named in the config. It is off unless configured.
- Frontend steps read the approved `commands` block of `meerkat.config.json` (`lib/frontend.mjs`, `lib/discover.mjs`).

## External services and secrets

- **Network:** none during a normal run. `npm audit` (release gate, `tools/release/gate.mjs`) and `meerkat update` (`lib/update.mjs`, fetches the release tarball from GitHub and checks its SHA-256) are the only network calls. Both are opt-in or release-time.
- **AI calls:** only when you enable an AI provider in the config (`lib/aitransport.mjs`, `lib/aimodel.mjs`). Keys are read from the environment by name, never written to a file.
- **Secrets in this repo:** none. The release gate's secret scan (`thorough/secret-scan.mjs`) runs over the tracked files and must find nothing.
- **Publishing:** `.github/workflows/publish.yml` publishes to npm with trusted publishing (OIDC). No npm token is stored. Its setup is in `docs/release.md`.
- **CI:** `.github/workflows/ci.yml` runs the tests on Linux, Windows and macOS and the release gate on pull requests.

## Where to change things

| To change | Look in |
|---|---|
| A new CLI command | `lib/cli.mjs` (routing), `lib/help.mjs` (help text), the module under `lib/`, `docs/commands.md` |
| A check | the pack under `packs/`, `docs/checks.md` is generated from it |
| A preset | the pack or `lib/presets*.mjs`, `docs/tiers.md` |
| The verdict or exit codes | `lib/branchcmds.mjs`, `lib/gate.mjs` (classification), `docs/neuralvault-gate.md` |
| A release | `CHANGELOG.md`, `package.json`, `docs/release.md`, `tools/release/` |
