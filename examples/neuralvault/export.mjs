// NeuralVault memory adapter: writes Meerkat's latest results into ONE markdown note in a NeuralVault vault folder.
//   meerkat memory                       (with "memory": { "adapter": "neuralvault" } in meerkat.config.json)
//   node examples/neuralvault/export.mjs [--app <folder>] [--run <run folder>] [--dry-run] [--json]
// The note holds the findings summary, the code map summary (when the run has a codemap.json), the run's pass/fail counts and what
// changed since the last export. Frontmatter follows the vault's existing notes: title, type, status, created, updated, tags, plus
// project, source_run and meerkat_version.
// Where: the vault folder comes from NV_VAULT_PATH, else the first line of ~/.neuralvault-vault-path. Nothing else is looked up.
//   The note is wiki/projects/<project>/meerkat-status.md (or the "note" setting, which must stay inside the vault).
//   Nothing is ever written outside the vault folder, and an existing note that is a symbolic link is refused.
// Secrets: findings in a run are already redacted by Meerkat (lib/findingsdoc.mjs). This adapter also keeps only short fields (never
//   evidence or raw tool output), runs each through thorough/redact.mjs, and refuses to write a note in which redaction still finds anything.
// This file is an adapter, not a check file: the pack loader reads every .mjs in this folder, so it exports an empty list of checks.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFindings } from '../../lib/findingsdoc.mjs'
import { latestRunDirOf } from '../../lib/runlog.mjs'
import { stripControl } from '../../lib/tui/safe.mjs'
import { VERSION } from '../../lib/version.mjs'
import { redact } from '../../thorough/redact.mjs'

export default []

const MAX_FINDINGS = 25
const MAX_FAILED = 25
const MAX_MODULES = 10
const MAX_LISTED = 10
const VAULT_FILE = '.neuralvault-vault-path'

// ---- where the vault is ----

// The vault folder, from NV_VAULT_PATH or the first line of ~/.neuralvault-vault-path. { ok, dir } or { ok: false, reason }.
export function vaultFolder({ env = process.env, home = homedir() } = {}) {
  let raw = String(env.NV_VAULT_PATH ?? '').trim()
  if (!raw) {
    try {
      raw = readFileSync(join(home, VAULT_FILE), 'utf8').split(/\r?\n/)[0].trim()
    } catch {
      /* no file: the message below says what to set */
    }
  }
  if (!raw) return { ok: false, reason: `no vault folder: set NV_VAULT_PATH, or put the folder on the first line of ~/${VAULT_FILE}` }
  const dir = resolve(raw)
  if (dir === parse(dir).root) return { ok: false, reason: 'the vault folder cannot be a drive or filesystem root' }
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, reason: 'the vault path is not a folder' }
    return { ok: true, dir: realpathSync(dir) }
  } catch {
    return { ok: false, reason: 'the vault folder does not exist' }
  }
}

// The absolute path of a note inside the vault, or { ok: false, reason }. `rel` must be a relative .md path that stays inside.
export function notePathInVault(vault, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return { ok: false, reason: 'the note path is empty' }
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('\\\\') || rel.startsWith('//')) return { ok: false, reason: 'refusing a note path outside the vault: it must be relative to the vault folder' }
  const target = resolve(vault, rel)
  const inside = relative(vault, target)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return { ok: false, reason: 'refusing a note path outside the vault folder' }
  if (!target.endsWith('.md')) return { ok: false, reason: 'the note must be a .md file' }
  return { ok: true, file: target, rel: inside.split(sep).join('/') }
}

// ---- cleaning ----

// One short line of text that is safe to put in a note: control characters out, table bars escaped, and the whole field replaced when
// redaction finds a secret-looking value in it.
export function clean(text, max = 160) {
  const t = stripControl(String(text ?? '').replace(/\s+/g, ' ')).trim()
  if (!t) return ''
  const r = redact(t)
  if (r.long || r.hard || r.soft || r.multiline) return '<redacted>'
  return t.slice(0, max).replace(/\|/g, '\\|')
}

