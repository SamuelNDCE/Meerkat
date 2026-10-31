// The menu you get when you type `meerkat` on its own, and the small "what next?" prompt after a run.
// No dependencies: raw-mode keys, plain ANSI. The key handling is pure (parseKeys, menuStep, lineStep) so it can be tested without a terminal.
import { spawnSync } from 'node:child_process'
import * as nodeFs from 'node:fs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { listPresets, loadPresets, takeWhere } from './cli.mjs'
import { discoverRepos, listDrives, listSubfolders } from './repos.mjs'
import { summaryOf } from './help.mjs'
import { findConfig } from './config.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { cleanAbout, cleanPurpose, PRESETS } from './presets.mjs'
import { detailsStep, renderDetails } from './presetdetails.mjs'
import { latestRunDir, showLast, showWhy } from './runlog.mjs'
import { colorLevel } from './tui/color.mjs'
import { cleanText, safeLogPath, stripControl } from './tui/safe.mjs'
import { createEstimates } from './menuestimate.mjs'
import { renderScreen, withUpdateBar } from './menuscreen.mjs'
import { addTestScreen, checksScreen, ideasScreen, yourAppInfo } from './yourappmenu.mjs'
import { yourAppMenuItems } from './yourappscreen.mjs'
import { defaultLabel } from './customchecks.mjs'
import { applyUpdate, checkForUpdate, clearUpdateCache, readVersion, updateNotice, writeUpdateCache } from './update.mjs'

export { ART_MIN_ROWS, ART_MIN_WIDTH, headerLines, headerMode, renderScreen, updateBar, withUpdateBar } from './menuscreen.mjs'
import { addRecent, readUserConfig, writeUserConfig } from './userconfig.mjs'
import { SUITES, SUITE_CATEGORIES } from './suites.mjs'

const KINDS = ['security', 'functionality', 'ui', 'performance', 'refactor']

// ---------- pure key handling ----------

const ESCAPES = { '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left' }

// Raw text from the keyboard to key names: up, down, left, right, enter, space, escape, backspace, ctrl-c, or the character itself.
export function parseKeys(text) {
  const keys = []
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\x1b') {
      const seq = s.slice(i, i + 3)
      if (ESCAPES[seq]) {
        keys.push(ESCAPES[seq])
        i += 2
      } else if (s[i + 1] === '[' || s[i + 1] === 'O') {
        // an escape sequence we do not use (Home, Delete, F-keys): skip it whole
        let j = i + 2
        while (j < s.length && !/[A-Za-z~]/.test(s[j])) j++
        i = j
      } else keys.push('escape')
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++
      keys.push('enter')
    } else if (c === ' ') keys.push('space')
    else if (c === '\x03') keys.push('ctrl-c')
    else if (c === '\x7f' || c === '\b') keys.push('backspace')
    else if (c >= ' ') keys.push(c)
  }
  return keys
}

const selectable = (it) => it.kind === 'item'
const firstSelectable = (items) => Math.max(0, items.findIndex(selectable))

export function initialState(items, { multi = false } = {}) {
  return { items, cursor: firstSelectable(items), multi }
}

function move(state, dir) {
  const n = state.items.length
  for (let step = 1; step <= n; step++) {
    const at = (state.cursor + dir * step + n * step) % n
    if (selectable(state.items[at])) return { ...state, cursor: at }
  }
  return state
}

// One key in, the next state out, plus an action when the key finishes something:
//   { type: 'choose', item }   Enter on a list         { type: 'submit', values }   Enter on a multi-select with something ticked
//   { type: 'quit' }           q or Esc                { type: 'abort' }            Ctrl+C
export function menuStep(state, key) {
  if (key === 'up' || key === 'k') return { state: move(state, -1), action: null }
  if (key === 'down' || key === 'j') return { state: move(state, 1), action: null }
  if (key === 'q' || key === 'escape') return { state, action: { type: 'quit' } }
  if (key === 'ctrl-c') return { state, action: { type: 'abort' } }
  // A key that does something on its own (state.hotkeys = { u: 'update' }), only on screens that ask for it.
  if (typeof key === 'string' && state.hotkeys && Object.hasOwn(state.hotkeys, key.toLowerCase())) return { state, action: { type: 'hotkey', name: state.hotkeys[key.toLowerCase()] } }
  if (typeof key === 'string' && /^[1-9]$/.test(key) && !state.multi) {
    // a number jumps to that item (counting items only, not headings); Enter then chooses it
    const at = state.items.map((it, i) => (selectable(it) ? i : -1)).filter((i) => i >= 0)[Number(key) - 1]
    return { state: at === undefined ? state : { ...state, cursor: at }, action: null }
  }
  const cur = state.items[state.cursor]
  if (key === 'space' && state.multi && cur && selectable(cur)) {
    // Space on a suite that is partly ticked (some of its checks) ticks all of it.
    const items = state.items.map((it, i) => {
      if (i !== state.cursor) return it
      const { partialValues: _partial, ...rest } = it
      return { ...rest, checked: !it.checked }
    })
    return { state: { ...state, items }, action: null }
  }
  // Right opens an item that holds a list of its own (a suite holds checks): the caller shows that list and comes back.
  if (key === 'right' && state.multi && cur && selectable(cur) && cur.open) return { state, action: { type: 'open', item: cur } }
  if (key === 'enter') {
    if (state.multi) {
      const values = state.items.filter((it) => selectable(it) && (it.checked || it.partialValues?.length)).flatMap((it) => (it.checked ? [it.value] : it.partialValues))
      return { state, action: values.length ? { type: 'submit', values } : null }
    }
    return { state, action: cur && selectable(cur) ? { type: 'choose', item: cur } : null }
  }
  return { state, action: null }
}

// Typing a line of text (a preset name). Enter finishes, Esc cancels.
export function lineStep(state, key) {
  if (key === 'enter') return { state, action: { type: 'submit', value: state.text } }
  if (key === 'escape') return { state, action: { type: 'quit' } }
  if (key === 'ctrl-c') return { state, action: { type: 'abort' } }
  if (key === 'backspace') return { state: { text: state.text.slice(0, -1) }, action: null }
  if (key === 'space') return { state: { text: `${state.text} ` }, action: null }
  if (typeof key === 'string' && key.length === 1) return { state: { text: state.text + key }, action: null }
  return { state, action: null }
}

