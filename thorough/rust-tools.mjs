#!/usr/bin/env node
// Four Rust tools run for you when they are installed: cargo-geiger (unsafe usage), cargo-semver-checks (library API breaks),
// cargo-udeps (unused dependencies, needs a nightly Rust) and cargo-miri (undefined behaviour in tests, needs a nightly Rust).
//   node thorough/rust-tools.mjs <geiger-unsafe|semver-checks-api|udeps-unused|miri-ub> [--root <dir>] [--sample <file>]
// --sample <file> reads a recorded copy of the tool's output (tests and self-tests use it; no tool has to be installed). Nothing is ever
// installed here. Exit: 0 clean (or not applicable), 1 findings, 75 NOT RUN (tool missing or nightly missing, hint printed).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finding, NOT_RUN, notRun } from './kit.mjs'
import { findBinary } from '../lib/which.mjs'
import { cleanMessage } from '../lib/findings.mjs'
import { pathOutside, ruleId } from './detectors.mjs'

const MAX_BUFFER = 256 * 1024 * 1024
const posix = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')

// ---- cargo-geiger ----------------------------------------------------------------------------------------------------------------
// `cargo geiger --output-format Json` prints { packages: [{ package: { id: { name, version, source: { Path: "file:///..." } } },
// unsafety: { used: { functions|exprs|item_impls|item_traits|methods: { safe, unsafe_ } }, forbids_unsafe } }] }. It gives counts per
// package and NO file or line. Only packages from this project (a Path source) are reported; the unsafe code of dependencies is not.
export function parseGeiger(json, root = '') {
  const out = []
  for (const p of json?.packages ?? []) {
    const src = p?.package?.id?.source
    if (!src || !('Path' in src)) continue
    const used = p?.unsafety?.used ?? {}
    const n = (k) => Number(used[k]?.unsafe_) || 0
    const total = n('functions') + n('exprs') + n('item_impls') + n('item_traits') + n('methods')
    if (!total) continue
    const name = p.package.id.name
    out.push({
      severity: 'low',
      rule: 'geiger-unsafe-used',
      file: manifestOf(src.Path, root),
      line: 0,
      message: `[confidence high] ${name} ${p.package.id.version} uses unsafe code: ${n('exprs')} expression(s), ${n('functions')} function(s), ${n('item_impls')} impl(s), ${n('item_traits')} trait(s), ${n('methods')} method(s)${p.unsafety?.forbids_unsafe ? '' : '; no #![forbid(unsafe_code)]'}`,
    })
  }
  return out
}

