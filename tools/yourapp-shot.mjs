// Prints the "Your app" menu screens as ANSI text, drawn by the REAL functions with made-up sample data (a made-up project path and
// made-up checks), for tools/screenshot.py. Nothing here reads your files, runs a check or touches the network.
//   node tools/yourapp-shot.mjs > yourapp-menu.ansi ; python tools/screenshot.py yourapp-menu.ansi yourapp-menu-preview.png
//   add "plain" for the no-colour version, "narrow" for 60 columns
import { initialState, menuItems, menuStep, renderScreen, suitePickerItems } from '../lib/menu.mjs'
import { checkDetailLines, checkItems, checksHint, ideaDetailLines, ideaItems, ideasHint, renderDetailScreen } from '../lib/yourappscreen.mjs'

const args = process.argv.slice(2)
const color = !args.includes('plain')
const width = args.includes('narrow') ? 60 : 100
const project = 'C:\\Users\\sam\\code\\shop-app'
const common = { project, version: '1.3.2', width, color, level: color ? 'truecolor' : false, env: color ? {} : { NO_COLOR: '1' }, isTTY: true }

const rows = [
  { id: 'e2e', title: 'End-to-end tests', origin: 'project', label: 'project', suite: 'shop-app', group: 'functionality', tier: 'thorough', where: 'meerkat.config.json (customChecks)', editable: true, command: 'npm run test:e2e', installed: true, missing: [] },
  { id: 'smoke-api', title: 'API smoke test', origin: 'project', label: 'project', suite: 'shop-app', group: 'functionality', tier: 'fast', where: 'meerkat.config.json (customChecks)', editable: true, command: 'node scripts/smoke.mjs', installed: true, missing: [] },
  { id: 'load-test', title: 'Checkout load test', origin: 'personal', label: 'yours', suite: 'shop-app', group: 'performance', tier: 'thorough', where: '~/.meerkat.json (customChecks)', editable: true, command: 'k6 run load/checkout.js', installed: false, missing: ['k6'] },
]
const last = new Map([['e2e', { status: 'PASS', ms: 84200 }], ['smoke-api', { status: 'FAIL', ms: 3100 }]])
const ideas = [
  { id: 'app-lint', title: 'Lint', cmd: 'npm', args: ['run', 'lint'], why: 'package.json has a "lint" script', group: 'refactor', tier: 'fast', estSeconds: 30 },
  { id: 'app-typecheck', title: 'Type check', cmd: 'npm', args: ['run', 'typecheck'], why: 'package.json has a "typecheck" script', group: 'functionality', tier: 'fast', estSeconds: 30 },
  { id: 'app-playwright', title: 'Playwright tests', cmd: 'npx', args: ['playwright', 'test'], why: 'playwright.config found', group: 'functionality', tier: 'thorough', estSeconds: 300 },
  { id: 'app-compose-config', title: 'Compose file resolves', cmd: 'docker', args: ['compose', 'config', '--quiet'], why: 'docker-compose.yml found', group: 'functionality', tier: 'fast', estSeconds: 5 },
]

const screens = []
const list = (items, cursor, o) => renderScreen({ items, cursor, multi: false }, { ...common, rows: 20, question: o.question, hint: o.hint, hotkey: false })
let home = initialState(menuItems({ user: {}, project: {}, yourApp: { checks: rows.length, ideas: ideas.length } }))
for (let i = 0; i < 11; i++) home = menuStep(home, 'down').state
screens.push(renderScreen(home, { ...common, rows: 50, question: 'What would you like to run?', hint: '  Up/Down move   Enter choose   1-9 jump   d details   u check for updates   q quit', hotkey: true }))
screens.push(list(checkItems(rows, last), 0, { question: "Your app's checks", hint: checksHint }))
screens.push(renderDetailScreen(checkDetailLines(rows[2], null), { ...common, rows: 20 }))
screens.push(list(ideaItems(ideas), 2, { question: `Ideas: tests this app could run (${ideas.length})`, hint: ideasHint }))
screens.push(renderDetailScreen(ideaDetailLines(ideas[2]), { ...common, rows: 20, hint: '  a add it   any other key goes back' }))
const pickerRows = [
  { id: 'e2e', suite: 'shop-app', subs: 1, title: 'End-to-end tests', origin: 'project', suiteLabel: 'Shop app', suitePurpose: 'The tests only the shop has.' },
  { id: 'smoke-api', suite: 'shop-app', subs: 1, title: 'API smoke test', origin: 'project' },
  { id: 'secret-scan', suite: 'secrets', subs: 4, title: 'Secret scan' },
  { id: 'risky-code', suite: 'risky-calls', subs: 5, title: 'Risky calls' },
]
screens.push(renderScreen({ items: suitePickerItems(pickerRows), cursor: 1, multi: true }, { ...common, rows: 20, question: 'Tick the suites to run. Space ticks a whole suite, Right opens it to tick single checks, Enter runs.', hint: '  Up/Down move, Space ticks, Right opens a suite, Enter runs, q goes back' }))

process.stdout.write(`${screens.map((s) => s.map((l) => l.text).join('\n')).join('\n\n')}\n`)
