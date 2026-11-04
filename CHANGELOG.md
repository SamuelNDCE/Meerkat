# Changelog

Every released version of Meerkat, newest first. Versions follow semantic versioning: a patch fixes, a minor adds, a major changes how you use it.

## 0.4.1 (2026-11-04)

- Updates: U works from the project picker, updates survive a folder on another branch, a spinner while checking. New smoke preset and --scope to check one folder. Accuracy corpus is opt-in.

## Unreleased

- smoke: a new preset, `meerkat smoke`, that answers "does my change break anything": the build, the type check, the lints and the quick tests, for any project. It is the same checks as `functionality-fast` under a clearer name; use it after changing code, with `--changed` or `--scope` to narrow it
- scope: `--scope <folder>` works with any preset (repeatable, or comma separated). It runs only the checks that read files in that folder and keeps only the findings inside it. A failing check whose findings are all outside the folder passes for that run. Repo-wide checks (git history, commit messages, dependency counts) still run and are not limited by it. `--changed` and `--scope` cannot be combined
- scope: the verdict of a check is taken from its findings inside the scope, read from the structured findings or the file paths in its saved output, so the scoped verdict and the findings file agree
- tests: unit tests for the scope helpers (tests/scope.test.ts) and for the regex escaping (tests/project-ctx.test.ts)
- docs: README and the reference name `smoke` and `--scope`; CONTRIBUTING gains a "Check your change" section; developers.md explains how a check should respect a scope
- scope: `--scope <folder>` (repeatable, or comma separated) runs only the checks that read that folder, and keeps only the findings inside it; a failing check whose every finding is outside the scope passes for that scope. A repo-wide check (git history, commit messages, dependency counts) still runs and is not limited by the scope
- fix: the path-traversal check crashed on a parameter name with a `(`, and the crash was reported as a FAIL (found on NeuralVault); the name is now escaped
- updates: `U` now starts the update from the project picker too (only while no filter text is typed, so letters still filter); the menu hint says so
- updates: a Meerkat folder that is on a branch with commits GitHub does not have no longer shows the misleading "has changes of its own" error. Those commits stay on their branch, the folder moves onto the default branch, and the result says which branch was left. A detached HEAD with its own commits is still refused, and so is a local default branch with commits of its own
- updates: a spinner shows while the menu checks GitHub (it no longer looks frozen), and a line says the update is being installed
- docs: docs/developers.md for people changing Meerkat: folder map, generated files to regenerate, and what an update does and never touches
- tests: the slow accuracy corpus no longer runs in a normal `npm test` (it timed out there). Run it with `npm run test:accuracy`; CI still runs it on every change
- tests: the compatibility matrix gets 150 seconds locally (it was 55, too tight on a busy machine), and its temp folder is cleaned up with retries on Windows
- tests: the version test names its recorded exceptions (dated accuracy records, a fixture), and fails if one of them stops naming a version
- updates: after a folder moves off its branch, the result prints the exact command to push that branch
- docs: README has a one-line try-it under the tagline, separate clone and `cd` steps, a version check after install, and macOS/Linux path examples; CONTRIBUTING runs `npm test` and the self-check with `node run.mjs`, and sends changelog entries to `## Unreleased`; developers.md states the Node requirement and spells the update key `u`

## 0.4.0 (2026-11-03)

