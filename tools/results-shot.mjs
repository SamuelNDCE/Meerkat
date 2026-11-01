// Draws the results screen (the REAL renderResults) with SAMPLE data to ANSI files for tools/screenshot.py. Nothing reads your files.
//   node tools/results-shot.mjs <folder>     writes results-preview-{findings,checks,timeline,happy,finding-detail,check-detail}.ansi into the folder
// Every picture ends with a line saying it is made-up data (SAMPLE_NOTE), and the project is the made-up C:/Users/SamuelNDCE/code/plume.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { initialResultsState, renderResults } from '../lib/tui/results.mjs'
import { cleanSampleData, sampleData, SAMPLE_NOTE } from '../lib/tui/resultssample.mjs'

const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })
const data = sampleData()
const clean = cleanSampleData()
const opts = { width: 110, rows: 30, color: true, level: 'truecolor', env: { MEERKAT_NO_UPDATE_NOTE: '1' } }
const note = `\x1b[1;33m  ${SAMPLE_NOTE}\x1b[0m`
const shots = {
  findings: [data, { ...initialResultsState({ message: `Findings written to ${data.runDir}` }), hint: false, cursor: { findings: 4, checks: 0, timeline: 0 } }],
  checks: [data, { ...initialResultsState(), hint: false, tab: 'checks', cursor: { findings: 0, checks: 8, timeline: 0 } }],
  timeline: [data, { ...initialResultsState(), hint: false, tab: 'timeline', cursor: { findings: 0, checks: 0, timeline: 6 } }],
  happy: [clean, { ...initialResultsState({ message: `Nothing to report. Run folder: ${clean.runDir}` }), hint: false }],
  'finding-detail': [data, { ...initialResultsState(), detail: { kind: 'finding', id: data.findings.find((f) => f.severity === 'high').id, scroll: 0 } }],
  'check-detail': [data, { ...initialResultsState(), tab: 'checks', detail: { kind: 'check', id: 'clippy', scroll: 0 } }],
}
for (const [name, [d, state]] of Object.entries(shots)) writeFileSync(join(dir, `results-preview-${name}.ansi`), `${[...renderResults(state, d, opts), note].join('\n')}\n`)
console.log(Object.keys(shots).join(' '))
