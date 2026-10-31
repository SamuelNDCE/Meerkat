// The menu screens for the checks that are yours: "Your app's checks", a check's details, and "Ideas". Pure: data in, items or lines
// out, one key in, the next state out. lib/yourappmenu.mjs draws them and does what the keys ask. Same look as lib/menuscreen.mjs.
import { commandText } from './customchecks.mjs'
import { headerLines } from './menuscreen.mjs'
import { stripControl } from './tui/safe.mjs'

const clean = (t) => stripControl(String(t ?? ''))
const cut = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…`.slice(0, width) : text)
const selectable = (it) => it.kind === 'item'

// The home menu's "Your app" section: shown when the project has checks of its own or ideas. Returns [] when it has neither.
export function yourAppMenuItems({ checks = 0, ideas = 0 } = {}) {
  if (!checks && !ideas) return []
  const items = [{ kind: 'heading', label: 'Your app' }]
  if (checks) items.push({ kind: 'item', label: `Your app's checks (${checks})`, value: { type: 'yourchecks' }, about: 'The tests you added: run one, change it, remove it' })
  items.push({ kind: 'item', label: 'Add a test for this app', value: { type: 'addtest' }, about: 'Name a command your app already has, such as npm run test:e2e' })
  if (ideas) items.push({ kind: 'item', label: `Ideas (${ideas})`, value: { type: 'ideas' }, about: `Add tests for this app (${ideas} idea${ideas === 1 ? '' : 's'}) found in this folder` })
  return items
}

const secondsText = (ms) => (ms === null || ms === undefined ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
export const lastText = (last) => (last ? `${last.status}${last.ms !== undefined ? ` ${secondsText(last.ms)}` : ''}` : 'not run yet')

// The list of your checks: id, then origin tag, suite and last result on the right.
export function checkItems(rows, last = new Map()) {
  return rows.map((r) => ({ kind: 'item', label: clean(r.id), value: r.id, about: `${r.label || 'yours'} | ${clean(r.suite)} | ${r.tier}${r.installed ? '' : ` | needs ${clean(r.missing.join(', '))}`}`, time: lastText(last.get(r.id)) }))
}

// Everything about one check, as lines of text.
export function checkDetailLines(r, last = null) {
  const l = last ?? null
  return [
    `${clean(r.id)}: ${clean(r.title)}`,
    '',
    `  tag         ${r.label || 'yours'} (${r.origin === 'personal' ? 'in every project' : 'this project'})`,
    `  suite       ${clean(r.suite)}`,
    `  kind, tier  ${r.group}, ${r.tier}`,
    `  command     ${clean(r.command)}`,
    `  defined in  ${clean(r.where)}`,
    `  program     ${r.installed ? 'found on this PC' : `NOT FOUND: ${clean(r.missing.join(', '))} (the check will say NOT RUN)`}`,
    `  last run    ${lastText(l)}`,
    ...(r.editable ? [] : ['', '  This check is written in code, so change it by editing that file.']),
  ]
}

export function ideaItems(ideas) {
  return ideas.map((i) => ({ kind: 'item', label: clean(i.id), value: i.id, about: `${clean(i.title)}: ${clean(commandText(i.cmd, i.args))}` }))
}

export function ideaDetailLines(i) {
  return [`${clean(i.id)}: ${clean(i.title)}`, '', `  would run   ${clean(commandText(i.cmd, i.args))}`, `  why         ${clean(i.why)}`, `  kind, tier  ${i.group}, ${i.tier}`, `  about       ${i.estSeconds ?? 60} s`, '', '  Press a to add it as a check of this project. Nothing runs until you run Meerkat.']
}

// One key in the list screens. mode 'checks': r run, e edit, x remove, a add. mode 'ideas': a add, A add all. Enter opens the details.
export function listStep(state, key, mode = 'checks') {
  const n = state.items.length
  const move = (dir) => {
    for (let step = 1; step <= n; step++) {
      const at = (state.cursor + dir * step + n * step) % n
      if (selectable(state.items[at])) return { ...state, cursor: at }
    }
    return state
  }
  if (key === 'up' || key === 'k') return { state: move(-1), action: null }
  if (key === 'down' || key === 'j') return { state: move(1), action: null }
  if (key === 'ctrl-c') return { state, action: { type: 'abort' } }
  if (key === 'escape' || key === 'q') return { state, action: { type: 'back' } }
  const cur = state.items[state.cursor]
  if (!cur || !selectable(cur)) return { state, action: null }
  if (key === 'enter') return { state, action: { type: 'open', item: cur } }
  if (mode === 'checks') {
    if (key === 'r') return { state, action: { type: 'run', item: cur } }
    if (key === 'e') return { state, action: { type: 'edit', item: cur } }
    if (key === 'x') return { state, action: { type: 'remove', item: cur } }
    if (key === 'a') return { state, action: { type: 'add' } }
  } else {
    if (key === 'a') return { state, action: { type: 'add', item: cur } }
    if (key === 'A') return { state, action: { type: 'addall' } }
  }
  return { state, action: null }
}

export const checksHint = '  Up/Down move   Enter details   r run just this   e edit   x remove   a add new   Esc back'
export const ideasHint = '  Up/Down move   Enter why   a add this one   A add all   Esc back'
export const detailsHint = '  r run just this   e edit   x remove   any other key goes back'

// A details screen: the header, the lines, the key hint. Returns [{ text, style: 'raw' }].
export function renderDetailScreen(lines, { hint = detailsHint, screen = '', project = null, version = '', question = '', update = null, width = 80, rows = 24, color = false, level = false, env = process.env, isTTY = true } = {}) {
  const w = Math.max(10, width - 1)
  const head = headerLines({ screen, version, project, question, update, hotkey: false, width, rows, color, level, env, isTTY })
  const room = Math.max(3, rows - 1 - head.length - 2)
  const body = lines.slice(0, room).map((t) => cut(t, w))
  const dim = (t) => (color ? `\x1b[2m${t}\x1b[0m` : t)
  return [...head, ...body, '', dim(cut(hint, w))].map((text) => ({ text, style: 'raw' }))
}