- Accuracy, measured on the final corpus: 1540 planted defects; 1533 detected by a check (99.5%) and 1532 found in the findings file (99.5%). By impact: critical 484 of 484, high 465 of 466, medium 349 of 352, low 235 of 238. By difficulty to find: easy 1021 of 1021, medium 323 of 324, hard 118 of 120, extreme 71 of 75. Seven planted defects are known gaps, listed in docs/accuracy.md. Clean and trap twins: that run reported 601 false alarms across 166 twins, **before** the test-quality fix and the later guard changes listed below; the final false-alarm rate was not re-measured, because the corpus was not re-run for this release. Recall on planted bugs measures what was planted, not real-world accuracy.
- The accuracy corpus grew: 45 low-impact planted defects, hundreds of false-alarm trap projects (clean code that looks like a bug to a naive rule) with a verifier (`tools/trap-lang-verify.mjs`), clean twins that carry their own tests, and clean-twin false alarms recorded in the run and in docs/accuracy-results.md.
- Two labels on every planted defect: impact (critical, high, medium, low) and difficulty to find (easy, medium, hard, extreme), read from tools/accuracy-tier-fragments and printed by the corpus run; the older single tier (critical, hard, medium, easy) is kept for the results table. See docs/tiers.md.
- Documentation sweep: every document checked against the code; stale counts, preset contents and measured times corrected or marked with their date; the README pictures regenerated from the current code.

- The quick preset (and fast) no longer runs compile-heavy checks: cargo clippy and test, go test, mvn compile and test, dotnet build, swift build, pytest, rspec, a project's build and test scripts, and any check that waits on a build. On a large Rust/Tauri app quick took 10 to 16 minutes and barely differed from full; it now states a 5 to 10 minute budget. `full`, `thorough`, `release` and the functionality presets keep every one of them. A new preset field `skipCompile`, the named list `COMPILE_HEAVY_IDS` and `COMPILE_HEAVY_COMMAND`, and a test that fails if quick selects a compile-heavy check.

- Quick keeps the JavaScript unit-test runners that run no compiler or build (`npx vitest run`, `npx jest`; for example unit-tests-changed). `npm test` stays out of quick, because that script may build first. The window checks (click-through, ui-screens) stay out too.
- Fourteen rules whose only signal is the shape of the code are reported as info, not as bugs: py-bind-all-interfaces, py-jinja-autoescape-off, py-shelve-open, js-template-no-escape, js-helmet-csp-off, rb-csrf-skipped, rb-weak-digest, go-weak-crypto-import, go-md4-md5-sha1, go-math-rand-import, java-weak-digest, cs-weak-hash, cs-cookie-insecure and cs-antiforgery-ignored. They are still found and listed in the report (the detection is unchanged); see `RULE_SEVERITY` in `lib/findings.mjs`.

