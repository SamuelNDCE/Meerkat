// Seals run folders whose process ended without writing its record (a gate killed from outside never reaches its finally block, so the folder keeps
// only per-check logs). A folder is an orphan when it has no summary.json, its run.json (if any) names a pid that is not alive, and nothing in it was
// written in the last 10 minutes (progress.json included). Sealing only adds a summary.json (status "incomplete", exit code 143, the reason and the
// number of checks that finished, counted from their logs); it never deletes or changes anything else, and running it twice changes nothing more.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logRoot, sealRunDir } from './runlog.mjs'

export const FRESH_MS = 10 * 60 * 1000
export const REASON = 'the process ended without sealing its record (killed from outside or crashed; cause unknown)'

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}
// One check's log is <check id>.log; run.log is the run's own log, not a check.
const checkLogs = (names) => names.filter((n) => n.endsWith('.log') && n !== 'run.log')

// Seals every orphan in <log root>/runs. Returns { sealed, names[] }. Never throws.
export function sealOrphans(env = process.env, { now = Date.now() } = {}) {
  const out = { sealed: 0, names: [] }
  const root = join(logRoot(env), 'runs')
  let dirs = []
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return out
  }
  for (const name of dirs) {
    try {
      const dir = join(root, name)
      if (existsSync(join(dir, 'summary.json'))) continue
      const files = readdirSync(dir)
      const logs = checkLogs(files)
      const hasRecord = files.includes('run.json') || files.includes('progress.json')
      if (!hasRecord && !logs.length) continue
      const run = readJson(join(dir, 'run.json'))
      if (run && alive(run.pid)) continue
      const newest = Math.max(statSync(dir).mtimeMs, ...files.map((f) => statSync(join(dir, f)).mtimeMs))
      if (now - newest < FRESH_MS) continue
      const startedAtMs = run?.startedAt ? Date.parse(run.startedAt) : NaN
      const r = sealRunDir(dir, { tier: run?.kind ?? 'run', summary: REASON, exitCode: 143, status: 'incomplete', startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null, extra: { reason: REASON, checksFinished: logs.length } })
      if (r === 'written') {
        out.sealed++
        out.names.push(name)
      }
    } catch {
      /* a folder that cannot be read is left as it was */
    }
  }
  return out
}