// A project-relative path for display: an absolute path is cut to its file name so no machine path reaches the vault.
const where = (file, line) => {
  if (!file) return '(whole check)'
  const f = String(file).replace(/\\/g, '/')
  const shown = isAbsolute(f) || /^[a-zA-Z]:/.test(f) ? basename(f) : f
  return `${clean(shown, 120)}${Number.isInteger(line) && line > 0 ? `:${line}` : ''}`
}

export const slugOf = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'project'

// ---- reading the run ----

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function readRun(runDir) {
  const summary = readJson(join(runDir, 'summary.json'))
  const findings = readFindings(runDir)
  const map = readJson(join(runDir, 'codemap.json'))
  return { runId: basename(runDir), summary, findings, map: map && map.summary ? map : null }
}

// ---- the previous export ----

// The state a note carries for the next export: counts and the findings it listed, in one HTML comment.
const STATE = /<!-- meerkat-state (\{.*\}) -->/
const stateComment = (state) => `<!-- meerkat-state ${JSON.stringify(state).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`

export function readPrevious(text) {
  if (typeof text !== 'string') return null
  const m = STATE.exec(text)
  let state = null
  try {
    state = m ? JSON.parse(m[1]) : null
  } catch {
    state = null
  }
  const created = /^created: (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1] ?? null
  // Lines marked as corrections (a trailing ` \*`, or a `> \*Corrected` line) are never dropped by a rewrite.
  const kept = text.split(/\r?\n/).filter((l) => /\s\\\*$/.test(l) || /^> \\\*Corrected/.test(l))
  return { state, created, kept }
}

// ---- building the note ----

const delta = (now, before) => (before === undefined || before === null ? '' : ` (${now - before >= 0 ? '+' : ''}${now - before} since the last export)`)

