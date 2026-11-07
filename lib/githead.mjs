// The commit a folder's git work tree is on, read straight from the .git files (no process is started, so it costs well under a millisecond).
// Returns the full 40-character commit id, or null when the folder is not in a git work tree, HEAD is unborn, or anything looks odd.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const HEX = /^[0-9a-f]{40}$/i
const read = (f) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

function findGitDir(start) {
  let dir = resolve(start)
  for (let i = 0; i < 64; i++) {
    const g = join(dir, '.git')
    if (existsSync(g)) {
      try {
        if (statSync(g).isDirectory()) return g
        const m = (read(g) ?? '').match(/^gitdir:\s*(.+)\s*$/m)
        if (m) return isAbsolute(m[1]) ? m[1] : resolve(dir, m[1])
      } catch {
        return null
      }
      return null
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
  return null
}

export function gitHead(dir) {
  const gitDir = findGitDir(dir)
  if (!gitDir) return null
  const head = (read(join(gitDir, 'HEAD')) ?? '').trim()
  if (HEX.test(head)) return head.toLowerCase()
  const ref = head.match(/^ref:\s*(\S+)$/)?.[1]
  if (!ref || ref.includes('..')) return null
  const common = (read(join(gitDir, 'commondir')) ?? '').trim()
  const dirs = [gitDir, ...(common ? [isAbsolute(common) ? common : resolve(gitDir, common)] : [])]
  for (const d of dirs) {
    const loose = (read(join(d, ref)) ?? '').trim()
    if (HEX.test(loose)) return loose.toLowerCase()
    const packed = (read(join(d, 'packed-refs')) ?? '').split('\n').find((l) => l.endsWith(` ${ref}`))
    if (packed && HEX.test(packed.slice(0, 40))) return packed.slice(0, 40).toLowerCase()
  }
  return null
}
