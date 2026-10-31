// Suites: the general checks a person picks. A suite holds checks (one script or tool each), and a check can report sub-checks
// (one rule each, lib/subchecks.mjs). This file is pure data plus small helpers: the registry, the mapping from check to suite,
// and the parsing of `suite`, `suite/check` and `suite/check/sub` references. docs/suites.md explains the idea.
//
// How a check finds its suite: (1) a `suite` field on the check itself, (2) CHECK_SUITE by check id, (3) PACK_SUITE by the pack the
// check came from, (4) none. A check with no suite is shown under "other" in lists, so nothing is ever lost.

const CATEGORIES = {
  security: 'Security',
  quality: 'Code quality',
  repo: 'Repository',
  web: 'Web and UI',
  languages: 'Languages and tools',
  infra: 'Infrastructure',
  performance: 'Performance',
  ai: 'AI review',
}
export const SUITE_CATEGORIES = CATEGORIES

const s = (id, label, category, purpose) => ({ id, label, category, purpose })

export const SUITES = [
  s('secrets', 'Secrets', 'security', 'Keys, tokens, passwords and private files that must never be committed.'),
  s('risky-calls', 'Risky code', 'security', 'Dangerous calls: eval, shell strings, disabled TLS checks, weak hashes, plain http.'),
  s('injection-patterns', 'Injection patterns', 'security', 'Code shapes that lead to SQL injection, path traversal, open redirects, regex DoS and XXE.'),
  s('crypto-and-auth', 'Crypto and auth', 'security', 'Weak JWT settings and weak encryption modes.'),
  s('supply-chain', 'Supply chain', 'security', 'Dependency pinning, lockfile integrity, known-vulnerable packages, install scripts and look-alike names.'),
  s('ci-workflows', 'Workflow security', 'security', 'GitHub Actions: pinned actions, limited permissions, no script injection, no secrets echoed.'),
  s('web-security', 'Web security', 'security', 'CORS, cookies, CSP, unsafe links and inline handlers, mixed content and debug modes left on.'),
  s('accessibility', 'Accessibility', 'web', 'ARIA, link text, focus, zoom, captions, table headers and colour contrast.'),
  s('html-and-css', 'HTML and CSS', 'web', 'Valid markup, duplicate ids, image sizes, stylesheet lint and !important overuse.'),
  s('seo-and-meta', 'SEO and meta', 'web', 'Title, description, robots and sitemap.'),
  s('code-quality', 'Code quality', 'quality', 'Whitespace, indentation, leftovers, empty catches, TODO hygiene and broken imports.'),
  s('test-hygiene', 'Test hygiene', 'quality', 'Skipped or focused tests, duplicate test names and projects with no tests.'),
  s('refactor', 'Refactor', 'quality', 'Duplicated code, dead code, long files and functions, deep nesting and complexity.'),
  s('javascript', 'JavaScript and TypeScript', 'languages', 'Common JS and TS mistakes: loose equality, var, unhandled promises, any, ts-ignore.'),
  s('slow-code-patterns', 'Slow code patterns', 'performance', 'Sync file calls in handlers, parsing or regex building inside loops, DOM queries in loops.'),
  s('repo-docs', 'Repository docs', 'repo', 'README sections, security policy, contributing guide, code owners and changelog format.'),
  s('repo-files', 'Repository files', 'repo', 'Large files, odd file names, case conflicts, symlinks, exec bits, gitignore and editorconfig.'),
  s('licensing', 'Licensing', 'repo', 'A licence file exists and matches what the package says.'),
  s('config-files', 'Config files', 'repo', 'JSON, YAML and TOML parse, env examples, line endings and Makefile tabs.'),
  s('ci-config', 'CI config', 'repo', 'A CI pipeline exists, has time limits and pins its Node version.'),
  s('content-and-docs', 'Content and docs', 'repo', 'Markdown, links, changelog, README usage, typos and hidden characters.'),
  s('i18n', 'Translations', 'repo', 'Translation files have the same keys and placeholders.'),
  s('data-files', 'Data files', 'repo', 'JSON with duplicate keys, inconsistent CSV, oversized data files.'),
  s('api-contracts', 'API contracts', 'infra', 'OpenAPI and GraphQL schemas are valid and complete.'),
  s('database', 'Database', 'infra', 'SQL migrations order and safety, missing indexes, Prisma schema basics.'),
  s('api-resilience', 'API resilience', 'infra', 'Timeouts, rate limits, error leaks and bounded pagination.'),
  s('desktop-apps', 'Desktop and mobile apps', 'infra', 'Electron, Tauri, Capacitor, Cordova and Android manifest security settings.'),
  s('git-history', 'Git history', 'repo', 'Commit messages, large commits, binaries and secrets in history, author identity.'),
  s('git-workflow', 'Git workflow', 'repo', 'Branch names, long-lived branches and pinned submodules.'),
  s('release-versioning', 'Release versioning', 'repo', 'Semantic versions, tags that match the package, changelog kept up to date.'),
  s('dependencies', 'Dependencies', 'repo', 'Lockfile in sync, unused, duplicate, wildcard or misplaced dependencies.'),
  s('performance', 'Performance', 'performance', 'Size, start-up, memory, response time, load and build time against budgets.'),
  s('node', 'Node and TypeScript tools', 'languages', 'ESLint, tsc, Prettier, circular imports, engines and tsconfig strictness.'),
  s('rust', 'Rust', 'languages', 'rustfmt, clippy, tests, audit, deny, docs and the release build.'),
  s('python', 'Python', 'languages', 'ruff, mypy, pytest, bandit and dead code.'),
  s('go', 'Go', 'languages', 'go vet and go test.'),
  s('java', 'Java', 'languages', 'Maven validate, compile and test.'),
  s('dotnet', '.NET', 'languages', 'dotnet format and dotnet build.'),
  s('php', 'PHP', 'languages', 'composer validate and phpstan.'),
  s('ruby', 'Ruby', 'languages', 'RuboCop and RSpec.'),
  s('swift', 'Swift', 'languages', 'SwiftLint and swift build.'),
  s('dart', 'Dart and Flutter', 'languages', 'dart analyze and dart format.'),
  s('terraform', 'Terraform', 'infra', 'terraform fmt.'),
  s('kubernetes', 'Kubernetes', 'infra', 'Helm lint and kube-linter.'),
  s('docker', 'Docker and Compose', 'infra', 'Dockerfile lint, pinned base images and Compose hygiene.'),
  s('shell-scripts', 'Shell scripts', 'languages', 'ShellCheck and shell script hygiene.'),
  s('ai-review', 'AI review', 'ai', 'AI route audit and AI diff review (opt-in, may call a paid model).'),
  s('other', 'Other checks', 'quality', 'Checks that belong to no suite yet (your own packs and example packs).'),
]

