# Tiers, estimates and time limits

Written 2026-10-31 from the saved run folders in `~/.meerkat/logs/runs` (61 runs, mostly on Meerkat and Plume, plus one on NeuralVault) and fresh runs.

## The rule

A check is **quick** (`tier: 'fast'`) when it is cheap everywhere it has been measured. A check is **thorough** when it is slow, needs the network or a window, or is opt-in.

| Rule | Quick | Thorough |
|---|---|---|
| Measured median under 3 s and max under 6 s everywhere measured, Node only, no window, no network, not opt-in, not heavy | yes | |
| Compiles, builds or runs a test suite (cargo clippy/test/doc/build, npm test, dotnet, mvn, gradle, go test, swift, pytest, rspec) | left out of `quick` and `fast` (preset `skipCompile`), kept in `full`, `thorough`, `release` and the focused functionality presets | yes |
| Heavy, alone, non-free lane or opt-in | | yes |
| Quick check whose median goes over 8 s | | move it here |

Changed 2026-11-03: the quick preset is "before every push", 5 to 10 minutes at most on a large app, so it no longer runs anything that compiles the project or runs its tests (cargo clippy/test/build, go test, mvn, dotnet build, swift build, pytest, rspec, npm run build, vite/webpack/next build, `npm test`). A direct JavaScript unit-test runner (`npx vitest run`, `npx jest`) runs no compiler or build and stays in quick (for example `unit-tests-changed`). Those checks keep their `fast` tier (so `functionality-fast`, `app-fast` and `ci` still run them) but the `quick` and `fast` presets set `skipCompile`, which drops them and any check that waits on them (a window test that needs the build). The list is `COMPILE_HEAVY_IDS` and `COMPILE_HEAVY_COMMAND` in `lib/presets.mjs`; a new check that runs a compiler is caught by its command, and `tests/presets-quick-budget.test.ts` fails if quick selects one. Type checks that only read the code (`tsc --noEmit`, `go vet`) stay in quick (`QUICK_TYPECHECKS`). Naming a check with `--only` still runs it.

The `quick` and `fast` presets now bring every pack that applies to the folder (`allPacks`), the same as `full`. Before, they only ran the packs named in the project config, so most of the short checks never ran in quick.

## Moves, with evidence

| Check | From | To | Evidence (ms, this PC) |
|---|---|---|---|
| git-history-secrets | thorough | quick | 11 samples, median 357, max 2009 (Meerkat, Plume); 0.7 s on NeuralVault. Node + git, no network |
| long-functions | thorough | quick | 17 samples, median 330, max 1810 |
| deep-nesting | thorough | quick | 17 samples, median 233, max 566 |
| commented-out-code | thorough | quick | 17 samples, median 222, max 498 |
| many-parameters | thorough | quick | 17 samples, median 492, max 3234 |
| cyclomatic-complexity | thorough | quick | 17 samples, median 530, max 2901 |
| unused-files | thorough | quick | 17 samples, median 132, max 278 |

Considered and left thorough (allowlist in `tests/tiers.test.ts`): npm-audit-all (network, max 6600), circular-imports and dead-python (outside tools, never measured here), perf-endpoints, perf-load, perf-build (start the app or build it), rust-build-release and rust-doc (compile).

Nothing in quick had a median over 8 s except the compile checks, which no longer run in quick (see above). The learned times for clippy and test on NeuralVault were 113 s and 601 s for one cold run.

## Planted-defect labels (the accuracy corpus)

Not the same thing as the quick and thorough tiers above. The accuracy corpus ([accuracy.md](accuracy.md)) plants defects, and every planted defect carries two labels:

| Label | Values | Question it answers |
|---|---|---|
| Impact | critical, high, medium, low | How bad is it if this defect is real? |
| Difficulty to find | easy, medium, hard, extreme | How hard is it for a check to find? |

The labels live in `tools/accuracy-tier-fragments/*.txt` (one line per planted key: key, impact, difficulty) and are read by `tools/accuracy-labels.mjs`, which throws on an unknown value, a duplicate key or a planted defect with no label. The corpus run prints recall by impact, recall by difficulty and an impact by difficulty table from them.

