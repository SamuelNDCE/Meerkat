// `meerkat findings` and `meerkat finding <id>`: read the findings.json a run saved (lib/findingsdoc.mjs). Text from the file is data: it is
// cleaned before it is printed.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { filterFindings, readFindings } from './findingsdoc.mjs'
import { historyFile, readHistory, writeAtomic } from './findingshistory.mjs'
import { isSeverity, SEVERITIES, SEVERITY_RANK } from './findings.mjs'
import { latestRunDir, latestRunDirOf, logRoot } from './runlog.mjs'
import { resolveRun } from './runs.mjs'
import { stripControl } from './tui/safe.mjs'

const one = (x) => stripControl(String(x ?? ''))
const RUN_ID = /^\d{8}-\d{6}/
const cut = (t, n) => (t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)
const EXPORTS = { sarif: 'findings.sarif', md: 'findings.md', json: 'findings.json' }

// A path to a run folder itself, accepted only when its real path is inside Meerkat's own log folder (runs/) and it holds findings.json.
export function runFolderInLogRoot(env, target) {
  try {
    const root = realpathSync(join(logRoot(env), 'runs'))
    const real = realpathSync(resolve(String(target)))
    const rel = relative(root, real)
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).length !== 1) return null
    return existsSync(join(real, 'findings.json')) ? real.split('\\').join('/') : null
  } catch {
    return null
  }
}

// The run folder to read: nothing given = the newest run; a run id (or the start of one); else a project folder = its newest run.
export function resolveFindingsRun(env, target) {
  if (!target) {
    const dir = latestRunDir(env)
    return dir ? { ok: true, dir } : { ok: false, text: 'No run has been saved yet. Try: meerkat verify' }
  }
  if (RUN_ID.test(String(target))) return resolveRun(env, target)
  let isDir = false
  try {
    isDir = statSync(resolve(String(target))).isDirectory()
  } catch {
    /* not a folder */
  }
  if (!isDir) {
    // Not a folder either: a project name picks that project's newest run.
    const byName = latestRunDirOf(env, target)
    return byName ? { ok: true, dir: byName } : { ok: false, text: `"${one(target)}" is not a run id, a project name or a folder. See: meerkat run list` }
  }
  const h = readHistory(historyFile(env, resolve(String(target))))
  const dir = h?.lastRunDir ?? runFolderInLogRoot(env, target)
  return dir ? { ok: true, dir } : { ok: false, text: `No findings are saved for ${one(target)} yet. Run: meerkat verify ${one(target)}` }
}

export function loadRunFindings(env, target) {
  const r = resolveFindingsRun(env, target)
  if (!r.ok) return r
  const doc = readFindings(r.dir)
  return doc ? { ok: true, dir: r.dir, doc } : { ok: false, text: `The run ${one(r.dir)} has no findings.json (it was saved by an older Meerkat, or the run did not finish).` }
}

// With `color` (a terminal) the severity word is coloured: critical red, high orange, medium yellow, low and info white. The words stay.
const SEV_SGR = { critical: '31', high: '38;5;208', medium: '33', low: '97', info: '37' }
export function findingsTable(rows, { color = false } = {}) {
  if (!rows.length) return 'No findings match.'
  const head = ['SEVERITY', 'RULE', 'WHERE', 'WHAT', 'STATUS']
  const cells = rows.map((f) => [f.severity, cut(one(f.rule ?? f.check), 26), cut(f.file ? `${one(f.file)}${f.line ? `:${f.line}` : ''}` : '(no file)', 36), cut(one(f.message), 60), f.status ?? ''])
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (c) => c.map((x, i) => (color && i === 0 && SEV_SGR[x] ? `[${SEV_SGR[x]}m${x.padEnd(w[i])}[0m` : x.padEnd(w[i]))).join('  ').trimEnd()
  return [line(head), ...cells.map(line)].join('\n')
}

