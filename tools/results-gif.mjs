// Records the results screen being used, as frames for tools/make_gif.py: the findings list scrolling, Tab to the checks, Tab to the
// timeline, scrolling down through everything. The REAL renderResults and resultsStep, SAMPLE data. Frames are split by a form-feed line.
//   node tools/results-gif.mjs frames.txt && python tools/make_gif.py frames.txt docs/images/results-scroll.gif
import { writeFileSync } from 'node:fs'
import { initialResultsState, renderResults, resultsStep } from '../lib/tui/results.mjs'
import { sampleData, SAMPLE_NOTE } from '../lib/tui/resultssample.mjs'

const data = sampleData()
const opts = { width: 110, rows: 30, color: true, level: 'truecolor', env: { MEERKAT_NO_UPDATE_NOTE: '1' } }
const note = `\x1b[1;33m  ${SAMPLE_NOTE}\x1b[0m`
let state = initialResultsState()
const frames = []
const snap = () => frames.push([...renderResults(state, data, opts), note].join('\n'))
const press = (key, times = 1) => {
  for (let i = 0; i < times; i++) state = resultsStep(state, key, data, { rows: opts.rows }).state
  snap()
}
snap()
// Three rows per frame, so the scrolling reads as scrolling and not as a jump, and it keeps going until the list stops
// moving (the last row), so the GIF always reaches the end of the findings, the checks and the timeline.
const SKIP = 3
const hold = (n) => { for (let i = 0; i < n; i++) snap() }
const scrollToEnd = () => {
  const tab = state.tab
  for (let guard = 0; guard < 500; guard++) {
    const before = state.cursor[tab]
    for (let i = 0; i < SKIP; i++) state = resultsStep(state, 'down', data, { rows: opts.rows }).state
    if (state.cursor[tab] === before) break
    snap()
  }
  hold(4)
}
hold(6)
scrollToEnd()
press('tab')
hold(6)
scrollToEnd()
press('tab')
hold(6)
scrollToEnd()
hold(4)
writeFileSync(process.argv[2] ?? 'frames.txt', frames.join('\n\f\n'))
console.log(`${frames.length} frames`)
