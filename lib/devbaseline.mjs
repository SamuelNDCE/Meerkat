// Dev-baseline store: which checks fail on the base at an exact base sha. Shared by every PR batch, so dev is checked once per dev commit.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const STATUSES = new Set(['fail', 'pass', 'notrun', 'unknown'])

const safe = (s) => String(s || 'repo').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'repo'

export function baselineFile(dataDir, repoName, baseSha) {
  return join(dataDir, 'devbaseline', safe(repoName), `${safe(baseSha)}.json`)
}

export function baseOf(repoRoot, base) {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return /^[0-9a-f]{7,64}$/i.test(out) ? out : null
  } catch {
    return null
  }
}

export function readBaseline(file) {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    if (!doc || typeof doc !== 'object' || doc.schema !== 1) return null
    if (typeof doc.baseSha !== 'string' || doc.baseSha !== basename(file, '.json')) return null
    if (!doc.checks || typeof doc.checks !== 'object' || Array.isArray(doc.checks)) return null
    for (const v of Object.values(doc.checks)) if (!STATUSES.has(v)) return null
    if (!Array.isArray(doc.fails)) return null
    return doc
  } catch {
    return null
  }
}

export function writeBaseline(file, doc) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(doc, null, 2))
    renameSync(tmp, file)
    return true
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    return false
  }
}

export async function devBaselineFor(repoRoot, base, checkIds, { dataDir, runChecks } = {}) {
  const ids = [...new Set(checkIds || [])]
  const sha = baseOf(repoRoot, base)
  if (!sha) return { sha: null, source: 'computed', checks: {}, fails: [], unknownIds: ids }
  const repoName = basename(String(repoRoot).replace(/[\\/]+$/, ''))
  const file = baselineFile(dataDir, repoName, sha)
  const stored = readBaseline(file)
  const checks = { ...(stored ? stored.checks : {}) }
  let fails = stored ? [...stored.fails] : []
  // A stored unknown/notrun is not an answer: it is re-run.
  const missing = ids.filter((id) => checks[id] !== 'pass' && checks[id] !== 'fail')
  let source = 'stored'
  if (missing.length) {
    source = 'computed'
    let res = null
    try { res = (await runChecks?.(missing)) || null } catch { res = null }
    const newFails = Array.isArray(res?.fails) ? res.fails : []
    fails = fails.filter((f) => !missing.includes(f.check)).concat(newFails)
    for (const id of missing) {
      const s = res?.[id]
      checks[id] = STATUSES.has(s) ? s : 'unknown'
    }
    writeBaseline(file, { schema: 1, baseSha: sha, checks, fails })
  }
  const unknownIds = ids.filter((id) => checks[id] !== 'pass' && checks[id] !== 'fail')
  return { sha, source, checks, fails, unknownIds }
}
