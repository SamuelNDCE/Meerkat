// Cargo.lock comparison for the rust pack: which workspace crates have a changed resolved dependency set. A small reader of the lock format
// (the [[package]] tables), not a TOML parser. Every failure throws an Error whose message is the reason; the caller then runs the whole workspace.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseRef } from './changed.mjs'

const FIELD = Object.fromEntries(['name', 'version', 'source', 'checksum'].map((k) => [k, new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm')]))
// -> Map<key, { name, version, sig, deps: [keys] }>, key = "name version (source)" (source only when the lock has one).
export function parseLock(text) {
  if (typeof text !== 'string' || !/^\[\[package\]\]/m.test(text)) throw new Error('it has no [[package]] entries')
  const raw = []
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    // Stop at the next top-level table such as [metadata] or [[patch.unused]].
    const body = block.split(/^\[/m)[0]
    const field = (k) => FIELD[k].exec(body)?.[1] ?? ''
    const name = field('name')
    const version = field('version')
    if (!name || !version) throw new Error('a package entry has no name or version')
    const depBlock = /^dependencies\s*=\s*\[([\s\S]*?)^\]/m.exec(body)
    const deps = depBlock ? [...depBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []
    raw.push({ name, version, source: field('source'), checksum: field('checksum'), deps })
  }
  const keyOf = (p) => `${p.name} ${p.version}${p.source ? ` (${p.source})` : ''}`
  // A dependency reference is "name", "name version" or "name version (source)".
  const resolve = (ref) => {
    const m = /^(\S+)(?: (\S+))?(?: \((.+)\))?$/.exec(ref)
    if (!m) return []
    return raw.filter((p) => p.name === m[1] && (!m[2] || p.version === m[2]) && (!m[3] || p.source === m[3])).map(keyOf)
  }
  const out = new Map()
  for (const p of raw) {
    const deps = [...new Set(p.deps.flatMap(resolve))].sort()
    out.set(keyOf(p), { name: p.name, version: p.version, deps, sig: JSON.stringify([p.version, p.source, p.checksum, deps]) })
  }
  return out
}

// The names of the given workspace crates whose own entry, or any entry they depend on (transitively, in the new lock), is new or different.
// A crate with no entry in the new lock counts as affected. Throws when either lock cannot be read.
export function affectedByLock(oldText, newText, crateNames) {
  let oldLock
  let newLock
  try { oldLock = parseLock(oldText) } catch (e) { throw new Error(`the old Cargo.lock cannot be read (${e.message})`) }
  try { newLock = parseLock(newText) } catch (e) { throw new Error(`the new Cargo.lock cannot be read (${e.message})`) }
  const changed = new Set()
  for (const [k, v] of newLock) if (oldLock.get(k)?.sig !== v.sig) changed.add(k)
  const affected = []
  for (const name of crateNames) {
    const starts = [...newLock].filter(([, v]) => v.name === name).map(([k]) => k)
    if (!starts.length) { affected.push(name); continue }
    const seen = new Set()
    const stack = [...starts]
    while (stack.length) {
      const k = stack.pop()
      if (seen.has(k)) continue
      seen.add(k)
      stack.push(...(newLock.get(k)?.deps ?? []))
    }
    if ([...seen].some((k) => changed.has(k))) affected.push(name)
  }
  return { affected: affected.sort(), changedEntries: changed.size }
}

// The old lock is the one at the merge base of the base ref and HEAD, the new one is the working copy. Throws with the reason when either is missing.
export function readLocks(repoRoot, env = process.env) {
  const base = baseRef(repoRoot, env)
  if (!base) throw new Error('the old Cargo.lock cannot be read (no base branch to compare with)')
  const git = (args) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const mb = git(['merge-base', base, 'HEAD'])
  const rev = mb.status === 0 && mb.stdout.trim() ? mb.stdout.trim() : base
  const old = git(['show', `${rev}:Cargo.lock`])
  if (old.status !== 0) throw new Error(`the old Cargo.lock cannot be read (git show ${base}:Cargo.lock failed)`)
  let current
  try { current = readFileSync(join(repoRoot, 'Cargo.lock'), 'utf8') } catch { throw new Error('the new Cargo.lock cannot be read (the file is missing)') }
  return { oldText: old.stdout, newText: current }
}
