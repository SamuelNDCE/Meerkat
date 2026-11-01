// The estimate of a whole run, worked out the same way for the preset menu, `preset show`, `--estimate`, the board and the end-of-run line,
// and the sentence that sets it beside the time the run really took ("estimated about 40 s, took 38 s").
// Pure apart from reading the thread count; the checks must already have had applyLearned (lib/timings.mjs).
import { cpus } from 'node:os'
import { estimateRemaining } from './eta.mjs'
import { formatShort } from './progress.mjs'
import { createModel } from './tui/model.mjs'
import { estimateText } from './menuestimate.mjs'

// A run's expected length in milliseconds: every check at its learned (else written, size-scaled) time, scheduled like the real run.
export function estimateRunMs(checks, timings, tier, { slots = Math.max(1, cpus().length - 1) } = {}) {
  try {
    const rows = createModel({ checks, timings, tier }).snapshot(0)
    return estimateRemaining(rows, 0, { freeSlots: slots })
  } catch {
    return checks.reduce((n, c) => n + (c.estSeconds ?? 0), 0) * 1000
  }
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
