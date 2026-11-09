// Findings a person has accepted, in two kinds:
//   dismissed  a finding you judge wrong or not worth fixing, with the reason you gave (`meerkat dismiss <id> --reason "..."`)
//   baseline   the findings a project had when you accepted them as they are (`meerkat baseline`), used by `meerkat run --ratchet`
// Both live in the home folder (~/.meerkat), never in the project. A check whose every finding is accepted passes, and the run says so.
// Dismissals also feed back into Meerkat: `meerkat dismissals --stats` counts them per rule across all projects, so a rule that is
// dismissed again and again is visible as a candidate for review (the false-positive signal the accuracy corpus cannot give).
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { projectSlug, writeAtomic } from './findingshistory.mjs'
import { readJsonStore } from './corrupt.mjs'
import { partitionByEvidence } from './evidence.mjs'

export const MAX_ITEMS = 5000
const DIRS = { dismissed: 'dismissals', baseline: 'baselines' }

export const acceptedHome = (kind, env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), DIRS[kind]) : join(home, '.meerkat', DIRS[kind]))
export const acceptedFile = (kind, env, projectPath, home = homedir()) => join(acceptedHome(kind, env, home), `${projectSlug(projectPath)}.json`).split('\\').join('/')

// A damaged file is moved aside (lib/corrupt.mjs) so the next save cannot silently replace it with an empty list.
function readJson(file) {
  const r = readJsonStore(file)
  return r.ok ? r.value : null
}

// A hand-edited or damaged file may hold entries that are not objects, or have no text id: those are dropped instead of crashing every command that reads the list.
const sane = (items) => items.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id !== '').map((x) => ({ ...x, title: typeof x.title === 'string' ? x.title : '', reason: typeof x.reason === 'string' ? x.reason : '', at: typeof x.at === 'string' ? x.at : '', ...(typeof x.expires === 'string' && x.expires ? { expires: x.expires } : {}), ...(x.evidence && typeof x.evidence === 'object' && !Array.isArray(x.evidence) ? { evidence: x.evidence } : {}) }))

export function readDismissals(env, projectPath, home) {
  const d = readJson(acceptedFile('dismissed', env, projectPath, home))
  return d && d.schemaVersion === 1 && Array.isArray(d.items) ? sane(d.items) : []
}

export function readBaseline(env, projectPath, home) {
  const d = readJson(acceptedFile('baseline', env, projectPath, home))
  return d && d.schemaVersion === 1 && Array.isArray(d.items) ? { ...d, items: sane(d.items) } : null
}

// ---- expiry and the repo-level dismissal file ----
// A dismissal may carry `expires` (YYYY-MM-DD). It still suppresses through the end of that day (UTC) and not after.
// Dismissals may also live in `.meerkat-dismissed.json` in the project root, so a teammate or CI sees them; the reader takes both files.
export const REPO_DISMISS_FILE = '.meerkat-dismissed.json'
export const repoDismissFile = (projectPath) => join(resolve(projectPath), REPO_DISMISS_FILE).split('\\').join('/')

// '30d' (days from now) or 'YYYY-MM-DD' -> 'YYYY-MM-DD'. Throws on anything else.
export function parseExpiry(value, now = new Date()) {
  const v = String(value ?? '').trim()
  const d = /^(\d{1,4})d$/i.exec(v)
  if (d) {
    const t = new Date(now.getTime() + Number(d[1]) * 86400000)
    return t.toISOString().slice(0, 10)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v) return v
  throw new Error('--expires needs a number of days like 30d, or a date like 2026-12-31')
}
export const isExpired = (item, now = new Date()) => Boolean(item.expires) && now.getTime() >= Date.parse(`${item.expires.slice(0, 10)}T00:00:00Z`) + 86400000

export function readRepoDismissals(projectPath) {
  const d = readJson(repoDismissFile(projectPath))
  return d && d.schemaVersion === 1 && Array.isArray(d.items) ? sane(d.items) : []
}

export function saveRepoDismissals(projectPath, items, io = {}) {
  return writeAtomic(repoDismissFile(projectPath), JSON.stringify(dismissalDoc(items), null, 2) + '\n', io)
}

