// How the menu screens look: a header with the pixel-art meerkat, sections, one line per item with a grey description to
// the right, a one-line key hint, and a yellow bar when a newer version is known. Pure: from data to lines of text (with colour
// codes only when asked for), so it is tested and screenshotted without a terminal. lib/menu.mjs draws these.
import { PALETTE, pixelHead, SPRITE_WIDTH } from './tui/pixelhead.mjs'
import { stripControl } from './tui/safe.mjs'

const SGR = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', grey: '\x1b[90m', section: '\x1b[1;36m', inverse: '\x1b[7m', bar: '\x1b[30;43m' }
const paint = (color, code, text) => (color && text ? `${code}${text}${SGR.reset}` : text)
const padTo = (t, w) => (t.length >= w ? t : t + ' '.repeat(w - t.length))
const clean = (t) => stripControl(t)
const cut = (text, width) => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…`.slice(0, width) : text)
const selectable = (it) => it.kind === 'item'

export const ART_MIN_WIDTH = 70
export const ART_MIN_ROWS = 24

// The pixel-art meerkat is shown only where it fits and can be drawn: a real terminal with colour, at least 70 columns by 24 rows.
export function headerMode({ width = 80, rows = 24, color = false, env = process.env, isTTY = true } = {}) {
  return isTTY && color && !env.NO_COLOR && !env.MEERKAT_PLAIN && env.MEERKAT_MASCOT !== '0' && width >= ART_MIN_WIDTH && rows >= ART_MIN_ROWS ? 'art' : 'text'
}

// The one-line yellow bar (black on yellow). Null when no newer version is known. Shorter wording when the line is narrow.
// Without colour it is the same words, plain.
export function updateBar(update, { width = 80, color = false, hotkey = true } = {}) {
  if (!update) return null
  const head = ` Update available: you have v${clean(update.current).replace(/^v/, '')}, new version v${clean(update.latest).replace(/^v/, '')}.`
  const variants = [hotkey ? `${head}  Press u to update, or choose Check for updates below ` : `${head}  Pick a project, then press u in the menu to update `, hotkey ? `${head}  Press u to update ` : `${head} `, head]
  const w = Math.max(10, width - 1)
  const text = variants.find((v) => v.length <= w) ?? cut(head, w)
  return color ? paint(true, SGR.bar, padTo(text, w)) : text.trimEnd()
}

// Puts the bar (when there is an update) in front of the { text, style } lines made by renderPicker (the screen after a run).
export function withUpdateBar(lines, update, { width = 80, color = false, hotkey = false } = {}) {
  const bar = updateBar(update, { width, color, hotkey })
  return bar ? [{ text: bar, style: 'raw' }, ...lines] : lines
}

// The top of a screen as strings: the update bar first, then the title block. In 'art' mode the meerkat stands on the left and
// the title block is beside it; in 'text' mode there is only text.
export function headerLines({ screen = '', version = '', project = null, question = '', update = null, status = null, hotkey = true, projectNote = '', width = 80, rows = 24, color = false, level = false, env = process.env, isTTY = true } = {}) {
  const out = []
  if (status) out.push(`  ${status}`)
  const bar = updateBar(update, { width, color, hotkey })
  if (bar) out.push(bar)
  const w = Math.max(10, width - 1)
  const ver = version && version !== 'unknown' ? clean(version) : ''
  const tagline = screen ? clean(screen) : 'Checks an app before you push it'
  if (headerMode({ width, rows, color, env, isTTY }) === 'art') {
    const art = pixelHead('right', { color: level || true, palette: PALETTE })
    const gap = 2
    const room = w - SPRITE_WIDTH - gap
    const t = (text, code) => paint(color, code, cut(text, room))
    const field = (name, value) => (value ? `${paint(color, SGR.grey, padTo(name, 9))}${cut(clean(value), room - 9)}` : '')
    const side = ['', t('MEERKAT', SGR.bold), t(tagline, SGR.dim), '', field('Version', ver), projectNote && project ? `${paint(color, SGR.grey, 'Project: ')}${cut(clean(project), Math.max(8, room - 9 - projectNote.length - 3))}   ${paint(color, SGR.dim, projectNote)}` : field('Project', project ?? ''), '', t(clean(question), SGR.bold), '', '']
    art.forEach((row, i) => out.push(`${row}${' '.repeat(gap)}${side[i] ?? ''}`.replace(/\s+$/, '')))
  } else {
    out.push(`${paint(color, SGR.bold, 'MEERKAT')}${ver ? `  ${paint(color, SGR.grey, ver)}` : ''}${screen ? `   ${paint(color, SGR.dim, cut(tagline, Math.max(5, w - 20)))}` : ''}`)
    if (project && projectNote) out.push(`${paint(color, SGR.grey, 'Project: ')}${cut(clean(project), Math.max(8, w - 9 - projectNote.length - 3))}   ${paint(color, SGR.dim, projectNote)}`)
    else if (project) out.push(`${paint(color, SGR.grey, 'Project  ')}${cut(clean(project), w - 9)}`)
    if (question) out.push(paint(color, SGR.bold, cut(clean(question), w)))
    out.push('')
  }
  return out
}

// A whole screen: header, the list in sections (a heading, then one line per item with a grey description to the right), a
// scroll note and a one-line key hint. Never taller than rows - 1 lines: the list scrolls under the header.
// state = { items, cursor, multi }. Returns [{ text, style: 'raw' }].
export function renderScreen(state, { screen = '', project = null, version = '', question = '', hint = '', update = null, status = null, hotkey = true, projectNote = '', width = 80, rows = 24, color = false, level = false, env = process.env, isTTY = true } = {}) {
  const w = Math.max(10, width - 1)
  const head = headerLines({ screen, version, project, question, update, status, hotkey, projectNote, width, rows, color, level, env, isTTY })
  const room = Math.max(3, rows - 1 - head.length - 2)
  const items = state.items
  const boxOf = (it) => (state.multi ? (it.checked ? '[x] ' : '[ ] ') : '')
  const labelW = Math.min(Math.floor(w * 0.45), Math.max(8, ...items.filter(selectable).map((it) => boxOf(it).length + clean(it.label).length)) + 2)
  const timeW = Math.max(0, ...items.filter(selectable).map((it) => (it.time ? clean(it.time).length : 0)))
  const body = []
  let cursorLine = 0
  items.forEach((it, i) => {
    if (it.kind === 'heading' && body.length) body.push({ i: -1 })
    body.push({ i })
    if (i === state.cursor) cursorLine = body.length - 1
  })
  const total = body.length
  const start = total <= room ? 0 : Math.min(Math.max(0, cursorLine - Math.floor(room / 2)), total - room)
  const end = Math.min(total, start + room)
  const shown = body.slice(start, end).map((b) => {
    if (b.i < 0) return ''
    const it = items[b.i]
    if (it.kind === 'heading') {
      const label = cut(clean(it.label), w - 4)
      return `  ${paint(color, SGR.section, label)} ${paint(color, SGR.dim, (color ? '─' : '-').repeat(Math.max(0, w - 4 - label.length)))}`
    }
    const left = cut(`${b.i === state.cursor ? '> ' : '  '}${padTo(`${boxOf(it)}${clean(it.label)}`, labelW)}`, w)
    const aboutRoom = w - left.length - 1
    // A row with an estimate (it.time) shows it right-aligned after the description: "...  about 5 min".
    const time = it.time && aboutRoom > timeW + 1 ? clean(it.time) : ''
    if (time) {
      const room = aboutRoom - timeW - 1
      const about = it.about && room > 3 ? cut(clean(it.about), room) : ''
      const plain = `${left} ${padTo(about, Math.max(0, room))} ${time.padStart(timeW)}`
      if (b.i === state.cursor) return paint(color, SGR.inverse, padTo(plain, w))
      return `${left} ${paint(color, SGR.grey, padTo(about, Math.max(0, room)))} ${paint(color, SGR.dim, time.padStart(timeW))}`
    }
    const about = it.about && aboutRoom > 3 ? cut(clean(it.about), aboutRoom) : ''
    if (b.i === state.cursor) return paint(color, SGR.inverse, padTo(`${left}${about ? ` ${about}` : ''}`, w))
    return `${left}${about ? ` ${paint(color, SGR.grey, about)}` : ''}`
  })
  const count = (list) => list.filter((b) => b.i >= 0 && selectable(items[b.i])).length
  const above = count(body.slice(0, start))
  const below = count(body.slice(end))
  const scroll = above || below ? `  ${above ? `${above} more above` : ''}${above && below ? '   ' : ''}${below ? `${below} more below` : ''}` : ''
  const lines = [...head, ...shown, paint(color, SGR.dim, cut(scroll, w)), paint(color, SGR.dim, cut(hint, w))]
  return lines.map((text) => ({ text, style: 'raw' }))
}
