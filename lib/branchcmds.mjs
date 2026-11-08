// `meerkat verdict` (one line for a branch) and `meerkat top` (one table of the worst findings in the changed files). Both run the gate on the
// folder (lib/gate.mjs gatherGate) and read its rows; neither starts a check of its own.
import { defaultSeverity, isSeverity, SEVERITY_RANK } from './findings.mjs'
import { EXIT, gatherGate } from './gate.mjs'
import { layoutClassOf } from './gatepaths.mjs'

const failing = (r) => r.kind === 'fail' || r.kind === 'crash'

// { blocking, preExisting }: blocking = findings in files the branch changed; preExisting = findings in code it did not change (other files,
// and findings that were already on the base). Layout notes (a missing lockfile, say) are not code and count for neither.
export function verdictCounts(out) {
  let blocking = 0
  let preExisting = out.hidden ?? 0
  for (const r of out.rows ?? []) {
    if (failing(r)) blocking += r.places?.length || r.findings?.length || 1
    if (r.kind === 'fail') preExisting += r.outside ?? 0
    // A check whose findings are all in untouched files is listed as project-wide; its places are pre-existing code, except for layout/history checks (a missing lockfile is not code).
    if (r.kind === 'wide' && !layoutClassOf(r.id)) preExisting += r.places?.length ?? 0
  }
  return { blocking, preExisting }
}

export function verdictLine({ blocking, preExisting }) {
  if (blocking > 0) return `FAIL ${blocking} blocking in changed files`
  if (preExisting > 0) return `FAIL-PRE-EXISTING only: ${preExisting} findings in code this branch did not change`
  return 'PASS'
}

export async function runVerdict(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const bad = argv.find((a, i) => a.startsWith('-') && !['--base', '--app', '--no-cache', '--max-seconds'].includes(a) && argv[i - 1] !== '--max-seconds' && argv[i - 1] !== '--base' && argv[i - 1] !== '--app')
  if (bad) {
    err(`meerkat verdict: unknown option ${bad}. usage: meerkat verdict [folder] [--base <ref>]`)
    return EXIT.usage
  }
  const g = await gatherGate(argv, { env, cwd, err, progress: err })
  if (g.error) {
    err(`meerkat verdict: ${g.error}`)
    return g.code
  }
  if (g.out.exitCode === EXIT.notRun && !g.out.rows?.length) {
    out(`NOT-RUN ${g.out.note || 'no check could run'}`)
    return EXIT.notRun
  }
  const counts = verdictCounts(g.out)
  out(verdictLine(counts))
  return counts.blocking > 0 || counts.preExisting > 0 ? 1 : 0
}

// Every blocking place of the changed files, worst first: severity, then check id, then file and line.
export function topRows(out, checks = []) {
  const byId = new Map(checks.map((c) => [c.id, c]))
  const rows = []
  for (const r of out.rows ?? []) {
    if (!failing(r)) continue
    const places = r.places?.length ? r.places : [{ file: '', line: 0, message: String(r.detail ?? '').split(String.fromCharCode(10))[0].slice(0, 200) }]
    for (const p of places) {
      const f = (r.findings ?? []).find((x) => x?.file && String(x.file).replace(/\\/g, '/').endsWith(p.file) && Number(x.line) === p.line)
      const severity = isSeverity(f?.severity) ? f.severity : defaultSeverity(byId.get(r.id))
      rows.push({ file: p.file || '(no file)', check: r.id, line: p.line, message: p.message, severity })
    }
  }
  return rows.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || a.check.localeCompare(b.check) || a.file.localeCompare(b.file) || a.line - b.line)
}

export function topTable(rows, limit) {
  if (!rows.length) return 'no findings in the changed files'
  const shown = rows.slice(0, limit).map((r) => [r.file, r.check, r.line ? String(r.line) : '-', (r.message || '').replace(/\s+/g, ' ').slice(0, 90)])
  const head = ['file', 'check', 'line', 'message']
  const width = head.map((h, i) => Math.max(h.length, ...shown.map((r) => r[i].length)))
  const fmt = (r) => r.map((c, i) => (i === 3 ? c : c.padEnd(width[i]))).join('  ').trimEnd()
  const lines = [fmt(head), `${width.slice(0, 3).map((w) => '-'.repeat(w)).join('  ')}  -------`, ...shown.map(fmt)]
  if (rows.length > shown.length) lines.push(`(${rows.length - shown.length} more; --limit ${rows.length} shows all)`)
  return lines.join('\n')
}

export async function runTop(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let limit = 10
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n < 1) {
        err('meerkat top: --limit needs a whole number, 1 or more')
        return EXIT.usage
      }
      limit = n
    } else rest.push(argv[i])
  }
  const g = await gatherGate([...rest, '--all-findings'], { env, cwd, err, progress: err })
  if (g.error) {
    err(`meerkat top: ${g.error}`)
    return g.code
  }
  out(topTable(topRows(g.out, g.checks), limit))
  return 0
}
