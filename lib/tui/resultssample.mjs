// BULK sample data (for the tests): a 154-check run with failures, checks that could not run, skipped ones and findings of every
// severity. The names are plain numbered fixtures on purpose; the pictures use the realistic run below (sampleData). Nothing here reads a real run.
import { buildResultsData } from './results.mjs'

const SUITES = ['secrets', 'risky-calls', 'web-security', 'code-quality', 'refactor', 'repo-files', 'accessibility', 'dependencies']
export function bulkSampleData({ checks = 154, fail = 26, notRun = 12, skipped = 3 } = {}) {
  const results = []
  const timeline = []
  let t = 0
  for (let i = 0; i < checks; i++) {
    const id = `check-${String(i).padStart(3, '0')}`
    const status = i < fail ? 'FAIL' : i < fail + notRun ? 'NOT RUN' : 'PASS'
    const ms = status === 'NOT RUN' ? 15 : 120 + ((i * 37) % 700) + (i === 77 ? 2400 : 0)
    const start = Math.floor(i / 12) * 380 + (i % 12) * 9
    timeline.push({ t: start, event: 'start', id, lane: 'free' }, { t: start + ms, event: 'end', id, status, ms })
    t = Math.max(t, start + ms)
    results.push({ id, title: `Sample check number ${i}`, status, detail: status === 'FAIL' ? `src/file${i}.js:${10 + i} sample problem ${i}  [full output: x]` : status === 'NOT RUN' ? `missing on PATH: tool${i} (install it)` : 'ok', ms, suite: SUITES[i % SUITES.length], command: `node thorough/sample.mjs ${id}`, logFile: `C:/Users/SamuelNDCE/.meerkat/logs/runs/x/${id}.log`, exitCode: status === 'PASS' ? 0 : 1, startedAt: new Date(1_700_000_000_000 + start).toISOString() })
  }
  const sevs = ['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'low', 'info']
  const findings = Array.from({ length: 60 }, (_, i) => {
    const check = `check-${String(i % fail).padStart(3, '0')}`
    return { id: `f${String(i).padStart(15, '0')}`, severity: sevs[i % sevs.length], title: `Sample rule title ${i}`, message: `Sample finding message number ${i} that is long enough to be cut at narrow widths`, suite: SUITES[i % SUITES.length], check, rule: `rule-${i % 7}`, file: `src/modules/file${i}.js`, line: 3 + i, column: null, detectedBy: { check, checkTitle: `Sample check ${i}`, pack: 'sample', origin: 'bundled', script: 'thorough/sample.mjs', tool: null, rule: `rule-${i % 7}`, command: null }, fix: 'Change the code as the rule says.', confidence: 'high', occurrences: 1, lines: [], logFile: `C:/Users/SamuelNDCE/.meerkat/logs/runs/x/${check}.log`, status: i % 9 === 0 ? 'new' : 'known', firstSeen: '2026-10-29T09:14:02.000Z', evidence: '  el.innerHTML = value' }
  })
  const by = Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, findings.filter((f) => f.severity === s).length]))
  const summary = { startedAt: new Date(1_700_000_000_000).toISOString(), ms: t, preset: 'full', tier: 'thorough', version: '1.0.0', results, selection: { skipped: Array.from({ length: skipped }, (_, i) => `skipped-${i} (no files changed in its paths)`), covered: [], disabled: [] } }
  return buildResultsData({ summary, timeline, findingsDoc: { findings, counts: { total: findings.length, new: findings.filter((f) => f.status === 'new').length, bySeverity: by }, run: { project: { path: 'C:/Users/SamuelNDCE/code/plume' } } }, runDir: 'C:/Users/SamuelNDCE/.meerkat/logs/full' })
}

