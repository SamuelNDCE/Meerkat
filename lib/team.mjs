// Team-shared accepted findings and rules: `.meerkat-team.json` at the repo root, committed so the team and CI read the same list.
// Each entry: check, file (a path or a glob), reason, owner, expires (YYYY-MM-DD, required). An entry with no expiry, a bad expiry or an
// expired one never suppresses; the run and `meerkat team` say so. One small file is read per run, nothing else.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { globToRegExp } from './glob.mjs'

export const TEAM_FILE = '.meerkat-team.json'
export const EXPIRING_DAYS = 14
const MAX_BYTES = 1024 * 1024
const UNREADABLE = `the team file could not be read; check it is a plain JSON file in the repo root`
const DAY = 86400000
const clean = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')

export function parseDate(v) {
  const s = String(v ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : t
}

// The state of one entry on a given day. The expiry date itself still counts as active (it lapses the day after, as dismissals do).
export function entryState(raw, now = new Date()) {
  const problems = []
  const check = clean(raw?.check)
  const file = clean(raw?.file)
  const owner = clean(raw?.owner)
  const reason = clean(raw?.reason)
  const expires = clean(raw?.expires)
  if (!check) problems.push('no check')
  if (!file) problems.push('no file')
  if (!reason) problems.push('no reason')
  if (!owner) problems.push('no owner')
  let state = 'active'
  let days = null
  const t = parseDate(expires)
  if (!expires) {
    state = 'no-expiry'
    problems.push('no expiry date')
  } else if (t === null) {
    state = 'no-expiry'
    problems.push(`expiry "${expires.slice(0, 20)}" is not a date like 2026-12-31`)
  } else {
    days = Math.floor((t + DAY - now.getTime()) / DAY)
    if (now.getTime() >= t + DAY) state = 'expired'
    else if (days <= EXPIRING_DAYS) state = 'expiring'
  }
  if ((!check || !file) && (state === 'active' || state === 'expiring')) state = 'invalid'
  return { check, file, owner, reason, expires, state, days, problems }
}

// Reads the file at the repo root. { exists, file, error, entries }: a file that cannot be read or parsed is an error the caller prints, never silence.
export function readTeam(root, now = new Date()) {
  const file = join(root, TEAM_FILE).split('\\').join('/')
  try {
    lstatSync(file)
  } catch {
    return { exists: false, file, error: null, entries: [] }
  }
  const refuse = (error) => ({ exists: true, file, error, entries: [] })
  try {
    // A symlink, a folder or a file whose real path is outside the repo root is refused: its content is never read or shown.
    const st = lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile()) return refuse(UNREADABLE)
    const rel = relative(realpathSync(root), realpathSync(file))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return refuse(UNREADABLE)
    if (st.size > MAX_BYTES) return refuse(`${TEAM_FILE} is larger than 1 MB, so it was not read`)
    const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const list = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : null
    if (!list) return refuse(UNREADABLE)
    const entries = list.map((raw, i) => ({ index: i + 1, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? entryState(raw, now) : { check: '', file: '', owner: '', reason: '', expires: '', state: 'invalid', days: null, problems: ['not an object'] }) }))
    return { exists: true, file, error: null, entries }
  } catch {
    return refuse(UNREADABLE)
  }
}

const suppresses = (e) => e.state === 'active' || e.state === 'expiring'
const fileMatches = (e, f) => {
  const pat = norm(e.file)
  const got = norm(f.file)
  return pat === got || globToRegExp(pat).test(got)
}
const checkMatches = (e, f) => e.check === f.check || (f.alsoDetectedBy ?? []).includes(e.check) || (f.alsoReportedBy ?? []).some((o) => o.check === e.check)
const who = (e) => `team rule ${e.index}${e.owner ? `, owner ${e.owner}` : ''}`

// Adds the team's accepted findings to the run's accepted sets (lib/accepted.mjs acceptedSets): an active entry puts the finding id in
// `dismissed` with its reason, an expired one in `expired` so the check's detail says the rule lapsed. Returns { matched, lapsed }.
export function applyTeam(sets, findings, team) {
  let matched = 0
  let lapsed = 0
  if (!sets || !team?.entries.length) return { matched, lapsed }
  for (const f of findings ?? []) {
    const hit = team.entries.find((e) => suppresses(e) && checkMatches(e, f) && fileMatches(e, f))
    if (hit) {
      if (!sets.dismissed.has(f.id)) matched++
      sets.dismissed.set(f.id, `${clean(hit.reason)} (${who(hit)}, expires ${hit.expires})`)
      sets.expired?.delete(f.id)
      continue
    }
    if (sets.dismissed.has(f.id)) continue
    const old = team.entries.find((e) => e.state === 'expired' && checkMatches(e, f) && fileMatches(e, f))
    if (old) {
      lapsed++
      sets.expired?.set(f.id, `${old.expires} (${who(old)})`)
    }
  }
  return { matched, lapsed }
}

// The lines a run prints about the file: every entry that does not suppress says why. Empty when all is well.
export function teamRunNotes(team) {
  if (!team?.exists) return []
  if (team.error) return [`team: ${team.error}; no team rule was applied`]
  const out = []
  for (const e of team.entries) {
    const label = `team: rule ${e.index} (${e.check || 'no check'} in ${e.file || 'no file'})`
    if (e.state === 'expired') out.push(`${label} expired on ${e.expires}${e.owner ? ` (owner ${e.owner})` : ''}, so it no longer suppresses. Renew it or fix the finding.`)
    else if (e.state === 'no-expiry') out.push(`${label} has no valid expiry date, so it suppresses nothing. Add "expires": "YYYY-MM-DD".`)
    else if (e.state === 'invalid') out.push(`${label} is incomplete (${e.problems.join(', ')}), so it suppresses nothing.`)
  }
  return out
}

export function teamCounts(team) {
  const n = (s) => team.entries.filter((e) => e.state === s).length
  return { total: team.entries.length, active: n('active'), expiring: n('expiring'), expired: n('expired'), noExpiry: n('no-expiry'), invalid: n('invalid'), noOwner: team.entries.filter((e) => !e.owner).length }
}

// `meerkat team --check` fails on an expired entry, one with no owner, one with no usable expiry, a broken entry, or an unreadable file.
export function teamCheckFailures(team) {
  if (team.error) return [team.error]
  const out = []
  for (const e of team.entries) {
    if (e.state === 'expired') out.push(`rule ${e.index} expired on ${e.expires}`)
    if (e.state === 'no-expiry') out.push(`rule ${e.index} has no valid expiry`)
    if (e.state === 'invalid') out.push(`rule ${e.index} is incomplete (${e.problems.join(', ')})`)
    if (!e.owner) out.push(`rule ${e.index} has no owner`)
  }
  return out
}
