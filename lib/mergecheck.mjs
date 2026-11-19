// `meerkat merge-check <branch>... [--base <ref>] [--json]`: CONFLICT or CLEAN for each branch against the base, from `git merge-tree --write-tree`.
// No checkout, no gate run, no ref or branch is created (merge-tree only writes objects). A CLEAN result carries the tree id the merge would have,
// so a later stage can compare trees. Exit 0 every branch CLEAN, 1 at least one CONFLICT, 2 a usage problem or a ref that does not exist.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const USAGE = 'usage: meerkat merge-check <branch>... [--base <ref>] [--json]'
const MIN_GIT = [2, 38]
const GIT_TIMEOUT_MS = 30000

// One git call with a timeout. A timeout comes back as { timedOut: true }.
function git(dir, args, timeout = GIT_TIMEOUT_MS) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  const timedOut = r.error?.code === 'ETIMEDOUT'
  return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error && !timedOut ? String(r.error.message) : ''), timedOut }
}

export function parseGitVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

export function gitIsNewEnough(v) {
  return !!v && (v[0] > MIN_GIT[0] || (v[0] === MIN_GIT[0] && v[1] >= MIN_GIT[1]))
}

// The tree id and the conflicted paths from the output of `git merge-tree --write-tree --no-messages`.
// Line 1 is the tree id. On a conflict, the conflicted file lines follow ("<mode> <object> <stage>\t<path>"), then a blank line.
export function parseMergeTree(stdout) {
  const lines = String(stdout).split(/\r?\n/)
  const tree = (lines[0] ?? '').trim()
  const paths = []
  for (const l of lines.slice(1)) {
    if (l === '') break
    const tab = l.indexOf('\t')
    if (tab > 0 && !paths.includes(l.slice(tab + 1))) paths.push(l.slice(tab + 1))
  }
  return { tree, paths }
}

function parseArgs(argv) {
  const o = { branches: [], base: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') o.json = true
    else if (a === '--base') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) return { error: '--base needs a ref' }
      o.base = argv[++i]
    } else if (a.startsWith('--base=')) o.base = a.slice(7)
    else if (a.startsWith('-')) return { error: `unknown option ${a.slice(0, 60)}` }
    else o.branches.push(a)
  }
  if (!o.branches.length) return { error: 'give at least one branch' }
  return o
}

const commitOf = (dir, ref) => {
  const r = git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return r.status === 0 ? r.stdout.trim() : null
}

export function runMergeCheck(argv, { cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const o = parseArgs(argv)
  if (o.error) return (err(`merge-check: ${o.error}. ${USAGE}`), 2)
  const dir = resolve(cwd)

  const ver = git(dir, ['--version'])
  const v = parseGitVersion(ver.stdout)
  if (!gitIsNewEnough(v)) {
    err(`merge-check: needs git ${MIN_GIT.join('.')} or newer for merge-tree --write-tree; found ${ver.stdout.trim() || 'no git'}`)
    return 2
  }
  if (git(dir, ['rev-parse', '--git-dir']).status !== 0) return (err('merge-check: this folder is not a git repository'), 2)

  let base = o.base
  if (!base) base = ['main', 'master'].find((b) => commitOf(dir, b)) ?? null
  if (!base) return (err('merge-check: no base branch (main or master) found; give one with --base <ref>'), 2)
  const baseSha = commitOf(dir, base)
  if (!baseSha) return (err(`merge-check: the base ref ${base} does not exist`), 2)
  for (const b of o.branches) if (!commitOf(dir, b)) return (err(`merge-check: the ref ${b} does not exist`), 2)

  const results = []
  for (const b of o.branches) {
    const sha = commitOf(dir, b)
    const r = git(dir, ['merge-tree', '--write-tree', '--no-messages', baseSha, sha])
    if (r.timedOut) return (err(`merge-check: git merge-tree timed out for ${b}`), 2)
    if (r.status === 0) results.push({ branch: b, sha, verdict: 'CLEAN', tree: parseMergeTree(r.stdout).tree })
    else if (r.status === 1) results.push({ branch: b, sha, verdict: 'CONFLICT', paths: parseMergeTree(r.stdout).paths })
    else return (err(`merge-check: git merge-tree failed for ${b}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`), 2)
  }

  const code = results.some((r) => r.verdict === 'CONFLICT') ? 1 : 0
  if (o.json) {
    out(JSON.stringify({ schema: 1, base, baseSha, branches: results, exitCode: code }, null, 2))
    return code
  }
  for (const r of results) {
    if (r.verdict === 'CLEAN') out(`${r.branch}: CLEAN (tree ${r.tree})`)
    else out(`${r.branch}: CONFLICT in ${r.paths.length} file(s): ${r.paths.join(', ')}`)
  }
  // Recommendation (29an): when two or more branches are clean, gate them together once instead of one gate each. Only the batch can say
  // whether the set passes, so this line names the command and says the set is not yet proven.
  const clean = results.filter((r) => r.verdict === 'CLEAN').map((r) => r.branch)
  const conflicts = results.filter((r) => r.verdict === 'CONFLICT').map((r) => r.branch)
  if (clean.length >= 2) {
    out(`next: ${clean.length} clean branches. Gate them together once: meerkat batch --base ${base} --app . --split ${clean.join(' ')}`)
    out('      (CLEAN is per branch against the base, not for the set; the batch judges the set)')
  }
  if (conflicts.length) out(`excluded: ${conflicts.length} conflicting branch(es) (${conflicts.join(', ')}): fix or rebase them first`)
  return code
}

// Batch pre-triage: which of `items` ([{ branch, sha }]) conflict textually with the base, so the batch can drop them before any gate run.
// Same git call as `meerkat merge-check` (merge-tree --write-tree), one per branch, no checkout. Returns { available, note, clean, conflicts: [{ item, paths }] }.
// With git older than 2.38, or any merge-tree call that does not answer 0 or 1 (timeout, error), nothing is dropped: that branch stays in `clean` and the
// batch behaves as before. `available: false` means no triage ran at all, and `note` says why (the batch prints it).
export function triageAgainstBase(root, baseSha, items, { versionText = null } = {}) {
  const ver = versionText === null ? git(root, ['--version']) : { stdout: versionText }
  if (!gitIsNewEnough(parseGitVersion(ver.stdout))) {
    return { available: false, note: `pre-triage skipped: git ${ver.stdout.trim().replace(/^git version /, '') || '(not found)'} is older than ${MIN_GIT.join('.')} (no merge-tree --write-tree), so no branch was dropped before the gate`, clean: [...items], conflicts: [] }
  }
  const clean = []
  const conflicts = []
  for (const it of items) {
    const r = git(root, ['merge-tree', '--write-tree', '--no-messages', baseSha, it.sha])
    if (!r.timedOut && r.status === 1) conflicts.push({ item: it, paths: parseMergeTree(r.stdout).paths })
    else clean.push(it) // 0 = clean; anything else = unknown, so the real merge decides as before
  }
  return { available: true, note: null, clean, conflicts }
}

// The reason a pre-triaged branch is left out of a batch.
export function triageReason(paths) {
  const shown = paths.slice(0, 3).join(', ')
  return `conflicts with base${paths.length ? ` (${shown}${paths.length > 3 ? ` and ${paths.length - 3} more` : ''})` : ''}; no gate run spent on it`
}
