# Roadmap

Ordered. Each step says what Samuel must decide. Nothing here is started in this repo; the tool still lives in NeuralVault.

| Step | What | Decision for Samuel |
|---|---|---|
| 1. Keep it working in NeuralVault | Fix what runs show; keep fast and thorough green. Track the open follow-ups to PR 3122 | None |
| 1b. Make it faster | Ranked ideas in `docs/speed.md`; the first two are an ordering change in NeuralVault | Whether to trial them; none that weaken coverage |
| 2. Show times on this PC | Per-check times already saved on the machine; surface them in the list and the end table | Where the run history lives and how many runs to keep (see `docs/terminal-ui.md`) |
| 3. Terminal UI | Build the proposal in `docs/terminal-ui.md`, starting with a richer status file and a renderer with no new dependency | Approve the proposal; choose a build option (A to D); decide whether any library is acceptable |
| 4. Run after a build finishes | A build step ends, then Meerkat starts. Today the signed Beta chain runs the older `verify:all` and Meerkat is not on `beta` yet | Which builds trigger it; which tier; must a failure block the signed build or only report; the PC must be otherwise idle, so should it wait for a quiet machine |
| 5. Set-up in one guided step | Turn `meerkat:doctor` from a report into a guided "fix it for me" with confirmation | How much it may install by itself |
| 6. Generalise | Split app-specific checks (sidecar, app windows, shell guard) into plug-ins; a config file says which apply | What "works with everything" means: which other apps or kinds of app must be supported first |
| 7. Extract | Move code here with history; NeuralVault depends on it. Until then no code is copied (see `PROJECT.md`) | When to extract; how NeuralVault consumes it (package, submodule, pinned release) |
| 8. Name and licence | Check for trademark and name clashes; pick a licence; decide public or private | All of it: name, licence, visibility |
| 9. Inside the app | Whether a run view appears in NeuralVault itself | Whether a developer tool belongs in the customer app at all (open question) |

Open facts to settle first: per-check times for the three opt-in checks are not measured; the 2026-10-30 thorough run has outcomes but no per-check times; the cause of the 2026-10-29 thorough exit code 127 was not read.


## Targets: one tool for more than NeuralVault (Samuel, 2026-10-31)

Samuel wants Meerkat to become the tool for everything he builds, not only NeuralVault: a Chromium-based app, a Rust app that also runs Electron, and whatever else makes sense. **Not built.** Today the checks are NeuralVault's (they assume an Electron app with a Rust sidecar), and only the app's folder is a setting.

The shape this points to, as a proposal to confirm with Samuel before building:
- A **target** is a small config in the app's own repository (which checks apply, where its builds and drivers are, which paths count as changed), read by Meerkat. The checks that are NeuralVault-specific become a plug-in for the "Electron + Rust sidecar" kind of target.
- A few **kinds** of target ship with Meerkat: Electron + Rust sidecar (today's), Chromium-based app, plain Rust app, Rust + Electron. A kind is a set of checks plus the commands that build and open the app.
- What stays the same for every target: the NOT RUN rule, the lanes and locks, the fast and thorough tiers, the self-test (every check must fail on a broken case), the terminal view and the viewer.
- First step, before any new kind: move the NeuralVault-specific lists (`APP_PATHS`, the commands, the driver names) out of the check files into one target file. That is a refactor with no change in behaviour and can be checked by the same self-test.
