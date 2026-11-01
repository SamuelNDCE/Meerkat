// The detection files of a run: findings.json (canonical), findings.md (for a person), findings.sarif (GitHub code scanning) and
// detections.jsonl (every detection event in time order). Built from the run's results; docs/findings.md describes the schema.
// Nothing here prints or throws to the caller: saveFindings returns null when it could not do its job.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { VERSION } from './version.mjs'
import { redact } from '../thorough/redact.mjs'
import { defaultSeverity, firstLines, fingerprint, MAX_MESSAGE, MAX_OUTPUT_LINE, meetsSeverity, parseOutputLines, ruleForMessage, SEVERITIES, SEVERITY_RANK, toolOf } from './findings.mjs'
import { entryFromDoc, historyFile, historyFromRunFolders, kindOf, priorState, readHistory, saveHistory, updatedHistory, writeAtomic } from './findingshistory.mjs'
import { safeLogPath, stripControl } from './tui/safe.mjs'
import { packOfCheck, suiteIdOf, suiteInfo } from './suites.mjs'

export const SCHEMA_VERSION = 1
const MAX_EVENTS = 20000
const SLASH = (p) => String(p).split('\\').join('/')

// Text that goes into a saved file: control characters out, and a value that looks like a secret is blanked (never kept).
export function sane(text, max = 300) {
  const t = stripControl(text).slice(0, max * 4)
  if (!t) return t
  const r = redact(t)
  const out = r.long ? '' : r.hard || r.soft ? r.text : t
  return out.slice(0, max)
}

// Raw tool output is cleaned as ONE block (so a secret split over lines is seen) before it is split into lines; any hit drops it all.
export function safeRaw(lines) {
  if (!Array.isArray(lines) || !lines.length) return null
  const block = lines.map((l) => stripControl(String(l))).join('\n')
  const r = redact(block)
  if (r.long || r.hard || r.multiline) return null
  return r.text.split('\n').map((l) => sane(l, MAX_OUTPUT_LINE))
}

const stripSaved = (detail) => String(detail ?? '').replace(/\s*\[full output: [^\]]+\]\s*$/, '')

// A file under the project (or the repository), as a project-relative path; null when it is not a real file there.
export function fileFinder(appDir, repoRoot) {
  const roots = [...new Set([appDir, repoRoot].filter(Boolean).map((r) => resolve(r)))]
  return (p) => {
    const text = String(p ?? '')
    if (!text || text.length > 300 || /[\u0000-\u001f]/.test(text)) return null
    const cands = isAbsolute(text) ? [resolve(text)] : roots.map((r) => resolve(r, text))
    for (const abs of cands) {
      try {
        if (!statSync(abs).isFile()) continue
      } catch {
        continue
      }
      const root = roots.find((r) => !relative(r, abs).startsWith('..') && !isAbsolute(relative(r, abs)))
      if (root) return SLASH(relative(root, abs))
    }
    return null
  }
}

function sourceLine(roots, file, line) {
  if (!file || !(line >= 1)) return null
  for (const r of roots) {
    try {
      const abs = resolve(r, file)
      if (relative(r, abs).startsWith('..') || statSync(abs).size > 2_000_000) continue
      return readFileSync(abs, 'utf8').split(/\r?\n/)[line - 1] ?? null
    } catch {
      /* try the next root */
    }
  }
  return null
}

// The source line as evidence, or null: never for the secrets suite, never when redaction would change it, at most 1000 characters.
export function evidenceFor(text, suite) {
  if (suite === 'secrets' || text == null) return null
  const t = stripControl(String(text)).trim()
  if (!t) return null
  const r = redact(String(text))
  if (r.long || r.hard || r.soft || r.text !== String(text)) return null
  return t.slice(0, 1000)
}

