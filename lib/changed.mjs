// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Files changed against origin/dev (committed on this branch plus the working tree), as repo-relative
// forward-slash paths. Returns null when git cannot answer, so the caller runs everything.
import { spawnSync } from 'node:child_process'

function git(repoRoot, args) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : null
}

export function changedFiles(repoRoot) {
  const committed = git(repoRoot, ['diff', '--name-only', 'origin/dev...HEAD'])
  if (committed === null) return null
  const tracked = git(repoRoot, ['diff', '--name-only', 'HEAD']) ?? []
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard']) ?? []
  return [...new Set([...committed, ...tracked, ...untracked].map((f) => f.replace(/\\/g, '/')))]
}
