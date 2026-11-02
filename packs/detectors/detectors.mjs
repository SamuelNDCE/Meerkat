// The detectors pack (opt-in): mature tools run for you when they are installed, their findings kept under their own rule ids.
// osv-scanner (dependency advisories), Semgrep (security-audit rules), cargo clippy (correctness and suspicious lints), tsc --strict.
// Turn it on with `--preset detectors`, or `--include detectors` with the pack enabled. A missing tool is NOT RUN with an install hint; nothing
// is ever installed for you. Each check proves its parser against a recorded sample of the tool's output (tests/fixtures/detectors/).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SCRIPT = `${MK}/thorough/detectors.mjs`
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
]
