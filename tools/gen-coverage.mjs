// Writes the numbers of docs/coverage.md between its markers, from the checks themselves, so they cannot go stale:
//   node tools/gen-coverage.mjs
// It reads every pack under packs/ (not only the packs a project turns on) and counts through the same registry the CLI uses
// (lib/suites.mjs). Everything outside the markers in docs/coverage.md is written by hand.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadChecks } from '../lib/load-checks.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { declaredSubs, groupBySuite, suiteIdOf } from '../lib/suites.mjs'

const PACKS_DIR = join(MEERKAT_DIR, 'packs')
const packs = readdirSync(PACKS_DIR).filter((p) => statSync(join(PACKS_DIR, p)).isDirectory()).sort()
const checks = []
for (const pack of packs) for (const c of await loadChecks(join(PACKS_DIR, pack))) checks.push({ ...c, pack })
const byId = new Map(checks.map((c) => [c.id, c]))

const rules = (c) => declaredSubs(c)
const sum = (list) => list.reduce((n, c) => n + rules(c), 0)
const esc = (t) => String(t).replace(/\|/g, '\\|')
// A tool other than Node itself that a check needs. Without it the check is NOT RUN.
const external = (c) => (c.needs ?? []).filter((n) => !['node', 'git'].includes(n))

// ---- Table 1: what each suite looks at. Hand-written; the generator stops if a suite has no line, so a new suite cannot be missed.
const LOOKS_AT = {
  secrets: 'Any text file git tracks; private key and credential files',
  'risky-calls': 'JS/TS, Python, Go, Rust, Java and more (code), plus tracked text files',
  'injection-patterns': 'JS/TS, Python, Java, C#, PHP, Ruby source',
  'crypto-and-auth': 'Source files (JWT and cipher settings)',
  'supply-chain': 'package.json, lockfiles, requirements, .npmrc',
  'ci-workflows': 'GitHub Actions workflow files',
  'web-security': 'HTML, JSX/TSX, Vue, Svelte, server and host config, JS (cookies, CORS, headers, privacy)',
  accessibility: 'HTML, JSX/TSX, Vue, Svelte, CSS',
  'html-and-css': 'HTML, CSS, web manifests, templates',
  'seo-and-meta': 'HTML pages, robots.txt, sitemap',
  'code-quality': 'Source and text files (whitespace, leftovers, imports)',
  'test-hygiene': 'Test files; opt-in: runs your project',
  refactor: 'Source files (JS/TS first)',
  javascript: 'JS and TS source',
  'slow-code-patterns': 'JS and TS source',
  'repo-docs': 'README, SECURITY, CONTRIBUTING, CODEOWNERS, CHANGELOG',
  'repo-files': 'File names, sizes, modes, .gitignore, .editorconfig',
  licensing: 'LICENSE, NOTICE, package licences',
  'config-files': 'JSON, YAML, TOML, .env.example, Makefile, game-engine and CMS projects',
  'ci-config': 'CI files (GitLab, CircleCI, Azure, Jenkins, GitHub), Helm, Ansible, pre-commit',
  'content-and-docs': 'Markdown, links, changelog, typos',
  i18n: 'Translation JSON files',
  'data-files': 'JSON, CSV, Jupyter notebooks, model and data files',
  'api-contracts': 'OpenAPI and GraphQL files',
  database: 'SQL migrations, Prisma schema',
  'api-resilience': 'Server code (timeouts, limits, errors, paging)',
  'desktop-apps': 'Electron, Tauri, Capacitor, Cordova, Android manifest',
  'git-history': 'Git commit history (needs a git repository)',
  'git-workflow': 'Branches, tags, submodules (needs a git repository)',
  'release-versioning': 'Versions, tags, package publish files (npm, PyPI, crates)',
  dependencies: 'Manifests and lockfiles; opt-in: clean install',
  performance: 'Images, assets, and budgets you set (.meerkat-budgets.json)',
  node: 'JS/TS projects (package.json, tsconfig)',
  rust: 'Rust crates (Cargo.toml)',
  python: 'Python projects',
  go: 'Go modules',
  java: 'Maven projects (pom.xml)',
  dotnet: '.NET projects (sln, csproj)',
  php: 'PHP projects (composer.json)',
  ruby: 'Ruby projects',
  swift: 'Swift packages',
  dart: 'Dart and Flutter projects',
  terraform: 'Terraform files (.tf); its check also holds the Compose rules',
  kubernetes: 'Helm charts and Kubernetes YAML',
  docker: 'Dockerfiles and Compose files',
  'shell-scripts': 'Shell scripts (.sh)',
  'ai-review': 'Routes and the git diff, read by an AI model',
}

const runsBy = (list) => {
  const normal = list.filter((c) => !c.optIn)
  const opt = list.filter((c) => c.optIn)
  const tiers = new Set(normal.map((c) => c.tier))
  let word = !normal.length ? 'opt-in' : tiers.size > 1 ? 'both' : tiers.has('fast') ? 'quick' : 'full'
  if (normal.length && opt.length) word += ' + opt-in'
  return word
}

