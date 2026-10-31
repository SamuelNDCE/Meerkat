// `meerkat run list|show|log|open` (and last, why, log, logs): read what past runs saved. Built on lib/runlog.mjs.
// Text from a summary.json or a log is data: it is cleaned before it is printed, and a log path from a summary.json is
// opened only after safeLogPath says it sits inside the log folder.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { latestRunDir, logRoot } from './runlog.mjs'
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

export function listRuns(env = process.env, { limit = 20 } = {}) {
  const root = join(logRoot(env), 'runs')
  let names = []
  try {
    names = readdirSync(root).filter((n) => ID.test(n)).sort().reverse()
  } catch {
    return []
  }
  return names.slice(0, Math.max(1, limit)).map((id) => {
    const dir = join(root, id).split('\\').join('/')
    const s = readSummary(dir)
    return { id, dir, tier: s ? one(s.tier) : null, preset: s?.preset ? one(s.preset) : null, summary: s ? one(s.summary) : '(no summary)', exitCode: typeof s?.exitCode === 'number' ? s.exitCode : null, startedAt: s?.startedAt ? one(s.startedAt) : null, counts: s?.counts ?? null }
  })
}

export function listRunsText(rows, env = process.env) {
  if (!rows.length) return `No runs saved yet (logs go to ${logRoot(env)}). Try: meerkat verify`
  const w = Math.max(...rows.map((r) => r.id.length))
  return rows.map((r) => `${r.id.padEnd(w)}  ${r.exitCode === 0 ? 'passed' : r.exitCode === null ? '?     ' : 'failed'}  ${r.summary}`).join('\n')
}

// A run by id (its folder name, or a start of it that is only one run), else the newest.
export function resolveRun(env = process.env, id) {
  if (!id) {
    const dir = latestRunDir(env)
    return dir ? { ok: true, dir } : { ok: false, text: `No run has been saved yet (logs go to ${logRoot(env)}). Try: meerkat verify` }
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
  if (hits.length === 1) return { ok: true, dir: join(root, hits[0]).split('\\').join('/') }
  return { ok: false, text: hits.length ? `"${id}" matches ${hits.length} runs. Give more of the id. See: meerkat run list` : `No run called "${id}". See: meerkat run list` }
}

export function showRun(env, id, { json = false } = {}) {
  const r = resolveRun(env, id)
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

export function runLog(env, check, id, { lines = 80 } = {}) {
  const r = resolveRun(env, id)
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

export function openRun(env, id) {
  const r = resolveRun(env, id)
  if (!r.ok) return r
  return { ok: existsSync(r.dir), dir: r.dir, text: r.dir }
}
