// The meerkat. A small lookout that stands beside the header and shows how the run is going, the way the mascots of
// other terminal tools do. Pure: from the rows (and a tick counter, so it blinks) to a few lines of plain ASCII, so it
// survives any terminal, a screenshot and a screen reader that skips art. It never says anything the table does not
// already say in words; it is company, not information. Off with NV_VERIFY_MASCOT=0, and it steps aside on a narrow
// terminal.

const FRAMES = {
  watch: ['   ,^.   ', '  (o.o)  ', '  /(_)\\  ', '   | |   ', '  _d_b_  '],
  blink: ['   ,^.   ', '  (-.-)  ', '  /(_)\\  ', '   | |   ', '  _d_b_  '],
  cheer: [' \\ ,^. / ', '  (^.^)  ', '   (_)   ', '   | |   ', '  _d_b_  '],
  alarm: [' ! ,^. ! ', '  (O.O)  ', ' \\/(_)\\/ ', '   | |   ', '  _d_b_  '],
  wait: ['   ,^.  z', '  (-.-)  ', '  /(_)\\  ', '   | |   ', '  _d_b_  '],
}

export const MASCOT_WIDTH = 9
export const MIN_WIDTH_FOR_MASCOT = 72

// How the run feels right now. Anything that did not pass beats everything else; a finished clean run cheers.
export function moodOf(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length
  if (n('FAIL') + n('NOT RUN') > 0) return 'alarm'
  if (rows.length && n('PASS') === rows.length) return 'cheer'
  if (n('RUNNING') > 0) return 'watch'
  return 'wait'
}

const LINES = {
  watch: ['On lookout. Nothing sneaky so far.', 'Standing guard. No broken code gets past me.', 'Counting your tests, one by one.', 'Eyes open. Ears up.'],
  slow: ['That one is slower than usual. Giving it the stink eye.', 'Still going. I have seen snails sprint faster.'],
  wait: ['Waiting for my turn at the lock. Patiently. Mostly.', 'Queueing politely. Very British.', 'Nothing to guard just yet.'],
  cheer: ['All clear! Safe to push.', 'Every check passed. I did a little dance.', 'Nothing to report, which is the best report.'],
  alarm: ['Something is off! Look at the red lines.', 'I smell a bug. Press Enter on the red one.', 'Not green. Not quiet. Do not push yet.'],
}

// One line of chatter; changes slowly (every 8 ticks of about a second) so it can be read.
export function speechFor(rows, tick = 0) {
  const mood = moodOf(rows)
  const pool = mood === 'watch' && rows.some((r) => r.slow) ? LINES.slow : LINES[mood]
  return pool[Math.floor(tick / 8) % pool.length]
}

export function mascotLines(rows, tick = 0) {
  const mood = moodOf(rows)
  // A blink every few seconds while on watch.
  return FRAMES[mood === 'watch' && tick % 5 === 4 ? 'blink' : mood]
}

// The header (two lines) with the meerkat to its left and its remark under them. Falls back to the header alone
// on a narrow terminal or when switched off, so nothing else on screen moves.
export function withMascot(headerLines, rows, { tick = 0, width = 100, enabled = true } = {}) {
  if (!enabled || width < MIN_WIDTH_FOR_MASCOT) return headerLines
  const art = mascotLines(rows, tick)
  const gap = '  '
  const out = []
  for (let i = 0; i < art.length; i++) {
    const text = i < headerLines.length ? headerLines[i] : i === headerLines.length ? `  "${speechFor(rows, tick)}"` : ''
    out.push(`${art[i]}${gap}${text}`.replace(/\s+$/, ''))
  }
  return out
}

export const mascotEnabled = (env = process.env) => env.NV_VERIFY_MASCOT !== '0'