const suiteRows = groupBySuite(checks.map((c) => ({ ...c }))).map((sx) => {
  if (!LOOKS_AT[sx.id]) throw new Error(`gen-coverage: suite "${sx.id}" has no LOOKS_AT line`)
  const tools = [...new Set(sx.checks.flatMap(external))].sort()
  return `| \`${sx.id}\` | ${esc(LOOKS_AT[sx.id])} | ${sx.checks.length} | ${sum(sx.checks)} | ${runsBy(sx.checks)} | ${tools.length ? `yes: ${esc(tools.join(', '))}` : 'no'} |`
})
const suiteCount = suiteRows.length

// ---- Table 2: by language. Rules are Meerkat's own (a check that needs an outside tool is listed under Tools, not counted).
const { DNP } = await import('../thorough/rules-code-patterns.mjs')
const { TF_RULES, COMPOSE_RULES } = await import('../thorough/rules-infra-plus.mjs')
const prefixCount = (pre) => DNP.filter((r) => r.id.startsWith(pre)).length
const own = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).filter((c) => !external(c).length)
const tools = (ids) => [...new Set(ids.map((id) => byId.get(id)).filter(Boolean).flatMap(external))]
const wild = (re) => checks.filter((c) => re.test(c.id)).map((c) => c.id)
const ownCount = (ids, extra = 0) => sum(own(ids)) + extra
const GLOBS_HTML = (c) => (c.appliesTo ?? []).some((g) => /\.(html|css|scss|htm)$/.test(g) || /\*\.(html|css)/.test(g))

const ROWS = [
  // [row, level, ids (own rules + tool wrappers), extra rules from shared tables, note]
  ['JavaScript, TypeScript', 'DEEP', ['cp-js', ...wild(/^(js|ts)-/)], 0, ''],
  ['Python', 'BASIC', ['cp-python', ...wild(/^py-/)], 0, 'rules not yet tried on real Python code'],
  ['Go', 'BASIC', ['cp-go', 'go-ignored-errors', 'go-defer-in-loop', 'go-vet', 'go-test'], 0, 'use on real Go code not confirmed'],
  ['Rust', 'BASIC', ['cp-rust', 'rust-unwrap-overuse', 'rust-todo-macros', 'unsafe-rust', ...wild(/^rust-(fmt|clippy|test|audit|build-release|doc|deny)$/)], 0, 'rules tried on real Rust code (one corpus repo)'],
  ['Java', 'BASIC', ['cp-java', 'maven-validate', 'maven-compile', 'maven-test'], 0, 'rules not yet tried on real Java code'],
  ['C#', 'BASIC', ['dotnet-format', 'dotnet-build'], prefixCount('cs-'), 'rules not yet tried on real C# code'],
  ['PHP', 'BASIC', ['composer-validate', 'phpstan'], prefixCount('php-'), 'rules not yet tried on real PHP code'],
  ['Ruby', 'BASIC', ['rubocop', 'rspec'], prefixCount('rb-'), 'rules not yet tried on real Ruby code'],
  ['Swift', 'NONE', ['swiftlint', 'swift-build'], 0, 'no rules of its own'],
  ['Dart, Flutter', 'NONE', ['dart-analyze', 'dart-format'], 0, 'no rules of its own'],
  ['Shell scripts', 'BASIC', ['shell-hygiene', 'shellcheck'], 0, 'PowerShell is not covered'],
  ['HTML, CSS', 'DEEP', [], 0, 'checks whose files are HTML, CSS or templates, plus the web-hardening HTML table'],
  ['Markdown', 'BASIC', ['markdown-headings', 'markdown-code-fences', 'markdown-anchors', 'links', 'local-links', 'markdownlint', 'typos', 'spell-common-typos', 'readme-sections', 'readme-install-usage', 'changelog-format', 'changelog-version-headings'], 0, ''],
  ['YAML, TOML, JSON', 'BASIC', ['yaml-valid', 'toml-valid', 'json-valid', 'json-duplicate-keys', 'yamllint'], 0, 'syntax and duplicate keys only'],
  ['Dockerfile', 'BASIC', ['ip-docker', 'docker-base-pinning', 'hadolint'], 0, 'infra rules were measured on the corpus as one group; per-family use not confirmed'],
  ['Kubernetes, Helm', 'BASIC', ['ip-k8s', 'helm-chart-basics', 'helm-values-secrets', 'helm-lint', 'kube-linter'], 0, 'as for Dockerfile'],
  ['Terraform', 'BASIC', ['terraform-fmt'], TF_RULES.length, 'rules from the Terraform table of ip-terraform-compose'],
  ['Docker Compose', 'BASIC', ['compose-hygiene'], COMPOSE_RULES.length, 'rules from the Compose table of ip-terraform-compose'],
  ['GitHub Actions', 'BASIC', ['ip-gha', 'workflow-security', 'actions-secrets-echo', 'github-actions-reusable', 'github-actions-concurrency', 'github-actions-artifacts', 'actionlint'], 0, 'as for Dockerfile'],
  ['GitLab, CircleCI, Azure, Jenkins', 'BASIC', ['gitlab-ci-secrets', 'gitlab-ci-images', 'gitlab-ci-privileged', 'gitlab-ci-stages', 'circleci-config', 'azure-pipelines', 'jenkinsfile-safety'], 0, ''],
  ['Jupyter notebooks', 'BASIC', wild(/^notebook-/), 0, ''],
  ['Game engines', 'BASIC', ['unity-meta-files', 'unity-gitignore', 'unity-serialization', 'unity-large-assets', 'unity-script-hazards', 'godot-project', 'godot-script-hazards', 'unreal-hygiene'], 0, 'Unity, Godot, Unreal only'],
  ['Android', 'BASIC', ['android-manifest-flags', 'capacitor-cordova-cleartext'], 0, 'iOS is not covered'],
  ['Electron, Tauri', 'BASIC', [...wild(/^electron-/), 'tauri-allowlist'], 0, ''],
  ['Any text file (secrets)', 'DEEP', ['secrets-plus', 'secret-scan', 'sensitive-files', 'credentials-in-urls'], 0, 'counted once here, not in the rows above'],
]