export function findingDetailText(f, doc = null) {
  const by = f.detectedBy ?? {}
  const rows = [
    `finding ${one(f.id)}   [${one(f.severity)}]   ${one(f.status)}`,
    '',
    `what:        ${one(f.message)}`,
    `where:       ${f.file ? `${one(f.file)}${f.line ? `:${f.line}` : ''}${f.occurrences > 1 ? ` (and ${f.occurrences - 1} more place(s))` : ''}` : '(no file)'}`,
    ...(f.evidence ? [`evidence:    ${one(f.evidence)}`] : []),
    `suite:       ${one(f.suite)}`,
    `rule:        ${f.rule ? one(f.rule) : '(none)'}`,
    `detected by: check ${one(by.check)}${by.checkTitle ? ` (${one(by.checkTitle)})` : ''}`,
    `             pack ${one(by.pack ?? 'none')}, ${one(by.origin ?? 'bundled')}${by.script ? `, script ${one(by.script)}` : ''}${by.tool ? `, tool ${one(by.tool.name)}${by.tool.version ? ` ${one(by.tool.version)}` : ''}` : ''}`,
    ...(by.command ? [`             command: ${one([by.command.cmd, ...(by.command.args ?? [])].join(' '))}`] : []),
    `confidence:  ${one(f.confidence)}${f.confidence === 'high' ? ' (the check reported it as a finding)' : ' (read from the check output)'}`,
    `log:         ${f.logFile ? one(f.logFile) : '(none)'}`,
    `fix:         ${f.fix ? one(f.fix) : '(no hint from the check)'}`,
    `first seen:  ${one(f.firstSeen)}${doc ? `   in run ${one(doc.run.id)}` : ''}`,
  ]
  if (f.rawOutput?.length) rows.push('', 'raw output (first lines):', ...f.rawOutput.map((l) => `  | ${one(l)}`))
  return rows.join('\n')
}

// The newest run's findings for `meerkat_last`: counts and the top 20 (most severe first).
export function findingsSummary(env, limit = 20) {
  const r = loadRunFindings(env)
  if (!r.ok) return null
  const top = [...r.doc.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, limit).map((f) => ({ id: f.id, severity: f.severity, rule: f.rule, check: f.check, suite: f.suite, file: f.file, line: f.line, message: one(f.message), status: f.status }))
  return { counts: r.doc.counts, top, runFolder: r.dir, findingsFile: join(r.dir, 'findings.json').split('\\').join('/') }
}

// plan = { noun: 'findings'|'finding', verb, target, id, flags }. Returns the exit code.
export function findingsCommand(plan, ctx) {
  const { out, err, env = process.env } = ctx
  const f = plan.flags ?? {}
  if (plan.noun === 'finding') {
    const r = loadRunFindings(env, plan.target)
    if (!r.ok) return (err(r.text), 1)
    const id = String(plan.id ?? '').toLowerCase()
    const hits = r.doc.findings.filter((x) => x.id === id || (id.length >= 4 && x.id.startsWith(id)))
    if (hits.length !== 1) {
      err(hits.length ? `"${one(plan.id)}" matches ${hits.length} findings. Give more of the id.` : `No finding "${one(plan.id)}" in run ${one(r.doc.run.id)}. See: meerkat findings`)
      return 1
    }
    out(f.json ? JSON.stringify(hits[0], null, 2) : findingDetailText(hits[0], r.doc))
    return 0
  }
  const r = loadRunFindings(env, plan.target)
  if (!r.ok) return (err(r.text), 1)
  if (f.export) {
    const name = EXPORTS[f.export]
    if (!name) return (err('Say which format: --export sarif, md or json'), 2)
    let text
    try {
      text = readFileSync(join(r.dir, name), 'utf8')
    } catch {
      return (err(`The run ${one(r.dir)} has no ${name}.`), 1)
    }
    if (!plan.exportFile) return (out(text.trimEnd()), 0)
    const target = resolve(ctx.cwd ?? process.cwd(), String(plan.exportFile))
    if (!writeAtomic(target, text)) return (err(`Could not write ${one(target)}`), 1)
    out(`wrote ${target}`)
    return 0
  }
  const limit = Number(f.limit) > 0 ? Math.floor(Number(f.limit)) : 50
  let rows
  if (f.fixed) rows = r.doc.fixed.map((x) => ({ severity: x.severity ?? 'info', rule: x.rule ?? null, check: x.check ?? '', file: x.file ?? null, line: x.line ?? 0, message: x.title ?? x.id, status: 'fixed', id: x.id }))
  else rows = filterFindings(r.doc.findings, { severity: f.severity, suite: f.suite, check: f.check, onlyNew: Boolean(f.new) })
  const shown = rows.slice(0, limit)
  if (f.json) out(JSON.stringify({ run: r.doc.run.id, runFolder: r.dir, counts: r.doc.counts, total: rows.length, findings: shown }, null, 2))
  else {
    out(`run ${one(r.doc.run.id)}: ${r.doc.counts.total} finding(s), ${r.doc.counts.new} new, ${r.doc.counts.known} known, ${r.doc.counts.fixed} fixed since the last comparable run`)
    out(findingsTable(shown, { color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.env.MEERKAT_PLAIN }))
    if (rows.length > shown.length) out(`... and ${rows.length - shown.length} more (use --limit)`)
    out('One finding in full: meerkat finding <id>')
  }
  if (f.failOn) {
    if (!isSeverity(f.failOn)) return (err(`--fail-on takes one of: ${SEVERITIES.join(', ')}`), 2)
    const min = SEVERITY_RANK[f.failOn]
    if (r.doc.findings.some((x) => SEVERITY_RANK[x.severity] >= min)) return 1
  }
  return 0
}
