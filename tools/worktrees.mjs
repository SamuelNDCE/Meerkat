// Worktree doctor: lists the repo's git worktrees with merge state, dirtiness, age and size, and closes finished ones safely.
//   node tools/worktrees.mjs list
//   node tools/worktrees.mjs close-candidates      clean worktrees whose branch is merged into origin/main (or was deleted on origin)
//   node tools/worktrees.mjs close --yes <path>... remove the named worktrees (never --force; refuses dirty ones and the main checkout)
//   node tools/worktrees.mjs remind                exit 0 when nothing is clean and merged, else one line per candidate
// Every git call has a 30 second timeout. Progress lines go to stderr. "Merged" uses the local origin/main ref (run git fetch first).
import { spawnSync } from 'node:child_process'
import { readdirSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TIMEOUT = 30000
const progress = (m) => process.stderr.write(`... ${m}\n`)

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) return { ok: false, out: '', err: r.error.code === 'ETIMEDOUT' ? `timed out after ${TIMEOUT / 1000}s: git ${args.join(' ')}` : String(r.error) }
  return { ok: r.status === 0, out: r.stdout.trim(), err: (r.stderr || '').trim(), status: r.status }
}

const norm = (p) => { const r = resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r }

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
const human = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`)

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

const isClean = (w) => w.dirty === 0
const candidates = (items) => items.filter((w) => !w.main && !w.missing && isClean(w) && (w.merged || w.goneFromOrigin))
const mergedClean = (items) => items.filter((w) => !w.main && !w.missing && isClean(w) && w.merged)

function line(w) {
  const age = w.ageDays === null ? 'age ?' : `${w.ageDays}d`
  return [w.path, w.branch || '(detached)', w.main ? 'MAIN' : w.missing ? 'missing' : w.merged ? 'merged' : 'unmerged',
    w.dirty < 0 ? 'changes ?' : `${w.dirty} uncommitted`, age, human(w.size || 0)].join('  |  ')
}
const byAge = (a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1)

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const usage = () => { console.error('usage: node tools/worktrees.mjs list | close-candidates | close --yes <path>... | remind'); process.exit(2) }
  if (!['list', 'close-candidates', 'close', 'remind'].includes(cmd)) usage()
  let data
  try { data = gather(process.cwd()) } catch (e) { console.error(e.message); process.exit(1) }
  const { items, hasMain } = data
  if (!hasMain) console.error('warning: no origin/main ref found; nothing counts as merged')

  if (cmd === 'list') { for (const w of [...items].sort(byAge)) console.log(line(w)); return }

  if (cmd === 'close-candidates') {
    const c = candidates(items).sort(byAge)
    if (!c.length) console.log('no close candidates')
    for (const w of c) console.log(`${w.path}  |  ${w.branch || '(detached)'}  |  ${w.merged ? 'merged into origin/main' : 'branch gone from origin'}  |  ${w.ageDays}d  |  ${human(w.size)}`)
    return
  }

  if (cmd === 'remind') {
    for (const w of mergedClean(items).sort(byAge)) console.log(`worktree ${w.path} is clean and merged; close with: node tools/worktrees.mjs close --yes ${w.path}`)
    return
  }

  // close
  const yes = rest.includes('--yes')
  const paths = rest.filter((a) => a !== '--yes')
  if (!paths.length) usage()
  if (!yes) { console.log('nothing done: add --yes to remove the named worktrees'); return }
  const removed = []
  const kept = []
  for (const p of paths) {
    const w = items.find((i) => norm(i.path) === norm(p))
    if (!w) { kept.push([p, 'not a worktree of this repo']); continue }
    if (w.main) { kept.push([p, 'main checkout']); continue }
    if (w.dirty !== 0) { kept.push([p, w.dirty < 0 ? 'could not read its status' : `${w.dirty} uncommitted change(s)`]); continue }
    progress(`removing ${w.path}`)
    const r = git(data.top, ['worktree', 'remove', w.path])
    if (r.ok) removed.push(w.path)
    else kept.push([p, r.err || 'git worktree remove refused'])
  }
  for (const p of removed) console.log(`removed: ${p}`)
  for (const [p, why] of kept) console.log(`kept: ${p} (${why})`)
  if (kept.length) process.exitCode = 1
}

main()
