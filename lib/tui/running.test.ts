// The running board: every running check is listed on its lane (also a lane the board does not know, and the window lane under either of
// its names), the status line under the bar, the stuck hint, the skip keys through a fake control, a clean close on interrupt, and the
// bug counter's rules (it only grows, and only failed checks add to it).
import { describe, expect, test } from 'vitest'
import { stripAnsi } from './cells.mjs'
import { createModel } from './model.mjs'
import { remainingStatus, renderLive, stuckHint } from './live.mjs'
import { createTui } from './index.mjs'

const checks = [
  { id: 'a', title: 'A', lane: 'free', estSeconds: 10, source: 'built in', group: 'quality' },
  { id: 'found-tests-no-data-loss', title: 'No data loss', lane: 'windows', estSeconds: 150, source: 'found', group: 'functionality' },
  { id: 'gpu-check', title: 'GPU', lane: 'gpu', estSeconds: 30, source: 'built in', group: 'performance' },
]
const plain = (lines: string[]) => lines.map(stripAnsi).join('\n')
const board = (rows: unknown[], now: number, extra: Record<string, unknown> = {}) =>
  plain(renderLive({ rows: rows as never, events: [], started: 0, now, tick: 0, fraction: 0.4, etaMs: null, width: 120, color: false, height: 60, ...extra }))

describe('every running check is listed, on any lane', () => {
  test('a running check on the windows lane is listed with its name, elapsed time and estimate, and the lane does not say idle', () => {
    const m = createModel({ checks: checks as never })
    m.start(checks[1] as never, 0)
    const text = board(m.snapshot(80_000), 80_000)
    expect(text).toContain('found-tests-no-data-loss')
    expect(text).toContain('1:20/2:30')
    expect(text).not.toMatch(/windows\s+idle/)
  })
  test('the window lane under its runner name (electron) prints as windows and lists the check too', () => {
    const m = createModel({ checks: [{ id: 'w', lane: 'electron', estSeconds: 150 }] as never })
    m.start({ id: 'w', lane: 'electron', estSeconds: 150 } as never, 0)
    const text = board(m.snapshot(10_000), 10_000)
    expect(text).toMatch(/windows\s+\S+\s+w\s/)
    expect(text).not.toMatch(/windows\s+idle/)
  })
  test('a lane the board does not know yet gets its own line with the running check', () => {
    const m = createModel({ checks: checks as never })
    m.start(checks[2] as never, 0)
    const text = board(m.snapshot(5_000), 5_000)
    expect(text).toMatch(/gpu\s+\S+\s+gpu-check/)
    expect(text).not.toMatch(/gpu\s+idle/)
  })
  test('a check whose start arrives before the board knew it is added, not dropped', () => {
    const m = createModel({ checks: [] })
    m.start({ id: 'found-late', lane: 'windows', estSeconds: 150 } as never, 0)
    expect(m.rows.has('found-late')).toBe(true)
    expect(m.snapshot(1000)[0]).toMatchObject({ status: 'RUNNING', lane: 'windows' })
  })
})

describe('the status line and the time left', () => {
  test('when few checks remain it names the running one, with its lane and time', () => {
    const m = createModel({ checks: checks as never })
    m.settle(checks[0] as never, { status: 'PASS' }, 1000)
    m.start(checks[1] as never, 0)
    const line = remainingStatus(m.snapshot(90_000) as never, 90_000)
    expect(line).toContain('waiting on 1 long check: found-tests-no-data-loss (windows lane) 1:30 of about 2:30')
  })
  test('more than three checks left: no status line', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, lane: 'free', estSeconds: 5 }))
    const m = createModel({ checks: many as never })
    m.start(many[0] as never, 0)
    expect(remainingStatus(m.snapshot(1000) as never, 1000)).toBe('')
  })
  test('a named running check with no timing: time left is unknown, and the label says still running when past its estimate', () => {
    const m = createModel({ checks: checks as never })
    m.start(checks[1] as never, 0)
    const text = board(m.snapshot(200_000), 200_000)
    expect(text).toContain('time left: unknown (no timing recorded for found-tests-no-data-loss yet)')
    expect(text).toContain('still running, longer than estimated')
  })
})

describe('the stuck hint', () => {
  test('after a minute with no output it says so, with the keys', () => {
    expect(stuckHint({ startedAt: 0, lastOutputAt: 0 } as never, 59_000)).toBeNull()
    expect(stuckHint({ startedAt: 0, lastOutputAt: 0 } as never, 70_000)).toBe('possibly stuck: no output for 1:10  (s skip it, k kill)')
  })
  test('a printed line restarts the count', () => {
    const m = createModel({ checks: checks as never })
    m.start(checks[1] as never, 0)
    m.touch(checks[1] as never, 65_000)
    const row = m.snapshot(70_000)[1]
    expect(stuckHint(row as never, 70_000)).toBeNull()
  })
})

