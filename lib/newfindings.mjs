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
// The base side is the slow half of a branch verdict, so it skips every piece of work that cannot change the answer:
//  - a check none of whose failing places could be hidden (every place is on a line the branch touched, or in a file the base does not have) is not run on the base;
//  - a base result is kept per (merge-base commit, changed files, check, Meerkat code, settings) in `baseCache`, so it is reused by the next run and by another
//    branch cut from the same base commit, and when every check is cached no worktree is made at all.
// What is kept is the identity list of the base findings (check|file|hash of the source line), which is all the comparison reads. Output is unchanged.
const SETTINGS_NAME = /^(?:\.meerkat.*|meerkat\.config\.json|meerkat\.order\.json)$/i
const SLASH = String.fromCharCode(92)
export function baseSettingsDigest(repoRoot, mb, relApp, env = process.env) {
  const h = createHash('sha256')
  const rel = String(relApp ?? '').split(SLASH).join('/')
  for (const prefix of new Set(['', rel && rel !== '.' ? `${rel}/` : ''])) {
    const r = git(repoRoot, ['ls-tree', mb, ...(prefix ? ['--', prefix] : [])])
    for (const line of String(r.stdout ?? '').split(LINES)) {
      const m = /^\S+ blob (\S+)\t(.+)$/.exec(line)
      if (m && SETTINGS_NAME.test(m[2].split('/').pop())) h.update(`${m[2]}\0${m[1]}\n`)
    }
  }
  for (const k of Object.keys(env).filter((x) => /^MEERKAT_/.test(x) && x !== 'MEERKAT_LOG_DIR' && x !== 'MEERKAT_JOBS' && x !== 'MEERKAT_PARALLEL').sort()) h.update(`${k}=${env[k]}\n`)
  return h.digest('hex')
}
export const baseEntryKey = ({ mb, files, id, version, settings }) => createHash('sha256').update([mb, [...files].sort().join('\n'), id, version, settings].join('|')).digest('hex').slice(0, 32)

// The files of `files` that exist on the merge-base, in the order given: one `git cat-file --batch-check` process instead of one per file.
function filesInTree(repoRoot, mb, files) {
  if (!files.length) return []
  const NL = String.fromCharCode(10)
  const exists = (f) => git(repoRoot, ['cat-file', '-e', `${mb}:${f}`]).status === 0
  if (files.some((f) => f.includes(NL))) return files.filter(exists)
  const r = spawnSync('git', ['-C', repoRoot, 'cat-file', '--batch-check'], { encoding: 'utf8', input: files.map((f) => `${mb}:${f}${NL}`).join(''), maxBuffer: 64 * 1024 * 1024 })
  const lines = String(r.stdout ?? '').split(LINES)
  if (r.status !== 0 || lines.length < files.length) return files.filter(exists)
  return files.filter((_, i) => !/ missing$/.test(lines[i]))
}

export async function hideBaseFindings({ out, mb, repoRoot, appDir, runBase, baseCache = null }) {
  let ids = failingIdsOf(out.rows)
  if (!ids.length) {
    out.hidden = 0
    return { ok: true, hidden: 0 }
  }
  const touched = touchedLines(repoRoot, mb)
  // Which candidate files exist on the merge-base: one cat-file --batch-check process for all of them, not one process per file.
  const candidates = [...new Set([...(out.files ?? []), ...(out.rows ?? []).flatMap((r) => (r.places ?? []).map((p) => p.file))])]
  const onBaseSet = new Set(filesInTree(repoRoot, mb, candidates))
  const existsOnBase = (f) => onBaseSet.has(f)
  // Only a place off the touched lines, in a file the base has, can match a base finding.
  const hideable = (r) => (r.places ?? []).some((p) => !inTouched(touched, p) && existsOnBase(p.file))
  const rowOf = new Map((out.rows ?? []).filter((r) => r.kind === 'fail' && r.places?.length).map((r) => [r.id, r]))
  ids = ids.filter((id) => hideable(rowOf.get(id)))
  const files = (out.files ?? []).filter(existsOnBase)
  const seen = new Map()
  const fresh = []
  let missing = ids
  const keyOf = new Map()
  if (baseCache && ids.length && files.length) {
    const settings = baseSettingsDigest(repoRoot, mb, relative(repoRoot, appDir), baseCache.env)
    const now = Date.now()
    missing = []
    for (const id of ids) {
      const key = baseEntryKey({ mb, files, id, version: baseCache.version, settings })
      keyOf.set(id, key)
      const e = baseCache.entries?.[key]
      if (e && Array.isArray(e.identities) && now - Date.parse(e.at) < baseCache.maxAgeMs) for (const x of e.identities) bump(seen, x, 1)
      else missing.push(id)
    }
  }
  if (missing.length && files.length) {
    const tmp = mkdtempSync(join(tmpdir(), 'meerkat-base-'))
    const wt = join(tmp, 'base')
    try {
      if (git(repoRoot, ['worktree', 'add', '--detach', '-q', wt, mb]).status !== 0) return { ok: false }
      const wtApp = join(wt, relative(repoRoot, appDir))
      const baseOut = await runBase(wt, wtApp, files, missing)
      for (const r of baseOut.rows ?? []) if (failing(r)) for (const p of r.places ?? []) bump(seen, findingIdentity(wt, r.id, p), 1)
      // Keep a base result only for a check that finished cleanly there (a pass or a fail), never one that crashed, hung or did not run.
      if (baseCache) {
        for (const id of missing) {
          const rows = (baseOut.rows ?? []).filter((r) => r.id === id)
          if (rows.length === 1 && (rows[0].kind === 'pass' || rows[0].kind === 'fail')) fresh.push({ id, key: keyOf.get(id), identities: rows[0].kind === 'fail' ? (rows[0].places ?? []).map((p) => findingIdentity(wt, id, p)) : [] })
        }
      }
    } finally {
      git(repoRoot, ['worktree', 'remove', '--force', wt])
      git(repoRoot, ['worktree', 'prune'])
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  if (baseCache && fresh.length) baseCache.save(fresh)
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
}
