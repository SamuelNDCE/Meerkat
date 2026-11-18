// `meerkat worktrees new <path> --branch <name> --for "<purpose>" [--by <owner>] [--base <branch>]`: create a git worktree and record who made it and why.
// The record lives in the git common directory (meerkat-worktree-owners.json), shared by every worktree of the repository and never committed.
// `meerkat worktrees report` and `meerkat space` read it; a worktree with no record shows as "unknown owner".
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { git, norm } from './worktrees.mjs'
import { locate, withLock } from './claims.mjs'
import { DEFAULT_BASE, integrationRef } from './worktreereport.mjs'

export const OWNERS_FILE = 'meerkat-worktree-owners.json'

// { [normalized worktree path]: { path, branch, owner, purpose, created } }. Never throws: no repo or a damaged file reads as empty.
export function readOwners(cwd) {
  const loc = locate(cwd)
  if (loc.error) return {}
  try {
    const doc = JSON.parse(readFileSync(join(loc.gitDir, OWNERS_FILE), 'utf8'))
    return doc && typeof doc.worktrees === 'object' && doc.worktrees ? doc.worktrees : {}
  } catch {
    return {}
  }
}
export const ownerOf = (owners, path) => owners[norm(path)] ?? null

function writeOwner(cwd, rec) {
  const loc = locate(cwd)
  const file = join(loc.gitDir, OWNERS_FILE)
  withLock(file, () => {
    const worktrees = readOwners(cwd)
    worktrees[norm(rec.path)] = rec
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ schema: 1, worktrees }, null, 2)}\n`)
    renameSync(tmp, file)
  })
}

// "who and why" for a report line.
export const ownerText = (rec) => (rec ? `${rec.owner}: ${rec.purpose}` : 'unknown owner')

function parse(args) {
  const flags = {}
  const words = []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (!a.startsWith('--')) { words.push(a); continue }
    const name = a.slice(2)
    if (['branch', 'for', 'by', 'base', 'root'].includes(name)) {
      const v = args[i + 1]
      if (v === undefined || String(v).startsWith('--')) return { error: `--${name} needs a value` }
      flags[name] = String(v)
      i++
    } else return { error: `unknown option ${a.replace(/[\u0000-\u001f]/g, '?')}` }
  }
  return { flags, words }
}

export function runWorktreeNew(args, { cwd = process.cwd(), env = process.env, out = console.log, err = console.error, now = Date.now() } = {}) {
  const usage = 'usage: meerkat worktrees new <path> --branch <name> --for "<purpose>" [--by <owner>] [--base <branch>]'
  const p = parse(args)
  if (p.error || p.words.length !== 1) { err(`meerkat worktrees new: ${p.error ?? 'give exactly one folder path'}\n${usage}`); return 2 }
  if (!p.flags.branch) { err(`meerkat worktrees new: --branch is required\n${usage}`); return 2 }
  if (!p.flags.for || !p.flags.for.trim()) { err(`meerkat worktrees new: --for "<purpose>" is required, so a later cleanup can tell what this worktree was for\n${usage}`); return 2 }
  const dir = p.flags.root ? resolve(cwd, p.flags.root) : cwd
  const loc = locate(dir)
  if (loc.error) { err(`meerkat worktrees new: ${loc.error}`); return 1 }
  const target = resolve(cwd, p.words[0])
  if (existsSync(target)) { err(`meerkat worktrees new: ${target} already exists; not touching it`); return 1 }
  const branch = p.flags.branch
  if (!git(loc.top, ['check-ref-format', '--branch', branch]).ok) { err(`meerkat worktrees new: "${branch}" is not a valid branch name`); return 1 }
  if (git(loc.top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) { err(`meerkat worktrees new: branch ${branch} already exists; choose a new branch name`); return 1 }
  const base = p.flags.base || DEFAULT_BASE
  const ref = integrationRef(loc.top, base)
  if (!ref) { err(`meerkat worktrees new: base branch "${base}" not found (pass --base <branch>)`); return 1 }
  const made = git(loc.top, ['worktree', 'add', '-b', branch, target, ref])
  if (!made.ok) { err(`meerkat worktrees new: git refused: ${made.err || 'git worktree add failed'}`); return 1 }
  const owner = p.flags.by || env.MEERKAT_CLAIM_BY || (() => { try { return userInfo().username } catch { return 'unknown' } })()
  try {
    writeOwner(loc.top, { path: target.split(String.fromCharCode(92)).join('/'), branch, owner, purpose: p.flags.for.trim(), created: new Date(now).toISOString() })
  } catch (e) {
    err(`meerkat worktrees new: the worktree was created but its owner record could not be written: ${e.message}`)
    return 1
  }
  out(`created worktree ${target} (branch ${branch}, from ${base}) for ${owner}: ${p.flags.for.trim()}`)
  return 0
}
