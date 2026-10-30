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