// ---------- the project picker (pure) ----------

// What `meerkat` asks first: which folder to check. state = { data, drives, filter, cursor }, data = discoverRepos(...).
// Typing letters narrows the repository lists; Backspace removes a letter; Esc clears the filter (and quits when there is none).
export function pickerState(data, { drives = [] } = {}) {
  const state = { data, drives, filter: '', cursor: 0 }
  return { ...state, cursor: firstSelectable(pickerItems(state)) }
}

const filterMatch = (r, f) => !f || `${r.name} ${r.path}`.toLowerCase().includes(f.toLowerCase())
const projectItem = (r) => ({
  kind: 'item',
  label: `${r.name}${r.branch ? `  (${r.branch})` : r.isRepo ? '' : '  (folder)'}`,
  value: { type: 'project', path: r.path },
  about: r.path,
})

export function pickerItems(state) {
  const { data, filter } = state
  const items = []
  const section = (label, rows) => {
    const shown = rows.filter((r) => filterMatch(r, filter))
    if (!shown.length) return
    items.push({ kind: 'heading', label })
    for (const r of shown) items.push(projectItem(r))
  }
  if (data.here) section('Here', [data.here])
  section('Recent', data.recent ?? [])
  section('Repos found', data.found ?? [])
  if (filter && !items.length) items.push({ kind: 'heading', label: `Nothing matches "${filter}" (Backspace to change it)` })
  items.push({ kind: 'heading', label: 'Other ways' })
  const act = (label, type, about) => items.push({ kind: 'item', label, value: { type }, about })
  act('Browse folders...', 'browse', 'Walk through your folders and pick one')
  act('Type or paste a path...', 'type', 'A folder path, or the name of a project')
  if (state.drives.length) act('Choose another drive', 'drive', `Drives: ${state.drives.map((d) => d.slice(0, 2)).join(' ')}`)
  return items
}

const typed = (key) => typeof key === 'string' && key.length === 1 && key >= ' '

function refilter(state, filter) {
  const next = { ...state, filter }
  return { ...next, cursor: firstSelectable(pickerItems(next)) }
}

// One key in, { state, action } out. Actions: { type: 'choose', item }, { type: 'quit' }, { type: 'abort' }.
export function pickerStep(state, key) {
  if (key === 'ctrl-c') return { state, action: { type: 'abort' } }
  if (key === 'escape') return state.filter ? { state: refilter(state, ''), action: null } : { state, action: { type: 'quit' } }
  if (key === 'backspace') return { state: state.filter ? refilter(state, state.filter.slice(0, -1)) : state, action: null }
  if (key === 'up' || key === 'down') {
    const items = pickerItems(state)
    return { state: { ...state, cursor: move({ items, cursor: state.cursor }, key === 'up' ? -1 : 1).cursor }, action: null }
  }
  if (key === 'enter') {
    const cur = pickerItems(state)[state.cursor]
    return { state, action: cur && selectable(cur) ? { type: 'choose', item: cur } : null }
  }
  if (key === 'space' && state.filter) return { state: refilter(state, `${state.filter} `), action: null }
  if (typed(key)) return { state: refilter(state, state.filter + key), action: null }
  return { state, action: null }
}

// ---------- browsing folders (pure) ----------

// state = { dir, entries: [{ name, path, isRepo }], note, filter, cursor }. `read(dir)` is listSubfolders (injected so tests need no disk).
export function browseState(dir, read, keepPath = null) {
  const r = read(dir)
  const state = { dir, entries: r.entries, note: r.note, filter: '', cursor: 0 }
  const at = keepPath ? browseItems(state).findIndex((it) => it.value?.path === keepPath) : -1
  return { ...state, cursor: at >= 0 ? at : 0 }
}

const hasParent = (dir) => dirname(dir) !== dir

export function browseItems(state) {
  const f = state.filter.toLowerCase()
  const items = [{ kind: 'item', label: 'Use this folder', value: { type: 'use' }, about: state.dir }]
  if (hasParent(state.dir)) items.push({ kind: 'item', label: '.. (up)', value: { type: 'up' }, about: dirname(state.dir) })
  for (const e of state.entries) {
    if (f && !e.name.toLowerCase().includes(f)) continue
    items.push({ kind: 'item', label: `${e.name}${e.isRepo ? '  [repo]' : ''}`, value: { type: 'into', path: e.path }, about: e.path })
  }
  return items
}

const firstFolder = (state) => {
  const i = browseItems(state).findIndex((it) => it.value.type === 'into')
  return i >= 0 ? i : 0
}

// Actions: { type: 'use', path }, { type: 'back' } (Esc, or Backspace at the top of a drive), { type: 'abort' }.
export function browseStep(state, key, read) {
  const go = (dir, keepPath) => {
    const next = browseState(dir, read, keepPath)
    // A folder that cannot be opened: stay where we are and say so.
    return next.entries.length === 0 && next.note.startsWith('Cannot') ? { ...state, note: next.note } : next
  }
  const up = () => (hasParent(state.dir) ? { state: go(dirname(state.dir), state.dir), action: null } : { state, action: { type: 'back' } })
  const items = browseItems(state)
  const cur = items[state.cursor]
  if (key === 'ctrl-c') return { state, action: { type: 'abort' } }
  if (key === 'escape') return state.filter ? { state: { ...state, filter: '', cursor: 0 }, action: null } : { state, action: { type: 'back' } }
  if (key === 'up' || key === 'down') return { state: { ...state, cursor: move({ items, cursor: state.cursor }, key === 'up' ? -1 : 1).cursor }, action: null }
  if (key === 'left') return up()
  if (key === 'backspace') {
    if (!state.filter) return up()
    const next = { ...state, filter: state.filter.slice(0, -1) }
    return { state: { ...next, cursor: next.filter ? firstFolder(next) : 0 }, action: null }
  }
  if (key === 'enter' || key === 'right') {
    if (!cur) return { state, action: null }
    if (cur.value.type === 'into') return { state: go(cur.value.path), action: null }
    if (key === 'right') return { state, action: null }
    if (cur.value.type === 'use') return { state, action: { type: 'use', path: state.dir } }
    if (cur.value.type === 'up') return up()
    return { state, action: null }
  }
  const ch = key === 'space' && state.filter ? ' ' : key
  if (typed(ch)) {
    const next = { ...state, filter: state.filter + ch }
    return { state: { ...next, cursor: firstFolder(next) }, action: null }
  }
  return { state, action: null }
}

