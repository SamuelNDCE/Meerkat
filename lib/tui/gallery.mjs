// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// The meerkat on its own: every pose side by side with its label, and the colours it is drawn with. For looking at the art
// (`node preview.mjs --head`), not part of a run.
import { PALETTE, pixelHead } from './pixelhead.mjs'

const ESC = String.fromCharCode(27)
const visible = (t) => t.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '').length
const pad = (t, w) => t + ' '.repeat(Math.max(0, w - visible(t)))
const WIDTH = 34
const GAP = '   '

function row(poses, color) {
  const heads = poses.map(([, pose]) => pixelHead(pose, { color }))
  const out = [poses.map(([label]) => pad(label, WIDTH)).join(GAP)]
  for (let i = 0; i < heads[0].length; i++) out.push(heads.map((h) => pad(h[i], WIDTH)).join(GAP))
  return out.join('\n')
}

// `mode` is the colour the meerkat gets: 'truecolor', '256' or false (shades).
export function renderGallery({ mode = 'truecolor' } = {}) {
  const color = mode
  const lines = [
    '',
    row([['looking right (default)', 'right'], ['glancing left', 'left'], ['blinking', 'blink-right']], color),
    '',
    row([['squinting: all passed', 'happy'], ['wide-eyed: something failed', 'wide']], color),
    '',
  ]
  if (mode === 'truecolor') lines.push(`colours: ${Object.entries(PALETTE).map(([k, [r, g, b]]) => `${ESC}[48;2;${r};${g};${b}m  ${ESC}[0m${k}`).join(' ')}`, '')
  return lines.join('\n')
}
