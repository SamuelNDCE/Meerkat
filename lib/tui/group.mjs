// Grouping for the board and the end-of-run report. Pure: rows (or results) in, categories out, so it can be tested without a
// terminal. A run with many checks (the quick tier has about 180) would fill the screen with one line per check, so above
// GROUP_THRESHOLD checks the list folds into one line per CATEGORY: the check's kind (security, functionality, ui, performance,
// refactor), split by pack name when one kind alone holds more than SPLIT_OVER checks. A category that contains a FAIL, a NOT RUN
// or a RUNNING check is OPEN: those checks are listed under it one by one, so a problem is never folded away. Display only:
// nothing here changes a result or a saved file.
import { subCounts } from '../subchecks.mjs'
import { suiteLabel, suiteOf } from '../suites.mjs'

export const GROUP_THRESHOLD = 24
export const SPLIT_OVER = 40

export const GROUP_LABELS = { security: 'Security', functionality: 'Functionality', ui: 'UI', performance: 'Performance', refactor: 'Refactor' }
const KNOWN_ORDER = Object.keys(GROUP_LABELS)

// "pack quality" -> "quality"; a built-in check has no pack.
export const packOf = (source) => /^pack (.+)$/.exec(String(source ?? ''))?.[1] ?? null

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// "security-plus" -> "security plus": a pack name as a person would say it.
const readable = (pack) => String(pack).replace(/[-_]+/g, ' ')
export const labelOf = (group, pack = null) => {
  const base = GROUP_LABELS[group] ?? (group ? titleCase(String(group)) : 'Other')
  return pack ? `${base}: ${readable(pack)}` : base
}

const STATUSES = ['PASS', 'FAIL', 'NOT RUN', 'RUNNING', 'WAITING']
export const isProblem = (r) => r.status === 'FAIL' || r.status === 'NOT RUN'
const isOpenRow = (r) => isProblem(r) || r.status === 'RUNNING'
// Order inside an open category: failures, then checks that could not run, then running ones, each by name.
const ROW_RANK = { FAIL: 0, 'NOT RUN': 1, RUNNING: 2, WAITING: 3, PASS: 4 }

// The colour a category line gets: red if anything failed, yellow if anything could not run, blue while something runs, green when
// everything passed, grey while it only waits.
export function toneOf(counts, total) {
  if (counts.FAIL > 0) return 'FAIL'
  if (counts['NOT RUN'] > 0) return 'NOT RUN'
  if (counts.RUNNING > 0) return 'RUNNING'
  if (total > 0 && counts.PASS === total) return 'PASS'
  return 'WAITING'
}

// An item is anything with { id, status, group?, pack?/source? }. Time: a row has elapsedMs, a result has ms.
const defaultElapsed = (r) => (Number.isFinite(r.elapsedMs) ? r.elapsedMs : Number.isFinite(r.ms) ? r.ms : 0)

export function shouldGroup(count, { grouped, threshold = GROUP_THRESHOLD } = {}) {
  if (grouped === true) return true
  if (grouped === false) return false
  return count > threshold
}

// Which category a row belongs to. Kinds with more than `splitOver` checks are split by pack (a built-in check is "core").
function keyFn(items, splitOver) {
  const perGroup = new Map()
  for (const r of items) perGroup.set(r.group ?? '', (perGroup.get(r.group ?? '') ?? 0) + 1)
  const splitting = new Set()
  for (const [g, n] of perGroup) {
    if (n <= splitOver) continue
    const packs = new Set(items.filter((r) => (r.group ?? '') === g).map((r) => r.pack ?? packOf(r.source) ?? 'core'))
    if (packs.size > 1) splitting.add(g)
  }
  return (r) => {
    const g = r.group ?? ''
    return splitting.has(g) ? { group: g, pack: r.pack ?? packOf(r.source) ?? 'core' } : { group: g, pack: null }
  }
}