describe('the board with a fake control object', () => {
  const clockOf = () => {
    let t = 0
    return { now: () => t, set: (v: number) => (t = v) }
  }
  const streamOf = () => {
    const writes: string[] = []
    return { writes, columns: 120, rows: 60, write: (s: string) => writes.push(s) }
  }
  test('the stuck hint shows for a check the control reports as silent, and the skip keys call the control', () => {
    const clock = clockOf()
    const skips: string[] = []
    let skipAllCalls = 0
    const control = { runningIds: () => [{ id: 'found-tests-no-data-loss', lastOutputAt: 0 }], skip: (id: string) => skips.push(id), skipAll: () => (skipAllCalls += 1) }
    const tui = createTui({ title: 'T', checks: checks as never, stream: streamOf() as never, input: { isTTY: false } as never, now: clock.now, color: false, tickMs: 100_000, env: {}, control: control as never, showFinal: false })
    tui.start(checks[1] as never)
    clock.set(70_000)
    expect(plain(tui.frame())).toContain('possibly stuck: no output for 1:10  (s skip it, k kill)')
    expect(plain(tui.frame())).toContain('s skip a stuck check  g groups  Ctrl-C stop and save')
    tui.key('s')
    expect(skips).toEqual(['found-tests-no-data-loss'])
    tui.key('k')
    expect(skips).toEqual(['found-tests-no-data-loss', 'found-tests-no-data-loss'])
    tui.key('S')
    expect(skipAllCalls).toBe(1)
    tui.settle(checks[1] as never, { status: 'NOT RUN', detail: 'the runner says something else' }, 70_000)
    expect(plain(tui.frame())).toContain('skipped by you')
    tui.stop()
  })
  test('without a control object the skip keys say so and nothing crashes', () => {
    const clock = clockOf()
    const tui = createTui({ title: 'T', checks: checks as never, stream: streamOf() as never, input: { isTTY: false } as never, now: clock.now, color: false, tickMs: 100_000, env: {}, showFinal: false })
    tui.start(checks[1] as never)
    tui.key('s')
    expect(plain(tui.frame())).toContain('skip is not available')
    tui.stop()
  })
  test('an interrupted run closes cleanly: the cursor comes back, the alternate screen is left, and nothing is drawn after', () => {
    const clock = clockOf()
    const out = streamOf()
    const tui = createTui({ title: 'T', checks: checks as never, stream: out as never, input: { isTTY: false } as never, now: clock.now, color: false, tickMs: 100_000, env: {}, showFinal: false })
    tui.start(checks[1] as never)
    tui.interrupt()
    const last = out.writes[out.writes.length - 1]
    expect(last).toContain('\x1b[?25h')
    expect(last).toContain('\x1b[?1049l')
    const count = out.writes.length
    tui.key('s')
    tui.settle(checks[1] as never, { status: 'PASS' }, 1000)
    tui.stop()
    expect(out.writes.length).toBe(count)
  })
})

describe('the bug counter only grows, and only failed checks add to it', () => {
  test('a passing check never changes it, even when it carries findings; a failed check with none counts as one medium', () => {
    const m = createModel({ checks: checks as never })
    m.settle(checks[0] as never, { status: 'PASS' }, 1, [{ severity: 'high' }])
    expect(m.bugs().total).toBe(0)
    m.settle(checks[1] as never, { status: 'FAIL' }, 1, [])
    expect(m.bugs()).toMatchObject({ medium: 1, total: 1 })
  })
  test('settling a check again never lowers the count', () => {
    const m = createModel({ checks: checks as never })
    m.settle(checks[1] as never, { status: 'FAIL' }, 1, [{ severity: 'critical' }, { severity: 'high' }, { severity: 'low' }])
    m.settle(checks[1] as never, { status: 'FAIL' }, 1, [])
    expect(m.bugs().total).toBe(3)
  })
})

describe('the board title and the update notice', () => {
  test('the title names the version, and a remembered newer version shows a yellow notice after it (faked here)', async () => {
    const { VERSION } = await import('../version.mjs')
    const m = createModel({ checks: checks as never })
    m.start(checks[1] as never, 0)
    const rows = m.snapshot(1000)
    const without = plain(renderLive({ rows: rows as never, events: [], started: 0, now: 1000, width: 120, color: false, height: 60 }))
    expect(without).toContain(`MEERKAT v${VERSION} . full`)
    expect(without).not.toContain('update available')
    const withNotice = renderLive({ rows: rows as never, events: [], started: 0, now: 1000, width: 120, color: true, height: 60, notice: { latest: '99.0.0', current: VERSION } })
    const titleLine = plain(withNotice).split('\n')[0]
    expect(titleLine).toContain(`MEERKAT v${VERSION} . full   update available: v99.0.0 (you have v${VERSION})`)
    expect(withNotice.join('\n')).toContain('\x1b[33mupdate available')
  })
})
