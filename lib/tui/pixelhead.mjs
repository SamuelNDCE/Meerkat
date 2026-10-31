// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The meerkat's HEAD as pixel art, in profile, looking left or right, in the manner of the mascots of other terminal
// tools: a sprite drawn with the half-block characters, two pixels per character cell (top pixel as the foreground of an
// upper half block, bottom pixel as its background), in true colour. This is the same technique as the "half block"
// mode of image-to-terminal converters; what makes it read as pixel art rather than line art is the drawing: three tones
// per fur colour (light from the top left, shade to the bottom right), a dark rim round the eye patch, a lit eye with a
// ring, fur speckle, a nose with a shine, a pink inner ear and a few whiskers.
//
// The shape follows a meerkat on lookout: a long pointed snout with a black nose, a dip where the skull meets it, a cream
// muzzle, brown fur on the crown and neck, a large dark eye patch and a dark ear behind it. Looking right is the same head
// mirrored. Without colour (NO_COLOR, or a terminal that has none) the same sprite is drawn in shades, the eye still visible.
// Decoration only: it says nothing the table does not say in words.

import { to256 } from './color.mjs'

// A pixel is one letter of the palette; . is empty. Upper case is the middle tone, lower case the light one, and the shade
// has its own letter (brown M m N, tan T t U, cream L l H, dark D d).
export const PALETTE = {
  B: [96, 66, 44], // outline
  m: [190, 146, 104], // brown, light
  M: [154, 112, 76], // brown
  N: [118, 82, 56], // brown, shade
  t: [224, 188, 140], // tan, light
  T: [194, 154, 108], // tan
  U: [160, 122, 84], // tan, shade
  l: [252, 240, 216], // cream, light
  L: [238, 220, 188], // cream
  H: [204, 182, 148], // cream, shade
  d: [78, 56, 46], // dark patch, rim and lit side
  D: [44, 30, 26], // dark patch
  K: [14, 10, 9], // nose and eye
  I: [96, 64, 42], // ring round the eye
  W: [255, 255, 255], // shine
  E: [176, 118, 112], // inside of the ear
  Y: [214, 208, 198], // whiskers
}
const SHADE = { B: '▓', m: '▒', M: '▒', N: '▓', t: '░', T: '░', U: '▒', l: '·', L: '·', H: '░', d: '█', D: '█', K: '█', I: '▒', W: '○', E: '▒', Y: '·' }
const DARKNESS = { '.': -1, l: 0, L: 0, Y: 0, H: 1, t: 1, T: 1, E: 1, m: 2, U: 2, M: 2, I: 3, N: 3, B: 3, d: 4, D: 4, K: 4, W: 5 }

const BODY_WIDTH = 28
const WHISKER_ROOM = 5
export const SPRITE_WIDTH = BODY_WIDTH + WHISKER_ROOM
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
const RING = [[11, 7], [11, 8], [14, 7], [14, 8], [12, 9], [13, 9], [13, 6]]
const SHINE = [[12, 6]]

const LIGHT = { M: 'm', T: 't', L: 'l' }
const SHADOW = { M: 'N', T: 'U', L: 'H' }

