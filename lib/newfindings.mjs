// New findings only: a branch gate shows the findings the branch adds, not the ones already on its base (meerkat gate --base <ref>, meerkat verdict, meerkat top).
// A finding is the same finding on both sides when its check id, its file and the hash of its source line (not the line NUMBER) match, so moving code
// down a file does not make an old finding look new. The base side is a temporary detached worktree of the merge-base, checked with the same checks.
// Three guards keep a new finding from hiding behind an old one: the base is a multiset (a base finding hides at most one branch finding, so a second
// copy stays visible), the identity is the source line itself (not a bare message), and a finding on a line the branch diff touched is never hidden.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const LINES = /\r?\n/

// The text a finding stands on: its source line, trimmed. A finding with no line (or an unreadable file) stands on its message.
function snippetOf(root, place) {
  if (place.line > 0) {
    try {
      const line = readFileSync(join(root, place.file), 'utf8').split(LINES)[place.line - 1]
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
const bump = (m, k, n) => m.set(k, (m.get(k) ?? 0) + n)

// Map file -> [[first, last], ...]: the lines the branch added or changed since the merge-base (working tree included), from the diff hunks.
function touchedLines(repoRoot, mb) {
  const map = new Map()
  const d = git(repoRoot, ['diff', '-U0', '--no-color', mb])
  let file = null
  for (const l of String(d.stdout ?? '').split(LINES)) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l)
    if (f) {
      file = f[1]
      if (!map.has(file)) map.set(file, [])
    }
    const h = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(l)
    if (h && file) {
      const n = h[2] === undefined ? 1 : Number(h[2])
      if (n > 0) map.get(file).push([Number(h[1]), Number(h[1]) + n - 1])
    }
  }
  return map
}
const inTouched = (map, p) => p.line > 0 && (map.get(p.file) ?? []).some(([a, b]) => p.line >= a && p.line <= b)

// Removes from `out` (a runGate result) the places whose identity also exists on the merge-base `mb`, recomputes the exit code, and sets out.hidden.
// runBase(wtRoot, wtApp, files, ids) runs the checks named in ids (and what they wait on) in the base worktree and returns a runGate result.
// Only a check that FAILED on the branch can have a finding to hide, so only those are run on the base side (a check that passed there adds nothing
// to the base list that could match). With no such check nothing is run and no worktree is made.
export function failingIdsOf(rows) {
  return [...new Set((rows ?? []).filter((r) => r.kind === 'fail' && r.places?.length).map((r) => r.id))]
}
export async function hideBaseFindings({ out, mb, repoRoot, appDir, runBase }) {
  const ids = failingIdsOf(out.rows)
  if (!ids.length) {
    out.hidden = 0
    return { ok: true, hidden: 0 }
  }
  const tmp = mkdtempSync(join(tmpdir(), 'meerkat-base-'))
  const wt = join(tmp, 'base')
  try {
    if (git(repoRoot, ['worktree', 'add', '--detach', '-q', wt, mb]).status !== 0) return { ok: false }
    const wtApp = join(wt, relative(repoRoot, appDir))
    const files = (out.files ?? []).filter((f) => git(repoRoot, ['cat-file', '-e', `${mb}:${f}`]).status === 0)
    const baseOut = files.length ? await runBase(wt, wtApp, files, ids) : { rows: [] }
    const seen = new Map()
    for (const r of baseOut.rows ?? []) if (failing(r)) for (const p of r.places ?? []) bump(seen, findingIdentity(wt, r.id, p), 1)
    const touched = touchedLines(repoRoot, mb)
    let hidden = 0
    const hiddenPlaces = []
    for (const r of out.rows ?? []) {
      if (r.kind !== 'fail' || !r.places?.length) continue
      const hide = new Set()
      r.places.forEach((p, i) => {
        if (inTouched(touched, p)) return
        const k = findingIdentity(repoRoot, r.id, p)
        if ((seen.get(k) ?? 0) > 0) {
          bump(seen, k, -1)
          hide.add(i)
          hiddenPlaces.push({ check: r.id, file: p.file, line: p.line ?? 0 })
        }
      })
      hidden += hide.size
      const keep = r.places.filter((_, i) => !hide.has(i))
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
    out.hiddenPlaces = hiddenPlaces // pre-existing places, kept so a --known entry that matches one is still counted (preExisting: true)
    return { ok: true, hidden }
  } finally {
    git(repoRoot, ['worktree', 'remove', '--force', wt])
    git(repoRoot, ['worktree', 'prune'])
    rmSync(tmp, { recursive: true, force: true })
  }
}
