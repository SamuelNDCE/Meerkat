# Every check

Generated from the checks themselves by `node tools/gen-checks.mjs`, so it cannot drift from the code. See the [README](../README.md#every-check) for how to read the columns.

<!-- checks:start -->
**63 checks** across 13 packs: 50 quick, 13 thorough, 3 opt-in. [Security 17](#security-checks) · [Functionality 27](#functionality-checks) · [UI 6](#ui-checks) · [Performance 8](#performance-checks) · [Refactor 5](#refactor-checks)

### Security checks

Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review. 17 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `actionlint` | fast | tiny | 3 s | GitHub Actions workflows (actionlint) *(needs: actionlint)* | infra |
| `bandit` | fast | light | 10 s | Bandit: common Python security mistakes *(needs: bandit)* | python |
| `dependency-pinning` | fast | tiny | 3 s | Dependencies name a fixed version, not latest or * | security |
| `hadolint` | fast | tiny | 3 s | Dockerfiles (hadolint) *(needs: hadolint)* | infra |
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

Does it build, type-check, lint and pass its tests; is the repository in order. 27 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `broken-imports` | fast | tiny | 2 s | Every relative import points at a file that exists | hygiene |
| `conflict-markers` | fast | tiny | 2 s | No leftover merge-conflict markers | hygiene |
| `env-example` | fast | tiny | 2 s | Every environment variable the code reads is documented | hygiene |
| `eslint` | fast | light | 20 s | ESLint: the project's own lint rules *(needs: eslint)* | node |
| `go-test` | fast | medium | 1.0 min | go test: the test suite *(needs: go)* | go |
| `go-vet` | fast | light | 15 s | go vet: suspicious constructs *(needs: go)* | go |
| `json-valid` | fast | tiny | 2 s | Every tracked JSON file parses | hygiene |
| `large-files` | fast | tiny | 2 s | No oversized file or committed binary | hygiene |
| `links` | fast | tiny | 2 s | Every relative link in the documents resolves | hygiene |
| `local-links` | fast | tiny | 5 s | Links between documents and files (lychee, offline) *(needs: lychee)* | docs |
| `lockfiles` | fast | tiny | 2 s | Every manifest has its lockfile | hygiene |
| `markdownlint` | fast | tiny | 5 s | Markdown: well-formed documents *(needs: markdownlint-cli2)* | docs |
| `markers` | fast | tiny | 2 s | No FIXME or XXX notes left in the code | hygiene |
| `mypy` | fast | light | 30 s | mypy: type errors *(needs: mypy)* | python |
| `prettier` | fast | tiny | 10 s | Prettier: code is formatted *(needs: prettier)* | node |
| `pytest` | fast | medium | 1.0 min | pytest: the test suite *(needs: pytest)* | python |
| `ruff` | fast | tiny | 3 s | Ruff: lint and import order *(needs: ruff)* | python |
| `rust-clippy` | fast | heavy | 2.0 min | Rust lints (cargo clippy, warnings are errors) | rust |
| `rust-fmt` | fast | heavy | 4 s | Rust formatting (cargo fmt --check) | rust |
| `rust-test` | fast | heavy | 2.5 min | Rust tests (cargo test, the whole workspace) | rust |
| `scripts-resolve` | fast | tiny | 2 s | Every file an npm script runs exists | hygiene |
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

Is the code itself in good shape: duplicated code, dead code, files too long, circular imports. 5 checks.

| Check | Tier | Weight | Time | What it does | Pack |
|---|---|---|---|---|---|
| `circular-imports` | thorough | light | 20 s | No circular imports (madge) *(needs: madge)* | node |
| `dead-code` | thorough | light | 10 s | Dead code: exported names nothing else uses (JS and TS) | refactor |
| `dead-python` | thorough | light | 10 s | Dead Python code (vulture) *(needs: vulture)* | python |
| `duplicate-code` | thorough | light | 15 s | Duplicated code: blocks copied between files | refactor |
| `file-length` | thorough | light | 3 s | Files too long to read in one sitting | refactor |
<!-- checks:end -->
