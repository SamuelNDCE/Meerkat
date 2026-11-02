#!/usr/bin/env node
// The detectors pack: run a mature tool when it is installed, turn its JSON into Meerkat findings with the tool's own rule ids.
//   node thorough/detectors.mjs <osv-scan|semgrep-security|clippy-correctness|tsc-strict> [--root <dir>] [--sample <file>]
// --sample <file> reads a recorded copy of the tool's output instead of running the tool (the tests and self-tests use it, so no tool
// has to be installed). Nothing is ever installed here, and no project code runs beyond the tool itself.
// Exit: 0 clean (or not applicable), 1 findings, 75 NOT RUN (tool missing, hint printed).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finding, NOT_RUN, notRun } from './kit.mjs'
import { findBinary } from '../lib/which.mjs'

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

// ---- running ---------------------------------------------------------------------------------------------------------------------
function spawn(cmd, args, cwd, timeoutMs) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd) })
}

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
  console.log(`${name}: found ${items.length}${items.length > shown.length ? ` (listing ${shown.length})` : ''}; first: ${items[0].file}:${items[0].line} ${items[0].rule} ${items[0].message.slice(0, 160)}`)
  return 1
}

const sampleOf = (sample) => readFileSync(sample, 'utf8')
const missing = (bin, hint) => notRun(`${bin} is not installed; ${hint}`)

export function main(argv, env = process.env) {
  const name = argv[0]
  const get = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null)
  const root = get('--root') ?? process.cwd()
  const sample = get('--sample')
  const lookup = (bin) => findBinary(bin, env)

  if (name === 'osv-scan') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const bin = lookup('osv-scanner')
      if (!bin) return missing('osv-scanner', 'install it from https://google.github.io/osv-scanner/installation/ (go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest)')
      const r = spawn(bin, ['scan', '--format', 'json', '-r', '.'], root, 600_000)
      if (r.status === 128) {
        console.log('osv-scan: not applicable, osv-scanner found no lockfiles or manifests to scan')
        return 0
      }
      if (r.error || (r.status !== 0 && r.status !== 1)) return notRun(`osv-scanner failed (exit ${r.status ?? r.error?.code}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
      text = r.stdout
    }
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return notRun('osv-scanner printed output that is not JSON')
    }
    return report('osv-scan', parseOsv(json, root))
  }

  if (name === 'semgrep-security') {
    let text
    if (sample) text = sampleOf(sample)
    else {
      const bin = lookup('semgrep')
      if (!bin) return missing('semgrep', 'install with: pip install semgrep (or brew install semgrep)')
      const r = spawn(bin, ['scan', '--config', 'p/security-audit', '--json', '--quiet'], root, 600_000)
      if (r.error?.code === 'ETIMEDOUT') return notRun('semgrep ran past the 10 minute cap')
      text = r.stdout
      if (!text || (r.status !== 0 && r.status !== 1 && !String(text).trim().startsWith('{'))) return notRun(`semgrep failed (exit ${r.status}): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
    }
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return notRun('semgrep printed output that is not JSON')
    }
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
      if (r.error || (!text.includes('"reason"') && r.status !== 0)) return notRun(`cargo clippy could not run (is the clippy component installed? rustup component add clippy): ${String(r.stderr ?? '').trim().split('\n').pop()?.slice(0, 200)}`)
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
      if (!existsSync(tscJs)) return notRun('typescript is not in this project\'s node_modules (Meerkat never installs it); add it with: npm i -D typescript')
      const r = spawn(process.execPath, [tscJs, '--noEmit', '--strict', '--pretty', 'false', '-p', tsconfig], root, 600_000)
      if (r.error) return notRun(`tsc could not run: ${r.error.message}`)
      text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    }
    return report('tsc-strict', parseTsc(text), TSC_CAP)
  }

  console.log('usage: node detectors.mjs <osv-scan|semgrep-security|clippy-correctness|tsc-strict> [--root <dir>] [--sample <file>]')
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)) ?? NOT_RUN)
