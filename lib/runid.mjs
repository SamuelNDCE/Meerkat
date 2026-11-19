// Who owns a gate run (docs/issues.md 22h). The run id is the run folder's name. recordRun writes run.json (run id, start time, pid, kind) into it and
// names the process "meerkat-gate <run id>" where the platform lets a Node process rename itself, so a later session can tell whose gate is whose.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const processTitleFor = (kind, runId) => `meerkat-${kind} ${runId}`

export function recordRun(dir, kind = 'gate', now = new Date()) {
  if (!dir) return null
  const runId = String(dir).split(/[\/]/).filter(Boolean).pop()
  const rec = { runId, kind, pid: process.pid, startedAt: now.toISOString() }
  try {
    writeFileSync(join(dir, 'run.json'), JSON.stringify(rec, null, 2))
  } catch {
    /* an attribution problem never stops a run */
  }
  try {
    process.title = processTitleFor(kind, runId)
  } catch {
    /* this platform cannot rename the process */
  }
  return rec
}
