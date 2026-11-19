// `meerkat risks [folder] [--json]` (roadmap C3): the newest run's open findings grouped by file, for an AI that is about to edit.
// Ranking: the worst severity in the file first, then how often the file changed in the last 200 commits (git log), then the path.
// Without git the churn is unknown and the ranking is by severity only; the output says so.
// Dismissed findings (meerkat dismissals) are listed in their own section with their reasons and are never counted as open.
// Scope: the newest run saved for this folder (a branch checked out in its own worktree folder has its own runs). Never other folders' runs.
// Exit codes: 0 done, 2 usage error, 3 no saved run to read.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { allDismissals } from './accepted.mjs'
import { loadRunFindings } from './findingscmd.mjs'
import { SEVERITY_RANK } from './findings.mjs'
import { stripControl } from './tui/safe.mjs'

export const RISKS_VERSION = 1
export const CHURN_COMMITS = 200
const USAGE = 'usage: meerkat risks [folder] [--json]'
const one = (x) => stripControl(String(x ?? '')).replace(/\s+/g, ' ').trim()
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 3)}...` : t)

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

// { available, commits, counts: Map(file -> times changed in the last 200 commits), branch }. Paths are relative to `dir`.
export function gitChurn(dir) {
  const log = git(dir, ['log', '-n', String(CHURN_COMMITS), '--name-only', '--pretty=format:', '--relative'])
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() || null
  if (log === null) return { available: false, commits: CHURN_COMMITS, counts: new Map(), branch }
  const counts = new Map()
  for (const l of log.split('\n')) {
    const f = l.trim()
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return { available: true, commits: CHURN_COMMITS, counts, branch }
}

// The data both `meerkat risks` and the task pack use. Returns { ok: false, code, text } or { ok: true, ... }.
export function collectRisks(folder, env = process.env) {
  const r = loadRunFindings(env, undefined, { folder })
  if (!r.ok) return { ok: false, code: r.code ?? 3, text: r.text }
  const churn = gitChurn(folder)
  const byFile = new Map()
  for (const f of r.doc.findings) {
    const file = f.file ? one(f.file) : null
    const check = one(f.check ?? f.rule ?? '')
    const entry = {
      id: one(f.id),
      check,
      rule: f.rule ? one(f.rule) : null,
      severity: f.severity,
      line: Number(f.line) > 0 ? Number(f.line) : null,
      message: cut(one(f.message), 200),
      next: f.fix ? cut(one(f.fix), 200) : `meerkat why ${check}`,
    }
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(entry)
  }
  const rank = (s) => SEVERITY_RANK[s] ?? 0
  const open = [...byFile.entries()].map(([file, findings]) => {
    findings.sort((a, b) => rank(b.severity) - rank(a.severity) || (a.line ?? 0) - (b.line ?? 0) || (a.id < b.id ? -1 : 1))
    return { file, churn: file && churn.available ? (churn.counts.get(file) ?? 0) : null, worst: findings[0].severity, exists: file ? existsSync(resolve(folder, file)) : null, findings }
  })
  open.sort((a, b) => (a.file === null) - (b.file === null) || rank(b.worst) - rank(a.worst) || (b.churn ?? 0) - (a.churn ?? 0) || String(a.file).localeCompare(String(b.file)))
  const openIds = new Set(r.doc.findings.map((f) => f.id))
  const dismissed = allDismissals(env, folder)
    .filter((d) => !d.expired && !openIds.has(d.id))
    .map((d) => ({ id: one(d.id), check: d.check ? one(d.check) : null, rule: d.rule ? one(d.rule) : null, file: d.file ? one(d.file) : null, title: cut(one(d.title), 200), reason: cut(one(d.reason), 300), at: d.at || null, source: d.source }))
  return { ok: true, runDir: r.dir, runName: basename(r.dir), runId: one(r.doc.run?.id), folder, branch: churn.branch, gitHistory: { available: churn.available, commits: CHURN_COMMITS }, total: r.doc.findings.length, open, dismissed }
}

export function risksText(d) {
  const L = []
  const where = `${d.branch ? `branch ${d.branch}` : 'the checked-out branch'}`
  L.push(`risks: the newest run of this folder only (current branch, ${where}), run ${d.runName}: ${d.total} open finding(s) in ${d.open.length} place(s), ${d.dismissed.length} dismissed`)
  L.push(d.gitHistory.available ? `ranked by worst severity, then by how often the file changed in the last ${d.gitHistory.commits} commits` : 'git history is not available here, so files are ranked by severity only')
  if (!d.open.length) L.push('', 'No open findings in the newest run.')
  for (const e of d.open) {
    L.push('')
    if (e.file === null) L.push(`(no file)  worst: ${e.worst}`)
    else L.push(`${e.file}  worst: ${e.worst}${e.churn === null ? '' : `, changed in ${e.churn} of the last ${d.gitHistory.commits} commits`}${e.exists ? '' : '  [file is not in the working tree]'}`)
    for (const f of e.findings) {
      L.push(`  ${f.line ? `line ${f.line}  ` : ''}[${f.severity}] ${f.check}: ${f.message}`)
      L.push(`    next: ${f.next}`)
    }
  }
  if (d.dismissed.length) {
    L.push('', `Dismissed (${d.dismissed.length}): accepted as not a problem, do not report these again`)
    for (const x of d.dismissed) {
      L.push(`  ${x.file ?? '(no file)'}  ${x.check ?? x.rule ?? ''}: ${x.title}  [${x.id.slice(0, 8)}]`)
      L.push(`    reason: ${x.reason}`)
    }
  }
  return L.join('\n')
}

export function runRisks(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  let json = false
  let target = null
  for (const a of argv) {
    if (a === '--json') json = true
    else if (a.startsWith('--')) return (err(`risks: unknown option ${one(a).slice(0, 60)}. ${USAGE}`), 2)
    else if (target === null) target = a
    else return (err(`risks: give one folder. ${USAGE}`), 2)
  }
  const folder = resolve(cwd, target ?? '.')
  let isDir = false
  try {
    isDir = statSync(folder).isDirectory()
  } catch {
    /* not there */
  }
  if (!isDir) return (err(`risks: ${one(target ?? '.')} is not a folder`), 2)
  const d = collectRisks(folder, env)
  if (!d.ok) return (err(d.text), d.code)
  if (json) {
    out(JSON.stringify({ version: RISKS_VERSION, scope: 'newest run of this folder (current branch only)', run: d.runName, runFolder: d.runDir, branch: d.branch, gitHistory: d.gitHistory, total: d.total, open: d.open.map(({ exists, ...e }) => e), dismissed: d.dismissed }, null, 2))
  } else out(risksText(d))
  return 0
}