// Both files together, each item tagged with where it came from and whether it has expired. Neither file wins: for one id, an active
// entry beats an expired one, otherwise the home entry is kept first.
export function allDismissals(env, projectPath, home, now = new Date()) {
  const tag = (items, source) => items.map((x) => ({ ...x, source, expired: isExpired(x, now) }))
  const byId = new Map()
  for (const x of [...tag(readDismissals(env, projectPath, home), 'home'), ...tag(readRepoDismissals(projectPath), 'repo')]) {
    const have = byId.get(x.id)
    if (!have || (have.expired && !x.expired)) byId.set(x.id, x)
  }
  return [...byId.values()]
}

// Adds (or replaces) one dismissal. Returns the new list. Throws when the reason is missing: a dismissal says why.
export function withDismissal(items, { id, rule, check, file, title, reason, expires, evidence, at = new Date().toISOString() }) {
  if (!id) throw new Error('a finding id is needed')
  if (!String(reason ?? '').trim()) throw new Error('a dismissal needs a reason: --reason "why this is not a problem"')
  const rest = items.filter((x) => x.id !== id)
  return [...rest, { id, rule: rule ?? null, check: check ?? null, file: file ?? null, title: String(title ?? '').slice(0, 300), reason: String(reason).trim().slice(0, 1000), at, ...(expires ? { expires } : {}), ...(evidence ? { evidence } : {}) }].slice(-MAX_ITEMS)
}

export function withoutDismissal(items, id) {
  return items.filter((x) => x.id !== id)
}

export function saveAccepted(kind, env, projectPath, doc, io = {}) {
  try {
    ;(io.mkdirSync ?? mkdirSync)(acceptedHome(kind, env), { recursive: true, mode: 0o700 })
  } catch {
    return false
  }
  return writeAtomic(acceptedFile(kind, env, projectPath), JSON.stringify(doc, null, 2), io)
}

export function dismissalDoc(items) {
  return { schemaVersion: 1, items }
}

// The baseline from a run's findings: every finding id the run had, so `--ratchet` later fails only on what is not in it.
export function baselineDoc(findings, { runId, at = new Date().toISOString() } = {}) {
  const items = (findings ?? []).map((f) => ({ id: f.id, check: f.check ?? null, rule: f.rule ?? null, file: f.file ?? null, severity: f.severity ?? null, title: String(f.title ?? f.message ?? '').slice(0, 300) }))
  return { schemaVersion: 1, at, runId: runId ?? null, count: items.length, items: items.slice(0, MAX_ITEMS) }
}

// Every id a run treats as accepted: dismissed ids (with their reason) and, only when ratchet is on, the baseline ids.
export function acceptedSets({ env, projectPath, ratchet = false, home }) {
  const all = allDismissals(env, projectPath, home)
  // A dismissal whose test or line evidence no longer holds is STALE (lib/evidence.mjs): it stops suppressing, so its finding comes back.
  const { live, stale: staleItems } = partitionByEvidence(all.filter((d) => !d.expired), projectPath)
  const dismissed = new Map(live.map((d) => [d.id, d.reason]))
  const stale = new Map(staleItems.filter((d) => !dismissed.has(d.id)).map((d) => [d.id, d.staleDetail]))
  const expired = new Map(all.filter((d) => d.expired && !dismissed.has(d.id)).map((d) => [d.id, d.expires]))
  const baseline = ratchet ? new Set((readBaseline(env, projectPath, home)?.items ?? []).map((b) => b.id)) : new Set()
  return { dismissed, expired, stale, baseline, ratchet }
}

