// Suggested fix commands for a finding. Meerkat never runs these; they are text for a person to review.

export function suggestionsFor(finding) {
  const f = finding ?? {}
  const raw = String(f.rawOutput ?? '')
  const isAudit = f.check === 'cargo-audit' || f.detectedBy?.tool?.name === 'cargo-audit' || /RUSTSEC/.test(raw)
  if (isAudit) {
    const out = []
    const seen = new Set()
    for (const b of raw.split(/(?=^\s*Crate:)/m)) {
      const crate = /Crate:\s+(\S+)/.exec(b)?.[1]
      if (!crate || seen.has(crate)) continue
      seen.add(crate)
      const solution = /Solution: Upgrade to ([^\n]+)/.exec(b)?.[1]?.trim()
      if (solution) out.push({ command: `cargo update -p ${crate}`, why: `upgrade to ${solution}. cargo update stays inside the version range in Cargo.toml; if the range excludes the fix, raise the requirement in Cargo.toml by hand.` })
      else out.push({ command: `cargo update -p ${crate}`, why: 'advisory has no listed fix; check the RUSTSEC link' })
    }
    if (out.length) return out
  }
  if (typeof f.fix === 'string' && f.fix.trim()) return [{ command: f.fix, why: "the check's own fix hint" }]
  return []
}

export function suggestionsMarkdown(doc) {
  const parts = []
  for (const f of doc?.findings ?? []) {
    const s = suggestionsFor(f)
    if (!s.length) continue
    const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(whole check)'
    const lines = [`## ${f.title ?? f.id}`, '', where, '']
    for (const x of s) lines.push(x.why, '', '```bash', x.command, '```', '')
    parts.push(lines.join('\n'))
  }
  if (!parts.length) return '# Suggested fixes\n\nNo suggestions for these findings.\n'
  return `# Suggested fixes\n\nMeerkat never runs these; review before running.\n\n${parts.join('\n')}`
}
