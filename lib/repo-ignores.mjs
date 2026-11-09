// A repo-level, reasoned ignore file: `.meerkat-ignores.json` at the project root (or the app folder).
//   [ { "check": "cp-js", "path": "lib/x.mjs", "line": 12, "snippet": "spawnSync(cmd, {", "reason": "why this is fine", "owner": "samuel" } ]
// (or { "ignores": [ ... ] }). `check` is a check id or a rule id. An entry needs a reason, an owner and a line: an integer >= 1, or the
// explicit "*" for a deliberate file-wide ignore (reported as FILE-WIDE). An entry without them suppresses nothing and is reported.
// Each line-keyed entry covers at most ONE finding (the nearest line). When the line moved, `snippet` finds it: the finding's line text must
// equal the snippet after trim, or the snippet must be at least 12 characters and be inside the line. An entry that covers nothing is STALE.
// Every suppression is reported (IGNORED <check> <file>:<line>: <reason> (owner <owner>)), never silently skipped.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_IGNORES_FILE = '.meerkat-ignores.json'
export const MIN_SNIPPET = 12
const slash = (p) => String(p).split(String.fromCharCode(92)).join('/')

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
        const n = i + 1
        const ok = e && typeof e === 'object' && typeof e.check === 'string' && e.check && typeof e.path === 'string' && e.path
        const why = typeof e?.reason === 'string' ? e.reason.trim() : ''
        const owner = typeof e?.owner === 'string' ? e.owner.trim() : ''
        const fileWide = e?.line === '*'
        const lineOk = fileWide || (Number.isInteger(e?.line) && e.line >= 1)
        if (!ok || !why || !owner) problems.push(`${REPO_IGNORES_FILE} entry ${n} needs check, path, reason and owner, so it suppresses nothing`)
        else if (!lineOk) problems.push(`${REPO_IGNORES_FILE} entry ${n} (${e.check} ${e.path}) has no line: give an integer line >= 1, or "line": "*" for a deliberate file-wide ignore, so it suppresses nothing`)
        else entries.push({ n, check: e.check, path: slash(e.path), line: fileWide ? 0 : e.line, fileWide, snippet: typeof e.snippet === 'string' ? e.snippet.trim() : '', reason: why, owner })
      })
      return { entries, problems }
    } catch {
      return { entries: [], problems: [`${REPO_IGNORES_FILE} is not valid JSON, so nothing is ignored`] }
    }
  }
  return { entries: [], problems: [] }
}

const sameCheck = (e, f) => e.check === f.check || e.check === f.rule
const snippetHolds = (e, text) => {
  if (!e.snippet || typeof text !== 'string') return false
  const t = text.trim()
  return t === e.snippet || (e.snippet.length >= MIN_SNIPPET && t.includes(e.snippet))
}

// Which findings each entry covers. Returns { by: Map(finding -> entry), stale: [text] }. A line-keyed entry covers one finding, the
// nearest to its line; a file-wide entry covers every finding of its check in the file.
export function assignRepoIgnores(entries, findings, lineAt) {
  const by = new Map()
  const stale = []
  for (const e of entries) {
    const mine = findings.filter((f) => f.file && slash(f.file) === e.path && sameCheck(e, f) && !by.has(f))
    if (e.fileWide) {
      if (!mine.length) stale.push(`STALE ${e.check} ${e.path}:*: matches no finding any more; remove it from ${REPO_IGNORES_FILE}`)
      for (const f of mine) by.set(f, e)
      continue
    }
    const cands = mine.filter((f) => f.line === e.line || snippetHolds(e, lineAt?.(f.file, f.line)))
    cands.sort((a, b) => Math.abs((a.line || 0) - e.line) - Math.abs((b.line || 0) - e.line))
    if (cands.length) by.set(cands[0], e)
    else stale.push(`STALE ${e.check} ${e.path}:${e.line}: matches no finding any more; remove it from ${REPO_IGNORES_FILE}`)
  }
  return { by, stale }
}

export const ignoredLine = (e, f) => `${e.fileWide ? 'FILE-WIDE ' : ''}IGNORED ${f.check} ${f.file}${f.line ? `:${f.line}` : ''}: ${e.reason} (owner ${e.owner})`
