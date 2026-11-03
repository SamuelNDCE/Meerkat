// The detectors pack (opt-in): mature tools run for you when they are installed, their findings kept under their own rule ids.
// knip, htmlhint, size-limit, Lighthouse and (own opt-in: spelling) cspell, osv-scanner (dependency advisories), Semgrep (security-audit rules), cargo clippy (correctness and suspicious lints), tsc --strict.
// Turn it on with `--preset detectors`, or `--include detectors` with the pack enabled. A missing tool is NOT RUN with an install hint; nothing
// is ever installed for you. Each check proves its parser against a recorded sample of the tool's output (tests/fixtures/detectors/).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SCRIPT = `${MK}/thorough/detectors.mjs`
const RUST_TOOLS = `${MK}/thorough/rust-tools.mjs`
const SAMPLES = 'tests/fixtures/detectors'

const check = (id, title, extra) => ({
  id,
  group: 'security',
  tier: 'thorough',
  optIn: 'detectors',
  lane: 'free',
  weight: 'light',
  title,
  estSeconds: 30,
  run: { cmd: 'node', args: [SCRIPT, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [SCRIPT, id, '--sample', `${SAMPLES}/${extra.sample}`], cwd: 'meerkat', expectFail: true, expectMatch: extra.match },
  ...extra.rest,
})

// Four Rust tools (thorough/rust-tools.mjs). udeps and Miri need a nightly Rust, so they are opt-in on their own (--include rust-nightly)
// and only partly reliable: udeps can report false positives and Miri runs the tests under an interpreter, which is slow.
const rustTool = (id, title, extra) => ({
  id,
  group: extra.group,
  tier: 'thorough',
  optIn: extra.optIn ?? 'detectors',
  lane: 'cargo',
  weight: extra.weight ?? 'heavy',
  cost: { cpu: 8, memGB: 4 },
  title,
  estSeconds: extra.estSeconds,
  timeoutSeconds: extra.timeoutSeconds ?? 1800,
  install: extra.install,
  appliesTo: extra.appliesTo ?? ['**/Cargo.toml'],
  run: { cmd: 'node', args: [RUST_TOOLS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [RUST_TOOLS, id, '--sample', `${SAMPLES}/${extra.sample}`], cwd: 'meerkat', expectFail: true, expectMatch: extra.match },
})

const RUST_EXTRA = [
  rustTool('geiger-unsafe', 'Rust unsafe usage counted by cargo-geiger, for the crates of this project (not its dependencies)', { group: 'security', sample: 'geiger.json', match: 'geiger-unsafe-used', install: 'cargo install cargo-geiger --locked (0.14 needs Rust 1.97; on older Rust add --version 0.13.0)', estSeconds: 60 }),
  rustTool('semver-checks-api', 'Rust library API breaks from cargo-semver-checks, compared with the last published version (libraries only; a binary is not applicable)', { group: 'functionality', sample: 'semver.txt', match: 'semver-', install: 'cargo install cargo-semver-checks --locked', estSeconds: 120 }),
  rustTool('udeps-unused', 'PARTIAL: unused Rust dependencies from cargo-udeps (needs a nightly Rust, may report false positives); opt-in with --include rust-nightly', { group: 'functionality', optIn: 'rust-nightly', sample: 'udeps.json', match: 'udeps-unused-dependency', install: 'cargo install cargo-udeps --locked, and rustup toolchain install nightly --profile minimal', estSeconds: 120 }),
  rustTool('miri-ub', 'PARTIAL: undefined behaviour found by running the tests under cargo-miri (needs a nightly Rust, slow); opt-in with --include rust-nightly', { group: 'security', optIn: 'rust-nightly', sample: 'miri.txt', match: 'miri-undefined-behavior', install: 'rustup toolchain install nightly --profile minimal --component miri --component rust-src', estSeconds: 300, timeoutSeconds: 3600 }),
]

export default [
  check('osv-scan', 'Dependency advisories from osv-scanner: each vulnerable package with its OSV id and fixed version', {
    sample: 'osv.json',
    match: 'GHSA-',
    rest: { install: 'go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest (see google.github.io/osv-scanner)', estSeconds: 20, appliesTo: ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/Cargo.lock', '**/go.mod', '**/poetry.lock', '**/requirements*.txt', '**/Gemfile.lock', '**/composer.lock'] },
  }),
  check('semgrep-security', 'Semgrep security-audit rules (needs the network for the rule set, up to 10 minutes)', {
    sample: 'semgrep.json',
    match: 'confidence high',
    rest: { install: 'pip install semgrep', timeoutSeconds: 660, weight: 'medium', estSeconds: 120 },
  }),
  check('clippy-correctness', 'Rust clippy correctness and suspicious lints only (cargo clippy)', {
    sample: 'clippy.jsonl',
    match: 'clippy::',
    rest: { group: 'functionality', lane: 'cargo', weight: 'heavy', cost: { cpu: 8, memGB: 4 }, install: 'rustup component add clippy', estSeconds: 120, timeoutSeconds: 1800, appliesTo: ['**/Cargo.toml'] },
  }),
  check('tsc-strict', 'TypeScript strict mode diagnostics (tsc --noEmit --strict), only when typescript is already in node_modules', {
    sample: 'tsc.txt',
    match: 'TS\\d+',
    rest: { group: 'functionality', install: 'npm i -D typescript', appliesTo: ['tsconfig.json'], estSeconds: 30 },
  }),
  check('gitleaks-secrets', 'Secrets in files and git history from gitleaks (values redacted, never shown)', {
    sample: 'gitleaks.json',
    match: 'aws-access-token|stripe-access-token',
    rest: { install: 'download gitleaks from https://github.com/gitleaks/gitleaks/releases', estSeconds: 20 },
  }),
  check('staticcheck-go', 'Go staticcheck bugs (SA rules only), when go.mod exists', {
    sample: 'staticcheck.jsonl',
    match: 'SA\\d+',
    rest: { group: 'functionality', install: 'go install honnef.co/go/tools/cmd/staticcheck@latest', appliesTo: ['**/go.mod'], estSeconds: 30 },
  }),
  check('govulncheck-go', 'Go vulnerabilities in code you actually call (govulncheck, needs the network), when go.mod exists', {
    sample: 'govulncheck.json',
    match: 'GO-\\d+',
    rest: { install: 'go install golang.org/x/vuln/cmd/govulncheck@latest', appliesTo: ['**/go.mod'], estSeconds: 60 },
  }),
  check('actionlint-workflows', 'GitHub Actions workflow mistakes from actionlint, when .github/workflows exists', {
    sample: 'actionlint.json',
    match: 'expression|shellcheck',
    rest: { install: 'go install github.com/rhysd/actionlint/cmd/actionlint@latest', appliesTo: ['.github/workflows/*'], estSeconds: 10 },
  }),
  check('knip-unused', 'Unused files, exports and dependencies from knip (noisy on code loaded by name at run time: review before acting)', {
    sample: 'knip.json',
    match: 'knip-unused-',
    rest: { group: 'functionality', install: 'npm install --prefix ~/.meerkat-tools/js knip', appliesTo: ['package.json'], estSeconds: 30 },
  }),
  check('htmlhint-html', 'HTML mistakes from htmlhint: missing doctype, duplicate ids, unpaired tags, on tracked .html files', {
    sample: 'htmlhint.json',
    match: 'htmlhint-',
    rest: { group: 'ui', install: 'npm install --prefix ~/.meerkat-tools/js htmlhint', appliesTo: ['**/*.html', '**/*.htm'], estSeconds: 10 },
  }),
  check('size-limit-budget', "Bundle size over the project's own size-limit budget (only when the project already configures size-limit)", {
    sample: 'size-limit.json',
    match: 'size-limit-exceeded',
    rest: { group: 'performance', install: 'npm install --prefix ~/.meerkat-tools/js size-limit @size-limit/file', appliesTo: ['package.json', '.size-limit.*'], estSeconds: 30 },
  }),
  check('lighthouse-page', "Accessibility and best-practice failures from Lighthouse on the project's index.html (served on 127.0.0.1, needs Google Chrome)", {
    sample: 'lighthouse.json',
    match: 'lighthouse-',
    rest: { group: 'ui', install: 'npm install --prefix ~/.meerkat-tools/js lighthouse (and install Google Chrome)', appliesTo: ['index.html', 'dist/index.html', 'build/index.html', 'public/index.html'], timeoutSeconds: 360, weight: 'medium', estSeconds: 40 },
  }),
  // Spelling is far too noisy to run with the rest (about 3,000 hits on Meerkat's own docs, mostly names and British spellings): it needs --include spelling.
  check('cspell-spelling', 'Unknown words in .md and .html files from cspell (very noisy: names, jargon and British spellings; needs --include spelling)', {
    sample: 'cspell.json',
    match: 'cspell-unknown-word',
    rest: { optIn: 'spelling', group: 'ui', install: 'npm install --prefix ~/.meerkat-tools/js cspell', appliesTo: ['**/*.md', '**/*.html'], estSeconds: 30 },
  }),
  check('pip-audit-python', 'Python dependency advisories from pip-audit, for pinned requirements*.txt (contacts PyPI by design; skipped when MEERKAT_DETECTORS_OFFLINE=1)', {
    sample: 'pip-audit.json',
    match: 'PYSEC-',
    rest: { install: 'pip install pip-audit (see github.com/pypa/pip-audit)', estSeconds: 20, appliesTo: ['**/requirements*.txt'] },
  }),
  check('vulture-dead-code', 'Dead Python code from vulture: unused imports and unreachable code at 80 percent confidence or more (opt-in: lower confidence is mostly noise)', {
    sample: 'vulture.txt',
    match: 'unused import',
    rest: { group: 'refactor', install: 'pip install vulture (see github.com/jendrikseipp/vulture)', estSeconds: 10, appliesTo: ['**/*.py'] },
  }),
  check('radon-complexity', 'Very complex Python functions from radon: cyclomatic complexity rank D (21) or worse (opt-in)', {
    sample: 'radon.json',
    match: 'cyclomatic complexity',
    rest: { group: 'refactor', install: 'pip install radon (see github.com/rubik/radon)', estSeconds: 10, appliesTo: ['**/*.py'] },
  }),
  ...RUST_EXTRA,
]
