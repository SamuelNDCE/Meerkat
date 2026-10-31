# Robustness checks (runtime)

Eight opt-in checks that RUN your project in ways most scanners never do: other time zones, other test orders, parallel tests, two builds of the same source, nasty function inputs, command-line edge cases, dependency removal and test speed history. They live in `thorough/robustness.mjs` (pack `packs/robustness`) and belong to the `test-hygiene` suite.

They execute project code (your tests, build, bin files and exported functions), so they are off by default. Turn them on with `--include runtime`, or run one by name: `meerkat check tz-locale-matrix`. Direct use: `node thorough/robustness.mjs <check> [--root <dir>]`; `--fixtures` runs the check on a tiny built-in project that must fail (exit 1) and is what `self-test` uses.

Exit codes follow the other checks: 0 clean, 1 findings, 75 NOT RUN (cannot run here, never a pass). Each check prints `MEERKAT-SUB` lines for every variant it tried, a plain-words explanation of every failure, and `MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>` lines.

## Safety model

- **Temp copy only.** Every check works in a copy of the git-tracked files (`makeCleanCopy` from `thorough/sandbox.mjs`). Files git does not track are not there, so a check can fail because you forgot to `git add` a file. That is a real problem (a fresh checkout would fail too) and the output says so.
- **Scrubbed environment.** `scrubbedEnv`: no tokens, keys, cloud credentials or proxy settings; HOME and temp folders point at a throwaway folder.
- **No shell, tree-kill on timeout.** Every program is started through `runIn` (no shell, hard timeout, the whole process tree is killed).
- **Cleanup.** Temp copies are removed on exit, on Ctrl+C and on SIGTERM.
- **Meerkat itself uses no network.** Your own scripts still run: if your tests or build call the network or write outside the folder, they do that here too. The copy contains your files only; `node_modules` is copied from your folder (offline, same versions, capped at 300 MB) or, when missing, your install command runs (a network failure is NOT RUN).
- **crash-fuzz adds more:** it only calls functions from modules that import no `fs`, `child_process`, network, `http`, `net`, `vm` or worker modules (checked through relative imports, three levels deep), never calls a function whose name looks destructive, runs each call in a child `node` process with the Node permission model on when available (`--permission --allow-fs-read=*`, which also blocks writes and spawning), a 256 MB heap cap, a 3 second limit per case and 30 seconds per file.
- The tests check that the original folder is byte-identical before and after.

## Budgets

In `.meerkat-budgets.json` under `"robustness"`; `MEERKAT_ROBUSTNESS_BUDGETS` (a JSON object) overrides single values for one run.

| Key | Default | Meaning |
|---|---|---|
| `tzCases` | 4 | time zones including the UTC baseline (max 5) |
| `localeCases` | 3 | locales including the C baseline (max 4) |
| `orderRuns` | 2 | re-runs in a different order |
| `parallelRuns` | 2 | parallel runs compared with one serial run |
| `fuzzCases` | 400 | total crash-fuzz calls |
| `seed` | 1 | crash-fuzz seed; printed on every run |
| `testSeconds` / `buildSeconds` / `installSeconds` | 600 / 600 / 600 | per command |
| `totalSeconds` | 1500 | stop starting new variants after this long |
| `depChecks` | 12 | dependencies tried by unused-dependency-proof |
| `regressionFactor` / `regressionMs` | 3 / 500 | slow-test-regression thresholds |
| `orderArgs`, `serialArgs`, `parallelArgs` | none | arguments for a test runner Meerkat does not know (see below) |

## The checks

### tz-locale-matrix
**Proves:** the tests do not depend on the machine's time zone or language. **How:** runs your test command first with `TZ=UTC LANG=C` (the baseline; if it fails or times out the check is NOT RUN), then with `America/Los_Angeles` (daylight saving), `Asia/Kolkata` (half-hour offset), `Pacific/Kiritimati` (UTC+14), `Pacific/Pago_Pago` (UTC-11), and the locales `tr_TR.UTF-8` (the Turkish i), `de_DE.UTF-8`, `en_US.UTF-8`. The subset is deterministic, in that order, cut by `tzCases` and `localeCases`. Reports each variant that fails while the baseline passes, with the last 3 lines. **Limit:** on Windows, Node ignores `LANG` and `LC_ALL`, so locale variants prove little there; time zones do work.

### test-order-independence
**Proves:** tests do not secretly depend on running after each other. **How:** re-runs the tests in another order using the runner's own switch: vitest `--sequence.shuffle --sequence.seed=<n>`, jest `--randomize --seed=<n>` (29.2+; older versions are skipped), go `-shuffle=<n>`, pytest with the collected ids in reverse. A variant that fails while the normal order passes is the finding. **Not available:** mocha and cargo have no native shuffle (NA). For another runner, name the flags yourself: `"orderArgs": ["--reverse", "--shuffle=<seed>"]` (one variant per entry, `<seed>` is replaced). **Limit:** files a test leaves behind stay in the copy for the next variant.