// A typed or pasted answer to "which folder?": a path (quotes and ~ are fine) or the name of a project, resolved the same way
// `meerkat verify <name>` does. Returns { folder } or { error }.
export function resolveTypedProject(text, { cwd = process.cwd(), env = process.env, home = homedir(), isDir } = {}) {
  let w = String(text ?? '').trim().replace(/^["']|["']$/g, '')
  if (!w) return { error: '' }
  if (w === '~' || /^~[\\/]/.test(w)) w = join(home, w.slice(1))
  const r = takeWhere([w], cwd, env)
  if (r.error) return { error: r.error }
  const ok =
    isDir ??
    ((p) => {
      try {
        return nodeFs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })
  return ok(r.folder) ? { folder: r.folder } : { error: `${r.folder} is not a folder` }
}

// ---------- pure drawing ----------

const cut = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…`.slice(0, width) : text)

// Lines to draw, as { text, style }. Keeps the highlighted item in view when the list is taller than maxRows.
export function renderPicker(state, { title = '', question = '', hint = '', maxRows = 20, width = 80 } = {}) {
  const lines = []
  if (title) lines.push({ text: title, style: 'title' })
  if (question) lines.push({ text: question, style: 'plain' })
  if (title || question) lines.push({ text: '', style: 'plain' })
  const n = state.items.length
  const rows = Math.max(3, maxRows)
  const start = n <= rows ? 0 : Math.min(Math.max(0, state.cursor - Math.floor(rows / 2)), n - rows)
  const end = Math.min(n, start + rows)
  for (let i = start; i < end; i++) {
    const it = state.items[i]
    if (it.kind === 'heading') lines.push({ text: `  ${it.label}`, style: 'heading' })
    else {
      const box = state.multi ? (it.checked ? '[x] ' : it.partialValues?.length ? '[~] ' : '[ ] ') : ''
      lines.push({ text: `${i === state.cursor ? '> ' : '  '}${box}${it.label}`, style: i === state.cursor ? 'cursor' : 'plain' })
    }
  }
  const cur = state.items[state.cursor]
  lines.push({ text: '', style: 'plain' })
  lines.push({ text: cur?.about ? `  ${cur.about}` : '', style: 'about' })
  if (hint) lines.push({ text: hint, style: 'hint' })
  return lines.map((l) => ({ ...l, text: cut(l.text, Math.max(10, width - 1)) }))
}

// ---------- the menu's contents ----------

// The menu's wording comes from the command registry (lib/help.mjs), so the menu and the commands never disagree.
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1)
// The presets on the home menu, in this order. Every other preset (the -fast variants, app, app-fast, your own) is under "More presets...".
export const MAIN_PRESETS = ['quick', 'full', 'security', 'functionality', 'ui', 'performance', 'refactor', 'ci', 'release']

// The presets behind "More presets...": every one that is not on the home menu.
export function otherPresetItems({ user = {}, project = {} } = {}) {
  return listPresets({ user, project })
    .filter((r) => !MAIN_PRESETS.includes(r.name))
    .map((r) => ({ kind: 'item', label: r.name, value: { type: 'preset', name: r.name }, about: cap(r.about ?? '') }))
}

// estimates(name) gives the time text shown right-aligned on a Run row ("about 5 min", "..." while it is being worked out).
// yourApp = { checks: N, ideas: M } adds the "Your app" section (lib/yourappscreen.mjs) when the project has checks of its own or ideas.
export function menuItems({ user = {}, project = {}, update = null, estimates = null, yourApp = null } = {}) {
  const rows = listPresets({ user, project })
  const about = (name) => cap(rows.find((r) => r.name === name)?.about ?? '')
  const preset = (name, timed = false) => ({ kind: 'item', label: name, value: { type: 'preset', name }, about: about(name), ...(timed && estimates ? { time: estimates(name) } : {}) })
  const items = []
  const group = (label, names, timed = false) => {
    if (!names.length) return
    items.push({ kind: 'heading', label })
    for (const n of names) items.push(preset(n, timed))
  }
  group('Run', MAIN_PRESETS.filter((n) => rows.some((r) => r.name === n)), true)
  group('Your presets', rows.filter((r) => r.source !== 'bundled').map((r) => r.name))
  items.push(...yourAppMenuItems(yourApp ?? {}))
  items.push({ kind: 'heading', label: 'More' })
  const act = (label, type, text) => items.push({ kind: 'item', label, value: { type }, about: text })
  act('More presets...', 'morepresets', 'Every other preset: the -fast variants, app, your own')
  act('Choose checks one by one', 'checks', 'Tick the checks you want and run just those')
  act('Create a preset', 'create', cap(summaryOf('preset')))
  act('See the last report', 'last', cap(summaryOf('last')))
  act('Read a log', 'log', cap(summaryOf('why')))
  act('Change project', 'project', 'Pick another folder to check')
  act('Check for updates', 'update', update ? `Version ${update.latest} is available (you have ${update.current}). Press Enter to update` : 'Look for a newer version and install it if you say yes')
  act('Quit', 'quit', 'Leave without running anything')
  return items
}

// Check ids and kinds from `node run.mjs --list`: "id  kind  tier  cost  ~ time  title".
export function parseCheckList(text) {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+(fast|thorough)\b/.exec(line.trim())
    if (m && /^[a-z0-9][a-z0-9._-]*$/i.test(m[1])) out.push({ id: m[1], kind: m[2], tier: m[3] })
  }
  return out
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms || 0)}ms`)
const ORDER = { FAIL: 0, 'NOT RUN': 1 }

// The checks of a run, failed and NOT RUN first.
export function listRunChecks(runDir) {
  try {
    const s = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
    return (s.results ?? [])
      .filter((r) => r && r.id)
      .map((r) => ({ id: String(r.id), status: r.status ?? 'NOT RUN', time: fmtMs(r.ms), detail: r.detail ?? '', logFile: typeof r.logFile === 'string' ? safeLogPath(r.logFile) : null }))
      .sort((a, b) => (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2))
  } catch {
    return []
  }
}

// ---------- saving a preset ----------

export function savePersonalPreset(name, preset, env = process.env, home) {
  const current = readUserConfig(env, home).presets
  const presets = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  writeUserConfig({ presets: { ...presets, [name]: preset } }, env, home)
}

// Adds to meerkat.config.json (creating it if there is none). Everything else in the file is kept. Returns { ok, file } or { ok: false, text }.
export function saveProjectPreset(cwd, name, preset) {
  const file = findConfig({ appDir: cwd, repoRoot: repoRootOf(cwd) }) ?? join(cwd, 'meerkat.config.json')
  let raw = {}
  let crlf = false
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8')
    crlf = text.includes('\r\n')
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, text: `${file} is not valid JSON, so nothing was saved. Fix it, then try again.` }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, text: `${file} is not a JSON object, so nothing was saved.` }
  }
  const presets = raw.presets && typeof raw.presets === 'object' && !Array.isArray(raw.presets) ? raw.presets : {}
  const next = { ...raw, presets: { ...presets, [name]: preset } }
  let out = `${JSON.stringify(next, null, 2)}\n`
  if (crlf) out = out.replace(/\n/g, '\r\n')
  writeFileSync(file, out)
  return { ok: true, file }
}

