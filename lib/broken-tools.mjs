// Broken tools. A check is BROKEN when Meerkat's own code path around it fails: it throws inside the runner, or its tool returns output Meerkat
// cannot read. That is not a finding about the project. Two BROKEN strikes for the same tool in one run skip that tool for the rest of the run
// (every other check still runs); the broken mark is kept between runs in a small JSON file in Meerkat's state folder, the tool is tried again
// on the next run, and a pass clears the mark.
// Not strikes (NOT RUN, with the reason shown): the tool is not installed, it cannot scan that kind of target, the target is unreadable, the scan timed out.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from './lockfile.mjs'

export const MAX_STRIKES = 2

// The state folder: MEERKAT_HOME, else ~/.meerkat. Never inside the scanned project.
export const stateFile = (env = process.env) => join(env.MEERKAT_HOME || join(homedir(), '.meerkat'), 'broken-tools.json')

// The tool a check belongs to: its `tool`, else the first program it needs, else the command it runs, else its own id.
export function toolOf(check) {
  if (check?.tool) return String(check.tool)
  if (check?.needs?.length) return String(check.needs[0])
  const cmd = check?.run && typeof check.run === 'object' ? String(check.run.cmd ?? '') : ''
  if (cmd && cmd !== 'node' && cmd !== 'bash') return cmd
  return String(check?.id ?? 'unknown')
}

export function loadBroken(env = process.env) {
  try {
    const data = JSON.parse(readFileSync(stateFile(env), 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function save(data, env) {
  try {
    const file = stateFile(env)
    mkdirSync(dirname(file), { recursive: true })
    writeFileAtomic(file, JSON.stringify(data, null, 2))
  } catch {
    /* the state is a convenience: a folder that cannot be written never fails a run */
  }
}

export function markBroken(tool, { strikes, error, at = new Date().toISOString() }, env = process.env) {
  save({ ...loadBroken(env), [tool]: { strikes, error: String(error ?? '').slice(0, 500), at } }, env)
}

export function clearBroken(tool, env = process.env) {
  const data = loadBroken(env)
  if (!(tool in data)) return false
  delete data[tool]
  save(data, env)
  return true
}

export const skippedText = (tool, strikes, error) => `SKIPPED: broken. ${tool} failed inside Meerkat ${strikes} times in this run (${error}); it is tried again on the next run`

// Per-run strike counting. strike() returns { strikes, skip }.
export function createStrikes(env = process.env) {
  const counts = new Map()
  const last = new Map()
  const marked = new Set(Object.keys(loadBroken(env)))
  return {
    strike(tool, error) {
      const n = (counts.get(tool) ?? 0) + 1
      counts.set(tool, n)
      last.set(tool, error)
      if (n >= MAX_STRIKES) {
        markBroken(tool, { strikes: n, error }, env)
        marked.add(tool)
      }
      return { strikes: n, skip: n >= MAX_STRIKES }
    },
    isSkipped: (tool) => (counts.get(tool) ?? 0) >= MAX_STRIKES,
    detail: (tool) => skippedText(tool, counts.get(tool) ?? 0, last.get(tool) ?? ''),
    pass: (tool) => (marked.delete(tool) ? clearBroken(tool, env) : false),
  }
}
