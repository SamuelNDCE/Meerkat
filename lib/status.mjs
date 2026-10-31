// Meerkat's progress in a form something other than a person at a terminal can follow. The live bar (progress.mjs)
// only draws in a real terminal; an AI session, a pipe or CI saw nothing between "[start]" and "[PASS]" lines,
// which for a 6 minute build looks the same as a hang. This module adds two things that work everywhere:
//   1. a status file, rewritten on every start and finish and every few seconds, holding the percentage, the time
//      spent, the estimate of the time left, what is running (with how long and how long it should take), what is
//      waiting and why, and every finished check;
//   2. in plain output, a heartbeat line every 30 seconds saying the same in one line.
// Nothing here changes a result or an exit code, and a status file that cannot be written is ignored.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { computeProgress, etaMs, formatDuration } from './progress.mjs'

export function statusPath(env = process.env, tmp = tmpdir()) {
  return (env.NV_VERIFY_STATUS || join(tmp, 'nv-verify-status.json')).split('\\').join('/')
}

export function createStatus({ title, tier, checks, file, write = writeStatusFile, say = null, now = Date.now, tickMs = 5000, heartbeatMs = 30000 }) {
  const started = now()
  const done = new Map()
  const running = new Map()
  let waiting = []
  let state = 'running'
  let summary = null
  let lastBeat = started
  let timer = null

  const snapshot = () => {
    const t = now()
    const { fraction } = computeProgress({ checks, done: new Set(done.keys()), running: new Map([...running].map(([id, r]) => [id, r.at])), now: t })
    const left = state === 'running' ? etaMs(fraction, t - started) : 0
    return {
      title,
      tier,
      state,
      startedAt: new Date(started).toISOString(),
      updatedAt: new Date(t).toISOString(),
      elapsedMs: t - started,
      percent: state === 'done' ? 100 : Math.floor(fraction * 100),
      etaMs: left === null ? null : Math.round(left),
      counts: {
        total: checks.length,
        finished: done.size,
        passed: [...done.values()].filter((d) => d.status === 'PASS').length,
        failed: [...done.values()].filter((d) => d.status === 'FAIL').length,
        notRun: [...done.values()].filter((d) => d.status === 'NOT RUN').length,
      },
      running: [...running].map(([id, r]) => ({ id, lane: r.lane, elapsedMs: t - r.at, expectedMs: r.expectedMs, overran: t - r.at > r.expectedMs * 1.5 })),
      waiting,
      finished: [...done].map(([id, d]) => ({ id, status: d.status, ms: d.ms, detail: d.detail })),
      summary,
    }
  }

  const flush = () => {
    try {
      write(file, snapshot())
    } catch {
      // a status file is a convenience; never let it stop a run
    }
  }

  // The one-line version of the snapshot, for logs that have no live bar.
  const line = () => {
    const s = snapshot()
    const parts = [`${s.percent}%`, `${formatDuration(s.elapsedMs)} spent`]
    if (s.etaMs !== null) parts.push(`about ${formatDuration(s.etaMs)} left`)
    parts.push(`${s.counts.finished}/${s.counts.total} done`)
    if (s.counts.failed) parts.push(`${s.counts.failed} failed`)
    const run = s.running.map((r) => `${r.id} ${formatDuration(r.elapsedMs)}/${formatDuration(r.expectedMs)}${r.overran ? ' (slower than usual)' : ''}`)
    parts.push(run.length ? `running: ${run.join(', ')}` : 'running: nothing (waiting on a lock or a build)')
    if (s.waiting.length) parts.push(`waiting: ${s.waiting.map((w) => `${w.id} (${w.reason})`).join(', ')}`)
    return `[working] ${parts.join(' · ')}`
  }

  const tick = () => {
    flush()
    if (say && now() - lastBeat >= heartbeatMs) {
      lastBeat = now()
      say(line())
    }
  }

  flush()
  if (tickMs > 0) {
    timer = setInterval(tick, tickMs)
    timer.unref?.()
  }

  return {
    line,
    snapshot,
    start(check) {
      running.set(check.id, { at: now(), lane: check.lane, expectedMs: Math.max(1, check.estSeconds ?? 30) * 1000 })
      waiting = waiting.filter((w) => w.id !== check.id)
      flush()
    },
    settle(check, result, ms) {
      running.delete(check.id)
      waiting = waiting.filter((w) => w.id !== check.id)
      done.set(check.id, { status: result.status, ms, detail: result.detail ?? '' })
      flush()
    },
    // Called by the scheduler with the checks that cannot start yet and the reason for each.
    queue(list) {
      waiting = list
    },
    stop(finalSummary) {
      if (timer) clearInterval(timer)
      state = 'done'
      summary = finalSummary ?? null
      flush()
    },
  }
}

export function writeStatusFile(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 1))
  renameSync(tmp, file)
}

// Send one event to several listeners (the live bar and the status file).
export function fanOut(...hooks) {
  const live = hooks.filter(Boolean)
  return new Proxy(
    {},
    {
      get: (_, name) => (...args) => {
        for (const h of live) h[name]?.(...args)
      },
    },
  )
}