### parallel-safety
**Proves:** tests give the same result one at a time and together. **How:** vitest `--pool=threads --no-file-parallelism` versus default, jest `-i` versus `-w <cpus>`, go `-p 1` versus `-p <cpus>`, cargo `--test-threads=1` versus `<cpus>`; or your `serialArgs` and `parallelArgs`. One serial run, `parallelRuns` parallel runs. Fails when one mode passes and the other fails. If both fail the tests are broken and the check is NOT RUN. **Limit:** a race that needs luck can pass; more `parallelRuns` helps.

### reproducible-build
**Proves:** the same source gives the same files. **How:** two separate clean copies, your build command in each, then every file the build created or changed (so `dist`, `build`, `out`, `target/release` and anything else are found without a list) is compared byte by byte. Known-volatile files are ignored and listed: `.tsbuildinfo`, and source maps that differ only in the absolute build folder. Other differences are explained: embedded timestamp, absolute path, random id or hash, other content. NOT RUN when there is no build command, the build fails, or it needs the network. **Limit:** `node_modules`, `.git` and caches are not compared.

### crash-fuzz
**Proves:** exported functions survive hostile input. **How:** finds exported plain functions with 1 to 3 parameters in `.js/.mjs/.cjs` (and `.ts` on Node that strips types, and `.py`) outside test folders, skipping destructive names (delete, remove, drop, kill, write, save, send, exec, spawn, unlink, fetch, request, connect, listen, install, publish, login, `rm`, `pay...`) and modules with risky imports. Each function gets a fixed corpus: null, undefined, NaN, Infinity, -0, empty string, a 1 MB string, lone surrogates and RTL marks and NUL, 20-deep and 10000-deep nesting, a circular object, 100000 numbers, BigInt, Symbol, function, `Date(NaN)`, typed array, a throwing Proxy, `__proto__` keys, a 400-digit string, negative and fractional numbers, frozen inputs and seeded random values. Classes: **ok**, **threw-expected** (not a finding), **hang** (high), **crash** (process died, medium), **stack-overflow** (medium; low for the nested or circular inputs), **corruption** (`Object/Array/Function/String.prototype` changed: high; throwing on a frozen input: medium, a deliberate choice because sorting an argument in place is common). Rule ids: `fuzz-hang`, `fuzz-crash`, `fuzz-stack-overflow`, `fuzz-prototype-pollution`, `fuzz-mutates-input`. The seed and every skipped function are printed. **Limits:** most real code imports `fs` or `child_process` somewhere in its import chain and is skipped on purpose (Meerkat's own `lib` is mostly skipped); TypeScript needs a Node that strips types; Python covers top-level `def`s only and checks hang, crash and recursion, not pollution.

### idempotent-cli
**Proves:** the declared command-line tools behave. **How:** for each `bin` entry (only those files, run with `node`): `--help` twice and `--version` twice must match; an unknown flag must not print a stack trace (exit 0 is a low finding); with stdin closed and no arguments it must exit in 5 seconds (skipped for things that look like servers); `--help` with the output pipe closed must not print EPIPE or a stack trace (a small wrapper script closes the pipe, still under `runIn`'s timeout and tree-kill). NOT RUN when no `bin` is declared.

### unused-dependency-proof
**Proves:** a production dependency is not needed. **How:** for dependencies that no source file imports (and that are not tooling, not named in a script), the dependency is removed from `package.json` and from the copy's `node_modules` (your real folder is never touched), then the tests and build run; if they still pass: `dependency '<name>' appears unused (tests and build pass without it)`. At most `depChecks` (12), alphabetical. **Static fallback:** without `node_modules` (or over 300 MB, or no test command) only the cheap check runs and says so: reported only if the name appears in no tracked file other than `package.json` and the lockfile. **Limit:** passing tests prove only what the tests cover; a package loaded by name at runtime, or only in production, can be flagged wrongly.

### slow-test-regression
**Proves:** nothing quietly got much slower. **How:** runs the tests with the runner's duration output (vitest `--reporter=json`, jest `--json`, pytest `--durations=0`, `go test -json`; any runner that prints lines `MEERKAT-TEST-TIME <ms> <name>`), prints the 5 slowest tests every run, and stores the timings (atomic write, last 5 runs, slowest 2000 tests each) in `~/.meerkat/test-times/<project>-<hash>.json`, or `<MEERKAT_LOG_DIR>/test-times/`. A test that is over `regressionMs` (500) and more than `regressionFactor` (3) times the median of its earlier timings is reported at severity low. The first run only records. NOT RUN when the tests fail or the runner gives no per-test times. **Limit:** timings depend on the machine; compare runs from the same one.

## Honest limits

- Clean copies contain tracked files only. In a repository with new files not yet added, most of these checks will correctly report NOT RUN or a failure caused by the missing files.
- Findings are evidence, not proof: a fuzz hang is a real hang on that input, but whether that input can reach the function in production is your call.
- Frameworks other than those named need `orderArgs`, `serialArgs`, `parallelArgs` or the `MEERKAT-TEST-TIME` line.
