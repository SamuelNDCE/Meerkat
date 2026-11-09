// Per-branch memory: a small JSON record per branch in the Meerkat data folder.
//   meerkat memory-branch [<branch>] [--note <text>] [--show] [--app <folder>] [--json]
// The record holds the last verdict (line, commit, time), the open findings count and the notes a person or an AI wrote ("tests pass as of abc123").
// `verdict` and `top` record their result here by themselves (recordBranchResult): one small write, no extra scan.
// The file lives under <data folder>/branches/<project>/<branch>.json, where the data folder is MEERKAT_LOG_DIR or ~/.meerkat, like dismissals and baselines.
// Writes are a locked read-modify-write with an atomic rename (lib/lockfile.mjs), so two terminals cannot tear the file and a note is never lost to a verdict write.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { projectSlug } from './findingshistory.mjs'
import { writeFileAtomic, withFileLock } from './lockfile.mjs'
import { appDirOf, repoRootOf } from './paths.mjs'

export const BRANCH_SCHEMA = 1
export const MAX_NOTES = 50
export const MAX_NOTE_CHARS = 2000

export const branchDataHome = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'branches') : join(home, '.meerkat', 'branches'))

// feat/a and feat_a must not share a file, so the readable part is followed by a short hash of the exact name.
const branchSlug = (branch) => `${String(branch).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60)}-${createHash('sha256').update(String(branch)).digest('hex').slice(0, 8)}`
export const branchFile = (env, repoRoot, branch, home = homedir()) => join(branchDataHome(env, home), projectSlug(repoRoot), `${branchSlug(branch)}.json`).split('\\').join('/')

const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })

// The branch a folder is on, or 'HEAD' text-free fallback "(detached <sha>)" when none; null outside git.
export function currentBranch(dir) {
  const r = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (r.status !== 0) return null
  const name = String(r.stdout).trim()
  if (name && name !== 'HEAD') return name
  const sha = git(dir, ['rev-parse', '--short', 'HEAD'])
  return `(detached ${String(sha.stdout).trim() || 'unknown'})`
}

// { record } | { record: null } | { error }. A damaged file is reported, never silently replaced by an empty record (the next write moves it aside).
export function readBranchRecord(file) {
  if (!existsSync(file)) return { record: null }
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    if (!doc || doc.schemaVersion !== BRANCH_SCHEMA || typeof doc.branch !== 'string') return { error: `the branch memory file ${file} is not one this version wrote` }
    return { record: { ...doc, notes: Array.isArray(doc.notes) ? doc.notes.filter((n) => n && typeof n.text === 'string') : [] } }
  } catch (e) {
    return { error: `the branch memory file ${file} could not be read (${String(e?.message ?? e).split('\n')[0].slice(0, 80)})` }
  }
}

const fresh = (branch, repoRoot) => ({ schemaVersion: BRANCH_SCHEMA, branch, project: resolve(repoRoot).replace(/\\/g, '/'), verdict: null, openFindings: null, notes: [], updated: null })

// One locked read-modify-write. A damaged file is kept aside as <file>.damaged-<time> and a new record started, and the caller is told.
function update(file, branch, repoRoot, change) {
  mkdirSync(join(file, '..'), { recursive: true })
  let moved = null
  const record = withFileLock(file, () => {
    let cur = readBranchRecord(file)
    if (cur.error) {
      moved = `${file}.damaged-${Date.now()}`
      try {
        writeFileAtomic(moved, readFileSync(file, 'utf8'))
      } catch {
        moved = null
      }
      cur = { record: null }
    }
    const next = change(cur.record ?? fresh(branch, repoRoot))
    next.updated = new Date().toISOString()
    writeFileAtomic(file, JSON.stringify(next, null, 2))
    return next
  })
  return { record, moved }
}

// Called by verdict and top with the result they already have. Never throws: a failed write is a returned reason the caller prints.
export function recordBranchResult({ env = process.env, repoRoot, source, line, exit, commit, blocking, preExisting }) {
  try {
    const branch = currentBranch(repoRoot)
    if (!branch) return { ok: false, reason: 'not a git branch' }
    const file = branchFile(env, repoRoot, branch)
    update(file, branch, repoRoot, (r) => {
      r.verdict = { line, exit, commit, time: new Date().toISOString(), source, blocking, preExisting }
      r.openFindings = blocking + (preExisting ?? 0)
      return r
    })
    return { ok: true, file }
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).split('\n')[0].slice(0, 120) }
  }
}

