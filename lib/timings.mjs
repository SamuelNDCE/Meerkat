// Measured check times, kept on this machine. The estSeconds written in a check file are a guess made once
// (vault-parser-proptest said 3 seconds and took 293), and they drive three things: the order checks start in, the
// weight of each check in the progress bar, and the "about N left" figure. After a run the real times are saved
// here, and the next run uses the middle value of the last few passes instead of the guess.
//
// Only a PASS is recorded: a failure or a check that was stopped early says nothing about how long the work takes.
// The file is a convenience, never a requirement: if it cannot be read or written the tool carries on with the
// written estimates.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { projectFacts, scaledSeconds } from './eta.mjs'

export const KEEP_SAMPLES = 5

export function timingsPath(env = process.env, home = homedir()) {
  return env.MEERKAT_TIMINGS || join(home, '.meerkat-timings.json')
}

// Times are kept per project: the same check takes 2 s in one repository and 600 s in another, so a time measured in one
// project is never used for a different one. The file is { projects: { <folder>: { checks } } }. An older file had one flat
// { checks, project } (the last project run); it is read as that project's times and rewritten in the new shape on the next save.
export function projectKey(dir) {
  if (!dir) return ''
  const k = resolve(String(dir)).split(String.fromCharCode(92)).join('/').replace(/\/+$/, '')
  return process.platform === 'win32' ? k.toLowerCase() : k
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

function readRaw(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return isObj(data) ? data : {}
  } catch {
    return {}
  }
}

// The measurements for one project. Without a project, only the old flat `checks` (kept so older callers and files still work).
export function loadTimings(file, project) {
  const data = readRaw(file)
  if (project) {
    const key = projectKey(project)
    const own = data.projects?.[key]?.checks
    const checks = isObj(own) ? own : isObj(data.checks) && typeof data.project === 'string' && projectKey(data.project) === key ? data.checks : {}
    // Remember which project these times belong to (not saved, not compared) so a first-run estimate can be scaled to its size.
    return Object.defineProperty({ checks }, 'project', { value: project, enumerable: false })
  }
  return isObj(data.checks) ? data : { checks: {} }
}

export function median(values) {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// The measured seconds for one check in one tier, or null when nothing has been recorded yet.
export function learnedSeconds(timings, id, tier) {
  const ms = median(timings.checks?.[id]?.[tier] ?? [])
  return ms === null ? null : Math.max(1, Math.round(ms / 1000))
}

// Replace each check's written estimate with the measured one. A check not yet timed in this project keeps its written estimate,
// scaled to the project's size when the check says `scale` (lib/eta.mjs). Returns how many were changed.
export function applyLearned(checks, timings, tier) {
  let changed = 0
  const facts = checks.some((c) => c.scale) && timings?.project ? projectFacts(timings.project) : null
  for (const c of checks) {
    const learned = learnedSeconds(timings, c.id, tier)
    const s = learned !== null ? learned : facts && c.scale ? scaledSeconds({ ...c, estSeconds: c.writtenEstSeconds ?? c.estSeconds }, facts) : null
    if (s !== null && s !== c.estSeconds) {
      c.writtenEstSeconds = c.estSeconds
      c.estSeconds = s
      changed++
    }
  }
  return changed
}

// Add this run's passes to the stored samples (newest last, at most KEEP_SAMPLES each).
export function recordRun(timings, results, tier) {
  const next = { checks: { ...(timings.checks ?? {}) } }
  for (const r of results) {
    if (!r || r.status !== 'PASS' || !(r.ms > 0)) continue
    const entry = { ...(next.checks[r.id] ?? {}) }
    entry[tier] = [...(entry[tier] ?? []), Math.round(r.ms)].slice(-KEEP_SAMPLES)
    next.checks[r.id] = entry
  }
  return next
}

// Save one project's measurements (timings.project) without touching any other project's. Without timings.project the object is
// written as it is (the old flat shape).
export function saveTimings(file, timings) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    let out = timings
    if (timings?.project) {
      const raw = readRaw(file)
      const projects = isObj(raw.projects) ? { ...raw.projects } : {}
      if (isObj(raw.checks) && typeof raw.project === 'string' && !projects[projectKey(raw.project)]) projects[projectKey(raw.project)] = { checks: raw.checks }
      projects[projectKey(timings.project)] = { checks: timings.checks ?? {} }
      out = { projects }
    }
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(out, null, 1))
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

function fileExists(file) {
  return existsSync(file)
}
