// Rust deep-rule checks: one check per family (rp-safety, rp-errors, rp-async, rp-perf-style, rp-cargo, rp-api-ffi-wasm). Each check is one
// rule table in thorough/rules-rust-plus.mjs and prints one MEERKAT-SUB line per rule (the sub-check protocol, docs/suites.md).
// Run through the rust-plus pack, or by hand:
//   node thorough/rust-plus.mjs <check> [--root <dir>]      node thorough/rust-plus.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-rustplus-allow: "<rule-id> <path>" (or "<rule-id> *"), one per line, # for comments.
import { main, withFixture } from './kit.mjs'
import { scanRules } from './rules.mjs'
import { CHECK_TABLES } from './rules-rust-plus.mjs'

const ALLOW = '.meerkat-rustplus-allow'

// One file per rule in its own folder: the rule's sample file (its own `sample` path, or a default for its extension or files pattern).
const defaultPath = (r) => (r.sample ? r.sample : r.files ? 'src/lib.rs' : `sample.${r.ext[0]}`)
const sampleFiles = (table, which) => Object.fromEntries(table.map((r, i) => [`s${i}/${defaultPath(r)}`, r[which]]))

const checks = {}
for (const [id, table] of Object.entries(CHECK_TABLES)) {
  checks[id] = {
    run: (root) => scanRules(id, root, table, { allowFile: ALLOW, okNote: 'no rust finding' }),
    fixture: () => withFixture(sampleFiles(table, 'bad'), (dir) => scanRules(id, dir, table, { allowFile: ALLOW })),
  }
}

await main(checks)