// The Cargo.toml of a Path source ("file:///C:/proj/crate%230.1.0" style): relative to the root when it lies under it, else the crate name.
function manifestOf(url, root) {
  const p = posix(decodeURIComponent(String(url).replace(/^file:\/\/\/?/, '')).replace(/#.*$/, '')).replace(/\/$/, '')
  const r = posix(root).replace(/\/$/, '')
  if (r && p.toLowerCase().startsWith(r.toLowerCase() + '/')) return `${p.slice(r.length + 1)}/Cargo.toml`
  return 'Cargo.toml'
}

// ---- cargo-semver-checks ---------------------------------------------------------------------------------------------------------
// Human text only (no JSON in 0.51). Each failed lint is "--- failure <lint_name>: <title> ---", then "Failed in:" with indented lines that
// end in ", in <file>:<line>". One finding per failed place.
export function parseSemver(text) {
  const out = []
  const lines = String(text).split(/\r?\n/)
  let lint = null
  let title = ''
  let inFailed = false
  for (const line of lines) {
    const h = /^--- failure ([a-z0-9_]+): (.*?) ---\s*$/.exec(line)
    if (h) {
      lint = h[1]
      title = h[2]
      inFailed = false
      continue
    }
    if (!lint) continue
    if (/^Failed in:/.test(line)) {
      inFailed = true
      continue
    }
    if (/^---/.test(line) || /^\s+Summary/.test(line)) {
      inFailed = false
      if (/^---/.test(line)) lint = null
      continue
    }
    if (!inFailed || !line.trim()) continue
    const m = /^\s+(.*?),? in (.+?):(\d+)\s*$/.exec(line)
    const where = m ? { desc: m[1], file: posix(m[2]), line: Number(m[3]) } : { desc: line.trim(), file: 'Cargo.toml', line: 0 }
    out.push({ severity: 'high', rule: ruleId(lint, 'semver'), file: where.file, line: where.line, message: `[confidence high] ${lint}: ${title}: ${where.desc.replace(/\s+/g, ' ').slice(0, 260)}` })
  }
  return out
}

// ---- cargo-udeps -----------------------------------------------------------------------------------------------------------------
// `cargo +nightly udeps --output json` prints { success, unused_deps: { "<name> <ver> (<source>)": { manifest_path, normal, development, build } } }.
// Exit 1 with success:false when something is unused. The tool says its answers can be false positives, so the severity is low.
export function parseUdeps(json, root = '', readToml = () => '') {
  const out = []
  for (const [key, v] of Object.entries(json?.unused_deps ?? {})) {
    const crate = key.split(' ')[0]
    const manifest = tomlPath(v?.manifest_path, root)
    const toml = readToml(manifest)
    for (const [kind, names] of [['normal', v?.normal], ['development', v?.development], ['build', v?.build]]) {
      for (const dep of names ?? []) {
        const idx = String(toml).split(/\r?\n/).findIndex((l) => new RegExp(`^\\s*${String(dep).replace(/[-_]/g, '[-_]')}\\s*(=|\\.)`).test(l))
        out.push({ severity: 'low', rule: 'udeps-unused-dependency', file: manifest, line: idx + 1 > 0 ? idx + 1 : 0, message: `[confidence medium] ${crate}: ${kind} dependency ${dep} is not used by any checked target (cargo-udeps can be wrong for doc-tests, macros and cfg code)` })
      }
    }
  }
  return out
}

function tomlPath(p, root) {
  const s = posix(p)
  const r = posix(root).replace(/\/$/, '')
  if (r && s.toLowerCase().startsWith(r.toLowerCase() + '/')) return s.slice(r.length + 1)
  const m = /(?:^|\/)(fixtures\/[^/]+\/Cargo\.toml)$/.exec(s)
  return m ? m[1] : 'Cargo.toml'
}

// ---- cargo-miri ------------------------------------------------------------------------------------------------------------------
// `cargo +nightly miri test` stops a test at the first "error: Undefined Behavior: <what>", then prints " --> file:line:col". One finding each.
export function parseMiri(text) {
  const out = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /error: (Undefined Behavior|unsupported operation|the evaluated program (?:leaked|deadlocked)[^:]*)\s*:?\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const loc = /^\s*--> (.+?):(\d+):\d+/.exec(lines[i + 1] ?? '')
    const kind = m[1].startsWith('Undefined') ? 'ub' : m[1].startsWith('unsupported') ? 'unsupported' : 'leak'
    // Only undefined behaviour is a defect; an operation Miri cannot run is not the program's fault.
    if (kind !== 'ub') continue
    out.push({ severity: 'high', rule: 'miri-undefined-behavior', file: loc ? posix(loc[1]) : 'Cargo.toml', line: loc ? Number(loc[2]) : 0, message: `[confidence high] Undefined Behavior: ${m[2].replace(/\s+/g, ' ').slice(0, 280)}` })
  }
  return out
}

// ---- running ---------------------------------------------------------------------------------------------------------------------
const nr = (message) => notRun(cleanMessage(message))
const missing = (tool, hint) => notRun(`${tool} is not installed; ${hint}`)

function report(name, items) {
  for (const f of items) finding(f.severity, f.rule, f.file, f.line, f.message)
  if (!items.length) {
    console.log(`${name}: no findings`)
    return 0
  }
  console.log(`${name}: found ${items.length}; ${cleanMessage(`first: ${items[0].file}:${items[0].line} ${items[0].rule} ${items[0].message}`).slice(0, 220)}`)
  return 1
}

const spawn = (cmd, args, cwd, timeoutMs, env) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: timeoutMs })

// The environment a cargo subcommand runs in: Meerkat's private tool folder first (cargo finds cargo-geiger there), then PATH without any
// entry inside the scanned project. Compiler wrapper variables are emptied, as for clippy.
export function toolEnv(root, env = process.env) {
  const home = env.MEERKAT_TOOLS_HOME || join(homedir(), '.meerkat-tools')
  const clean = pathOutside(env.PATH ?? env.Path ?? '', root)
  const path = [join(home, 'bin'), clean].filter(Boolean).join(delimiter)
  return { ...env, PATH: path, Path: path, RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '', CARGO_BUILD_RUSTC_WRAPPER: '' }
}

