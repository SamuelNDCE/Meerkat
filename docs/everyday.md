# Everyday commands

Each example was run on a small test project. Counts of tools and checks are not typed here: `node bin/meerkat-mcp.mjs --list-tools` and `meerkat tests --json` print them. Every command and flag: [commands.md](commands.md). Full detail for each row: [features.md](features.md).

| Feature | What it does | Example |
|---|---|---|
| Gate, scoped | Checks the files you changed; failures elsewhere are listed, not blocking. `--all` blocks on everything, `--no-cache` re-runs every check | `meerkat gate --base origin/main` |
| Pre-commit | Call the gate from your own `.git/hooks/pre-commit`. `meerkat hook install` writes a pre-push hook (quick preset, ratchet), not a pre-commit one | `meerkat gate --staged` |
| Brief | One call before an edit: callers, tests, last-run findings, churn, risk tier | `meerkat brief src/app.ts#createApp` |
| Blast radius | What imports a file or symbol and which tests reach it | `meerkat blast src/app.ts` |
| Map | Writes `codemap.json` and `codemap.md`; `--check` exits 1 when the saved map is stale; `blast`, `brief` and the MCP map tool re-read stale files first | `meerkat map --check` |
| Ratchet | Accept today's findings, then fail only on new ones | `meerkat baseline`, then `meerkat run quick --ratchet` |
| Run flags | `--config`, `--no-config`, `--group`, `--fail-fast`, `--keep-going`, `--max-run-minutes`, `--timeout-scale` | `meerkat run --help` |
| Findings for CI | `--fail-on` sets the exit code, `--new` counts only new findings, `--export` points at the saved file | `meerkat findings --fail-on high --new` |
| Prompt for an AI | Every finding in full, with what to do | `meerkat prompt --print` |
| MCP scope | Tools that read a run take `folder`, `run` and `preset`, so a call stays on one project. Also `meerkat_version`, `meerkat_check_list`, `meerkat_prompt`, `meerkat_run_list`; `meerkat_run` takes `ratchet` and the run flags | `meerkat mcp install` |
| SKIPPED | A style tool the project never configured (eslint, prettier, stylelint) is SKIPPED with the reason, counted apart, and does not change the exit code. NOT RUN stays for a configured tool that cannot run | `meerkat last` |
| Commit messages | `commit-message-format` judges only commits not yet on the default branch (`git log <base>..HEAD`); with no base it checks the last 20 and says so | `meerkat why commit-message-format` |
| Workflow profiles | A starting config and the commands for `solo`, `team`, `ai-agent`, `legacy`, `monorepo` or `ci-only`; writes only with `--write` | `meerkat init --profile team` |
| Memory adapter | `meerkat memory` hands the newest run to the adapter named by the `memory` key in `meerkat.config.json` (shipped: `examples/neuralvault`, which needs `NV_VAULT_PATH` or `~/.neuralvault-vault-path`); nothing happens without the key | `meerkat memory --dry-run` |
| Release tools | The release gate (changelog, pack list, audit, secret scan, fix-needs-a-test), plus tarball and upgrade smoke tests. Repository checkout only. See [docs/release.md](release.md) | `node tools/release/gate.mjs` |
| Update | Looks up the latest version once a day, installs only when you say so | `meerkat update --check` |
| Windows guard | On Windows a `!` in a command run through cmd.exe is refused when delayed expansion is on, or when the registry cannot be read in 3 seconds. No effect on Linux or macOS | automatic |
| Run estimate | The time estimate follows the newest runs and counts cached checks as nearly free | `meerkat quick --estimate` |
