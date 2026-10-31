# Every check

Generated from the checks themselves by `node tools/gen-checks.mjs`, so it cannot drift from the code. See the [README](../README.md#every-check) for how to read the columns.

<!-- checks:start -->
**338 checks** in 47 suites with 1037 sub-checks (a check that declares no rules counts as one), across 44 packs: 315 quick, 23 thorough, 9 opt-in. [Security 100](#security-checks) · [Functionality 190](#functionality-checks) · [UI 22](#ui-checks) · [Performance 15](#performance-checks) · [Refactor 11](#refactor-checks)

### Suites

You pick a suite; it runs its checks, and each check reports its own sub-checks. See docs/suites.md.

| Suite | Name | Checks | Sub-checks | What it covers |
|---|---|---|---|---|
| `secrets` | Secrets | 4 | 285 | Keys, tokens, passwords and private files that must never be committed. |
| `risky-calls` | Risky code | 7 | 92 | Dangerous calls: eval, shell strings, disabled TLS checks, weak hashes, plain http. |
| `injection-patterns` | Injection patterns | 7 | 69 | Code shapes that lead to SQL injection, path traversal, open redirects, regex DoS and XXE. |
| `crypto-and-auth` | Crypto and auth | 2 | 2 | Weak JWT settings and weak encryption modes. |
| `supply-chain` | Supply chain | 8 | 23 | Dependency pinning, lockfile integrity, known-vulnerable packages, install scripts and look-alike names. |
| `ci-workflows` | Workflow security | 3 | 36 | GitHub Actions: pinned actions, limited permissions, no script injection, no secrets echoed. |
| `web-security` | Web security | 20 | 76 | CORS, cookies, CSP, unsafe links and inline handlers, mixed content and debug modes left on. |
| `accessibility` | Accessibility | 10 | 10 | ARIA, link text, focus, zoom, captions, table headers and colour contrast. |
| `html-and-css` | HTML and CSS | 10 | 35 | Valid markup, duplicate ids, image sizes, stylesheet lint and !important overuse. |
| `seo-and-meta` | SEO and meta | 2 | 2 | Title, description, robots and sitemap. |
| `code-quality` | Code quality | 10 | 10 | Whitespace, indentation, leftovers, empty catches, TODO hygiene and broken imports. |
| `test-hygiene` | Test hygiene | 10 | 31 | Skipped or focused tests, duplicate test names and projects with no tests. |
| `refactor` | Refactor | 9 | 9 | Duplicated code, dead code, long files and functions, deep nesting and complexity. |
| `javascript` | JavaScript and TypeScript | 7 | 7 | Common JS and TS mistakes: loose equality, var, unhandled promises, any, ts-ignore. |
| `slow-code-patterns` | Slow code patterns | 4 | 4 | Sync file calls in handlers, parsing or regex building inside loops, DOM queries in loops. |
| `repo-docs` | Repository docs | 5 | 5 | README sections, security policy, contributing guide, code owners and changelog format. |
| `repo-files` | Repository files | 12 | 12 | Large files, odd file names, case conflicts, symlinks, exec bits, gitignore and editorconfig. |
| `licensing` | Licensing | 5 | 5 | A licence file exists and matches what the package says. |
| `config-files` | Config files | 22 | 22 | JSON, YAML and TOML parse, env examples, line endings and Makefile tabs. |
| `ci-config` | CI config | 18 | 18 | A CI pipeline exists, has time limits and pins its Node version. |
| `content-and-docs` | Content and docs | 11 | 11 | Markdown, links, changelog, README usage, typos and hidden characters. |
| `i18n` | Translations | 2 | 2 | Translation files have the same keys and placeholders. |
| `data-files` | Data files | 15 | 15 | JSON with duplicate keys, inconsistent CSV, oversized data files. |
| `api-contracts` | API contracts | 4 | 4 | OpenAPI and GraphQL schemas are valid and complete. |
| `database` | Database | 4 | 4 | SQL migrations order and safety, missing indexes, Prisma schema basics. |
| `api-resilience` | API resilience | 4 | 4 | Timeouts, rate limits, error leaks and bounded pagination. |
| `desktop-apps` | Desktop and mobile apps | 14 | 14 | Electron, Tauri, Capacitor, Cordova and Android manifest security settings. |
| `git-history` | Git history | 8 | 8 | Commit messages, large commits, binaries and secrets in history, author identity. |
| `git-workflow` | Git workflow | 3 | 3 | Branch names, long-lived branches and pinned submodules. |
| `release-versioning` | Release versioning | 15 | 15 | Semantic versions, tags that match the package, changelog kept up to date. |
| `dependencies` | Dependencies | 15 | 15 | Lockfile in sync, unused, duplicate, wildcard or misplaced dependencies. |
| `performance` | Performance | 11 | 11 | Size, start-up, memory, response time, load and build time against budgets. |
| `node` | Node and TypeScript tools | 9 | 9 | ESLint, tsc, Prettier, circular imports, engines and tsconfig strictness. |
| `rust` | Rust | 10 | 10 | rustfmt, clippy, tests, audit, deny, docs and the release build. |
| `python` | Python | 8 | 8 | ruff, mypy, pytest, bandit and dead code. |
| `go` | Go | 4 | 4 | go vet and go test. |
| `java` | Java | 3 | 3 | Maven validate, compile and test. |
| `dotnet` | .NET | 2 | 2 | dotnet format and dotnet build. |
| `php` | PHP | 2 | 2 | composer validate and phpstan. |
| `ruby` | Ruby | 2 | 2 | RuboCop and RSpec. |
| `swift` | Swift | 2 | 2 | SwiftLint and swift build. |
| `dart` | Dart and Flutter | 2 | 2 | dart analyze and dart format. |
| `terraform` | Terraform | 2 | 38 | terraform fmt. |
| `kubernetes` | Kubernetes | 3 | 52 | Helm lint and kube-linter. |
| `docker` | Docker and Compose | 4 | 40 | Dockerfile lint, pinned base images and Compose hygiene. |
| `shell-scripts` | Shell scripts | 2 | 2 | ShellCheck and shell script hygiene. |
| `ai-review` | AI review | 2 | 2 | AI route audit and AI diff review (opt-in, may call a paid model). |

### Security checks

Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review. 100 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `actionlint` | fast | tiny | 3 s | GitHub Actions workflows (actionlint) *(needs: actionlint)* | infra |
| `actions-secrets-echo` | fast | tiny | 3 s | GitHub Actions: no secrets printed or leaked, no broad permissions | security-plus |
| `analytics-consent` | fast | tiny | 2 s | A tracker is loaded only where the front end mentions consent, a cookie banner or GDPR | privacy |
| `android-manifest-flags` | fast | tiny | 2 s | Android: the manifest is not debuggable and does not allow backups | desktop |
| `azure-pipelines` | fast | tiny | 2 s | Azure Pipelines uses named images, no piped installers and no inline secrets | ci-systems |
| `bandit` | fast | light | 10 s | Bandit: common Python security mistakes *(needs: bandit)* | python |
| `capacitor-cordova-cleartext` | fast | tiny | 2 s | Capacitor or Cordova: no mobile shell allows plain http traffic | desktop |
| `circleci-config` | fast | tiny | 2 s | CircleCI config pins its orbs, avoids deprecated machine images and keeps secrets out | ci-systems |
| `compose-hygiene` | fast | tiny | 2 s | Docker Compose: pinned images, no privileged containers or host networking, no open database ports, no passwords in the file | config |
| `cookie-flags` | fast | tiny | 2 s | Cookies are set with HttpOnly, Secure and SameSite | security-plus |
| `cors-wildcard` | fast | tiny | 2 s | CORS: no site may read responses with credentials, and Origin is not copied back unchecked | security-plus |
| `cp-dotnet-php-ruby` | fast | tiny | 2 s | C#, PHP and Ruby: no unsafe deserialization, no eval of input, no disabled checks, no unscoped params | code-patterns |
| `cp-go` | fast | tiny | 2 s | Go: no hardcoded secrets, no unbounded servers, no command or path from requests, no weak crypto | code-patterns |
| `cp-java` | fast | tiny | 2 s | Java: no runtime exec or object deserialization from untrusted input, no trust-all TLS, no expression injection | code-patterns |
| `cp-js` | fast | tiny | 2 s | JavaScript and TypeScript: no command or require built from variables, no timing-unsafe secret checks, no hidden characters | code-patterns |
| `cp-python` | fast | tiny | 2 s | Python: no shell or process call from variables, no unsafe loads, no disabled TLS, no weak modes | code-patterns |
| `cp-rust` | fast | tiny | 2 s | Rust: unsafe blocks carry a SAFETY note, no weak hashes, no secrets printed | code-patterns |
| `credentials-in-urls` | fast | tiny | 2 s | No user name and password written into a web address | security-plus |
| `csp-present` | fast | tiny | 3 s | A site with HTML pages sends a Content-Security-Policy | web-plus |
| `debug-enabled` | fast | tiny | 2 s | Debug mode is not switched on where it should be off | security-plus |
| `dependency-pinning` | fast | tiny | 3 s | Dependencies name a fixed version, not latest or * | security |
| `dependency-updates-configured` | fast | tiny | 2 s | A dependency update bot (Dependabot or Renovate) is configured | repo |
| `deprecated-deps` | fast | tiny | 2 s | No locked dependency is marked deprecated by its author | repo |
| `docker-base-pinning` | fast | tiny | 3 s | Docker: base images pinned, no download piped into a shell, a non-root user | security-plus |
| `electron-context-isolation` | fast | tiny | 2 s | Electron: every window with webPreferences keeps contextIsolation on | desktop |
| `electron-csp-header` | fast | tiny | 2 s | Electron: a local page is sent with a Content-Security-Policy | desktop |
| `electron-devtools-prod` | fast | tiny | 2 s | Electron: DevTools open only behind a dev-only condition | desktop |
| `electron-ipc-validation` | fast | tiny | 2 s | Electron: ipc handlers do not pass renderer input to files or processes unchecked | desktop |
| `electron-navigation-guards` | fast | tiny | 2 s | Electron: apps that create windows guard navigation and new windows | desktop |
| `electron-node-integration` | fast | tiny | 2 s | Electron: no window turns on Node.js for web pages | desktop |
| `electron-open-external` | fast | tiny | 2 s | Electron: shell.openExternal gets a fixed string or passes an allow check | desktop |
| `electron-preload-exposure` | fast | tiny | 2 s | Electron: contextBridge exposes named functions, not ipcRenderer or require | desktop |
| `electron-remote-module` | fast | tiny | 2 s | Electron: the remote module is not enabled or used | desktop |
| `electron-updater-https` | fast | tiny | 2 s | Electron: app updates are fetched over https | desktop |
| `electron-web-security` | fast | tiny | 2 s | Electron: no window switches off webSecurity or allows insecure content | desktop |
| `env-files-in-history` | fast | tiny | 10 s | Git history: key and environment files that were ever committed | security-plus |
| `external-fonts-cdn` | fast | tiny | 2 s | No font or style is loaded from a third-party CDN (listed unless privacy.noThirdPartyFonts is true) | privacy |
| `geolocation-and-media-requests` | fast | tiny | 2 s | Location, camera, microphone and clipboard prompts only run behind a user action | privacy |
| `github-actions-artifacts` | fast | tiny | 2 s | GitHub Actions artifact uploads set a retention limit and upload no secret paths | ci-systems |
| `gitlab-ci-privileged` | fast | tiny | 2 s | GitLab CI asks for no privileged container, and docker:dind keeps TLS on | ci-systems |
| `gitlab-ci-secrets` | fast | tiny | 2 s | GitLab CI file writes no credential or token into the file | ci-systems |
| `hadolint` | fast | tiny | 3 s | Dockerfiles (hadolint) *(needs: hadolint)* | infra |
| `hardcoded-ip` | fast | tiny | 2 s | No public IP address written into the code | security-plus |
| `helm-values-secrets` | fast | tiny | 2 s | Helm chart values files hold no literal password, token or key | ci-systems |
| `inline-event-handlers` | fast | tiny | 3 s | Markup has no inline script handlers (onclick and similar) or javascript: links | web-plus |
| `install-scripts` | fast | tiny | 3 s | Code that runs on install: the project scripts and dependency install scripts | security-plus |
| `ip-docker` | fast | tiny | 3 s | Dockerfiles: health check, users, package installs, downloads, layers and secrets in the image | infra-plus |
| `ip-gha` | fast | tiny | 3 s | GitHub Actions workflows: untrusted input in run steps, token permissions, pull_request_target and deprecated commands | infra-plus |
| `ip-k8s` | fast | tiny | 3 s | Kubernetes manifests: privileges, host access, probes, limits, roles, images and network policy | infra-plus |
| `ip-terraform-compose` | fast | tiny | 3 s | Terraform and Compose: open ports, encryption, public access, IAM wildcards, capabilities and dependencies | infra-plus |
| `jenkinsfile-safety` | fast | tiny | 2 s | Jenkinsfile keeps parameters out of shell strings, credentials out of the log and the Docker socket off any agent | ci-systems |
| `jwt-weak` | fast | tiny | 2 s | JWTs: no "none" algorithm, no decode used as a sign-in check, no secret typed into the code | security-plus |
| `kube-linter` | fast | light | 10 s | Kubernetes manifests: security and best practice (kube-linter) *(needs: kube-linter)* | kubernetes |
| `license` | fast | tiny | 2 s | A license is declared, and no copyleft dependency slipped in | hygiene |
| `license-header-consistency` | fast | tiny | 2 s | The LICENSE text and the package manifests name the same licence | privacy |
| `license-matches` | fast | tiny | 2 s | The LICENSE file agrees with the licence declared in package.json or Cargo.toml | repo |
| `local-storage-pii` | fast | tiny | 2 s | No personal or secret value is kept in localStorage or sessionStorage | privacy |
| `lockfile-integrity` | fast | tiny | 3 s | Locked packages are fetched securely and checksummed | security |
| `lockfile-licenses` | fast | tiny | 2 s | Lock-file packages have no copyleft, missing or UNLICENSED licence (listed unless privacy.noCopyleft is true) | privacy |
| `lockfile-registry-hosts` | fast | tiny | 3 s | Lockfiles: every package comes from the registry the project chose | security-plus |
| `mixed-content` | fast | tiny | 2 s | Nothing is loaded over plain http on a page that is otherwise https | a11y |
| `notebook-secrets` | fast | tiny | 2 s | No keys, tokens or passwords in notebook cells or outputs | data-science |
| `notice-file` | fast | tiny | 2 s | Committed third-party code has a NOTICE or THIRD_PARTY file | privacy |
| `open-redirect-pattern` | fast | tiny | 2 s | Redirects do not go to a request address without an allow-list check | security-plus |
| `path-traversal-pattern` | fast | tiny | 2 s | Files are not read or sent with a path taken straight from the request | security-plus |
| `pii-in-logs` | fast | tiny | 2 s | No personal or secret value (email, password, token, card) is written to a log in the clear | privacy |
| `pii-patterns-in-source` | fast | tiny | 2 s | No real-looking email, phone number, public IP or national ID number is written into the source | privacy |
| `prisma-schema-basics` | fast | tiny | 2 s | Prisma models have an id and no datasource URL holds a password as a literal | api |
| `privacy-policy-file` | fast | tiny | 2 s | A web app with sign-in or forms, or a published package, has a privacy policy (listed unless privacy.requirePolicy is true) | privacy |
| `regex-dos` | fast | tiny | 2 s | No regular expression that can take exponential time | security-plus |
| `requirements-hashes` | fast | tiny | 3 s | Installs pinned to a version or hash, and not fetched over plain http | security-plus |
| `risky-code` | fast | tiny | 3 s | Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http | security |
| `rust-audit` | fast | light | 4 s | Rust dependency advisories (cargo audit) | rust |
| `rust-deny` | fast | light | 10 s | Rust dependency policy: licenses, banned crates, sources (cargo deny) *(opt-in: `--include deny`)* *(needs: cargo-deny)* | rust |
| `secret-scan` | fast | tiny | 3 s | Secret scan: keys, tokens and private keys in tracked files | security |
| `secrets-plus` | fast | tiny | 3 s | No provider key, token, private key or high-entropy secret is written into the files (never printed in full) | secrets-plus |
| `security-policy` | fast | tiny | 2 s | SECURITY.md says how to report a security problem | repo |
| `sensitive-files` | fast | tiny | 2 s | No environment files, private keys or tokens are tracked | hygiene |
| `shellcheck` | fast | tiny | 3 s | Shell scripts (shellcheck) *(needs: shellcheck)* | infra |
| `shopify-secrets` | fast | tiny | 2 s | Shopify: no Admin, custom app, private app or storefront token in a tracked file | engines |
| `sql-concat` | fast | tiny | 2 s | SQL is not built by joining text and values together | security-plus |
| `sri-missing` | fast | tiny | 2 s | Scripts and stylesheets loaded from another site have an integrity hash | a11y |
| `symlinks-tracked` | fast | tiny | 2 s | No symbolic links are committed (they break on Windows checkouts) | repo |
| `target-blank-noopener` | fast | tiny | 3 s | Every link that opens a new tab has rel="noopener" | web-plus |
| `tauri-allowlist` | fast | tiny | 2 s | Tauri: the allowlist grants no all-APIs, open-anything shell or whole-disk fs scope | desktop |
| `telemetry-calls` | fast | tiny | 2 s | Telemetry and error-reporting calls are listed so the README can disclose them | privacy |
| `telemetry-disclosure` | fast | tiny | 2 s | If the code has telemetry, the README or PRIVACY.md says so | privacy |
| `third-party-trackers` | fast | tiny | 2 s | No known tracking or analytics host is loaded (listed unless privacy.noTrackers is true) | privacy |
| `typosquat-names` | fast | tiny | 3 s | Dependency names that look like a misspelt popular package | security-plus |
| `unsafe-rust` | fast | tiny | 2 s | Every Rust unsafe block says why it is sound | hygiene |
| `weak-crypto-modes` | fast | tiny | 2 s | No weak cipher, ECB mode, fixed key, guessable token or MD5 password | security-plus |
| `wh-headers` | fast | tiny | 3 s | Server config sends HSTS, frame, content-type, referrer and CSP headers, and TLS is current | web-hardening |
| `wh-publish-root` | fast | tiny | 3 s | No git history, env file, dump, key, backup or debug page sits in a published folder, and no host publishes the repo root | web-hardening |
| `wh-supply` | fast | tiny | 3 s | Vendored libraries are not known-vulnerable versions, and lockfile and manifest entries are complete and pinned | web-hardening |
| `workflow-security` | fast | tiny | 3 s | GitHub Actions: pinned actions, limited permissions, no script injection | security |
| `xxe-and-deserialize` | fast | tiny | 2 s | XML parsers are locked down and untrusted data is not deserialized | security-plus |
| `ai-diff-review` | thorough | light | 1.0 min | AI security review of the changes against the base branch *(opt-in: `--include ai`)* | ai |
| `ai-route-audit` | thorough | light | 5.0 min | AI audit of every route, handler and IPC channel *(opt-in: `--include ai`)* | ai |
| `git-history-secrets` | thorough | light | 10 s | Git history: secrets ever committed, even if removed since | security-plus |
| `npm-audit-all` | thorough | tiny | 5 s | npm audit, high severity, every dependency including dev ones | security |

### Functionality checks

Does it build, type-check, lint and pass its tests; is the repository in order. 190 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `ansible-hygiene` | fast | tiny | 2 s | Ansible playbooks hide passwords, limit become and avoid plain http downloads | ci-systems |
| `author-identity` | fast | tiny | 3 s | Recent commits have a real author name and email, not a placeholder | git |
| `binary-in-history` | fast | tiny | 3 s | No file over the size budget was added in the recent history | git |
| `branch-names` | fast | tiny | 3 s | Local branch names are lowercase kebab-case with / separators | git |
| `broken-imports` | fast | tiny | 2 s | Every relative import points at a file that exists | hygiene |
| `case-conflicts` | fast | tiny | 2 s | No two file names differ only by upper and lower case (they clash on Windows and macOS) | repo |
| `changelog-format` | fast | tiny | 2 s | CHANGELOG.md has version headings, newest first | repo |
| `changelog-updated` | fast | tiny | 3 s | CHANGELOG.md changes when the source changes after the latest tag | git |
| `changelog-version-headings` | fast | tiny | 2 s | CHANGELOG.md has version headings, with Unreleased first and newest first | content |
| `changelog-vs-version` | fast | tiny | 2 s | The package.json version is written down in CHANGELOG.md | content |
| `ci-node-version-pinned` | fast | tiny | 2 s | GitHub Actions setup steps name a real runtime version, not latest or a floating alias | config |
| `ci-present` | fast | tiny | 2 s | An automated check config (CI) exists | repo |
| `ci-timeouts` | fast | tiny | 2 s | Every GitHub Actions job sets timeout-minutes | config |
| `codeowners-valid` | fast | tiny | 2 s | CODEOWNERS: every pattern has a real owner, and no pattern is listed twice | repo |
| `commit-message-format` | fast | tiny | 3 s | Recent commit subjects are short, not empty, not ending in a period, and free of WIP or fixup! | git |
| `composer-validate` | fast | tiny | 5 s | Composer: composer.json is valid (strict) *(needs: composer)* | php |
| `conflict-markers` | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `contributing-file` | fast | tiny | 2 s | CONTRIBUTING.md exists once a project has a README and several source files | repo |
| `crate-publish-ready` | fast | tiny | 2 s | A publishable crate has its metadata and no path-only dependency | packaging |
| `csv-consistent` | fast | tiny | 2 s | Every CSV row has as many columns as its header | content |
| `dart-analyze` | fast | light | 20 s | Dart: analyzer (errors, warnings and lints) *(needs: dart)* | dart |
| `dart-format` | fast | tiny | 5 s | Dart: code formatting (dart format) *(needs: dart)* | dart |
| `data-files-in-git` | fast | tiny | 2 s | Large data files are stored with git-lfs, not plain git | data-science |
| `dataset-license-note` | fast | tiny | 2 s | Every data folder says where its data came from | data-science |
| `dead-assets` | fast | tiny | 2 s | Every image or font under public, assets or static is mentioned by some text file | content |
| `debug-leftovers` | fast | tiny | 2 s | No debugger statements, console.log, debug prints, dbg! or todo! left in | quality |
| `dependency-count` | fast | tiny | 2 s | Direct dependency count stays within its budget (default 150) | health |
| `deprecated-apis` | fast | tiny | 2 s | No deprecated or removed Node API is called | health |
| `dev-deps-in-prod` | fast | tiny | 2 s | No build or test tool is listed under dependencies in an application | health |
| `dotnet-build` | fast | medium | 30 s | .NET: the build, with warnings treated as errors *(needs: dotnet)* | dotnet |
| `dotnet-format` | fast | light | 20 s | .NET: code formatting (dotnet format) *(needs: dotnet)* | dotnet |
| `duplicate-dependencies` | fast | tiny | 2 s | No package is listed twice in package.json | health |
| `duplicate-test-names` | fast | tiny | 2 s | No two tests in one file share the same name | quality |
| `editorconfig-present` | fast | tiny | 2 s | .editorconfig exists once a project has several source files | repo |
| `empty-catch` | fast | tiny | 2 s | No error handler is empty and swallows the error | quality |
| `env-example` | fast | tiny | 2 s | Every environment variable the code reads is documented | hygiene |
| `error-leak` | fast | tiny | 2 s | Handlers do not send error stacks, messages or tracebacks to the client | api |
| `eslint` | fast | light | 20 s | ESLint: the project's own lint rules *(needs: eslint)* | node |
| `exec-bits` | fast | tiny | 2 s | Executable bits match the files: scripts with a #! line are executable, and executables have one | repo |
| `final-newline` | fast | tiny | 2 s | Every text file ends with exactly one newline | quality |
| `focused-tests` | fast | tiny | 2 s | No test is left focused, which silently skips the rest | quality |
| `generated-files-tracked` | fast | tiny | 2 s | No build or dependency output (node_modules, dist, build, target and similar) is committed to git | repo |
| `gitattributes-eol` | fast | tiny | 2 s | Text files use one line-ending style, or a .gitattributes file says which | config |
| `github-actions-concurrency` | fast | tiny | 2 s | Deploy and release GitHub Actions workflows set a concurrency group | ci-systems |
| `github-actions-reusable` | fast | tiny | 2 s | Reusable workflows called from GitHub Actions exist and are not pinned to a branch | ci-systems |
| `gitignore-essentials` | fast | tiny | 2 s | .gitignore covers dependencies, secrets and OS junk, and nothing it ignores is committed | repo |
| `gitignored-but-tracked` | fast | tiny | 2 s | No file that .gitignore says to ignore is still tracked by git | config |
| `gitlab-ci-images` | fast | tiny | 2 s | GitLab CI images and services are pinned to a tag, not untagged or latest | ci-systems |
| `gitlab-ci-stages` | fast | tiny | 2 s | Every GitLab CI job names a defined stage | ci-systems |
| `gitmodules-pinned` | fast | tiny | 3 s | Submodules use https, and branch-tracking submodules are pinned to a commit | git |
| `go-defer-in-loop` | fast | tiny | 2 s | Go does not defer inside a loop | lang |
| `go-ignored-errors` | fast | tiny | 2 s | Go does not throw an error away with _ | lang |
| `go-test` | fast | medium | 1.0 min | go test: the test suite *(needs: go)* | go |
| `go-vet` | fast | light | 15 s | go vet: suspicious constructs *(needs: go)* | go |
| `godot-project` | fast | tiny | 2 s | Godot: project.godot has a config_version, build output is ignored, presets hold no credentials | engines |
| `godot-script-hazards` | fast | tiny | 2 s | Godot: _process() does not call print() or get_node() | engines |
| `graphql-schema-basics` | fast | tiny | 2 s | GraphQL schemas have balanced braces and unique type names | api |
| `helm-chart-basics` | fast | tiny | 2 s | Helm charts have valid metadata, pinned images and no host networking or privilege | ci-systems |
| `helm-lint` | fast | tiny | 5 s | Helm chart: lint *(needs: helm)* | kubernetes |
| `http-timeouts` | fast | tiny | 2 s | HTTP calls set a timeout or signal, up to the untimed-call budget | api |
| `i18n-keys-match` | fast | tiny | 2 s | Every locale file has the same keys as the largest one | content |
| `i18n-placeholders` | fast | tiny | 2 s | Every translation uses the same {name} or %s placeholders as the reference | content |
| `indent-consistency` | fast | tiny | 2 s | No file mixes tab and space indentation | quality |
| `js-await-in-loop` | fast | tiny | 2 s | No for or while loop awaits each step in turn | lang |
| `js-eqeqeq` | fast | tiny | 2 s | JavaScript and TypeScript compare with === and !== (null checks aside) | lang |
| `js-prototype-pollution` | fast | tiny | 2 s | No assignment can reach Object.prototype through __proto__ or a request key | lang |
| `js-unhandled-promise` | fast | tiny | 2 s | No promise chain starts with .then and leaves its rejection unhandled | lang |
| `js-var-usage` | fast | tiny | 2 s | No modern JavaScript or TypeScript declares a variable with var | lang |
| `json-duplicate-keys` | fast | tiny | 2 s | No JSON object repeats a key | content |
| `json-valid` | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-commits` | fast | tiny | 3 s | No recent commit touches more files than the budget allows | git |
| `large-files` | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `large-json-or-data` | fast | tiny | 2 s | No tracked JSON, CSV or SQL file is over the size budget (content.maxDataKb, default 512 KB) | content |
| `line-length` | fast | tiny | 2 s | No source line is over the length limit (default 200 characters) | quality |
| `links` | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `liquid-hygiene` | fast | tiny | 2 s | Liquid: blocks are closed, render not include, images have alt, scripts defer or async | engines |
| `local-links` | fast | tiny | 5 s | Links between documents and files (lychee, offline) *(needs: lychee)* | docs |
| `lockfile-in-sync` | fast | tiny | 2 s | package-lock.json and package.json name the same direct dependencies | health |
| `lockfile-sync` | fast | tiny | 2 s | The lockfiles list every dependency that package.json and Cargo.toml declare | repo |
| `lockfiles` | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `long-lived-branches` | fast | tiny | 3 s | Remote branches with no commit for months are listed (fails only when enforced) | git |
| `long-paths` | fast | tiny | 2 s | No tracked path is too long for Windows tools (default limit 200 characters) | repo |
| `makefile-tabs` | fast | tiny | 2 s | Makefile recipes start with a tab and the common targets are .PHONY | quality |
| `markdown-anchors` | fast | tiny | 2 s | Same-page #anchor links in Markdown match a heading or an anchor | content |
| `markdown-code-fences` | fast | tiny | 2 s | Markdown code fences are closed and name their language | content |
| `markdown-headings` | fast | tiny | 2 s | Markdown headings nest one level at a time, with one H1 and no trailing punctuation | content |
| `markdownlint` | fast | tiny | 5 s | Markdown: well-formed documents *(needs: markdownlint-cli2)* | docs |
| `markers` | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `maven-compile` | fast | medium | 1.0 min | Maven: the Java code compiles *(needs: mvn)* | java |
| `maven-test` | fast | medium | 1.5 min | Maven: the test suite *(needs: mvn)* | java |
| `maven-validate` | fast | tiny | 10 s | Maven: the project file (pom.xml) is valid *(needs: mvn)* | java |
| `merge-commit-noise` | fast | tiny | 3 s | Recent history does not fill up with "Merge branch" commits | git |
| `model-files-in-git` | fast | tiny | 2 s | Large model files are stored with git-lfs, not plain git | data-science |
| `mypy` | fast | light | 30 s | mypy: type errors *(needs: mypy)* | python |
| `node-engines` | fast | tiny | 2 s | package.json declares engines.node, and .nvmrc is not below it | config |
| `node-version-mismatch` | fast | tiny | 2 s | The Node major in .nvmrc, engines, Dockerfiles and workflows agree | health |
| `non-ascii-filenames` | fast | tiny | 2 s | File names use plain ASCII characters only | repo |
| `notebook-absolute-paths` | fast | tiny | 2 s | Notebooks use no absolute paths from one machine | data-science |
| `notebook-outputs-stripped` | fast | tiny | 2 s | Committed notebooks have no outputs, run counts or big embedded images | data-science |
| `notebook-pip-magics` | fast | tiny | 2 s | Notebook pip installs name exact versions | data-science |
| `notebook-size` | fast | tiny | 2 s | No notebook is over the size budget | data-science |
| `notebook-valid-json` | fast | tiny | 2 s | Notebooks are valid JSON with the fields Jupyter needs | data-science |
| `npm-entry-exist` | fast | tiny | 2 s | Every npm entry point (main, module, types, bin, exports) exists | packaging |
| `npm-pack-junk` | fast | tiny | 2 s | No publishable npm package would ship tests, fixtures or env files | packaging |
| `npm-publish-files` | fast | tiny | 2 s | A publishable npm package says what to ship (files field or .npmignore) | packaging |
| `openapi-operation-ids` | fast | tiny | 2 s | No two OpenAPI operations share the same operationId | api |
| `openapi-security-defined` | fast | tiny | 2 s | Every security scheme an API uses is defined, and public HTTPS APIs declare security | api |
| `openapi-valid` | fast | tiny | 2 s | OpenAPI and Swagger files have a version, info title and version, paths, and responses on every operation | api |
| `package-fields` | fast | tiny | 2 s | package.json has its name, version, license and entry points that exist | repo |
| `pagination-bounds` | fast | tiny | 2 s | Request-supplied page sizes have an upper bound (listed unless required) | api |
| `phpstan` | fast | medium | 30 s | PHPStan: bugs and undefined code (also reports PHP syntax errors) *(needs: phpstan)* | php |
| `pickle-load` | fast | tiny | 2 s | Pickle loads read a fixed path or use weights_only | data-science |
| `pre-commit-config` | fast | tiny | 2 s | pre-commit hook repositories are pinned to a release and fetched over https | ci-systems |
| `prettier` | fast | tiny | 10 s | Prettier: code is formatted *(needs: prettier)* | node |
| `provenance-hints` | fast | tiny | 2 s | npm release workflows ask for provenance (reported unless required) | packaging |
| `py-assert-in-prod` | fast | tiny | 2 s | Python does not check input with assert outside tests | lang |
| `py-bare-except` | fast | tiny | 2 s | Python except clauses name the exception they catch | lang |
| `py-mutable-default` | fast | tiny | 2 s | No Python default argument is a shared mutable object | lang |
| `pypi-entry-points` | fast | tiny | 2 s | Every PyPI script or entry point names a module that exists | packaging |
| `pypi-metadata` | fast | tiny | 2 s | A PyPI pyproject has name, version, description, readme, license, requires-python and classifiers | packaging |
| `pytest` | fast | medium | 1.0 min | pytest: the test suite *(needs: pytest)* | python |
| `random-seed-missing` | fast | tiny | 2 s | Scripts that train with random numbers set a seed | data-science |
| `rate-limit-present` | fast | tiny | 2 s | A project that starts an HTTP server mentions a rate-limit library or middleware | api |
| `readme-install-usage` | fast | tiny | 2 s | README is over 200 characters and has install and usage sections | content |
| `readme-sections` | fast | tiny | 2 s | README has a title, a how-to-run heading and a licence mention | repo |
| `requirements-pinned-ml` | fast | tiny | 2 s | ML packages in requirements or pyproject have exact versions | data-science |
| `reserved-names` | fast | tiny | 2 s | No file or folder uses a name Windows cannot use (CON, AUX, NUL, COM1, and similar) | repo |
| `root-private` | fast | tiny | 2 s | A monorepo root package.json is marked private | packaging |
| `rspec` | fast | medium | 30 s | RSpec: the test suite *(needs: rspec)* | ruby |
| `rubocop` | fast | light | 15 s | RuboCop: Ruby style and common bugs *(needs: rubocop)* | ruby |
| `ruff` | fast | tiny | 3 s | Ruff: lint and import order *(needs: ruff)* | python |
| `rust-clippy` | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `rust-todo-macros` | fast | tiny | 2 s | Rust has no todo! or unimplemented! outside tests | lang |
| `rust-unwrap-overuse` | fast | tiny | 2 s | Rust unwrap() and expect() outside tests stay within the budget (lang.maxUnwrap) | lang |
| `scripts-resolve` | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
| `semver-valid` | fast | tiny | 2 s | Package, Rust and Python versions are valid version numbers | quality |
| `shell-hygiene` | fast | tiny | 2 s | Shell scripts have a shebang, stop on errors and use LF line endings | quality |
| `shopify-theme-basics` | fast | tiny | 2 s | Shopify theme: settings schema valid, templates and assets resolve, no store URL next to a token | engines |
| `signed-commits-info` | fast | tiny | 3 s | Share of recent commits that are signed (fails only when enforced) | git |
| `skipped-tests` | fast | tiny | 2 s | No test is skipped or disabled | quality |
| `spell-common-typos` | fast | tiny | 2 s | No very common misspelling in the docs or comments | content |
| `sql-destructive-migrations` | fast | tiny | 2 s | SQL migrations do not drop, truncate or mass-delete without a meerkat-allow note | api |
| `sql-migrations-order` | fast | tiny | 2 s | SQL migration numbers are unique and have no gaps | api |
| `sql-missing-index-note` | fast | tiny | 2 s | Foreign-key style *_id columns have an index or constraint in the same file (listed unless required) | api |
| `static-site-generator` | fast | tiny | 2 s | Static site: https site URL, no published drafts (a 404 page is noted) | engines |
| `swift-build` | fast | medium | 1.0 min | Swift: the package builds *(needs: swift)* | swift |
| `swiftlint` | fast | tiny | 10 s | SwiftLint: Swift style and safety *(needs: swiftlint)* | swift |
| `tags-semver` | fast | tiny | 3 s | Version-like tags are vX.Y.Z | git |
| `terraform-fmt` | fast | tiny | 5 s | Terraform: formatting (terraform fmt) *(needs: terraform)* | terraform |
| `test-presence` | fast | tiny | 2 s | The source has tests, and large folders of source have a test file | quality |
| `test-quality-static` | fast | tiny | 3 s | Test quality, read from the files: no assertions, always-true assertions, swallowed errors, sleeps, skipped tests | mutation |
| `todo-hygiene` | fast | tiny | 2 s | TODO, FIXME, HACK and XXX comments name an owner or an issue (when enforced) | quality |
| `toml-valid` | fast | tiny | 2 s | Tracked TOML files read as valid (no unclosed strings, repeated keys or bad table headers) | config |
| `trailing-whitespace` | fast | tiny | 2 s | No line ends with stray spaces or tabs | quality |
| `ts-any-overuse` | fast | tiny | 2 s | TypeScript uses of any stay within the budget (lang.maxAny) | lang |
| `ts-ignore-comments` | fast | tiny | 2 s | Every @ts-ignore and @ts-nocheck says why | lang |
| `tsc` | fast | light | 15 s | TypeScript: no type errors *(needs: tsc)* | node |
| `tsconfig-strict` | fast | tiny | 2 s | A TypeScript project has a tsconfig.json with strict turned on | config |
| `typos` | fast | tiny | 3 s | Typos in code and documents *(needs: typos)* | docs |
| `unicode-control-chars` | fast | tiny | 2 s | No bidirectional override or invisible zero-width character in tracked text | content |
| `unity-gitignore` | fast | tiny | 2 s | Unity: Library, Temp, Logs, obj and UserSettings are ignored and not tracked | engines |
| `unity-large-assets` | fast | tiny | 2 s | Unity: textures, audio and models over the size budget are in Git LFS | engines |
| `unity-meta-files` | fast | tiny | 2 s | Unity: every asset has a .meta file, every .meta has an asset, no GUID repeats | engines |
| `unity-script-hazards` | fast | tiny | 2 s | Unity: Update() does not call Find, GetComponent, Resources.Load or Debug.Log | engines |
| `unity-serialization` | fast | tiny | 2 s | Unity: assets are saved as text (Force Text), not binary | engines |
| `unreal-hygiene` | fast | tiny | 2 s | Unreal: .uproject is valid, generated folders are ignored, assets and plugin versions are in order | engines |
| `unused-dependencies-quick` | fast | tiny | 2 s | Every listed dependency is mentioned by some tracked source or script | health |
| `version-sync` | fast | tiny | 2 s | package.json, Cargo.toml, pyproject and pubspec in one folder agree on the version | packaging |
| `version-tag-match` | fast | tiny | 3 s | The package.json version matches the latest tag | git |
| `whitespace` | fast | tiny | 2 s | No byte-order marks or mixed line endings | hygiene |
| `wildcard-versions` | fast | tiny | 2 s | Dependencies name a version, not *, latest, empty or a git or URL spec | health |
| `wordpress-config` | fast | tiny | 2 s | WordPress: wp-config.php holds no committed credentials, live salts or WP_DEBUG | engines |
| `wordpress-hygiene` | fast | tiny | 2 s | WordPress: ABSPATH guard, sanitised input, no eval or base64_decode, prepared queries | engines |
| `workspace-cycles` | fast | tiny | 2 s | No circular dependencies between workspaces | packaging |
| `workspace-internal-ranges` | fast | tiny | 2 s | A workspace depending on a sibling uses a range that includes the sibling version | packaging |
| `workspace-name-unique` | fast | tiny | 2 s | No two workspaces share a package name | packaging |
| `workspace-version-alignment` | fast | tiny | 2 s | A dependency shared by several workspaces uses one version range (reported unless required) | packaging |
| `workspaces-resolve` | fast | tiny | 2 s | Every workspace pattern matches a folder with a package.json | packaging |
| `yaml-valid` | fast | tiny | 2 s | Tracked YAML files read as valid (no tab indentation, repeated top-level keys or unclosed quotes) | config |
| `yamllint` | fast | tiny | 3 s | YAML files (yamllint) *(needs: yamllint)* | infra |
| `clean-copy-builds` | thorough | alone | 3.0 min | A clean copy of the tracked files installs, builds and passes its tests *(opt-in: `--include runtime`)* | functionality-run |
| `env-example-boot` | thorough | heavy | 1.0 min | The app starts with the variables .env.example lists (no undocumented variable) *(opt-in: `--include runtime`)* | functionality-run |
| `flaky-tests` | thorough | alone | 3.0 min | The tests give the same result every time they run *(opt-in: `--include runtime`)* | functionality-run |
| `install-reproducible` | thorough | heavy | 1.0 min | The frozen install works and the lockfile matches the manifest *(opt-in: `--include runtime`)* | functionality-run |
| `mutation-testing` | thorough | alone | 5.0 min | Mutation testing: the tests notice when the code is changed (works on a temporary copy) *(opt-in: `--include mutation`)* | mutation |
| `readme-commands-work` | thorough | heavy | 1.5 min | The shell commands the README tells people to run work (allowlisted commands only) *(opt-in: `--include runtime`)* | functionality-run |
| `rust-build-release` | thorough | heavy | 5.0 min | Rust release build (cargo build --release) | rust |
| `rust-doc` | thorough | heavy | 1.0 min | Rust documentation builds without warnings (cargo doc) | rust |

### UI checks

Pages and styles: accessibility basics and valid markup. 22 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `aria-valid` | fast | tiny | 2 s | ARIA attributes and roles are real, and nothing focusable is hidden from screen readers | a11y |
| `css-contrast` | fast | tiny | 3 s | Text and background colours written together have enough contrast (WCAG 4.5:1) | ui |
| `css-important-overuse` | fast | tiny | 3 s | The number of !important rules stays within the budget (default 20) | web-plus |
| `duplicate-ids` | fast | tiny | 3 s | No id is used twice in one page | web-plus |
| `focus-visible` | fast | tiny | 2 s | No stylesheet removes the keyboard focus outline without putting another indicator in its place | a11y |
| `html-structure` | fast | tiny | 3 s | Pages: one h1, headings in order, unique ids, labelled inputs, keyboard-reachable click handlers | ui |
| `html-valid-basics` | fast | tiny | 3 s | Pages have a doctype, and their common tags nest and close in order | web-plus |
| `htmlhint` | fast | tiny | 5 s | HTML: valid, accessible markup (htmlhint) *(needs: htmlhint)* | web |
| `iframe-title` | fast | tiny | 2 s | Every iframe has a title | a11y |
| `image-alt-quality` | fast | tiny | 2 s | Image descriptions say what the picture shows (not a file name or a bare word like "image") | a11y |
| `image-dimensions` | fast | tiny | 3 s | Every image has a width and height, and large local images load lazily | web-plus |
| `link-text` | fast | tiny | 2 s | Every link has text that says where it goes (no empty or "click here" links) | a11y |
| `manifest-valid` | fast | tiny | 3 s | Web app manifests are valid JSON with a name, icons and a start_url | web-plus |
| `media-captions` | fast | tiny | 2 s | Videos have captions, and autoplaying media is muted or has controls | a11y |
| `meta-seo` | fast | tiny | 3 s | Pages have a title and description of a useful length | ui |
| `reduced-motion` | fast | tiny | 2 s | Animations and transitions have a prefers-reduced-motion option | a11y |
| `robots-sitemap` | fast | tiny | 3 s | A web root with an index.html has a robots.txt or a sitemap.xml | web-plus |
| `stylelint` | fast | tiny | 5 s | CSS: no invalid styles (stylelint) *(needs: stylelint)* | web |
| `table-headers` | fast | tiny | 2 s | Data tables have header cells, and each header is tied to its row or column | a11y |
| `ui-static` | fast | tiny | 2 s | Pages have alt text, a language, a title and a viewport; no empty buttons | hygiene |
| `wh-html` | fast | tiny | 3 s | Page markup avoids session ids in URLs, exposed private IPs, unsafe forms, risky iframes and leftover secrets | web-hardening |
| `zoom-allowed` | fast | tiny | 2 s | The viewport setting allows pinch zoom | a11y |

### Performance checks

Size, start-up, memory, response time, load and build time, against budgets you set. 15 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `dom-query-in-loop` | fast | tiny | 2 s | No document lookup is repeated inside a frontend loop | health |
| `image-weight` | fast | tiny | 3 s | No image is over its size limit (default 500 KB) | ui |
| `json-parse-in-loop` | fast | tiny | 2 s | JSON parse and stringify inside loops stay within their budget | health |
| `large-inline-assets` | fast | tiny | 2 s | No inline data URI is over its size budget (default 20 KB) | health |
| `perf-deps` | fast | tiny | 3 s | Dependency weight: direct count and installed size | performance |
| `perf-memory` | fast | light | 15 s | Memory: idle and peak use of the app and everything it starts | performance |
| `perf-sizes` | fast | tiny | 2 s | Size budgets: bundles and binaries stay under their limits | performance |
| `perf-startup` | fast | light | 15 s | Start-up time: how fast the app is ready (median of several starts) | performance |
| `regex-in-loop` | fast | tiny | 2 s | No RegExp is built inside a loop | health |
| `render-blocking` | fast | tiny | 2 s | Head scripts do not block drawing, and images have a size and load lazily | a11y |
| `sync-fs-in-handlers` | fast | tiny | 2 s | No blocking file or process call inside a server request or event handler | health |
| `unoptimised-images` | fast | tiny | 2 s | No image is over its size budget (default 500 KB), and no bmp or tiff | health |
| `perf-build` | thorough | alone | 2.0 min | Build time: the build stays inside its time budget | performance |
| `perf-endpoints` | thorough | light | 20 s | Response time: p95 of each configured endpoint | performance |
| `perf-load` | thorough | medium | 30 s | Load burst: concurrent requests to a local server, error rate and p95 | performance |

### Refactor checks

Is the code itself in good shape: duplicated code, dead code, files too long, circular imports. 11 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `dead-code` | fast | light | 10 s | Dead code: exported names nothing else uses (JS and TS) | refactor |
| `duplicate-code` | fast | light | 15 s | Duplicated code: blocks copied between files | refactor |
| `file-length` | fast | light | 3 s | Files too long to read in one sitting | refactor |
| `circular-imports` | thorough | light | 20 s | No circular imports (madge) *(needs: madge)* | node |
| `commented-out-code` | thorough | tiny | 5 s | Commented-out code left in the files | refactor |
| `cyclomatic-complexity` | thorough | tiny | 5 s | Functions with too many branches to test | refactor |
| `dead-python` | thorough | light | 10 s | Dead Python code (vulture) *(needs: vulture)* | python |
| `deep-nesting` | thorough | tiny | 5 s | Code nested too many levels deep | refactor |
| `long-functions` | thorough | light | 10 s | Functions too long to read in one sitting | refactor |
| `many-parameters` | thorough | tiny | 5 s | Functions with too many parameters | refactor |
| `unused-files` | thorough | light | 10 s | JavaScript and TypeScript files nothing imports | refactor |
<!-- checks:end -->