// ---------- running ----------

// Runs run.mjs with the terminal handed over. Returns its exit code.
export function spawnRun(args, { env = process.env, cwd = process.cwd() } = {}) {
  const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), ...args], { stdio: 'inherit', env, cwd })
  return r.status ?? (r.signal ? 130 : 1)
}

export function getCheckList(cwd, env) {
  const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), '--list', '--app', cwd], { encoding: 'utf8', env, cwd, timeout: 60000 })
  return parseCheckList(r.stdout ?? '')
}

// ---------- the terminal ----------

const CODES = { title: '\x1b[1m', heading: '\x1b[1;36m', cursor: '\x1b[7m', about: '\x1b[33m', hint: '\x1b[2m', bar: '\x1b[30;43m', plain: '' }

function makeTerm(stdin, stdout, env) {
  const color = Boolean(stdout.isTTY) && !env.NO_COLOR && !env.MEERKAT_PLAIN
  let drawn = 0
  let queue = []
  let wake = null
  let active = false
  const onData = (buf) => {
    queue.push(...parseKeys(String(buf)))
    wake?.()
  }
  const term = {
    stdin,
    stdout,
    env,
    color,
    level: color ? colorLevel(env) : false,
    version: '',
    update: null, // { latest, current } while a newer version is known (shown as the yellow bar)
    enter() {
      if (active) return
      active = true
      stdin.setRawMode?.(true)
      stdin.resume()
      stdin.on('data', onData)
      stdout.write('\x1b[?25l')
    },
    leave() {
      if (!active) return
      active = false
      stdin.off('data', onData)
      try {
        stdin.setRawMode?.(false)
      } catch {
        /* already gone */
      }
      stdin.pause()
      stdout.write('\x1b[?25h')
    },
    clear() {
      if (drawn > 0) stdout.write(`\x1b[${drawn}A\r\x1b[J`)
      drawn = 0
    },
    draw(lines) {
      term.clear()
      // Names and reasons shown here can come from someone else's files (a preset name, a check's reason): control characters go first.
      // 'raw' lines come from menuscreen.mjs, which cleans what it embeds and adds its own colour codes (and the pixel art).
      stdout.write(lines.map((l) => (l.style === 'raw' ? l.text : color && CODES[l.style] ? `${CODES[l.style]}${stripControl(l.text)}\x1b[0m` : stripControl(l.text))).join('\n') + '\n')
      drawn = lines.length
    },
    print(text) {
      term.clear()
      stdout.write(`${cleanText(text)}\n`)
    },
    width: () => stdout.columns || 80,
    rows: () => stdout.rows || 24,
    key() {
      return new Promise((resolve) => {
        const take = () => {
          if (queue.length) {
            wake = null
            resolve(queue.shift())
          } else wake = take
        }
        take()
      })
    },
    flush() {
      queue = []
    },
  }
  return term
}

async function pick(term, items, { title = 'MEERKAT', question, multi = false, bar = false, cursor } = {}) {
  let state = initialState(items, { multi })
  if (cursor !== undefined) state = { ...state, cursor }
  const hint = multi ? `  Up/Down move, Space ticks, ${items.some((i) => i.open) ? 'Right opens a suite, ' : ''}Enter runs, q goes back` : '  Up/Down or j/k move, Enter chooses, q quits'
  for (;;) {
    const lines = renderPicker(state, { title, question, hint, maxRows: term.rows() - 8, width: term.width() })
    term.draw(bar ? withUpdateBar(lines, term.update, { width: term.width(), color: term.color }) : lines)
    const r = menuStep(state, await term.key())
    state = r.state
    if (r.action) {
      term.clear()
      // The list as the person left it, so a caller that shows another list and comes back can put the ticks and the cursor back.
      return { ...r.action, items: state.items, cursor: state.cursor }
    }
  }
}

// The details of one preset: what it is for and every check it would run in this project. Up/Down scroll, any other key goes back.
// Returns 'abort' when Ctrl+C was pressed, else null.
async function showPresetDetails(term, project, name, env) {
  term.draw([{ text: 'Reading the checks...', style: 'plain' }])
  const { presetShow } = await import('./projectchecks.mjs')
  let r
  try {
    r = await presetShow(name, project, { env })
  } catch (e) {
    r = { ok: false, text: `Could not read the checks: ${e?.message ?? e}` }
  }
  if (!r.ok) {
    term.print(r.text)
    await anyKey(term)
    return null
  }
  let offset = 0
  for (;;) {
    const view = renderDetails(r.data, { offset, project, version: term.version, width: term.width(), rows: term.rows(), color: term.color, level: term.level, env: term.env, isTTY: Boolean(term.stdout.isTTY) })
    offset = view.offset
    term.draw(view.lines)
    const s = detailsStep(offset, await term.key(), view.maxOffset)
    offset = s.offset
    if (s.done) {
      term.clear()
      return s.done === 'abort' ? 'abort' : null
    }
  }
}

