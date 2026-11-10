// Worktree doctor: lists the repo's git worktrees with merge state, dirtiness, age and size, and closes finished ones safely.
//   node tools/worktrees.mjs list
//   node tools/worktrees.mjs close-candidates      clean worktrees whose branch is merged into origin/main (or was deleted on origin)
//   node tools/worktrees.mjs close --yes <path>... remove the named worktrees (never --force; refuses dirty ones and the main checkout)
//   node tools/worktrees.mjs remind                exit 0 when nothing is clean and merged, else one line per candidate
// Every git call has a 30 second timeout. Progress lines go to stderr. "Merged" uses the local origin/main ref (run git fetch first).
import { git, norm, human, gather, candidates, mergedClean, progress } from '../lib/worktrees.mjs'

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
