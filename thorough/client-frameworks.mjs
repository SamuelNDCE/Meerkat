// Client-framework checks (the cf-* checks): React (cf-react), Android manifests and React Native (cf-mobile) and Next.js (cf-next), built
// from the rule tables in thorough/rules-client-frameworks.mjs; each rule prints one MEERKAT-SUB line (docs/suites.md). Run through the
// client-frameworks pack, or by hand:
//   node thorough/client-frameworks.mjs <check> [--root <dir>]      node thorough/client-frameworks.mjs <check> --fixtures   (must exit 1)
// A rule reads only the files of its own kind, so it is NA (a pass) in a folder without them. A finding you accept goes in
// .meerkat-clientframeworks-allow as "<rule-id> <path>" or "<rule-id> *".
import { main, withFixture } from './kit.mjs'
import { scanRules } from './rules.mjs'
import { CHECK_TABLES } from './rules-client-frameworks.mjs'

const ALLOW = '.meerkat-clientframeworks-allow'
const sampleName = (r) => r.sample ?? `sample.${(r.ext ?? ['txt'])[0]}`
const fixtureFiles = (table) => Object.fromEntries(table.map((r, i) => [`s${i}/${sampleName(r)}`, r.bad]))

const checks = {}
for (const [id, table] of Object.entries(CHECK_TABLES)) {
  const run = (root) => scanRules(id, root, table, { allowFile: ALLOW, okNote: 'no risky client-framework code found' })
  checks[id] = { run, fixture: () => withFixture(fixtureFiles(table), run) }
}

await main(checks)
