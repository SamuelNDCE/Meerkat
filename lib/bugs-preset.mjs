// The `bugs` preset: the quick run minus rules that are purely style, documentation or project housekeeping, so a finding is likely a real bug.
// Why: on 20 real bug-fix commits the quick preset gave about 540 findings per tree and over half came from six style and doc rules.
// This file is the ONE place the exclusions live. Every entry carries a one-line reason. tests/bugs-preset.test.ts fails when an id
// stops existing (a rename must not silently bring a rule back). A rule is excluded only when its own description says it is about
// style, documentation, formatting or housekeeping and not about wrong behaviour. Security rules are never excluded here.

// Whole checks left out (id -> reason).
export const BUGS_EXCLUDED_CHECKS = {
  markdownlint: 'Markdown formatting of documents, not code behaviour',
  'markdown-headings': 'heading levels in Markdown, style of documents',
  'markdown-code-fences': 'language names on Markdown fences, style of documents',
  typos: 'spelling in code and documents',
  'spell-common-typos': 'spelling in docs and comments',
  prettier: 'code formatting only',
  'rust-fmt': 'code formatting only (cargo fmt --check)',
  'dart-format': 'code formatting only',
  'dotnet-format': 'code formatting only',
  'trailing-whitespace': 'stray spaces at line ends, formatting',
  'final-newline': 'newline at end of file, formatting',
  'indent-consistency': 'tabs versus spaces, formatting',
  'line-length': 'source line length, readability',
  whitespace: 'byte-order marks and mixed line endings, formatting',
  'gitattributes-eol': 'line-ending policy file, housekeeping',
  'editorconfig-present': 'an .editorconfig file exists, housekeeping',
  'readme-sections': 'README headings, documentation',
  'readme-install-usage': 'README length and sections, documentation',
  'contributing-file': 'CONTRIBUTING.md exists, documentation',
  'changelog-format': 'CHANGELOG heading style, documentation',
  'changelog-version-headings': 'CHANGELOG heading order, documentation',
  'commit-message-format': 'commit subject style, process',
  'branch-names': 'branch naming style, process',
  'merge-commit-noise': 'history tidiness, process',
  'todo-hygiene': 'TODO comments naming an owner, process',
  markers: 'FIXME and XXX notes left in code, a to-do list and not a defect',
  'non-ascii-filenames': 'file name characters, housekeeping',
  'css-important-overuse': 'count of !important in CSS, style',
  'ts-ignore-comments': 'whether @ts-ignore says why, comment style',
  'js-var-usage': 'var versus let and const, style',
  // Project housekeeping (added in this release): they look at whole-project files and conventions, never at how code behaves. Two of them (license,
  // security-policy) sit in the security group by kind, but a missing LICENSE or SECURITY.md is not a vulnerability in the code.
  license: 'a license is declared: project housekeeping',
  'security-policy': 'SECURITY.md exists: project housekeeping',
  'ci-present': 'a CI workflow exists: project housekeeping',
  'gitignore-essentials': '.gitignore covers the usual folders: project housekeeping',
  'test-presence': 'the source has test files: project housekeeping',
  'env-example': 'every environment variable is documented in .env.example: project housekeeping',
  'debug-leftovers': 'console.log and debug prints left in: tidiness, not wrong behaviour',
}

