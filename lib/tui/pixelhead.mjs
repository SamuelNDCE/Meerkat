// The meerkat's HEAD as pixel art, in profile, looking left or right, in the manner of the mascots of other terminal
// tools: a sprite drawn with the half-block characters, two pixels per character cell (top pixel as the foreground of an
// upper half block, bottom pixel as its background), in true colour. The shape follows a meerkat on lookout: a long
// pointed snout with a black nose, a cream muzzle, brown fur on the crown and neck, a large dark eye patch with a
// bright eye, and a dark ear behind the eye. Looking right is the same head mirrored.
//
// Without colour (NO_COLOR, or a terminal that has none) the same sprite is drawn in shades, the eye still visible.
// Decoration only: it says nothing the table does not say in words.

import { to256 } from './color.mjs'

// A pixel is one letter of the palette; . is empty.
export const PALETTE = {
  B: [96, 66, 44], // outline
  M: [154, 112, 76], // brown fur
  T: [190, 150, 105], // tan fur
  L: [236, 218, 186], // cream muzzle and cheek
  D: [44, 30, 26], // eye patch and ear
  K: [14, 10, 9], // nose and eye
  W: [255, 255, 255], // shine in the eye
}
const SHADE = { B: '▓', M: '▒', T: '░', L: '·', D: '█', K: '█', W: '○' }
const DARKNESS = { '.': -1, L: 0, T: 1, M: 2, B: 3, D: 4, K: 4, W: 5 }

export const SPRITE_WIDTH = 28
const HEIGHT = 20
export const SPRITE_ROWS = HEIGHT / 2

// Left and right edge of the head on each pixel row. The snout is a little longer than the first drawing, and the profile
// dips where the skull meets it (the stop, just in front of the brow) before the bridge runs forward to the nose, as in a
// real meerkat. The neck is short and slopes back, not a long straight column.
const EXTENT = [
  [16, 22], [13, 24], [11, 25], [9, 26], [7, 26], [8, 26], [8, 26], [6, 26], [4, 26], [2, 26],
  [0, 26], [0, 26], [2, 26], [4, 25], [6, 24], [8, 24], [11, 25], [14, 26], [16, 27], [17, 27],
]
const EYE = [[12, 7], [13, 7], [12, 8], [13, 8]]
const SHINE = [[12, 6]]

export function buildProfile(expression) {
  const g = Array.from({ length: HEIGHT }, () => Array(SPRITE_WIDTH).fill('.'))
  const inside = (x, y) => y >= 0 && y < HEIGHT && x >= EXTENT[y][0] && x <= EXTENT[y][1]
  const put = (x, y, c) => {
    if (inside(x, y)) g[y][x] = c
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = EXTENT[y][0]; x <= EXTENT[y][1]; x++) {
      // The neck is cut off by the edge of the sprite, so the right side and the bottom are not outlined there.
      const open = (nx, ny) => !inside(nx, ny) && !(ny >= HEIGHT || (nx >= 26 && y >= 13))
      const edge = open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)
      let c = 'M'
      if (y <= 8 && x <= 17) c = 'T' // forehead
      if (y >= 9 && x <= 15) c = 'L' // muzzle
      if (y >= 12 && x <= 21) c = 'L' // chin and cheek
      if (y >= 15 && x >= 16) c = 'T' // neck
      g[y][x] = edge ? 'B' : c
    }
  }
  // The dark eye patch (an ellipse round the eye) and the dark ear behind it.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < SPRITE_WIDTH; x++) {
      if (inside(x, y) && g[y][x] !== 'B' && ((x - 13) / 4) ** 2 + ((y - 7) / 2.7) ** 2 <= 1) g[y][x] = 'D'
      if (inside(x, y) && ((x - 20.5) / 2.3) ** 2 + ((y - 8.5) / 3.2) ** 2 <= 1) g[y][x] = 'D'
    }
  }
  for (let x = 4; x <= 11; x++) put(x, 12, 'B') // the line of the mouth
  for (const [x, y] of [[0, 10], [1, 10], [0, 11], [1, 11]]) put(x, y, 'K') // nose
  for (const [x, y] of EYE) put(x, y, 'K')
  for (const [x, y] of SHINE) put(x, y, 'W')
  if (expression === 'blink' || expression === 'happy') {
    for (const [x, y] of [...EYE, ...SHINE]) put(x, y, 'D')
    for (let x = 11; x <= 14; x++) put(x, 7, 'B') // the closed lid
  } else if (expression === 'wide') {
    put(13, 6, 'W')
    put(12, 7, 'W')
  }
  return g.map((r) => r.join(''))
}

const mirror = (grid) => grid.map((row) => [...row].reverse().join(''))

// `mode` is 'truecolor' (also true) for 24-bit colour, or '256' for the 256-colour palette.
const fg = (rgb, mode) => (mode === '256' ? `\x1b[38;5;${to256(rgb)}m` : `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`)
const bg = (rgb, mode) => (mode === '256' ? `\x1b[48;5;${to256(rgb)}m` : `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`)
const RESET = '\x1b[0m'

// Two pixel rows become one row of characters.
function cellRow(top, bottom, color, palette = PALETTE) {
  let out = ''
  for (let x = 0; x < top.length; x++) {
    const t = top[x]
    const b = bottom[x]
    if (t === '.' && b === '.') out += ' '
    else if (color) {
      if (b === '.') out += `${fg(palette[t], color)}▀${RESET}`
      else if (t === '.') out += `${fg(palette[b], color)}▄${RESET}`
      else out += `${fg(palette[t], color)}${bg(palette[b], color)}▀${RESET}`
    } else if (t === 'W' || b === 'W') out += SHADE.W
    else if (b === '.') out += '▀'
    else if (t === '.') out += '▄'
    else out += SHADE[DARKNESS[t] >= DARKNESS[b] ? t : b]
  }
  return out
}

// pose: left | right, each also as blink-left | blink-right; happy and wide look right.
// color: true or 'truecolor' (24-bit), '256', or false (shades). lib/tui/color.mjs decides which one a terminal gets.
// palette: the meerkat's colours, for a theme that recolours it (see theme.mjs furPalette).
export function pixelHead(pose, { color = true, palette = PALETTE } = {}) {
  const blink = pose.startsWith('blink-')
  const dir = blink ? pose.slice(6) : pose === 'happy' || pose === 'wide' ? 'right' : pose
  const expression = pose === 'happy' || pose === 'wide' ? pose : blink ? 'blink' : 'open'
  const profile = buildProfile(expression)
  const grid = dir === 'right' ? mirror(profile) : profile
  const rows = []
  for (let y = 0; y < grid.length; y += 2) rows.push(cellRow(grid[y], grid[y + 1] ?? '.'.repeat(SPRITE_WIDTH), color, palette))
  return rows
}
