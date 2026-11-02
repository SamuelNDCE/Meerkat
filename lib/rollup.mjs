// What a first scan shows by default. Two ideas, both about the reader's time, neither about hiding a defect:
//   roll-up:  size and complexity measures (line length, long functions, complexity, nesting, parameters) are measurements, not bugs. A file with 40 long
//             lines is ONE finding that says so, with the first lines listed, instead of 40.
//   hidden:   pedantic style rules (undocumented Rust items, string errors, markup nitpicks) are real but never urgent. They are counted and named in the
//             run (doc.hidden) and shown again with MEERKAT_FINDINGS=all (or `--findings all`), never silently dropped.
// Security, correctness and configuration rules are never rolled up or hidden.

// One finding per rule per file.
export const ROLLUP_RULES = new Set(['line-length', 'long-functions', 'cyclomatic-complexity', 'deep-nesting', 'many-parameters'])

// Rust style families (documentation, error style, performance hints, async hints) at low or info severity.
const RUST_STYLE = /^r(api|err|perf|async)-/
// Markup and text nitpicks that do not change what the project does.
const MARKUP_NITS = new Set(['markdown-code-fences', 'markdown-headings', 'final-newline', 'whitespace', 'trailing-whitespace', 'html-structure', 'table-headers'])

export const isHiddenByDefault = (f) => {
  const rule = f.rule ?? ''
  if (MARKUP_NITS.has(rule)) return true
  return RUST_STYLE.test(rule) && (f.severity === 'low' || f.severity === 'info')
}

export const showAll = (env = process.env) => String(env?.MEERKAT_FINDINGS ?? '').toLowerCase() === 'all'

// merged: Map(id -> finding) built by buildFindings. Returns { rolled, hidden } where rolled is how many findings were folded away and hidden is
// [{ rule, count }]; the map is changed in place (rolled-up findings replaced by one per rule and file, hidden ones removed unless showAll).
export function applyRollup(merged, { all = false, fingerprint }) {
  const groups = new Map()
  for (const [id, f] of merged) {
    if (!ROLLUP_RULES.has(f.rule ?? '')) continue
    const key = `${f.rule}\u0000${f.file ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push([id, f])
  }
  let rolled = 0
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const [, first] = members[0]
    const lines = members.flatMap(([, f]) => f.lines?.length ? f.lines : f.line ? [f.line] : []).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b)
    const total = members.reduce((t, [, f]) => t + (f.occurrences ?? 1), 0)
    for (const [id] of members) merged.delete(id)
    const message = `${total} places in this file: ${first.title}. First at ${lines.slice(0, 5).map((n) => `line ${n}`).join(', ')}${lines.length > 5 ? `, and ${lines.length - 5} more` : ''}. Worst case as reported: ${first.message}`
    const id = fingerprint({ rule: first.rule, check: first.check, file: first.file, message: `${first.rule} rolled up` })
    merged.set(id, { ...first, id, message, line: lines[0] ?? first.line, lines: lines.slice(0, 20), occurrences: total, rolledUp: members.length })
    rolled += members.length - 1
  }
  const hiddenBy = new Map()
  const hiddenIds = new Set()
  if (!all) {
    for (const [id, f] of [...merged]) {
      if (!isHiddenByDefault(f)) continue
      hiddenBy.set(f.rule, (hiddenBy.get(f.rule) ?? 0) + 1)
      hiddenIds.add(id)
      merged.delete(id)
    }
  }
  return { rolled, hiddenIds, hidden: [...hiddenBy].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count) }
}
