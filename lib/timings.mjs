// Measured check times, kept on this machine. The estSeconds written in a check file are a guess made once
// (vault-parser-proptest said 3 seconds and took 293), and they drive three things: the order checks start in, the
// weight of each check in the progress bar, and the "about N left" figure. After a run the real times are saved
// here, and the next run uses the middle value of the last few passes instead of the guess.
//
// Only a PASS is recorded: a failure or a check that was stopped early says nothing about how long the work takes.
// The file is a convenience, never a requirement: if it cannot be read or written the tool carries on with the
// written estimates.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const KEEP_SAMPLES = 5

export function timingsPath(env = process.env, home = homedir()) {
  return env.NV_VERIFY_TIMINGS || join(home, '.nv-verify-timings.json')
}

export function loadTimings(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && data.checks && typeof data.checks === 'object' ? data : { checks: {} }
  } catch {
    return { checks: {} }
  }
}

export function median(values) {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// The measured seconds for one check in one tier, or null when nothing has been recorded yet.
export function learnedSeconds(timings, id, tier) {
  const ms = median(timings.checks?.[id]?.[tier] ?? [])
  return ms === null ? null : Math.max(1, Math.round(ms / 1000))
}

// Replace each check's written estimate with the measured one. Returns how many were changed.
export function applyLearned(checks, timings, tier) {
  let changed = 0
  for (const c of checks) {
    const s = learnedSeconds(timings, c.id, tier)
    if (s !== null && s !== c.estSeconds) {
      c.writtenEstSeconds = c.estSeconds
      c.estSeconds = s
      changed++
    }
  }
  return changed
}

// Add this run's passes to the stored samples (newest last, at most KEEP_SAMPLES each).
export function recordRun(timings, results, tier) {
  const next = { checks: { ...(timings.checks ?? {}) } }
  for (const r of results) {
    if (!r || r.status !== 'PASS' || !(r.ms > 0)) continue
    const entry = { ...(next.checks[r.id] ?? {}) }
    entry[tier] = [...(entry[tier] ?? []), Math.round(r.ms)].slice(-KEEP_SAMPLES)
    next.checks[r.id] = entry
  }
  return next
}

export function saveTimings(file, timings) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(timings, null, 1))
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

function fileExists(file) {
  return existsSync(file)
}
