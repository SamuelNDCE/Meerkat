// What a first scan shows by default. Two ideas, both about the reader's time, neither about hiding a defect:
//   roll-up:  size and complexity measures (line length, long functions, complexity, nesting, parameters) are measurements, not bugs. A file with 40 long
//             lines is ONE finding that says so, with the first lines listed, instead of 40.
//   hidden:   pedantic style rules (undocumented Rust items, string errors, markup nitpicks) are real but never urgent. The Rust style rules are not even
//             evaluated by default (thorough/rules.mjs reports them as not applicable, so no check fails or passes because of them) and an earlier finding of
//             such a rule is not reported as fixed; markup nitpicks are evaluated and counted in doc.hidden. MEERKAT_FINDINGS=all turns everything back on.
// Security, correctness and configuration rules are never rolled up or hidden.

import { QUARANTINED } from './quarantine.mjs'

// One finding per rule per file.
export const ROLLUP_RULES = new Set(['line-length', 'long-functions', 'cyclomatic-complexity', 'deep-nesting', 'many-parameters'])

// Rust style families (documentation, error style, performance hints, async hints) at low or info severity.
const RUST_STYLE = /^r(api|err|perf|async)-/
// Rules in that family that touch security stay on: a name that mentions a secret, eval, HTML or an unsafe pointer, a network timeout, SQL or a command is never part of the style group.
const SECURITY_RELEVANT = /(secret|eval|html|sink|cstr|unchecked|ffi|sql|shell|command|traversal|timeout|tls|cert|crypto|password|token|transmute|unsafe)/
// Markup and text nitpicks that do not change what the project does.
const MARKUP_NITS = new Set(['markdown-code-fences', 'markdown-headings', 'final-newline', 'whitespace', 'trailing-whitespace', 'html-structure', 'table-headers'])

// Pedantic Rust rules promoted to the default run (planted recall 4 of 4 in all mode; precise on real code, a few keep one labelled false alarm each). The other rules of the family stay hidden.
export const PROMOTED_RUST_RULES = new Set([
  'rapi-extern-block-no-link', 'rapi-glob-reexport', 'rapi-missing-debug-derive', 'rapi-missing-docs-lint', 'rapi-pub-fn-undocumented',
  'rapi-pub-type-undocumented', 'rapi-serde-json-unwrap', 'rapi-serde-untagged', 'rapi-wasm-no-panic-hook', 'rasync-block-on-in-async',
  'rasync-blocking-fs', 'rasync-blocking-lock-in-async', 'rasync-blocking-net', 'rasync-blocking-thread-sleep', 'rasync-future-call-discarded',
  'rasync-main-in-library', 'rasync-pub-trait-async-no-send', 'rasync-reqwest-blocking', 'rasync-runtime-built-per-call',
  'rasync-select-no-cancel-note', 'rasync-spawn-blocking-awaits', 'rasync-spawn-handle-dropped', 'rasync-std-mpsc-in-async-file',
  'rasync-std-mutex-across-await', 'rasync-stdin-read-in-async', 'rasync-sync-recv-in-async', 'rasync-unbounded-channel',
  'rasync-zero-sleep-busy-loop', 'rerr-box-dyn-error-public', 'rerr-catch-unwind-in-library', 'rerr-env-var-unwrap', 'rerr-expect-empty-message',
  'rerr-expect-generic-message', 'rerr-let-underscore-result', 'rerr-main-question-no-result', 'rerr-map-err-discards-source',
  'rerr-map-err-to-string', 'rerr-panic-in-library', 'rerr-parse-unwrap', 'rerr-process-exit-in-library', 'rerr-string-error-result',
  'rerr-unreachable-in-library', 'rerr-unwrap-in-drop', 'rerr-unwrap-or-builds-value', 'rperf-allow-clippy-group', 'rperf-allow-dead-code-crate',
  'rperf-bool-eq-literal', 'rperf-box-vec', 'rperf-clone-twice', 'rperf-collect-then-iterate', 'rperf-dbg-left-in', 'rperf-format-no-args',
  'rperf-format-to-string-arg', 'rperf-index-range-loop', 'rperf-is-some-then-unwrap', 'rperf-iter-count', 'rperf-len-compare-zero',
  'rperf-map-identity', 'rperf-match-bool-literals', 'rperf-nth-zero', 'rperf-option-option', 'rperf-println-in-library', 'rperf-push-str-format',
  'rperf-ref-vec-or-string-param', 'rperf-regex-compiled-per-call', 'rperf-sort-float-partial-unwrap', 'rperf-to-vec-only-for-len',
  'rperf-unwrap-or-new-container',
  // Promoted after their labelled false alarms were narrowed away (a few keep one labelled false alarm each, see benchmarks/real-rust/README.md).
  'rasync-global-mutable-state', 'rasync-thread-spawn-discarded', 'rerr-anyhow-in-library', 'rerr-assert-in-library', 'rerr-error-no-display',
  'rerr-len-narrowing-cast', 'rerr-lock-unwrap-poison', 'rerr-match-err-swallowed', 'rerr-ok-discards-error', 'rerr-unit-error-type', 'rperf-vec-new-in-loop',
  // A data-loss bug (a swallowed read error becomes an empty file that overwrites the real one), added 2026-11 from a real fix in an Electron app.
  'rerr-swallowed-read-then-write',
])

