# Every check

Generated from the checks themselves by `node tools/gen-checks.mjs`, so it cannot drift from the code. See the [README](../README.md#every-check) for how to read the columns.

<!-- checks:start -->
**151 checks** across 25 packs: 134 quick, 17 thorough, 3 opt-in. [Security 45](#security-checks) · [Functionality 71](#functionality-checks) · [UI 15](#ui-checks) · [Performance 9](#performance-checks) · [Refactor 11](#refactor-checks)

### Security checks

Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review. 45 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `actionlint` | fast | tiny | 3 s | GitHub Actions workflows (actionlint) *(needs: actionlint)* | infra |
| `actions-secrets-echo` | fast | tiny | 3 s | GitHub Actions: no secrets printed or leaked, no broad permissions | security-plus |
| `bandit` | fast | light | 10 s | Bandit: common Python security mistakes *(needs: bandit)* | python |
| `cookie-flags` | fast | tiny | 2 s | Cookies are set with HttpOnly, Secure and SameSite | security-plus |
| `cors-wildcard` | fast | tiny | 2 s | CORS: no site may read responses with credentials, and Origin is not copied back unchecked | security-plus |
| `credentials-in-urls` | fast | tiny | 2 s | No user name and password written into a web address | security-plus |
| `debug-enabled` | fast | tiny | 2 s | Debug mode is not switched on where it should be off | security-plus |
| `dependency-pinning` | fast | tiny | 3 s | Dependencies name a fixed version, not latest or * | security |
| `dependency-updates-configured` | fast | tiny | 2 s | A dependency update bot (Dependabot or Renovate) is configured | repo |
| `deprecated-deps` | fast | tiny | 2 s | No locked dependency is marked deprecated by its author | repo |
| `docker-base-pinning` | fast | tiny | 3 s | Docker: base images pinned, no download piped into a shell, a non-root user | security-plus |
| `env-files-in-history` | fast | tiny | 10 s | Git history: key and environment files that were ever committed | security-plus |
| `hadolint` | fast | tiny | 3 s | Dockerfiles (hadolint) *(needs: hadolint)* | infra |
| `hardcoded-ip` | fast | tiny | 2 s | No public IP address written into the code | security-plus |
| `install-scripts` | fast | tiny | 3 s | Code that runs on install: the project scripts and dependency install scripts | security-plus |
| `jwt-weak` | fast | tiny | 2 s | JWTs: no "none" algorithm, no decode used as a sign-in check, no secret typed into the code | security-plus |
| `kube-linter` | fast | light | 10 s | Kubernetes manifests: security and best practice (kube-linter) *(needs: kube-linter)* | kubernetes |
| `license` | fast | tiny | 2 s | A license is declared, and no copyleft dependency slipped in | hygiene |
| `license-matches` | fast | tiny | 2 s | The LICENSE file agrees with the licence declared in package.json or Cargo.toml | repo |
| `lockfile-integrity` | fast | tiny | 3 s | Locked packages are fetched securely and checksummed | security |
| `lockfile-registry-hosts` | fast | tiny | 3 s | Lockfiles: every package comes from the registry the project chose | security-plus |
| `mixed-content` | fast | tiny | 2 s | Nothing is loaded over plain http on a page that is otherwise https | a11y |
| `open-redirect-pattern` | fast | tiny | 2 s | Redirects do not go to a request address without an allow-list check | security-plus |
| `path-traversal-pattern` | fast | tiny | 2 s | Files are not read or sent with a path taken straight from the request | security-plus |
| `regex-dos` | fast | tiny | 2 s | No regular expression that can take exponential time | security-plus |
| `requirements-hashes` | fast | tiny | 3 s | Installs pinned to a version or hash, and not fetched over plain http | security-plus |
| `risky-code` | fast | tiny | 3 s | Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http | security |
| `rust-audit` | fast | light | 4 s | Rust dependency advisories (cargo audit) | rust |
| `rust-deny` | fast | light | 10 s | Rust dependency policy: licenses, banned crates, sources (cargo deny) *(opt-in: `--include deny`)* *(needs: cargo-deny)* | rust |
| `secret-scan` | fast | tiny | 3 s | Secret scan: keys, tokens and private keys in tracked files | security |
| `security-policy` | fast | tiny | 2 s | SECURITY.md says how to report a security problem | repo |
| `sensitive-files` | fast | tiny | 2 s | No environment files, private keys or tokens are tracked | hygiene |
| `shellcheck` | fast | tiny | 3 s | Shell scripts (shellcheck) *(needs: shellcheck)* | infra |
| `sql-concat` | fast | tiny | 2 s | SQL is not built by joining text and values together | security-plus |
| `sri-missing` | fast | tiny | 2 s | Scripts and stylesheets loaded from another site have an integrity hash | a11y |
| `symlinks-tracked` | fast | tiny | 2 s | No symbolic links are committed (they break on Windows checkouts) | repo |
| `typosquat-names` | fast | tiny | 3 s | Dependency names that look like a misspelt popular package | security-plus |
| `unsafe-rust` | fast | tiny | 2 s | Every Rust unsafe block says why it is sound | hygiene |
| `weak-crypto-modes` | fast | tiny | 2 s | No weak cipher, ECB mode, fixed key, guessable token or MD5 password | security-plus |
| `workflow-security` | fast | tiny | 3 s | GitHub Actions: pinned actions, limited permissions, no script injection | security |
| `xxe-and-deserialize` | fast | tiny | 2 s | XML parsers are locked down and untrusted data is not deserialized | security-plus |
| `ai-diff-review` | thorough | light | 1.0 min | AI security review of the changes against the base branch *(opt-in: `--include ai`)* | ai |
| `ai-route-audit` | thorough | light | 5.0 min | AI audit of every route, handler and IPC channel *(opt-in: `--include ai`)* | ai |
| `git-history-secrets` | thorough | light | 10 s | Git history: secrets ever committed, even if removed since | security-plus |
| `npm-audit-all` | thorough | tiny | 5 s | npm audit, high severity, every dependency including dev ones | security |

### Functionality checks

Does it build, type-check, lint and pass its tests; is the repository in order. 71 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `broken-imports` | fast | tiny | 2 s | Every relative import points at a file that exists | hygiene |
| `case-conflicts` | fast | tiny | 2 s | No two file names differ only by upper and lower case (they clash on Windows and macOS) | repo |
| `changelog-format` | fast | tiny | 2 s | CHANGELOG.md has version headings, newest first | repo |
| `ci-present` | fast | tiny | 2 s | An automated check config (CI) exists | repo |
| `codeowners-valid` | fast | tiny | 2 s | CODEOWNERS: every pattern has a real owner, and no pattern is listed twice | repo |
| `composer-validate` | fast | tiny | 5 s | Composer: composer.json is valid (strict) *(needs: composer)* | php |
| `conflict-markers` | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `contributing-file` | fast | tiny | 2 s | CONTRIBUTING.md exists once a project has a README and several source files | repo |
| `dart-analyze` | fast | light | 20 s | Dart: analyzer (errors, warnings and lints) *(needs: dart)* | dart |
| `dart-format` | fast | tiny | 5 s | Dart: code formatting (dart format) *(needs: dart)* | dart |
| `debug-leftovers` | fast | tiny | 2 s | No debugger statements, console.log, debug prints, dbg! or todo! left in | quality |
| `dotnet-build` | fast | medium | 30 s | .NET: the build, with warnings treated as errors *(needs: dotnet)* | dotnet |
| `dotnet-format` | fast | light | 20 s | .NET: code formatting (dotnet format) *(needs: dotnet)* | dotnet |
| `duplicate-test-names` | fast | tiny | 2 s | No two tests in one file share the same name | quality |
| `editorconfig-present` | fast | tiny | 2 s | .editorconfig exists once a project has several source files | repo |
| `empty-catch` | fast | tiny | 2 s | No error handler is empty and swallows the error | quality |
| `env-example` | fast | tiny | 2 s | Every environment variable the code reads is documented | hygiene |
| `eslint` | fast | light | 20 s | ESLint: the project's own lint rules *(needs: eslint)* | node |
| `exec-bits` | fast | tiny | 2 s | Executable bits match the files: scripts with a #! line are executable, and executables have one | repo |
| `final-newline` | fast | tiny | 2 s | Every text file ends with exactly one newline | quality |
| `focused-tests` | fast | tiny | 2 s | No test is left focused, which silently skips the rest | quality |
| `generated-files-tracked` | fast | tiny | 2 s | No build or dependency output (node_modules, dist, build, target and similar) is committed to git | repo |
| `gitignore-essentials` | fast | tiny | 2 s | .gitignore covers dependencies, secrets and OS junk, and nothing it ignores is committed | repo |
| `go-test` | fast | medium | 1.0 min | go test: the test suite *(needs: go)* | go |
| `go-vet` | fast | light | 15 s | go vet: suspicious constructs *(needs: go)* | go |
| `helm-lint` | fast | tiny | 5 s | Helm chart: lint *(needs: helm)* | kubernetes |
| `indent-consistency` | fast | tiny | 2 s | No file mixes tab and space indentation | quality |
| `json-valid` | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-files` | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `line-length` | fast | tiny | 2 s | No source line is over the length limit (default 200 characters) | quality |
| `links` | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `local-links` | fast | tiny | 5 s | Links between documents and files (lychee, offline) *(needs: lychee)* | docs |
| `lockfile-sync` | fast | tiny | 2 s | The lockfiles list every dependency that package.json and Cargo.toml declare | repo |
| `lockfiles` | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `long-paths` | fast | tiny | 2 s | No tracked path is too long for Windows tools (default limit 200 characters) | repo |
| `makefile-tabs` | fast | tiny | 2 s | Makefile recipes start with a tab and the common targets are .PHONY | quality |
| `markdownlint` | fast | tiny | 5 s | Markdown: well-formed documents *(needs: markdownlint-cli2)* | docs |
| `markers` | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `maven-compile` | fast | medium | 1.0 min | Maven: the Java code compiles *(needs: mvn)* | java |
| `maven-test` | fast | medium | 1.5 min | Maven: the test suite *(needs: mvn)* | java |
| `maven-validate` | fast | tiny | 10 s | Maven: the project file (pom.xml) is valid *(needs: mvn)* | java |
| `mypy` | fast | light | 30 s | mypy: type errors *(needs: mypy)* | python |
| `non-ascii-filenames` | fast | tiny | 2 s | File names use plain ASCII characters only | repo |
| `package-fields` | fast | tiny | 2 s | package.json has its name, version, license and entry points that exist | repo |
| `phpstan` | fast | medium | 30 s | PHPStan: bugs and undefined code (also reports PHP syntax errors) *(needs: phpstan)* | php |
| `prettier` | fast | tiny | 10 s | Prettier: code is formatted *(needs: prettier)* | node |
| `pytest` | fast | medium | 1.0 min | pytest: the test suite *(needs: pytest)* | python |
| `readme-sections` | fast | tiny | 2 s | README has a title, a how-to-run heading and a licence mention | repo |
| `reserved-names` | fast | tiny | 2 s | No file or folder uses a name Windows cannot use (CON, AUX, NUL, COM1, and similar) | repo |
| `rspec` | fast | medium | 30 s | RSpec: the test suite *(needs: rspec)* | ruby |
| `rubocop` | fast | light | 15 s | RuboCop: Ruby style and common bugs *(needs: rubocop)* | ruby |
| `ruff` | fast | tiny | 3 s | Ruff: lint and import order *(needs: ruff)* | python |
| `rust-clippy` | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `scripts-resolve` | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
| `semver-valid` | fast | tiny | 2 s | Package, Rust and Python versions are valid version numbers | quality |
| `shell-hygiene` | fast | tiny | 2 s | Shell scripts have a shebang, stop on errors and use LF line endings | quality |
| `skipped-tests` | fast | tiny | 2 s | No test is skipped or disabled | quality |
| `swift-build` | fast | medium | 1.0 min | Swift: the package builds *(needs: swift)* | swift |
| `swiftlint` | fast | tiny | 10 s | SwiftLint: Swift style and safety *(needs: swiftlint)* | swift |
| `terraform-fmt` | fast | tiny | 5 s | Terraform: formatting (terraform fmt) *(needs: terraform)* | terraform |
| `test-presence` | fast | tiny | 2 s | The source has tests, and large folders of source have a test file | quality |
| `todo-hygiene` | fast | tiny | 2 s | TODO, FIXME, HACK and XXX comments name an owner or an issue (when enforced) | quality |
| `trailing-whitespace` | fast | tiny | 2 s | No line ends with stray spaces or tabs | quality |
| `tsc` | fast | light | 15 s | TypeScript: no type errors *(needs: tsc)* | node |
| `typos` | fast | tiny | 3 s | Typos in code and documents *(needs: typos)* | docs |
| `whitespace` | fast | tiny | 2 s | No byte-order marks or mixed line endings | hygiene |
| `yamllint` | fast | tiny | 3 s | YAML files (yamllint) *(needs: yamllint)* | infra |
| `rust-build-release` | thorough | heavy | 5.0 min | Rust release build (cargo build --release) | rust |
| `rust-doc` | thorough | heavy | 1.0 min | Rust documentation builds without warnings (cargo doc) | rust |

### UI checks

Pages and styles: accessibility basics and valid markup. 15 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `aria-valid` | fast | tiny | 2 s | ARIA attributes and roles are real, and nothing focusable is hidden from screen readers | a11y |
| `css-contrast` | fast | tiny | 3 s | Text and background colours written together have enough contrast (WCAG 4.5:1) | ui |
| `focus-visible` | fast | tiny | 2 s | No stylesheet removes the keyboard focus outline without putting another indicator in its place | a11y |
| `html-structure` | fast | tiny | 3 s | Pages: one h1, headings in order, unique ids, labelled inputs, keyboard-reachable click handlers | ui |
| `htmlhint` | fast | tiny | 5 s | HTML: valid, accessible markup (htmlhint) *(needs: htmlhint)* | web |
| `iframe-title` | fast | tiny | 2 s | Every iframe has a title | a11y |
| `image-alt-quality` | fast | tiny | 2 s | Image descriptions say what the picture shows (not a file name or a bare word like "image") | a11y |
| `link-text` | fast | tiny | 2 s | Every link has text that says where it goes (no empty or "click here" links) | a11y |
| `media-captions` | fast | tiny | 2 s | Videos have captions, and autoplaying media is muted or has controls | a11y |
| `meta-seo` | fast | tiny | 3 s | Pages have a title and description of a useful length | ui |
| `reduced-motion` | fast | tiny | 2 s | Animations and transitions have a prefers-reduced-motion option | a11y |
| `stylelint` | fast | tiny | 5 s | CSS: no invalid styles (stylelint) *(needs: stylelint)* | web |
| `table-headers` | fast | tiny | 2 s | Data tables have header cells, and each header is tied to its row or column | a11y |
| `ui-static` | fast | tiny | 2 s | Pages have alt text, a language, a title and a viewport; no empty buttons | hygiene |
| `zoom-allowed` | fast | tiny | 2 s | The viewport setting allows pinch zoom | a11y |

### Performance checks

Size, start-up, memory, response time, load and build time, against budgets you set. 9 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `image-weight` | fast | tiny | 3 s | No image is over its size limit (default 500 KB) | ui |
| `perf-deps` | fast | tiny | 3 s | Dependency weight: direct count and installed size | performance |
| `perf-memory` | fast | light | 15 s | Memory: idle and peak use of the app and everything it starts | performance |
| `perf-sizes` | fast | tiny | 2 s | Size budgets: bundles and binaries stay under their limits | performance |
| `perf-startup` | fast | light | 15 s | Start-up time: how fast the app is ready (median of several starts) | performance |
| `render-blocking` | fast | tiny | 2 s | Head scripts do not block drawing, and images have a size and load lazily | a11y |
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
