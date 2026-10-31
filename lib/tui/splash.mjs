// The loading screen: what Meerkat is doing while it gets ready (loading the checks, reading the times measured on this PC,
// finding what changed against origin/dev, choosing the checks), with the meerkat watching and a spinner on the step in
// progress. It is drawn a step at a time and erased when the board starts, so it never adds time and never stays on screen.
// Real work only: a step is listed when it really starts.
import { colorLevel } from './color.mjs'
import { PALETTE, pixelHead, SPRITE_WIDTH } from './pixelhead.mjs'
import { furPalette, SPINNERS, sgrFor, THEMES } from './theme.mjs'

const ESC = String.fromCharCode(27) + '['
const visible = (t) => t.replace(new RegExp(`${ESC.replace('[', '\\[')}[0-9;]*m`, 'g'), '').length

// Pure: the lines of the splash for these steps ({ label, state: 'done' | 'doing' | 'todo' }).
export function renderSplash({ title = 'MEERKAT', steps, tick = 0, theme = THEMES.meerkat, level = 'truecolor', color = true }) {
  const c = (code, t) => (color ? `${ESC}${code}m${t}${ESC}0m` : t)
  const frames = SPINNERS[theme.spinner] ?? SPINNERS.dots
  const work = sgrFor(theme.bar?.work, level === '256' ? '256' : 'truecolor') ?? '36'
  const ok = sgrFor(theme.bar?.ok, level === '256' ? '256' : 'truecolor') ?? '32'
  const head = theme.mascot === false ? [] : pixelHead(tick % 40 === 39 ? 'blink-right' : 'right', { color: level, palette: furPalette(PALETTE, theme.fur) })
  const info = [
    `${c('1', title)}  ${c('90', 'getting ready')}`,
    '',
    ...steps.map((s) => (s.state === 'done' ? `${c(ok, '✔')} ${s.label}` : s.state === 'doing' ? `${c(work, frames[tick % frames.length])} ${s.label}` : c('90', `· ${s.label}`))),
  ]
  const rows = Math.max(head.length, info.length)
  const lines = []
  for (let i = 0; i < rows; i++) {
    const left = head[i] ?? ''
    lines.push(`${left}${' '.repeat(Math.max(0, SPRITE_WIDTH + 4 - visible(left)))}${info[i] ?? ''}`.replace(/\s+$/, ''))
  }
  return lines
}

// The live splash: `step(label)` marks the step before it done and starts a new one; `finish()` leaves the screen it drew.
// It is drawn on the terminal's ALTERNATE screen, from the top-left each time, so a step never adds a line to the scrollback and a note
// printed meanwhile cannot make a later redraw land in the wrong place (which left stacked "getting ready" frames behind).
export function createSplash({ stream = process.stdout, title = 'MEERKAT', theme = THEMES.meerkat, env = process.env, enabled = true, color = !env.NO_COLOR } = {}) {
  if (!enabled) return { step() {}, finish() {}, enabled: false }
  const level = color ? colorLevel(env) : false
  const steps = []
  let tick = 0
  let open = false
  const draw = () => {
    if (!open) {
      open = true
      stream.write(`${ESC}?1049h${ESC}?25l`)
    }
    const lines = renderSplash({ title, steps, tick: tick++, theme, level, color })
    stream.write(`${ESC}H${lines.map((l) => `${l}${ESC}K`).join('\n')}\n${ESC}J`)
  }
  const finish = () => {
    if (!open) return
    open = false
    stream.write(`${ESC}?25h${ESC}?1049l`)
  }
  process.once('exit', finish)
  return {
    enabled: true,
    step(label) {
      for (const s of steps) if (s.state === 'doing') s.state = 'done'
      steps.push({ label, state: 'doing' })
      draw()
    },
    finish,
  }
}
