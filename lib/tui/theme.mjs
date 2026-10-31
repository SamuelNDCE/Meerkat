// How the board looks, in one place a person can change. A theme sets the colour of the bars (done, working, warning, failed,
// and the shimmer that sweeps along them), the style of the spinner, how fast things animate, whether the meerkat is shown, and
// can recolour the meerkat itself (any palette letter). There is one built-in look; adjust it in
// ~/.meerkat-theme.json (outside any repo, like the other per-user files):
//   { "spinner": "arc", "speed": 1.5, "mascot": true,
//     "bar": { "ok": "#6fcf7f", "shimmer": "white" }, "fur": { "M": "#8899bb" } }
// Colours may be a hex like #rrggbb or one of the 16 names below. A value that is not valid is ignored and the theme's own
// value is used, so a typo can never break a run. Status is still always a WORD on screen; a theme only changes the look.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAMES = { black: '30', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', white: '37', grey: '90', gray: '90', brightwhite: '97', brightgreen: '92', brightcyan: '96' }

export const SPINNERS = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  blocks: ['▖', '▘', '▝', '▗'],
}

// There is one look. A person can still tune it in the personal file (colours, spinner, speed, mascot on or off).
export const THEMES = {
  meerkat: { bar: { ok: '32', work: '36', warn: '33', bad: '31', shimmer: '97' }, spinner: 'dots', speed: 1, mascot: true, fur: {} },
}

const HEX = /^#[0-9a-fA-F]{6}$/

// A colour as the pair [kind, value]: ['sgr', '32'] for a basic colour, ['rgb', [r,g,b]] for a hex one, or null.
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (HEX.test(v)) return ['rgb', [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))]
  if (/^(3|9)[0-7]$/.test(v)) return ['sgr', v]
  if (NAMES[v]) return ['sgr', NAMES[v]]
  return null
}

// The escape sequence for a colour kept in a theme (a basic code such as '32', a name, or a hex).
export function sgrFor(value, level = 'truecolor') {
  const c = parseColor(value)
  if (!c) return null
  if (c[0] === 'sgr') return c[1]
  const [r, g, b] = c[1]
  if (level === '256') return `38;5;${rgbTo256(r, g, b)}`
  return `38;2;${r};${g};${b}`
}

function rgbTo256(r, g, b) {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 10) {
    const grey = Math.round(((r + g + b) / 3 - 8) / 10)
    return grey < 0 ? 16 : grey > 23 ? 231 : 232 + grey
  }
  const step = (v) => Math.min(5, Math.round(v / 51))
  return 16 + 36 * step(r) + 6 * step(g) + step(b)
}

// Merge `extra` over `base`, keeping only valid values.
function mergeTheme(base, extra) {
  const out = { ...base, bar: { ...base.bar }, fur: { ...base.fur } }
  if (!extra || typeof extra !== 'object') return out
  for (const k of Object.keys(out.bar)) if (parseColor(extra.bar?.[k])) out.bar[k] = extra.bar[k]
  if (extra.fur && typeof extra.fur === 'object') for (const [k, v] of Object.entries(extra.fur)) if (/^[A-Za-z]$/.test(k) && HEX.test(String(v))) out.fur[k] = v
  if (SPINNERS[extra.spinner]) out.spinner = extra.spinner
  if (typeof extra.speed === 'number' && extra.speed >= 0.25 && extra.speed <= 4) out.speed = extra.speed
  if (typeof extra.mascot === 'boolean') out.mascot = extra.mascot
  return out
}

// The theme for this run: the named built-in (MEERKAT_THEME or `name`), then the person's file on top. Never throws.
export function loadTheme({ name, env = process.env, readFile } = {}) {
  let file = null
  try {
    const path = env.MEERKAT_THEME_FILE || join(homedir(), '.meerkat-theme.json')
    file = JSON.parse((readFile ?? ((p) => readFileSync(p, 'utf8')))(path))
  } catch {
    file = null
  }
  const chosen = name || env.MEERKAT_THEME || (file && typeof file.theme === 'string' ? file.theme : 'meerkat')
  const base = THEMES[chosen] ?? THEMES.meerkat
  return { name: THEMES[chosen] ? chosen : 'meerkat', ...mergeTheme(base, file) }
}

// The meerkat's palette with the theme's recolouring applied, as [r,g,b] arrays.
export function furPalette(palette, fur = {}) {
  const out = { ...palette }
  for (const [k, hex] of Object.entries(fur)) if (palette[k] && HEX.test(hex)) out[k] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return out
}