// A finding whose rule (or check) is quarantined: audits judged the rule mostly false (lib/quarantine.mjs).
export const isQuarantined = (f) => QUARANTINED.has(f.rule ?? f.check ?? '')

export const isHiddenByDefault = (f) => {
  const rule = f.rule ?? f.check ?? ''
  if (isQuarantined(f)) return true
  if (MARKUP_NITS.has(rule)) return true
  if (PROMOTED_RUST_RULES.has(rule)) return false
  return RUST_STYLE.test(rule) && !SECURITY_RELEVANT.test(rule) // the Rust style family (the run 5 audit: 1 of 36 sampled medium findings useful, 16 false, 18 noise), minus anything that touches security
}

// A pedantic rule is not worth running at all in the default view: its findings would only be counted and hidden, so the rule engine skips it (saving the work and the noise).
export const isPedanticRule = (rule, severity) => isHiddenByDefault({ rule, severity })

export const showAll = (env = process.env) => String(env?.MEERKAT_FINDINGS ?? '').toLowerCase() === 'all'

// merged: Map(id -> finding) built by buildFindings. Returns { rolled, hidden } where rolled is how many findings were folded away and hidden is
// [{ rule, count }]; the map is changed in place (rolled-up findings replaced by one per rule and file, hidden ones removed unless showAll).
export function applyRollup(merged, { all = false, fingerprint }) {
  const groups = new Map()
  for (const [id, f] of merged) {
    const rule = f.rule ?? f.check ?? ''
    if (!ROLLUP_RULES.has(rule)) continue
    const key = `${rule}\u0000${f.file ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push([id, f])
  }
  let rolled = 0
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const [, first] = members[0]
    const lines = members.flatMap(([, f]) => f.lines?.length ? f.lines : f.line ? [f.line] : []).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b)
    const total = members.reduce((t, [, f]) => t + (f.occurrences ?? 1), 0)
    for (const [id] of members) merged.delete(id)
    const message = `${total} places in this file: ${first.title}. First at ${lines.slice(0, 5).map((n) => `line ${n}`).join(', ')}${lines.length > 5 ? `, and ${lines.length - 5} more` : ''}. Worst case as reported: ${first.message}`
    const id = fingerprint({ rule: first.rule, check: first.check, file: first.file, message: `${first.rule ?? first.check} rolled up` })
    merged.set(id, { ...first, id, legacyId: undefined, legacyOccurrences: undefined, message, line: lines[0] ?? first.line, lines: lines.slice(0, 20), occurrences: total, rolledUp: members.length })
    rolled += members.length - 1
  }
  const hiddenBy = new Map()
  const hiddenIds = new Set()
  const hiddenChecks = new Set()
  if (!all) {
    for (const [id, f] of [...merged]) {
      if (!isHiddenByDefault(f)) continue
      hiddenBy.set(f.rule ?? f.check, (hiddenBy.get(f.rule ?? f.check) ?? 0) + 1)
      hiddenIds.add(id)
      hiddenChecks.add(f.check)
      merged.delete(id)
    }
  }
  return { rolled, hiddenIds, hiddenChecks, hidden: [...hiddenBy].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count) }
}
