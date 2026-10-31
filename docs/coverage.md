# Coverage: what Meerkat scans, and what it misses

This page answers one question: **what can it scan, and what does it not catch?**

The numbers in the two big tables are made by a script (`node tools/gen-coverage.mjs`), so they match the code. The rest is written by hand from the repository, and says where a claim is unmeasured.

In short: Meerkat reads files as text and applies rules. It is a fast first line of defence. It is not a replacement for a full code scanner (see section 4).

## 1. What Meerkat scans

<!-- coverage:start -->
Counted from all 47 packs under `packs/`: **360 checks** in **47 suites** with **1402 rules** (sub-checks).

Run by default: 327 quick checks and 15 full-only checks. Opt-in: 18 (`--include ai`, `--include runtime`, `--include mutation`, `--include deny`).

Checks that need an outside tool (NOT RUN without it): 44 of 360. The other 316 need only Node.

Legend. **Checks**: scripts or tool runs. **Rules**: separate pass/fail results inside them. **Runs by default**: quick = in `meerkat verify`; full = only in `meerkat full`; both = a mix; opt-in = only when you ask. **Tool**: yes means at least one check in the suite is NOT RUN without that outside tool; the others still work.

| Suite | What it looks at | Checks | Rules | Runs by default | Needs an outside tool? |
|---|---|---|---|---|---|
| `secrets` | Any text file git tracks; private key and credential files | 4 | 285 | quick | no |
| `risky-calls` | JS/TS, Python, Go, Rust, Java and more (code), plus tracked text files | 7 | 92 | quick | no |
| `injection-patterns` | JS/TS, Python, Java, C#, PHP, Ruby source | 7 | 69 | quick | no |
| `crypto-and-auth` | Source files (JWT and cipher settings) | 2 | 2 | quick | no |
| `supply-chain` | package.json, lockfiles, requirements, .npmrc | 8 | 23 | both | yes: npm |
| `ci-workflows` | GitHub Actions workflow files | 3 | 36 | quick | no |
| `web-security` | HTML, JSX/TSX, Vue, Svelte, server and host config, JS (cookies, CORS, headers, privacy) | 20 | 76 | quick | no |
| `accessibility` | HTML, JSX/TSX, Vue, Svelte, CSS | 10 | 10 | quick | no |
| `html-and-css` | HTML, CSS, web manifests, templates | 10 | 35 | quick | yes: htmlhint, stylelint |
| `seo-and-meta` | HTML pages, robots.txt, sitemap | 2 | 2 | quick | no |
| `code-quality` | Source and text files (whitespace, leftovers, imports) | 10 | 10 | quick | no |
| `test-hygiene` | Test files; opt-in: runs your project | 21 | 88 | quick + opt-in | no |
| `refactor` | Source files (JS/TS first) | 9 | 9 | both | no |
| `javascript` | JS and TS source | 7 | 7 | quick | no |
| `slow-code-patterns` | JS and TS source | 4 | 4 | quick | no |
| `repo-docs` | README, SECURITY, CONTRIBUTING, CODEOWNERS, CHANGELOG | 5 | 5 | quick | no |
| `repo-files` | File names, sizes, modes, .gitignore, .editorconfig | 12 | 12 | quick | no |
| `licensing` | LICENSE, NOTICE, package licences | 5 | 5 | quick | no |
| `config-files` | JSON, YAML, TOML, .env.example, Makefile, game-engine and CMS projects | 22 | 22 | quick | yes: yamllint |
| `ci-config` | CI files (GitLab, CircleCI, Azure, Jenkins, GitHub), Helm, Ansible, pre-commit | 18 | 18 | quick | yes: actionlint |
| `content-and-docs` | Markdown, links, changelog, typos | 11 | 11 | quick | yes: lychee, markdownlint-cli2, typos |
| `i18n` | Translation JSON files | 2 | 2 | quick | no |
| `data-files` | JSON, CSV, Jupyter notebooks, model and data files | 15 | 15 | quick | no |
| `api-contracts` | OpenAPI and GraphQL files | 4 | 4 | quick | no |
| `database` | SQL migrations, Prisma schema | 4 | 4 | quick | no |
| `api-resilience` | Server code (timeouts, limits, errors, paging) | 4 | 4 | quick | no |
| `desktop-apps` | Electron, Tauri, Capacitor, Cordova, Android manifest | 19 | 176 | quick | no |
| `git-history` | Git commit history (needs a git repository) | 8 | 8 | both | no |
| `git-workflow` | Branches, tags, submodules (needs a git repository) | 3 | 3 | quick | no |
| `release-versioning` | Versions, tags, package publish files (npm, PyPI, crates) | 15 | 15 | quick | no |
| `dependencies` | Manifests and lockfiles; opt-in: clean install | 15 | 15 | quick + opt-in | no |
| `performance` | Images, assets, and budgets you set (.meerkat-budgets.json) | 11 | 11 | both | no |
| `node` | JS/TS projects (package.json, tsconfig) | 9 | 9 | both | yes: eslint, madge, prettier, tsc |
| `rust` | Rust crates (Cargo.toml) | 16 | 156 | both + opt-in | yes: cargo, cargo-audit, cargo-deny |
| `python` | Python projects | 8 | 8 | both | yes: bandit, mypy, pytest, ruff, vulture |
| `go` | Go modules | 4 | 4 | quick | yes: go |
| `java` | Maven projects (pom.xml) | 3 | 3 | quick | yes: mvn |
| `dotnet` | .NET projects (sln, csproj) | 2 | 2 | quick | yes: dotnet |
| `php` | PHP projects (composer.json) | 2 | 2 | quick | yes: composer, phpstan |
| `ruby` | Ruby projects | 2 | 2 | quick | yes: rspec, rubocop |
| `swift` | Swift packages | 2 | 2 | quick | yes: swift, swiftlint |
| `dart` | Dart and Flutter projects | 2 | 2 | quick | yes: dart |
| `terraform` | Terraform files (.tf); its check also holds the Compose rules | 2 | 38 | quick | yes: terraform |
| `kubernetes` | Helm charts and Kubernetes YAML | 3 | 52 | quick | yes: helm, kube-linter |
| `docker` | Dockerfiles and Compose files | 4 | 40 | quick | yes: hadolint |
| `shell-scripts` | Shell scripts (.sh) | 2 | 2 | quick | yes: shellcheck |
| `ai-review` | Routes and the git diff, read by an AI model | 2 | 2 | opt-in | no |
<!-- coverage:end -->