// The preset menu: the main screen. The u key starts the update flow (which still asks before installing anything). The d key opens
// the details of the highlighted preset. These keys exist only here: the project picker and the folder browser treat letters as a filter.
// makeItems() builds the list again on each draw, so the time estimates fill in as they are worked out.
async function pickMenu(term, makeItems, project, env = process.env) {
  let state = { ...initialState(makeItems()), hotkeys: { u: 'update', d: 'details' } }
  const hint = '  Up/Down move   Enter choose   1-9 jump   d details   u check for updates   q quit'
  for (;;) {
    state = { ...state, items: makeItems() }
    drawScreen(term, state.items, state.cursor, { project, question: 'What would you like to run?', hint, hotkey: true })
    const key = await waitKey(term)
    if (key === REDRAW) continue
    const r = menuStep(state, key)
    state = r.state
    if (r.action?.type === 'hotkey' && r.action.name === 'details') {
      const cur = state.items[state.cursor]
      if (cur?.value?.type === 'preset' && (await showPresetDetails(term, project, cur.value.name, env)) === 'abort') {
        term.clear()
        return { type: 'abort' }
      }
      continue
    }
    if (r.action) {
      term.clear()
      return r.action
    }
  }
}

async function askLine(term, question) {
  let state = { text: '' }
  for (;;) {
    term.draw([{ text: question, style: 'plain' }, { text: `> ${state.text}`, style: 'cursor' }, { text: '  Enter to finish, Esc to cancel', style: 'hint' }].map((l) => ({ ...l, text: cut(l.text, term.width() - 1) })))
    const r = lineStep(state, await term.key())
    state = r.state
    if (r.action) {
      term.clear()
      return r.action.type === 'submit' ? r.action.value.trim() : r.action.type === 'abort' ? null : ''
    }
  }
}

async function yesNo(term, question, yesLabel = 'Yes', noLabel = 'No') {
  const a = await pick(term, [{ kind: 'item', label: yesLabel, value: true }, { kind: 'item', label: noLabel, value: false }], { title: '', question })
  return a.type === 'choose' && a.item.value === true
}

async function anyKey(term) {
  term.stdout.write('\n  (press any key)\n')
  await term.key()
}

// ---------- choosing the project (the first screen of `meerkat`) ----------

// The three main screens (project picker, browse, preset menu): the header with the meerkat, sections, the yellow bar.
// The startup update look-up's one line (a spinner, then "Up to date") sits at the top of the header while it has something to say.
function drawScreen(term, items, cursor, { screen = '', project = null, question, hint, hotkey = false }) {
  const status = term.status?.line() ?? null
  const lines = renderScreen({ items, cursor, multi: false }, { screen, project, version: term.version, question, hint, update: term.update, status, hotkey, width: term.width(), rows: term.rows(), color: term.color, level: term.level, env: term.env, isTTY: Boolean(term.stdout.isTTY) })
  term.draw(lines)
  term.liveScreen = { count: lines.length, hasStatus: Boolean(status) }
}

const REDRAW = Symbol('redraw')

// Paints the spinner line in place (cursor up, rewrite that one line, cursor back): the rest of the screen is not redrawn, so nothing flickers.
function paintStatus(term) {
  const live = term.liveScreen
  const line = term.status?.line()
  if (!term.waiting || !live?.hasStatus || !line) return
  term.stdout.write(`\x1b[${live.count}A\r  ${line}\x1b[K\x1b[${live.count}B\r`)
}

// Waits for the next key. When the update look-up or a time estimate changes meanwhile, it returns REDRAW so the caller draws again.
// One key request stays open across redraws, so no key is lost.
async function waitKey(term) {
  term.heldKey ??= term.key()
  term.waiting = true
  const ev = await Promise.race([term.heldKey.then((key) => ({ key })), new Promise((resolve) => { term.wake = resolve })])
  term.waiting = false
  term.wake = null
  if (ev.key === undefined) return REDRAW
  term.heldKey = null
  return ev.key
}

// Returns { type: 'project', path }, { type: 'quit' } or { type: 'abort' }.
async function chooseProject(term, { cwd, env, home, fs }) {
  term.print('Looking for your projects...')
  const data = discoverRepos({ cwd, env, home, fs })
  let state = pickerState(data, { drives: listDrives(fs) })
  const hint = '  Up/Down move   Enter choose   type to filter   Esc clear filter / quit'
  for (;;) {
    const question = state.filter ? `Which project?   filter: ${state.filter}` : 'Which project do you want to check?'
    drawScreen(term, pickerItems(state), state.cursor, { screen: 'Choose a project', question, hint })
    const key = await waitKey(term)
    if (key === REDRAW) continue
    const r = pickerStep(state, key)
    state = r.state
    if (!r.action) continue
    term.clear()
    if (r.action.type === 'abort') return { type: 'abort' }
    if (r.action.type === 'quit') return { type: 'quit' }
    const v = r.action.item.value
    if (v.type === 'project') return { type: 'project', path: v.path }
    let res = null
    if (v.type === 'browse') res = await browseFlow(term, cwd, fs)
    else if (v.type === 'drive') {
      const drives = listDrives(fs)
      const d = await pick(term, drives.map((x) => ({ kind: 'item', label: x, value: x })), { question: 'Which drive?' })
      if (d.type === 'abort') return { type: 'abort' }
      if (d.type === 'choose') res = await browseFlow(term, d.item.value, fs)
    } else if (v.type === 'type') {
      const text = await askLine(term, 'Paste a folder path, or type the name of a project:')
      if (text === null) return { type: 'abort' }
      if (text) {
        const t = resolveTypedProject(text, { cwd, env, home })
        if (t.folder) res = { type: 'project', path: t.folder }
        else {
          term.print(t.error)
          await anyKey(term)
        }
      }
    }
    if (res) return res
  }
}

