// Cross-run memory for findings: ~/.meerkat/findings/<project-slug>.json (or <MEERKAT_LOG_DIR>/findings/). It keeps the finding ids of the last 20
// runs of one project, so new / known / fixed survives the pruning of old run folders. Never larger than 2 MB (oldest runs go first).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { logRoot } from './runlog.mjs'

export const MAX_HISTORY_RUNS = 20
export const MAX_HISTORY_BYTES = 2 * 1024 * 1024

export const findingsHome = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'findings') : join(home, '.meerkat', 'findings'))

// <basename>-<8 hex of the path hash>, safe as a file name.
export function projectSlug(projectPath) {
  const full = resolve(String(projectPath ?? '.')).replace(/\\/g, '/')
  const hash = createHash('sha256').update(process.platform === 'win32' ? full.toLowerCase() : full).digest('hex').slice(0, 8)
  const base = (basename(full) || 'project').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'project'
  return `${base}-${hash}`
}

export const historyFile = (env, projectPath, home = homedir()) => join(findingsHome(env, home), `${projectSlug(projectPath)}.json`).split('\\').join('/')

export function writeAtomic(file, text, io = {}) {
  const w = io.writeFileSync ?? writeFileSync
  const rn = io.renameSync ?? renameSync
  const rm = io.unlinkSync ?? unlinkSync
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    w(tmp, text)
    rn(tmp, file)
    return true
  } catch {
    try {
      rm(tmp)
    } catch {
      /* nothing to clean */
    }
    return false
  }
}

export function readHistory(file) {
  try {
    const h = JSON.parse(readFileSync(file, 'utf8'))
    if (h && h.schemaVersion === 1 && Array.isArray(h.runs)) return h
  } catch {
    /* no history yet, or unreadable: start again */
  }
  return null
}

// Run entries rebuilt from the findings.json files of the newest run folders of this project, for a project with no history file yet.
export function historyFromRunFolders(env, projectPath, limit = MAX_HISTORY_RUNS) {
  const root = join(logRoot(env), 'runs')
  const want = resolve(projectPath).replace(/\\/g, '/').toLowerCase()
  let names = []
  try {
    names = readdirSync(root).sort().slice(-limit * 3)
  } catch {
    return []
  }
  const runs = []
  for (const n of names) {
    try {
      const d = JSON.parse(readFileSync(join(root, n, 'findings.json'), 'utf8'))
      if (String(d?.run?.project?.path ?? '').replace(/\\/g, '/').toLowerCase() !== want || !Array.isArray(d.findings)) continue
      runs.push(entryFromDoc(d))
    } catch {
      /* a run without findings.json, or a damaged one */
    }
  }
  return runs.slice(-limit)
}

export const kindOf = (preset, tier) => String(preset ?? tier ?? 'run')

const item = (f) => ({ id: f.id, severity: f.severity, title: f.title, file: f.file, line: f.line, check: f.check, rule: f.rule })
export function entryFromDoc(doc) {
  return { runId: doc.run.id, kind: kindOf(doc.run.preset, doc.run.tier), at: doc.run.startedAt, runDir: doc.run.dir ?? null, ids: doc.findings.map((f) => f.id), items: doc.findings.map(item) }
}

// What the previous run of the same kind (preset, else tier) of this project had, and the earliest sighting of every id.
export function priorState(runs, kind, currentRunId) {
  const before = (runs ?? []).filter((r) => r && r.runId !== currentRunId)
  const prev = [...before].reverse().find((r) => r.kind === kind) ?? null
  const firstSeen = new Map()
  for (const r of before.slice(-MAX_HISTORY_RUNS)) for (const id of r.ids ?? []) if (!firstSeen.has(id) || r.at < firstSeen.get(id)) firstSeen.set(id, r.at)
  return { prev, prevIds: new Set(prev?.ids ?? []), prevItems: new Map((prev?.items ?? []).map((x) => [x.id, x])), firstSeen }
}

// The history after this run: this run added, at most 20 runs, at most 2 MB (oldest first out).
export function updatedHistory(old, { project, entry }) {
  const runs = [...(old?.runs ?? []).filter((r) => r.runId !== entry.runId), entry].slice(-MAX_HISTORY_RUNS)
  const make = () => ({ schemaVersion: 1, project, lastRunId: entry.runId, lastRunDir: entry.runDir ?? null, updatedAt: new Date().toISOString(), runs })
  let text = JSON.stringify(make())
  while (text.length > MAX_HISTORY_BYTES && runs.length > 1) {
    runs.shift()
    text = JSON.stringify(make())
  }
  if (text.length > MAX_HISTORY_BYTES) {
    const last = runs[runs.length - 1]
    last.items = []
    last.ids = last.ids.slice(0, 20000)
    text = JSON.stringify(make())
  }
  return { history: make(), text }
}

export function saveHistory(env, projectPath, history, text, io = {}) {
  const file = historyFile(env, projectPath)
  try {
    ;(io.mkdirSync ?? mkdirSync)(findingsHome(env), { recursive: true, mode: 0o700 })
  } catch {
    return false
  }
  return writeAtomic(file, text ?? JSON.stringify(history), io)
}

export const historyExists = (env, projectPath) => existsSync(historyFile(env, projectPath))
