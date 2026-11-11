// Shared worktree logic: lists a repository's git worktrees with merge state, dirtiness, age and size, and removes finished ones safely.
// Used by tools/worktrees.mjs (the worktree doctor) and by `meerkat worktrees` (lib/claims.mjs).
// Every git call has a 30 second timeout. "Merged" uses the local origin/main ref (run git fetch first).
import { spawnSync } from 'node:child_process'
import { readdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TIMEOUT = 30000
export let progress = (m) => process.stderr.write(`... ${m}\n`)
export const setProgress = (fn) => { progress = fn }

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { ok: false, out: '', err: r.error.code === 'ETIMEDOUT' ? `timed out after ${TIMEOUT / 1000}s: git ${args.join(' ')}` : String(r.error) }
  return { ok: r.status === 0, out: r.stdout.trim(), err: (r.stderr || '').trim(), status: r.status }
}

export const norm = (p) => { const r = resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r }

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      if (e.name === 'node_modules') continue
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) stack.push(p)
      else { try { total += lstatSync(p).size } catch { /* gone */ } }
    }
  }
  return total
}
export const human = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`)

export function gather(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) throw new Error(`not a git repo: ${top.err}`)
  progress('listing worktrees')
  const wl = git(top.out, ['worktree', 'list', '--porcelain'])
  if (!wl.ok) throw new Error(wl.err)
  const items = []
  for (const block of wl.out.split(/\r?\n\r?\n/)) {
    const w = {}
    for (const line of block.split(/\r?\n/)) {
      const [k, ...v] = line.split(' ')
      w[k] = v.join(' ') || true
    }
    if (!w.worktree) continue
    items.push({ path: w.worktree, head: w.HEAD, branch: typeof w.branch === 'string' ? w.branch.replace(/^refs\/heads\//, '') : null, prunable: !!w.prunable })
  }
  const hasMain = git(top.out, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']).ok
  items.forEach((it, idx) => {
    it.main = idx === 0
    progress(`checking ${it.path}`)
    if (it.prunable) { it.missing = true; it.merged = false; it.dirty = 0; it.ageDays = null; it.size = 0; return }
    const ref = it.branch || it.head
    it.merged = hasMain ? git(top.out, ['merge-base', '--is-ancestor', ref, 'origin/main']).ok : false
    it.onOrigin = it.branch ? git(top.out, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${it.branch}`]).ok : false
    const hadUpstream = it.branch ? git(top.out, ['config', '--get', `branch.${it.branch}.remote`]).ok : false
    it.goneFromOrigin = !!it.branch && hadUpstream && !it.onOrigin
    const st = git(it.path, ['status', '--porcelain'])
    it.dirty = st.ok ? st.out.split(/\r?\n/).filter(Boolean).length : -1
    const ct = git(it.path, ['log', '-1', '--format=%ct'])
    it.ageDays = ct.ok && ct.out ? Math.floor((Date.now() / 1000 - Number(ct.out)) / 86400) : null
    progress(`measuring size of ${it.path}`)
    it.size = dirSize(it.path)
  })
  return { top: top.out, items, hasMain }
}

export const isClean = (w) => w.dirty === 0
export const candidates = (items) => items.filter((w) => !w.main && !w.missing && isClean(w) && (w.merged || w.goneFromOrigin))
export const mergedClean = (items) => items.filter((w) => !w.main && !w.missing && isClean(w) && w.merged)

// Why a worktree cannot be closed, or null when it can. Never closes the main checkout, a dirty one or an unmerged one.
export function closeProblem(w) {
  if (!w) return 'not a worktree of this repository'
  if (w.main) return 'it is the main checkout'
  if (w.missing) return 'its folder is missing (run git worktree prune)'
  if (w.dirty !== 0) return w.dirty < 0 ? 'could not read its status' : `${w.dirty} uncommitted change(s)`
  if (!(w.merged || w.goneFromOrigin)) return `branch ${w.branch || '(detached)'} is not merged into origin/main`
  return null
}

export const removeWorktree = (top, path) => git(top, ['worktree', 'remove', path])