const BY_ID = new Map(SUITES.map((x) => [x.id, x]))
export const SUITE_IDS = SUITES.map((x) => x.id)

// Suites a PROJECT names in its meerkat.config.json ("suites": { "my-app": { "label", "purpose" } }, lib/customchecks.mjs). They are
// kept apart from SUITES (the bundled registry never changes), set once per project load, and shown under "Your app".
let PROJECT_SUITES = new Map()
export function setProjectSuites(list = []) {
  PROJECT_SUITES = new Map(list.filter((x) => x && !BY_ID.has(x.id)).map((x) => [x.id, { id: x.id, label: x.label, category: 'project', purpose: x.purpose, project: true }]))
}
export const projectSuites = () => [...PROJECT_SUITES.values()]
export const suiteInfo = (id) => BY_ID.get(String(id)) ?? PROJECT_SUITES.get(String(id)) ?? null
export const isSuite = (name) => BY_ID.has(String(name)) || PROJECT_SUITES.has(String(name))

// check id -> suite. A pack's own checks that need a different suite than the pack's default are listed here.
const list = (suite, ids) => Object.fromEntries(ids.split(/\s+/).filter(Boolean).map((id) => [id, suite]))
export const CHECK_SUITE = {
  ...list('secrets', 'secret-scan sensitive-files credentials-in-urls'),
  ...list('risky-calls', 'risky-code hardcoded-ip unicode-control-chars'),
  ...list('injection-patterns', 'sql-concat path-traversal-pattern open-redirect-pattern regex-dos xxe-and-deserialize'),
  ...list('crypto-and-auth', 'jwt-weak weak-crypto-modes'),
  ...list('supply-chain', 'dependency-pinning lockfile-integrity npm-audit-all install-scripts typosquat-names requirements-hashes lockfile-registry-hosts'),
  ...list('ci-workflows', 'workflow-security actions-secrets-echo'),
  ...list('web-security', 'cors-wildcard cookie-flags debug-enabled sri-missing mixed-content inline-event-handlers target-blank-noopener csp-present'),
  ...list('accessibility', 'aria-valid link-text focus-visible zoom-allowed reduced-motion iframe-title table-headers image-alt-quality media-captions css-contrast'),
  ...list('html-and-css', 'html-structure ui-static htmlhint stylelint html-valid-basics duplicate-ids image-dimensions manifest-valid css-important-overuse'),
  ...list('seo-and-meta', 'meta-seo robots-sitemap'),
  ...list('code-quality', 'markers broken-imports whitespace trailing-whitespace final-newline indent-consistency line-length debug-leftovers empty-catch todo-hygiene'),
  ...list('test-hygiene', 'skipped-tests focused-tests test-presence duplicate-test-names'),
  ...list('javascript', 'js-eqeqeq js-var-usage js-await-in-loop js-unhandled-promise js-prototype-pollution ts-any-overuse ts-ignore-comments'),
  ...list('slow-code-patterns', 'sync-fs-in-handlers json-parse-in-loop regex-in-loop dom-query-in-loop'),
  ...list('repo-docs', 'readme-sections security-policy contributing-file codeowners-valid changelog-format'),
  ...list('licensing', 'license license-matches'),
  ...list('config-files', 'json-valid env-example yaml-valid toml-valid gitattributes-eol gitignored-but-tracked makefile-tabs yamllint'),
  ...list('ci-config', 'ci-present ci-timeouts ci-node-version-pinned actionlint'),
  ...list('content-and-docs', 'links markdown-headings markdown-code-fences markdown-anchors changelog-version-headings changelog-vs-version readme-install-usage spell-common-typos markdownlint typos local-links'),
  ...list('i18n', 'i18n-keys-match i18n-placeholders'),
  ...list('data-files', 'json-duplicate-keys csv-consistent large-json-or-data'),
  ...list('api-contracts', 'openapi-valid openapi-operation-ids openapi-security-defined graphql-schema-basics'),
  ...list('database', 'sql-migrations-order sql-destructive-migrations sql-missing-index-note prisma-schema-basics'),
  ...list('api-resilience', 'http-timeouts rate-limit-present error-leak pagination-bounds'),
  ...list('git-workflow', 'long-lived-branches branch-names gitmodules-pinned'),
  ...list('release-versioning', 'tags-semver changelog-updated version-tag-match semver-valid'),
  ...list('dependencies', 'lockfiles duplicate-dependencies wildcard-versions dependency-count dev-deps-in-prod deprecated-apis lockfile-in-sync unused-dependencies-quick dependency-updates-configured lockfile-sync deprecated-deps'),
  ...list('performance', 'image-weight render-blocking large-inline-assets unoptimised-images'),
  ...list('node', 'scripts-resolve node-engines tsconfig-strict node-version-mismatch package-fields'),
  ...list('rust', 'unsafe-rust rust-unwrap-overuse rust-todo-macros'),
  ...list('python', 'py-bare-except py-mutable-default py-assert-in-prod'),
  ...list('go', 'go-ignored-errors go-defer-in-loop'),
  ...list('docker', 'hadolint compose-hygiene docker-base-pinning'),
  ...list('shell-scripts', 'shellcheck shell-hygiene'),
  ...list('git-history', 'git-history-secrets env-files-in-history commit-message-format merge-commit-noise large-commits binary-in-history author-identity signed-commits-info'),
  ...list('repo-files', 'large-files conflict-markers gitignore-essentials editorconfig-present generated-files-tracked case-conflicts long-paths reserved-names non-ascii-filenames symlinks-tracked exec-bits dead-assets'),
}