Some suites need budgets or a git repository first. Without them the check is NOT RUN, never a pass (see section 6). Packs that wrap outside tools (node, python, go, java, dotnet, php, ruby, swift, dart, web, docs, infra, terraform, kubernetes) are on only when `meerkat.config.json` lists them; `meerkat init` suggests the ones that fit.

## 2. By language and file type

<!-- coverage-lang:start -->
Legend. **DEEP**: 20 or more rules of Meerkat's own, and the rules were run against a 13-repository corpus of real projects. **BASIC**: some rules, mostly proved on small sample files only. **NONE**: no rules of Meerkat's own (an outside tool may still be run, see Tools). **Rules** counts only Meerkat's own rules; checks that wrap an outside tool are named under Tools and not counted.

| Area | Level | Own rules | Tools it can run | Note |
|---|---|---|---|---|
| JavaScript, TypeScript | DEEP | 31 | - |  |
| Python | BASIC | 33 | - | rules not yet tried on real Python code |
| Go | BASIC | 27 | go | use on real Go code not confirmed |
| Rust | BASIC | 13 | cargo, cargo-audit, cargo-deny | rules tried on real Rust code (one corpus repo) |
| Java | BASIC | 25 | mvn | rules not yet tried on real Java code |
| C# | BASIC | 15 | dotnet | rules not yet tried on real C# code |
| PHP | BASIC | 13 | composer, phpstan | rules not yet tried on real PHP code |
| Ruby | BASIC | 11 | rubocop, rspec | rules not yet tried on real Ruby code |
| Swift | NONE | 0 | swiftlint, swift | no rules of its own |
| Dart, Flutter | NONE | 0 | dart | no rules of its own |
| Shell scripts | BASIC | 1 | shellcheck | PowerShell is not covered |
| HTML, CSS | DEEP | 26 | htmlhint, stylelint | checks whose files are HTML, CSS or templates, plus the web-hardening HTML table |
| Markdown | BASIC | 9 | lychee, markdownlint-cli2, typos |  |
| YAML, TOML, JSON | BASIC | 4 | yamllint | syntax and duplicate keys only |
| Dockerfile | BASIC | 38 | hadolint | infra rules were measured on the corpus as one group; per-family use not confirmed |
| Kubernetes, Helm | BASIC | 52 | helm, kube-linter | as for Dockerfile |
| Terraform | BASIC | 29 | terraform | rules from the Terraform table of ip-terraform-compose |
| Docker Compose | BASIC | 9 | - | rules from the Compose table of ip-terraform-compose |
| GitHub Actions | BASIC | 39 | actionlint | as for Dockerfile |
| GitLab, CircleCI, Azure, Jenkins | BASIC | 7 | - |  |
| Jupyter notebooks | BASIC | 6 | - |  |
| Game engines | BASIC | 8 | - | Unity, Godot, Unreal only |
| Android | BASIC | 2 | - | iOS is not covered |
| Electron, Tauri | BASIC | 12 | - |  |
| Any text file (secrets) | DEEP | 285 | - | counted once here, not in the rows above |
<!-- coverage-lang:end -->