// Returns { type: 'project', path }, { type: 'abort' } or null (the person went back).
async function browseFlow(term, start, fs) {
  const read = (d) => listSubfolders(d, fs)
  let dir = resolve(start)
  try {
    if (!fs.statSync(dir).isDirectory()) dir = dirname(dir)
  } catch {
    dir = homedir()
  }
  let state = browseState(dir, read)
  const hint = '  Up/Down move   Enter open   Left/Backspace up   type to filter   Esc back'
  for (;;) {
    const question = `${state.dir}${state.filter ? `   filter: ${state.filter}` : ''}${state.note ? `   (${state.note})` : ''}`
    drawScreen(term, browseItems(state), state.cursor, { screen: 'Browse folders', question, hint })
    const r = browseStep(state, await term.key(), read)
    state = r.state
    if (!r.action) continue
    term.clear()
    if (r.action.type === 'abort') return { type: 'abort' }
    if (r.action.type === 'use') return { type: 'project', path: r.action.path }
    return null
  }
}

// ---------- the menu ----------

// `folder` skips the project picker (a folder was given on the command line). Without a terminal nothing happens here at all.
export async function runMenu({ cwd = process.cwd(), env = process.env, stdin = process.stdin, stdout = process.stdout, folder = null, home = homedir(), fs = nodeFs, updateCheck = null } = {}) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    stdout.write('The menu needs a terminal you can type in. Try: meerkat help\n')
    return 0
  }
  const term = makeTerm(stdin, stdout, env)
  term.version = readVersion(MEERKAT_DIR)
  const refreshNotice = () => {
    term.update = updateNotice({ current: term.version, env, home }) // reads the remembered answer only: no network
  }
  refreshNotice()
  // The startup look-up (bin/meerkat.mjs starts it, nobody waits for it): its line is drawn in the header and a newer version
  // turns into the yellow bar when it ends.
  term.status = updateCheck
  if (updateCheck) {
    updateCheck.onChange = (kind) => {
      if (kind === 'tick') return paintStatus(term)
      refreshNotice()
      term.wake?.({ redraw: true })
    }
  }
  // Time estimates of the Run rows: worked out once per project (lazily, within a 2 second budget), kept for this menu session.
  const estimateCache = new Map()
  const estimators = new Map()
  const estimatesFor = (path, names) => {
    if (!estimators.has(path)) {
      const est = createEstimates({
        project: path,
        names,
        cache: estimateCache,
        show: async (name) => (await import('./projectchecks.mjs')).presetShow(name, path, { env: { ...env, MEERKAT_NO_PROJECT_CODE: '1' } }),
        onChange: () => term.wake?.({ redraw: true }),
      })
      estimators.set(path, est)
      est.start().catch(() => {})
    }
    return estimators.get(path)
  }
  const restore = () => {
    try {
      stdout.write('\x1b[?25h')
      stdin.setRawMode?.(false)
    } catch {
      /* nothing to restore */
    }
  }
  process.once('exit', restore)
  const remember = (p) => {
    try {
      addRecent(p, env, home)
    } catch {
      /* the recent list is a convenience: a file that cannot be written never stops a run */
    }
  }
  let project = folder ? resolve(cwd, folder) : null
  let previous = null
  let code = 0
  try {
    for (;;) {
      let runArgs = null
      term.enter()
      try {
        for (;;) {
          if (!project) {
            const r = await chooseProject(term, { cwd, env, home, fs })
            if (r.type === 'abort') return 130
            if (r.type === 'quit' && previous) {
              project = previous // Esc on "Change project" goes back to the menu you were in
              continue
            }
            if (r.type !== 'project') return 0
            project = r.path
            remember(project)
          }
          const presets = loadPresets({ cwd: project, env })
          const est = estimatesFor(project, MAIN_PRESETS)
          const a = await pickMenu(term, () => menuItems({ ...presets, update: term.update, estimates: (n) => est.get(n) }), project, env)
          if (a.type === 'abort') return 130
          if (a.type === 'hotkey') {
            await updateFlow(term, env, home)
            refreshNotice()
            continue
          }
          if (a.type === 'quit' || a.item.value.type === 'quit') return 0
          const v = a.item.value
          if (v.type === 'preset') {
            runArgs = ['--app', project, '--preset', v.name]
            break
          }
          if (v.type === 'project') {
            previous = project
            project = null
          } else if (v.type === 'morepresets') {
            const more = await pick(term, otherPresetItems(presets), { question: 'Which preset?' })
            if (more.type === 'abort') return 130
            if (more.type === 'choose') {
              runArgs = ['--app', project, '--preset', more.item.value.name]
              break
            }
          } else if (v.type === 'checks') {
            const args = await chooseChecks(term, project, env)
            if (args) {
              runArgs = args
              break
            }
          } else if (v.type === 'create') {
            const args = await createPreset(term, project, env)
            if (args) {
              runArgs = args
              break
            }
          } else if (v.type === 'last') {
            term.print(showLast(env).text)
            await anyKey(term)
          } else if (v.type === 'log') await readLog(term, env)
          else if (v.type === 'update') {
            await updateFlow(term, env, home)
            refreshNotice()
          }
        }
      } finally {
        term.leave()
      }
      remember(project)
      code = spawnRun(runArgs, { env, cwd: project })
      estimateCache.clear() // the run taught Meerkat new times: the estimates are worked out again
      estimators.clear()
      const next = await afterRun({ runDir: latestRunDir(env), env, stdin, stdout, args: runArgs, cwd: project, canMenu: true })
      if (next !== 'menu') return code
      term.flush()
    }
  } finally {
    updateCheck?.stop()
    process.off('exit', restore)
  }
}

// ---------- choosing by suite (pure parts first) ----------

// What `run.mjs --list-json` printed -> the checks, or [] when it is not that.
export function parseSuiteRows(text) {
  try {
    const rows = JSON.parse(String(text))
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.suite === 'string') : []
  } catch {
    return []
  }
}

export function getSuiteRows(cwd, env) {
  const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), '--list-json', '--app', cwd], { encoding: 'utf8', env, cwd, timeout: 60000 })
  return parseSuiteRows(r.stdout ?? '')
}

