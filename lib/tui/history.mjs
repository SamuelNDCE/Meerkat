// The run log behind the terminal UI's history view: the last few runs, one entry each, kept on this machine in the
// home folder next to the timings file (never in the repo). Like the timings file it is a convenience: if it cannot
// be read or written the tool carries on, and it never changes a result.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const KEEP_RUNS = 20

export function historyPath(env = process.env, home = homedir()) {
  return env.MEERKAT_HISTORY || join(home, '.meerkat-history.json')
}

export function loadHistory(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(data?.runs) ? data.runs : []
  } catch {
    return []
  }
}

// One compact entry per run: when, which tier, the summary line, the exit code, and each check's status and time.
export function runEntry({ tier, summary, exitCode, ms, results, at = new Date().toISOString() }) {
  return { at, tier, summary, exitCode, ms, results: results.filter(Boolean).map((r) => ({ id: r.id, status: r.status, ms: Math.round(r.ms ?? 0) })) }
}

export function appendRun(file, entry) {
  try {
    const runs = [...loadHistory(file), entry].slice(-KEEP_RUNS)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify({ runs }, null, 1))
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}
