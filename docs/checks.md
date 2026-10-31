# Every check

Generated from the checks themselves by `node tools/gen-checks.mjs`, so it cannot drift from the code. See the [README](../README.md#every-check) for how to read the columns.

<!-- checks:start -->
**85 checks** across 21 packs: 69 quick, 16 thorough, 3 opt-in. [Security 18](#security-checks) · [Functionality 42](#functionality-checks) · [UI 6](#ui-checks) · [Performance 8](#performance-checks) · [Refactor 11](#refactor-checks)

### Security checks

Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review. 18 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `actionlint` | fast | tiny | 3 s | GitHub Actions workflows (actionlint) *(needs: actionlint)* | infra |
| `bandit` | fast | light | 10 s | Bandit: common Python security mistakes *(needs: bandit)* | python |
| `dependency-pinning` | fast | tiny | 3 s | Dependencies name a fixed version, not latest or * | security |
| `hadolint` | fast | tiny | 3 s | Dockerfiles (hadolint) *(needs: hadolint)* | infra |
| `kube-linter` | fast | light | 10 s | Kubernetes manifests: security and best practice (kube-linter) *(needs: kube-linter)* | kubernetes |
| `license` | fast | tiny | 2 s | A license is declared, and no copyleft dependency slipped in | hygiene |
| `lockfile-integrity` | fast | tiny | 3 s | Locked packages are fetched securely and checksummed | security |
| `risky-code` | fast | tiny | 3 s | Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http | security |
| `rust-audit` | fast | light | 4 s | Rust dependency advisories (cargo audit) | rust |
| `rust-deny` | fast | light | 10 s | Rust dependency policy: licenses, banned crates, sources (cargo deny) *(opt-in: `--include deny`)* *(needs: cargo-deny)* | rust |
| `secret-scan` | fast | tiny | 3 s | Secret scan: keys, tokens and private keys in tracked files | security |
| `sensitive-files` | fast | tiny | 2 s | No environment files, private keys or tokens are tracked | hygiene |
| `shellcheck` | fast | tiny | 3 s | Shell scripts (shellcheck) *(needs: shellcheck)* | infra |
| `unsafe-rust` | fast | tiny | 2 s | Every Rust unsafe block says why it is sound | hygiene |
| `workflow-security` | fast | tiny | 3 s | GitHub Actions: pinned actions, limited permissions, no script injection | security |
| `ai-diff-review` | thorough | light | 1.0 min | AI security review of the changes against the base branch *(opt-in: `--include ai`)* | ai |
| `ai-route-audit` | thorough | light | 5.0 min | AI audit of every route, handler and IPC channel *(opt-in: `--include ai`)* | ai |
| `npm-audit-all` | thorough | tiny | 5 s | npm audit, high severity, every dependency including dev ones | security |

### Functionality checks

Does it build, type-check, lint and pass its tests; is the repository in order. 42 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `broken-imports` | fast | tiny | 2 s | Every relative import points at a file that exists | hygiene |
| `composer-validate` | fast | tiny | 5 s | Composer: composer.json is valid (strict) *(needs: composer)* | php |
| `conflict-markers` | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `dart-analyze` | fast | light | 20 s | Dart: analyzer (errors, warnings and lints) *(needs: dart)* | dart |
| `dart-format` | fast | tiny | 5 s | Dart: code formatting (dart format) *(needs: dart)* | dart |
| `dotnet-build` | fast | medium | 30 s | .NET: the build, with warnings treated as errors *(needs: dotnet)* | dotnet |
| `dotnet-format` | fast | light | 20 s | .NET: code formatting (dotnet format) *(needs: dotnet)* | dotnet |
| `env-example` | fast | tiny | 2 s | Every environment variable the code reads is documented | hygiene |
| `eslint` | fast | light | 20 s | ESLint: the project's own lint rules *(needs: eslint)* | node |
| `go-test` | fast | medium | 1.0 min | go test: the test suite *(needs: go)* | go |
| `go-vet` | fast | light | 15 s | go vet: suspicious constructs *(needs: go)* | go |
| `helm-lint` | fast | tiny | 5 s | Helm chart: lint *(needs: helm)* | kubernetes |
| `json-valid` | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-files` | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `links` | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `local-links` | fast | tiny | 5 s | Links between documents and files (lychee, offline) *(needs: lychee)* | docs |
| `lockfiles` | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `markdownlint` | fast | tiny | 5 s | Markdown: well-formed documents *(needs: markdownlint-cli2)* | docs |
| `markers` | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `maven-compile` | fast | medium | 1.0 min | Maven: the Java code compiles *(needs: mvn)* | java |
| `maven-test` | fast | medium | 1.5 min | Maven: the test suite *(needs: mvn)* | java |
| `maven-validate` | fast | tiny | 10 s | Maven: the project file (pom.xml) is valid *(needs: mvn)* | java |
| `mypy` | fast | light | 30 s | mypy: type errors *(needs: mypy)* | python |
| `phpstan` | fast | medium | 30 s | PHPStan: bugs and undefined code (also reports PHP syntax errors) *(needs: phpstan)* | php |
| `prettier` | fast | tiny | 10 s | Prettier: code is formatted *(needs: prettier)* | node |
| `pytest` | fast | medium | 1.0 min | pytest: the test suite *(needs: pytest)* | python |
| `rspec` | fast | medium | 30 s | RSpec: the test suite *(needs: rspec)* | ruby |
| `rubocop` | fast | light | 15 s | RuboCop: Ruby style and common bugs *(needs: rubocop)* | ruby |
| `ruff` | fast | tiny | 3 s | Ruff: lint and import order *(needs: ruff)* | python |
| `rust-clippy` | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `scripts-resolve` | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
| `swift-build` | fast | medium | 1.0 min | Swift: the package builds *(needs: swift)* | swift |
| `swiftlint` | fast | tiny | 10 s | SwiftLint: Swift style and safety *(needs: swiftlint)* | swift |
| `terraform-fmt` | fast | tiny | 5 s | Terraform: formatting (terraform fmt) *(needs: terraform)* | terraform |
| `tsc` | fast | light | 15 s | TypeScript: no type errors *(needs: tsc)* | node |
| `typos` | fast | tiny | 3 s | Typos in code and documents *(needs: typos)* | docs |
| `whitespace` | fast | tiny | 2 s | No byte-order marks or mixed line endings | hygiene |
| `yamllint` | fast | tiny | 3 s | YAML files (yamllint) *(needs: yamllint)* | infra |
| `rust-build-release` | thorough | heavy | 5.0 min | Rust release build (cargo build --release) | rust |
| `rust-doc` | thorough | heavy | 1.0 min | Rust documentation builds without warnings (cargo doc) | rust |

### UI checks

Pages and styles: accessibility basics and valid markup. 6 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `css-contrast` | fast | tiny | 3 s | Text and background colours written together have enough contrast (WCAG 4.5:1) | ui |
| `html-structure` | fast | tiny | 3 s | Pages: one h1, headings in order, unique ids, labelled inputs, keyboard-reachable click handlers | ui |
| `htmlhint` | fast | tiny | 5 s | HTML: valid, accessible markup (htmlhint) *(needs: htmlhint)* | web |
| `meta-seo` | fast | tiny | 3 s | Pages have a title and description of a useful length | ui |
| `stylelint` | fast | tiny | 5 s | CSS: no invalid styles (stylelint) *(needs: stylelint)* | web |
| `ui-static` | fast | tiny | 2 s | Pages have alt text, a language, a title and a viewport; no empty buttons | hygiene |

### Performance checks

Size, start-up, memory, response time, load and build time, against budgets you set. 8 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `image-weight` | fast | tiny | 3 s | No image is over its size limit (default 500 KB) | ui |
| `perf-deps` | fast | tiny | 3 s | Dependency weight: direct count and installed size | performance |
| `perf-memory` | fast | light | 15 s | Memory: idle and peak use of the app and everything it starts | performance |
| `perf-sizes` | fast | tiny | 2 s | Size budgets: bundles and binaries stay under their limits | performance |
| `perf-startup` | fast | light | 15 s | Start-up time: how fast the app is ready (median of several starts) | performance |
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