// True when a finding is accepted only through its old id.
// Old ids (lib/findingid.mjs): a merged finding keeps the old id and line of EVERY occurrence in legacyOccurrences. An old dismissal or baseline entry
// covers the merged finding only when every occurrence is covered, so a new occurrence of the same text is never silently suppressed. When the list
// is shorter than the occurrence count (it is capped, or the finding was folded with another) coverage cannot be shown, so it is not covered.
const legacyOk = (sets, id) => sets.dismissed.has(id) || sets.baseline.has(id)
export function legacyCoverage(f, sets) {
  const occ = f.legacyOccurrences ?? []
  if (!occ.length) return { all: false, some: false, uncovered: [], matched: [] }
  const uncovered = occ.filter((o) => !legacyOk(sets, o.legacyId))
  const matched = [...new Set(occ.filter((o) => legacyOk(sets, o.legacyId)).map((o) => o.legacyId))]
  const complete = occ.length >= (f.occurrences ?? 1)
  return { all: complete && uncovered.length === 0, some: matched.length > 0, uncovered, matched }
}
export function acceptedByFinding(f, sets) {
  const direct = acceptedBy(f.id, sets)
  if (direct) return direct
  if (!legacyCoverage(f, sets).all) return null
  return (f.legacyOccurrences ?? []).some((o) => sets.dismissed.has(o.legacyId)) ? 'dismissed' : 'baseline'
}
export const legacyHit = (f, sets) => !acceptedBy(f.id, sets) && legacyCoverage(f, sets).all

// Which accepted kind a finding id falls under, or null.
// `legacyId` is the finding's id before ids followed the code (lib/findingid.mjs): an old dismissal or baseline entry still matches by it.
export function acceptedBy(id, sets, legacyId = null) {
  if (sets.dismissed.has(id) || (legacyId && sets.dismissed.has(legacyId))) return 'dismissed'
  if (sets.baseline.has(id) || (legacyId && sets.baseline.has(legacyId))) return 'baseline'
  return null
}

// All dismissals of every project on this machine, grouped by rule: count, how many projects, the latest reason. Most dismissed first.
export function dismissalStats(env, home) {
  const dir = acceptedHome('dismissed', env, home)
  let names = []
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'))
  } catch {
    return []
  }
  const byRule = new Map()
  for (const n of names) {
    const d = readJson(join(dir, n))
    if (!d || !Array.isArray(d.items)) continue
    for (const it of sane(d.items)) {
      const key = it.rule ?? it.check ?? 'unknown'
      const row = byRule.get(key) ?? { rule: key, count: 0, projects: 0, latest: null, reason: null }
      row.count++
      row.projects++
      if (!row.latest || String(it.at) > row.latest) {
        row.latest = String(it.at)
        row.reason = it.reason ?? null
      }
      byRule.set(key, row)
    }
  }
  return [...byRule.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
}

export const acceptedExists = (kind, env, projectPath) => existsSync(acceptedFile(kind, env, projectPath))

