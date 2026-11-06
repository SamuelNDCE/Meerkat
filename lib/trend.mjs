// Per-run counts over the cross-run history.

export function trendRows(history, { limit = 20 } = {}) {
  const runs = Array.isArray(history?.runs) ? history.runs : []
  const rows = []
  runs.forEach((r, i) => {
    const items = Array.isArray(r.items) && r.items.length ? r.items : null
    const ids = r.ids ?? items?.map((x) => x.id) ?? []
    const sev = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const x of items ?? []) if (x.severity in sev) sev[x.severity]++
    let prev = null
    for (let j = i - 1; j >= 0; j--) {
      if (runs[j].kind === r.kind) {
        prev = runs[j]
        break
      }
    }
    const cur = new Set(ids)
    const prevIds = new Set(prev?.ids ?? [])
    rows.push({
      runId: r.runId,
      at: r.at,
      kind: r.kind,
      total: items ? items.length : ids.length,
      ...sev,
      newCount: prev ? ids.filter((id) => !prevIds.has(id)).length : ids.length,
      fixedCount: prev ? [...prevIds].filter((id) => !cur.has(id)).length : 0,
    })
  })
  return rows.slice(-limit).reverse()
}

export function trendText(rows) {
  if (!rows?.length) return 'No history yet. Run meerkat once to start one.'
  return rows
    .map((r) => [r.runId, r.kind, `total ${r.total}`, `critical ${r.critical}`, `high ${r.high}`, `medium ${r.medium}`, `low ${r.low}`, `info ${r.info}`, `new ${r.newCount}`, `fixed ${r.fixedCount}`].join('  '))
    .join('\n')
}
