// Resumable runs. When `verdict`, `top` or `gate` stop at their time limit (or on Ctrl-C), the checks that had finished are saved with their results
// in <run folder>/resume.json, and the stop prints the exact command to carry on: `meerkat verdict --resume <file>`.
// A resumed run runs only the checks that were not finished and merges the saved results with the new ones (runGate takes them as `resume.rows`).
// A resume file is bound to the commit, the base it compared with and the state of the working tree: any difference is refused with the reason, never reused silently.
// Nothing here runs on a normal, complete run: the file is built only on a stop, and read only when --resume is given.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from './lockfile.mjs'

export const RESUME_VERSION = 1
export const RESUME_FILE = 'resume.json'

const git = (repoRoot, args) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })

export const headOf = (repoRoot) => {
  const r = git(repoRoot, ['rev-parse', 'HEAD'])
  return r.status === 0 ? String(r.stdout).trim() : null
}

// A fingerprint of what is on disk beyond HEAD: the status list (untracked files included) and the diff of tracked files. Two runs with the same
// commit and the same fingerprint read the same code. Only computed on a stop and on --resume, never on a complete run.
export function treeDigest(repoRoot) {
  const h = createHash('sha256')
  const st = git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  h.update(String(st.stdout ?? ''))
  const df = git(repoRoot, ['diff', 'HEAD', '--no-color', '--no-ext-diff'])
  h.update(String(df.stdout ?? ''))
  return h.digest('hex')
}

const VALUE_FLAGS = new Set(['--base', '--against', '--app', '--max-seconds', '--format', '--timeout'])

// Splits the arguments a person gave into { app, flags, seconds }: the folder, the flags that decide what is compared, and the time limit.
// The folder is stored as an absolute path, so a resume works from any folder; the time limit is not part of what is being checked.
export function splitArgs(rest, cwd) {
  let app = null
  let seconds = []
  const flags = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--app') app = rest[++i] ?? null
    else if (a === '--max-seconds') seconds = [a, rest[++i] ?? '']
    else if (a === '--all-findings') continue // only changes what is shown, never what a check finds
    else if (VALUE_FLAGS.has(a)) flags.push(a, rest[++i] ?? '')
    else if (!a.startsWith('-') && app === null) app = a
    else flags.push(a)
  }
  return { app: app ? resolve(cwd, app) : null, flags, seconds }
}

// The rows that were finished when the run stopped: everything that has a real result. A check cut off by the deadline, and a hang, are not finished.
export function buildResume({ word, args, cwd, out, changed, repoRoot, appDir, key }) {
  const rows = out?.resumeRows
  if (!Array.isArray(rows) || !rows.length) return { reason: 'no check had finished, so there is nothing to carry over. Run it again with a longer limit' }
  const split = splitArgs(args, cwd)
  return {
    doc: {
      version: RESUME_VERSION,
      createdAt: new Date().toISOString(),
      command: word,
      appDir: resolve(appDir),
      gateArgs: split.flags,
      commit: out.resumeHead ?? headOf(repoRoot),
      base: { ref: changed?.ref ?? null, mergeBase: changed?.mb ?? null },
      tree: treeDigest(repoRoot),
      files: [...(changed?.files ?? [])].sort(),
      key,
      rows,
    },
  }
}

// Saves the file next to the run's other logs. Returns { file } or { reason } (never throws): a stop that cannot save says why.
export function saveResume(ctx) {
  const dir = ctx.out?.runDir ?? ctx.out?.logDir
  if (!dir) return { reason: 'this run saved no log folder to keep it in. Set MEERKAT_LOG_DIR to a folder you can write to' }
  const built = buildResume(ctx)
  if (built.reason) return { reason: built.reason }
  const file = join(dir, RESUME_FILE).replace(/\\/g, '/')
  try {
    writeFileAtomic(file, JSON.stringify(built.doc))
  } catch (e) {
    return { reason: `the resume file could not be written (${String(e?.message ?? e).split('\n')[0].slice(0, 100)})` }
  }
  return { file }
}

const quote = (f) => (/[\s"'&;()]/.test(f) ? `"${f}"` : f)
export const resumeCommand = (word, file) => `meerkat ${word} --resume ${quote(file)}`

// The line a stop prints: the command that resumes, or the reason there is none.
export function resumeLine(word, saved) {
  return saved.file ? `resume: ${resumeCommand(word, saved.file)}` : `NO-RESUME: ${saved.reason}`
}

// { doc } or { error }. The file must be one this version wrote.
export function readResume(file, cwd) {
  const path = resolve(cwd, file)
  let doc
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { error: e?.code === 'ENOENT' ? `the resume file ${file} does not exist` : `the resume file ${file} is not valid JSON` }
  }
  if (!doc || doc.version !== RESUME_VERSION || !Array.isArray(doc.rows) || typeof doc.commit !== 'string' || !doc.base || typeof doc.tree !== 'string') return { error: `the resume file ${file} is not one this version of Meerkat wrote (expected version ${RESUME_VERSION})` }
  return { doc }
}

const short = (s) => String(s ?? 'none').slice(0, 10)

// null when the file may be used, else the reason it may not. Commit, base, what is compared and the working tree must all be as they were at the stop.
export function resumeProblem(doc, { repoRoot, changed, key }) {
  const head = headOf(repoRoot)
  if (doc.commit !== head) return `the resume file is from commit ${short(doc.commit)} and this folder is at ${short(head)}`
  const ref = changed?.ref ?? null
  const mb = changed?.mb ?? null
  if ((doc.base.ref ?? null) !== ref || (doc.base.mergeBase ?? null) !== mb) return `the resume file compared with ${doc.base.ref ?? 'the working tree'} (merge base ${short(doc.base.mergeBase)}) and this run compares with ${ref ?? 'the working tree'} (merge base ${short(mb)}), a different base`
  if ((doc.key ?? '') !== (key ?? '')) return `the resume file was made with different options (${doc.key || 'defaults'}, now ${key || 'defaults'})`
  const files = [...(changed?.files ?? [])].sort()
  if (JSON.stringify(files) !== JSON.stringify(doc.files ?? [])) return `the changed files are not the same as at the stop (${(doc.files ?? []).length} then, ${files.length} now)`
  if (treeDigest(repoRoot) !== doc.tree) return 'files in the working tree changed after the stop, so the saved results may be out of date'
  return null
}

// The part of the gate options that changes what a check reads (so a resume made with --all cannot be used without it).
export const optionKey = (o) => [o.all ? 'all' : '', o.thorough ? 'thorough' : ''].filter(Boolean).join(',')

// The arguments a resumed run uses: the saved ones, plus the time limit and anything the person adds on top. A folder given again must be the saved one.
export function resumedArgs(doc, rest, cwd) {
  const split = splitArgs(rest, cwd)
  if (split.app && resolve(split.app) !== resolve(doc.appDir)) return { error: `the resume file was made for ${doc.appDir} and this run is for ${split.app}` }
  return { args: ['--app', doc.appDir, ...doc.gateArgs, ...split.flags, ...split.seconds] }
}
