// `meerkat ps` (the live runs on this machine) and `meerkat stop <run id> [--yes]` (end one of them and its child tree).
// A run is known by <run folder>/run.json (lib/runid.mjs: run id, kind, pid, start time). It is live while its pid is alive and its folder has no
// summary.json, or a summary whose status is "incomplete" (a stopped run that left a note but whose process is still there). Nothing here ever stops
// anything unless a run id is given and --yes is passed, and it only stops a pid that a Meerkat run.json names and that is a node or meerkat process.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAlive } from './childreg.mjs'
import { killTreeOf } from './exec.mjs'
import { logRoot, parseRunName, runProjectName, sealRunDir } from './runlog.mjs'

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

// One run folder as a record, or null when it has no usable run.json.
function readRun(dir, name) {
  const rec = readJson(join(dir, 'run.json'))
  if (!rec || typeof rec.runId !== 'string' || !Number.isInteger(rec.pid) || rec.pid <= 0) return null
  const summary = readJson(join(dir, 'summary.json'))
  const finished = existsSync(join(dir, 'summary.json')) && summary?.status !== 'incomplete'
  const progress = readJson(join(dir, 'progress.json'))
  const first = progress?.state === 'done' ? null : progress?.running?.[0]
  const started = Date.parse(rec.startedAt)
  const project = runProjectName(parseRunName(name).project) ?? null
  return { runId: rec.runId, dir, kind: rec.kind ?? 'run', pid: rec.pid, project, startedAt: rec.startedAt ?? null, ageMs: Number.isFinite(started) ? Date.now() - started : null, currentCheck: first?.id ?? null, finished }
}

// { live: [...], skipped: n }. skipped counts run folders that have a run.json but are not live (finished, or their process is gone).
export function listLiveRuns({ env = process.env } = {}) {
  const runs = join(logRoot(env), 'runs')
  const live = []
  let skipped = 0
  let names = []
  try {
    names = readdirSync(runs)
  } catch {
    return { live, skipped }
  }
  for (const name of names) {
    const r = readRun(join(runs, name), name)
    if (!r) continue
    if (!r.finished && isAlive(r.pid)) live.push(r)
    else skipped++
  }
  live.sort((a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0))
  return { live, skipped }
}

const brief = (r) => ({ runId: r.runId, kind: r.kind, project: r.project, pid: r.pid, ageSeconds: r.ageMs == null ? null : Math.round(r.ageMs / 1000), currentCheck: r.currentCheck })

// The live-runs part of `meerkat ps`. Returns { code, text, data }: text is the table (or a one-line "none"), data is merged into the --json document of ps.
export function psRuns(args = [], { env = process.env } = {}) {
  const { live, skipped } = listLiveRuns({ env })
  const data = { runs: live.map(brief), skippedFinished: skipped }
  if (args.includes('--json')) return { code: 0, data, text: JSON.stringify({ schema: 1, ...data }, null, 2) }
  const skipNote = skipped ? ` (${skipped} finished run${skipped === 1 ? '' : 's'} skipped)` : ''
  const lines = []
  if (!live.length) lines.push(`No live Meerkat runs${skipNote}.`)
  else {
    lines.push('run id                                         kind    project          pid      age      checking')
    for (const r of live) lines.push(`${r.runId.padEnd(46)} ${String(r.kind).padEnd(7)} ${String(r.project ?? '-').padEnd(16)} ${String(r.pid).padEnd(8)} ${(r.ageMs == null ? '?' : clock(r.ageMs)).padEnd(8)} ${r.currentCheck ?? '-'}`)
    lines.push(`${live.length} live run${live.length === 1 ? '' : 's'}${skipNote}. Stop one with: meerkat stop <run id> --yes`)
  }
  return { code: 0, data, text: lines.join('\n') }
}

// The image name of a process, or null when it cannot be read.
export function processName(pid) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      const m = /^"([^"]+)","(\d+)"/m.exec(r.stdout ?? '')
      return m && Number(m[2]) === pid ? m[1] : null
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 10000 })
    return r.status === 0 ? r.stdout.trim() || null : null
  } catch {
    return null
  }
}
const looksLikeMeerkat = (name) => /^(node|nodejs|bun|meerkat)/i.test(String(name ?? '').replace(/^.*[\\/]/, ''))

const refuse = (text) => ({ code: 2, text: `meerkat stop: ${text}` })

// `meerkat stop <run id> [--yes]`. A dry run unless yes. Returns { code, text }.
export function stopRun(id, { env = process.env, yes = false } = {}) {
  if (!id || /[\\/]/.test(id) || id === '.' || id === '..') return refuse('give the run id of one live run (see meerkat ps)')
  const dir = join(logRoot(env), 'runs', id)
  const r = existsSync(dir) ? readRun(dir, id) : null
  if (!r) return refuse(`no run ${id} with a run.json in the log folder, so it is not a Meerkat run that can be stopped`)
  if (r.runId !== id) return refuse(`run.json of ${id} names another run (${r.runId}); not stopping anything`)
  if (r.pid === process.pid) return refuse('that run is the current process; not stopping it')
  if (r.finished || !isAlive(r.pid)) return refuse(`run ${id} is not live (pid ${r.pid} has ended or the run finished); nothing to stop`)
  const name = processName(r.pid)
  if (!looksLikeMeerkat(name)) return refuse(`pid ${r.pid} is ${name ? `"${name}"` : 'a process whose name cannot be read'}, not a Meerkat run (a node or meerkat process); not stopping it. The pid was probably reused`)
  const what = `run ${id} (${r.kind}${r.project ? `, ${r.project}` : ''}, pid ${r.pid}${r.currentCheck ? `, checking ${r.currentCheck}` : ''}) and every process it started`
  if (!yes) return { code: 0, text: `Would stop ${what}.\nNothing was stopped. Run again with --yes to stop it: meerkat stop ${id} --yes` }
  killTreeOf(r.pid, true)
  const startedAtMs = Date.parse(r.startedAt)
  sealRunDir(r.dir, { tier: 'fast', status: 'incomplete', summary: 'stopped by meerkat stop', exitCode: 143, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null })
  return { code: 0, text: `Stopped ${what}.` }
}

// `meerkat stop <run id> [--yes]` from the command line.
export function runStop(args = [], { env = process.env, out, err } = {}) {
  const ids = args.filter((a) => !a.startsWith('-'))
  if (ids.length !== 1) {
    err('meerkat stop: give exactly one run id (meerkat ps lists the live ones). Usage: meerkat stop <run id> [--yes]')
    return 2
  }
  const r = stopRun(ids[0], { env, yes: args.includes('--yes') })
  ;(r.code === 0 ? out : err)(r.text)
  return r.code
}