const levelRules = (row) => {
  const [, , ids, extra] = row
  if (row[0] === 'HTML, CSS') {
    const web = checks.filter((c) => GLOBS_HTML(c) && !external(c).length)
    const wh = byId.get('wh-html')
    return sum(web) + (web.includes(wh) ? 0 : wh ? rules(wh) : 0)
  }
  return ownCount(ids, extra)
}
const levelTools = (row) => {
  if (row[0] === 'HTML, CSS') return [...new Set(checks.filter(GLOBS_HTML).flatMap(external))]
  return tools(row[2])
}
const langRows = ROWS.map((row) => `| ${row[0]} | ${row[1]} | ${levelRules(row)} | ${levelTools(row).join(', ') || '-'} | ${esc(row[4])} |`)

// ---- Headline numbers
const total = (f) => checks.filter(f).length
const subTotal = sum(checks)
const headline = [
  `Counted from all ${packs.length} packs under \`packs/\`: **${checks.length} checks** in **${suiteCount} suites** with **${subTotal} rules** (sub-checks).`,
  `Run by default: ${total((c) => !c.optIn && c.tier === 'fast')} quick checks and ${total((c) => !c.optIn && c.tier === 'thorough')} full-only checks. Opt-in: ${total((c) => c.optIn)} (${[...new Set(checks.filter((c) => c.optIn).map((c) => c.optIn))].map((o) => `\`--include ${o}\``).join(', ')}).`,
  `Checks that need an outside tool (NOT RUN without it): ${total((c) => external(c).length)} of ${checks.length}. The other ${total((c) => !external(c).length)} need only Node.`,
]

const block = [
  '<!-- coverage:start -->',
  headline.join('\n\n'),
  '',
  'Legend. **Checks**: scripts or tool runs. **Rules**: separate pass/fail results inside them. **Runs by default**: quick = in `meerkat verify`; full = only in `meerkat full`; both = a mix; opt-in = only when you ask. **Tool**: yes means at least one check in the suite is NOT RUN without that outside tool; the others still work.',
  '',
  '| Suite | What it looks at | Checks | Rules | Runs by default | Needs an outside tool? |',
  '|---|---|---|---|---|---|',
  ...suiteRows,
  '<!-- coverage:end -->',
].join('\n')

const block2 = [
  '<!-- coverage-lang:start -->',
  'Legend. **DEEP**: 20 or more rules of Meerkat\'s own, and the rules were run against a 13-repository corpus of real projects. **BASIC**: some rules, mostly proved on small sample files only. **NONE**: no rules of Meerkat\'s own (an outside tool may still be run, see Tools). **Rules** counts only Meerkat\'s own rules; checks that wrap an outside tool are named under Tools and not counted.',
  '',
  '| Area | Level | Own rules | Tools it can run | Note |',
  '|---|---|---|---|---|',
  ...langRows,
  '<!-- coverage-lang:end -->',
].join('\n')

const file = join(MEERKAT_DIR, 'docs', 'coverage.md')
const text = readFileSync(file, 'utf8')
const nl = text.includes('\r\n') ? '\r\n' : '\n'
let out = text
for (const [name, b] of [['coverage', block], ['coverage-lang', block2]]) {
  const re = new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`)
  if (!re.test(out)) throw new Error(`docs/coverage.md has no ${name} markers`)
  out = out.replace(re, () => b.replace(/\n/g, nl))
}
writeFileSync(file, out)
console.log(headline.join('\n'))
