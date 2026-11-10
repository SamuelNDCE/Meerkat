// Shared by the checks that scan Markdown: which tracked files to look at.
//   skipVendored  drops files under node_modules, dist, build, vendor (a tracked copy of someone else's documents is not this project's).
//   onlyChanged   when a gate wrote its list of changed files (MEERKAT_CHANGED_LIST, see lib/gate.mjs), keeps only those; otherwise all.
import { readFileSync } from 'node:fs'

const VENDORED = /(^|\/)(node_modules|dist|build|vendor)\//i
const slash = (f) => f.split('\\').join('/')

export const skipVendored = (files) => files.filter((f) => !VENDORED.test(slash(f)))

export function onlyChanged(files, env = process.env) {
  const list = env.MEERKAT_CHANGED_LIST
  if (!list) return files
  try {
    const changed = new Set(readFileSync(list, 'utf8').split(/\r?\n/).filter(Boolean).map(slash))
    return files.filter((f) => changed.has(slash(f)))
  } catch {
    return files
  }
}