// pack -> default suite, for a check of that pack that CHECK_SUITE does not name (a new check lands in its pack's suite, never nowhere).
export const PACK_SUITE = {
  a11y: 'accessibility', ai: 'ai-review', api: 'api-contracts', 'ci-systems': 'ci-config', config: 'config-files', 'data-science': 'data-files', engines: 'config-files', packaging: 'release-versioning', privacy: 'secrets', content: 'content-and-docs', dart: 'dart', desktop: 'desktop-apps',
  docs: 'content-and-docs', dotnet: 'dotnet', git: 'git-history', go: 'go', health: 'dependencies', hygiene: 'repo-files', infra: 'config-files', java: 'java',
  kubernetes: 'kubernetes', lang: 'code-quality', node: 'node', performance: 'performance', php: 'php', python: 'python', quality: 'code-quality', refactor: 'refactor',
  repo: 'repo-files', ruby: 'ruby', rust: 'rust', security: 'risky-calls', 'security-plus': 'web-security', swift: 'swift', terraform: 'terraform', ui: 'html-and-css',
  web: 'html-and-css', 'web-plus': 'html-and-css',
  'code-patterns': 'risky-calls', 'functionality-run': 'test-hygiene', 'infra-plus': 'docker', mutation: 'test-hygiene', robustness: 'test-hygiene', 'electron-plus': 'desktop-apps', 'rust-plus': 'rust', 'secrets-plus': 'secrets', 'web-hardening': 'web-security',
}

