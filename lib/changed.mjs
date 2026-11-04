// Files changed against the base branch (committed on this branch plus the working tree), as repo-relative
// forward-slash paths. Returns null when git cannot answer, so the caller runs everything.
import { spawnSync } from 'node:child_process'

function git(repoRoot, args) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : null
}

// The branch changes are measured against: MEERKAT_BASE, else what origin's HEAD points at, else the first of main, master, dev that exists.
export function baseRef(repoRoot, env = process.env) {
  if (env.MEERKAT_BASE) return env.MEERKAT_BASE
  const head = git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head?.[0]) return head[0]
  for (const b of ['origin/main', 'origin/master', 'origin/dev']) if (git(repoRoot, ['rev-parse', '--verify', '--quiet', b]) !== null) return b
  return null
}

export function changedFiles(repoRoot, env = process.env) {
  const base = baseRef(repoRoot, env)
  if (!base) return null
  const committed = git(repoRoot, ['diff', '--name-only', `${base}...HEAD`])
  if (committed === null) return null
  const tracked = git(repoRoot, ['diff', '--name-only', 'HEAD']) ?? []
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard']) ?? []
  return [...new Set([...committed, ...tracked, ...untracked].map((f) => f.replace(/\\/g, '/')))]
}

// Every file (tracked and untracked, not ignored) under the given folders, as repo-relative forward-slash paths. This is what
// `--scope` checks: a folder of the project, not what changed. Returns null when git cannot answer. A folder that does not exist yields no files.
export function scopedFiles(repoRoot, scopes) {
  const prefixes = scopes.map((s) => String(s).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))
  const tracked = git(repoRoot, ['ls-files', '--', ...prefixes])
  if (tracked === null) return null
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard', '--', ...prefixes]) ?? []
  const inScope = (f) => prefixes.some((p) => p === '' || p === '.' || f === p || f.startsWith(`${p}/`))
  return [...new Set([...tracked, ...untracked].map((f) => f.replace(/\\/g, '/')))].filter(inScope)
}

// True when a repo-relative file (or a finding's file) is inside one of the scoped folders. A finding with no file is not inside any folder.
export function inScopeFile(file, scopes) {
  if (!file) return false
  const norm = (x) => String(x).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const f = norm(file)
  return scopes.some((s) => {
    const p = norm(s)
    return p === '' || p === '.' || f === p || f.startsWith(`${p}/`)
  })
}
