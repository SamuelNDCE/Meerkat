// `meerkat space [--json] [--root <dir>] [--base <branch>]`: one read-only overview of the development space.
// Sections, in order: worktrees (verdict, owner, purpose, age), live Meerkat runs, the run store (count and size), free disk, and advice lines.
// It reuses lib/worktreereport.mjs, lib/procmanage.mjs and lib/runsprune.mjs. It never removes, stops or changes anything: advice lines only name the command to run.
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { classify, DEFAULT_BASE, summary } from './worktreereport.mjs'
import { listLiveRuns } from './procmanage.mjs'
import { pruneRuns, sizeOf } from './runsprune.mjs'
import { sealOrphans } from './orphanseal.mjs'
import { logRoot } from './runlog.mjs'

const DAY = 24 * 3600 * 1000
const GB = 1024 ** 3
const LOW_DISK_BYTES = 10 * GB
const LONG_RUN_MS = 2 * 3600 * 1000
const DISK_TIMEOUT_MS = 4000
const STATFS_SCRIPT = 'require("node:fs").statfs(process.argv[1],(e,s)=>{if(e)process.exit(3);console.log(JSON.stringify({free:s.bavail*s.bsize,total:s.blocks*s.bsize}))})'

const mb = (b) => (b / (1024 * 1024)).toFixed(1)
const gb = (b) => (b / GB).toFixed(1)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ageText = (ms) => (ms == null ? 'age unknown' : ms >= DAY ? `${Math.floor(ms / DAY)}d old` : ms >= 3600000 ? `${Math.floor(ms / 3600000)}h old` : `${Math.max(0, Math.floor(ms / 60000))}m old`)

// Free bytes on the drive holding dir. statfs runs in a child process that is killed after the timeout, so a hung network drive cannot hang this command.
// Returns { known: true, free, total } or { known: false, why }.
export function diskFree(dir, { timeoutMs = DISK_TIMEOUT_MS, script = STATFS_SCRIPT } = {}) {
  const r = spawnSync(process.execPath, ['-e', script, dir], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  if (r.error?.code === 'ETIMEDOUT' || r.signal) return { known: false, why: `no answer within ${timeoutMs / 1000}s` }
  if (r.status !== 0) return { known: false, why: 'could not be read' }
  try {
    const d = JSON.parse(r.stdout)
    return Number.isFinite(d.free) ? { known: true, free: d.free, total: d.total } : { known: false, why: 'could not be read' }
  } catch {
    return { known: false, why: 'could not be read' }
  }
}

function runStoreInfo(env) {
  const root = join(logRoot(env), 'runs')
  let folders = 0
  try { folders = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).length } catch { /* no run store yet */ }
  const bytes = folders ? sizeOf(root) : 0
  const prune = pruneRuns(env, { yes: false }) // a dry run: measures, deletes nothing
  return { path: root.replace(/\\/g, '/'), folders, bytes, pruneCandidates: prune.candidates.length, pruneBytes: prune.bytes }
}

function folderAge(path, now) {
  try { const st = statSync(path); return now - (st.birthtimeMs || st.mtimeMs) } catch { return null }
}

