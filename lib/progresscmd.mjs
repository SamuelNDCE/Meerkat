// meerkat progress [run-id] [--json]: how far the newest run (or the named one) is, from its progress.json (lib/runprogress.mjs).
// One line for a person; with --json the file itself. Exit 0 printed, 1 no progress file found, 2 usage.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { logRoot } from './runlog.mjs'
import { PROGRESS_JSON, formatClock, renderLine } from './runprogress.mjs'

const STALE_SECONDS = 60

// The run folders that have a progress.json, newest file first.
function withProgress(root) {
  try {
    return readdirSync(root)
      .map((n) => ({ name: n, dir: join(root, n) }))
      .map((r) => ({ ...r, file: join(r.dir, PROGRESS_JSON) }))
      .filter((r) => existsSync(r.file))
      .map((r) => ({ ...r, at: statSync(r.file).mtimeMs }))
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export function findProgress(env, id = null, cwd = process.cwd()) {
  const root = join(logRoot(env), 'runs')
  const runs = withProgress(root)
  if (!id) return runs[0] ?? null
  // A run folder given by path, else a run id (the folder name) or the start of one.
  const asPath = resolve(cwd, id)
  if (isAbsolute(id) || id.includes('/') || id.includes('\\')) return existsSync(join(asPath, PROGRESS_JSON)) ? { name: id, dir: asPath, file: join(asPath, PROGRESS_JSON) } : null
  return runs.find((r) => r.name === id) ?? runs.find((r) => r.name.startsWith(id)) ?? runs.find((r) => r.name.includes(id)) ?? null
}

// The line for a person. A run that says "running" but has not written for a minute is marked, so a dead run is not read as a live one.
export function lineOfDoc(doc, now = Date.now()) {
  const age = Math.floor((now - Date.parse(doc.updated)) / 1000)
  const stale = doc.state === 'running' && Number.isFinite(age) && age > STALE_SECONDS ? ` (no update for ${formatClock(age * 1000)}: the run may have stopped)` : ''
  return `${renderLine({ ...doc, runs: 1 })}${stale}`
}

export function runProgress(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let json = false
  const ids = []
  for (const a of argv) {
    if (a === '--json') json = true
    else if (a.startsWith('-')) {
      err(`meerkat progress: unknown option ${String(a).replace(/[\p{Cc}\p{Cf}]/gu, '?')}. usage: meerkat progress [run-id] [--json]`)
      return 2
    } else ids.push(a)
  }
  if (ids.length > 1) {
    err('meerkat progress: give one run id. usage: meerkat progress [run-id] [--json]')
    return 2
  }
  const run = findProgress(env, ids[0] ?? null, cwd)
  if (!run) {
    err(ids[0] ? `meerkat progress: no progress file for run ${ids[0]} (meerkat runs lists the runs; a run from before this release has none)` : 'meerkat progress: no run has a progress file yet. Start meerkat gate, verdict or verify first')
    return 1
  }
  let text
  let doc
  try {
    text = readFileSync(run.file, 'utf8')
    doc = JSON.parse(text)
  } catch {
    err(`meerkat progress: ${run.file} could not be read as JSON (the run may be writing it; try again)`)
    return 1
  }
  out(json ? text.trimEnd() : lineOfDoc(doc))
  return 0
}
