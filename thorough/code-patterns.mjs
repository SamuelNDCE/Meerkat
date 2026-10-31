// Code-pattern checks: one check per language family (cp-python, cp-js, cp-go, cp-rust, cp-java, cp-dotnet-php-ruby). Each check is one
// rule table in thorough/rules-code-patterns.mjs and prints one MEERKAT-SUB line per rule (the sub-check protocol, docs/suites.md).
// Run through the code-patterns pack, or by hand:
//   node thorough/code-patterns.mjs <check> [--root <dir>]      node thorough/code-patterns.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-codepatterns-allow: "<rule-id> <path>" (or "<rule-id> *"), one per line, # for comments.
import { main, withFixture } from './kit.mjs'
import { scanRules } from './rules.mjs'
import { CHECK_TABLES } from './rules-code-patterns.mjs'

const ALLOW = '.meerkat-codepatterns-allow'

// One file per rule, named for the rule's own extension, holding that rule's bad sample (or good sample for the clean run).
const sampleFiles = (table, which) => Object.fromEntries(table.map((r, i) => [`s${i}/${r.files ? 'src/lib.rs' : `sample.${r.ext[0]}`}`, r[which]]))

const checks = {}
for (const [id, table] of Object.entries(CHECK_TABLES)) {
  checks[id] = {
    run: (root) => scanRules(id, root, table, { allowFile: ALLOW, okNote: 'no code pattern found' }),
    fixture: () => withFixture(sampleFiles(table, 'bad'), (dir) => scanRules(id, dir, table, { allowFile: ALLOW })),
  }
}

await main(checks)
