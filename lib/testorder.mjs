// meerkat.order.json: which KINDS of check start first in a run. An AI (or a person) changes the order by editing this one file.
//
//   { "kinds": ["security", "functionality", "ui", "performance", "refactor"] }
//
// Rules: `kinds` lists kinds from the registry (GROUPS in lib/load-checks.mjs); each at most once; a kind left out runs after the listed ones,
// in the default order. An unknown kind, a repeated kind, an unknown key or bad JSON is an error with a plain message, and the run stops
// (exit code 2) rather than guess. With no file, the order is the speed order the runner already uses. The file only changes which kinds
// START first: dependencies (`after`), lane limits and the machine budget are still enforced by the scheduler.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GROUPS } from './load-checks.mjs'

export const ORDER_FILE = 'meerkat.order.json'
export const DEFAULT_KIND_ORDER = [...GROUPS]

// { kinds } (the complete order, listed kinds first) or { error } (a sentence naming the file and what to change).
export function parseOrder(text, file = ORDER_FILE) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { error: `${file}: not valid JSON (${String(e.message).split('\n')[0]}). It should look like {"kinds": ["security", "functionality"]}` }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: `${file}: it must be a JSON object like {"kinds": ["security", "functionality"]}` }
  const extra = Object.keys(data).filter((k) => k !== 'kinds' && k !== 'version')
  if (extra.length) return { error: `${file}: unknown key "${extra[0]}". The only keys are "kinds" and "version"` }
  if (data.version !== undefined && data.version !== 1) return { error: `${file}: "version" must be 1` }
  if (!Array.isArray(data.kinds)) return { error: `${file}: "kinds" must be a list of kinds. Kinds: ${GROUPS.join(', ')}` }
  const seen = new Set()
  for (const k of data.kinds) {
    if (typeof k !== 'string' || !GROUPS.includes(k)) return { error: `${file}: unknown kind "${String(k).slice(0, 40)}". Kinds: ${GROUPS.join(', ')}` }
    if (seen.has(k)) return { error: `${file}: kind "${k}" is listed twice` }
    seen.add(k)
  }
  return { kinds: [...data.kinds, ...DEFAULT_KIND_ORDER.filter((k) => !seen.has(k))] }
}

// Looks for the file in each folder in turn (the app folder, then the repository root). { file, kinds } when one is found and valid,
// { file, error } when it is found and wrong, {} when there is none.
export function loadOrder(dirs, { exists = existsSync, read = (f) => readFileSync(f, 'utf8') } = {}) {
  for (const dir of [...new Set(dirs.filter(Boolean))]) {
    const file = join(dir, ORDER_FILE)
    if (!exists(file)) continue
    let text
    try {
      text = read(file)
    } catch (e) {
      return { file, error: `${ORDER_FILE}: cannot read it (${String(e.message).split('\n')[0]})` }
    }
    return { file, ...parseOrder(text) }
  }
  return {}
}

// A stable sort by kind rank: the checks of the first kind first, speed order kept inside each kind. null leaves the list alone.
export function orderByKind(checks, kinds) {
  if (!Array.isArray(kinds) || !kinds.length) return checks
  const rank = (c) => {
    const i = kinds.indexOf(c.group)
    return i === -1 ? kinds.length : i
  }
  return checks.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c)
}