export const packOfCheck = (c) => c?.pack ?? /^pack (.+)$/.exec(String(c?.source ?? ''))?.[1] ?? null

// The suite id of a check, or null when nothing maps it (the caller shows it under "other").
export function suiteOf(check) {
  if (!check) return null
  if (typeof check.suite === 'string' && isSuite(check.suite)) return check.suite
  if (Object.hasOwn(CHECK_SUITE, check.id)) return CHECK_SUITE[check.id]
  const pack = packOfCheck(check)
  if (pack && Object.hasOwn(PACK_SUITE, pack)) return PACK_SUITE[pack]
  return null
}
export const suiteIdOf = (check) => suiteOf(check) ?? 'other'
export const suiteLabel = (id) => suiteInfo(id)?.label ?? String(id ?? 'Other checks')

// Group checks by suite, in the order of the registry. Returns [{ ...suiteInfo, checks }] for suites that have at least one check.
export function groupBySuite(checks) {
  const by = new Map()
  for (const c of checks) {
    const id = suiteIdOf(c)
    if (!by.has(id)) by.set(id, [])
    by.get(id).push(c)
  }
  return [...projectSuites(), ...SUITES].filter((x) => by.has(x.id)).map((x) => ({ ...x, checks: by.get(x.id) }))
}

// Declared number of sub-checks (rules) of a check: `subs` on the check, else 1 (the check itself).
export const declaredSubs = (c) => (Number.isInteger(c?.subs) && c.subs >= 1 ? c.subs : 1)

const NAME = '[a-z0-9][a-z0-9-]*'
const REF_RE = new RegExp(`^(${NAME})/(${NAME})(?:/(${NAME}))?$`)
// "suite/check" or "suite/check/sub" -> { suite, check, sub } when the first part is a real suite; else null (it may be a folder path).
export function parseRef(token) {
  const m = REF_RE.exec(String(token ?? ''))
  if (!m || !isSuite(m[1])) return null
  return { suite: m[1], check: m[2], sub: m[3] ?? null }
}
export const isSuiteRef = (token) => parseRef(token) !== null || isSuite(token)

// "check/sub" or "suite/check/sub" (config "disableSubs") -> { check, sub } | null.
export function parseSubRef(text) {
  const parts = String(text ?? '').split('/')
  if (!parts.every((p) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(p))) return null
  if (parts.length === 2) return { check: parts[0], sub: parts[1] }
  if (parts.length === 3 && isSuite(parts[0])) return { suite: parts[0], check: parts[1], sub: parts[2] }
  return null
}

// Which checks a list of --only / --suite words means.
//   a check id                 that check
//   a suite name               every check of the suite (opt-in ones only when `include` names them)
//   suite/check                that check (it must be in that suite)
//   suite/check/sub            that check, reporting only that sub-check afterwards (subOnly)
// Returns { ids: Set, subOnly: Map(checkId -> Set(subId)), unmatched: [word] }. A check asked for whole wins over a sub of it.
export function resolveOnly(checks, only = [], suites = [], include = []) {
  const ids = new Set()
  const whole = new Set()
  const subOnly = new Map()
  const unmatched = []
  const byId = new Map(checks.map((c) => [c.id, c]))
  const addSuite = (name) => {
    let any = false
    for (const c of checks) {
      if (suiteIdOf(c) !== name) continue
      if (c.optIn && !include.includes(c.optIn)) continue
      ids.add(c.id)
      whole.add(c.id)
      any = true
    }
    return any
  }
  for (const word of only) {
    if (byId.has(word)) {
      ids.add(word)
      whole.add(word)
      continue
    }
    const ref = parseRef(word)
    if (ref) {
      const c = byId.get(ref.check)
      if (!c || suiteIdOf(c) !== ref.suite) {
        unmatched.push(word)
        continue
      }
      ids.add(c.id)
      if (ref.sub) {
        if (!subOnly.has(c.id)) subOnly.set(c.id, new Set())
        subOnly.get(c.id).add(ref.sub)
      } else whole.add(c.id)
      continue
    }
    if (isSuite(word) && addSuite(word)) continue
    unmatched.push(word)
  }
  for (const name of suites) if (!(isSuite(name) && addSuite(name))) unmatched.push(`suite ${name}`)
  for (const id of whole) subOnly.delete(id)
  return { ids, subOnly, unmatched }
}
