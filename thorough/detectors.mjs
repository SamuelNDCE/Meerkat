#!/usr/bin/env node
// The detectors pack: run a mature tool when it is installed, turn its JSON into Meerkat findings with the tool's own rule ids.
//   node thorough/detectors.mjs <osv-scan|semgrep-security|clippy-correctness|tsc-strict|gitleaks-secrets|staticcheck-go|govulncheck-go|actionlint-workflows> [--root <dir>] [--sample <file>]
// --sample <file> reads a recorded copy of the tool's output instead of running the tool (the tests and self-tests use it, so no tool
// has to be installed). Nothing is ever installed here, and no project code runs beyond the tool itself.
// Exit: 0 clean (or not applicable), 1 findings, 75 NOT RUN (tool missing, hint printed).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finding, NOT_RUN, notRun } from './kit.mjs'
import { findBinary } from '../lib/which.mjs'
import { cleanMessage } from '../lib/findings.mjs'

export const TSC_CAP = 200
const MAX_BUFFER = 512 * 1024 * 1024

// A tool's rule id as a Meerkat rule id (lowercase letters, digits and hyphens, at most 61 characters). The full original id is kept in the message.
export function ruleId(raw, prefix = '') {
  const body = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const full = prefix ? `${prefix}-${body}` : body
  const id = full.length > 61 ? full.slice(full.length - 61).replace(/^-+/, '') : full
  return id || 'detector'
}

const posix = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')

// A path the finding protocol accepts: project-relative. An absolute path inside the root is made relative; one outside loses its drive and leading slash.
const relTo = (p, root) => {
  const text = String(p ?? '')
  if (!isAbsolute(text) && !text.startsWith('/')) return posix(text)
  const r = root ? posix(relative(root, text)) : ''
  return r && !r.startsWith('..') && !isAbsolute(r) ? r : posix(text).replace(/^([a-zA-Z]:)?\/+/, '')
}

// ---- osv-scanner -----------------------------------------------------------------------------------------------------------------
// JSON: { results: [{ source: { path }, packages: [{ package: { name, version, ecosystem }, vulnerabilities: [{ id, summary, affected: [...] }] }] }] }
export function fixedVersions(vuln, pkgName) {
  const out = new Set()
  for (const a of vuln?.affected ?? []) {
    if (a?.package?.name && pkgName && a.package.name !== pkgName) continue
    for (const r of a?.ranges ?? []) for (const e of r?.events ?? []) if (e?.fixed) out.add(String(e.fixed))
  }
  return [...out]
}

export function parseOsv(json, root = '') {
  const out = []
  for (const res of json?.results ?? []) {
    const file = relTo(res?.source?.path, root) || 'lockfile'
    for (const p of res?.packages ?? []) {
      const name = p?.package?.name ?? '?'
      const version = p?.package?.version ?? '?'
      for (const v of p?.vulnerabilities ?? []) {
        const fixed = fixedVersions(v, name)
        const summary = String(v?.summary ?? v?.details ?? '').split('\n')[0].slice(0, 200)
        out.push({
          severity: fixed.length ? 'high' : 'medium',
          rule: ruleId(v?.id ?? 'osv'),
          file,
          line: 0,
          message: `${name}@${version} (${p?.package?.ecosystem ?? '?'}) is vulnerable: ${v?.id}${summary ? ` ${summary}` : ''}; ${fixed.length ? `fixed in ${fixed.join(', ')}` : 'no fixed version yet'}`,
        })
      }
    }
  }
  return out
}

// ---- semgrep ---------------------------------------------------------------------------------------------------------------------
// JSON: { results: [{ check_id, path, start: { line }, extra: { message, severity: ERROR|WARNING|INFO } }] }
const SEMGREP_SEV = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }
export function parseSemgrep(json) {
  return (json?.results ?? []).map((r) => ({
    severity: SEMGREP_SEV[String(r?.extra?.severity ?? '').toUpperCase()] ?? 'medium',
    rule: ruleId(String(r?.check_id ?? 'semgrep').split('.').slice(-4).join('.')),
    file: posix(r?.path) || '-',
    line: Number(r?.start?.line) || 0,
    message: `[confidence high] ${r?.check_id}: ${String(r?.extra?.message ?? '').replace(/\s+/g, ' ').slice(0, 400)}`,
  }))
}

