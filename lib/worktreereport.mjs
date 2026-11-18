// `meerkat worktrees report` and `meerkat worktrees prune`: say which worktrees are safe to remove, and remove only those.
//   meerkat worktrees report [--root <dir>] [--base <branch>] [--json]
//   meerkat worktrees prune [--root <dir>] [--base <branch>] [--dry-run] [--yes] [--json]
// Verdicts: MAIN (the main checkout, never touched), PRUNABLE (folder missing), CLAIMED (live claim), DIRTY (uncommitted changes),
// CLEAN-MERGED (clean and its head is in the integration branch), CLEAN-UNMERGED (clean, but may hold work). Only PRUNABLE and CLEAN-MERGED are ever removed, and only with --yes.
// Unlike `worktrees close`, this never measures folder sizes, so it stays quick on a machine with many worktrees.
import { resolve } from 'node:path'
import { git } from './worktrees.mjs'
import { locate, readClaims, claimProblem } from './claims.mjs'

export const DEFAULT_BASE = 'roadmap-orchestration'
export const REMOVABLE = new Set(['CLEAN-MERGED', 'PRUNABLE'])

function listWorktrees(top) {
  const wl = git(top, ['worktree', 'list', '--porcelain'])
  if (!wl.ok) throw new Error(wl.err || 'git worktree list failed')
  const items = []
  for (const block of wl.out.split(/\r?\n\r?\n/)) {
    const w = {}
    for (const line of block.split(/\r?\n/)) {
      const [k, ...v] = line.split(' ')
      w[k] = v.join(' ') || true
    }
    if (!w.worktree) continue
    items.push({ path: w.worktree, head: typeof w.HEAD === 'string' ? w.HEAD : '', branch: typeof w.branch === 'string' ? w.branch.replace(/^refs\/heads\//, '') : null, prunable: !!w.prunable })
  }
  return items
}

// The ref to compare against: the local branch first, then origin/<branch>.
function integrationRef(top, base) {
  for (const ref of [`refs/heads/${base}`, `refs/remotes/origin/${base}`]) {
    if (git(top, ['rev-parse', '--verify', '--quiet', ref]).ok) return ref
  }
  return null
}

export function classify(cwd, { base = DEFAULT_BASE, now = Date.now() } = {}) {
  const loc = locate(cwd)
  if (loc.error) throw new Error(loc.error)
  const ref = integrationRef(loc.top, base)
  if (!ref) throw new Error(`integration branch "${base}" not found (pass --base <branch>)`)
  const claims = readClaims(cwd, now)
  const rows = listWorktrees(loc.top).map((w, idx) => {
    const row = { path: w.path, branch: w.branch, head: w.head.slice(0, 7), verdict: '', reason: '' }
    if (idx === 0) return { ...row, verdict: 'MAIN', reason: 'main checkout' }
    if (w.prunable) return { ...row, verdict: 'PRUNABLE', reason: 'folder is missing' }
    const blocked = claimProblem(w.path, claims.live, null, now)
    if (blocked) return { ...row, verdict: 'CLAIMED', reason: blocked }
    const st = git(w.path, ['status', '--porcelain'])
    if (!st.ok) return { ...row, verdict: 'DIRTY', reason: 'could not read its status, so it is kept' }
    const n = st.out.split(/\r?\n/).filter(Boolean).length
    if (n > 0) return { ...row, verdict: 'DIRTY', reason: `${n} uncommitted change(s)` }
    const merged = git(loc.top, ['merge-base', '--is-ancestor', w.head || 'HEAD', ref]).ok
    return merged
      ? { ...row, verdict: 'CLEAN-MERGED', reason: `head is in ${base}` }
      : { ...row, verdict: 'CLEAN-UNMERGED', reason: `head is not in ${base}; it may hold work` }
  })
  return { top: loc.top, mainPath: rows[0].path, ref, base, claims, rows }
}

const tally = (rows) => {
  const t = {}
  for (const r of rows) t[r.verdict] = (t[r.verdict] ?? 0) + 1
  return t
}
const summary = (rows) => `${rows.length} worktrees: ${Object.entries(tally(rows)).map(([k, v]) => `${v} ${k}`).join(', ')}`

function parseArgs(args) {
  const flags = {}
  const words = []
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (!a.startsWith('--')) { words.push(a); continue }
    const name = a.slice(2)
    if (name === 'root' || name === 'base') {
      const v = args[i + 1]
      if (v === undefined || String(v).startsWith('--')) return { error: `--${name} needs a value` }
      flags[name] = String(v)
      i++
    } else if (['json', 'yes', 'dry-run'].includes(name)) flags[name] = true
    else return { error: `unknown option ${a.replace(/[\u0000-\u001f]/g, '?')}` }
  }
  return { flags, words }
}

export function runWorktreeReport(sub, args, { cwd = process.cwd(), out = console.log, err = console.error, now = Date.now() } = {}) {
  const usage = 'usage: meerkat worktrees report [--root <dir>] [--base <branch>] [--json] | meerkat worktrees prune [--dry-run] [--yes] [--json]'
  const p = parseArgs(args)
  if (p.error || p.words.length) { err(`meerkat worktrees ${sub}: ${p.error ?? `unexpected argument ${p.words[0]}`}\n${usage}`); return 2 }
  const dir = p.flags.root ? resolve(cwd, p.flags.root) : cwd
  let view
  try { view = classify(dir, { base: p.flags.base || DEFAULT_BASE, now }) } catch (e) { err(`meerkat worktrees ${sub}: ${e.message}`); return 1 }
  const { rows } = view

  if (sub === 'report') {
    if (p.flags.json) { out(JSON.stringify({ base: view.base, summary: tally(rows), worktrees: rows }, null, 2)); return 0 }
    out(`${summary(rows)} (compared with ${view.base})`)
    for (const r of rows) out(`${r.path}  |  ${r.branch ?? '(detached)'}  |  ${r.head}  |  ${r.verdict}`)
    return 0
  }

  const targets = rows.filter((r) => REMOVABLE.has(r.verdict))
  const really = !!p.flags.yes && !p.flags['dry-run']
  const done = []
  const failed = []
  if (really) {
    for (const r of targets) {
      if (r.verdict === 'PRUNABLE') continue
      // Re-check the claim right before removing; a claim made since the scan wins.
      const blocked = claimProblem(r.path, readClaims(dir, Date.now()).live, null, Date.now())
      if (blocked) { failed.push({ path: r.path, why: blocked }); continue }
      const res = git(view.mainPath, ['worktree', 'remove', r.path])
      if (res.ok) done.push(r.path)
      else failed.push({ path: r.path, why: res.err || 'git worktree remove failed' })
    }
    const missing = targets.filter((r) => r.verdict === 'PRUNABLE')
    if (missing.length) {
      const res = git(view.mainPath, ['worktree', 'prune'])
      if (res.ok) done.push(...missing.map((r) => r.path))
      else failed.push({ path: '(missing folders)', why: res.err || 'git worktree prune failed' })
    }
  }
  if (p.flags.json) {
    out(JSON.stringify({ base: view.base, dryRun: !really, candidates: targets.map((r) => ({ path: r.path, verdict: r.verdict })), removed: done, failed }, null, 2))
    return failed.length ? 1 : 0
  }
  out(`${summary(rows)} (compared with ${view.base})`)
  if (!really) {
    for (const r of targets) out(`would remove ${r.path}  (${r.verdict})`)
    out(targets.length ? `${targets.length} removable. Nothing was removed; add --yes to remove them` : 'nothing to remove')
    return 0
  }
  for (const d of done) out(`removed ${d}`)
  for (const f of failed) err(`kept ${f.path}: ${f.why}`)
  out(`removed ${done.length}, kept ${failed.length} that failed`)
  return failed.length ? 1 : 0
}
