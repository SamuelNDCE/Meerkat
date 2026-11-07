// Which saved run an MCP tool means, scoped to a project folder. The runs live in Meerkat's own log folder (see lib/runlog.mjs); each run's
// summary.json records the project folder it was made for, so "the newest run of THIS folder" and "the newest run of this preset in THIS
// folder" can be answered without trusting a folder name (two projects can share a name). Reads files only.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { logRoot, parseRunName, pickRunDir, slugProject, sortRunNames } from './runlog.mjs'

const MAX_SCAN = 600
const norm = (p) => String(p).split(String.fromCharCode(92)).join('/').replace(/\/+$/, '')
const same = (a, b) => (/^[A-Za-z]:/.test(norm(a)) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b))
const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
const belongs = (summaryPath, folder) => typeof summaryPath === 'string' && summaryPath !== '' && (same(summaryPath, folder) || same(real(summaryPath), folder))

function readSummary(dir) {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    return s && typeof s === 'object' ? s : null
  } catch {
    return null
  }
}

// The facts about one run folder that a tool states in its first line.
export function runInfo(env, dir) {
  if (!dir) return null
  const s = readSummary(dir)
  const id = norm(dir).split('/').pop()
  const project = s?.project?.name ? { name: String(s.project.name), path: s.project.path ?? null } : null
  return { id, dir: norm(dir), project: project ?? (parseRunName(id).project ? { name: parseRunName(id).project, path: null } : null), preset: s?.preset ?? s?.tier ?? null, tier: s?.tier ?? null, exitCode: typeof s?.exitCode === 'number' ? s.exitCode : null, startedAt: s?.startedAt ?? null, ms: typeof s?.ms === 'number' ? s.ms : null }
}

// The runs of one folder, newest first: { id, dir, preset, tier, exitCode, ms, startedAt, project }. A run that never wrote a summary.json is not listed.
export function folderRuns(env, folder, limit = 20) {
  const root = join(logRoot(env), 'runs')
  let names = []
  try {
    names = sortRunNames(readdirSync(root).filter((n) => /^[0-9A-Za-z._-]+$/.test(n))).slice(0, MAX_SCAN)
  } catch {
    return []
  }
  const out = []
  for (const id of names) {
    const dir = join(root, id)
    const s = readSummary(dir)
    if (!s || !belongs(s.project?.path, folder)) continue
    out.push({ id, dir: norm(dir), preset: s.preset ?? s.tier ?? null, tier: s.tier ?? null, exitCode: typeof s.exitCode === 'number' ? s.exitCode : null, ms: typeof s.ms === 'number' ? s.ms : null, startedAt: s.startedAt ?? null, project: s.project?.name ?? null })
    if (out.length >= limit) break
  }
  return out
}

// { folder (a real path), run, preset } -> { ok, dir, id, project, preset, exitCode } | { ok: false, text }.
// run (a name or the start of one) beats preset; neither = the newest run of that folder. With no folder it is today's behaviour: the newest run of any project.
export function resolveRunFor(env = process.env, { folder = null, run = null, preset = null } = {}) {
  if (!folder) {
    const p = pickRunDir(env, { run, preset })
    return p.ok ? { ok: true, ...runInfo(env, p.dir) } : p
  }
  if (run) {
    const p = pickRunDir(env, { run })
    if (!p.ok) return p
    const info = runInfo(env, p.dir)
    if (!belongs(readSummary(p.dir)?.project?.path, folder)) {
      return { ok: false, text: info?.project?.path ? `The run ${info.id} belongs to ${info.project.path}, not ${norm(folder)}, so nothing was read. Run meerkat on ${norm(folder)} first or leave run out.` : `The run ${info?.id ?? run} does not record which project it belongs to, so it cannot be used for ${norm(folder)}.` }
    }
    return { ok: true, ...info }
  }
  const runs = folderRuns(env, folder, MAX_SCAN)
  if (!runs.length) return { ok: false, text: `No run has been saved for ${norm(folder)} yet. Call meerkat_run with this folder first.` }
  if (preset) {
    const want = slugProject(preset)
    const hit = runs.find((r) => slugProject(r.preset ?? 'run') === want)
    if (!hit) return { ok: false, text: `No run of the preset "${slugProject(preset)}" has been saved for ${norm(folder)}. Known presets there: ${[...new Set(runs.map((r) => r.preset).filter(Boolean))].join(', ') || 'none'}` }
    return { ok: true, ...runInfo(env, hit.dir) }
  }
  return { ok: true, ...runInfo(env, runs[0].dir) }
}

export const hasFile = (dir, name) => existsSync(join(dir, name))