const scriptOf = (check) => {
  const a = check?.run?.args?.[0]
  if (check?.run?.cmd !== 'node' || typeof a !== 'string') return null
  const rel = relative(MEERKAT_DIR, a)
  return SLASH(rel.startsWith('..') || isAbsolute(rel) ? a : rel)
}
const commandOf = (r, check) => {
  const spec = check?.run
  if (spec && typeof spec === 'object') return { cmd: sane(spec.cmd, 100), args: (spec.args ?? []).map((a) => sane(String(a).split(SLASH(MEERKAT_DIR)).join('<meerkat>'), 200)) }
  if (r.command) return { cmd: sane(String(r.command).split(' ')[0], 100), args: String(r.command).split(' ').slice(1).map((a) => sane(a, 200)) }
  return null
}

// ---- building the findings ----

// Why a finding of this kind matters, from what Meerkat knows about the suite it came from (no per-rule prose exists, so none is invented).
export function explanationFor(suite, ruleTitle) {
  const s = suiteInfo(suite)
  const parts = []
  if (ruleTitle) parts.push(`The rule says: ${ruleTitle}.`)
  if (s?.purpose) parts.push(`It belongs to the "${s.label}" suite, whose purpose is: ${s.purpose}`)
  return sane(parts.join(' '), 2000)
}

// Two checks that report the same fact are one finding, so a report never says it twice.
//  - SUPERSEDED: a rule whose fact another check reports in more detail is dropped when that check reported something (the deprecated packages of a
//    lockfile come from deprecated-deps with npm's own text, so wh-supply's lockfile-deprecated-entry would repeat them).
//  - the same place and the same words from two different checks: the higher severity stays and `alsoDetectedBy` names the other check.
const SUPERSEDED = [{ check: 'wh-supply', rule: 'lockfile-deprecated-entry', by: 'deprecated-deps' }]
export function dedupe(merged) {
  for (const s of SUPERSEDED) {
    const covered = [...merged.values()].some((f) => f.check === s.by)
    if (!covered) continue
    for (const [id, f] of merged) if (f.check === s.check && f.rule === s.rule) merged.delete(id)
  }
  const seen = new Map()
  for (const [id, f] of [...merged]) {
    if (!f.file || !f.line) continue
    const key = `${f.file}|${f.line}|${String(f.message).toLowerCase()}`
    const first = seen.get(key)
    if (!first || first.check === f.check) {
      seen.set(key, first ?? f)
      continue
    }
    const keep = (SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[first.severity] ?? 0) ? f : first
    const drop = keep === f ? first : f
    keep.alsoDetectedBy = [...new Set([...(keep.alsoDetectedBy ?? []), drop.check])]
    merged.delete(drop.id)
    seen.set(key, keep)
  }
}