// Fold items into categories. Returns null when grouping is off for this many checks (the caller then shows every check).
// Order of categories: any with a failure, then any with a check that could not run, then running ones, then by name.
// A category's time is the wall-clock span from its first start to its last end when the items say when they ran (`span(item)` returns
// { begin, end } or null; rows carry begunAt/endedAt), so it can never exceed the run's elapsed time. Without that data it is the sum
// of the checks' own times, and `timeKind` says 'sum' so the screen can label it.
export const rowSpan = (now) => (r) => (r.begunAt === null || r.begunAt === undefined ? null : { begin: r.begunAt, end: r.status === 'RUNNING' ? now : (r.endedAt ?? r.begunAt) })
// Start and end times of each check from a run recorder (lib/runlog.mjs): Map id -> { begin, end }.
export function spansFromRecorder(recorder) {
  const m = new Map()
  for (const e of recorder?.events ?? []) {
    if (e.event === 'start') m.set(e.id, { begin: e.t, end: e.t })
    else if (e.event === 'end' && m.has(e.id)) m.get(e.id).end = e.t
  }
  return m
}
export function groupRows(items, { grouped, threshold = GROUP_THRESHOLD, splitOver = SPLIT_OVER, elapsed = defaultElapsed, span = null } = {}) {
  if (!shouldGroup(items.length, { grouped, threshold })) return null
  // When the items know their suite (lib/suites.mjs) the board folds by SUITE; with no suite data at all it folds by kind as before.
  const bySuite = items.some((r) => r.suite)
  const keyOf = bySuite ? (r) => ({ group: r.suite ?? 'other', pack: null }) : keyFn(items, splitOver)
  const map = new Map()
  for (const r of items) {
    const { group, pack } = keyOf(r)
    const key = `${group}\u0000${pack ?? ''}`
    if (!map.has(key)) map.set(key, { key, group, pack, suite: bySuite ? group : null, label: bySuite ? suiteLabel(group) : labelOf(group, pack), rows: [] })
    map.get(key).rows.push(r)
  }
  const cats = [...map.values()].map((cat) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    for (const r of cat.rows) counts[STATUSES.includes(r.status) ? r.status : 'WAITING']++
    const total = cat.rows.length
    const open = cat.rows.filter(isOpenRow).sort((a, b) => ROW_RANK[a.status] - ROW_RANK[b.status] || String(a.id).localeCompare(String(b.id)))
    const spans = span ? cat.rows.map(span).filter(Boolean) : []
    const wall = spans.length ? Math.max(...spans.map((x) => x.end)) - Math.min(...spans.map((x) => x.begin)) : null
    // Sub-checks: what a finished check reported, else what it declares (`subs` on the check), else 1 (the check itself).
    const subTotal = cat.rows.reduce((n, r) => n + (r.subTotal ?? r.declaredSubs ?? 1), 0)
    return { ...cat, total, subTotal, counts, ms: wall ?? cat.rows.reduce((n, r) => n + elapsed(r), 0), timeKind: wall === null ? 'sum' : 'span', tone: toneOf(counts, total), open }
  })
  const rank = (c) => (c.counts.FAIL > 0 ? 0 : c.counts['NOT RUN'] > 0 ? 1 : c.counts.RUNNING > 0 ? 2 : 3)
  const order = (c) => (!c.suite && KNOWN_ORDER.includes(c.group) ? KNOWN_ORDER.indexOf(c.group) : 99)
  return cats.sort((a, b) => rank(a) - rank(b) || order(a) - order(b) || a.label.localeCompare(b.label))
}

// "28 passed  1 failed  0 running  3 waiting" (a not-run count is added only when there is one).
export const countsText = (counts) =>
  [`${counts.PASS} passed`, `${counts.FAIL} failed`, ...(counts['NOT RUN'] ? [`${counts['NOT RUN']} not run`] : []), `${counts.RUNNING} running`, `${counts.WAITING} waiting`].join('  ')

// A bar of `width` cells split by outcome. Every status that is present gets at least one cell, so a lone failure is always visible.
export function segmentCells(counts, width) {
  const total = STATUSES.reduce((n, s) => n + counts[s], 0)
  if (!total || width <= 0) return STATUSES.map((s) => [s, 0])
  const present = STATUSES.filter((s) => counts[s] > 0)
  const cells = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  for (const s of present) cells[s] = Math.max(1, Math.round((counts[s] / total) * width))
  const sum = () => STATUSES.reduce((n, s) => n + cells[s], 0)
  while (sum() > width) {
    const big = [...present].sort((a, b) => cells[b] - cells[a])[0]
    if (cells[big] <= 1) break
    cells[big]--
  }
  while (sum() < width) cells[[...present].sort((a, b) => counts[b] - counts[a])[0]]++
  return STATUSES.map((s) => [s, cells[s]])
}

// Results (what a finished run returns) folded the same way. `checks` names each result's kind and pack; `spans` is spansFromRecorder().
export function groupResults(results, { checks = [], grouped, spans = null } = {}) {
  const byId = new Map(checks.map((c) => [c.id, c]))
  const items = results.filter(Boolean).map((r) => ({ id: r.id, status: r.status, ms: r.ms, group: byId.get(r.id)?.group ?? null, pack: packOf(byId.get(r.id)?.source), suite: suiteOf(byId.get(r.id)), subTotal: subCounts(r).total }))
  return groupRows(items, { grouped, span: spans ? (r) => spans.get(r.id) ?? null : null })
}
// "[ 1:02 ]" for a wall-clock span, "[ sum 1:02 ]" when only the sum of the checks' times is known.
export const timeText = (cat, fmt) => `${cat.timeKind === 'sum' ? 'sum ' : ''}${fmt(cat.ms)}`
