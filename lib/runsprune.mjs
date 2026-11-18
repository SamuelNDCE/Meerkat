// `meerkat runs prune [--keep <n>] [--older-than <days>] [--dry-run] [--json] [--yes]`: retention for the per-user run store (<log root>/runs).
// A dry run is the default; folders are deleted only with --yes. Per project the newest --keep runs are kept (default 20) and so is anything newer
// than --older-than days (default 14): whichever keeps more. Never deleted: a run that is still going, a resumable run, a run a latest pointer names,
// and any folder that does not look like a Meerkat run (no summary.json and no run.json).
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { logRoot, parseRunName } from './runlog.mjs'
import { RESUME_FILE } from './resume.mjs'

export const DEFAULT_KEEP = 20
export const DEFAULT_OLDER_THAN_DAYS = 14
const DAY = 24 * 3600 * 1000
const RESUME_KEEP_MS = DAY // the same window the gate uses (lib/gate.mjs)
const PROGRESS_FRESH_MS = 10 * 60 * 1000 // a progress.json that says running and was written lately is a live run
const POINTERS = ['latest.json', 'latest-by-project.json', 'latest-by-preset.json']

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const slash = (p) => String(p).replaceAll(String.fromCharCode(92), '/')
const norm = (p) => slash(resolve(String(p))).toLowerCase()

const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

// The run folders the latest pointers name.
function pointed(root) {
  const set = new Set()
  for (const f of POINTERS) {
    const doc = readJson(join(root, f))
    if (!doc || typeof doc !== 'object') continue
    if (typeof doc.dir === 'string') set.add(norm(doc.dir))
    for (const v of Object.values(doc)) if (v && typeof v === 'object' && typeof v.dir === 'string') set.add(norm(v.dir))
  }
  return set
}

function sizeOf(dir) {
  let total = 0
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    try {
      total += e.isDirectory() ? sizeOf(p) : statSync(p).size
    } catch {
      /* a file that vanished is not counted */
    }
  }
  return total
}

// The start time of a run: the stamp in its folder name (local time), else the folder's own modified time.
function startedMs(name, dir) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  try {
    return statSync(dir).mtimeMs
  } catch {
    return Date.now()
  }
}

// Why a folder must not be deleted, or null.
function protectedReason(dir, name, now, pointers) {
  if (pointers.has(norm(dir))) return 'latest'
  const run = readJson(join(dir, 'run.json'))
  if (run && alive(run.pid)) return 'running'
  const prog = readJson(join(dir, 'progress.json'))
  if (prog?.state === 'running') {
    try {
      if (now - statSync(join(dir, 'progress.json')).mtimeMs < PROGRESS_FRESH_MS) return 'running'
    } catch {
      /* unreadable: fall through */
    }
  }
  try {
    if (now - statSync(join(dir, RESUME_FILE)).mtimeMs < RESUME_KEEP_MS) return 'resumable'
  } catch {
    /* no resume file */
  }
  return null
}

// Works out what would go, and deletes it only when yes is true. Returns { dryRun, keep, olderThanDays, candidates[{name, dir, bytes}], kept, bytes, notRuns, freed, failed }.
export function pruneRuns(env = process.env, { keep = DEFAULT_KEEP, olderThanDays = DEFAULT_OLDER_THAN_DAYS, yes = false, now = Date.now() } = {}) {
  const root = join(logRoot(env), 'runs')
  const base = join(logRoot(env))
  const pointers = pointed(base)
  let names = []
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    /* no run store yet */
  }
  const byProject = new Map()
  let notRuns = 0
  for (const name of names) {
    const dir = join(root, name)
    if (!existsSync(join(dir, 'summary.json')) && !existsSync(join(dir, 'run.json'))) {
      notRuns++
      continue
    }
    const key = parseRunName(name).project ?? ''
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key).push({ name, dir: slash(dir), at: startedMs(name, dir) })
  }
  const cutoff = now - olderThanDays * DAY
  const candidates = []
  let kept = 0
  for (const rows of byProject.values()) {
    rows.sort((a, b) => b.at - a.at || (b.name < a.name ? -1 : 1))
    rows.forEach((r, i) => {
      const keepIt = i < keep || r.at >= cutoff || protectedReason(r.dir, r.name, now, pointers)
      if (keepIt) kept++
      else candidates.push({ name: r.name, dir: r.dir, bytes: sizeOf(r.dir) })
    })
  }
  candidates.sort((a, b) => (a.name < b.name ? -1 : 1))
  const bytes = candidates.reduce((s, c) => s + c.bytes, 0)
  const out = { dryRun: !yes, keep, olderThanDays, candidates, kept, bytes, notRuns, freed: 0, failed: [] }
  if (yes) {
    for (const c of candidates) {
      try {
        rmSync(c.dir, { recursive: true, force: true })
        out.freed += c.bytes
      } catch {
        out.failed.push(c.name)
      }
    }
  }
  return out
}

const mb = (b) => (b / (1024 * 1024)).toFixed(1)

export function pruneText(r) {
  const n = r.candidates.length
  const head = r.dryRun
    ? `runs prune: ${n} run folder(s) would go, ${r.kept} kept, ${mb(r.bytes)} MB, dry run (add --yes to delete)`
    : `runs prune: ${n - r.failed.length} run folder(s) deleted, ${r.kept} kept, ${mb(r.freed)} MB freed${r.failed.length ? `, ${r.failed.length} could not be deleted` : ''}`
  const lines = [head]
  const shown = r.candidates.slice(0, 50)
  for (const c of shown) lines.push(`  ${r.dryRun ? 'would delete' : 'deleted'}  ${c.name}  ${mb(c.bytes)} MB`)
  if (r.candidates.length > shown.length) lines.push(`  and ${r.candidates.length - shown.length} more`)
  if (r.notRuns) lines.push(`  ${r.notRuns} folder(s) that do not look like Meerkat runs were left alone`)
  return lines.join('\n')
}
