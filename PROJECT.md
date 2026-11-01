# Meerkat: project rules

Operating rules for this repository. If a fact would change what you are allowed to do right now, it belongs here. History and reasoning belong in the vault notes.

## State

A private placeholder created 2026-10-30 under the `perpetual-technologies-official` organisation. The tool itself is still in the `NeuralVault` repository (`apps/desktop-electron/scripts/verify/`, `docs/testing/`). No code lives here yet. \*

> \*Corrected 2026-10-30: Samuel said to move it all here ("just move it all"). The tool's code, checks, fixtures and docs now live in this repository. The app being checked (NeuralVault, `apps/desktop-electron`) stays where it is; Meerkat finds it with `--app <folder>`, `NV_APP_DIR`, or the folder it is started in.

## Rules

- **Private by default.** Do not make this repository public, add or remove people, or change its visibility. Samuel decides, and may make it public later.
- **No secrets, no machine paths.** Nothing from a developer's machine goes in: no tokens, keys, `.env` files, absolute paths such as `C:\Users\...`, or personal data. Per-user settings live outside the repo (Meerkat already reads `~/.nv-verify.json`). The tool never contains an app's secrets: it only reads names of environment variables such as `SNYK_TOKEN` and `NV_STAGING_URL`.
- **Do not copy code in yet.** Extraction is a planned job with its own plan (see README, "Plan"). Until then NeuralVault is the source of truth and changes to the tool go there, so there are never two diverging copies. \*

> \*Corrected 2026-10-30: superseded. This repository is now the source of truth for the tool; change it here. NeuralVault keeps only a small launcher (and, until its pull request lands, an older copy that is deleted by that pull request, so do not edit that copy).
- **Name.** The tool was renamed from "validation tool" to Meerkat on 2026-10-29. Check for trademark or name clashes before making the repository or the name public (not checked).
- **Releases come in batches, at most one a day.** Set 2026-11-01 at Samuel's instruction ("we shouldn't release one at a time... at most one a day"). Fixes merge to `main` as they are ready and collect under `## Unreleased` in `CHANGELOG.md`; a release (`tools/release.mjs`, then a GitHub release, which publishes to npm) happens once a day at most, only when Samuel says so, and moves all the Unreleased notes into that version. Check `gh release list` before cutting one. Anything that pins a version (NeuralVault's launcher) waits for the next batch.
- **Pushing.** Commit as yourself, no AI co-author line, stage files by name, and open a pull request for anything beyond README and PROJECT.md edits.
- **Licence.** None chosen yet. Do not add one without Samuel. \* The code carries no copyright or proprietary headers (removed 2026-10-31 at Samuel's instruction, because it will probably be open source); do not add them back.

## Where things are

| Need | Where |
|---|---|
| What Meerkat is | `README.md` here, `docs/testing/validation-tool-overview.md` in NeuralVault \* |
| The tool's contract for people who change it | `docs/testing/validation-tool.md` in NeuralVault \* |
| The code | this repository's root: `run.mjs`, `lib/`, `checks/`, `thorough/`, `fixtures/`, `rules/` \* |
| Its tests | `npm test` here (Meerkat's own tests, no app needed) |

> \*Corrected 2026-10-31: the licence is the Perpetual Community Licence 1.0 (`PCL-1.0`) in `LICENSE`, chosen and approved by Samuel. Do not change its text without him; `docs/licence-notes.md` records how it was checked and what is open. Source files still carry no headers.

> \*Corrected 2026-10-31: where things are now. What Meerkat is and how to use it: `README.md`, with `docs/writing-checks.md`, `docs/logs.md` and `docs/customizing.md`. The code: `run.mjs`, `lib/`, `packs/`, `thorough/`, `fixtures/`, `tools/`. The checks of the NeuralVault app are an example, not part of Meerkat: `examples/neuralvault/` (its contract and notes are in `examples/neuralvault/docs/`). There is no built-in set of checks any more; checks come from packs. Per-user files are `~/.meerkat*.json`, and run logs are in `~/.meerkat/logs`.

- **No machine paths, no NeuralVault names in the generic code.** The tool's own code (`run.mjs`, `lib/`, `packs/`, `thorough/`) must work for any project. Anything specific to one app goes under `examples/`.
- **Every check proves itself.** A new check ships with a `selfTest` on a small broken fixture and an `expectMatch` for the reason it must fail; after adding or changing checks run `node tools/gen-checks.mjs`.

- **Meerkat's own budgets.** `.meerkat-budgets.json` holds this repository's own limits (long lines, function size, complexity, nesting, `any` in tests, JSON in loops), set just above what the code needs because Meerkat's style is long lines. They are not defaults for other projects. Every `.meerkat-*-allow` file names sample text, deliberate calls or old git history, each with a reason line; the self-run (`node run.mjs --app . --preset full --plain`) must show no failures and no findings.
