// Finding git repositories on this computer, for the project picker and for `meerkat repos`.
// Pure of terminal and of git: it only lists folders and reads the first bytes of .git/HEAD (never any other file of a repo, never runs
// anything from a repo, never spawns git). The filesystem is passed in (`fs`), so tests use a fake tree.
// Sources, in order: the folder you are in (its repo), recent projects, your saved roots (meerkat root add), common places.
// The scan is bounded: depth 3, a list of folders it never enters, symlinks and junctions never followed, 400 repos or 2 seconds at most.
import * as nodeFs from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { projectCheck } from './projectgate.mjs'
import { stripControl } from './tui/safe.mjs'
import { readRecent, readUserConfig } from './userconfig.mjs'

export const MAX_DEPTH = 3
export const MAX_REPOS = 400
export const MAX_MS = 2000

// Folder names (lower case) the scan never enters. Hidden folders (a leading dot) are skipped as well.
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', 'appdata', 'windows', 'program files', 'program files (x86)', 'programdata',
  '$recycle.bin', 'system volume information', 'winsxs', '__pycache__', 'site-packages',
])
export const COMMON_PLACES = ['Documents', 'code', 'src', 'projects', 'dev', 'repos', 'Desktop']

const key = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
const skipName = (name) => name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())

function readSmall(fs, file, bytes = 512) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* nothing to close */
      }
    }
  }
}

// Where the HEAD file of a repo is. `.git` is normally a folder; in a worktree or submodule it is a small file saying "gitdir: <path>".
function headFile(repo, fs) {
  const dotGit = join(repo, '.git')
  try {
    if (fs.statSync(dotGit).isDirectory()) return { head: join(dotGit, 'HEAD'), index: join(dotGit, 'index') }
    const m = /^gitdir:\s*(.+)$/m.exec(readSmall(fs, dotGit) ?? '')
    if (m) {
      const dir = resolve(repo, m[1].trim())
      return { head: join(dir, 'HEAD'), index: join(dir, 'index') }
    }
  } catch {
    /* not readable */
  }
  return null
}

// The branch name from .git/HEAD ("ref: refs/heads/main"), "(detached abc1234)" for a bare commit, or null.
export function readBranch(repo, fs = nodeFs) {
  const h = headFile(repo, fs)
  const text = h ? readSmall(fs, h.head) : null
  if (!text) return null
  const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(text)
  if (ref) return stripControl(ref[1].trim())
  const sha = /^([0-9a-f]{7,64})\s*$/m.exec(text)
  return sha ? `(detached ${sha[1].slice(0, 7)})` : null
}

function modified(repo, fs) {
  const h = headFile(repo, fs)
  let best = 0
  for (const f of h ? [h.head, h.index] : []) {
    try {
      best = Math.max(best, fs.statSync(f).mtimeMs)
    } catch {
      /* a repo with no index yet */
    }
  }
  if (!best) {
    try {
      best = fs.statSync(repo).mtimeMs
    } catch {
      /* gone */
    }
  }
  return best
}

export const isRepo = (dir, fs = nodeFs) => {
  try {
    return fs.existsSync(join(dir, '.git'))
  } catch {
    return false
  }
}

// {name, path, branch, lastModified, isRepo} for a folder. branch is null when it is not a repository.
export function repoInfo(dir, fs = nodeFs) {
  const path = resolve(dir)
  const repo = isRepo(path, fs)
  return { name: stripControl(basename(path) || path), path, branch: repo ? readBranch(path, fs) : null, lastModified: repo ? modified(path, fs) : safeMtime(path, fs), isRepo: repo }
}

