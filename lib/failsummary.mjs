// The failure part of a run's summary: for each check that has findings, how many and every file:line, so one failure is never shown
// as if it were the only one. Pure: findings in, lines out. The list is cut at `cap` places (default 20) with the total and the log path.
export const FAIL_CAP = 20

const place = (f) => (f?.file ? `${String(f.file)}${f.line ? `:${f.line}` : ''}` : '(no file)')

// findings: [{ check, file, line }]. Returns [{ check, count, places: ['file:line', ...] }] in first-seen order.
export function groupFailures(findings = []) {
  const by = new Map()
  for (const f of findings) {
    const id = String(f?.check ?? f?.id ?? '?')
    if (!by.has(id)) by.set(id, { check: id, count: 0, places: [] })
    const g = by.get(id)
    g.count++
    const p = place(f)
    if (!g.places.includes(p)) g.places.push(p)
  }
  return [...by.values()]
}

export function failureLines(findings = [], { cap = FAIL_CAP, logPath = null } = {}) {
  const groups = groupFailures(findings)
  const lines = []
  for (const g of groups) {
    const shown = g.places.slice(0, cap)
    const more = g.places.length - shown.length
    lines.push(`  ${g.check}: ${g.count} failure(s) in ${g.places.length} place(s): ${shown.join(', ')}${more > 0 ? `, ... and ${more} more (${g.count} failure(s) in total${logPath ? `, all in ${logPath}` : ''})` : ''}`)
  }
  return lines
}
