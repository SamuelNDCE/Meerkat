// The "how long will this take" column of the home menu. Each Run row shows an estimate for THIS project: the same numbers
// `meerkat preset show` gives (learned times from earlier runs on this PC, the written guess for a check not yet measured), made
// short to read. Worked out lazily, once per (project, preset) for the menu session, within a fixed total time budget.

// 12 s -> "~10 s", 40 s -> "~40 s", 50 s -> "under 1 min", 70 s -> "about 1 min", 300 s -> "about 5 min", 2 hours -> "about 2 h".
export function estimateText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'est. n/a'
  const s = Math.round(seconds)
  if (s < 5) return `~${Math.max(1, s)} s`
  if (s < 45) return `~${Math.round(s / 5) * 5} s`
  if (s < 60) return 'under 1 min'
  if (s < 90) return 'about 1 min'
  const min = Math.round(s / 60)
  if (min < 60) return `about ${min} min`
  const h = Math.round(s / 1800) / 2
  return `about ${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

export const ESTIMATE_BUDGET_MS = 2000

// show(name) returns a promise of { ok, data: { estimateSeconds } } (presetShow). Results are kept in `cache` (a Map shared by the menu
// session, keyed project + preset). get(name) is the text now: the estimate, '...' while waiting, 'est. n/a' when it could not be had in time.
export function createEstimates({ project, names, show, now = Date.now, budgetMs = ESTIMATE_BUDGET_MS, cache = new Map(), timers = { setTimeout, clearTimeout }, onChange = () => {} }) {
  const key = (name) => `${project}\n${name}`
  const failed = new Set()
  let finished = false
  const api = {
    onChange,
    get(name) {
      const hit = cache.get(key(name))
      if (hit !== undefined) return estimateText(hit)
      return failed.has(name) || finished ? 'est. n/a' : '...'
    },
    get done() {
      return finished
    },
    async start() {
      const t0 = now()
      const todo = names.filter((n) => !cache.has(key(n)))
      for (const name of todo) {
        const left = budgetMs - (now() - t0)
        if (left <= 0) break
        let timer = null
        const timeout = new Promise((r) => {
          timer = timers.setTimeout(() => r(null), left)
        })
        let r = null
        try {
          r = await Promise.race([show(name), timeout])
        } catch {
          r = null
        } finally {
          timers.clearTimeout(timer)
        }
        if (r?.ok && Number.isFinite(r.data?.estimateSeconds)) cache.set(key(name), r.data.estimateSeconds)
        else failed.add(name)
        api.onChange('data')
      }
      finished = true
      api.onChange('data')
    },
  }
  return api
}
