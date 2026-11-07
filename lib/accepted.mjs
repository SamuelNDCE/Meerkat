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

export const MAX_ITEMS = 5000
const DIRS = { dismissed: 'dismissals', baseline: 'baselines' }

export const acceptedHome = (kind, env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), DIRS[kind]) : join(home, '.meerkat', DIRS[kind]))
export const acceptedFile = (kind, env, projectPath, home = homedir()) => join(acceptedHome(kind, env, home), `${projectSlug(projectPath)}.json`).split('\\').join('/')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function readDismissals(env, projectPath, home) {
  const d = readJson(acceptedFile('dismissed', env, projectPath, home))
  return d && d.schemaVersion === 1 && Array.isArray(d.items) ? d.items : []
}

export function readBaseline(env, projectPath, home) {
  const d = readJson(acceptedFile('baseline', env, projectPath, home))
  return d && d.schemaVersion === 1 && Array.isArray(d.items) ? d : null
}

// Adds (or replaces) one dismissal. Returns the new list. Throws when the reason is missing: a dismissal says why.
export function withDismissal(items, { id, rule, check, file, title, reason, at = new Date().toISOString() }) {
  if (!id) throw new Error('a finding id is needed')
  if (!String(reason ?? '').trim()) throw new Error('a dismissal needs a reason: --reason "why this is not a problem"')
  const rest = items.filter((x) => x.id !== id)
  return [...rest, { id, rule: rule ?? null, check: check ?? null, file: file ?? null, title: String(title ?? '').slice(0, 300), reason: String(reason).trim().slice(0, 1000), at }].slice(-MAX_ITEMS)
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
  const dismissed = new Map(readDismissals(env, projectPath, home).map((d) => [d.id, d.reason]))
  const baseline = ratchet ? new Set((readBaseline(env, projectPath, home)?.items ?? []).map((b) => b.id)) : new Set()
  return { dismissed, baseline, ratchet }
}

// Which accepted kind a finding id falls under, or null.
export function acceptedBy(id, sets) {
  if (sets.dismissed.has(id)) return 'dismissed'
  if (sets.baseline.has(id)) return 'baseline'
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
    for (const it of d.items) {
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
    if (!mine.length && !(sets.ratchet && hiddenChecks.includes(r.id))) continue
    if (!mine.every((f) => acceptedBy(f.id, sets))) {
      // Some findings are still open, so the check stays FAIL, but the accepted ones must not be listed as open: their ids go on the sink
      // entry and buildFindings leaves them out (dismissing one of two findings of a check used to change nothing you could see).
      const accepted = mine.filter((f) => acceptedBy(f.id, sets))
      const got = sink?.get(r.id)
      if (accepted.length && got) {
        got.acceptedIds = new Set([...(got.acceptedIds ?? []), ...accepted.map((f) => f.id)])
        for (const f of accepted) out.push({ id: f.id, check: r.id, rule: f.rule ?? null, file: f.file ?? null, by: acceptedBy(f.id, sets), reason: sets.dismissed.get(f.id) ?? null })
      }
      continue
    }
    for (const f of mine) out.push({ id: f.id, check: r.id, rule: f.rule ?? null, file: f.file ?? null, by: acceptedBy(f.id, sets), reason: sets.dismissed.get(f.id) ?? null })
    r.status = 'PASS'
    r.detail = `${mine.length} finding(s) accepted: ${[...new Set(mine.map((f) => acceptedBy(f.id, sets)))].join(' and ')}. Open findings: none in this check.`
    r.accepted = mine.length
    const got = sink?.get(r.id)
    if (got) got.findings = []
  }
  return out
}
