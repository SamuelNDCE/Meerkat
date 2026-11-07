// What kind of file a check is plainly about, for the scoped gate (lib/gate.mjs). A check that has no `paths` of its own and is named here
// waits for a changed file of its kind: a Rust check does not start for a change to a Markdown file. Only checks whose name or pack says which
// language or file type they read are listed; every other check runs. `meerkat gate --all` ignores this table.
const JS = ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.vue', '**/*.svelte']
const TS = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
const PY = ['**/*.py', '**/*.pyi']
const GO = ['**/*.go', '**/go.mod']
const RS = ['**/*.rs', '**/Cargo.toml']
const NOTEBOOK = ['**/*.ipynb']

// check id -> globs
const BY_ID = {
  'js-eqeqeq': JS,
  'js-var-usage': JS,
  'js-await-in-loop': JS,
  'js-unhandled-promise': JS,
  'js-prototype-pollution': JS,
  'ts-any-overuse': TS,
  'ts-ignore-comments': TS,
  'py-bare-except': PY,
  'py-mutable-default': PY,
  'py-assert-in-prod': PY,
  'go-ignored-errors': GO,
  'go-defer-in-loop': GO,
  'rust-unwrap-overuse': RS,
  'rust-todo-macros': RS,
  'cp-python': PY,
  'cp-js': JS,
  'cp-go': GO,
  'cp-rust': RS,
  'cp-java': ['**/*.java', '**/*.kt'],
  'cp-dotnet-php-ruby': ['**/*.cs', '**/*.php', '**/*.rb', '**/*.vb'],
  'notebook-valid-json': NOTEBOOK,
  'notebook-outputs-stripped': NOTEBOOK,
  'notebook-secrets': NOTEBOOK,
  'notebook-size': NOTEBOOK,
  'notebook-absolute-paths': NOTEBOOK,
  'notebook-pip-magics': NOTEBOOK,
  'cf-react': ['**/*.jsx', '**/*.tsx', '**/package.json'],
}
// pack source -> globs (the pack's whole set reads one language)
const BY_PACK = { 'pack rust-plus': RS }

export function gatePathsFor(check) {
  return BY_ID[check?.id] ?? BY_PACK[check?.source] ?? null
}

// Checks whose verdict depends only on file NAMES, the contents of files that are not source code (package.json, workflows, docs, config) and,
// for the `git` ones, the commits, tags and branches: never on a source file's text. The gate keeps their result under a key that ignores
// source edits, so a one-file change does not run them again (lib/gatecache.mjs). A check is listed here only when its script was read.
// Test: tests/gate-scope.test.ts runs each on a fixture before and after a source edit and the output must be identical.
export const LAYOUT_CHECKS = new Set([
  'readme-sections', 'security-policy', 'contributing-file', 'codeowners-valid', 'gitignore-essentials', 'editorconfig-present', 'changelog-format', 'license-matches',
  'ci-present', 'dependency-updates-configured', 'case-conflicts', 'long-paths', 'reserved-names', 'non-ascii-filenames', 'symlinks-tracked', 'package-fields',
  'license', 'lockfiles', 'node-engines', 'yaml-valid', 'toml-valid', 'ci-timeouts', 'ci-node-version-pinned',
  'gitlab-ci-secrets', 'gitlab-ci-images', 'gitlab-ci-privileged', 'gitlab-ci-stages', 'circleci-config', 'azure-pipelines', 'jenkinsfile-safety', 'github-actions-reusable',
  'github-actions-concurrency', 'github-actions-artifacts', 'helm-chart-basics', 'helm-values-secrets', 'ansible-hygiene', 'pre-commit-config',
])
export const GIT_CHECKS = new Set(['commit-message-format', 'merge-commit-noise', 'large-commits', 'binary-in-history', 'long-lived-branches', 'branch-names', 'tags-semver', 'author-identity', 'signed-commits-info', 'gitmodules-pinned'])
export const layoutClassOf = (id) => (GIT_CHECKS.has(id) ? 'git' : LAYOUT_CHECKS.has(id) ? 'layout' : null)