export function buildNote({ slug, run, previous, today, version, hasProjectNote }) {
  const s = run.summary ?? {}
  const counts = s.counts ?? { pass: 0, fail: 0, notRun: 0 }
  const doc = run.findings
  const sev = doc?.counts?.bySeverity ?? {}
  const all = doc?.findings ?? []
  const shown = all.slice(0, MAX_FINDINGS)
  const failed = (s.results ?? []).filter((r) => r.status === 'FAIL')
  const failedShown = failed.slice(0, MAX_FAILED)
  const state = { run: run.runId, pass: counts.pass, fail: counts.fail, notRun: counts.notRun, total: doc?.counts?.total ?? null, findings: all.slice(0, 200).map((f) => [String(f.id), clean(f.title ?? f.message, 80)]) }
  const prev = previous?.state ?? null
  const L = []
  L.push('---', `title: "Meerkat status: ${slug}"`, 'type: meerkat-report', 'status: current', `project: ${slug}`, `created: ${previous?.created ?? today}`, `updated: ${today}`, `source_run: ${clean(run.runId, 80)}`, `meerkat_version: ${clean(s.version ?? version, 20)}`, 'tags: [meerkat, status]', '---', '')
  L.push(`# Meerkat status: ${slug}`, '', `Written by Meerkat from run ${clean(run.runId, 80)}. The next export replaces this note; lines marked with \\* are kept.`, '')
  L.push('## Latest run', '', '| What | Value |', '|---|---|')
  L.push(`| Preset | ${clean(s.preset ?? s.tier ?? 'unknown', 40)} |`, `| Result | ${s.exitCode === 0 ? 'all passed' : 'needs attention'} (exit code ${Number.isInteger(s.exitCode) ? s.exitCode : 'unknown'}) |`)
  L.push(`| Checks passed | ${counts.pass}${delta(counts.pass, prev?.pass)} |`, `| Checks failed | ${counts.fail}${delta(counts.fail, prev?.fail)} |`, `| Checks not run | ${counts.notRun}${delta(counts.notRun, prev?.notRun)} |`)
  if (s.endedAt) L.push(`| Finished | ${clean(s.endedAt, 40)} |`)
  if (Number.isFinite(s.ms)) L.push(`| Took | ${Math.round(s.ms / 1000)} s |`)
  L.push('')
  L.push('## Findings', '')
  if (!doc) L.push('This run has no findings.json (an older Meerkat, or the run did not finish), so there is no findings summary.', '')
  else {
    const bySev = ['critical', 'high', 'medium', 'low', 'info'].map((k) => `${k} ${sev[k] ?? 0}`).join(', ')
    L.push(`${doc.counts.total} open: ${bySev}. New ${doc.counts.new ?? 0}, known ${doc.counts.known ?? 0}, fixed ${doc.counts.fixed ?? 0}.`, '')
    if (shown.length) {
      L.push('| Severity | Check | Rule | Where | What |', '|---|---|---|---|---|')
      for (const f of shown) L.push(`| ${clean(f.severity, 10)} | ${clean(f.check, 60)} | ${clean(f.rule ?? '', 60)} | ${where(f.file, f.line)} | ${clean(f.title ?? f.message, 120)} |`)
      if (all.length > shown.length) L.push('', `${all.length - shown.length} more are in the run's findings.json.`)
      L.push('')
    }
  }
  if (failedShown.length) {
    L.push('## Failed checks', '', '| Check | What happened |', '|---|---|')
    for (const r of failedShown) L.push(`| ${clean(r.id, 60)} | ${clean(r.detail, 120)} |`)
    if (failed.length > failedShown.length) L.push('', `${failed.length - failedShown.length} more failed checks are in the run's summary.json.`)
    L.push('')
  }
  L.push('## Code map', '')
  const mapModules = (run.map?.modules ?? []).slice(0, MAX_MODULES)
  if (!run.map) L.push('No code map in this run (`meerkat map` writes one into a run folder).', '')
  else {
    const m = run.map.summary
    const langs = Object.entries(m.languages ?? {}).map(([k, v]) => `${clean(k, 20)} ${Number(v) || 0}`).join(', ') || 'none found'
    L.push(`${Number(m.files) || 0} source files, ${Number(m.lines) || 0} lines (${langs}). ${Number(m.imports) || 0} imports: ${Number(m.localImports) || 0} local, ${Number(m.externalImports) || 0} external, ${Number(m.unresolvedImports) || 0} unresolved.`, '')
    if (mapModules.length) {
      L.push('| Module | Files | Lines |', '|---|---|---|')
      for (const mod of mapModules) L.push(`| ${clean(mod.id, 80)} | ${Number(mod.fileCount) || 0} | ${Number(mod.lines) || 0} |`)
      L.push('')
    }
  }
  L.push('## What changed since last export', '')
  if (!prev) L.push('This is the first export, so there is nothing to compare with.', '')
  else {
    const before = new Map((prev.findings ?? []).map(([id, title]) => [id, title]))
    const now = new Map(state.findings.map(([id, title]) => [id, title]))
    const added = state.findings.filter(([id]) => !before.has(id))
    const gone = (prev.findings ?? []).filter(([id]) => !now.has(id))
    L.push(prev.run === run.runId ? `- Same run as the last export (${clean(run.runId, 80)}).` : `- Run changed from ${clean(prev.run, 80)} to ${clean(run.runId, 80)}.`)
    L.push(`- Checks passed ${prev.pass} to ${counts.pass}, failed ${prev.fail} to ${counts.fail}, not run ${prev.notRun} to ${counts.notRun}.`)
    if (prev.total !== null && state.total !== null) L.push(`- Open findings ${prev.total} to ${state.total}.`)
    L.push(`- New findings: ${added.length}.${added.length ? '' : ' None.'}`, ...added.slice(0, MAX_LISTED).map(([id, t]) => `  - ${id} ${t}`))
    L.push(`- Gone findings: ${gone.length}.${gone.length ? '' : ' None.'}`, ...gone.slice(0, MAX_LISTED).map(([id, t]) => `  - ${id} ${t}`))
    L.push('')
  }
  const kept = [...new Set(previous?.kept ?? [])]
  if (kept.length) L.push('## Corrections (kept)', '', ...kept, '')
  if (hasProjectNote) L.push(`Related: [[${slug}]]`, '')
  L.push(stateComment(state), '')
  return { text: L.join('\n'), rows: { results: (counts.pass ?? 0) + (counts.fail ?? 0) + (counts.notRun ?? 0), findings: shown.length, failedChecks: failedShown.length, mapModules: mapModules.length, kept: kept.length }, state }
}

