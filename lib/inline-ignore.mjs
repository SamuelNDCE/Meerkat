// Per-line suppression comments: `// meerkat-ignore <check-id> <reason>`, `# meerkat-ignore ...`, `<!-- meerkat-ignore ... -->`.
// A directive on line N suppresses a finding of that check (or rule) reported on line N or line N+1, and nothing else.
// The reason is required: a directive without one suppresses nothing and is itself reported (rule `ignore-missing-reason`).
const DIRECTIVE = /(?:\/\/|#|<!--|\/\*)\s*meerkat-ignore\b([^\r\n]*)/

// All directives in a file's text: [{ line, id, reason }]. `reason` is '' when missing.
export function parseIgnores(text) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = DIRECTIVE.exec(lines[i])
    if (!m) continue
    const rest = m[1].replace(/-->\s*$/, '').replace(/\*\/\s*$/, '').trim()
    const [id = '', ...why] = rest.split(/\s+/)
    out.push({ line: i + 1, id, reason: why.join(' ').trim() })
  }
  return out
}

// Does a directive suppress this finding? Needs the right line, the right id (check or rule), and a reason.
export function ignoredBy(ignores, { check, rule, line }) {
  if (!(line >= 1)) return null
  return ignores.find((d) => d.reason && d.id && (d.id === check || d.id === rule) && (d.line === line || d.line + 1 === line)) ?? null
}

// The directives with no reason, as findings-shaped records for the caller to report.
export const missingReasons = (ignores) => ignores.filter((d) => !d.reason)
