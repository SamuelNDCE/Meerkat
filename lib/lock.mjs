// A machine-wide lock for jobs that must not run at the same time (cargo builds, window jobs), with nothing to install.
// It is a folder made with mkdir, which is atomic: whoever makes it holds the lock. The holder writes its process id into it, so a
// holder that has died is cleared at once, and a job that waits too long gives up with exit code 75 ("NOT RUN, stop and report").
import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

// A job that has to wait writes a small file in <lock dir>.waiters so `meerkat lock status` can list it; it removes the file when it stops waiting.
export const waitersDirOf = (dir) => dir + '.waiters'
const WAITER_NAME = /^\d+-[a-z0-9]+\.json$/
const goodPid = (p) => Number.isInteger(p) && p > 0
// Control characters (C0, DEL, C1, so ESC too) never reach a terminal from a file somebody else could write; text is cut at 200 characters.
const tidy = (x) => String(x ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 200)
const tidyOwner = (o) => ({ pid: o.pid, since: Number.isFinite(Date.parse(o.since)) ? new Date(Date.parse(o.since)).toISOString() : new Date(0).toISOString(), cmd: tidy(o.cmd) })

// The waiters folder if it is a real folder of this user (not a link, not somebody else's); null otherwise. create: make it (mode 0o700) when missing.
function safeWaitersDir(dir, create = false) {
  const wd = waitersDirOf(dir)
  try {
    let st
    try {
      st = lstatSync(wd)
    } catch (e) {
      if (!create || e.code !== 'ENOENT') return null
      mkdirSync(wd, { recursive: true, mode: 0o700 })
      st = lstatSync(wd)
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return null
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null
    return wd
  } catch {
    return null
  }
}

// Read-only: it never deletes. A waiter file whose process has gone is skipped here and removed by the next acquire().
export function lockStatus(dir) {
  let holder = null
  try {
    const o = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
    if (goodPid(o.pid) && alive(o.pid)) holder = tidyOwner(o)
  } catch {
    /* no holder, or it is still writing its details */
  }
  const waiters = []
  const wd = safeWaitersDir(dir)
  if (wd) {
    try {
      for (const n of readdirSync(wd)) {
        if (!WAITER_NAME.test(n)) continue
        try {
          const w = JSON.parse(readFileSync(join(wd, n), 'utf8'))
          if (goodPid(w.pid) && alive(w.pid)) waiters.push(tidyOwner(w))
        } catch {
          /* a file being written or removed */
        }
      }
    } catch {
      /* unreadable folder */
    }
  }
  waiters.sort((x, y) => Date.parse(x.since) - Date.parse(y.since))
  return { dir, holder, waiters }
}

// Removes the waiter files of processes that have gone (only files named like ours, only inside a safe folder).
function clearStaleWaiters(dir) {
  const wd = safeWaitersDir(dir)
  if (!wd) return
  try {
    for (const n of readdirSync(wd)) {
      if (!WAITER_NAME.test(n)) continue
      try {
        const w = JSON.parse(readFileSync(join(wd, n), 'utf8'))
        if (!goodPid(w.pid) || !alive(w.pid)) rmSync(join(wd, n), { force: true })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
}

export async function acquire(dir, { maxWaitMs = 900_000, pollMs = 500, say = () => {}, now = Date.now } = {}) {
  mkdirSync(dirname(dir), { recursive: true })
  const start = now()
  let told = 0
  let began = false
  const mine = join(waitersDirOf(dir), `${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`)
  const unregister = () => rmSync(mine, { force: true })
  try {
  for (;;) {
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cmd: process.argv.slice(2).join(' ').slice(0, 200) }))
      if (began) say(`wait ended: got the lock after ${Math.round((now() - start) / 1000)} s`)
      unregister()
      return () => rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    let owner = null
    try {
      owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
    } catch {
      /* the holder is still writing its details, or died before it could */
    }
    if (owner && !alive(owner.pid)) {
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    const waited = now() - start
    if (waited > maxWaitMs) {
      unregister()
      say(`wait ended: gave up after ${Math.round(waited / 1000)} s, the lock is still held by process ${owner?.pid ?? '?'} (${owner?.cmd ?? 'unknown job'})`)
      return null
    }
    if (!began) {
      began = true
      try {
        clearStaleWaiters(dir)
        if (!safeWaitersDir(dir, true)) throw new Error('unsafe waiters folder')
        writeFileSync(mine, JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cmd: process.argv.slice(2).join(' ').slice(0, 200) }))
      } catch {
        /* the queue listing is a courtesy; waiting works without it */
      }
      say(`wait started: the lock at ${dir} is held by process ${owner?.pid ?? '?'} (${owner?.cmd ?? 'unknown job'})`)
    }
    if (waited - told >= 30_000) {
      told = waited
      say(`waiting for the lock held by process ${owner?.pid ?? '?'} (${owner?.cmd ?? 'unknown job'}), ${Math.round(waited / 1000)} s so far`)
    }
    await sleep(pollMs)
  }
  } finally {
    unregister()
  }
}

// Run a command while holding the lock. Returns its exit code, or 75 when the lock was not got in time.
export async function runLocked(command, args, { dir, cwd = process.cwd(), env = process.env, maxWaitMs, say = (l) => console.error(l) } = {}) {
  const release = await acquire(dir, { maxWaitMs, say })
  if (!release) {
    console.log(`NOT RUN: waited ${Math.round(maxWaitMs / 1000)} s for the lock at ${dir}; another job still holds it. Stop and report, do not retry in a loop.`)
    return 75
  }
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false })
      child.on('error', (e) => {
        console.log(`NOT RUN: could not start ${command}: ${e.code ?? e.message}`)
        resolve(75)
      })
      child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
  } finally {
    release()
  }
}