- Fewer false alarms found by a full scan of a desktop app: electron-devtools-prod reports a DevTools toggle inside a user-invoked handler (an ipc handler, a key handler, a menu click) as info, and a forced openDevTools() still fails; install-scripts reports the install script of a development-only lockfile package (dev: true) as info, and a runtime dependency still fails; risky-code accepts innerHTML = fn(...) when fn is a local builder whose template holds only lookups in a table of plain strings; js-unhandled-promise accepts a call to an async function whose every await sits inside a try with a catch that does not rethrow, and a .then on a promise that was built with .catch. Every planted defect is still found.
- Fewer false alarms from the repository and configuration checks: sensitive-files and env-files-in-history ignore an environment file that holds only placeholders (${VAR}), empty values or plain settings, and a key file that holds only comments; ui-static accepts rel="noreferrer" as well as noopener and no longer asks a desktop app window for a viewport tag; the crate-root docs lint (rapi-missing-docs-lint) is asked of src/lib.rs only and is info; the compose read-only and no-new-privileges hints are info; debug-leftovers is low and tsconfig-strict is info. The clean twins of the accuracy corpus now keep their lockfile in step with package.json, resolve every import and carry the lang attribute their planted page lacks.
- Fewer false alarms on safe code in the web-security family: risky-code (a method named eval on another object, new Function and os.system with fixed text, a text constant passed to insertAdjacentHTML, DOMPurify around dangerouslySetInnerHTML, verify=False on a call that is not an HTTP request, yaml CSafeLoader, pickle after an HMAC check, host.docker.internal and the sitemap namespace, key: Math.random() as a list key), sql-concat (text constants and tables of text in a template, tagged templates, placeholder lists, Date.now(), help sentences that start with Select), cookie-flags (options held in a constant), hardcoded-ip (public DNS resolvers), local-storage-pii (setting keys such as passwordHintShown), open-redirect-pattern and path-traversal-pattern (route and file tables, path-only and strict-id patterns, the page's own pathname), regex-dos ((ab|a)+), weak-crypto-modes (a comment about passwords above an MD5 checksum), js-unhandled-promise (ipcMain.handle, a synchronous method with the same name) and gha-contents-write (a tag-gated job that runs gh release create). NODE_ENV=development in docker-compose.override.yml is now info. Every planted defect is still found.

- Two header and workflow rules now see layouts they missed: nginx settings (autoindex on, server_tokens not off, the other nginx rules) in any .conf inside a folder named nginx, and the pull_request_target trigger written inline (on: { pull_request_target: ... }). The accuracy corpus names the real rule ids for the HttpOnly, X-Powered-By and source-map defects, and its nginx clean twin is now properly hardened.

- Six more split-across-files shapes are caught: a recursive merge written as for (const key of Object.keys(...)) (and a guard written as a string no longer hides itself), an async helper called without await or catch, a helper that returns err.stack or err.message and a response that sends it, an options dict with verify False unpacked with ** into requests calls, requests.Session() calls with no timeout, and a blocking fs call in a helper that a handler calls.

- Text checks now follow a value or helper across files: a CORS, JWT algorithm, cipher, key or regex constant defined in one file and used in another, a file path or redirect target passed to a helper by its caller, SQL text grown with +=, and a safe-looking guard that is only imported no longer hides a path traversal. Also new: Caddyfile headers, app.enable x-powered-by, httpOnly false, helmet protections off, multi-line iframes without sandbox, source maps in a published folder, strict-ssl off, open-ended and x-range dependency versions, positive tabindex in single quotes, http scripts on any page, and ignored os.Rename style errors in Go.

- Four Rust tool checks in the detectors pack: cargo-geiger (unsafe usage), cargo-semver-checks (library API breaks, libraries only), and the opt-in nightly ones cargo-udeps (unused dependencies) and cargo-miri (undefined behaviour), `--include rust-nightly`. Findings of the same family collapse into one (unused-dependency, api-break, undefined-behavior classes).

- accuracy corpus recall 97.4% at that point (was 95.0%; the final 0.4.0 figure is in the first bullet of this section): the web, CI and infrastructure, and code and config gaps are closed; the accuracy thresholds were raised to match; the update-feed check exempts only timestamp servers by host, not any line that says timestamp
- Detection gaps closed in web security and packages: Caddy CSP unsafe-inline, helmet with HSTS or CSP off, session cookie with httpOnly false, app.enable('x-powered-by'), multi-line iframes without sandbox, shipped .map files, strict-ssl off, open >= and x-ranges, plain-http scripts and single-quoted positive tabindex.

## 0.3.15 (2026-11-02)

- Fewer false alarms and a much faster scan: noisy rule families rolled up or off by default, a detectors preset with cross-tool confirmation, a ground-truth benchmark, window checks left out of full
- cross-tool confirmation fixes: findings join a group only when they match every member, never chain through a third finding, two different secrets on neighbouring lines and file-level findings with no line are no longer merged; the accuracy corpus counts every reporter of a merged finding
- the whole Rust style family (documentation, error style, performance and async hints) is off by default, whatever its severity: an audit of 36 sampled medium findings judged 1 useful, 16 false and 18 noise; MEERKAT_FINDINGS=all turns it back on
- the pedantic Rust style rules (undocumented items, string errors, println in libraries, ...) are no longer evaluated by default, so they cost no time and add no raw detections; MEERKAT_FINDINGS=all turns them back on
- faster full scans: the window checks found in a project (Electron, Playwright, click-through) no longer run in full and thorough and are listed as skipped, not failed; release, `--include windows` or MEERKAT_WINDOWS=1 run them. Eighteen quality, performance and hygiene rules that audits judged mostly false (empty-catch, line-length, regex-in-loop and others) are hidden by default and shown again with MEERKAT_FINDINGS=all
- fewer false alarms in the security and Electron/Rust rules (NeuralVault audits): window.open is fine when the app denies all windows; constant or escaped executeJavaScript/loadURL arguments, allowlisted IPC channels and non-handler `return true` are not reported; Rust secret-log, env::set_var, Vec::set_len and unwrap rules ignore test code, message words and File::set_len; Docker USER is judged on the final stage; changelog prose, comments, timestamp URLs, Electron shells and boolean-guarded merges are not reported
- a new opt-in detectors pack and `--preset detectors` run mature tools when installed and keep their own rule ids: osv-scanner (advisories with the fixed version), Semgrep security-audit, cargo clippy correctness and suspicious lints, and tsc --strict (capped at 200 with a rollup); a missing tool is NOT RUN with an install hint (issue 72); also gitleaks, staticcheck, govulncheck and actionlint checks; Semgrep runs with metrics off, MEERKAT_DETECTORS_OFFLINE=1 and MEERKAT_SEMGREP_CONFIG limit network use; see docs/credits.md
- a ground-truth benchmark on real code: `node tools/benchmark.mjs nodegoat` scans OWASP NodeGoat (pinned commit, expected vulnerabilities stored in benchmarks/nodegoat.json) and prints recall, the missed vulnerabilities and the findings that match none; first numbers in docs/accuracy.md
- detection gaps closed: `cp-js` reports `require` of a template literal with an interpolation or of a string joined to a variable, `cp-dotnet-php-ruby` reports `System.Random` for a camelCase `resetToken`, `toml-valid` reports an array left open at the end of the file, `csv-consistent` reads semicolon-separated files, `spell-common-typos` reads plain `.txt` prose, `notebook-secrets` knows npm tokens and `notebook-absolute-paths` sees doubled backslashes; Makefiles under `build/` and a changelog without dates stay unflagged on purpose
- CI and infrastructure gaps closed: SSH open to ::/0 (IPv6) in Terraform, quoted `permissions: "write-all"`, a pull_request_target checkout of refs/pull/N/merge, GitLab files named `*.gitlab-ci.yml` (docker-in-docker with TLS off), CircleCI executor images on the latest tag, and a Jenkinsfile sh step piping curl into a shell
- the code-pattern checks of the security-plus pack (cookie flags, JWT, SQL, CORS, XML, weak crypto, regex, redirects, paths) skip lines that are only string literals and punctuation, such as a detector table of sample vulnerable code; the credentials-in-URL check does not, because there the string is the problem
- PII in a Rust test module is not reported; meta-seo leaves mockups, prototypes and generated code maps alone
- documentation and markup hygiene findings (links, final newline, code fence language, headings, whitespace, HTML structure, SEO tags) and two Rust style rules are low, not medium
- fewer false alarms: "no .dockerignore beside the Dockerfile" now also accepts the .dockerignore of the real build context (a compose `context:` such as `../..`, or a Dockerfile that says it is built from the workspace/project root)
- js-timing-unsafe-compare no longer flags a confirm field next to a password (password !== confirm) or a bare "signature" kept as UI state (seenSignature !== signature); real secret, token, HMAC and webhook compares are still reported (found on NeuralVault)
- AI prompt: a new section lists every check with its time, status, findings and sub-check counts, slowest first
- fewer false alarms: a Tauri path check only fires on a command's own parameter outside tests, contextIsolation left out is fine (Electron 12+ default), user:password@host is not an email, and generated notice files and git@ links are not broken links
- a first scan lists far less: size and complexity measures (line length, long functions, complexity, nesting, parameters) roll up to one finding per rule and file, and pedantic Rust style and markup nitpicks are counted in the run (hidden) instead of listed. MEERKAT_FINDINGS=all lists everything again; security rules are never hidden
- the everyday presets (quick, fast, full, thorough, release) no longer run the code-shape measures (the refactor group: line length, function size, complexity, nesting, duplicated and dead code); run `--preset refactor` for them
- round 5a false alarms (NeuralVault audit): js-await-in-loop skips polling, retry, sleep, early-exit and dependent while loops; js-unhandled-promise accepts a .catch nested in the then callback (and long callbacks); json-parse-in-loop leaves test files out and names a real line; empty-catch ignores catch {} written inside comments and accepts a same-line or preceding best-effort comment; debug-leftovers treats probe folders and programs that call process.exit as CLIs
- round 5b false alarms (audit of a real scan): pii-in-logs reads only interpolated values (template and Rust raw-string text is skipped, a UI "card" is not a payment card, a name passed into a sanitise/redact call is not a leak, Rust test modules are skipped); ui-static, table-headers and render-blocking skip test files and mockup/prototype folders; duplicate-test-names compares titles per describe scope; broken-imports ignores imports named in comments or quoted in strings
- false alarms from the NeuralVault audit (round 5c): the security pattern rules (cors-wildcard, cookie-flags, sql-concat, jwt-weak, regex-dos, xxe-and-deserialize, open-redirect-pattern, path-traversal-pattern, weak-crypto-modes) no longer report insecure sample text held as Rust string literals in files named insecure_code*, vulnerable_samples* or bad_examples* (code outside a string there still reports); sql-destructive-migrations ignores DROPs inside block comments and undo_/down migrations that raise unless a confirm setting is present; ep-fuses-not-configured, ep-builder-product-name-missing and ep-builder-copyright-missing only apply to a package.json that names electron, electron-builder or Electron Forge, not a VS Code extension or Tauri package
- a guide to how a run is scheduled and tuned: docs/scheduling.md
- gentle by default, review fixes: CI=false or CI=0 is not a CI runner, the priority name is not case sensitive, an unknown --priority value is an error, and the time-left estimates use the same default parallelism as the run
- gentle by default: Meerkat lowers its own priority to below normal (checks inherit it), runs about half as many checks at once as there are cores (2 to 8; all but one on CI), and accepts --priority normal|idle and MEERKAT_PARALLEL. Meerkat's own tests do the same and put every temp project under one folder, meerkat-tests-<your user name>, in the temp folder (private to you), so one antivirus exclusion covers them
- scheduling: while the longest waiting check is held for room, short checks that fit now run beside the running one (backfilling) instead of all waiting behind it. On the first full NeuralVault run 97 percent of the 26 minutes had exactly one check running while 300 or more checks waited
- review fixes: the plain-http exemption looks at the URL itself (its host, or being the direct argument of a prefix helper), not the whole line; probe folders are test code only under scripts, tools, supabase, qa or e2e; serde_json unwrap and spawn_blocking findings keep their medium severity
- risky-code ignores comments, strings in Rust and Python files, Rust unit-test modules, test and fixture files, XML namespace names and URL-prefix trims; an MD5 with no secret or signature nearby is an info note and does not fail the check (NeuralVault: 39 high findings down to 0)
- the JavaScript await-in-loop, var, == and unhandled-promise checks, the PII check and the size and complexity checks leave test and probe files alone; the SQL-concat check leaves probe scripts alone
- Rust documentation and error-style rules (undocumented pub items, String errors, discarded results, spawn handles) are low, not medium
- meerkat doctor and the NeuralVault click-shards script start again: lib/paths.mjs now exports importFromApp (0.3.13 and 0.3.14 died with "does not provide an export named importFromApp")

## 0.3.14 (2026-11-01)

- fewer false alarms: a hit the surrounding code already makes safe is skipped (a QA-only executeJavaScript, a path checked by need() before it reaches the shell, a require helper called only with fixed strings, markup from a constant table)
- meerkat tools install works on Windows (it found the bare npm script instead of npm.cmd)
- the CI job is allowed 30 minutes
- installing the outside tools no longer changes a clean project's result: markdownlint uses lenient style rules when the project has no markdownlint config, and eslint, prettier and stylelint are NOT RUN when the project has not configured them (thorough/config-guard.mjs)
- a tool that cannot reach its service (cargo audit's advisory database, the npm registry) is NOT RUN instead of a failed check (thorough/offline-guard.mjs)
- the results screen names every check that did not run (skipped, covered by a wider check, turned off) instead of leaving its description empty
- ep-ipc-handler-no-sender-check no longer flags handlers whose sender is checked through a helper in the same file, or registered through an ipcMain parameter that every caller fills with a wrapper that checks the sender (found scanning Plume)
- secret checks leave test code alone: Rust unit tests after #[cfg(test)], *_tests.rs, probe folders, values that say they are fake (FAKE_TOKEN, SUPERSECRET, the AWS documentation keys), and a private key header in a comment with no key under it. On NeuralVault this removed all 25 critical findings, every one of them a test fixture
- the rule-table checks (Electron, Rust, secrets and the rest) leave test files, tests.rs and probe-* scripts alone
- Rust unit tests are found by matching the braces of the #[cfg(test)] module, so code after it is scanned again
- the secret scan looks eight lines below a key header (armor headers, blank lines, comment prefixes) before calling it a mention, so an encrypted or commented-out key is still reported
- innerHTML set from a local helper's parameter is not reported when every call of the helper passes a literal or an ALL_CAPS constant (found on Plume's find bar)
- Rust test code is found by the exact #[cfg(test)] module in the Rust rule tables too, and env::set_var in tests is no longer reported
- test_support and probe-* scripts are left alone by the Electron context-isolation and secrets-plus checks
- markdownlint no longer reads node_modules, .claude (agent worktrees), vendor, dist, build or target folders at any depth (on Plume this removed 498 findings from dependency documents)
- a first scan does not fail on Meerkat's own default limits: line-length, long-functions, deep-nesting, many-parameters, cyclomatic-complexity, file-length, duplicate-code, dead-code, commented-out-code, ts-any-overuse and http-timeouts pass as advisory notes (findings become info) until the project has a .meerkat-budgets.json
- a guide for adding a click-through test for your own app: docs/click-through.md
- markdownlint skips the folders named fixtures, where documents are broken on purpose


## 0.3.13 (2026-11-01)

- The package is on npm: npm install -g @samuelndce/meerkat
- releases publish to npm through trusted publishing (no stored token)

## 0.3.12 (2026-11-01)

- Findings Meerkat itself calls notes (low, info, low confidence, probably a false alarm) are no longer counted as bugs
- presence-style rules are rated low or medium instead of high
- innerHTML through a sanitiser is trusted
- the same fact is reported once
- the longest check starts first and small checks run beside it instead of waiting
- the badge says made with Perpetual Technologies

## 0.3.11 (2026-11-01)

- Hot fix: the key hints at the bottom of the results screen now always fit and keep quit and help
- finding places keep their line numbers
- the prompt file is named with the run's date and preset
- the package is ready to install with npm

## 0.3.1 (2026-11-01)

- README pictures: the running GIF is bigger with no empty block below it
- the results GIF scrolls slower, one row at a time
- GIF frames are trimmed of empty space

## 0.3.0 (2026-11-01)

- every update shows the yellow update line, including a fix published without a new version number
- AI prompt: press p on the results screen (or run meerkat prompt) for a file that hands every finding in full to an AI
- optional AI verification of findings (meerkat verify --ai-verify), fail-closed
- findings, logs and the prompt keep full text (no 200 character cut); every run saves run.log
- the live board shows the full scanned folder; settings files moved into .meerkat/
- Longest checks start first and timeouts have more leeway
- the live board never flickers and shows every group with its time in ALL CHECKS
- fewer checks end NOT RUN (meerkat tools, built-in fallbacks)
- projects are checked before a run
- fake-app end-to-end tests
- estimate shown against actual time
- CI green on Windows, macOS and Linux
- false positives fixed on real projects

## 0.2.0 (2026-11-01)

- Stuck-test guard: idle kill, skip keys, run deadline
- found project tests run as checks
- quick runs every short check
- findings files with severity
- happy results screen and scrollable timeline
- version and update line on every screen
- fewer false positives on real projects
- Meerkat now runs clean on itself