The older single tier still exists and is what the corpus table and `docs/accuracy-results.md` use: `tools/accuracy-tiers.mjs` gives every planted key exactly one of critical, hard, medium or easy. The rule: critical is a remote exploit, a secret exposure or data destruction with no unusual precondition; hard needs reasoning across lines or files; medium is a real defect a single-file rule finds with some context; easy is a one-line pattern or hygiene item. It does not change which defects exist or how they are detected. The two systems are separate: the single tier has four values (it does not include high or low), and the two labels are the finer, two-axis view.

## First-run estimates

The written `estSeconds` is a guess for a project with no timing yet. Once a project has a recorded timing, that wins. Timings are kept per project (`~/.meerkat-timings.json`, `projects: { <folder>: { checks } }`); a time from a different project is never used. An older flat file is read as the project it names.

| Check | Was | Now | Weight |
|---|---|---|---|
| cargo fmt | 4 | 10 | |
| cargo clippy | 120 | 180 | heavy |
| cargo test | 150 | 300 | heavy |
| cargo doc | 60 | 120 | heavy |
| cargo build --release | 300 | 400 | heavy |
| cargo audit | 4 | 15 | |
| cargo deny | 10 | 20 | |
| tsc | 15 | 60 | medium |
| eslint, prettier | 20, 10 | 30, 30 | |
| madge | 20 | 20 | |
| dotnet format, build | 20, 30 | 30, 90 | build heavy |
| go vet, go test | 15, 60 | 60, 90 | test heavy |
| mvn compile, test | 60, 90 | 120, 120 | heavy |
| pytest, rspec, swift build | 60, 30, 60 | 60, 60, 120 | heavy |
| shellcheck, hadolint, actionlint | 3 | 5 | |
| lychee | 5 | 60 | |
| npm audit | 5 | 15 | |
| Short static checks (Node, read files only) | 2 to 3 | 1 | tiny |

Not set here: npm test and Playwright/e2e checks come from `lib/discover.mjs` (found in the project's scripts); their estimates (60 to 300 s, 180 s) belong there. There is no gradle check yet.

### Scaling

A check may say `scale: 'files'` (eslint, tsc, prettier, madge) or `scale: 'crates'` (clippy, test, build, doc). The first-run estimate is multiplied by a bucket factor:

| Tracked files | Factor | Cargo workspace members | Factor |
|---|---|---|---|
| up to 50 | 0.4 | 1 | 0.5 |
| up to 300 | 1 | up to 5 | 1 |
| up to 1500 | 2 | up to 20 | 1.5 |
| more | 4 | more | 2.5 |

## Time limits

A check that is killed too early is a false failure, so the limit follows the estimate:

- tiny check (estimate 5 s or less): `max(estSeconds x 4, 60)` seconds
- normal check: `max(estSeconds x 5, 120)` seconds (at least 5 times the estimate, never under 120 s)
- compile, test or build check: `max(estSeconds x 8, 300)`
- discovered `found-*` check on the windows lane: `max(estSeconds x 4, 420)`
- all multiplied by the project-size factor above (never below 1), and never below the pack's own `timeoutSeconds`
- and by a machine-load factor from 1 to 2: 1 on a quiet PC, rising to 2 when the processors are saturated (load average, or the busy share of processor time on Windows) or memory is nearly gone (under 15% free, full effect at 5%). It is read each time a check starts, so a PC that becomes busy mid-run gives later checks more time
- the stuck guard is unchanged: a check that prints nothing for its idle limit (`found-*` checks: 180 s on the windows lane, 300 s elsewhere, or twice its estimate) is still stopped, however generous the limit; the hard cap of twice the limit for a check that is still printing is unchanged
- `--timeout-scale <n>` (1 to 10) multiplies every limit; `.meerkat-budgets.json` may hold `"timeoutScale": n` and `"timeouts": { "<check-id>": seconds }` (an exact limit for that check)
- a compile or test check that has printed anything in the last 30 s is not killed at the limit; it may run on to twice the limit
- a check stopped by its limit reads `timed out after N s (limit is M s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)` in the result line and in its log; the status stays FAIL

`meerkat check show <id>` prints the limit.
