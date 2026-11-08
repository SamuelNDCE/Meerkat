// One line naming the folder a command reads, the branch checked out there and whether it is a git worktree (a folder whose .git is a file).
// Used by `meerkat gate <folder>` and `meerkat brief --app <folder>` so a person or an AI sees which checkout was read, not the main one by mistake.
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function folderInfo(dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (!top) return { folder: dir, git: false, branch: null, detached: null, worktree: false }
  const branch = git(dir, ['branch', '--show-current'])
  const detached = branch ? null : git(dir, ['rev-parse', '--short', 'HEAD'])
  let worktree = false
  try {
    worktree = statSync(join(top, '.git')).isFile()
  } catch {
    /* no .git entry at the top: not a worktree */
  }
  return { folder: dir, git: true, branch: branch || null, detached, worktree }
}

export function folderBanner(dir) {
  const i = folderInfo(dir)
  if (!i.git) return `folder: ${i.folder} (not a git repository)`
  const where = i.branch ? `branch ${i.branch}` : `detached at ${i.detached ?? 'unknown'}`
  return `folder: ${i.folder} | ${where} | ${i.worktree ? 'git worktree' : 'main checkout (not a worktree)'}`
}
