// Cross-tool confirmation. Two checks that find the same problem are one finding, shown once, with the names of the checks that agree.
//   dependency advisories: the same package (and version when both say it) and a shared advisory id (GHSA, CVE, RUSTSEC, GO, PYSEC)
//   secrets: the same file, lines at most 2 apart
//   code issues: the same file, lines at most 3 apart, and the same class from lib/confirm-classes.mjs
// A rule id with no class never merges with another tool. The same check repeating one identity folds into one finding (`occurrences`).
// Runs after dedupe() and before the rollup (lib/findingsdoc.mjs). A finding seen by one check alone is returned untouched.
import { SEVERITY_RANK } from './findings.mjs'
import { ADVISORY_RE, classOf, lineWindow, SPECIFIC_CHECKS } from './confirm-classes.mjs'

const rank = (f) => SEVERITY_RANK[f.severity] ?? 0

export function advisoryIds(f) {
  return new Set([...`${f.rule ?? ''} ${f.message ?? ''}`.matchAll(ADVISORY_RE)].map((m) => m[0].toUpperCase()))
}
// `name@1.2.3` or `name 1.2.3` read from the message, when there is one.
export function packageOf(f) {
  const m = /([@a-z0-9][\w./@-]*)@(\d[\w.+-]*)/i.exec(String(f.message ?? ''))
  return m ? { name: m[1].toLowerCase(), version: m[2] } : null
}

function samePlace(a, b, window) {
  // A finding with no line says only "somewhere in this file": two such findings may be two different problems, so they are never taken as the same place.
  return a.file && a.file === b.file && (a.line ?? 0) > 0 && (b.line ?? 0) > 0 && Math.abs(a.line - b.line) <= window
}

// Do two findings describe one problem? (Whether they come from one check or two is decided by the caller.)
export function sameProblem(a, b) {
  // One check repeating itself is the same problem only under the same rule; two rules of one check are two findings by design.
  if (a.check === b.check && a.rule !== b.rule) return false
  const ia = advisoryIds(a)
  const ib = advisoryIds(b)
  if (ia.size && ib.size) {
    if (![...ia].some((x) => ib.has(x))) return false
    const pa = packageOf(a)
    const pb = packageOf(b)
    if (pa && pb && pa.name !== pb.name) return false
    return true
  }
  const ca = classOf(a)
  if (!ca || ca !== classOf(b)) return false
  return samePlace(a, b, lineWindow(ca))
}

// merged: the Map of findings by id that buildFindings holds. Returns { merged: number of duplicates folded away }.
export function confirmFindings(merged) {
  const items = [...merged.values()]
  // A finding joins a group only when it describes the same problem as EVERY member. Chaining through a third finding would otherwise fold two
  // different rules of one check into a group (A and C both match B but not each other) and one of them would lose its identity.
  const list = []
  for (const f of items) {
    const group = list.find((g) => g.every((m) => sameProblem(f, m)))
    if (group) group.push(f)
    else list.push([f])
  }
  const groups = new Map(list.map((g, i) => [i, g]))
  let folded = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // the clearest member: highest severity, then the most specific tool, then the longest message
    const keep = [...group].sort((a, b) => rank(b) - rank(a) || Number(SPECIFIC_CHECKS.has(b.check)) - Number(SPECIFIC_CHECKS.has(a.check)) || String(b.message).length - String(a.message).length)[0]
    const others = group.filter((f) => f !== keep)
    const checks = [...new Set(group.map((f) => f.check))].sort()
    keep.severity = group.reduce((m, f) => (rank(f) > (SEVERITY_RANK[m] ?? 0) ? f.severity : m), keep.severity)
    keep.occurrences = group.reduce((n, f) => n + (f.occurrences ?? 1), 0)
    const lines = new Set(keep.lines ?? [])
    for (const o of others) for (const l of o.lines ?? (o.line ? [o.line] : [])) if (lines.size < 20) lines.add(l)
    if (lines.size) keep.lines = [...lines]
    if (checks.length >= 2) {
      keep.confirmedBy = checks
      keep.confirmations = checks.length
      keep.confidence = 'high'
      keep.alsoReportedBy = others.filter((o) => o.check !== keep.check).map((o) => ({ check: o.check, rule: o.rule ?? null }))
    }
    for (const o of others) {
      merged.delete(o.id)
      folded++
    }
  }
  return { merged: folded }
}
