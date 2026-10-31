// The menu you get when you type `meerkat` on its own, and the small "what next?" prompt after a run.
// No dependencies: raw-mode keys, plain ANSI. The key handling is pure (parseKeys, menuStep, lineStep) so it can be tested without a terminal.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listPresets, loadPresets } from './cli.mjs'
import { summaryOf } from './help.mjs'
import { findConfig } from './config.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { PRESETS } from './presets.mjs'
import { latestRunDir, showLast, showWhy } from './runlog.mjs'
import { cleanText, stripControl } from './tui/safe.mjs'
import { applyUpdate, checkForUpdate } from './update.mjs'
import { readUserConfig, writeUserConfig } from './userconfig.mjs'

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
  if (typeof key === 'string' && /^[1-9]$/.test(key) && !state.multi) {
    // a number jumps to that item (counting items only, not headings); Enter then chooses it
    const at = state.items.map((it, i) => (selectable(it) ? i : -1)).filter((i) => i >= 0)[Number(key) - 1]
    return { state: at === undefined ? state : { ...state, cursor: at }, action: null }
  }
  const cur = state.items[state.cursor]
  if (key === 'space' && state.multi && cur && selectable(cur)) {
    const items = state.items.map((it, i) => (i === state.cursor ? { ...it, checked: !it.checked } : it))
    return { state: { ...state, items }, action: null }
  }
  if (key === 'enter') {
    if (state.multi) {
      const values = state.items.filter((it) => selectable(it) && it.checked).map((it) => it.value)
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
      const box = state.multi ? (it.checked ? '[x] ' : '[ ] ') : ''
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
export function menuItems({ user = {}, project = {} } = {}) {
  const rows = listPresets({ user, project })
  const about = (name) => rows.find((r) => r.name === name)?.about ?? ''
  const preset = (name) => ({ kind: 'item', label: name, value: { type: 'preset', name }, about: about(name) })
  const items = []
  const group = (label, names) => {
    if (!names.length) return
    items.push({ kind: 'heading', label })
    for (const n of names) items.push(preset(n))
  }
  group('Everything', ['quick', 'full'])
  group('By kind', ['security-fast', 'security', 'functionality-fast', 'functionality', 'ui-fast', 'ui', 'performance-fast', 'performance', 'refactor'])
  group('Combinations', ['app-fast', 'app', 'ci', 'release'])
  group('Mine', rows.filter((r) => r.source !== 'bundled').map((r) => r.name))
  items.push({ kind: 'heading', label: 'More' })
  const act = (label, type, text) => items.push({ kind: 'item', label, value: { type }, about: text })
  act('Choose checks one by one', 'checks', 'Tick the checks you want and run just those')
  act('Create a preset', 'create', cap(summaryOf('preset')))
  act('See the last report', 'last', cap(summaryOf('last')))
  act('Read a log', 'log', cap(summaryOf('why')))
  act('Update Meerkat', 'update', cap(summaryOf('update')))
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
      .map((r) => ({ id: String(r.id), status: r.status ?? 'NOT RUN', time: fmtMs(r.ms), detail: r.detail ?? '' }))
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

const CODES = { title: '\x1b[1m', heading: '\x1b[1;36m', cursor: '\x1b[7m', about: '\x1b[33m', hint: '\x1b[2m', plain: '' }

function makeTerm(stdin, stdout, env) {
  const color = Boolean(stdout.isTTY) && !env.NO_COLOR
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
      stdout.write(lines.map((l) => (color && CODES[l.style] ? `${CODES[l.style]}${stripControl(l.text)}\x1b[0m` : stripControl(l.text))).join('\n') + '\n')
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

async function pick(term, items, { title = 'MEERKAT', question, multi = false } = {}) {
  let state = initialState(items, { multi })
  const hint = multi ? '  Up/Down move, Space ticks, Enter runs, q goes back' : '  Up/Down or j/k move, Enter chooses, q quits'
  for (;;) {
    term.draw(renderPicker(state, { title, question, hint, maxRows: term.rows() - 7, width: term.width() }))
    const r = menuStep(state, await term.key())
    state = r.state
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

// ---------- the menu ----------

export async function runMenu({ cwd = process.cwd(), env = process.env, stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    stdout.write('The menu needs a terminal you can type in. Try: meerkat help\n')
    return 0
  }
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
  let runArgs = null
  try {
    term.enter()
    for (;;) {
      const presets = loadPresets({ cwd, env })
      const a = await pick(term, menuItems(presets), { question: 'What would you like to run?' })
      if (a.type === 'abort') return 130
      if (a.type === 'quit' || a.item.value.type === 'quit') return 0
      const v = a.item.value
      if (v.type === 'preset') {
        runArgs = ['--app', cwd, '--preset', v.name]
        break
      }
      if (v.type === 'checks') {
        const args = await chooseChecks(term, cwd, env)
        if (args) {
          runArgs = args
          break
        }
      } else if (v.type === 'create') {
        const args = await createPreset(term, cwd, env)
        if (args) {
          runArgs = args
          break
        }
      } else if (v.type === 'last') {
        term.print(showLast(env).text)
        await anyKey(term)
      } else if (v.type === 'log') await readLog(term, env)
      else if (v.type === 'update') await updateFlow(term)
    }
  } finally {
    term.leave()
    process.off('exit', restore)
  }
  const code = spawnRun(runArgs, { env, cwd })
  await afterRun({ runDir: latestRunDir(env), env, stdin, stdout, args: runArgs, cwd })
  return code
}

async function chooseChecks(term, cwd, env) {
  term.print('Looking up the checks...')
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
  const preset = { tier: tierPick.item.value, groups, about: 'Made in the Meerkat menu' }
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

async function updateFlow(term) {
  term.print('Checking GitHub for a new version of Meerkat...')
  const found = checkForUpdate({ repoDir: MEERKAT_DIR })
  if (!found.ok) {
    term.print(`Cannot update: ${found.reason}`)
  } else if (!found.behind) term.print('Meerkat is up to date.')
  else {
    term.print([`${found.behind} new change${found.behind === 1 ? '' : 's'}:`, ...found.commits.map((c) => `  - ${c}`)].join('\n'))
    if (await yesNo(term, 'Update now?', 'Update', 'Not now')) {
      const r = applyUpdate({ repoDir: MEERKAT_DIR })
      term.print(r.ok ? `Updated${r.from && r.to ? ` from ${r.from} to ${r.to}` : ''}.` : `Not updated: ${r.reason}`)
    }
  }
  await anyKey(term)
}

// ---------- after a run ----------

// What changed in the folder's git repository (uncommitted files and the last commit), so a run's result is read next to the change.
export function repoChangesText(cwd, max = 25) {
  const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  const st = git('status', '--short', '--branch')
  if (st.status !== 0) return 'Repo changes: this folder is not a git repository.'
  const lines = st.stdout.split('\n').filter(Boolean)
  const [branch, ...files] = lines
  const last = git('log', '-1', '--format=%h %s (%cr)').stdout.trim()
  const shown = files.slice(0, max)
  return [`Repo changes (${String(branch).replace(/^## /, '')}):`, files.length ? shown.map((l) => `  ${l}`).join('\n') : '  no uncommitted changes', files.length > max ? `  ... and ${files.length - max} more` : '', last ? `Last commit: ${last}` : ''].filter((l) => l !== '').join('\n')
}

export async function afterRun({ runDir, env = process.env, stdin = process.stdin, stdout = process.stdout, args = null, cwd = process.cwd() } = {}) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return
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
  try {
    term.enter()
    // Stay on the review: the report and the repo's changes are printed first and stay on screen until q, Esc or Ctrl-C.
    term.print(`${showLast(env).text}\n\n${repoChangesText(cwd)}`)
    for (;;) {
      term.draw([{ text: '[r] report   [c] repo changes   [l] open a log   [a] run again   [q] quit', style: 'plain' }])
      const key = await term.key()
      if (key === 'q' || key === 'escape' || key === 'ctrl-c') break
      if (key === 'r') {
        term.print(showLast(env).text)
      } else if (key === 'c') {
        term.print(repoChangesText(cwd))
      } else if (key === 'l') {
        const checks = dir ? listRunChecks(dir) : []
        if (!checks.length) term.print('No checks were saved for that run.')
        else {
          const a = await pick(term, checks.map((c, i) => ({ kind: 'item', label: `${i + 1}. ${c.id}  ${c.status}  ${c.time}`, value: c.id, about: c.detail })), { title: '', question: 'Which log? (arrows then Enter, or a number)' })
          if (a.type === 'choose') term.print(showWhy(a.item.value, env).text)
        }
      } else if (key === 'a') {
        if (!args) {
          term.print('That run cannot be repeated from here.')
          continue
        }
        term.leave()
        spawnRun(args, { env, cwd })
        dir = latestRunDir(env)
        term.flush()
        term.enter()
      }
    }
  } finally {
    term.clear()
    term.leave()
    process.off('exit', restore)
  }
}