// The first level: one row per suite (about 50 instead of about 250), under its category, with counts and the purpose on the line below.
// Space ticks the whole suite; Right opens it (suiteCheckItems) to tick single checks. `value` is what goes to --only.
export function suitePickerItems(rows) {
  const items = []
  for (const cat of Object.keys(SUITE_CATEGORIES)) {
    const inCat = SUITES.filter((x) => x.category === cat && rows.some((r) => r.suite === x.id))
    if (!inCat.length) continue
    items.push({ kind: 'heading', label: SUITE_CATEGORIES[cat] })
    for (const x of inCat) {
      const mine = rows.filter((r) => r.suite === x.id)
      const subs = mine.reduce((n, r) => n + (Number.isInteger(r.subs) && r.subs >= 1 ? r.subs : 1), 0)
      items.push({ kind: 'item', label: `${x.label}  (${mine.length} checks, ${subs} sub-checks)`, value: x.id, checked: false, open: true, suite: x.id, about: x.purpose })
    }
  }
  return items
}

// The second level: the checks of one suite. A check is ticked when the whole suite is, or when it is among the suite's ticked checks.
export function suiteCheckItems(suiteItem, rows) {
  const mine = rows.filter((r) => r.suite === suiteItem.suite)
  return mine.map((r) => ({ kind: 'item', label: r.id, value: `${suiteItem.suite}/${r.id}`, checked: Boolean(suiteItem.checked) || Boolean(suiteItem.partialValues?.includes(`${suiteItem.suite}/${r.id}`)), about: `${r.title ?? ''}${r.optIn ? ` (opt-in: ${r.optIn})` : ''}` }))
}

// Put the second level's ticks back on its suite: all ticked = the whole suite, some = those checks, none = unticked.
export function applySuiteTicks(suiteItem, values, allValues) {
  const { partialValues: _drop, ...rest } = suiteItem
  if (!values.length) return { ...rest, checked: false }
  if (values.length >= allValues.length) return { ...rest, checked: true }
  return { ...rest, checked: false, partialValues: values }
}

async function chooseBySuite(term, cwd, rows) {
  let items = suitePickerItems(rows)
  let cursor
  for (;;) {
    const a = await pick(term, items, { question: 'Tick the suites to run. Space ticks a whole suite, Right opens it to tick single checks, Enter runs.', multi: true, cursor })
    items = a.items ?? items
    cursor = a.cursor
    if (a.type === 'open') {
      const at = items.findIndex((it) => it === a.item || (it.suite && it.suite === a.item.suite))
      const level2 = suiteCheckItems(items[at], rows)
      const sub = await pick(term, level2, { question: `${items[at].label}: tick the checks to run, Enter keeps the ticks, q goes back.`, multi: true })
      if (sub.type === 'abort') return null
      if (sub.type === 'submit') items = items.map((it, i) => (i === at ? applySuiteTicks(it, sub.values, level2.map((x) => x.value)) : it))
      continue
    }
    if (a.type === 'submit') return ['--app', cwd, '--only', a.values.join(',')]
    return null
  }
}

async function chooseChecks(term, cwd, env) {
  term.print('Looking up the checks...')
  const suiteRows = getSuiteRows(cwd, env)
  if (suiteRows.length) return chooseBySuite(term, cwd, suiteRows)
  const checks = getCheckList(cwd, env)
  if (!checks.length) {
    term.print('Could not get the list of checks for this folder.')
    await anyKey(term)
    return null
  }
  const items = []
  for (const kind of [...new Set(checks.map((c) => c.kind))]) {
    items.push({ kind: 'heading', label: kind })
    for (const c of checks.filter((x) => x.kind === kind)) items.push({ kind: 'item', label: c.id, value: c.id, checked: false, about: `${c.kind}, ${c.tier}` })
  }
  const a = await pick(term, items, { question: 'Tick the checks to run.', multi: true })
  if (a.type !== 'submit') return null
  return ['--app', cwd, '--only', a.values.join(',')]
}

async function createPreset(term, cwd, env) {
  const taken = new Set([...Object.keys(PRESETS), 'run', 'last', 'why', 'logs', 'list', 'init', 'pack', 'bug', 'update', 'menu', 'help', 'presets', 'verify', 'test', 'check', 'self-test'])
  let name = ''
  for (;;) {
    name = await askLine(term, 'Name for the preset (letters, numbers and dashes):')
    if (!name) return null
    if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(name) && !taken.has(name)) break
    term.print(taken.has(name) ? `"${name}" is already used by Meerkat. Pick another name.` : 'Use only lowercase letters, numbers and dashes.')
  }
  const tierPick = await pick(term, [{ kind: 'item', label: 'Fast', value: 'fast', about: 'the quick checks: before every push' }, { kind: 'item', label: 'Full', value: 'thorough', about: 'the slow checks too: before a release' }], { question: 'How thorough?' })
  if (tierPick.type !== 'choose') return null
  const kindsPick = await pick(term, KINDS.map((k) => ({ kind: 'item', label: k, value: k, checked: false })), { question: 'Which kinds of check? (tick none for all)', multi: true })
  const groups = kindsPick.type === 'submit' ? kindsPick.values : []
  const where = await pick(term, [{ kind: 'item', label: 'For me, everywhere', value: 'user', about: 'Saved in your own Meerkat settings' }, { kind: 'item', label: 'For this project', value: 'project', about: 'Saved in meerkat.config.json in this project' }], { question: 'Where should it be saved?' })
  if (where.type !== 'choose') return null
  const about = await askLine(term, 'One line about it (optional, up to 200 characters, Enter skips):')
  if (about === null) return null
  const purpose = await askLine(term, 'What it is for and when to run it, a few sentences (optional, up to 600 characters, Enter skips):')
  if (purpose === null) return null
  const preset = { tier: tierPick.item.value, groups, about: cleanAbout(about) || 'Made in the Meerkat menu', ...(cleanPurpose(purpose) ? { purpose: cleanPurpose(purpose) } : {}) }
  if (where.item.value === 'user') {
    savePersonalPreset(name, preset, env)
    term.print(`Saved "${name}" in your Meerkat settings.`)
  } else {
    const r = saveProjectPreset(cwd, name, preset)
    term.print(r.ok ? `Saved "${name}" in ${r.file}` : r.text)
    if (!r.ok) {
      await anyKey(term)
      return null
    }
  }
  return (await yesNo(term, `Run "${name}" now?`, 'Run it', 'Not now')) ? ['--app', cwd, '--preset', name] : null
}

