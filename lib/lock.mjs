// A machine-wide lock for jobs that must not run at the same time (cargo builds, window jobs), with nothing to install.
// It is a folder made with mkdir, which is atomic: whoever makes it holds the lock. The holder writes its process id into it, so a
// holder that has died is cleared at once, and a job that waits too long gives up with exit code 75 ("NOT RUN, stop and report").
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

export async function acquire(dir, { maxWaitMs = 900_000, pollMs = 500, say = () => {}, now = Date.now } = {}) {
  mkdirSync(dirname(dir), { recursive: true })
  const start = now()
  let told = 0
  for (;;) {
    try {
      mkdirSync(dir)
      writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cmd: process.argv.slice(2).join(' ').slice(0, 200) }))
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
    if (waited > maxWaitMs) return null
    if (waited - told >= 30_000) {
      told = waited
      say(`waiting for the lock held by process ${owner?.pid ?? '?'} (${owner?.cmd ?? 'unknown job'}), ${Math.round(waited / 1000)} s so far`)
    }
    await sleep(pollMs)
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