export function buildSpace({ cwd, env = process.env, base = DEFAULT_BASE, now = Date.now(), disk = diskFree } = {}) {
  const view = classify(cwd, { base, now })
  const rows = view.rows.map((r) => {
    const ms = r.created ? now - Date.parse(r.created) : folderAge(r.path, now)
    return { path: r.path, branch: r.branch, verdict: r.verdict, owner: r.owner, purpose: r.purpose, ageDays: ms == null ? null : Math.floor(ms / DAY), ageText: ageText(ms) }
  })
  const live = listLiveRuns({ env })
  const store = runStoreInfo(env)
  const d = disk(view.top)
  const count = (v) => rows.filter((r) => r.verdict === v).length

  const advice = []
  const mergedN = count('CLEAN-MERGED') + count('PRUNABLE')
  if (mergedN) advice.push(`${plural(mergedN, 'clean merged worktree')}: meerkat worktrees prune --yes`)
  if (count('CLEAN-UNMERGED')) advice.push(`${plural(count('CLEAN-UNMERGED'), 'clean unmerged worktree')} may hold finished work: merge or review it before closing`)
  if (count('DIRTY')) advice.push(`${plural(count('DIRTY'), 'dirty worktree')} with uncommitted changes: commit or discard them in that folder`)
  const unknown = rows.filter((r) => r.verdict !== 'MAIN' && !r.owner).length
  if (unknown) advice.push(`${plural(unknown, 'worktree')} with unknown owner: create new ones with meerkat worktrees new <path> --branch <name> --for "<purpose>"`)
  for (const r of live.live.filter((x) => (x.ageMs ?? 0) > LONG_RUN_MS)) advice.push(`run ${r.runId} has been live for ${ageText(r.ageMs).replace(' old', '')}: if it is stuck, meerkat stop ${r.runId}`)
  if (store.pruneCandidates) advice.push(`${plural(store.pruneCandidates, 'old run folder')} (${mb(store.pruneBytes)} MB) could go: meerkat runs prune, then add --yes`)
  if (d.known && d.free < LOW_DISK_BYTES) advice.push(`only ${gb(d.free)} GB free on this drive: remove finished worktrees and old runs`)
  if (!d.known) advice.push(`free disk is unknown (${d.why}); check the drive by hand`)

  return {
    root: view.top, base,
    worktrees: { summary: summary(view.rows), rows },
    liveRuns: { count: live.live.length, skippedFinished: live.skipped, runs: live.live.map((r) => ({ runId: r.runId, kind: r.kind, project: r.project, pid: r.pid, ageSeconds: r.ageMs == null ? null : Math.round(r.ageMs / 1000), currentCheck: r.currentCheck })) },
    runStore: store,
    disk: d.known ? { known: true, freeBytes: d.free, totalBytes: d.total } : { known: false, why: d.why },
    advice,
  }
}

export function spaceText(s) {
  const L = []
  L.push(`Worktrees: ${s.worktrees.summary} (compared with ${s.base})`)
  for (const r of s.worktrees.rows) L.push(`  ${r.path}  |  ${r.branch ?? '(detached)'}  |  ${r.verdict}  |  ${r.owner ? `${r.owner}: ${r.purpose}` : 'unknown owner'}  |  ${r.ageText}`)
  L.push(`Live runs: ${s.liveRuns.count} live${s.liveRuns.skippedFinished ? `, ${s.liveRuns.skippedFinished} finished skipped` : ''}`)
  for (const r of s.liveRuns.runs) L.push(`  ${r.runId}  |  ${r.kind}  |  ${r.project ?? '-'}  |  pid ${r.pid}  |  ${r.ageSeconds == null ? 'age unknown' : `${Math.round(r.ageSeconds / 60)}m`}  |  ${r.currentCheck ?? '-'}`)
  L.push(`Run store: ${plural(s.runStore.folders, 'run folder')}, ${mb(s.runStore.bytes)} MB (${s.runStore.path})`)
  L.push(s.disk.known ? `Disk: ${gb(s.disk.freeBytes)} GB free of ${gb(s.disk.totalBytes)} GB on the drive of ${s.root}` : `Disk: free space unknown (${s.disk.why})`)
  L.push('Advice:')
  if (s.advice.length) for (const a of s.advice) L.push(`  - ${a}`)
  else L.push('  - nothing needs attention')
  L.push('Nothing was changed. This view only reads.')
  return L.join('\n')
}

export function runSpace(args = [], { cwd = process.cwd(), env = process.env, out = console.log, err = console.error, now = Date.now() } = {}) {
  const usage = 'usage: meerkat space [--json] [--no-seal] [--root <dir>] [--base <branch>]'
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a === '--json') flags.json = true
    else if (a === '--no-seal') flags.noSeal = true
    else if (a === '--root' || a === '--base') {
      const v = args[i + 1]
      if (v === undefined || String(v).startsWith('--')) { err(`meerkat space: ${a} needs a value\n${usage}`); return 2 }
      flags[a.slice(2)] = String(v)
      i++
    } else { err(`meerkat space: unexpected argument ${a.replace(/[\u0000-\u001f]/g, '?')}\n${usage}`); return 2 }
  }
  // Only adds a summary.json to run folders whose process ended without one; --no-seal skips it.
  if (!flags.noSeal) sealOrphans(env, { now })
  let s
  try { s = buildSpace({ cwd: flags.root ? resolve(cwd, flags.root) : cwd, env, base: flags.base || DEFAULT_BASE, now }) } catch (e) { err(`meerkat space: ${e.message}`); return 1 }
  out(flags.json ? JSON.stringify(s, null, 2) : spaceText(s))
  return 0
}
