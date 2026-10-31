// How long a check may run before it is stopped. A limit that is too tight turns a slow but healthy test run into a false failure,
// so the default is generous and grows with the project:
//   normal check             max(estSeconds x 4, 60)
//   compile / test / build   estSeconds x 6   (cargo clippy/test/build/doc, tsc, npm test, dotnet, mvn, gradle, go test ...)
// each multiplied by the project-size factor of the check's `scale` (never below 1). A timeoutSeconds written in the check replaces the formula.
// A person can change it: `--timeout-scale <n>` (1 to 10) on a run, "timeoutScale" and "timeouts": { "<check-id>": seconds } in
// .meerkat-budgets.json. A per-check number there is the exact limit (the scale is not applied to it).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scaleFactor } from './eta.mjs'

export const MAX_TIMEOUT_SCALE = 10
export const IDLE_EXTEND_MS = 30_000 // output within this long before the limit means the check is still working
export const HARD_CAP_FACTOR = 2 // ... but never run past twice the limit

const COMPILE_RE = /^(cargo\s+(clippy|test|build|doc|check|bench)|tsc|npm\s+(run\s+)?(test|build)|dotnet\s+(build|test)|mvn\s+(-\S+\s+)*(compile|test|package|verify|install)|gradlew?\s+(build|test|check)|go\s+(test|build|vet)|swift\s+(build|test)|pytest|rspec)\b/

// True for checks that compile or run a test suite, which take long and print progress as they go.
export function isCompileCheck(check) {
  const run = check?.run
  if (!run || typeof run !== 'object') return false
  const line = [run.cmd, ...(run.args ?? [])].join(' ').split(String.fromCharCode(92)).join('/')
  const base = String(run.cmd ?? '').split('/').pop()
  return COMPILE_RE.test(line) || COMPILE_RE.test([base, ...(run.args ?? [])].join(' '))
}

export function clampScale(n) {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.min(MAX_TIMEOUT_SCALE, v) : 1
}

// The limit in seconds. facts is { files, crates } from lib/eta.mjs projectFacts; budgets is { timeouts, timeoutScale }.
export function effectiveTimeoutSeconds(check, { facts = {}, scale = 1, budgets = {} } = {}) {
  const own = budgets.timeouts?.[check.id]
  if (Number.isFinite(own) && own > 0) return Math.round(own)
  const est = check.estSeconds ?? 30
  // A limit written in the check (timeoutSeconds) is deliberate and is kept as written, so a short one still works; only a check
  // without one gets the formula.
  const base = check.timeoutSeconds ?? (isFoundWindows(check) ? Math.max(est * 3, 300) : isCompileCheck(check) ? est * 6 : Math.max(est * 4, 60))
  const size = check.scale && facts?.[check.scale] !== undefined ? Math.max(1, scaleFactor(check.scale, facts[check.scale])) : 1
  const computed = base * size
  return Number((computed * clampScale(scale) * clampScale(budgets.timeoutScale)).toFixed(3))
}

// What a stopped check says, in the result line and in its log.
export const timeoutText = (ranSeconds, limitSeconds) => `timed out after ${Math.round(ranSeconds)} s (limit is ${Math.round(limitSeconds)} s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)`

// Discovered checks (id "found-...") on the windows lane get a shorter hard limit: est x 3, at least 300 s.
export const isFoundWindows = (check) => /^found-/.test(check?.id ?? '') && check?.lane === 'windows'

// Idle limit (stuck detection): seconds with no output after which a check is stopped. Order: .meerkat-budgets.json "idleKill",
// then the check's own idleKillSeconds, then the default: discovered found-* checks only (windows lane 180 s, others 300 s). 0 = never.
export const IDLE_DEFAULT_WINDOWS = 180
export const IDLE_DEFAULT_FOUND = 300
export function idleKillSecondsFor(check, budgets = {}) {
  const own = budgets?.idleKill?.[check?.id]
  if (Number.isFinite(own) && own > 0) return own
  if (Number.isFinite(check?.idleKillSeconds) && check.idleKillSeconds > 0) return check.idleKillSeconds
  if (/^found-/.test(check?.id ?? '')) return check.lane === 'windows' ? IDLE_DEFAULT_WINDOWS : IDLE_DEFAULT_FOUND
  return 0
}
// Milliseconds; 0 when --no-idle-kill is given.
export function idleKillMsFor(check, { budgets = {}, noIdleKill = false } = {}) {
  if (noIdleKill) return 0
  return Math.round(idleKillSecondsFor(check, budgets) * 1000)
}
export const idleKillText = (seconds) => `no output for ${Math.round(seconds)} s: probably stuck (killed; raise idleKillSeconds for it in .meerkat-budgets.json under "idleKill": {"<check>": seconds} or run with --no-idle-kill)`

// Whole-run deadline in minutes: --max-run-minutes, else "maxRunMinutes" in the budgets file, else 90.
export const DEFAULT_RUN_MINUTES = 90

export function loadBudgets(...dirs) {
  for (const dir of dirs) {
    try {
      const file = join(dir, '.meerkat-budgets.json')
      if (!existsSync(file)) continue
      const d = JSON.parse(readFileSync(file, 'utf8'))
      const timeouts = d && typeof d.timeouts === 'object' && d.timeouts ? Object.fromEntries(Object.entries(d.timeouts).filter(([, v]) => Number.isFinite(v) && v > 0)) : {}
      const idleKill = d && typeof d.idleKill === 'object' && d.idleKill ? Object.fromEntries(Object.entries(d.idleKill).filter(([, v]) => Number.isFinite(v) && v > 0)) : {}
      const maxRunMinutes = Number.isFinite(d?.maxRunMinutes) && d.maxRunMinutes > 0 ? d.maxRunMinutes : DEFAULT_RUN_MINUTES
      return { timeouts, idleKill, maxRunMinutes, timeoutScale: clampScale(d?.timeoutScale) }
    } catch {
      /* an unreadable file means the defaults */
    }
  }
  return { timeouts: {}, idleKill: {}, maxRunMinutes: DEFAULT_RUN_MINUTES, timeoutScale: 1 }
}