const safeMtime = (p, fs) => {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

// The root of the repository that holds `start`, or null. Walks up at most 64 levels.
export function findRepoRoot(start, fs = nodeFs) {
  let dir = resolve(start)
  for (let i = 0; i < 64; i++) {
    if (isRepo(dir, fs)) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
  return null
}

// Scans one folder for repositories. `state` is shared between folders so the caps cover the whole discovery:
// { found: Map(key -> info), stop: () => boolean, truncated: boolean }.
export function scanFolder(root, { fs = nodeFs, maxDepth = MAX_DEPTH, state }) {
  const queue = [{ dir: resolve(root), depth: 0 }]
  while (queue.length) {
    if (state.stop()) {
      state.truncated = true
      return
    }
    const { dir, depth } = queue.shift()
    if (isRepo(dir, fs)) {
      if (!state.found.has(key(dir))) state.found.set(key(dir), repoInfo(dir, fs))
      continue // a repository is not searched for repositories inside it
    }
    if (depth >= maxDepth) continue
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // unreadable: leave it out
    }
    for (const e of entries) {
      // isDirectory() is false for a symlink or junction, so links are never followed out of the tree.
      if (!e.isDirectory() || e.isSymbolicLink?.() || skipName(e.name)) continue
      queue.push({ dir: join(dir, e.name), depth: depth + 1 })
    }
  }
}

const sameSet = (list) => new Set(list.map(key))

// Everything the picker and `meerkat repos` show.
//   here    { ...info, isRepo } for the current folder's repository, or for the folder itself when it is not in one
//   recent  recent projects that still exist (any folder, newest first)
//   found   repositories from the saved roots and the common places, newest activity first, without the ones above
//   all     here (when a repo), recent repos, found: repositories only, for `meerkat repos`
export function discoverRepos({ cwd = process.cwd(), env = process.env, home = homedir(), fs = nodeFs, scan = [], now = Date.now, maxMs = MAX_MS, maxRepos = MAX_REPOS, maxDepth = MAX_DEPTH, meerkatDir = MEERKAT_DIR, places = COMMON_PLACES } = {}) {
  const deadline = now() + maxMs
  const state = { found: new Map(), truncated: false, stop: () => state.found.size >= maxRepos || now() > deadline }

  const rootDir = findRepoRoot(cwd, fs)
  const here = repoInfo(rootDir ?? cwd, fs)

  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  const recent = readRecent(env, home, isDir).map((p) => repoInfo(p, fs))

  const savedRoots = (readUserConfig(env, home).roots ?? []).filter((r) => typeof r === 'string' && isAbsolute(r))
  const roots = [...scan, ...savedRoots, ...places.map((p) => join(home, p)), dirname(meerkatDir)]
  const seenRoots = new Set()
  for (const r of roots) {
    const k = key(r)
    if (seenRoots.has(k) || !isDir(r)) continue
    seenRoots.add(k)
    scanFolder(r, { fs, maxDepth, state })
    if (state.stop()) {
      state.truncated = true
      break
    }
  }

  const taken = sameSet([here, ...recent].map((x) => x.path))
  const found = [...state.found.values()].filter((r) => !taken.has(key(r.path))).sort((a, b) => b.lastModified - a.lastModified || a.name.localeCompare(b.name))
  const all = [...(here.isRepo ? [here] : []), ...recent.filter((r) => r.isRepo && key(r.path) !== key(here.path)), ...found]
  return { here, recent: recent.filter((r) => key(r.path) !== key(here.path)), found, all, truncated: state.truncated }
}

// Folders only, for the browse view: {entries: [{name, path, isRepo, isProject}], note}. Never throws.
export function listSubfolders(dir, fs = nodeFs) {
  let names
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return { entries: [], note: `Cannot open this folder (${stripControl(e?.code ?? 'error')})`, ok: false }
  }
  const entries = names
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: stripControl(e.name), path: join(dir, e.name), isRepo: isRepo(join(dir, e.name), fs) }))
    .map((e) => ({ ...e, isProject: e.isRepo || projectCheck(e.path, { fs, quick: true }).ok }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return { entries, note: entries.length ? '' : 'No subfolders here', ok: true }
}

// Windows drive roots that exist, from A: to Z:. Empty elsewhere.
export function listDrives(fs = nodeFs, platform = process.platform) {
  if (platform !== 'win32') return []
  const out = []
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`
    try {
      if (fs.existsSync(root)) out.push(root)
    } catch {
      /* skip */
    }
  }
  return out
}

// Text lines for `meerkat repos` and `meerkat recent`.
export function reposText(rows) {
  if (!rows.length) return 'No repositories found. Add a folder to search: meerkat root add <folder>, or look in one now: meerkat repos --scan <folder>'
  const w = Math.max(...rows.map((r) => r.name.length))
  const wb = Math.max(...rows.map((r) => (r.branch ?? '').length))
  return rows.map((r) => `${stripControl(r.name).padEnd(w)}  ${stripControl(r.branch ?? '').padEnd(wb)}  ${stripControl(r.path)}`).join('\n')
}
