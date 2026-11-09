// `meerkat run list|show|log|open` (and last, why, log, logs): read what past runs saved. Built on lib/runlog.mjs.
// Text from a summary.json or a log is data: it is cleaned before it is printed, and a log path from a summary.json is
// opened only after safeLogPath says it sits inside the log folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { latestRunDir, latestRunDirOf, logRoot, parseRunName, projectInfo, runProjectName, slugProject, sortRunNames } from './runlog.mjs'
import { cleanText, safeLogPath, stripControl } from './tui/safe.mjs'

const ID = /^[0-9A-Za-z._-]+$/
const one = (x) => stripControl(String(x ?? ''))

const readSummary = (dir) => {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    return s && typeof s === 'object' ? s : null
  } catch {
    return null
  }
}

export function listRuns(env = process.env, { limit = 20, project = null, folder = null } = {}) {
  const root = join(logRoot(env), 'runs')
  let names = []
  try {
    names = sortRunNames(readdirSync(root).filter((n) => ID.test(n)))
  } catch {
    return []
  }
  if (project) {
    const want = slugProject(basename(String(project)))
    names = names.filter((n) => runProjectName(parseRunName(n).project) === want)
  } else if (folder) {
    // one folder's runs: the folder name carries the hash of its full path; an older name without a hash is matched by the name alone
    const p = projectInfo(folder)
    names = names.filter((n) => parseRunName(n).project === p.id || parseRunName(n).project === p.name)
  }
  return names.slice(0, Math.max(1, limit)).map((id) => {
    const dir = join(root, id).split('\\').join('/')
    const s = readSummary(dir)
    const proj = runProjectName(parseRunName(id).project) ?? (typeof s?.project?.name === 'string' ? one(s.project.name) : null)
    return { id, dir, project: proj, tier: s ? one(s.tier) : null, preset: s?.preset ? one(s.preset) : null, summary: s ? one(s.summary) : '(did not finish: no summary.json was written, so the run was stopped or crashed before the end)', exitCode: typeof s?.exitCode === 'number' ? s.exitCode : null, startedAt: s?.startedAt ? one(s.startedAt) : null, counts: s?.counts ?? null }
  })
}

export function listRunsText(rows, env = process.env) {
  if (!rows.length) return `No runs saved yet (logs go to ${logRoot(env)}). Try: meerkat verify`
  const w = Math.max(...rows.map((r) => r.id.length))
  const pw = Math.max(7, ...rows.map((r) => (r.project ?? '-').length))
  const head = `${'RUN'.padEnd(w)}  ${'PROJECT'.padEnd(pw)}  RESULT  SUMMARY`
  return [head, ...rows.map((r) => `${r.id.padEnd(w)}  ${(r.project ?? '-').padEnd(pw)}  ${r.exitCode === 0 ? 'passed' : r.exitCode === null ? '?     ' : 'failed'}  ${r.summary}`)].join('\n')
}

// A run by id (its folder name, or a start of it that is only one run), else the newest.
export function resolveRun(env = process.env, id, folder = null) {
  if (!id) {
    const dir = latestRunDir(env, folder)
    return dir ? { ok: true, dir } : { ok: false, text: folder ? `No run has been saved for ${one(folder)} yet (logs go to ${logRoot(env)}). Try: meerkat verify` : `No run has been saved yet (logs go to ${logRoot(env)}). Try: meerkat verify` }
  }
  if (!ID.test(String(id))) return { ok: false, text: `"${one(id)}" is not a run id. See: meerkat run list` }
  const root = join(logRoot(env), 'runs')
  const all = (() => {
    try {
      return readdirSync(root).filter((n) => ID.test(n))
    } catch {
      return []
    }
  })()
  const exact = all.filter((n) => n === id)
  const hits = exact.length ? exact : all.filter((n) => n.startsWith(id))
  if (!hits.length) {
    // Not a run id: a project name picks that project's newest run.
    const byProject = latestRunDirOf(env, id)
    if (byProject) return { ok: true, dir: byProject }
  }
  if (hits.length === 1) return { ok: true, dir: join(root, hits[0]).split('\\').join('/') }
  return { ok: false, text: hits.length ? `"${id}" matches ${hits.length} runs. Give more of the id. See: meerkat run list` : `No run called "${id}". See: meerkat run list` }
}

export function showRun(env, id, { json = false, folder = null } = {}) {
  const r = resolveRun(env, id, folder)
  if (!r.ok) return r
  if (json) {
    const s = readSummary(r.dir)
    return s ? { ok: true, data: { ...s, runDir: r.dir }, text: '' } : { ok: false, text: `${r.dir} has no summary.json` }
  }
  try {
    return { ok: true, text: cleanText(readFileSync(join(r.dir, 'report.md'), 'utf8')) }
  } catch {
    return { ok: false, text: `The run ${r.dir} has no report.` }
  }
}

export function runLog(env, check, id, { lines = 80, folder = null } = {}) {
  const r = resolveRun(env, id, folder)
  if (!r.ok) return r
  const s = readSummary(r.dir)
  const hit = (s?.results ?? []).find((x) => x && x.id === check)
  if (!hit) {
    const have = (s?.results ?? []).map((x) => one(x?.id)).filter(Boolean)
    return { ok: false, text: `That run has no check called "${one(check)}". It has: ${have.join(', ') || 'none'}` }
  }
  const file = typeof hit.logFile === 'string' ? safeLogPath(hit.logFile, { env }) : null
  if (!file) return { ok: false, text: `The log for "${one(check)}" is missing, or is not inside the log folder (${logRoot(env)}), so it was not opened.` }
  const text = readFileSync(file, 'utf8')
  const at = text.indexOf('--- output ---\n')
  const head = at >= 0 ? text.slice(0, at) : ''
  const body = (at >= 0 ? text.slice(at + 15) : text).trimEnd().split('\n').slice(-lines).join('\n')
  return { ok: true, text: `${cleanText(head)}\n--- last ${lines} lines of output (full log: ${file}) ---\n${cleanText(body)}` }
}

export function openRun(env, id, folder = null) {
  const r = resolveRun(env, id, folder)
  if (!r.ok) return r
  return { ok: existsSync(r.dir), dir: r.dir, text: r.dir }
}