How the counts are made: a rule is one pass/fail result inside a check. The generator adds up the rules of the checks that belong to each row. Rules for C#, PHP and Ruby share one table (`cp-dotnet-php-ruby`) and are split by their id prefix (`cs-`, `php-`, `rb-`). The Terraform and Compose rules share one check and are split by their rule tables. A rule that applies to many languages (for example the secret rules) is counted once, in the last row.

## 3. What it detects that other tools also detect

Legend: **PART** = the same idea, written as Meerkat's own rules, not a full match. **RUNS** = Meerkat runs the real tool if you have it installed. Counts come from the research note of 2026-10-31 (`wiki/concepts/meerkat-security-tool-research-2026-10-31.md`). "Unverified" is the note's own word.

| Other tool | Meerkat | What is covered | What is not |
|---|---|---|---|
| Gitleaks, detect-secrets | PART | Vendor key formats plus three generic rules (`secrets-plus`). Spot-checked against Gitleaks for about 25 vendors | Gitleaks has 220 default rules, Meerkat has its own count (table 1). Not rule-for-rule. Most vendors not checked against the vendor's own docs |
| TruffleHog | PART | Key shapes | It does not test a key against the live service |
| Bandit | PART, RUNS | A few dozen Python rules of its own (table 2). Runs `bandit` if installed | Bandit has 44 test ids (note). Overlap with Meerkat's rules is unverified |
| gosec, Brakeman, FindSecBugs, eslint-plugin-security | PART | Line-level patterns for Go, Ruby (Rails), Java, JS | Counts in the note: Brakeman 31, FindSecBugs about 159, eslint-security 15, gosec unverified. No dataflow |
| Polaris, kubesec, kube-linter | PART, RUNS | Kubernetes manifest rules (table 2). Runs `kube-linter` if installed | Polaris has 24 security checks, kubesec about 20 (note). Exact overlap unverified |
| hadolint | PART, RUNS | Dockerfile rules. Runs `hadolint` if installed | |
| Dockle | NO | | Dockle checks built images (CIS-DI-0001 to 0010). Meerkat does not open images |
| actionlint | PART, RUNS | Runs `actionlint` if installed; own GitHub Actions rules | actionlint has about 40 check groups (note) |
| zizmor | PART | Script injection, permissions, pinning, secrets echoed | zizmor has about 41 audits (note). Overlap unverified. Checks that need network data are not done |
| Mozilla Observatory, ZAP passive, Nikto, testssl ideas | PART | Header and TLS settings read from server and host config files (`wh-headers`) | It reads config files. It never calls a live site, so it cannot see what a server really sends |
| Lighthouse (static audits) | PART | Accessibility, SEO and size checks on source files | Lighthouse has 44 accessibility audits (note). Meerkat does not render the page, so contrast and layout are only judged from CSS text |
| Retire.js (idea) | PART | One vendored library rule (see section 4) and a rule for a missing version banner | No vulnerability database |
| SBOM readiness (Syft, CycloneDX idea) | PART | Checks that the lockfile has the fields an SBOM needs (version, resolved URL, integrity) and that a release workflow makes an SBOM | It does not produce an SBOM |
| Stryker (mutation testing) | PART | Text-level mutation, opt-in (`mutation-testing`) | See section 4 |

## 4. What it does NOT do

Be blunt. These are the limits, taken from the check scripts and their notes.

