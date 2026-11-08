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

// Never silent: a run with no result prints one line naming the reason and the next step. Exit 2 for a usage or environment problem (a bad base ref,
// not a git repo), 1 when there is simply no result (nothing changed, no check could run, the run timed out).
const noResult = (out, reason, next, code) => {
  out(`NO-RESULT: ${reason}. next: ${next}`)
  return code
}
const HARD_SECONDS = (env) => (Number(env.MEERKAT_VERDICT_TIMEOUT_S) > 0 ? Number(env.MEERKAT_VERDICT_TIMEOUT_S) : 900)

// Runs the gate with a time limit. Returns { g } or { stop: <exit code> } after printing the reason.
async function gather(word, argv, { env, cwd, out, err }) {
  let timer
  const limit = HARD_SECONDS(env)
  const timeout = new Promise((res) => {
    timer = setTimeout(() => res({ timedOut: true }), limit * 1000)
    timer.unref?.()
  })
  let g
  try {
    g = await Promise.race([gatherGate(argv, { env, cwd, err }), timeout])
  } catch (e) {
    clearTimeout(timer)
    return { stop: noResult(out, `the gate failed to run (${String(e?.message ?? e).split(String.fromCharCode(10))[0].slice(0, 120)})`, `run meerkat gate --no-input to see the full error`, 1) }
  }
  clearTimeout(timer)
  if (g.timedOut) return { stop: noResult(out, `the gate did not finish in ${limit}s`, `run meerkat gate in the background, or raise MEERKAT_VERDICT_TIMEOUT_S`, 1) }
  if (g.error) {
    const ref = /git does not know that ref|share no history|no base to compare/.test(g.error)
    const nope = /not inside a git work tree|git was not found/.test(g.error)
    return { stop: noResult(out, g.error.slice(0, 200), ref ? 'pass a base that exists, for example --base origin/main' : nope ? 'run it inside a git repository' : `see meerkat ${word} --help`, 2) }
  }
  if (!g.out.files?.length) return { stop: noResult(out, `nothing changed compared with ${g.changed.ref ?? 'the base'}, so there is nothing to judge`, 'commit or save a change, or pass --base <ref> to compare with another ref', 1) }
  if (!g.out.rows?.length) return { stop: noResult(out, g.out.note || 'no check could run on the changed files', 'run meerkat doctor, or meerkat gate --verbose', 1) }
  return { g }
}

export async function runVerdict(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const bad = argv.find((a, i) => a.startsWith('-') && !['--base', '--app', '--no-cache'].includes(a) && argv[i - 1] !== '--base' && argv[i - 1] !== '--app')
  if (bad) return noResult(out, `unknown option ${bad}`, 'usage: meerkat verdict [folder] [--base <ref>]', EXIT.usage)
  const r = await gather('verdict', argv, { env, cwd, out, err })
  if (r.stop !== undefined) return r.stop
  const counts = verdictCounts(r.g.out)
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
      if (!Number.isInteger(n) || n < 1) return noResult(out, '--limit needs a whole number, 1 or more', 'usage: meerkat top [folder] [--base <ref>] [--limit <n>]', EXIT.usage)
      limit = n
    } else rest.push(argv[i])
  }
  const r = await gather('top', [...rest, '--all-findings'], { env, cwd, out, err })
  if (r.stop !== undefined) return r.stop
  out(topTable(topRows(r.g.out, r.g.checks), limit))
  return 0
}