function buildBody(expression) {
  const g = Array.from({ length: HEIGHT }, () => Array(BODY_WIDTH).fill('.'))
  const inside = (x, y) => y >= 0 && y < HEIGHT && x >= EXTENT[y][0] && x <= EXTENT[y][1]
  const put = (x, y, c) => {
    if (inside(x, y)) g[y][x] = c
  }
  // 1. Silhouette and flat fur colours, with an outline.
  const material = (x, y) => {
    let c = 'M'
    if (y <= 8 && x <= 17) c = 'T' // forehead
    if (y >= 9 && x <= 15) c = 'L' // muzzle
    if (y >= 12 && x <= 21) c = 'L' // chin and cheek
    if (y >= 15 && x >= 16) c = 'T' // neck
    return c
  }
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = EXTENT[y][0]; x <= EXTENT[y][1]; x++) {
      // The neck is cut off by the edge of the sprite, so the right side and the bottom are not outlined there.
      const open = (nx, ny) => !inside(nx, ny) && !(ny >= HEIGHT || (nx >= 26 && y >= 13))
      const edge = open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)
      g[y][x] = edge ? 'B' : material(x, y)
    }
  }
  // 2. Light and shade: light comes from the top left, so a fur pixel next to the outline on its top or left side is the
  // light tone and one next to the outline on its bottom or right is the shade. Fur gets a little speckle so it is not flat.
  const snapshot = g.map((r) => [...r])
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < BODY_WIDTH; x++) {
      const c = snapshot[y][x]
      if (!LIGHT[c]) continue
      const at = (dx, dy) => snapshot[y + dy]?.[x + dx]
      const shadeSide = at(1, 0) === 'B' || at(0, 1) === 'B' || at(1, 1) === 'B' || at(0, 1) === '.' || at(1, 0) === '.'
      const lightSide = at(-1, 0) === 'B' || at(0, -1) === 'B' || at(-1, -1) === 'B'
      if (shadeSide) g[y][x] = SHADOW[c]
      else if (lightSide) g[y][x] = LIGHT[c]
      else if (c !== 'L' && (x * 5 + y * 3) % 7 === 0) g[y][x] = LIGHT[c]
      else if (c !== 'L' && (x * 3 + y * 5) % 11 === 0) g[y][x] = SHADOW[c]
    }
  }
  // A highlight along the crown and the bridge of the snout, and a soft shadow under the jaw.
  for (const [x, y] of [[13, 2], [14, 2], [15, 3], [12, 3], [11, 4], [10, 4], [6, 8], [7, 8], [5, 9], [4, 9]]) if (inside(x, y) && LIGHT[g[y][x]]) g[y][x] = LIGHT[g[y][x]]
  for (const [x, y] of [[6, 13], [7, 13], [8, 14], [9, 14], [10, 14]]) if (inside(x, y) && SHADOW[g[y][x]]) g[y][x] = SHADOW[g[y][x]]
  // 3. The dark eye patch with a lighter rim, and the dark ear behind it with a pink inside.
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < BODY_WIDTH; x++) {
      if (!inside(x, y) || g[y][x] === 'B') continue
      const patch = ((x - 13) / 4) ** 2 + ((y - 7) / 2.7) ** 2
      if (patch <= 1) g[y][x] = patch > 0.62 ? 'd' : 'D'
      const ear = ((x - 20.5) / 2.3) ** 2 + ((y - 8.5) / 3.2) ** 2
      if (ear <= 1) g[y][x] = 'D'
    }
  }
  for (const [x, y] of [[19, 6], [19, 7], [20, 6], [19, 8]]) put(x, y, 'd') // lit rim of the ear
  for (const [x, y] of [[21, 8], [21, 9], [22, 9]]) put(x, y, 'E') // inside of the ear
  for (let x = 4; x <= 11; x++) put(x, 12, 'B') // the line of the mouth
  for (const [x, y] of [[0, 10], [1, 10], [0, 11], [1, 11]]) put(x, y, 'K') // nose
  put(1, 10, 'd') // shine on the nose
  // 4. The eye: black, a ring round it, a shine.
  for (const [x, y] of RING) put(x, y, 'I')
  for (const [x, y] of EYE) put(x, y, 'K')
  for (const [x, y] of SHINE) put(x, y, 'W')
  if (expression === 'blink' || expression === 'happy') {
    for (const [x, y] of [...EYE, ...RING, ...SHINE]) put(x, y, 'D')
    for (let x = 11; x <= 14; x++) put(x, 7, 'B') // the closed lid
  } else if (expression === 'wide') {
    put(13, 6, 'W')
    put(12, 7, 'W')
  }
  return g.map((r) => r.join(''))
}

// The body with room on the snout side for whiskers, which fan out from the muzzle.
export function buildProfile(expression) {
  const rows = buildBody(expression).map((r) => '.'.repeat(WHISKER_ROOM) + r)
  const grid = rows.map((r) => [...r])
  const O = WHISKER_ROOM
  for (const [dx, y] of [[-1, 9], [-2, 9], [-3, 8], [-4, 8], [-5, 7], [-1, 12], [-2, 12], [-3, 13], [-4, 13], [-5, 14]]) {
    if (grid[y][O + dx] === '.') grid[y][O + dx] = 'Y'
  }
  return grid.map((r) => r.join(''))
}

const mirror = (grid) => grid.map((row) => [...row].reverse().join(''))

// `mode` is 'truecolor' (also true) for 24-bit colour, or '256' for the 256-colour palette.
const fg = (rgb, mode) => (mode === '256' ? `\x1b[38;5;${to256(rgb)}m` : `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`)
const bg = (rgb, mode) => (mode === '256' ? `\x1b[48;5;${to256(rgb)}m` : `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`)
const RESET = '\x1b[0m'

// Two pixel rows become one row of characters.
function cellRow(top, bottom, color) {
  let out = ''
  for (let x = 0; x < top.length; x++) {
    const t = top[x]
    const b = bottom[x]
    if (t === '.' && b === '.') out += ' '
    else if (color) {
      if (b === '.') out += `${fg(PALETTE[t], color)}▀${RESET}`
      else if (t === '.') out += `${fg(PALETTE[b], color)}▄${RESET}`
      else out += `${fg(PALETTE[t], color)}${bg(PALETTE[b], color)}▀${RESET}`
    } else if (t === 'W' || b === 'W') out += SHADE.W
    else if (b === '.') out += '▀'
    else if (t === '.') out += '▄'
    else out += SHADE[DARKNESS[t] >= DARKNESS[b] ? t : b]
  }
  return out
}

// color: true or 'truecolor' (24-bit), '256', or false (shades). lib/tui/color.mjs decides which one a terminal gets.
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
