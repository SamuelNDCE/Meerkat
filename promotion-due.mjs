// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Which promotion hops have waited long enough that it is time to run the thorough tier and promote.
//   node promotion-due.mjs            report; exit 0 when nothing is due, 10 when a hop is due
//
// The branch order is dev -> test -> beta -> stable (docs/release/promotion-gate.md). A branch is "behind" by
// the commits its source branch has and it lacks. Samuel's rule (2026-10-27): once any branch except stable is
// about 100 commits behind its source, that is the cue to run the thorough tier on the source and promote.
// stable is only reported, never a trigger: it moves by Samuel's hand. The threshold is NV_PROMOTE_LAG (100).
// This script only reports. Promoting is a separate, asked-for step.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appDirOf, repoRootOf } from './lib/paths.mjs'

export const HOPS = [
  { from: 'dev', to: 'test', trigger: true },
  { from: 'test', to: 'beta', trigger: true },
  { from: 'beta', to: 'stable', trigger: false },
]
export const DEFAULT_LAG = 100

// How many commits `from` has that `to` lacks; null when git cannot say (a branch is missing).
export function behindCount(repoRoot, from, to) {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-list', '--count', `origin/${to}..origin/${from}`], { encoding: 'utf8' })
  return r.status === 0 ? Number(r.stdout.trim()) : null
}

export function assess(counts, threshold = DEFAULT_LAG) {
  return HOPS.map((h) => {
    const behind = counts[`${h.from}>${h.to}`] ?? null
    return { ...h, behind, due: h.trigger && behind !== null && behind >= threshold }
  })
}

export function report(rows, threshold) {
  const lines = rows.map((r) => {
    const n = r.behind === null ? 'unknown' : String(r.behind)
    const state = r.behind === null ? 'UNKNOWN' : r.due ? 'DUE' : r.trigger ? 'ok' : 'info only'
    return `${r.to.padEnd(7)} is ${n.padStart(5)} commits behind ${r.from.padEnd(5)} ${state}`
  })
  const due = rows.filter((r) => r.due)
  lines.push(due.length ? `DUE: ${due.map((r) => `${r.from} -> ${r.to}`).join(', ')} (threshold ${threshold}). Run verify:thorough on the source branch, then promote.` : `nothing due (threshold ${threshold})`)
  return lines.join('\n')
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = repoRootOf(appDirOf())
  const threshold = Number(process.env.NV_PROMOTE_LAG ?? DEFAULT_LAG)
  if (process.env.NV_PROMOTE_NO_FETCH !== '1') spawnSync('git', ['-C', repoRoot, 'fetch', '--quiet', 'origin', 'dev', 'test', 'beta', 'stable'])
  const counts = {}
  for (const h of HOPS) counts[`${h.from}>${h.to}`] = behindCount(repoRoot, h.from, h.to)
  const rows = assess(counts, threshold)
  console.log(report(rows, threshold))
  process.exit(rows.some((r) => r.due) ? 10 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
