// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The meerkat's HEAD as pixel art, in profile, looking left or right, in the manner of the mascots of other terminal
// tools: a sprite drawn with the half-block characters, two pixels per character cell (top pixel as the foreground of an
// upper half block, bottom pixel as its background), in true colour. The shape follows a meerkat on lookout: a long
// pointed snout with a black nose, a cream muzzle, brown fur on the crown and neck, a large dark eye patch with a
// bright eye, and a dark ear behind the eye. Looking right is the same head mirrored.
//
// Without colour (NO_COLOR, or a terminal that has none) the same sprite is drawn in shades, the eye still visible.
// Decoration only: it says nothing the table does not say in words.

// A pixel is one letter of the palette; . is empty.
const PALETTE = {
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

export const SPRITE_WIDTH = 30
const HEIGHT = 24
export const SPRITE_ROWS = HEIGHT / 2

// Left and right edge of the head on each pixel row: a long snout at the left tip with a gently sloping nose bridge, the
// crown at the top, then a straight neck going down (standing up on lookout), cut off by the bottom of the sprite.
const EXTENT = [
  [18, 24], [15, 26], [13, 27], [11, 28], [10, 28], [8, 28], [6, 28], [4, 28], [3, 28], [1, 28],
  [0, 28], [0, 28], [1, 28], [3, 27], [7, 27], [11, 27], [14, 27], [15, 27], [15, 27], [15, 27],
  [15, 27], [15, 27], [15, 27], [15, 27],
]
const EYE = [[14, 7], [15, 7], [14, 8], [15, 8]]
const SHINE = [[14, 6]]

export function buildProfile(expression) {
  const g = Array.from({ length: HEIGHT }, () => Array(SPRITE_WIDTH).fill('.'))
  const inside = (x, y) => y >= 0 && y < HEIGHT && x >= EXTENT[y][0] && x <= EXTENT[y][1]
  const put = (x, y, c) => {
    if (inside(x, y)) g[y][x] = c
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = EXTENT[y][0]; x <= EXTENT[y][1]; x++) {
      // The neck runs off the bottom of the sprite, so the bottom is not outlined.
      const open = (nx, ny) => !inside(nx, ny) && ny < HEIGHT
      const edge = open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)
      let c = 'M'
      if (y <= 8 && x <= 19) c = 'T' // forehead
      if (y >= 9 && x <= 17) c = 'L' // muzzle
      if (y >= 12 && x <= 23) c = 'L' // chin and cheek
      if (y >= 15) c = x <= 21 ? 'L' : 'T' // cream front of the neck, tan behind
      g[y][x] = edge ? 'B' : c
    }
  }
  // The dark eye patch (an ellipse round the eye) and the dark ear behind it.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < SPRITE_WIDTH; x++) {
      if (inside(x, y) && g[y][x] !== 'B' && ((x - 15) / 4) ** 2 + ((y - 7) / 2.7) ** 2 <= 1) g[y][x] = 'D'
      if (inside(x, y) && ((x - 22.5) / 2.3) ** 2 + ((y - 8.5) / 3.2) ** 2 <= 1) g[y][x] = 'D'
    }
  }
  for (let x = 2; x <= 13; x++) put(x, 12, 'B') // the line of the mouth
  for (const [x, y] of [[0, 10], [1, 10], [0, 11], [1, 11]]) put(x, y, 'K') // nose
  for (const [x, y] of EYE) put(x, y, 'K')
  for (const [x, y] of SHINE) put(x, y, 'W')
  if (expression === 'blink' || expression === 'happy') {
    for (const [x, y] of [...EYE, ...SHINE]) put(x, y, 'D')
    for (let x = 13; x <= 16; x++) put(x, 7, 'B') // the closed lid
  } else if (expression === 'wide') {
    put(15, 6, 'W')
    put(14, 7, 'W')
  }
  return g.map((r) => r.join(''))
}

const mirror = (grid) => grid.map((row) => [...row].reverse().join(''))

const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`
const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`
const RESET = '\x1b[0m'

// Two pixel rows become one row of characters.
function cellRow(top, bottom, color) {
  let out = ''
  for (let x = 0; x < top.length; x++) {
    const t = top[x]
    const b = bottom[x]
    if (t === '.' && b === '.') out += ' '
    else if (color) {
      if (b === '.') out += `${fg(PALETTE[t])}▀${RESET}`
      else if (t === '.') out += `${fg(PALETTE[b])}▄${RESET}`
      else out += `${fg(PALETTE[t])}${bg(PALETTE[b])}▀${RESET}`
    } else if (t === 'W' || b === 'W') out += SHADE.W
    else if (b === '.') out += '▀'
    else if (t === '.') out += '▄'
    else out += SHADE[DARKNESS[t] >= DARKNESS[b] ? t : b]
  }
  return out
}

// pose: left | right, each also as blink-left | blink-right; happy and wide look right.
export function pixelHead(pose, { color = true } = {}) {
  const blink = pose.startsWith('blink-')
  const dir = blink ? pose.slice(6) : pose === 'happy' || pose === 'wide' ? 'right' : pose
  const expression = pose === 'happy' || pose === 'wide' ? pose : blink ? 'blink' : 'open'
  const profile = buildProfile(expression)
  const grid = dir === 'right' ? mirror(profile) : profile
  const rows = []
  for (let y = 0; y < grid.length; y += 2) rows.push(cellRow(grid[y], grid[y + 1] ?? '.'.repeat(SPRITE_WIDTH), color))
  return rows
}