async function readLog(term, env) {
  const dir = latestRunDir(env)
  const checks = dir ? listRunChecks(dir) : []
  if (!checks.length) {
    term.print('No run has been saved yet.')
    await anyKey(term)
    return
  }
  const a = await pick(term, checks.map((c) => ({ kind: 'item', label: `${c.id}  ${c.status}  ${c.time}`, value: c.id, about: c.detail })), { question: 'Which log?' })
  if (a.type !== 'choose') return
  term.print(showWhy(a.item.value, env).text)
  await anyKey(term)
}

async function updateFlow(term, env, home) {
  term.print('Checking GitHub for a new version of Meerkat...')
  const found = checkForUpdate({ repoDir: MEERKAT_DIR })
  if (!found.ok) {
    term.print(`Cannot update: ${found.reason}`)
  } else {
    try {
      writeUpdateCache(found.version, Date.now(), env, home)
    } catch {
      /* not being able to remember the answer changes nothing */
    }
    if (!found.behind) term.print('Meerkat is up to date.')
    else {
      term.print([`${found.behind} new change${found.behind === 1 ? '' : 's'}${found.version ? ` (version ${found.version})` : ''}:`, ...found.commits.map((c) => `  - ${c}`)].join('\n'))
      if (await yesNo(term, 'Update now?', 'Update', 'Not now')) {
        const r = applyUpdate({ repoDir: MEERKAT_DIR })
        if (r.ok) {
          try {
            clearUpdateCache(env, home)
          } catch {
            /* see above */
          }
        }
        term.print(r.ok ? `Updated${r.from && r.to ? ` from ${r.from} to ${r.to}` : ''}.` : `Not updated: ${r.reason}`)
      }
    }
  }
  await anyKey(term)
}

// ---------- after a run ----------

// Puts text on the clipboard with the system's own tool; false when there is none. Nothing is sent anywhere.
export function copyText(text, env = process.env) {
  const tools = process.platform === 'win32' ? [[join(env.SystemRoot || 'C:/Windows', 'System32', 'clip.exe'), []]] : process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]]
  for (const [cmd, a] of tools) {
    const r = spawnSync(cmd, a, { input: text, timeout: 5000, windowsHide: true, cwd: tmpdir() })
    if (r.status === 0) return true
  }
  return false
}

// What changed in the folder's git repository (uncommitted files and the last commit), so a run's result is read next to the change.
export function repoChangesText(cwd, max = 25) {
  const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: 10000, windowsHide: true, cwd: tmpdir() })
  const st = git('status', '--short', '--branch')
  if (st.status !== 0) return 'Repo changes: this folder is not a git repository.'
  const lines = st.stdout.split('\n').filter(Boolean)
  const [branch, ...files] = lines
  const last = git('log', '-1', '--format=%h %s (%cr)').stdout.trim()
  const shown = files.slice(0, max)
  return [`Repo changes (${String(branch).replace(/^## /, '')}):`, files.length ? shown.map((l) => `  ${l}`).join('\n') : '  no uncommitted changes', files.length > max ? `  ... and ${files.length - max} more` : '', last ? `Last commit: ${last}` : ''].filter((l) => l !== '').join('\n')
}

export async function afterRun({ runDir, env = process.env, stdin = process.stdin, stdout = process.stdout, args = null, cwd = process.cwd(), canMenu = false } = {}) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return null
  const term = makeTerm(stdin, stdout, env)
  const restore = () => {
    try {
      stdout.write('\x1b[?25h')
      stdin.setRawMode?.(false)
    } catch {
      /* nothing to restore */
    }
  }
  process.once('exit', restore)
  let dir = runDir
  let result = null
  try {
    term.version = readVersion(MEERKAT_DIR)
    term.update = updateNotice({ current: term.version, env })
    term.enter()
    // Start on a fresh, empty line below everything the run printed (the child has already exited: spawnSync waited for it), so the
    // menu never lands on the report and never clears anything above its own first line.
    stdout.write('\r\n')
    // Stay on the result. Logs are not printed: they open only when chosen below.
    const choose = async (question, items) => {
      const a = await pick(term, items.map(([label, value, about]) => ({ kind: 'item', label, value, about })), { title: '', question, bar: true })
      return a.type === 'choose' ? a.item.value : null
    }
    const pickCheck = async (question) => {
      const checks = dir ? listRunChecks(dir) : []
      if (!checks.length) {
        term.print('No checks were saved for that run.')
        return null
      }
      const id = await choose(question, checks.map((c) => [`${c.id}  ${c.status}  ${c.time}`, c.id, c.detail]))
      return checks.find((c) => c.id === id) ?? null
    }
    for (;;) {
      const what = await choose('Verification finished. What next? (Up/Down, Enter)', [
        ['OK, done', 'done', 'close this screen'],
        ...(canMenu ? [['Back to the menu', 'menu', 'pick another preset for the same project']] : []),
        ['Show a log', 'log', 'read the full log of one check (failed ones first)'],
        ['Copy a log path', 'copy', 'put the path of one check log on the clipboard'],
        ['Show the report', 'report', 'the summary of this run'],
        ['Show repo changes', 'changes', 'uncommitted files and the last commit'],
        ['Run again', 'again', 'repeat the same run'],
      ])
      if (what === null || what === 'done') break
      if (what === 'menu') {
        result = 'menu'
        break
      }
      if (what === 'report') term.print(showLast(env).text)
      else if (what === 'changes') term.print(repoChangesText(cwd))
      else if (what === 'log') {
        const c = await pickCheck('Which log?')
        if (c) term.print(showWhy(c.id, env).text)
      } else if (what === 'copy') {
        const c = await pickCheck('Copy which log path?')
        if (c) term.print(!c.logFile ? 'That check has no log file inside the log folder.' : copyText(c.logFile) ? `Copied: ${c.logFile}` : `No clipboard tool found. The path is: ${c.logFile}`)
      } else if (what === 'again') {
        if (!args) {
          term.print('That run cannot be repeated from here.')
          continue
        }
        term.leave()
        spawnRun(args, { env, cwd })
        dir = latestRunDir(env)
        term.flush()
        term.enter()
        stdout.write('\r\n')
      }
      if (what === 'report' || what === 'changes' || what === 'log' || what === 'copy') await anyKey(term)
    }
  } finally {
    term.clear()
    term.leave()
    process.off('exit', restore)
  }
  return result
}
