// A machine-wide lock for jobs that must not run at the same time (cargo builds, window jobs), with nothing to install.
// It is a folder made with mkdir, which is atomic: whoever makes it holds the lock. The holder writes its process id into it, so a
// holder that has died is cleared at once, and a job that waits too long gives up with exit code 75 ("NOT RUN, stop and report").
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
export function lockStatus(dir) {
  let holder = null
  try {
    const o = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
    if (alive(o.pid)) holder = o
  } catch {
    /* no holder, or it is still writing its details */
  }
  const waiters = []
  try {
    for (const n of readdirSync(waitersDirOf(dir))) {
      try {
        const w = JSON.parse(readFileSync(join(waitersDirOf(dir), n), 'utf8'))
        if (alive(w.pid)) waiters.push(w)
        else rmSync(join(waitersDirOf(dir), n), { force: true })
      } catch {
        /* a file being written or removed */
      }
    }
  } catch {
    /* no waiters folder */
  }
  waiters.sort((a, b) => Date.parse(a.since) - Date.parse(b.since))
  return { dir, holder, waiters }
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
        mkdirSync(waitersDirOf(dir), { recursive: true })
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
