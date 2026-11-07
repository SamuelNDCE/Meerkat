// The estimate of a whole run, worked out the same way for the preset menu, `preset show`, `--estimate`, the board and the end-of-run line,
// and the sentence that sets it beside the time the run really took ("estimated about 40 s, took 38 s").
// Pure apart from reading the thread count; the checks must already have had applyLearned (lib/timings.mjs).
import { defaultParallel } from './priority.mjs'
import { cpus } from 'node:os'
import { estimateRemaining } from './eta.mjs'
import { formatShort } from './progress.mjs'
import { createModel } from './tui/model.mjs'
import { estimateText } from './menuestimate.mjs'

// A run's expected length in milliseconds: every check at its learned (else written, size-scaled) time, scheduled like the real run.
export function estimateRunMs(checks, timings, tier, { slots = defaultParallel(cpus().length) } = {}) {
  try {
    const rows = createModel({ checks, timings, tier }).snapshot(0)
    return estimateRemaining(rows, 0, { freeSlots: slots })
  } catch {
    return checks.reduce((n, c) => n + (c.estSeconds ?? 0), 0) * 1000
  }
}

// A check the result cache will serve costs nothing to run, but a run still reads the project and compares it with the cached copy first.
// Measured 2026-11-07 on the generated fake apps (quick preset, every check cached): 0.1 to 0.5 s in all. The estimate of such a run is that
// fixed cost plus the checks that will really run, not the learned times of checks the cache is going to skip.
export const CACHED_RUN_BASE_MS = 300
export function estimateRunMsWithCache(toRun, cachedCount, timings, tier, opts) {
  if (!cachedCount) return toRun.length ? estimateRunMs(toRun, timings, tier, opts) : null
  return CACHED_RUN_BASE_MS + (toRun.length ? estimateRunMs(toRun, timings, tier, opts) : 0)
}

// actual / estimate; null when either is missing or the estimate is zero.
export function accuracyRatio(estimatedMs, actualMs) {
  return Number.isFinite(estimatedMs) && estimatedMs > 0 && Number.isFinite(actualMs) ? actualMs / estimatedMs : null
}

// "estimated about 40 s, took 38.1s" (the same wording as the menu's estimate column, the same clock as the summary line).
export function estimateVsActualText(estimatedMs, actualMs) {
  if (!Number.isFinite(estimatedMs) || estimatedMs <= 0) return ''
  return `estimated ${estimateText(estimatedMs / 1000).replace(/^~/, 'about ')}, took ${formatShort(actualMs)}`
}
