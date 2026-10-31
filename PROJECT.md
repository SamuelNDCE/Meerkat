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
- **Pushing.** Commit as yourself, no AI co-author line, stage files by name, and open a pull request for anything beyond README and PROJECT.md edits.
- **Licence.** None chosen yet. Do not add one without Samuel. The code carries no copyright or proprietary headers (removed 2026-10-31 at Samuel's instruction, because it will probably be open source); do not add them back.

## Where things are

| Need | Where |
|---|---|
| What Meerkat is | `README.md` here, `docs/testing/validation-tool-overview.md` in NeuralVault |
| The tool's contract for people who change it | `docs/testing/validation-tool.md` in NeuralVault |
| The code | this repository's root: `run.mjs`, `lib/`, `checks/`, `thorough/`, `fixtures/`, `rules/` |
| Its tests | `npm test` here (Meerkat's own tests, no app needed) |