| Limit | What it means for you |
|---|---|
| **Not a dataflow or taint engine.** | It does not follow a value from a request to a database call. It cannot see across functions or files. |
| **Regex and line based, not a parser.** | A rule that reads one line cannot see a call split over several lines (stated in `thorough/rules-code-patterns.mjs`). An aliased call such as `cp.exec(...)` can be missed. |
| **No live vulnerability database.** | There is no CVE matching of its own. The bundled library table has **one verified entry**: jQuery below 3.5.0 (`vendored-jquery-below-3-5`). Other libraries only get a "no version banner" note. |
| **Dependency audit only through other tools.** | `npm-audit-all` runs `npm audit`; `rust-audit` needs `cargo-audit`. Without the tool the check is NOT RUN. |
| **No scan of a running app.** | There is no ZAP, Nikto or Nuclei equivalent. The performance checks (`perf-endpoints`, `perf-load`) time your own app. They aim at this machine unless you allow a remote one, and they are not security tests. |
| **No image or cluster scanning.** | It reads Dockerfiles and manifests. It does not open a built image or ask a cluster. |
| **No binary or bytecode analysis.** | Source and config text only. |
| **Secrets: only files it reads.** | Secret rules read the files git tracks (a plain walk outside git). A new file git does not track yet is not read by those rules. History is checked only by `git-history-secrets` and `env-files-in-history`, within a commit limit you set (`historyCommits`). |
| **Tests, docs and fixtures are skipped by the secret rules.** | They hold fake secrets on purpose. A real secret pasted into a test file is skipped unless you run with `--include-tests`. Lines over 4000 characters and binary files are skipped too. |
| **Wrappers for some tools are unproven.** | The README says the Java, .NET, PHP, Ruby, Swift, Dart, Terraform and Kubernetes wrappers were written from each tool's documentation and not yet run against the real tools. |
| **Rules are lightly tested on some languages.** | The review corpus (13 repositories) had no Python, PHP, Ruby, C# or Java code. Those rule tables are proved on small samples only. |
| **Mutation testing is text-level.** | It changes lines of text, not a syntax tree. It tests a sample, not every mutant. Some mutants change nothing. A 100 percent score is rarely realistic (`docs/mutation.md`). |
| **"Run your project" checks run your code.** | They use a temp copy and a cleaned environment, but this is not a sandbox. Only use them on code you trust (`docs/functionality-run.md`). |

**Companions to run next to Meerkat** for what it cannot do. This is general advice, not tested here: Semgrep or CodeQL for dataflow and cross-file rules, Trivy for images and a vulnerability database, gitleaks or TruffleHog for a deep history scan and live key checks.

## 5. False positives and false negatives

These are the only measured numbers. They come from one review on 2026-10-31 of the new rule families (secrets-plus, code-patterns, infra-plus, web-hardening). Rules were run read-only on **13 real repositories** with a 60 second cap each. They were not re-run for this page.

| What was measured | Result |
|---|---|
| Secret rules, false hits on the corpus | About 85 before fixes, **about 7 after**. All 7 were test, doc or fixture strings. |
| One real find | A hardcoded password in a script of one corpus repo, which the review marked as true. |
| Code-pattern rules, clear false hits | About 10,150 before (one bug: a Rust rule fired on every file), **0 clear false hits after**. Noisy rules remain (below). |
| Infra rules, false hits | 2 before, 0 after. |
| Web-hardening rules, clear false hits | About 9 before, 0 after. |
| False negatives, the reviewer's own variant test | 33 of 96 variants missed (**34 percent raw**). Many were the reviewer's wrong guesses at rule ids, so the real miss rate is **lower but unmeasured**. |
| False negatives, rate on real vulnerable code | **Unmeasured.** |

**False-negative classes the review confirmed:**

- Aliased calls (`cp.exec(`) and secret compares with short names (`token === req.token`).
- Multi-line constructs, such as `execFile(..., {` with `shell: true` on the next line, and an `<iframe` split over lines.
- Flow-style YAML (`permissions: { contents: write }`) and JSON-style `Action = "*"`.
- `USER root` as the last `USER` line in a Dockerfile.
- A regular expression built from a template literal.

The review fixed three misses (annotated Python passwords, unquoted `type=password`, Go file modes ending in 7). The others were not fixed.

