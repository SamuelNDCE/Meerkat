// Meerkat is a background job: it must never make a PC feel slow or keep antivirus busy while the person works. So it lowers its own scheduling priority at
// start (below normal), and every check it starts inherits that (Windows and Unix both pass a lowered priority on to child processes). Set MEERKAT_PRIORITY=normal
// (or --priority normal) to run at normal priority, for example on a build server where nothing else is happening.
import { constants, setPriority } from 'node:os'

// Returns what it did, as text for the log, or null when it left the priority alone.
export function lowerPriority(env = process.env, set = setPriority) {
  const want = String(env.MEERKAT_PRIORITY ?? 'low').toLowerCase()
  if (want === 'normal') return null
  const level = want === 'idle' ? constants.priority.PRIORITY_LOW : constants.priority.PRIORITY_BELOW_NORMAL
  try {
    set(0, level)
    return `priority ${want === 'idle' ? 'idle' : 'below normal'} (your PC stays responsive; MEERKAT_PRIORITY=normal runs at normal priority)`
  } catch {
    return null // not allowed here (a locked-down container): run as before
  }
}

// How many checks may run at once by default: half the cores (at least 2, at most 8) for a person's PC, all but one on a CI runner or when asked (MEERKAT_PARALLEL).
export function defaultParallel(cores, env = process.env) {
  const asked = Number(env.MEERKAT_PARALLEL)
  if (Number.isInteger(asked) && asked >= 1) return Math.min(asked, 64)
  if (env.CI || env.MEERKAT_PRIORITY === 'normal') return Math.max(1, cores - 1)
  return Math.max(2, Math.min(8, Math.floor(cores / 2)))
}
