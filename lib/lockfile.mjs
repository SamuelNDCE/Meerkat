// Safe sharing of Meerkat's state files between processes that run at the same time (two terminals, a hook and a hand run, two agents).
//   writeFileAtomic(file, text)  write to <file>.<pid>.<random>.tmp in the same folder, fsync, rename over the target: a reader sees the old file or the new one, never half
//   withFileLock(file, fn)       a short exclusive lock around a read-modify-write: <file>.lock created with flag 'wx', retried for up to 5 s,
//                                a lock older than 60 s is taken as left by a dead process and removed
// Nothing here is held while checks run: a lock lives for the few milliseconds it takes to read, change and write one small file.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

export const LOCK_WAIT_MS = 5000
export const LOCK_STALE_MS = 60_000

const cell = new Int32Array(new SharedArrayBuffer(4))
export const sleepSync = (ms) => Atomics.wait(cell, 0, 0, ms)

// Windows refuses to rename over a file another process has open for a moment: those codes are retried, anything else is thrown.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])

// Throws when the write fails (the temp file is removed first). Use writeAtomic in findingshistory.mjs for the "returns false" form.
export function writeFileAtomic(file, text, io = {}) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const rename = io.renameSync ?? renameSync
  try {
    if (io.writeFileSync) io.writeFileSync(tmp, text)
    else {
      const fd = openSync(tmp, 'w', 0o600)
      try {
        writeSync(fd, text)
        try {
          fsyncSync(fd)
        } catch {
          /* a file system that cannot sync still gets the rename */
        }
      } finally {
        closeSync(fd)
      }
    }
    for (let i = 0; ; i++) {
      try {
        rename(tmp, file)
        return
      } catch (e) {
        if (i >= 60 || !BUSY.has(e?.code)) throw e
        sleepSync(5 + Math.floor(Math.random() * 20))
      }
    }
  } catch (e) {
    try {
      ;(io.unlinkSync ?? unlinkSync)(tmp)
    } catch {
      /* nothing to clean */
    }
    throw e
  }
}

// Runs fn() holding the lock for `target`. If the lock cannot be had within the wait, fn still runs: the atomic write keeps the file whole,
// at worst one concurrent change is lost, which is better than a command that refuses to save.
export function withFileLock(target, fn, { waitMs = LOCK_WAIT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const lock = `${target}.lock`
  let held = false
  try {
    mkdirSync(dirname(lock), { recursive: true, mode: 0o700 })
    const start = Date.now()
    for (;;) {
      try {
        const fd = openSync(lock, 'wx', 0o600)
        try {
          writeSync(fd, `${process.pid}\n`)
        } finally {
          closeSync(fd)
        }
        held = true
        break
      } catch (e) {
        if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(e?.code)) break // cannot lock here at all (read-only folder): carry on unlocked
        try {
          if (Date.now() - statSync(lock).mtimeMs > staleMs) {
            // Renamed away, not unlinked: of several processes that find the same stale lock only one rename succeeds.
            const gone = `${lock}.${process.pid}.${randomBytes(3).toString('hex')}.stale`
            renameSync(lock, gone)
            unlinkSync(gone)
            continue
          }
        } catch {
          /* it was released or taken by someone else meanwhile: look again */
        }
        if (Date.now() - start > waitMs) break
        sleepSync(10 + Math.floor(Math.random() * 25))
      }
    }
  } catch {
    /* locking is best effort */
  }
  try {
    return fn()
  } finally {
    if (held) {
      try {
        unlinkSync(lock)
      } catch {
        /* already gone */
      }
    }
  }
}