// ---- writing ----

function writeInside(vault, file, text) {
  mkdirSync(dirname(file), { recursive: true })
  // A folder inside the vault that is a link to somewhere else would carry the write outside it.
  const realDir = realpathSync(dirname(file))
  const inside = relative(vault, realDir)
  if (inside.startsWith('..') || isAbsolute(inside)) return { ok: false, reason: 'refusing to write: the note folder leads outside the vault' }
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) return { ok: false, reason: 'refusing to write: the note is a symbolic link' }
  const tmp = join(realDir, `.meerkat-export-${process.pid}.tmp`)
  writeFileSync(tmp, text)
  renameSync(tmp, file)
  return { ok: true }
}

// The whole export. `runDir` defaults to the project's newest run. Returns { ok, written, file, rows, text } or { ok: false, reason }.
export function exportMemory({ appDir, runDir, env = process.env, home = homedir(), now = new Date(), project, note, vaultPath, dryRun = false } = {}) {
  const found = vaultPath ? vaultFolder({ env: { NV_VAULT_PATH: vaultPath }, home }) : vaultFolder({ env, home })
  if (!found.ok) return { ok: false, reason: found.reason }
  const vault = found.dir
  const slug = slugOf(project ?? basename(resolve(appDir ?? '.')))
  const target = notePathInVault(vault, note ?? `wiki/projects/${slug}/meerkat-status.md`)
  if (!target.ok) return { ok: false, reason: target.reason }
  const dir = runDir ? resolve(runDir) : latestRunDirOf(env, appDir ?? '.')
  if (!dir || !existsSync(dir)) return { ok: false, reason: 'there is no run for this project yet: run meerkat first' }
  const run = readRun(dir)
  if (!run.summary && !run.findings) return { ok: false, reason: `${basename(dir)} has no summary.json or findings.json` }
  let previous = null
  try {
    previous = existsSync(target.file) ? readPrevious(readFileSync(target.file, 'utf8')) : null
  } catch {
    previous = null
  }
  const built = buildNote({ slug, run, previous, today: now.toISOString().slice(0, 10), version: VERSION, hasProjectNote: existsSync(join(vault, 'wiki', 'projects', `${slug}.md`)) })
  const check = redact(built.text)
  if (check.long || check.hard || check.soft || check.multiline) return { ok: false, reason: 'refusing to write: redaction found a secret-like value in the note. Nothing was written.' }
  if (dryRun) return { ok: true, written: false, file: target.rel, rows: built.rows, text: built.text, firstExport: !previous?.state }
  const w = writeInside(vault, target.file, built.text)
  if (!w.ok) return { ok: false, reason: w.reason }
  return { ok: true, written: true, file: target.rel, rows: built.rows, firstExport: !previous?.state }
}

export function summaryLine(r) {
  if (!r.ok) return `meerkat memory (neuralvault): ${r.reason}`
  const k = r.rows
  return `meerkat memory (neuralvault): ${r.written ? 'wrote' : 'would write'} ${r.file}: ${k.results} check results, ${k.findings} findings, ${k.failedChecks} failed checks, ${k.mapModules} map modules${r.firstExport ? ' (first export)' : ''}`
}

// ---- command line ----

function main(argv) {
  const flag = (n) => {
    const i = argv.indexOf(n)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const r = exportMemory({ appDir: flag('--app') ?? '.', runDir: flag('--run'), dryRun: argv.includes('--dry-run'), project: flag('--project'), note: flag('--note') })
  if (argv.includes('--json')) console.log(JSON.stringify({ ...r, text: undefined }, null, 2))
  else (r.ok ? console.log : console.error)(summaryLine(r))
  return r.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
