// The startup look-up of the newest version, shown as one small line in the menu header: a braille spinner and "Checking for updates..."
// while it runs, then "Up to date (v1.2.3)" in green for a second, "Could not check (offline)" in dim for a second, or nothing (the
// yellow bar takes over) when a newer version exists. The look-up never blocks a key: it runs on its own, with a hard time limit.
//
// This file is the pure part: the states, the wording, and a small controller that takes its clock (timers) and its look-up (run)
// from outside so tests need neither a terminal nor a network. lib/menu.mjs draws the line; bin/meerkat.mjs wires the real look-up.
export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SGR = { reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m' }
const paint = (color, code, text) => (color ? `${code}${text}${SGR.reset}` : text)

// What the line says in a state. null means no line (idle, or a newer version: the yellow bar shows that).
export function statusText(state, { frame = 0, color = false, version = '' } = {}) {
  const v = version && version !== 'unknown' ? ` (v${String(version).replace(/^v/, '')})` : ''
  if (state === 'checking') return paint(color, SGR.dim, `${color ? `${FRAMES[Math.abs(frame) % FRAMES.length]} ` : ''}Checking for updates...`)
  if (state === 'current') return paint(color, SGR.green, `Up to date${v}`)
  if (state === 'failed') return paint(color, SGR.dim, 'Could not check (offline)')
  return null
}

// What a finished look-up (maybeAutoUpdateAsync's answer) means for the line.
export function outcomeOf(result) {
  if (!result || !result.ran) return 'skipped'
  if (!result.found?.ok) return 'failed'
  if (result.applied?.ok) return 'current'
  return result.found.behind ? 'newer' : 'current'
}

// run({ onCheck }) returns a promise of { outcome } (see outcomeOf); it calls onCheck when it really starts asking (a look-up is made at
// most once a day, so most starts never ask and show nothing). onChange('tick') is a new spinner frame, onChange('data') is a new state.
export function createUpdateCheck({ run, color = false, isTTY = true, version = '', timers = { setTimeout, clearTimeout, setInterval, clearInterval }, onChange = () => {}, timeoutMs = 3000, holdMs = 1000, frameMs = 90 } = {}) {
  const t = timers
  let state = 'idle'
  let frame = 0
  let spin = null
  let hold = null
  let limit = null
  let settled = false
  const api = {
    onChange,
    get state() {
      return state
    },
    // The line to show now, or null. Nothing at all unless this is a terminal.
    line() {
      return isTTY ? statusText(state, { frame, color, version }) : null
    },
    set(next) {
      if (state === next) return
      state = next
      api.onChange('data')
    },
    stop() {
      for (const h of [spin, hold, limit]) h && (t.clearTimeout(h), t.clearInterval(h))
      spin = hold = limit = null
    },
    // Starts the look-up. The promise ends when the look-up has ended (it is never waited for by the menu).
    start() {
      const done = (outcome) => {
        if (settled) return
        settled = true
        for (const h of [spin, limit]) h && (t.clearTimeout(h), t.clearInterval(h))
        spin = limit = null
        const next = (outcome === 'current' || outcome === 'failed') && holdMs > 0 ? outcome : 'idle'
        api.set(next)
        if (next !== 'idle') {
          hold = t.setTimeout(() => {
            hold = null
            api.set('idle')
          }, holdMs)
        }
      }
      const onCheck = () => {
        if (settled || state === 'checking') return
        state = 'checking'
        api.onChange('data')
        if (color && isTTY) {
          spin = t.setInterval(() => {
            frame = (frame + 1) % FRAMES.length
            api.onChange('tick')
          }, frameMs)
          spin.unref?.()
        }
        limit = t.setTimeout(() => done('failed'), timeoutMs)
        limit.unref?.()
      }
      return Promise.resolve()
        .then(() => run({ onCheck }))
        .then((r) => done(r?.outcome ?? 'skipped'), () => done('failed'))
    },
  }
  return api
}