const TOOLS = {
  'geiger-unsafe': { bin: 'cargo-geiger', sub: ['geiger', '--output-format', 'Json'], hint: 'install with: cargo install cargo-geiger --locked (0.14 needs Rust 1.97; on older Rust use --version 0.13.0)' },
  'semver-checks-api': { bin: 'cargo-semver-checks', sub: ['semver-checks'], hint: 'install with: cargo install cargo-semver-checks --locked' },
  'udeps-unused': { bin: 'cargo-udeps', sub: ['+nightly', 'udeps', '--output', 'json'], hint: 'install with: cargo install cargo-udeps --locked, and a nightly Rust: rustup toolchain install nightly --profile minimal', nightly: true },
  'miri-ub': { bin: 'cargo-miri', sub: ['+nightly', 'miri', 'test'], hint: 'install a nightly Rust with Miri: rustup toolchain install nightly --profile minimal --component miri --component rust-src', nightly: true },
}

// A manifest that is a library: [lib], a src/lib.rs, or no binary target. cargo-semver-checks only checks libraries.
export function isLibrary(root, readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)) {
  const toml = readFile(join(root, 'Cargo.toml')) ?? ''
  return /^\s*\[lib\]/m.test(toml) || existsSync(join(root, 'src', 'lib.rs'))
}

export function main(argv, env = process.env) {
  const name = argv[0]
  const get = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null)
  const root = resolve(get('--root') ?? process.cwd())
  const sample = get('--sample')
  const tool = TOOLS[name]
  if (!tool) {
    console.log('usage: node rust-tools.mjs <geiger-unsafe|semver-checks-api|udeps-unused|miri-ub> [--root <dir>] [--sample <file>]')
    return 2
  }
  let text
  if (sample) text = readFileSync(sample, 'utf8').replace(/^﻿/, '')
  else {
    if (!existsSync(join(root, 'Cargo.toml'))) {
      console.log(`${name}: not applicable, no Cargo.toml`)
      return 0
    }
    if (name === 'semver-checks-api' && !isLibrary(root)) {
      console.log(`${name}: not applicable, this crate is a binary (cargo-semver-checks only checks libraries)`)
      return 0
    }
    const e = toolEnv(root, env)
    const lookup = (b) => findBinary(b, e)
    if (!lookup(tool.bin)) return missing(tool.bin, tool.hint)
    const cargo = lookup('cargo')
    if (!cargo) return missing('cargo', 'install Rust from https://rustup.rs')
    if (tool.nightly) {
      const tc = spawn(lookup('rustup') ?? 'rustup', ['toolchain', 'list'], root, 30_000, e)
      if (tc.error || !/^nightly/m.test(String(tc.stdout))) return nr(`no nightly Rust toolchain; ${tool.hint}`)
    }
    const r = spawn(cargo, tool.sub, root, name === 'miri-ub' ? 1_800_000 : 900_000, e)
    if (r.error) return nr(`${tool.bin} could not run: ${r.error.message}`)
    // A tool that cannot build the project (exit 101, no result) is NOT RUN, never a pass.
    if (name === 'geiger-unsafe') {
      if (r.status !== 0) return nr(`cargo geiger failed (exit ${r.status}): ${String(r.stderr).trim().split('\n').pop()?.slice(0, 200)}`)
      text = r.stdout
    } else if (name === 'udeps-unused') {
      text = r.stdout
      if (r.status !== 0 && r.status !== 1) return nr(`cargo udeps failed (exit ${r.status}): ${String(r.stderr).trim().split('\n').pop()?.slice(0, 200)}`)
      if (!text.trim().startsWith('{')) return nr(`cargo udeps printed no JSON: ${String(r.stderr).trim().split('\n').pop()?.slice(0, 200)}`)
    } else if (name === 'semver-checks-api') {
      text = `${r.stdout}\n${r.stderr}`
      if (r.status !== 0 && !/Summary semver requires/.test(text)) return nr(`cargo semver-checks could not compare against a baseline (a published version or --baseline-rev is needed): ${text.trim().split('\n').pop()?.slice(0, 200)}`)
    } else {
      text = `${r.stdout}\n${r.stderr}`
      if (r.status !== 0 && !/Undefined Behavior/.test(text)) return nr(`cargo miri test failed without a Miri finding (exit ${r.status}): ${text.trim().split('\n').pop()?.slice(0, 200)}`)
    }
  }
  if (name === 'geiger-unsafe') {
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return nr('cargo geiger printed output that is not JSON')
    }
    return report(name, parseGeiger(json, root))
  }
  if (name === 'udeps-unused') {
    let json
    try {
      json = JSON.parse(text.trim())
    } catch {
      return nr('cargo udeps printed output that is not JSON')
    }
    return report(name, parseUdeps(json, root, (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '')))
  }
  if (name === 'semver-checks-api') return report(name, parseSemver(text))
  return report(name, parseMiri(text))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)) ?? NOT_RUN)
