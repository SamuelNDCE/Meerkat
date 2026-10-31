# Tiers, estimates and time limits

Written 2026-10-31 from the saved run folders in `~/.meerkat/logs/runs` (61 runs, mostly on Meerkat and Plume, plus one on NeuralVault) and fresh runs.

## The rule

A check is **quick** (`tier: 'fast'`) when it is cheap everywhere it has been measured. A check is **thorough** when it is slow, needs the network or a window, or is opt-in.

| Rule | Quick | Thorough |
|---|---|---|
| Measured median under 3 s and max under 6 s everywhere measured, Node only, no window, no network, not opt-in, not heavy | yes | |
| Compiles, builds or runs a test suite (cargo clippy/test/doc/build, tsc, npm test, dotnet, mvn, gradle, go test) | stays where it is, never moved INTO quick | |
| Heavy, alone, non-free lane or opt-in | | yes |
| Quick check whose median goes over 8 s | | move it here |

Compile and test checks that are already in quick are kept there on purpose (the quick preset is "before every push": build, type check, tests). They are listed with a reason in `tests/tiers.test.ts`, which fails when a new compile check is added to quick without one.

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

Nothing in quick had a median over 8 s except the Rust compile checks, which stay (see above). The learned times for clippy and test on NeuralVault were 113 s and 601 s for one cold run.

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

- normal check: `max(estSeconds x 4, 60)` seconds
- compile, test or build check: `estSeconds x 6`
- both multiplied by the project-size factor above (never below 1), and never below the pack's own `timeoutSeconds`
- `--timeout-scale <n>` (1 to 10) multiplies every limit; `.meerkat-budgets.json` may hold `"timeoutScale": n` and `"timeouts": { "<check-id>": seconds }` (an exact limit for that check)
- a compile or test check that has printed anything in the last 30 s is not killed at the limit; it may run on to twice the limit
- a check stopped by its limit reads `timed out after N s (limit is M s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)` in the result line and in its log; the status stays FAIL

`meerkat check show <id>` prints the limit.