const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return ''
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

// One short block.
export function showText(r, { head } = {}) {
  const lines = [`branch ${r.branch}`]
  if (r.verdict) {
    const v = r.verdict
    lines.push(`verdict: ${v.line} (commit ${String(v.commit ?? '').slice(0, 10)}${head && v.commit && v.commit !== head ? ', branch is now at ' + head.slice(0, 10) : ''}, ${v.time} ${ago(v.time)}, by ${v.source})`)
    lines.push(`open findings: ${r.openFindings ?? 'unknown'}${v.preExisting ? ` (${v.blocking} blocking, ${v.preExisting} pre-existing)` : ''}`)
  } else lines.push('verdict: none recorded yet (run meerkat verdict)')
  lines.push(r.notes.length ? `notes (${r.notes.length}):` : 'notes: none')
  for (const n of r.notes.slice(-5)) lines.push(`  ${n.time.slice(0, 16).replace('T', ' ')}${n.commit ? ` @${n.commit.slice(0, 7)}` : ''}  ${n.text.replace(/\s+/g, ' ')}`)
  if (r.notes.length > 5) lines.push(`  ... ${r.notes.length - 5} older (meerkat memory-branch --json lists all)`)
  return lines.join('\n')
}

const USAGE = 'usage: meerkat memory-branch [<branch>] [--note <text>] [--show] [--app <folder>] [--json]'

// Exit 0 done, 1 nothing recorded for --show, 2 usage or a problem with the file.
export function runMemoryBranch(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let note = null
  let show = false
  let json = false
  let app = null
  let branch = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--note') {
      note = argv[++i]
      if (note === undefined || note.startsWith('--') || !note.trim()) return (err(`meerkat memory-branch: --note needs the text of the note. ${USAGE}`), 2)
    } else if (a === '--show') show = true
    else if (a === '--json') json = true
    else if (a === '--app') {
      app = argv[++i]
      if (!app) return (err(`meerkat memory-branch: --app needs a folder. ${USAGE}`), 2)
    } else if (a.startsWith('-')) return (err(`meerkat memory-branch: unknown option ${a}. ${USAGE}`), 2)
    else if (branch === null) branch = a
    else return (err(`meerkat memory-branch: one branch only (got ${branch} and ${a}). ${USAGE}`), 2)
  }
  const appDir = resolve(cwd, app ?? appDirOf(env, cwd))
  const repoRoot = repoRootOf(appDir)
  const here = currentBranch(repoRoot)
  const name = branch ?? here
  if (!name) return (err('meerkat memory-branch: not inside a git repository, so there is no branch to remember. next: run it inside a repository or pass --app <folder>'), 2)
  const file = branchFile(env, repoRoot, name)
  const head = (() => {
    const r = git(repoRoot, ['rev-parse', 'HEAD'])
    return r.status === 0 ? String(r.stdout).trim() : null
  })()
  let rec
  if (note !== null) {
    if (note.length > MAX_NOTE_CHARS) return (err(`meerkat memory-branch: the note is ${note.length} characters; the limit is ${MAX_NOTE_CHARS}. next: write it shorter`), 2)
    try {
      const r = update(file, name, repoRoot, (x) => {
        x.notes = [...x.notes, { time: new Date().toISOString(), text: note, ...(name === here && head ? { commit: head } : {}) }].slice(-MAX_NOTES)
        return x
      })
      rec = r.record
      if (r.moved) err(`note: the old branch memory file was damaged; it was kept as ${r.moved}`)
    } catch (e) {
      return (err(`meerkat memory-branch: the note could not be saved (${String(e?.message ?? e).split('\n')[0].slice(0, 120)}). next: set MEERKAT_LOG_DIR to a folder you can write to`), 2)
    }
    if (!show && !json) {
      out(`noted on branch ${name} (${rec.notes.length} note${rec.notes.length === 1 ? '' : 's'})`)
      return 0
    }
  } else {
    const r = readBranchRecord(file)
    if (r.error) return (err(`meerkat memory-branch: ${r.error}. next: remove that file to start again`), 2)
    rec = r.record
  }
  if (!rec) {
    out(json ? JSON.stringify({ branch: name, record: null }) : `NO-RECORD: nothing is remembered about branch ${name} yet. next: run meerkat verdict on it, or add a note with --note "..."`)
    return 1
  }
  out(json ? JSON.stringify(rec, null, 2) : showText(rec, { head: name === here ? head : null }))
  return 0
}
