// How much colour this terminal can show, decided the way image-to-terminal tools such as viu do it: NO_COLOR switches
// colour off; a COLORTERM of "truecolor" or "24bit" means 16 million colours; a few terminals that are known to draw 24-bit
// colour say so by name; "256color" in TERM means 256 colours; a modern Windows console draws 24-bit colour. The sprite is
// the only thing that needs more than the 16 basic colours, and it degrades: truecolor, then 256 colours, then shades.
export function colorLevel(env = process.env, platform = process.platform) {
  if (env.NO_COLOR) return false
  const colorterm = String(env.COLORTERM ?? '').toLowerCase()
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor'
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || ['vscode', 'WezTerm', 'iTerm.app'].includes(env.TERM_PROGRAM)) return 'truecolor'
  if (/256color/.test(String(env.TERM ?? ''))) return '256'
  if (platform === 'win32') return 'truecolor'
  return '256'
}

// The nearest of the 256 terminal colours: the 6x6x6 colour cube, or the grey ramp when the colour is nearly grey.
export function to256([r, g, b]) {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 10) {
    const grey = Math.round(((r + g + b) / 3 - 8) / 10)
    return grey < 0 ? 16 : grey > 23 ? 231 : 232 + grey
  }
  const step = (v) => Math.min(5, Math.round(v / 51))
  return 16 + 36 * step(r) + 6 * step(g) + step(b)
}
