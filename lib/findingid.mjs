// Stable finding ids (v2). An id is the hash of the check, the rule, the file and the normalised text of the finding (its message with every
// location removed), never the line number: the same code keeps its id when lines move, a dismissal follows it, and a copy of the text in
// another file is a different finding. v1 (lib/findings.mjs fingerprint) removed ":12" and "line 12"; v2 also removes the other ways
// a check writes a position ("L12", "line12", "(12, 5)", "col 5"), so a message that carried one of those no longer changes id when the code moves.
// Messages without such a position hash exactly as before, so their ids do not change. The v1 id stays on the finding as legacyId when it
// differs: old dismissals and baseline entries still match by it (lib/accepted.mjs), then say so once (migrationNote, markLegacyNoticed).
// Two findings of one check, rule and file with the same normalised text are one finding with their lines listed (documented in docs/findings.md).
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fingerprint, normaliseMessage } from './findings.mjs'
import { dismissalDoc, readDismissals, readRepoDismissals, saveAccepted, saveRepoDismissals } from './accepted.mjs'

const MAX_FILE = 2_000_000
const MAX_CACHED = 200

// v1 normalisation, then the position forms v1 missed.
export const normaliseText = (message) =>
  normaliseMessage(message)
    .replace(/\bl\d+(?:-l?\d+)?\b/g, 'line')
    .replace(/\bline\d+\b/g, 'line')
    .replace(/\(\s*\d+\s*,\s*\d+\s*\)/g, '')
    .replace(/\bcol(?:umn)?\s*\d+/g, 'col')
    .replace(/\s+/g, ' ')
    .trim()

export const stableId = ({ rule, check, file, message }) => createHash('sha256').update([rule ?? '-', check ?? '', file ?? '', normaliseText(message)].join('|')).digest('hex').slice(0, 16)

// Reads source lines with a small per-file cache, so thousands of findings in a few files read each file once.
export function makeLineReader(roots) {
  const cache = new Map()
  const linesOf = (file) => {
    if (cache.has(file)) return cache.get(file)
    let lines = null
    for (const r of roots) {
      try {
        const abs = resolve(r, file)
        if (relative(r, abs).startsWith('..') || statSync(abs).size > MAX_FILE) continue
        lines = readFileSync(abs, 'utf8').split(/\r?\n/)
        break
      } catch {
        /* try the next root */
      }
    }
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
    cache.set(file, lines)
    return lines
  }
  return (file, line) => (file && line >= 1 ? linesOf(file)?.[line - 1] ?? null : null)
}

// { id, legacyId } for one finding.
export function findingIds({ rule, check, file, message }) {
  const legacyId = fingerprint({ rule, check, file, message })
  return { id: stableId({ rule, check, file, message }), legacyId }
}

// ---- migration of old dismissals ----

// One line for the run, or null: names how many dismissals/baseline entries matched only by their old id.
export function migrationNote(legacyIds) {
  const n = new Set(legacyIds).size
  if (!n) return null
  return `${n} dismissed or baselined finding${n === 1 ? '' : 's'} matched by the old id (same check and file). Ids now follow the code, not its line, and the old ids keep working; this is said once.`
}

// Which of the dismissals still carry no migration notice, among the given old ids. Returns those ids.
export function unnoticedLegacy(env, projectPath, legacyIds) {
  const want = new Set(legacyIds)
  const all = [...readDismissals(env, projectPath), ...readRepoDismissals(projectPath)]
  return [...new Set(all.filter((d) => want.has(d.id) && !d.legacyNoticed).map((d) => d.id))]
}

// Marks those dismissals as noticed so the message is not repeated. Best effort: a write failure only means it is said again.
export function markLegacyNoticed(env, projectPath, legacyIds, at = new Date().toISOString()) {
  const want = new Set(legacyIds)
  if (!want.size) return false
  const mark = (items) => items.map((d) => (want.has(d.id) && !d.legacyNoticed ? { ...d, legacyNoticed: at } : d))
  let ok = true
  try {
    const home = readDismissals(env, projectPath)
    if (home.some((d) => want.has(d.id) && !d.legacyNoticed)) ok = saveAccepted('dismissed', env, projectPath, dismissalDoc(mark(home))) && ok
    const repo = readRepoDismissals(projectPath)
    if (repo.some((d) => want.has(d.id) && !d.legacyNoticed)) ok = saveRepoDismissals(projectPath, mark(repo)) && ok
  } catch {
    ok = false
  }
  return ok
}
