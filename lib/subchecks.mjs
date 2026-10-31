// The sub-check protocol: how one check reports many rules. Pure functions, no I/O. docs/suites.md explains it for check authors.
//
// A check script prints to STDOUT, one per line, exactly:
//   MEERKAT-SUB <PASS|FAIL|NA> <rule-id> <short reason>
// rule-id matches /^[a-z0-9][a-z0-9-]{0,60}$/; the reason is optional, at most 200 characters, with control characters removed.
// The runner (lib/exec.mjs) takes these lines out of the output the same way it takes the MEERKAT-FILE lines (lib/progress-files.mjs):
// they never reach `lastLine`, `onLine` or the saved output. They are kept apart and written into the check's log under
// `--- sub-checks ---`. Everything a child prints is untrusted: a line that merely starts with MEERKAT-SUB but is not valid is dropped.
//
// Counting: a check that prints no sub lines counts as ONE sub-check (itself), so every total adds up. NA never counts as a failure.
import { suiteIdOf, suiteInfo } from './suites.mjs'

export const MAX_SUBS = 2000
export const MAX_REASON = 200
export const SUB_PREFIX_RE = /^MEERKAT-SUB/
export const SUB_ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
export const SUB_STATUSES = ['PASS', 'FAIL', 'NA']
const LINE_RE = /^MEERKAT-SUB (PASS|FAIL|NA) ([a-z0-9][a-z0-9-]{0,60})(?: (.*))?$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g

// Any line that starts like the protocol is taken out of the output, valid or not.
export const isSubLine = (line) => SUB_PREFIX_RE.test(String(line ?? '').replace(/\r$/, ''))

export const cleanReason = (text) => String(text ?? '').replace(/\t/g, ' ').replace(CONTROL_RE, '').trim().slice(0, MAX_REASON)

// One output line -> { status, id, reason } | null.
export function parseSubLine(line) {
  const text = String(line ?? '').replace(/\r$/, '')
  const m = LINE_RE.exec(text)
  if (!m) return null
  return { status: m[1], id: m[2], reason: cleanReason(m[3]) }
}

// A collector the runner feeds one raw line at a time: keeps the first line of each rule id, at most MAX_SUBS.
export function createSubCollector(cap = MAX_SUBS) {
  const subs = []
  const seen = new Set()
  let dropped = 0
  return {
    subs,
    get dropped() {
      return dropped
    },
    add(line) {
      const p = parseSubLine(line)
      if (!p || seen.has(p.id) || subs.length >= cap) {
        dropped++
        return false
      }
      seen.add(p.id)
      subs.push(p)
      return true
    },
  }
}

// A list from a function check (it returns `subs`), cleaned the same way as lines from a script.
export function normaliseSubs(list, cap = MAX_SUBS) {
  const c = createSubCollector(cap)
  if (!Array.isArray(list)) return c.subs
  for (const x of list) {
    const status = String(x?.status ?? '').toUpperCase()
    if (SUB_STATUSES.includes(status) && SUB_ID_RE.test(String(x?.id ?? ''))) c.add(`MEERKAT-SUB ${status} ${x.id} ${cleanReason(x.reason)}`.trimEnd())
  }
  return c.subs
}

export const countOf = (subs) => ({ total: subs.length, pass: subs.filter((x) => x.status === 'PASS').length, fail: subs.filter((x) => x.status === 'FAIL').length, na: subs.filter((x) => x.status === 'NA').length })

// Sub-check counts of one result. No sub lines: one sub-check, the check itself (PASS passes, FAIL fails, NOT RUN is not applicable).
export function subCounts(result) {
  const subs = result?.subs
  if (Array.isArray(subs) && subs.length) return countOf(subs)
  const st = result?.status
  return { total: 1, pass: st === 'PASS' ? 1 : 0, fail: st === 'FAIL' ? 1 : 0, na: st === 'PASS' || st === 'FAIL' ? 0 : 1 }
}
export const hasSubs = (result) => Array.isArray(result?.subs) && result.subs.length > 0

export function rollup(results) {
  const t = { total: 0, pass: 0, fail: 0, na: 0, withSubs: 0 }
  for (const r of results.filter(Boolean)) {
    const c = subCounts(r)
    t.total += c.total
    t.pass += c.pass
    t.fail += c.fail
    t.na += c.na
    if (hasSubs(r)) t.withSubs++
  }
  return t
}
// The sub-check part of the SUMMARY line, or '' when no check reported any (so older output reads as before).
export function subSummaryText(results) {
  const t = rollup(results)
  if (!t.withSubs) return ''
  return `${t.total} sub-checks: ${t.pass} passed, ${t.fail} failed, ${t.na} not applicable here`
}