export function buildFindings({ results, checks = [], sink = new Map(), appDir, repoRoot = appDir, env = process.env, meta, prior = null, now = () => new Date() }) {
  const byCheck = new Map(checks.map((c) => [c.id, c]))
  const exists = fileFinder(appDir, repoRoot)
  const roots = [...new Set([appDir, repoRoot].filter(Boolean).map((r) => resolve(r)))]
  const raw = []
  const notRun = []
  for (const r of results.filter(Boolean)) {
    const check = byCheck.get(r.id) ?? { id: r.id, title: r.title }
    const suite = r.suite ?? suiteIdOf(check)
    if (r.status === 'NOT RUN') {
      notRun.push({ check: r.id, title: sane(check.title ?? r.title ?? r.id, 200), suite, reason: sane(stripSaved(r.detailFull ?? r.detail), MAX_MESSAGE), install: check.install ? sane(check.install, 2000) : null, logFile: r.logFile ? SLASH(safeLogPath(r.logFile, { env }) ?? '') || null : null })
      continue
    }
    const got = sink.get(r.id) ?? { findings: [], output: '' }
    const tool = toolOf(check)
    const severity = defaultSeverity(check, suite)
    const failedSubs = (r.subs ?? []).filter((s) => s.status === 'FAIL')
    const base = { check: r.id, checkTitle: sane(check.title ?? r.title ?? r.id, 200), suite, pack: packOfCheck(check), origin: check.origin ?? r.origin ?? 'bundled', script: tool ? null : scriptOf(check), tool, command: commandOf(r, check), fix: check.fix ?? check.install ?? null, logFile: r.logFile ? SLASH(safeLogPath(r.logFile, { env }) ?? '') || null : null, ms: r.ms ?? 0 }
    const add = (f) => raw.push({ ...base, rawOutput: null, ...f })
    if (got.findings.length) {
      for (const f of got.findings) {
        const sub = failedSubs.find((s) => s.id === f.rule) ?? (r.subs ?? []).find((s) => s.id === f.rule)
        add({ severity: f.severity, rule: f.rule, ruleTitle: sub ? String(sub.reason ?? '').replace(/^\d+ found:\s*/, '') : null, file: f.file, line: f.line, message: f.message, confidence: 'high' })
      }
      continue
    }
    if (r.status !== 'FAIL') continue
    const detail = stripSaved(r.detailFull ?? r.detail)
    if (tool) {
      add({ severity, rule: null, ruleTitle: null, file: null, line: 0, message: detail || `${check.title ?? r.id} failed`, rawOutput: firstLines(got.output, 200), confidence: 'medium' })
      continue
    }
    const parsed = parseOutputLines(got.output, exists)
    for (const p of parsed) {
      const rule = ruleForMessage(p.message, failedSubs)
      add({ severity, rule: rule?.id ?? null, ruleTitle: rule?.title ?? null, file: p.file, line: p.line, message: p.message, confidence: 'medium' })
    }
    if (parsed.length) continue
    if (failedSubs.length) {
      for (const s of failedSubs) add({ severity, rule: s.id, ruleTitle: String(s.reason ?? '').replace(/^\d+ found:\s*/, ''), file: null, line: 0, message: s.reason || `${s.id} failed`, confidence: 'medium' })
      continue
    }
    add({ severity, rule: null, ruleTitle: null, file: null, line: 0, message: detail || `${check.title ?? r.id} failed`, rawOutput: firstLines(got.output, 200), confidence: 'medium' })
  }
  // One finding per fingerprint: the same thing found on several lines is one finding with its other lines listed.
  const merged = new Map()
  for (const f of raw) {
    // The secrets suite never keeps a sample of a match: a trailing `[AKIA]` style sample goes, and a message that is only the rule id becomes the rule title.
    const message = sane(f.suite === 'secrets' ? (f.ruleTitle && (f.message === f.rule || f.message.startsWith(`${f.rule} `)) ? f.ruleTitle : f.message.replace(/\s*\[[^\]\s]{1,8}\]\s*$/, '')) : f.message, MAX_MESSAGE)
    const file = f.file ? sane(f.file, 300) : null
    const id = fingerprint({ rule: f.rule, check: f.check, file, message })
    const have = merged.get(id)
    if (have) {
      have.occurrences++
      if (f.line && have.lines.length < 20 && !have.lines.includes(f.line)) have.lines.push(f.line)
      continue
    }
    const evidence = file ? evidenceFor(sourceLine(roots, file, f.line), f.suite) : null
    merged.set(id, { id, severity: f.severity, title: sane(f.ruleTitle || message, 500), message, suite: f.suite, check: f.check, rule: f.rule, file, line: file ? f.line : null, column: null, ...(evidence ? { evidence } : {}), detectedBy: { check: f.check, checkTitle: f.checkTitle, pack: f.pack, origin: f.origin, script: f.script, tool: f.tool, rule: f.rule, command: f.command }, fix: f.fix ? sane(f.fix, 2000) : null, explanation: explanationFor(f.suite, f.ruleTitle), confidence: f.confidence, ...(safeRaw(f.rawOutput) ? { rawOutput: safeRaw(f.rawOutput) } : {}), occurrences: 1, lines: f.line ? [f.line] : [], logFile: f.logFile })
  }
  dedupe(merged)
  const state = prior ?? priorState([], 'run', '')
  const nowIso = now().toISOString()
  const findings = [...merged.values()]
    .map((f) => ({ ...f, status: state.prevIds.has(f.id) ? 'known' : 'new', firstSeen: state.firstSeen.get(f.id) ?? nowIso }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.suite.localeCompare(b.suite) || String(a.file ?? '').localeCompare(String(b.file ?? '')) || (a.line ?? 0) - (b.line ?? 0))
  const have = new Set(findings.map((f) => f.id))
  const fixed = [...state.prevIds].filter((id) => !have.has(id)).map((id) => ({ id, ...(state.prevItems.get(id) ?? {}), fixedIn: meta.runId, previousRun: state.prev?.runId ?? null }))
  const count = (key) => {
    const o = {}
    for (const f of findings) o[f[key]] = (o[f[key]] ?? 0) + 1
    return o
  }
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]))
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    meerkat: { version: meta.version || 'unknown' },
    run: { id: meta.runId, dir: meta.dir ?? null, project: { name: basename(resolve(appDir)), path: SLASH(resolve(appDir)) }, preset: meta.preset ?? null, tier: meta.tier, startedAt: meta.startedAt, endedAt: meta.endedAt, ms: meta.ms, machine: { os: `${platform()} ${release()} ${arch()}`, node: process.version }, comparedWith: state.prev?.runId ?? null },
    counts: { total: findings.length, bySeverity, bySuite: count('suite'), byCheck: count('check'), new: findings.filter((f) => f.status === 'new').length, known: findings.filter((f) => f.status === 'known').length, fixed: fixed.length },
    findings,
    fixed,
    notRun,
  }
  return doc
}

