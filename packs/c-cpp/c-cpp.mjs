// The c-cpp pack: data-driven rules for C and C++ (see rules.json and lib/datarules.mjs). Turn it on with { "packs": ["c-cpp"] }.
import { fileURLToPath } from 'node:url'
import { dataRuleChecks, loadRuleFile, readText, trackedFiles } from '../../lib/datarules.mjs'

// Invalid rules are dropped here; the datarules test reports them.
const { rules } = loadRuleFile(fileURLToPath(new URL('./rules.json', import.meta.url)))

export default dataRuleChecks(rules, { trackedFiles, readText })