// Single rules left out (check/rule -> reason). The rule ids are the sub-check ids of the rust-plus pack (thorough/rules-rust-plus.mjs).
export const BUGS_EXCLUDED_SUBS = {
  // The six named by the measurement.
  'rp-api-ffi-wasm/rapi-pub-fn-undocumented': 'a public function has no /// comment: documentation',
  'rp-api-ffi-wasm/rapi-pub-type-undocumented': 'a public type has no /// comment: documentation',
  'rp-api-ffi-wasm/rapi-missing-docs-lint': 'no #![warn(missing_docs)] attribute: documentation policy',
  'rp-api-ffi-wasm/rapi-missing-debug-derive': 'a public type does not derive Debug: API convenience, not wrong behaviour',
  'rp-errors/rerr-string-error-result': 'a String error type in Result: design preference, the code still works',
  'rp-perf-style/rperf-push-str-format': 'push_str(&format!) allocates a temporary: micro-performance style',
  // Other purely style or readability rules of the same pack.
  'rp-errors/rerr-map-err-to-string': 'map_err(to_string) loses the error type: design preference',
  'rp-errors/rerr-box-dyn-error-public': 'Box<dyn Error> in a public signature: API design preference',
  'rp-errors/rerr-unit-error-type': '() as an error type: API design preference',
  'rp-errors/rerr-unwrap-or-builds-value': 'eager unwrap_or argument: micro-performance style',
  'rp-errors/rerr-error-no-display': 'error enum without Display: API convenience',
  'rp-perf-style/rperf-len-compare-zero': 'len() == 0 versus is_empty: style',
  'rp-perf-style/rperf-format-to-string-arg': 'format!("{}", x.to_string()): double allocation style',
  'rp-perf-style/rperf-format-no-args': 'format! with no arguments: style',
  'rp-perf-style/rperf-collect-then-iterate': 'needless collect: micro-performance style',
  'rp-perf-style/rperf-iter-count': 'iter().count() versus len(): micro-performance style',
  'rp-perf-style/rperf-nth-zero': 'nth(0) versus next(): style',
  'rp-perf-style/rperf-map-identity': 'map(|x| x): style',
  'rp-perf-style/rperf-bool-eq-literal': 'comparing a bool with true or false: style',
  'rp-perf-style/rperf-index-range-loop': 'indexing a vector over 0..len: style',
  'rp-perf-style/rperf-ref-vec-or-string-param': '&Vec or &String parameter: style',
  'rp-perf-style/rperf-box-vec': 'Box<Vec<T>>: style',
  'rp-perf-style/rperf-option-option': 'Option<Option<T>>: style',
  'rp-perf-style/rperf-unwrap-or-new-container': 'unwrap_or(Vec::new()): micro-performance style',
  'rp-perf-style/rperf-clone-twice': 'clone() twice in a row: micro-performance style',
  'rp-perf-style/rperf-to-vec-only-for-len': 'copy only to take a length: micro-performance style',
  'rp-perf-style/rperf-match-bool-literals': 'match on a bool: style',
  'rp-perf-style/rperf-println-in-library': 'a library prints to stdout: style',
  'rp-perf-style/rperf-allow-clippy-group': 'a whole clippy group allowed: lint policy',
  'rp-perf-style/rperf-allow-dead-code-crate': 'dead_code allowed crate-wide: lint policy',
  'rp-cargo/rcargo-missing-description': 'Cargo package metadata: publishing housekeeping',
  'rp-cargo/rcargo-missing-license': 'Cargo package metadata: publishing housekeeping',
  'rp-cargo/rcargo-missing-edition': 'Cargo package metadata: housekeeping',
  'rp-cargo/rcargo-edition-old': 'old Rust edition: modernisation advice',
  'rp-cargo/rcargo-openssl-dependency': 'openssl versus rustls: informational preference',
  'rp-cargo/rcargo-workspace-no-resolver': 'workspace resolver setting: modernisation advice',
  'rp-api-ffi-wasm/rapi-glob-reexport': 'pub use x::*: API design preference',
  'rp-api-ffi-wasm/rapi-extern-block-no-link': 'extern block without #[link]: informational',
  'rp-async/rasync-runtime-built-per-call': 'tokio runtime built per call: informational performance note',
}

export const BUGS_PRESET_ABOUT = 'the quick run without style, documentation and housekeeping rules: a finding is likely a real bug'
export const BUGS_PRESET_PURPOSE = 'Use it to hunt defects. It runs the quick checks but leaves out rules that are only about style, documentation, formatting or housekeeping, such as undocumented public items, markdownlint and missing Debug derives, so a finding is likely a real bug. Security checks all stay on, and docs/checks.md lists what is left out and why.'
