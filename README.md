# Meerkat

Meerkat is the validation tool made for NeuralVault: one command that checks an app before you push, before a promotion and before a build. It has a fast tier (under 5 minutes) and a thorough tier (about 20 minutes), opens the real app, walks every page and control, and never passes quietly when something is missing.

## Status

**This repository is a placeholder.** The working tool still lives inside the NeuralVault repository, under `apps/desktop-electron/scripts/verify/` and `docs/testing/`, and runs there with `npm --prefix apps/desktop-electron run verify` (also `meerkat`, `meerkat:thorough`, `meerkat:doctor`). Nothing has been moved here yet. Until it is, NeuralVault is the source of truth and changes go there.

## Plan

1. Keep Meerkat working inside NeuralVault (PR 3122 and its follow-ups).
2. Generalise it so it no longer depends on NeuralVault's own sidecar and app windows (the checks that are specific to one app become plug-ins).
3. Move it here with its history, and have NeuralVault use it as a dependency.
4. Decide on a licence and whether to make the repository public. Not decided.
5. Add a UI: a way to see a run, its checks, their status and the saved output without reading terminal text. The form (local page, window, or a section inside the app) is not decided.
6. Make it work with any app and set up in one guided step (`meerkat:doctor` is the readiness check today).

## When to run it

After a build finishes, not only before a push (Samuel, 2026-10-30). Today the NeuralVault signed Beta chain runs the older `verify:all` and not Meerkat, because Meerkat is on `dev` and not yet on `beta`.

## Licence

None chosen yet. Until one is added, all rights are reserved and the repository stays private.

## More

- Overview and contract (in NeuralVault, on `dev`): `docs/testing/validation-tool-overview.md` and `docs/testing/validation-tool.md`.
- Rules for working in this repository: `PROJECT.md`.