// What the exit code and the sub lines decide together. `disabled` is a Set of sub ids the config turned off.
//   exit 0 and a FAIL sub line      the script lied: the check FAILS ("sub-check <id> failed")
//   exit 1 and no FAIL sub line     nothing changes (the exit code decides)
//   exit 1 and every FAIL sub line is disabled in the config     the check passes (the rules that failed were turned off)
// Returns { subs (kept), status ('PASS'|'FAIL'|null: null means leave the exit code's verdict), detail }.
export function judge({ subs, code, disabled = new Set() }) {
  const kept = subs.filter((x) => !disabled.has(x.id))
  const failing = kept.filter((x) => x.status === 'FAIL')
  const turnedOff = subs.filter((x) => x.status === 'FAIL' && disabled.has(x.id))
  if (code === 0 && failing.length) return { subs: kept, status: 'FAIL', detail: `sub-check ${failing[0].id} failed` }
  if (code === 1 && !failing.length && turnedOff.length) return { subs: kept, status: 'PASS', detail: `failing rules turned off in the config: ${turnedOff.map((x) => x.id).join(', ')}` }
  if (code !== 0 && failing.length) {
    const more = failing.length > 1 ? ` (and ${failing.length - 1} more)` : ''
    return { subs: kept, status: null, detail: `sub-check ${failing[0].id} failed${failing[0].reason ? `: ${failing[0].reason}` : ''}${more}` }
  }
  return { subs: kept, status: null, detail: null }
}

// A result with the sub list and counts on it (only when there are sub lines).
export function withSubs(result, subs) {
  if (!subs.length) return result
  const c = countOf(subs)
  return { ...result, subs, subTotal: c.total, subPass: c.pass, subFail: c.fail, subNa: c.na }
}

// `suite/check/sub` selection: keep only the asked-for sub-checks in each result (a missing one is reported as NA, never invented as a pass).
export function narrowSubs(results, subOnly) {
  if (!subOnly || !subOnly.size) return results
  return results.map((r) => {
    const want = subOnly.get(r?.id)
    if (!r || !want) return r
    const have = new Map((r.subs ?? []).map((x) => [x.id, x]))
    const subs = [...want].map((id) => have.get(id) ?? { id, status: 'NA', reason: 'this check did not report this sub-check' })
    return withSubs(r, subs)
  })
}

// Results with the fields the saved files carry: suite, sub-check list and counts (a check with no sub lines is one sub-check).
export function enrichResults(results, checks = []) {
  const byId = new Map(checks.map((c) => [c.id, c]))
  return results.filter(Boolean).map((r) => {
    const c = subCounts(r)
    return { ...r, suite: suiteIdOf(byId.get(r.id) ?? { id: r.id }), origin: byId.get(r.id)?.origin ?? 'bundled', subs: r.subs ?? [], subTotal: c.total, subPass: c.pass, subFail: c.fail, subNa: c.na }
  })
}

// Per suite: how many checks and sub-checks, the outcome counts, and every failing sub-check. `results` should be enriched.
export function suiteRollup(results) {
  const by = new Map()
  for (const r of results.filter(Boolean)) {
    const id = r.suite ?? 'other'
    if (!by.has(id)) by.set(id, { id, label: suiteInfo(id)?.label ?? id, checks: 0, subTotal: 0, subPass: 0, subFail: 0, subNa: 0, checkFail: 0, notRun: 0, ms: 0, failedSubs: [] })
    const e = by.get(id)
    const c = subCounts(r)
    e.checks++
    e.subTotal += c.total
    e.subPass += c.pass
    e.subFail += c.fail
    e.subNa += c.na
    e.ms += r.ms ?? 0
    if (r.status === 'FAIL') e.checkFail++
    if (r.status === 'NOT RUN') e.notRun++
    for (const x of r.subs ?? []) if (x.status === 'FAIL') e.failedSubs.push({ check: r.id, id: x.id, reason: x.reason })
  }
  return [...by.values()].sort((a, b) => b.checkFail - a.checkFail || a.label.localeCompare(b.label))
}

// The `--- sub-checks ---` block of a check's log.
export const SUB_BLOCK_MARK = '--- sub-checks ---'
export function subBlockText(subs) {
  if (!subs?.length) return ''
  const c = countOf(subs)
  return [SUB_BLOCK_MARK, `${c.total} sub-checks: ${c.pass} passed, ${c.fail} failed, ${c.na} not applicable`, ...subs.map((x) => `${x.status.padEnd(4)} ${x.id}${x.reason ? `  ${x.reason}` : ''}`)].join('\n')
}
