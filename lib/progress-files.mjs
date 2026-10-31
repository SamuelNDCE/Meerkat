// The file-progress protocol: how a running check tells the live board which file it is looking at.
//
// A check script prints to stderr (or stdout), one per line, exactly:
//   MEERKAT-FILE <relative path>        the file it is reading now
//   MEERKAT-FILES <done>/<total>        how many files it has read out of how many it will read
// The runner reads these lines out of the child's output stream and removes them, so they never reach a saved log or the
// "last line" a result shows. Everything a child prints is untrusted: a line is accepted only if it matches exactly, a
// path may not hold control characters and may not be longer than MAX_PATH, and a count must be plain digits.
import { stripControl } from './tui/safe.mjs'

export const MAX_PATH = 120
// At most 20 progress lines per second leave a check (50 ms apart).
export const PROGRESS_INTERVAL_MS = 50

// Any line that starts like the protocol is removed from the output, valid or not.
export const PROGRESS_PREFIX_RE = /^MEERKAT-FILES? /
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const COUNT_RE = /^MEERKAT-FILES (\d{1,9})\/(\d{1,9})$/

export const isProgressLine = (line) => PROGRESS_PREFIX_RE.test(String(line ?? '').replace(/\r$/, ''))

// One output line -> { file } | { done, total } | null.
export function parseProgressLine(line) {
  const text = String(line ?? '').replace(/\r$/, '')
  const count = COUNT_RE.exec(text)
  if (count) {
    const done = Number(count[1])
    const total = Number(count[2])
    return done <= total ? { done, total } : null
  }
  if (!text.startsWith('MEERKAT-FILE ')) return null
  const file = text.slice('MEERKAT-FILE '.length)
  if (!file.trim() || file.length > MAX_PATH || CONTROL_RE.test(file)) return null
  return { file: stripControl(file) }
}

// A rate limiter with an injectable clock. `ok()` is true at most once per `gapMs`.
export function createThrottle(gapMs = PROGRESS_INTERVAL_MS, now = Date.now) {
  let last = -Infinity
  return {
    ok() {
      const t = now()
      if (t - last < gapMs) return false
      last = t
      return true
    },
    reset() {
      last = -Infinity
    },
  }
}

// The emitting side, used by thorough/kit.mjs. MEERKAT_PROGRESS=1 sends file lines and counts, MEERKAT_PROGRESS=count sends only
// the count (once), anything else sends nothing at all. `env` is read on every call, so setting the variable later works.
export function createProgressEmitter({ env = process.env, write = (s) => process.stderr.write(s), now = Date.now } = {}) {
  const throttle = createThrottle(PROGRESS_INTERVAL_MS, now)
  let total = null
  const seen = new Set()
  const mode = () => (env.MEERKAT_PROGRESS === '1' ? 'files' : env.MEERKAT_PROGRESS === 'count' ? 'count' : '')
  const safeWrite = (s) => {
    try {
      write(s)
    } catch {
      /* progress is decoration: a closed pipe never stops a check */
    }
  }
  return {
    // The number of files this check will look at.
    total(n) {
      if (!mode()) return
      total = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
      seen.clear()
      if (total !== null) safeWrite(`MEERKAT-FILES 0/${total}\n`)
    },
    // This file is being read now.
    file(f) {
      if (mode() !== 'files') return
      const name = String(f ?? '')
      if (!name || name.length > MAX_PATH || CONTROL_RE.test(name)) return
      seen.add(name)
      if (!throttle.ok()) return
      const count = total === null ? '' : `MEERKAT-FILES ${Math.min(seen.size, total)}/${total}\n`
      safeWrite(`MEERKAT-FILE ${name}\n${count}`)
    },
  }
}