// ---------- the realistic sample run (the pictures use this one) ----------
// A made-up full run of a made-up project, C:/Users/SamuelNDCE/code/plume (a Tauri app: TypeScript front end, Rust back end). Every name,
// time and message is invented for the pictures; the screens carry SAMPLE_NOTE so nobody mistakes them for a real run.
export const SAMPLE_NOTE = 'SAMPLE DATA - made up for this picture'
const PLUME = 'C:/Users/SamuelNDCE/code/plume'
const RUN_DIR = 'C:/Users/SamuelNDCE/.meerkat/logs/runs/20261031-142305-full'
// [id, suite, what it checks, status, ms, started at (ms into the run), detail, command]
const CHECKS = [
  ['secret-scan', 'secrets', 'Keys, tokens and private keys in tracked files', 'FAIL', 1900, 0, '2 secrets in tracked files', 'node thorough/secret-scan.mjs'],
  ['rule-scan', 'code-quality', 'About 1,400 rules over every source file', 'FAIL', 5200, 120, '5 rules matched in 3 files', 'node thorough/rule-scan.mjs'],
  ['cargo-audit', 'dependencies', 'Rust crates against the RustSec advisory database', 'FAIL', 4300, 180, '1 known advisory (RUSTSEC-2026-0044)', 'cargo audit'],
  ['npm-audit', 'dependencies', 'npm packages against the registry advisories', 'FAIL', 3100, 240, '1 high advisory: lodash 4.17.20', 'npm audit --omit=dev'],
  ['eslint', 'code-quality', 'ESLint over src/', 'FAIL', 9800, 300, '3 errors, 2 warnings', 'npx eslint src'],
  ['clippy', 'rust', 'cargo clippy with warnings as errors', 'FAIL', 41200, 1500, '2 lints: unwrap_used in src-tauri/src/db.rs', 'cargo clippy --all-targets -- -D warnings'],
  ['a11y-contrast', 'accessibility', 'Colour contrast of every screen (WCAG AA)', 'NOT RUN', 12, 420, 'missing on PATH: pa11y (npm i -g pa11y)', 'pa11y-ci'],
  ['perf-bundle-size', 'performance', 'JavaScript bundle stays under 600 KB', 'NOT RUN', 9, 460, 'no build output yet: run npm run build first', 'node thorough/bundle-size.mjs'],
  ['rust-tests', 'rust', 'cargo test for the whole workspace', 'PASS', 88400, 43000, 'ok', 'cargo test --workspace'],
  ['tsc', 'functionality', 'TypeScript type check, no errors', 'PASS', 14300, 520, 'ok', 'npx tsc --noEmit'],
  ['unit-tests', 'functionality', 'Vitest unit tests', 'PASS', 31700, 5600, 'ok', 'npx vitest run'],
  ['build-web', 'functionality', 'The web front end builds', 'PASS', 22600, 6200, 'ok', 'npm run build'],
  ['circular-imports', 'refactor', 'No import cycles between modules', 'PASS', 2200, 600, 'ok', 'node thorough/circular-imports.mjs'],
  ['license-check', 'dependencies', 'Every dependency licence is allowed', 'PASS', 1100, 700, 'ok', 'node thorough/license-check.mjs'],
  ['prettier-check', 'code-quality', 'Files are formatted', 'PASS', 3800, 760, 'ok', 'npx prettier --check .'],
  ['cargo-fmt', 'rust', 'cargo fmt --check', 'PASS', 900, 820, 'ok', 'cargo fmt --check'],
  ['dependency-pinning', 'dependencies', 'Dependencies name a fixed version, not latest or *', 'PASS', 800, 880, 'ok', 'node thorough/dependency-pinning.mjs'],
  ['workflow-security', 'web-security', 'GitHub Actions: pinned actions, limited permissions', 'PASS', 1300, 940, 'ok', 'node thorough/workflow-security.mjs'],
  ['lockfile-integrity', 'dependencies', 'Locked packages are fetched securely and checksummed', 'PASS', 1700, 1000, 'ok', 'node thorough/lockfile-integrity.mjs'],
  ['sensitive-files', 'secrets', 'No environment files or private keys are tracked', 'PASS', 600, 1060, 'ok', 'node thorough/sensitive-files.mjs'],
  ['risky-code', 'risky-calls', 'eval, shell strings, disabled TLS checks, weak hashes', 'PASS', 2400, 1120, 'ok', 'node thorough/risky-code.mjs'],
  ['web-hardening', 'web-security', 'CORS, cookies and security headers', 'PASS', 1500, 1180, 'ok', 'node thorough/web-hardening.mjs'],
  ['code-smells', 'code-quality', 'Empty catch blocks, console.log left behind', 'PASS', 2700, 1240, 'ok', 'node thorough/code-smells.mjs'],
  ['file-length', 'refactor', 'No file over 800 lines', 'PASS', 700, 1300, 'ok', 'node thorough/file-length.mjs'],
  ['unused-exports', 'refactor', 'Every export is used somewhere', 'PASS', 4100, 1360, 'ok', 'node thorough/unused-exports.mjs'],
  ['alt-text', 'accessibility', 'Images have alt text', 'PASS', 500, 1420, 'ok', 'node thorough/alt-text.mjs'],
  ['form-labels', 'accessibility', 'Form fields have labels', 'PASS', 540, 1480, 'ok', 'node thorough/form-labels.mjs'],
  ['readme-sections', 'repo-files', 'README has install, usage and licence sections', 'PASS', 300, 1540, 'ok', 'node thorough/readme-sections.mjs'],
  ['json-valid', 'repo-files', 'Every .json file parses', 'PASS', 400, 1600, 'ok', 'node thorough/json-valid.mjs'],
  ['line-endings', 'repo-files', 'One kind of line ending per file', 'PASS', 450, 1660, 'ok', 'node thorough/line-endings.mjs'],
  ['e2e-smoke', 'functionality', 'The app starts and the main window opens', 'PASS', 18500, 28000, 'ok', 'npm run e2e:smoke'],
]
// [severity, check, rule, file, line, why, fix, status, evidence]
const FINDINGS = [
  ['critical', 'secret-scan', 'hardcoded-secret', 'src/auth/session.ts', 42, 'A live Stripe secret key (sk_live_ prefix) is written in the source', 'Move the key to an environment variable, then rotate it: it is already in git history.', 'new', "  const stripe = new Stripe('sk_live_51Hd...redacted')"],
  ['critical', 'rule-scan', 'sql-injection', 'src/api/orders.ts', 77, 'The SQL is built by joining a request value into the string', 'Use a parameterised query: db.query(sql, [orderId]).', 'new', '  db.query(`SELECT * FROM orders WHERE id = ${req.params.id}`)'],
  ['high', 'clippy', 'unwrap-in-prod', 'src-tauri/src/db.rs', 118, 'unwrap() on a database result crashes the whole app when the query fails', 'Return the error with ? and show it in the UI.', 'new', '  let row = stmt.query_row([], |r| r.get(0)).unwrap();'],
  ['high', 'eslint', 'missing-await', 'src/auth/session.ts', 96, 'A promise is not awaited, so a failed refresh is silently lost', 'Add await, or return the promise to the caller.', 'known', '  refreshToken(user)'],
  ['high', 'cargo-audit', 'RUSTSEC-2026-0044', 'Cargo.lock', 0, 'time 0.1.45 has a known memory-safety bug (fixed in 0.3.36)', 'Run cargo update -p time.', 'known', ''],
  ['high', 'npm-audit', 'GHSA-lodash-proto', 'package-lock.json', 0, 'lodash 4.17.20 allows prototype pollution through merge()', 'Upgrade lodash to 4.17.21 or later.', 'known', ''],
  ['high', 'rule-scan', 'xss-innerhtml', 'src/ui/Comment.tsx', 31, 'innerHTML is set from user text, so a comment can run script', 'Render text with textContent, or sanitise it first.', 'known', '  el.innerHTML = comment.body'],
  ['high', 'secret-scan', 'private-key-file', 'deploy/id_ed25519', 1, 'A private SSH key is tracked in the repository', 'Remove it from git, rotate the key, and add it to .gitignore.', 'known', ''],
  ['medium', 'eslint', 'no-floating-promises', 'src/sync/queue.ts', 58, 'A promise result is ignored, so errors vanish', 'Await it or add a .catch().', 'known', ''],
  ['medium', 'clippy', 'unwrap-in-prod', 'src-tauri/src/settings.rs', 64, 'unwrap() on a file read crashes when the settings file is missing', 'Fall back to the default settings.', 'known', ''],
  ['medium', 'rule-scan', 'cors-wildcard', 'src/api/server.ts', 14, 'CORS allows every origin together with credentials', 'List the allowed origins instead of *.', 'known', ''],
  ['medium', 'eslint', 'empty-catch', 'src/sync/queue.ts', 102, 'An empty catch block hides errors', 'Log the error or rethrow it.', 'new', ''],
  ['medium', 'rule-scan', 'weak-hash', 'src/util/hash.ts', 9, 'MD5 is used for a value that is stored, and is easy to attack', 'Use SHA-256 or an argon2 hash for passwords.', 'known', ''],
  ['low', 'eslint', 'no-console', 'src/ui/Sidebar.tsx', 27, 'console.log left in shipped code', 'Remove it or use the logger.', 'known', ''],
  ['low', 'clippy', 'long-file', 'src-tauri/src/db.rs', 0, 'The file has 1204 lines (limit 800)', 'Split queries and migrations into modules.', 'known', ''],
  ['low', 'rule-scan', 'todo-fixme', 'src/sync/queue.ts', 12, 'A TODO from 2026-03 is still open', 'Do it or file an issue.', 'known', ''],
  ['info', 'rule-scan', 'no-security-policy', 'SECURITY.md', 0, 'The repository has no security policy', 'Add SECURITY.md saying how to report a bug.', 'known', ''],
  ['info', 'eslint', 'prefer-const', 'src/ui/Header.tsx', 18, 'let is never reassigned', 'Use const.', 'known', ''],
]

