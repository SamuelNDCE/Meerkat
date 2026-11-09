// A repo-level, reasoned ignore file: `.meerkat-ignores.json` at the project root (or the app folder).
//   [ { "check": "cp-js", "path": "lib/x.mjs", "line": 12, "snippet": "spawnSync(cmd, {", "reason": "why this is fine", "owner": "samuel" } ]
// (or { "ignores": [ ... ] }). `check` is a check id or a rule id. An entry needs a reason and an owner, or it suppresses nothing and is
// reported as unusable. A line-keyed entry also matches when the line moved, if the finding's line text holds `snippet`.
// Every suppression is reported (IGNORED <check> <file>:<line>: <reason> (owner <owner>)), never silently skipped.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_IGNORES_FILE = '.meerkat-ignores.json'

// { entries: [valid], problems: [text] }
export function readRepoIgnores(roots) {
  for (const r of roots) {
    let raw
    try {
      raw = readFileSync(join(r, REPO_IGNORES_FILE), 'utf8')
    } catch {
      continue
    }
    try {
      const j = JSON.parse(raw)
      const list = Array.isArray(j) ? j : Array.isArray(j?.ignores) ? j.ignores : null
      if (!list) return { entries: [], problems: [`${REPO_IGNORES_FILE} must be a list of { check, path, line, reason, owner } entries`] }
      const entries = []
      const problems = []
      list.forEach((e, i) => {
        const ok = e && typeof e === 'object' && typeof e.check === 'string' && e.check && typeof e.path === 'string' && e.path
        const why = typeof e?.reason === 'string' ? e.reason.trim() : ''
        const owner = typeof e?.owner === 'string' ? e.owner.trim() : ''
        if (!ok || !why || !owner) problems.push(`${REPO_IGNORES_FILE} entry ${i + 1} needs check, path, reason and owner, so it suppresses nothing`)
        else entries.push({ check: e.check, path: e.path.split(String.fromCharCode(92)).join('/'), line: Number.isInteger(e.line) ? e.line : 0, snippet: typeof e.snippet === 'string' ? e.snippet.trim() : '', reason: why, owner })
      })
      return { entries, problems }
    } catch {
      return { entries: [], problems: [`${REPO_IGNORES_FILE} is not valid JSON, so nothing is ignored`] }
    }
  }
  return { entries: [], problems: [] }
}

// The entry that covers a finding ({ check, rule, file, line }), or null. lineAt(file, line) gives the text of that line.
export function matchRepoIgnore(entries, f, lineAt) {
  if (!f.file || !entries.length) return null
  const file = String(f.file).split(String.fromCharCode(92)).join('/')
  return entries.find((e) => {
    if (e.path !== file || !(e.check === f.check || e.check === f.rule)) return false
    if (!e.line || e.line === f.line) return true
    const text = e.snippet && f.line ? lineAt?.(f.file, f.line) : null
    return Boolean(text && text.includes(e.snippet))
  }) ?? null
}

export const ignoredLine = (e, f) => `IGNORED ${f.check} ${f.file}${f.line ? `:${f.line}` : ''}: ${e.reason} (owner ${e.owner})`