**Noisy rules still on the corpus** (true by their title, but an owner would often call them false alarms; counted in the review, not re-measured):

| Rule | Hits on the corpus | Why it is noisy |
|---|---|---|
| `th-without-scope` | 615 | Table headers without a scope |
| `source-map-published` | 323 | Real in one repo, a published build folder |
| `heading-level-skipped` | 94 | JSX files hide component boundaries |
| `js-regexp-variable` | 48 | A regex built from a variable |
| `gha-unnamed-job` | 26 | A job without a name |
| compose hardening | 20 | Missing hardening keys |
| terraform wildcards | 15 | Wildcards that may be intended |
| `js-spawn-shell` | 12 | |
| `gha-contents-write` | 8 | |

The review also says its sample-based self-proof is weak (most "good" samples are the bad sample cut short), so passing self-tests does not prove few false hits. The corpus scan is the better evidence.

## 6. How to read a result

**Status of one check**

| Status | Meaning |
|---|---|
| PASS | It ran and found nothing. A check that does not apply also passes, with a line "not applicable: ..." |
| FAIL | It ran and found a problem. |
| NOT RUN | It could not run here: a tool is missing (the line says how to install it), the folder is not a git repository, or a budget is not set. **Never a pass.** |
| NA | On a single rule: it does not apply to this folder. It is never counted as a failure. |

**Exit codes** (`docs/commands.md`)

| Code | Meaning |
|---|---|
| 0 | Everything passed |
| 1 | A check failed or could not run |
| 2 | A usage or config error |
| 3 | Nothing to run |
| 130 | Interrupted |

**Where results live.** Each run writes a folder under `~/.meerkat/logs/runs/` (or `MEERKAT_LOG_DIR`) and never writes inside your project.

| File | What it is |
|---|---|
| `report.md` | What failed and why, for a person |
| `summary.json` | Every result, for a program |
| `findings.json` | The findings of the run, in each run folder (see `docs/findings.md`) |
| `<check>.log` | The command and the full output of one check |

To read back: `node run.mjs --last`, or `node run.mjs --why <check>`. More in `docs/logs.md`.

**Accept a finding.** Each check names its allow file in its message. Add one line per accepted finding, and `#` for a comment.

| Allow file | For |
|---|---|
| `.meerkat-secrets-allow` | `secret-scan` |
| `.meerkat-secrets-plus-allow` | `secrets-plus` (or a comment `meerkat-allow: secret` on the line) |
| `.meerkat-codepatterns-allow` | the language code-pattern rules (`cp-*`) |
| `.meerkat-infraplus-allow` | Docker, Kubernetes, Terraform, Compose, Actions rules |
| `.meerkat-webhardening-allow` | header, HTML, publish-folder and supply rules |
| `.meerkat-test-quality-allow` | `test-quality-static` |

To turn off a rule everywhere, use `disableSubs` in `meerkat.config.json`, for example `"secret-scan/aws-access-key"`. A turned-off rule is left out of the counts and listed on every run.

**Add your own checks.** See `docs/customizing.md` ("Add a check of your own" and "Your own checks") and `docs/writing-checks.md`.

**Run the deeper, opt-in checks.**

| You want | Type |
|---|---|
| Install, build, test and README commands in a clean copy | `meerkat verify --thorough --include runtime` |
| Mutation testing | `meerkat verify --include mutation`, or `meerkat check mutation-testing` |
| AI review (may call a paid model) | `meerkat verify --include ai` |
| Rust dependency policy | `meerkat verify --include deny` |

## 7. Verification

How the numbers in this file are made, and how to check them again.

| To do this | Run |
|---|---|
| Rebuild the two tables in this file | `node tools/gen-coverage.mjs` |
| Rebuild the check list in `docs/checks.md` and the README | `node tools/gen-checks.mjs` |
| Cross-check the totals | `node bin/meerkat.mjs suite list --json` (the "catalogue" numbers count every pack) |
| Re-run the compatibility matrix (20 sample projects, every check) | `node tools/compat-matrix.mjs` (see `docs/compatibility.md`) |
| Run the self-tests of the checks | `node run.mjs --self-test` |
| Run the unit tests | `npx vitest run` |

The generator reads every folder under `packs/`, so the counts do not depend on which packs a project turns on. It stops with an error if a suite has no description, so a new suite cannot be missed.
