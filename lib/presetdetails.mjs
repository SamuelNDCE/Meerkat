// The details of one preset as a screen and as plain text: its name, where it comes from, what it is for, and every check it would run
// in this project, grouped by kind. Pure: from the data presetShow (lib/projectchecks.mjs) makes to lines of text, so it is tested and
// screenshotted without a terminal. lib/menu.mjs shows it when you press d on a preset; `meerkat preset show` prints the same.
import { headerLines } from './menuscreen.mjs'
import { stripControl } from './tui/safe.mjs'

const SGR = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', grey: '\x1b[90m', section: '\x1b[1;36m', group: '\x1b[1m' }
const paint = (color, code, text) => (color && text ? `${code}${text}${SGR.reset}` : text)
const clean = (t) => stripControl(t)
const cut = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…`.slice(0, width) : text)
const padTo = (t, w) => (t.length >= w ? t : t + ' '.repeat(w - t.length))

const LABEL_W = 10
const KIND_ORDER = ['security', 'functionality', 'ui', 'performance', 'refactor']
const SOURCE_TEXT = { bundled: 'bundled (comes with Meerkat)', personal: 'personal (saved just for you, in every project)', project: "project (in this project's meerkat.config.json)" }
const TIER_TEXT = { fast: 'fast (the quick checks)', thorough: 'thorough (the slow checks too)' }

export function wrapWords(text, width) {
  const out = []
  let line = ''
  for (const word of clean(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

export function durationWords(seconds) {
  const s = Number(seconds) || 0
  if (s <= 0) return 'under a second'
  if (s >= 90) return `${Math.round(s / 6) / 10} minutes`
  return s === 1 ? '1 second' : `${s} seconds`
}

const checkTime = (s) => (s == null ? '?' : s >= 120 ? `~${Math.round(s / 60)}m` : `~${s}s`)

// The lines of the details, each { text, style, labelLen }. style: title, dim, section, group, check, plain. A row with labelLen has a grey label.
export function detailsRows(data, { width = 80 } = {}) {
  const w = Math.max(20, width - 1)
  const rows = []
  const add = (text, style = 'plain', labelLen = 0) => rows.push({ text, style, labelLen })
  const field = (label, value) => {
    const lines = wrapWords(value, Math.max(10, w - LABEL_W - 2))
    lines.forEach((l, i) => add(`${i === 0 ? padTo(label, LABEL_W) : ' '.repeat(LABEL_W)}${l}`, 'plain', i === 0 ? LABEL_W : 0))
  }
  const name = clean(data.name)
  const kinds = (data.kinds ?? ['all']).map(clean)
  add(name, 'title')
  if (data.about) wrapWords(data.about, w - 2).forEach((l) => add(`  ${l}`, 'dim'))
  add('')
  field('From', SOURCE_TEXT[data.source] ?? clean(data.source ?? 'bundled'))
  field('Tier', TIER_TEXT[data.tier] ?? clean(data.tier))
  field('Kinds', kinds.join(',') === 'all' ? 'all kinds' : kinds.join(', '))
  if (data.include?.length) field('Also runs', `${data.include.map(clean).join(', ')} (opt-in checks)`)
  field('Packs', data.packs?.length ? `brings the ${data.packs.map(clean).join(', ')} pack${data.packs.length > 1 ? 's' : ''}` : 'none of its own')
  field('Time', `${data.estimateSeconds > 0 ? 'about ' : ''}${durationWords(data.estimateSeconds)} for ${data.checks.length} check${data.checks.length === 1 ? '' : 's'} on this PC`)
  add('')
  add('Purpose', 'section')
  if (data.purpose) wrapWords(data.purpose, w - 2).forEach((l) => add(`  ${l}`))
  else {
    const own = data.source === 'personal' || data.source === 'project'
    wrapWords(own ? `No description yet. Add one with: meerkat preset edit ${name} --purpose "what it is for and when to run it"` : 'No description for this preset.', w - 2).forEach((l) => add(`  ${l}`, 'dim'))
  }
  add('')
  add(`What it runs here (${data.checks.length} check${data.checks.length === 1 ? '' : 's'})`, 'section')
  if (!data.checks.length) {
    wrapWords('It selects no checks in this project. Turn on a pack that has some: meerkat pack list', w - 2).forEach((l) => add(`  ${l}`, 'dim'))
    return rows
  }
  const order = [...new Set(data.checks.map((c) => c.kind))].sort((a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99))
  const idW = Math.min(30, Math.max(...data.checks.map((c) => clean(c.id).length)))
  for (const k of order) {
    const list = data.checks.filter((c) => c.kind === k)
    add(`  ${clean(k)} (${list.length})`, 'group')
    for (const c of list) {
      const left = `    ${padTo(cut(clean(c.id), idW), idW)}  ${checkTime(c.seconds).padStart(5)}  `
      add(cut(`${left}${clean(c.title ?? '')}`, w), 'check', 4 + idW)
    }
  }
  return rows
}

// The same rows as plain text, for `meerkat preset show`.
export const detailsText = (data, opts) => detailsRows(data, opts).map((r) => r.text).join('\n')

const paintRow = (r, w, color) => {
  const text = cut(r.text, w)
  if (r.style === 'title') return paint(color, SGR.bold, text)
  if (r.style === 'dim') return paint(color, SGR.dim, text)
  if (r.style === 'group') return paint(color, SGR.group, text)
  if (r.style === 'section') {
    const label = cut(text, w - 4)
    return `${paint(color, SGR.section, label)} ${paint(color, SGR.dim, (color ? '─' : '-').repeat(Math.max(0, w - 1 - label.length)))}`
  }
  if (r.style === 'check') return `${text.slice(0, r.labelLen)}${paint(color, SGR.grey, text.slice(r.labelLen))}`
  if (r.labelLen) return `${paint(color, SGR.grey, text.slice(0, r.labelLen))}${text.slice(r.labelLen)}`
  return text
}

// A whole screen: the usual header, then the details scrolled by `offset` rows, a scroll note and a one-line key hint.
// Returns { lines: [{ text, style: 'raw' }], offset (kept inside the range), maxOffset }. Never taller than rows - 1 lines.
export function renderDetails(data, { offset = 0, hint = '  Up/Down scroll   any other key or Esc: back', project = null, version = '', update = null, width = 80, rows = 24, color = false, level = false, env = process.env, isTTY = true } = {}) {
  const w = Math.max(10, width - 1)
  // The meerkat takes ten rows: it is kept for tall windows, and a short window gets the one-line header so the checks stay in view.
  const head = headerLines({ screen: 'Preset details', version, project, question: '', update, hotkey: false, width, rows: rows >= 36 ? rows : 0, color, level, env, isTTY })
  if (head.length && head[head.length - 1] !== '') head.push('') // the meerkat's header has no blank line of its own
  const room = Math.max(3, rows - 1 - head.length - 2)
  const body = detailsRows(data, { width })
  const maxOffset = Math.max(0, body.length - room)
  const at = Math.min(Math.max(0, offset), maxOffset)
  const shown = body.slice(at, at + room).map((r) => paintRow(r, w, color))
  const below = Math.max(0, body.length - (at + room))
  const scroll = at || below ? `  ${at ? `${at} more above` : ''}${at && below ? '   ' : ''}${below ? `${below} more below` : ''}` : ''
  const hintText = maxOffset ? hint : '  Any key or Esc: back'
  const lines = [...head, ...shown, paint(color, SGR.dim, cut(scroll, w)), paint(color, SGR.dim, cut(hintText, w))]
  return { lines: lines.map((text) => ({ text, style: 'raw' })), offset: at, maxOffset }
}

// One key on the details screen. Up/Down (or k/j) scroll while there is more to see; any other key finishes. Ctrl+C aborts.
export function detailsStep(offset, key, maxOffset) {
  if (key === 'ctrl-c') return { offset, done: 'abort' }
  if (maxOffset > 0 && (key === 'up' || key === 'k')) return { offset: Math.max(0, offset - 1), done: null }
  if (maxOffset > 0 && (key === 'down' || key === 'j')) return { offset: Math.min(maxOffset, offset + 1), done: null }
  return { offset, done: 'back' }
}