// ---- detections.jsonl ----

export function buildDetections({ doc, results, checks = [], recorder = null, startedAtMs }) {
  const t0 = startedAtMs ?? recorder?.events?.[0]?.t ?? Date.now()
  const ends = new Map((recorder?.events ?? []).filter((e) => e.event === 'end').map((e) => [e.id, e.t]))
  const byCheck = new Map(checks.map((c) => [c.id, c]))
  const events = []
  let seq = 0
  const push = (checkId, e) => events.push({ seq: seq++, t: Math.max(0, (ends.get(checkId) ?? t0 + (doc.run.ms ?? 0)) - t0), ...e })
  for (const r of results.filter(Boolean)) {
    const check = byCheck.get(r.id)
    const tool = toolOf(check)
    const common = { check: r.id, durationMs: r.ms ?? 0, tool: tool ? tool.name : null }
    if (r.status === 'NOT RUN') push(r.id, { event: 'check-not-run', rule: null, file: null, line: null, severity: null, message: sane(stripSaved(r.detailFull ?? r.detail), MAX_MESSAGE), ...common })
    else if (r.status === 'FAIL') push(r.id, { event: 'check-failed', rule: null, file: null, line: null, severity: null, message: sane(stripSaved(r.detailFull ?? r.detail), MAX_MESSAGE), ...common })
    for (const s of r.subs ?? []) if (s.status === 'FAIL') push(r.id, { event: 'sub-check-failed', rule: s.id, file: null, line: null, severity: null, message: sane(s.reason || `${s.id} failed`, MAX_MESSAGE), ...common })
  }
  const hits = new Map()
  for (const f of doc.findings) {
    push(f.check, { event: 'finding', rule: f.rule, file: f.file, line: f.line, severity: f.severity, message: f.message, findingId: f.id, check: f.check, durationMs: results.find((r) => r?.id === f.check)?.ms ?? 0, tool: f.detectedBy.tool?.name ?? null })
    if (f.rule) {
      const k = `${f.check}\u0000${f.rule}`
      hits.set(k, { f, n: (hits.get(k)?.n ?? 0) + f.occurrences })
    }
  }
  for (const { f, n } of hits.values()) push(f.check, { event: 'rule-hit', rule: f.rule, file: null, line: null, severity: f.severity, message: `${n} hit${n === 1 ? '' : 's'} of ${f.rule}`, count: n, check: f.check, durationMs: results.find((r) => r?.id === f.check)?.ms ?? 0, tool: f.detectedBy.tool?.name ?? null })
  const order = { 'check-failed': 0, 'check-not-run': 0, 'sub-check-failed': 1, 'rule-hit': 2, finding: 3 }
  events.sort((a, b) => a.t - b.t || order[a.event] - order[b.event] || a.seq - b.seq)
  return events.slice(0, MAX_EVENTS).map(({ seq: _s, ...e }) => ({ t: e.t, time: new Date(t0 + e.t).toISOString(), ...e }))
}

