// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The meerkat as PIXEL art, in the manner of the mascots of other terminal tools: a small sprite drawn with the
// half-block characters, two pixels per character cell (top pixel as the foreground of an upper half block, bottom
// pixel as its background), in true colour. A profile looking left, its mirror looking right, and a front view for
// the middle of a scan. Eyes change for a blink, a wide-eyed alarm and a squint of pleasure.
//
// Colours are taken from a meerkat on lookout: tan fur, a cream face and chest, a dark eye patch and ear, a black nose.
// Without colour (NO_COLOR, or a terminal that has none) the same sprite is drawn in shades, with the eye still visible.
// Decoration only: it says nothing the table does not say in words.

// A pixel is one letter of the palette; . is empty.
const PALETTE = {
  B: [122, 84, 55], // outline and shade
  T: [190, 150, 105], // tan fur
  L: [232, 214, 180], // cream face
  D: [44, 30, 26], // dark patch, ear
  K: [20, 14, 12], // nose
  W: [255, 255, 255], // eye shine
}
const SHADE = { B: '▓', T: '▒', L: '░', D: '█', K: '█', W: '○' }
const DARKNESS = { '.': -1, L: 0, T: 1, B: 2, D: 3, K: 3, W: 4 }

// Profile looking left. 18 wide, 14 tall (7 character rows). Snout and nose at the left, ear at the top right.
const LEFT = [
  '.......BBBBBB......',
  '.....BBTTTTTTBB....',
  '....BTTTTTTTTTTB...',
  '...BTTTTTTTTTTTDD..',
  '..BTTTLLDDDTTTTDD..',
  '.BTTLLLDDWDDTTTBD..',
  'BTTLLLLLDDDDTTTTB..',
  'KLLLLLLLLLTTTTTTB..',
  '.KLLLLLLLLLTTTTB...',
  '..LLLLLLLLLLTTB....',
  '...LLLLLLLLLTB.....',
  '....LLLLLLLLB......',
  '.....BLLLLBB.......',
  '......BBBB.........',
]

// Front view, same size. Ears at the top corners, a dark patch round each eye, a black nose in the middle.
const FRONT = [
  '....BB......BB....',
  '...BDDB....BDDB...',
  '...BDDBBBBBBDDB...',
  '....BTTTTTTTTB....',
  '...BTTTTTTTTTTB...',
  '..BTTDDDLLDDDTTB..',
  '..BTTDWDLLDWDTTB..',
  '..BTTDDDLLDDDTTB..',
  '...BTTTLLLLTTTB...',
  '....BTLLKKLLTB....',
  '.....BLLKKLLB.....',
  '......BLLLLB......',
  '.......BBBB.......',
  '..................',
]

const mirror = (grid) => grid.map((row) => [...row].reverse().join(''))

// Where the eye is, per sprite, so an expression can change it.
const EYE = { left: [[5, 9]], front: [[6, 6], [6, 10]] }

function withEye(grid, spots, pose) {
  const rows = grid.map((r) => [...r])
  for (const [y, x] of spots) {
    if (pose === 'blink' || pose === 'happy') {
      rows[y][x] = 'D' // closed
    } else if (pose === 'wide') {
      rows[y][x] = 'W'
      if (rows[y + 1]?.[x] === 'D') rows[y + 1][x] = 'W' // a taller, startled eye
    }
  }
  return rows.map((r) => r.join(''))
}

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

export const SPRITE_WIDTH = 18
export const SPRITE_ROWS = 7

// pose: left | center | right, each also as blink-left | blink-center | blink-right; happy and wide look left.
export function pixelHead(pose, { color = true } = {}) {
  const blink = pose.startsWith('blink-')
  const dir = blink ? pose.slice(6) : pose
  const expression = pose === 'happy' || pose === 'wide' ? pose : blink ? 'blink' : 'open'
  let grid
  if (dir === 'center') grid = withEye(FRONT, EYE.front, expression)
  else {
    const profile = withEye(LEFT, EYE.left, expression)
    grid = dir === 'right' ? mirror(profile) : profile
  }
  const rows = []
  for (let y = 0; y < grid.length; y += 2) rows.push(cellRow(grid[y], grid[y + 1] ?? '.'.repeat(SPRITE_WIDTH), color))
  return rows
}
