// The live display of Meerkat, the validation tool: a progress bar, the time spent and the time left, what is running now,
// and every check as it finishes. Drawn only in a real terminal (or with --progress); piped output, CI logs and
// AI sessions keep the plain `[start  ]` / `[PASS   ]` lines, so nothing that reads the log changes.
//
// The bar is weighted by each check's estSeconds (the measured time on the dev machine), so a ten minute window
// check moves it more than a one second scan, and a check that is running counts for the part of its estimate
// that has passed (never more than 95%). The time left is the time spent divided by the progress so far, so it
// is a guess and is shown as "about"; it only appears once a tenth of the work is done.
const ESC = '\x1b['

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

// For the board and the report: under 10 s with one decimal ("0.2s", so a quick check never reads 0:00), from 10 s as m:ss.
export function formatShort(ms) {
  const v = Math.max(0, Number.isFinite(ms) ? ms : 0)
  return v < 9950 ? `${(v / 1000).toFixed(1)}s` : formatDuration(v)
}

export function renderBar(fraction, width) {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const filled = Math.round(f * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// The same bar, split by outcome: the part that passed is green, the part that failed is red, what could not run is yellow, and the
// part still running is shown lighter. `parts` are weights (seconds of estimated work), so a failed check takes its share of the bar.
export function renderSplitBar({ pass = 0, fail = 0, notRun = 0, running = 0, total = 1 }, width, paint = (_code, text) => text) {
  const cells = (w) => Math.round((Math.max(0, w) / Math.max(1, total)) * width)
  let p = cells(pass)
  let f = cells(fail)
  let n = cells(notRun)
  let r = cells(running)
  // Rounding must never overflow the bar, and a failure must stay visible even when it is a sliver of the work.
  if (fail > 0 && f === 0) f = 1
  while (p + f + n + r > width) {
    if (r > 0) r--
    else if (p > 0) p--
    else if (n > 0) n--
    else f--
  }
  return paint('32', '█'.repeat(p)) + paint('31', '█'.repeat(f)) + paint('33', '█'.repeat(n)) + paint('36', '▒'.repeat(r)) + '░'.repeat(Math.max(0, width - p - f - n - r))
}

// Pure progress maths, so it can be tested without a terminal.
export function computeProgress({ checks, done, running, now }) {
  const weight = (c) => Math.max(1, c.estSeconds ?? 30)
  const total = checks.reduce((n, c) => n + weight(c), 0)
  let have = 0
  for (const c of checks) if (done.has(c.id)) have += weight(c)
  for (const [id, startedAt] of running) {
    const c = checks.find((x) => x.id === id)
    if (c) have += weight(c) * Math.min(0.95, (now - startedAt) / 1000 / weight(c))
  }
  const fraction = total > 0 ? Math.min(1, have / total) : 1
  return { total, have, fraction }
}

export function etaMs(fraction, elapsedMs) {
  if (fraction < 0.1 || fraction >= 1) return null
  return Math.max(0, (elapsedMs / fraction) * (1 - fraction))
}

function clip(text, width) {
  const t = String(text).replace(/\s+/g, ' ')
  return t.length > width ? `${t.slice(0, Math.max(0, width - 1))}…` : t
}

export function createProgress({ title, checks, stream = process.stdout, enabled = Boolean(process.stdout.isTTY), now = Date.now, color = !process.env.NO_COLOR, tickMs = 1000 }) {
  const started = now()
  const done = new Set()
  const running = new Map()
  const counts = { PASS: 0, FAIL: 0, 'NOT RUN': 0 }
  const outcome = new Map() // id -> { status, ms }
  let blockLines = 0
  let timer = null
  const c = (code, text) => (color ? `${ESC}${code}m${text}${ESC}0m` : text)
  const cols = () => Math.max(40, Math.min(stream.columns || 100, 140))

  const statusBlock = () => {
    const width = cols()
    const t = now()
    const { fraction } = computeProgress({ checks, done, running, now: t })
    const barWidth = Math.max(20, Math.min(60, width - 46))
    const left = etaMs(fraction, t - started)
    const pct = `${Math.floor(fraction * 100)}%`.padStart(4)
    const lines = []
    const weight = (id) => Math.max(1, checks.find((x) => x.id === id)?.estSeconds ?? 30)
    const sum = (status) => [...outcome].filter(([, o]) => o.status === status).reduce((n, [id]) => n + weight(id), 0)
    const total = checks.reduce((n, x) => n + Math.max(1, x.estSeconds ?? 30), 0)
    const bar = renderSplitBar({ pass: sum('PASS'), fail: sum('FAIL'), notRun: sum('NOT RUN'), running: Math.max(0, computeProgress({ checks, done, running, now: t }).have - [...outcome.keys()].reduce((n, id) => n + weight(id), 0)), total }, barWidth, c)
    lines.push(`${c('1', title)}  ${bar} ${c('1', pct)}  ${done.size}/${checks.length} checks`)
    lines.push(`  time spent ${formatDuration(t - started)}${left === null ? '' : `   about ${formatDuration(left)} left`}   ${c('32', `${counts.PASS} passed`)}  ${counts.FAIL ? c('31', `${counts.FAIL} failed`) : '0 failed'}  ${counts['NOT RUN'] ? c('33', `${counts['NOT RUN']} not run`) : '0 not run'}`)
    const failed = [...outcome].filter(([, o]) => o.status === 'FAIL' || o.status === 'NOT RUN').map(([id, o]) => `${id} ${o.status === 'FAIL' ? 'failed' : 'not run'} after ${formatShort(o.ms)}`)
    if (failed.length) lines.push(clip(c('31', `  ${failed.join('  ·  ')}`), width + 12))
    const now2 = [...running].map(([id, at]) => `${id} ${formatShort(t - at)}`)
    lines.push(clip(`  running now: ${now2.length ? now2.join('  ·  ') : 'nothing (waiting on a build or a lock)'}`, width))
    return lines
  }

  const clearBlock = () => {
    if (blockLines > 0) stream.write(`${ESC}${blockLines}A${ESC}0J`)
    blockLines = 0
  }
  const drawBlock = () => {
    const lines = statusBlock()
    stream.write(`${lines.join('\n')}\n`)
    blockLines = lines.length
  }
  const redraw = () => {
    if (!enabled) return
    clearBlock()
    drawBlock()
  }
  // Print a finished line above the live block.
  const print = (text) => {
    if (!enabled) {
      stream.write(`${text}\n`)
      return
    }
    clearBlock()
    stream.write(`${text}\n`)
    drawBlock()
  }

  if (enabled) {
    // Never leave the cursor hidden, even after Ctrl+C.
    process.once('exit', () => stream.write(`${ESC}?25h`))
    stream.write(`${ESC}?25l`)
    drawBlock()
    timer = setInterval(redraw, tickMs)
    timer.unref?.()
  }

  return {
    enabled,
    // Called when a check starts.
    start(check) {
      running.set(check.id, now())
      if (enabled) redraw()
    },
    // Called when a check ends, whatever the result.
    settle(check, result, ms) {
      running.delete(check.id)
      done.add(check.id)
      counts[result.status] = (counts[result.status] ?? 0) + 1
      outcome.set(check.id, { status: result.status, ms })
      const mark = result.status === 'PASS' ? c('32', '✔ PASS   ') : result.status === 'FAIL' ? c('31', '✖ FAIL   ') : c('33', '! NOT RUN')
      const detail = result.detail ? `  ${result.detail}` : ''
      print(clip(`  ${mark} ${check.id} (${formatShort(ms)})${detail}`, cols()))
    },
    // A plain line (a note) printed above the bar.
    note(text) {
      print(text)
    },
    stop() {
      if (timer) clearInterval(timer)
      if (enabled) {
        clearBlock()
        const lines = statusBlock()
        stream.write(`${lines.filter((l) => !l.includes('running now')).join('\n')}\n${ESC}?25h`)
      }
    },
  }
}
