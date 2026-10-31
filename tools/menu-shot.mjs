// Prints the "what next" menu shown after a run, with colour codes, for tools/screenshot.py.
//   node tools/menu-shot.mjs > menu.ansi ; python tools/screenshot.py menu.ansi docs/images/after-run.png
import { initialState, renderPicker } from '../lib/menu.mjs'

const CODES = { title: '\x1b[1m', heading: '\x1b[1;36m', cursor: '\x1b[7m', about: '\x1b[33m', hint: '\x1b[2m', plain: '' }
const items = [
  ['OK, done', 'close this screen'],
  ['Open a log', 'read the output of one check'],
  ['Copy a log path', 'put the path of one check log on the clipboard'],
  ['Show the report', 'the summary of this run'],
  ['Show repo changes', 'uncommitted files and the last commit'],
  ['Run again', 'repeat the same run'],
].map(([label, about], i) => ({ kind: 'item', label, value: i, about }))
let state = initialState(items)
state = { ...state, cursor: 1 }
const lines = renderPicker(state, { title: '', question: 'Verification finished. What next? (Up/Down, Enter)', hint: '  Up/Down or j/k move, Enter chooses, q quits', maxRows: 20, width: 80 })
process.stdout.write(lines.map((l) => (CODES[l.style] ? `${CODES[l.style]}${l.text}\x1b[0m` : l.text)).join('\n') + '\n')
