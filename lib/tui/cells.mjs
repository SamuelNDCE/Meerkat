// Display-width helpers: how many terminal cells a string takes, so columns line up even when a name holds a wide (CJK, emoji)
// character, a combining mark or colour codes. Pure, no dependencies.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g

export const stripAnsi = (t) => String(t ?? '').replace(ANSI, '')

// 0 for combining marks, joiners and variation selectors, 2 for wide and emoji characters, else 1.
export function cellWidth(ch) {
  const cp = ch.codePointAt(0)
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2
  return 1
}

// Width of a string on screen (colour codes take no room).
export const textWidth = (t) => {
  let n = 0
  for (const ch of stripAnsi(t)) n += cellWidth(ch)
  return n
}

// Cut plain text to `room` cells, ending in an ellipsis when something was cut.
export function fitCells(text, room) {
  const t = String(text ?? '')
  if (room <= 0) return ''
  if (textWidth(t) <= room) return t
  let out = ''
  let w = 0
  for (const ch of t) {
    const cw = cellWidth(ch)
    if (w + cw > room - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}

// Exactly `n` cells: cut with an ellipsis if longer, padded with spaces if shorter. Works on text that already holds colour codes.
export function padCells(text, n, { right = false } = {}) {
  const t = String(text ?? '')
  const w = textWidth(t)
  if (w > n) return fitCells(stripAnsi(t), n) + ' '.repeat(Math.max(0, n - textWidth(fitCells(stripAnsi(t), n))))
  const gap = ' '.repeat(n - w)
  return right ? gap + t : t + gap
}

// A whole line cut to `width` cells, colour codes kept (a reset is added when something was cut).
export function clipLine(line, width) {
  if (textWidth(line) <= width) return line
  let out = ''
  let w = 0
  let i = 0
  const s = String(line)
  while (i < s.length) {
    ANSI.lastIndex = i
    const m = ANSI.exec(s)
    if (m && m.index === i) {
      out += m[0]
      i += m[0].length
      continue
    }
    const cp = s.codePointAt(i)
    const ch = String.fromCodePoint(cp)
    const cw = cellWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
    i += ch.length
  }
  return `${out}…\x1b[0m`
}