export const detectionsText = (events) => (events.length ? events.map((e) => JSON.stringify(e)).join('\n') + '\n' : '')

// ---- findings.md ----

const md = (t) => String(t ?? '').replace(/[|`]/g, (c) => `\\${c}`)
export function findingsMarkdown(doc) {
  const out = [`# Meerkat findings: ${doc.run.project.name}`, '']
  out.push(`- run: ${doc.run.id} (${doc.run.preset ?? doc.run.tier}), ${doc.run.startedAt}`, `- project: ${doc.run.project.path}`, `- Meerkat ${doc.meerkat.version}, ${doc.run.machine.os}, node ${doc.run.machine.node}`)
  out.push(`- ${doc.counts.total} finding(s): ${doc.counts.new} new, ${doc.counts.known} known, ${doc.counts.fixed} fixed since ${doc.run.comparedWith ?? 'nothing (first run)'}`, '')
  out.push('## Summary', '', '| Severity | Findings |', '|---|---|', ...SEVERITIES.map((s) => `| ${s} | ${doc.counts.bySeverity[s] ?? 0} |`), '')
  const suites = [...new Set(doc.findings.map((f) => f.suite))]
  for (const suite of suites) {
    const list = doc.findings.filter((f) => f.suite === suite)
    out.push(`## ${suite} (${list.length})`, '')
    for (const f of list) {
      out.push(`### [${f.severity}] ${md(f.title)}${f.status === 'new' ? ' (new)' : ''}`, '')
      out.push(`- where: ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}${f.occurrences > 1 ? ` (and ${f.occurrences - 1} more place(s))` : ''}` : '(no file)'}`)
      out.push(`- what: ${f.message}`)
      out.push(`- rule: ${f.rule ?? '(none)'}`)
      const by = f.detectedBy
      out.push(`- detected by: check ${by.check}${by.pack ? ` (pack ${by.pack}, ${by.origin})` : ` (${by.origin})`}${by.script ? `, script ${by.script}` : ''}${by.tool ? `, tool ${by.tool.name}${by.tool.version ? ` ${by.tool.version}` : ''}` : ''}, confidence ${f.confidence}`)
      if (f.evidence) out.push(`- evidence: \`${f.evidence.replace(/`/g, "'")}\``)
      if (f.aiVerdict) out.push(`- AI verification: ${f.aiVerdict}${f.aiReason ? `: ${f.aiReason}` : ''}`)
      if (f.rawOutput) out.push('- raw output:', '', '```', ...f.rawOutput.map((l) => l.replace(/```/g, "'''")), '```')
      out.push(`- fix: ${f.fix ?? '(no hint from the check)'}`, `- first seen: ${f.firstSeen}   id: ${f.id}`)
      if (f.logFile) out.push(`- log: ${f.logFile}`)
      out.push('')
    }
  }
  if (!doc.findings.length) out.push('Nothing was detected in this run.', '')
  out.push('## Fixed since the last run', '')
  if (doc.fixed.length) for (const x of doc.fixed) out.push(`- ${x.id}${x.severity ? ` [${x.severity}]` : ''} ${md(x.title ?? '')}${x.file ? ` (${x.file})` : ''}`)
  else out.push('Nothing was fixed since the last run (or there is no earlier run to compare with).')
  if (doc.notRun.length) {
    out.push('', '## Could not run (so nothing is known about them)', '')
    for (const n of doc.notRun) out.push(`- ${n.check}: ${n.reason}`)
  }
  return out.join('\n') + '\n'
}

// ---- findings.sarif ----

const LEVEL = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' }
const uriOf = (p) => String(p).split('/').map(encodeURIComponent).join('/')
export function findingsSarif(doc) {
  const rules = new Map()
  for (const f of doc.findings) {
    const id = f.rule ?? f.check
    if (!rules.has(id)) rules.set(id, { id, name: id, shortDescription: { text: f.rule ? f.title : f.detectedBy.checkTitle || f.check } })
  }
  const results = doc.findings.map((f) => {
    const locations = f.file ? (f.lines.length ? f.lines : [f.line || 0]).map((l) => ({ physicalLocation: { artifactLocation: { uri: uriOf(f.file) }, ...(l >= 1 ? { region: { startLine: l } } : {}) } })) : []
    return { ruleId: f.rule ?? f.check, level: LEVEL[f.severity], message: { text: f.message }, ...(locations.length ? { locations } : {}), partialFingerprints: { meerkatFindingHash: f.id }, properties: { severity: f.severity, suite: f.suite, check: f.check, status: f.status } }
  })
  return { $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0', runs: [{ tool: { driver: { name: 'Meerkat', version: doc.meerkat.version, rules: [...rules.values()] } }, results }] }
}

// ---- saving ----

export const findingsLine = (doc, mdPath = null) => {
  const sev = SEVERITIES.filter((s) => doc.counts.bySeverity[s]).map((s) => `${doc.counts.bySeverity[s]} ${s}`)
  if (!sev.length) return 'findings: none'
  return `findings: ${sev.join(', ')} (${doc.counts.new} new)${mdPath ? `  details: ${mdPath}` : ''}`
}

// Builds and writes the four files and the cross-run history. Returns { doc, files, line } or null (a note goes to `note`). Never throws.
export function saveFindings({ dir, results, checks, sink, appDir, repoRoot, env = process.env, version = VERSION, preset = null, tier = 'run', startedAtMs, ms, recorder = null, io = {}, note = (m) => process.stderr.write(`${m}\n`) }) {
  if (!dir) return null
  try {
    const runId = basename(dir)
    const project = { name: basename(resolve(appDir)), path: SLASH(resolve(appDir)) }
    const kind = kindOf(preset, tier)
    const hFile = historyFile(env, appDir)
    const history = readHistory(hFile)
    const runs = history ? history.runs : historyFromRunFolders(env, appDir)
    const doc = buildFindings({ results, checks, sink, appDir, repoRoot, env, meta: { version, runId, dir: SLASH(dir), preset, tier, startedAt: new Date(startedAtMs).toISOString(), endedAt: new Date(startedAtMs + ms).toISOString(), ms }, prior: priorState(runs, kind, runId) })
    const events = buildDetections({ doc, results, checks, recorder, startedAtMs })
    const files = { findings: `${SLASH(dir)}/findings.json`, report: `${SLASH(dir)}/findings.md`, sarif: `${SLASH(dir)}/findings.sarif`, detections: `${SLASH(dir)}/detections.jsonl` }
    const text = { findings: JSON.stringify(doc, null, 2), report: findingsMarkdown(doc), sarif: JSON.stringify(findingsSarif(doc), null, 2), detections: detectionsText(events) }
    for (const k of Object.keys(files)) if (!writeAtomic(files[k], text[k], io)) note(`note: could not write ${files[k]} (the run is not affected)`)
    const upd = updatedHistory(history, { project, entry: entryFromDoc(doc) })
    if (!saveHistory(env, appDir, upd.history, upd.text, io)) note('note: could not save the findings history (the run is not affected)')
    return { doc, files, line: findingsLine(doc, files.report) }
  } catch (e) {
    note(`note: findings could not be compiled (${stripControl(String(e?.message ?? e)).slice(0, 200)}); the run is not affected`)
    return null
  }
}

// ---- reading back ----

export function readFindings(dir) {
  try {
    const d = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'))
    return d && d.schemaVersion === SCHEMA_VERSION && Array.isArray(d.findings) ? d : null
  } catch {
    return null
  }
}

export function filterFindings(findings, { severity = null, suite = null, check = null, onlyNew = false } = {}) {
  return findings.filter((f) => (!severity || meetsSeverity(f.severity, severity)) && (!suite || f.suite === suite) && (!check || f.check === check) && (!onlyNew || f.status === 'new'))
}

const hasFile = (p) => existsSync(p)