function runOf({ clean }) {
  const results = []
  const timeline = []
  let end = 0
  for (const [id, suite, title, status0, ms, start, detail, command] of CHECKS) {
    const status = clean && status0 !== 'PASS' ? 'PASS' : status0
    const took = clean && status0 !== 'PASS' ? 4000 : ms
    timeline.push({ t: start, event: 'start', id, lane: ['clippy', 'rust-tests', 'cargo-fmt'].includes(id) ? 'cargo' : 'free' }, { t: start + took, event: 'end', id, status, ms: took })
    end = Math.max(end, start + took)
    results.push({ id, title, status, detail: clean ? 'ok' : status === 'FAIL' ? `${detail}  [full output: ${id}.log]` : detail, ms: took, suite, command, logFile: `${RUN_DIR}/${id}.log`, exitCode: status === 'PASS' ? 0 : 1, startedAt: new Date(1_793_000_000_000 + start).toISOString() })
  }
  const findings = clean
    ? []
    : FINDINGS.map(([severity, check, rule, file, line, message, fix, status, evidence], i) => ({ id: (0x85eac75481ba + i * 4099).toString(16).padStart(16, '0'), severity, title: message, message, suite: results.find((r) => r.id === check)?.suite ?? '', check, rule, file, line, column: null, detectedBy: { check, checkTitle: CHECKS.find((c) => c[0] === check)?.[2] ?? check, pack: 'bundled', origin: 'bundled', script: `thorough/${check}.mjs`, tool: null, rule, command: null }, fix, confidence: 'high', occurrences: 1, lines: line ? [line] : [], logFile: `${RUN_DIR}/${check}.log`, status, firstSeen: '2026-10-29T09:14:02.000Z', evidence }))
  const by = Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((sv) => [sv, findings.filter((f) => f.severity === sv).length]))
  const summary = { startedAt: new Date(1_793_000_000_000).toISOString(), ms: end, preset: 'full', tier: 'thorough', version: '1.3.2', results, selection: { skipped: clean ? [] : ['mobile-build (no files changed in its paths)', 'ios-signing (no Apple tools on this PC)'], covered: [], disabled: [] } }
  return buildResultsData({ summary, timeline, findingsDoc: { findings, counts: { total: findings.length, new: findings.filter((f) => f.status === 'new').length, bySeverity: by }, run: { project: { path: PLUME } } }, runDir: RUN_DIR })
}
// A run with failures, checks that could not run, skipped ones and findings of every severity.
export const sampleData = () => runOf({ clean: false })
// The same project when nothing is wrong: every check passes, no findings (the happy picture).
export const cleanSampleData = () => runOf({ clean: true })