// Applies the accepted sets to one run, in place. `findings` is the list buildFindings made for this run (lib/findingsdoc.mjs), so a
// finding's id here is exactly the id in findings.json that `meerkat dismiss` and `meerkat baseline` were given: same sanitised message,
// same merging, same roll-up. (Recomputing ids from the raw sink once missed every finding that was read from a check's output.)
// A FAIL whose every finding is accepted becomes PASS, with the reason in its detail; those findings leave the sink, so findings.json
// lists only what is still open. Returns the accepted records (for accepted.json). A FAIL with some findings still open, or with
// none of its own in the list, stays FAIL.
export function applyAccepted(results, sink, sets, findings, hiddenChecks = []) {
  const out = []
  for (const r of results) {
    if (r?.status !== 'FAIL') continue
    // A finding that another check also reported was folded into one finding (alsoReportedBy / alsoDetectedBy): it counts for both checks,
    // so accepting it passes both, and the folded-away twin does not come back as a "new" finding of its own check.
    const mine = (findings ?? []).filter((f) => f.check === r.id || f.alsoDetectedBy?.includes(r.id) || f.alsoReportedBy?.some((o) => o.check === r.id))
    // Under --ratchet, a check whose only findings are the pedantic ones hidden by default has nothing the baseline could list, so it passes.
    // A dismissal that has expired no longer suppresses; say so on the check when its finding comes back.
    const lapsed = [...new Set(mine.filter((f) => sets.expired?.has(f.id)).map((f) => sets.expired.get(f.id)))]
    if (lapsed.length) r.detail = `${r.detail ?? ''}${r.detail ? ' ' : ''}(${lapsed.map((d) => `dismissal expired on ${d}`).join('; ')})`
    const staleNotes = [...new Set(mine.filter((f) => sets.stale?.has(f.id)).map((f) => sets.stale.get(f.id)))]
    if (staleNotes.length) r.detail = `${r.detail ?? ''}${r.detail ? ' ' : ''}(dismissal STALE: ${staleNotes.join('; ')})`
    if (!mine.length && !(sets.ratchet && hiddenChecks.includes(r.id))) continue
    if (!mine.every((f) => acceptedByFinding(f, sets))) {
      // Some findings are still open, so the check stays FAIL, but the accepted ones must not be listed as open: their ids go on the sink
      // entry and buildFindings leaves them out (dismissing one of two findings of a check used to change nothing you could see).
      const accepted = mine.filter((f) => acceptedByFinding(f, sets))
      // An old dismissal that covers only some occurrences of a merged finding leaves it open and names the ones it does not cover.
      for (const f of mine) {
        const c = acceptedByFinding(f, sets) ? null : legacyCoverage(f, sets)
        if (c?.some && c.uncovered.length) {
          f.uncoveredOccurrences = c.uncovered.map((o) => o.line)
          r.detail = `${r.detail ?? ''}${r.detail ? ' ' : ''}(an old dismissal covers only part of finding ${String(f.id).slice(0, 8)}: occurrence${c.uncovered.length === 1 ? '' : 's'} at line ${c.uncovered.map((o) => o.line).join(', ')} not covered)`
        }
      }
      const got = sink?.get(r.id)
      if (accepted.length && got) {
        got.acceptedIds = new Set([...(got.acceptedIds ?? []), ...accepted.map((f) => f.id)])
        for (const f of accepted) out.push({ id: f.id, check: r.id, rule: f.rule ?? null, file: f.file ?? null, by: acceptedByFinding(f, sets), reason: sets.dismissed.get(f.id) ?? sets.dismissed.get((f.legacyOccurrences ?? []).find((o) => sets.dismissed.has(o.legacyId))?.legacyId) ?? null, ...(legacyHit(f, sets) ? { matchedLegacyIds: legacyCoverage(f, sets).matched } : {}) })
      }
      continue
    }
    for (const f of mine) out.push({ id: f.id, check: r.id, rule: f.rule ?? null, file: f.file ?? null, by: acceptedByFinding(f, sets), reason: sets.dismissed.get(f.id) ?? sets.dismissed.get((f.legacyOccurrences ?? []).find((o) => sets.dismissed.has(o.legacyId))?.legacyId) ?? null, ...(legacyHit(f, sets) ? { matchedLegacyIds: legacyCoverage(f, sets).matched } : {}) })
    r.status = 'PASS'
    r.detail = `${mine.length} finding(s) accepted: ${[...new Set(mine.map((f) => acceptedByFinding(f, sets)))].join(' and ')}. Open findings: none in this check.`
    r.accepted = mine.length
    const got = sink?.get(r.id)
    if (got) got.findings = []
  }
  return out
}

// A check whose every finding was dropped by an inline `meerkat-ignore` comment passes: `doc` is the result of buildFindings, which lists
// the checks that had findings ignored (inlineIgnoredChecks) and the findings that remain. Used by run and gate.
export function passInlineIgnored(results, doc, sink = null) {
  const ignored = new Set(doc?.inlineIgnoredChecks ?? [])
  if (!ignored.size) return 0
  let n = 0
  for (const r of results) {
    if (r?.status !== 'FAIL' || !ignored.has(r.id)) continue
    if ((doc.findings ?? []).some((f) => f.check === r.id || f.alsoDetectedBy?.includes(r.id) || f.alsoReportedBy?.some((o) => o.check === r.id))) continue
    r.status = 'PASS'
    r.detail = 'every finding is ignored by an inline meerkat-ignore comment. Open findings: none in this check.'
    delete r.broken
    const got = sink?.get(r.id)
    if (got) got.findings = []
    n++
  }
  return n
}
