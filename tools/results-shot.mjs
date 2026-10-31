// Draws the results screen (the REAL renderResults) with sample data to ANSI files for tools/screenshot.py. Nothing reads your files.
//   node tools/results-shot.mjs <folder>     writes results-preview-{findings,checks,timeline,finding-detail,check-detail}.ansi into the folder
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initialResultsState, renderResults } from '../lib/tui/results.mjs'
import { sampleData } from '../lib/tui/resultssample.mjs'

const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })
const data = sampleData()
const opts = { width: 110, rows: 42, color: true, level: 'truecolor', env: {} }
const shots = {
  findings: { ...initialResultsState({ message: `Findings written to ${data.runDir}` }), cursor: { findings: 5, checks: 0, timeline: 0 } },
  checks: { ...initialResultsState(), tab: 'checks', cursor: { findings: 0, checks: 12, timeline: 0 } },
  timeline: { ...initialResultsState(), tab: 'timeline', cursor: { findings: 0, checks: 0, timeline: 20 } },
  'finding-detail': { ...initialResultsState(), detail: { kind: 'finding', id: data.findings.find((f) => f.severity === 'high').id, scroll: 0 } },
  'check-detail': { ...initialResultsState({ message: 'Findings folder created: C:/Users/sam/.meerkat/logs/runs/20261031-142305-full  (path copied to clipboard)' }), tab: 'checks', detail: { kind: 'check', id: 'check-003', scroll: 0 } },
}
for (const [name, state] of Object.entries(shots)) writeFileSync(join(dir, `results-preview-${name}.ansi`), `${renderResults(state, data, opts).join('\n')}\n`)
console.log(Object.keys(shots).join(' '))
