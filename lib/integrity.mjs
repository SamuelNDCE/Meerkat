// Project integrity: a check must never change the project it checks (docs/robustness.md, "Temp copy only").
// Before the run, a snapshot of every file git knows about (tracked, plus untracked and not ignored); after the run, the same snapshot.
// Any file that was changed, added or removed is a violation. The snapshot never reads more than 256 KB of any one file: a larger file
// is compared by size and modification time, which is enough to see a write. Not a git repository: no snapshot, so no guard (said so).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { globToRegExp } from './glob.mjs'

export const HASH_LIMIT = 256 * 1024
export const MAX_LISTED = 25

// The files git knows under a repository root, repo-relative with forward slashes. null when git cannot answer.
export function gitFileList(repoRoot, exec = execFileSync) {
  try {
    const out = exec('git', ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'))
  } catch {
    return null
  }
}

// The signature of one file through a single open handle (the same text snapshotTree builds from stat + read). 'gone' when it cannot be opened because it
// is missing, null for a non-file, undefined when this path cannot answer (the caller then takes the stat + read route).
function fastSignature(abs) {
  let fd
  // Look before opening: opening a FIFO, socket or device blocks until something writes to it, so only regular files are opened.
  try {
    if (!statSync(abs).isFile()) return null
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'gone' : undefined
  }
  try {
    fd = openSync(abs, 'r')
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'gone' : undefined
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile()) return null
    let sig = `${st.size}:${Math.floor(st.mtimeMs)}`
    if (st.size <= HASH_LIMIT) {
      try {
        const buf = Buffer.allocUnsafe(st.size)
        let n = 0
        while (n < st.size) {
          const r = readSync(fd, buf, n, st.size - n, n)
          if (!r) break
          n += r
        }
        sig += `:${createHash('sha256').update(buf.subarray(0, n)).digest('hex').slice(0, 24)}`
      } catch {
        /* unreadable now: the size and time still stand */
      }
    }
    return sig
  } catch {
    return undefined
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* nothing to close */
    }
  }
}

// path -> signature. `allow` is a list of globs the project's own tooling may write (config "allowWrites"); those are left out.
export function snapshotTree(repoRoot, { allow = [], list = gitFileList, read = readFileSync, stat = statSync } = {}) {
  const files = list(repoRoot)
  if (!files) return null
  const allowed = allow.map(globToRegExp)
  const snap = new Map()
  const fast = read === readFileSync && stat === statSync // the real filesystem: one open per file instead of a stat then a second open (about twice as fast)
  for (const rel of files) {
    if (allowed.some((r) => r.test(rel))) continue
    if (fast) {
      const sig = fastSignature(join(repoRoot, rel))
      if (sig !== undefined) {
        if (sig !== null) snap.set(rel, sig)
        continue
      }
    }
    let st
    try {
      st = stat(join(repoRoot, rel))
    } catch {
      snap.set(rel, 'gone')
      continue
    }
    if (!st.isFile()) continue
    let sig = `${st.size}:${Math.floor(st.mtimeMs)}`
    if (st.size <= HASH_LIMIT) {
      try {
        sig += `:${createHash('sha256').update(read(join(repoRoot, rel))).digest('hex').slice(0, 24)}`
      } catch {
        /* unreadable now: the size and time still stand */
      }
    }
    snap.set(rel, sig)
  }
  return snap
}

// What differs between two snapshots: { changed, added, removed } (arrays of repo-relative paths, sorted).
export function diffSnapshots(before, after) {
  const changed = []
  const added = []
  const removed = []
  for (const [p, sig] of before) {
    if (!after.has(p)) removed.push(p)
    else if (after.get(p) !== sig) changed.push(p)
  }
  for (const p of after.keys()) if (!before.has(p)) added.push(p)
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() }
}

// A digest of the whole snapshot: the same digest means the same project. Used as the result-cache key (lib/resultcache.mjs).
export function snapshotDigest(snap) {
  const h = createHash('sha256')
  for (const p of [...snap.keys()].sort()) h.update(`${p}\0${snap.get(p)}\n`)
  return h.digest('hex')
}

// The text that goes in the report: the first few paths of each kind and the total.
export function violationText(diff) {
  const total = diff.changed.length + diff.added.length + diff.removed.length
  const part = (label, list) => (list.length ? `${label} ${list.slice(0, MAX_LISTED).join(', ')}${list.length > MAX_LISTED ? ` and ${list.length - MAX_LISTED} more` : ''}` : null)
  const parts = [part('changed:', diff.changed), part('added:', diff.added), part('removed:', diff.removed)].filter(Boolean)
  return `${total} file(s) in the project were written during the run. ${parts.join('; ')}. A check must work on a copy: find the check that wrote them (its log names the path), then fix it or list the path under "allowWrites" in meerkat.config.json if the write is intended.`
}
