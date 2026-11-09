// Child registry: every process Meerkat starts is recorded in <MEERKAT_HOME or ~/.meerkat>/children/<pid>.json (pid, parent pid, command,
// start time, run id) and the record is removed when the child ends. On any stop the process kills the whole tree of each child it started
// and removes the records. `meerkat ps` lists what is still alive; `meerkat ps --kill` kills only registered children whose Meerkat parent is gone.
// A hard kill of the parent (TerminateProcess on Windows, SIGKILL elsewhere) cannot run any handler: `meerkat ps --kill` is the cleanup for that.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const homeDir = (env = process.env) => env.MEERKAT_HOME || join(homedir(), '.meerkat')
export const childrenDir = (env = process.env) => join(homeDir(env), 'children')

let runId = null
export const setRunId = (id) => {
  runId = id ? String(id) : null
}
export const getRunId = (env = process.env) => runId ?? env.MEERKAT_RUN_ID ?? null

// Children this process started and has not seen end: pid -> record.
const own = new Map()

export function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

// Kill a process and its children. Windows: taskkill /T /F. Elsewhere the child is its own process group (detached), so the group gets the signal.
export function killTree(pid, force = true) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 5000 })
    return
  }
  const sig = force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(-pid, sig)
  } catch {
    try {
      process.kill(pid, sig)
    } catch {
      /* already gone */
    }
  }
}

const recordFile = (pid, env) => join(childrenDir(env), `${pid}.json`)

export function registerChild(pid, command, { env = process.env } = {}) {
  if (!pid) return null
  const rec = { pid, ppid: process.pid, command: String(command ?? '').slice(0, 300), startedAt: Date.now(), runId: getRunId(env) }
  own.set(pid, { rec, env })
  try {
    mkdirSync(childrenDir(env), { recursive: true })
    writeFileSync(recordFile(pid, env), JSON.stringify(rec))
  } catch {
    /* a registry problem never stops a check */
  }
  return rec
}

export function unregisterChild(pid) {
  const o = own.get(pid)
  if (!o) return
  own.delete(pid)
  try {
    rmSync(recordFile(pid, o.env), { force: true })
  } catch {
    /* already gone */
  }
}

// Record a spawned child and drop the record when it ends. For spawn() sites outside exec.mjs.
export function trackChild(child, command, opts = {}) {
  if (!child?.pid) return child
  registerChild(child.pid, command, opts)
  const done = () => unregisterChild(child.pid)
  child.once?.('exit', done)
  child.once?.('error', done)
  return child
}

export const ownChildCount = () => own.size

// Kill every child this process started (whole trees) and remove its records. Synchronous: safe inside an 'exit' handler.
export function killOwnChildren() {
  for (const pid of [...own.keys()]) {
    killTree(pid, true)
    unregisterChild(pid)
  }
}

let installed = false
// Backstop for every way a process ends: normal exit, signals, an uncaught error. Idempotent.
export function installStopCleanup({ exit = (c) => process.exit(c), onStop = null } = {}) {
  if (installed) return
  installed = true
  process.on('exit', () => killOwnChildren())
  for (const [sig, code] of [['SIGINT', 130], ['SIGBREAK', 130], ['SIGHUP', 129], ['SIGTERM', 143]]) {
    try {
      process.on(sig, () => {
        killOwnChildren()
        try {
          onStop?.(sig)
        } catch {
          /* ignore */
        }
        // A runner that handles this signal stops gracefully itself; with no other listener the process ends here.
        if (process.listenerCount(sig) <= 1) exit(code)
      })
    } catch {
      /* this platform has no such signal */
    }
  }
  process.on('uncaughtException', (e) => {
    killOwnChildren()
    try {
      onStop?.('error', e)
    } catch {
      /* ignore */
    }
    process.stderr.write(`meerkat: ${e?.stack ?? e}\n`)
    exit(1)
  })
}

// Every record in the registry. Records of dead children are removed unless keepDead.
export function listChildren({ env = process.env, keepDead = false } = {}) {
  const dir = childrenDir(env)
  if (!existsSync(dir)) return []
  const rows = []
  for (const f of readdirSync(dir)) {
    if (!/^\d+\.json$/.test(f)) continue
    let rec
    try {
      rec = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    } catch {
      continue
    }
    if (!rec || !Number.isInteger(rec.pid)) continue
    const alive = isAlive(rec.pid)
    if (!alive && !keepDead) {
      try {
        rmSync(join(dir, f), { force: true })
      } catch {
        /* ignore */
      }
      continue
    }
    rows.push({ ...rec, alive, parentAlive: isAlive(rec.ppid), ageMs: Date.now() - rec.startedAt })
  }
  return rows.sort((a, b) => a.startedAt - b.startedAt)
}

const age = (ms) => {
  const s = Math.round(ms / 1000)
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

// `meerkat ps [--kill]`. Returns { code, text }. Only children in the registry are ever touched, and --kill only those whose parent is gone.
export function psCommand(args = [], { env = process.env } = {}) {
  const kill = args.includes('--kill')
  const rows = listChildren({ env })
  const lines = []
  if (!rows.length) lines.push('No Meerkat-started processes are running.')
  else lines.push('pid      age      parent   run                          command', ...rows.map((r) => `${String(r.pid).padEnd(8)} ${age(r.ageMs).padEnd(8)} ${(r.parentAlive ? String(r.ppid) : `${r.ppid} gone`).padEnd(8)} ${String(r.runId ?? '-').padEnd(28)} ${r.command}`))
  if (kill) {
    const orphans = rows.filter((r) => !r.parentAlive)
    for (const r of orphans) {
      killTree(r.pid, true)
      try {
        rmSync(recordFile(r.pid, env), { force: true })
      } catch {
        /* ignore */
      }
      lines.push(`killed ${r.pid} (${r.command.slice(0, 60)}): its Meerkat process ${r.ppid} is gone`)
    }
    const kept = rows.length - orphans.length
    if (kept) lines.push(`${kept} left running: their Meerkat process is still alive.`)
  }
  if (args.includes('--json')) return { code: 0, text: JSON.stringify({ schema: 1, processes: rows.map((r) => ({ pid: r.pid, ppid: r.ppid, parentAlive: r.parentAlive, runId: r.runId ?? null, command: r.command, ageSeconds: Math.round(r.ageMs / 1000) })), messages: lines.filter((l) => /^(No Meerkat|killed|[0-9]+ left)/.test(l)) }, null, 2) }
  return { code: 0, text: lines.join('\n') }
}