// ---- clippy ----------------------------------------------------------------------------------------------------------------------
// `cargo clippy --message-format json` prints one JSON object per line; the lints are the "compiler-message" ones whose code starts with clippy::.
export function parseClippy(text) {
  const out = []
  const seen = new Set()
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const m = o?.reason === 'compiler-message' ? o.message : null
    const code = m?.code?.code
    if (!m || typeof code !== 'string' || !code.startsWith('clippy::')) continue
    if (m.level !== 'warning' && m.level !== 'error') continue
    const span = (m.spans ?? []).find((s) => s.is_primary) ?? m.spans?.[0]
    const file = posix(span?.file_name) || '-'
    const ln = Number(span?.line_start) || 0
    const key = `${code}|${file}|${ln}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ severity: m.level === 'error' ? 'high' : 'medium', rule: ruleId(code.replace('::', '-')), file, line: ln, message: `[confidence high] ${code}: ${String(m.message).replace(/\s+/g, ' ').slice(0, 300)}` })
  }
  return out
}

// ---- tsc -------------------------------------------------------------------------------------------------------------------------
// `tsc --pretty false` prints `path(line,col): error TS2322: message`.
export function parseTsc(text) {
  const out = []
  const re = /^(.+?)\((\d+),\d+\): (error|warning) TS(\d+): (.*)$/
  for (const line of String(text).split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) out.push({ severity: 'medium', rule: `tsc-${m[4]}`, file: posix(m[1]), line: Number(m[2]), message: `[confidence high] TS${m[4]}: ${m[5].slice(0, 400)}` })
  }
  return out
}

// ---- gitleaks --------------------------------------------------------------------------------------------------------------------
// Report file: a JSON array of { RuleID, Description, File, StartLine, ... }. The secret value is never copied into a finding (and --redact hides it).
export function parseGitleaks(json, root = '') {
  return (Array.isArray(json) ? json : []).map((r) => ({
    severity: 'critical',
    rule: ruleId(r?.RuleID ?? 'gitleaks'),
    file: relTo(r?.File, root) || '-',
    line: Number(r?.StartLine) || 0,
    message: `[confidence high] ${r?.RuleID}: ${String(r?.Description ?? 'possible secret').slice(0, 200)} (value not shown)`,
  }))
}

// ---- staticcheck -----------------------------------------------------------------------------------------------------------------
// `staticcheck -f json` prints one JSON object per line: { code, severity, location: { file, line, column }, message }. SA* only.
export function parseStaticcheck(text, root = '') {
  const out = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!/^SA\d+/.test(String(o?.code))) continue
    out.push({ severity: 'medium', rule: ruleId(o.code), file: relTo(o.location?.file, root) || '-', line: Number(o.location?.line) || 0, message: `[confidence high] ${o.code}: ${String(o.message ?? '').slice(0, 300)}` })
  }
  return out
}

// ---- govulncheck -----------------------------------------------------------------------------------------------------------------
// `govulncheck -format json` prints a stream of (pretty-printed) JSON objects: { osv }, { finding }, ... Only a finding whose trace reaches a
// function (the vulnerable code is CALLED) is reported; imported-only vulnerabilities are not.
export function splitJsonStream(text) {
  const out = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  const t = String(text)
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}' && depth > 0 && --depth === 0) {
      try {
        out.push(JSON.parse(t.slice(start, i + 1)))
      } catch {
        // skip a damaged object
      }
    }
  }
  return out
}

export function parseGovulncheck(text, root = '') {
  const msgs = splitJsonStream(text)
  const osv = new Map(msgs.filter((m) => m.osv).map((m) => [m.osv.id, m.osv]))
  const seen = new Set()
  const out = []
  for (const m of msgs) {
    const f = m.finding
    if (!f || !(f.trace ?? []).some((fr) => fr.function)) continue
    // The last frame with a position is the project's own call site (the first frame is the vulnerable function inside the dependency).
    const top = [...f.trace].reverse().find((fr) => fr.position) ?? f.trace[0]
    const file = relTo(top?.position?.filename, root) || 'go.mod'
    const line = Number(top?.position?.line) || 0
    const key = `${f.osv}|${file}|${line}`
    if (seen.has(key)) continue
    seen.add(key)
    const hit = f.trace[0]
    out.push({ severity: 'high', rule: ruleId(f.osv), file, line, message: `[confidence high] ${f.osv}: ${String(osv.get(f.osv)?.summary ?? '').slice(0, 160)} called via ${hit?.package ?? hit?.module ?? '?'}${hit?.function ? `.${hit.function}` : ''}; ${f.fixed_version ? `fixed in ${f.fixed_version}` : 'no fixed version yet'}` })
  }
  return out
}

// ---- actionlint ------------------------------------------------------------------------------------------------------------------
// `actionlint -format '{{json .}}'` prints a JSON array of { message, filepath, line, column, kind }.
export function parseActionlint(json, root = '') {
  return (Array.isArray(json) ? json : []).map((r) => ({
    severity: 'medium',
    rule: ruleId(r?.kind ?? 'actionlint', 'actionlint'),
    file: relTo(r?.filepath, root) || '-',
    line: Number(r?.line) || 0,
    message: `[confidence high] ${r?.kind}: ${String(r?.message ?? '').replace(/\s+/g, ' ').slice(0, 300)}`,
  }))
}

// ---- how the networked tools are started -----------------------------------------------------------------------------------------
// Semgrep: metrics are always off (the command line and the environment both say so), so nothing about the machine or project is sent. The
// registry rules (p/security-audit) belong to Semgrep and are licensed for the user's own internal use; the user's own semgrep fetches them from
// semgrep.dev. Meerkat never copies or bundles them. MEERKAT_SEMGREP_CONFIG=<rules file or p/...> replaces the registry rule set.
// MEERKAT_DETECTORS_OFFLINE=1 requires a rules file on this computer.
export function semgrepPlan(env = process.env) {
  const config = env.MEERKAT_SEMGREP_CONFIG || 'p/security-audit'
  if (env.MEERKAT_DETECTORS_OFFLINE === '1' && (/^(p|r)\//.test(config) || /^https?:/.test(config) || !existsSync(config))) {
    return { error: 'offline mode (MEERKAT_DETECTORS_OFFLINE=1) needs MEERKAT_SEMGREP_CONFIG to be a rules file on this computer; the registry rules are fetched from semgrep.dev' }
  }
  return { args: ['scan', '--config', config, '--json', '--quiet', '--metrics=off'], env: { SEMGREP_SEND_METRICS: 'off' } }
}

// osv-scanner sends package names and versions to the OSV API unless it runs against its cached offline databases.
export function osvCacheDir(env = process.env, platform = process.platform) {
  if (env.MEERKAT_OSV_CACHE) return env.MEERKAT_OSV_CACHE
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'osv-scanner')
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'osv-scanner')
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'osv-scanner')
}
export function osvPlan(env = process.env) {
  if (env.MEERKAT_DETECTORS_OFFLINE !== '1') return { args: ['scan', '--format', 'json', '-r', '.'] }
  if (!existsSync(osvCacheDir(env))) return { error: 'offline mode (MEERKAT_DETECTORS_OFFLINE=1) needs a cached OSV database; fetch it once with: osv-scanner scan --download-offline-databases (this contacts osv.dev)' }
  return { args: ['scan', '--offline-vulnerabilities', '--format', 'json', '-r', '.'] }
}

// ---- running ---------------------------------------------------------------------------------------------------------------------
function spawn(cmd, args, cwd, timeoutMs, extraEnv = {}) {
  return spawnSync(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd) })
}

// Everything printed outside finding() goes through cleanMessage: a tool's text must never hold a line break that could forge a result line.
const nr = (message) => notRun(cleanMessage(message))
const report = (name, items, cap = Infinity) => {
  const shown = items.slice(0, cap)
  for (const f of shown) finding(f.severity, f.rule, f.file, f.line, f.message)
  if (items.length > shown.length) {
    // Every finding past the cap is rolled up into one, so the count is never lost.
    finding('info', 'detectors-rollup', shown[0]?.file ?? '-', 0, `${items.length - shown.length} more ${name} finding(s) not listed (cap ${cap}); ${items.length} in total`)
  }
  if (!items.length) {
    console.log(`${name}: no findings`)
    return 0
  }
  // The last line is the reason shown in the table, so it names the first problem.
  console.log(`${name}: found ${items.length}${items.length > shown.length ? ` (listing ${shown.length})` : ''}; ${cleanMessage(`first: ${items[0].file}:${items[0].line} ${items[0].rule} ${items[0].message}`).slice(0, 220)}`)
  return 1
}

const sampleOf = (sample) => readFileSync(sample, 'utf8').replace(/^﻿/, '')
const missing = (bin, hint) => notRun(`${bin} is not installed; ${hint}`)

export function main(argv, env = process.env) {
  const name = argv[0]
  const get = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null)
  const root = get('--root') ?? process.cwd()
  const sample = get('--sample')
  // PATH first, then the private tool folders (~/.meerkat-tools/bin and the Semgrep virtualenv). Nothing is ever installed.
  const home = env.MEERKAT_TOOLS_HOME || join(homedir(), '.meerkat-tools')
  const extra = [join(home, 'bin'), join(home, 'semgrep-venv', 'Scripts'), join(home, 'semgrep-venv', 'bin')].join(delimiter)
  const lookup = (bin) => findBinary(bin, env) ?? findBinary(bin, { ...env, PATH: extra, Path: extra })

  if (name === 'osv-scan') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const bin = lookup('osv-scanner')
      if (!bin) return missing('osv-scanner', 'install it from https://google.github.io/osv-scanner/installation/ (go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest)')
      const plan = osvPlan(env)
      if (plan.error) return nr(plan.error)
      const r = spawn(bin, plan.args, root, 600_000)
      if (r.status === 128) {
        console.log('osv-scan: not applicable, osv-scanner found no lockfiles or manifests to scan')
        return 0
      }
      if (r.error || (r.status !== 0 && r.status !== 1)) return nr(`osv-scanner failed (exit ${r.status ?? r.error?.code}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
      text = r.stdout
    }
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return nr('osv-scanner printed output that is not JSON')
    }
    return report('osv-scan', parseOsv(json, root))
  }

  if (name === 'semgrep-security') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const bin = lookup('semgrep')
      if (!bin) return missing('semgrep', 'install with: pip install semgrep. Your own semgrep fetches the registry rules from semgrep.dev under the Semgrep Rules License (your own internal use); Meerkat bundles none, or point MEERKAT_SEMGREP_CONFIG at your own rules file')
      const plan = semgrepPlan(env)
      if (plan.error) return nr(plan.error)
      const r = spawn(bin, plan.args, root, 600_000, plan.env)
      if (r.error?.code === 'ETIMEDOUT') return nr('semgrep ran past the 10 minute cap')
      text = r.stdout
      // Any status other than 0 or 1 is a failed run, whatever stdout holds (semgrep uses 2+ for errors and bad rule sets).
      if (r.error || !text || (r.status !== 0 && r.status !== 1)) return nr(`semgrep failed (exit ${r.status}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
    }
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return nr('semgrep printed output that is not JSON')
    }
    if (!Array.isArray(json?.results)) return nr('semgrep output has no results list')
    const fatal = (json.errors ?? []).find((e) => String(e?.level ?? '').toLowerCase() === 'error' || e?.type === 'Fatal error')
    if (fatal) return nr(`semgrep reported an error: ${fatal.type ?? ''} ${fatal.short_msg ?? fatal.message ?? ''}`.slice(0, 200))
    return report('semgrep-security', parseSemgrep(json))
  }

  if (name === 'clippy-correctness') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      if (!existsSync(join(root, 'Cargo.toml'))) {
        console.log('clippy-correctness: not applicable, no Cargo.toml')
        return 0
      }
      const bin = lookup('cargo')
      if (!bin) return missing('cargo', 'install Rust from https://rustup.rs and run: rustup component add clippy')
      // -A clippy::all first so only the two groups asked for are reported; the later -W flags switch those back on.
      const r = spawn(bin, ['clippy', '--message-format', 'json', '--', '-A', 'clippy::all', '-W', 'clippy::correctness', '-W', 'clippy::suspicious'], root, 1_800_000)
      text = r.stdout ?? ''
      if (r.error || (!text.includes('"reason"') && r.status !== 0)) return nr(`cargo clippy could not run (is the clippy component installed? rustup component add clippy): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
    }
    return report('clippy-correctness', parseClippy(text))
  }

  if (name === 'tsc-strict') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const tsconfig = ['tsconfig.json'].find((f) => existsSync(join(root, f)))
      if (!tsconfig) {
        console.log('tsc-strict: not applicable, no tsconfig.json')
        return 0
      }
      const tscJs = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
      if (!existsSync(tscJs)) return nr('typescript is not in this project\'s node_modules (Meerkat never installs it); add it with: npm i -D typescript')
      const r = spawn(process.execPath, [tscJs, '--noEmit', '--strict', '--pretty', 'false', '-p', tsconfig], root, 600_000)
      if (r.error) return nr(`tsc could not run: ${r.error.message}`)
      text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    }
    return report('tsc-strict', parseTsc(text), TSC_CAP)
  }

  if (name === 'gitleaks-secrets') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const bin = lookup('gitleaks')
      if (!bin) return missing('gitleaks', 'install it from https://github.com/gitleaks/gitleaks/releases')
      const dir = mkdtempSync(join(tmpdir(), 'meerkat-gitleaks-'))
      const reportPath = join(dir, 'report.json')
      try {
        const r = spawn(bin, ['detect', ...(existsSync(join(root, '.git')) ? [] : ['--no-git']), '--source', '.', '--report-format', 'json', '--report-path', reportPath, '--redact', '--no-banner'], root, 600_000)
        if (r.error || (r.status !== 0 && r.status !== 1)) return nr(`gitleaks failed (exit ${r.status ?? r.error?.code}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
        text = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '[]'
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    let json
    try {
      json = JSON.parse(text.trim() || '[]')
    } catch {
      return nr('gitleaks wrote a report that is not JSON')
    }
    return report('gitleaks-secrets', parseGitleaks(json, root))
  }

  if (name === 'staticcheck-go' || name === 'govulncheck-go') {
    const tool = name === 'staticcheck-go' ? 'staticcheck' : 'govulncheck'
    let text
    if (sample) text = sampleOf(sample)
    else {
      if (!existsSync(join(root, 'go.mod'))) {
        console.log(`${name}: not applicable, no go.mod`)
        return 0
      }
      const bin = lookup(tool)
      if (!bin) return missing(tool, tool === 'staticcheck' ? 'install with: go install honnef.co/go/tools/cmd/staticcheck@latest' : 'install with: go install golang.org/x/vuln/cmd/govulncheck@latest')
      const r = spawn(bin, tool === 'staticcheck' ? ['-f', 'json', './...'] : ['-format', 'json', './...'], root, 900_000)
      text = r.stdout ?? ''
      if (r.error || (r.status !== 0 && r.status !== 1 && r.status !== 3)) return nr(`${tool} failed (exit ${r.status ?? r.error?.code}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
    }
    return report(name, tool === 'staticcheck' ? parseStaticcheck(text, root) : parseGovulncheck(text, root))
  }

  if (name === 'actionlint-workflows') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      if (!existsSync(join(root, '.github', 'workflows'))) {
        console.log('actionlint-workflows: not applicable, no .github/workflows')
        return 0
      }
      const bin = lookup('actionlint')
      if (!bin) return missing('actionlint', 'install with: go install github.com/rhysd/actionlint/cmd/actionlint@latest')
      const r = spawn(bin, ['-format', '{{json .}}'], root, 300_000)
      if (r.error || (r.status !== 0 && r.status !== 1)) return nr(`actionlint failed (exit ${r.status ?? r.error?.code}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
      text = r.stdout
    }
    let json
    try {
      json = JSON.parse(String(text).trim() || '[]')
    } catch {
      return nr('actionlint printed output that is not JSON')
    }
    return report('actionlint-workflows', parseActionlint(json ?? [], root))
  }

  console.log('usage: node detectors.mjs <osv-scan|semgrep-security|clippy-correctness|tsc-strict|gitleaks-secrets|staticcheck-go|govulncheck-go|actionlint-workflows> [--root <dir>] [--sample <file>]')
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)) ?? NOT_RUN)
