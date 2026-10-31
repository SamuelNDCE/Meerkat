// Prints a Meerkat menu screen as ANSI text, drawn by the REAL functions with sample data (a made-up project path, and a made-up
// update 1.4.0 against 1.3.2), for tools/screenshot.py. Nothing here reads your files or the network.
//   node tools/menu-shot.mjs > menu.ansi ; python tools/screenshot.py menu.ansi menu.png        the home screen (preset menu)
//   node tools/menu-shot.mjs after-run > after.ansi ; python tools/screenshot.py after.ansi after-run.png   the screen after a run
//   add "plain" for the no-colour, no-art version; "narrow" for 60 columns
import { initialState, menuItems, menuStep, renderPicker, renderScreen, withUpdateBar } from '../lib/menu.mjs'

const args = process.argv.slice(2)
const color = !args.includes('plain')
const width = args.includes('narrow') ? 60 : 100
const update = args.includes('noupdate') ? null : { latest: '1.4.0', current: '1.3.2' }
const CODES = { title: '\x1b[1m', heading: '\x1b[1;36m', cursor: '\x1b[7m', about: '\x1b[33m', hint: '\x1b[2m', plain: '' }

let lines
if (args.includes('after-run')) {
  const items = [
    ['OK, done', 'close this screen'],
    ['Back to the menu', 'pick another preset for the same project'],
    ['Show a log', 'read the full log of one check (failed ones first)'],
    ['Copy a log path', 'put the path of one check log on the clipboard'],
    ['Show the report', 'the summary of this run'],
    ['Show repo changes', 'uncommitted files and the last commit'],
    ['Run again', 'repeat the same run'],
  ].map(([label, about], i) => ({ kind: 'item', label, value: i, about }))
  const state = { ...initialState(items), cursor: 2 }
  const body = renderPicker(state, { title: '', question: 'Verification finished. What next? (Up/Down, Enter)', hint: '  Up/Down or j/k move, Enter chooses, q quits', maxRows: 20, width })
  lines = withUpdateBar(body, update, { width, color })
} else {
  const user = { 'my-checks': { tier: 'fast', groups: ['security', 'ui'], about: 'Security and UI checks I run before a demo' } }
  let state = initialState(menuItems({ user, project: {}, update }))
  state = menuStep(state, 'down').state // the highlight on the second item, as a person would see it
  lines = renderScreen(state, {
    project: 'C:\\Users\\sam\\code\\shop-app',
    version: '1.3.2',
    question: 'What would you like to run?',
    hint: '  Up/Down move   Enter choose   1-9 jump   u update   q quit',
    update,
    hotkey: true,
    width,
    rows: 50,
    color,
    level: color ? 'truecolor' : false,
    env: color ? {} : { NO_COLOR: '1' },
    isTTY: true,
  })
}
process.stdout.write(lines.map((l) => (l.style === 'raw' ? l.text : color && CODES[l.style] ? `${CODES[l.style]}${l.text}\x1b[0m` : l.text)).join('\n') + '\n')
