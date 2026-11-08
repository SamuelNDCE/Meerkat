// New findings only: a branch gate shows the findings the branch adds, not the ones already on its base (meerkat gate --base <ref>, meerkat verdict, meerkat top).
// A finding is the same finding on both sides when its check id, its file and the hash of its source line (not the line NUMBER) match, so moving code
// down a file does not make an old finding look new. The base side is a temporary detached worktree of the merge-base, checked with the same checks.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

// The text a finding stands on: its source line, trimmed. A finding with no line (or an unreadable file) stands on its message.
function snippetOf(root, place) {
  if (place.line > 0) {
    try {
      const line = readFileSync(join(root, place.file), 'utf8').split(/\r?\n/)[place.line - 1]
      if (line !== undefined && line.trim() !== '') return line.trim()
    } catch {
      /* fall through to the message */
    }
  }
  return place.message ?? ''
}
export const findingIdentity = (root, checkId, place) => `${checkId}|${place.file}|${sha(snippetOf(root, place))}`

// true when the branch is not the base itself (a feature branch), false on main/master/dev or a detached head.
export function onNonDefaultBranch(repoRoot, ref) {
  const cur = git(repoRoot, ['branch', '--show-current']).stdout?.trim()
  if (!cur) return false
  const baseName = String(ref ?? '').replace(/^origin\//, '')
  return cur !== baseName && !['main', 'master', 'dev'].includes(cur)
}

const failing = (r) => r.kind === 'fail' || r.kind === 'crash'
const filesOf = (places) => [...new Set(places.map((p) => p.file))]

// Removes from `out` (a runGate result) every place whose identity also exists on the merge-base `mb`, recomputes the exit code, and sets out.hidden.
// runBase(wtRoot, wtApp, files) runs the same checks in the base worktree and returns a runGate result.
export async function hideBaseFindings({ out, mb, repoRoot, appDir, runBase }) {
  const tmp = mkdtempSync(join(tmpdir(), 'meerkat-base-'))
  const wt = join(tmp, 'base')
  try {
    if (git(repoRoot, ['worktree', 'add', '--detach', '-q', wt, mb]).status !== 0) return { ok: false }
    const wtApp = join(wt, relative(repoRoot, appDir))
    const files = (out.files ?? []).filter((f) => git(repoRoot, ['cat-file', '-e', `${mb}:${f}`]).status === 0)
    const baseOut = files.length ? await runBase(wt, wtApp, files) : { rows: [] }
    const seen = new Set()
    for (const r of baseOut.rows ?? []) if (failing(r)) for (const p of r.places ?? []) seen.add(findingIdentity(wt, r.id, p))
    let hidden = 0
    for (const r of out.rows ?? []) {
      if (r.kind !== 'fail' || !r.places?.length) continue
      const keep = r.places.filter((p) => {
        if (!seen.has(findingIdentity(repoRoot, r.id, p))) return true
        hidden++
        return false
      })
      if (keep.length === r.places.length) continue
      r.places = keep
      r.files = filesOf(keep)
      if (keep.length) {
        const d = keep[0]
        r.detail = d.message ? `${d.file}${d.line ? `:${d.line}` : ''} ${d.message}` : r.detail
      } else {
        r.kind = 'pass'
        r.detail = ''
      }
    }
    const rows = out.rows ?? []
    out.exitCode = rows.some(failing) ? 1 : rows.some((r) => r.kind === 'notrun' || r.kind === 'hang') ? 75 : 0
    out.hidden = hidden
    return { ok: true, hidden }
  } finally {
    git(repoRoot, ['worktree', 'remove', '--force', wt])
    git(repoRoot, ['worktree', 'prune'])
    rmSync(tmp, { recursive: true, force: true })
  }
}
