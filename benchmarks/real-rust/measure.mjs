#!/usr/bin/env node
// Real-code accuracy benchmark for the rust-plus rules. See benchmarks/real-rust/README.md.
//
//   node benchmarks/real-rust/measure.mjs [tree]                       measure against a Rust tree
//   node benchmarks/real-rust/measure.mjs --copy-from <project> [tree] copy <project>/{apps,packages,tools} (Rust files only) into the tree first
//   node benchmarks/real-rust/measure.mjs --write-baseline [tree]      store this run as the new baseline (labels.json, known-findings.txt, baseline.json)
//   flags: --strict (also fail when a labelled TRUE finding is lost or a new unlabelled finding appears)  --json (print the result as JSON)
//
// The tree comes from the argument, then MEERKAT_REALBENCH_TREE, then <os temp dir>/meerkat-real-rust-tree. The source project for --copy-from
// is the flag value; if the tree does not exist yet, MEERKAT_REALBENCH_SOURCE is used. No machine path is stored in any committed file.
// Exit 0: precision is at or above the baseline. Exit 1: precision dropped (or --strict condition failed). Exit 2: usage or setup error.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const CHECK_SCRIPT = join(REPO, 'thorough', 'rust-plus.mjs')
const CHECKS = ['rp-safety', 'rp-errors', 'rp-async', 'rp-perf-style', 'rp-cargo', 'rp-api-ffi-wasm']
const LABELS = join(HERE, 'labels.json')
const BASELINE = join(HERE, 'baseline.json')
const KNOWN = join(HERE, 'known-findings.txt')
const SKIP_DIRS = new Set(['target', '.worktrees', 'node_modules', '.git'])
const KEEP_FILE = /(\.rs|(^|\/)Cargo\.toml|(^|\/)Cargo\.lock|(^|\/)deny\.toml)$/

const fail = (msg, code = 2) => {
  process.stderr.write(`real-rust benchmark: ${msg}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return false
  args.splice(i, 1)
  return true
}
const valueOf = (name) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) fail(`${name} needs a value`)
  args.splice(i, 2)
  return v
}
const writeBaseline = flag('--write-baseline')
const strict = flag('--strict')
const asJson = flag('--json')
const copyFlag = valueOf('--copy-from')
const unknownFlag = args.find((a) => a.startsWith('--'))
if (unknownFlag) fail(`unknown option ${unknownFlag}`)
const tree = resolve(args[0] ?? process.env.MEERKAT_REALBENCH_TREE ?? join(tmpdir(), 'meerkat-real-rust-tree'))

const normFile = (f) => f.split('\\').join('/').replace(/^\.\//, '')
const keyOf = (rule, file, line) => `${rule}|${normFile(file)}|${line}`
const shortHash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)

// Build the read-only copy: apps/, packages/, tools/ of the source project, Rust and Cargo files only, without target/ and .worktrees/.
function buildCopy(source, dest) {
  if (!source) fail('--copy-from needs a project folder (or set MEERKAT_REALBENCH_SOURCE)')
  const src = resolve(source)
  if (!existsSync(src)) fail(`source folder not found: ${src}`)
  if (resolve(dest) === src || resolve(dest).startsWith(src + sep)) fail('the copy must not be inside the source project')
  if (resolve(dest).startsWith(REPO + sep) || resolve(dest) === REPO) fail('the copy must not be inside this repository')
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  let n = 0
  for (const top of ['apps', 'packages', 'tools']) {
    const from = join(src, top)
    if (!existsSync(from)) continue
    cpSync(from, join(dest, top), {
      recursive: true,
      filter: (p) => {
        const rel = normFile(relative(src, p))
        if (rel.split('/').some((part) => SKIP_DIRS.has(part))) return false
        if (statSync(p).isDirectory()) return true
        const keep = KEEP_FILE.test(rel)
        if (keep) n++
        return keep
      },
    })
  }
  for (const f of ['Cargo.toml', 'Cargo.lock', 'deny.toml']) if (existsSync(join(src, f))) cpSync(join(src, f), join(dest, f))
  process.stderr.write(`copied ${n} Rust and Cargo files into the benchmark tree\n`)
}

function hasRust(dir) {
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory() ? walk(p) : e.name.endsWith('.rs')) return true
    }
    return false
  }
  return walk(dir)
}

// A digest of the tree's Rust files (paths and contents), so a run on a different snapshot of the project is noticed: labels are tied to exact lines.
function treeDigest(dir) {
  const files = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.rs')) files.push(p)
    }
  }
  walk(dir)
  const h = createHash('sha1')
  for (const f of files.map((p) => normFile(relative(dir, p))).sort()) h.update(f + '|').update(readFileSync(join(dir, f))).update('|')
  return `${files.length}:${h.digest('hex').slice(0, 16)}`
}

// Run one rust-plus check on the tree and return its findings.
function runCheck(id) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [CHECK_SCRIPT, id, '--root', tree], { cwd: REPO, env: { ...process.env, MEERKAT_FINDINGS: 'all' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${id} did not finish in 10 minutes`))
    }, 600000)
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (!/MEERKAT-SUB /.test(out)) return reject(new Error(`${id} printed no sub-check lines${err ? `: ${err.trim().slice(0, 300)}` : ''}`))
      const found = []
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^MEERKAT-FINDING (\S+) (\S+) (.+?):(\d+) (.*)$/)
        if (m) found.push({ check: id, sev: m[1], rule: m[2], file: normFile(m[3]), line: Number(m[4]), message: m[5] })
      }
      done(found)
    })
  })
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a')

async function main() {
  if (!existsSync(LABELS)) fail(`labels file missing: ${relative(REPO, LABELS)}`)
  if (copyFlag) buildCopy(copyFlag, tree)
  else if (!existsSync(tree) && process.env.MEERKAT_REALBENCH_SOURCE) buildCopy(process.env.MEERKAT_REALBENCH_SOURCE, tree)
  if (!existsSync(tree)) fail(`tree not found: ${tree}\nBuild it with --copy-from <project folder>, or pass the folder of a Rust tree.`)
  if (!hasRust(tree)) fail(`no .rs files under ${tree}`)

  const labels = JSON.parse(readFileSync(LABELS, 'utf8')).labels
  const labelByKey = new Map(labels.map((l) => [keyOf(l.rule, l.file, l.line), l]))
  if (labelByKey.size !== labels.length) fail('labels.json has two labels for the same rule, file and line')

  const digest = treeDigest(tree)
  const results = await Promise.all(CHECKS.map(runCheck))
  const findings = results.flat()
  const seen = new Set(findings.map((f) => keyOf(f.rule, f.file, f.line)))

  // precision over the labelled findings that the current run still reports
  const per = {}
  let tp = 0
  let fp = 0
  const matchedKeys = new Set()
  for (const f of findings) {
    const k = keyOf(f.rule, f.file, f.line)
    const l = labelByKey.get(k)
    if (!l || matchedKeys.has(k)) continue
    matchedKeys.add(k)
    const p = (per[f.rule] ??= { true: 0, false: 0 })
    if (l.label === 'TRUE') {
      tp++
      p.true++
    } else {
      fp++
      p.false++
    }
  }
  const lost = labels.filter((l) => !seen.has(keyOf(l.rule, l.file, l.line)))
  const lostTrue = lost.filter((l) => l.label === 'TRUE')
  const lostFalse = lost.filter((l) => l.label === 'FALSE')
  const precision = tp + fp ? tp / (tp + fp) : null

  // unlabelled findings: not in labels.json, and (when a baseline exists) not seen in the baseline run either
  const unlabelled = findings.filter((f) => !labelByKey.has(keyOf(f.rule, f.file, f.line)))
  let fresh = unlabelled
  const perRule = Object.fromEntries(Object.entries(per).sort(([a], [b]) => a.localeCompare(b)).map(([r, v]) => [r, { true: v.true, false: v.false, precision: v.true + v.false ? v.true / (v.true + v.false) : null }]))

  if (writeBaseline) {
    const baseline = { treeDigest: digest, precision, labelled: labels.length, matched: tp + fp, true: tp, false: fp, findings: findings.length, perRule: Object.fromEntries(Object.entries(perRule).map(([r, v]) => [r, v.precision])) }
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 1) + '\n')
    writeFileSync(KNOWN, [...new Set(findings.map((f) => shortHash(keyOf(f.rule, f.file, f.line))))].sort().join('\n') + '\n')
    fresh = []
    process.stderr.write(`baseline written: precision ${precision === null ? 'n/a' : precision.toFixed(4)} on ${tp + fp} labelled findings\n`)
  }

  if (!writeBaseline && existsSync(KNOWN)) {
    const known = new Set(readFileSync(KNOWN, 'utf8').split(/\s+/).filter(Boolean))
    fresh = unlabelled.filter((f) => !known.has(shortHash(keyOf(f.rule, f.file, f.line))))
  }
  let base = null
  if (existsSync(BASELINE)) base = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const problems = []
  const notes = []
  if (base?.treeDigest && base.treeDigest !== digest) notes.push(`this tree (${digest}) is not the snapshot the labels were made on (${base.treeDigest}); labels only match where the lines are unchanged`)
  if (precision === null) problems.push('no labelled finding was reported at all: is this the tree the labels were made on?')
  else if (base && precision < base.precision - 1e-9) problems.push(`precision ${precision.toFixed(4)} is below the baseline ${base.precision.toFixed(4)}`)
  if (strict && lostTrue.length) problems.push(`${lostTrue.length} labelled TRUE finding(s) are no longer reported`)
  if (strict && fresh.length) problems.push(`${fresh.length} new unlabelled finding(s) need a label`)

  const freshByRule = {}
  for (const f of fresh) freshByRule[f.rule] = (freshByRule[f.rule] ?? 0) + 1
  const summary = {
    tree: '(see argument)',
    findings: findings.length,
    labelled: labels.length,
    matched: tp + fp,
    true: tp,
    false: fp,
    precision,
    baselinePrecision: base ? base.precision : null,
    lostLabelledTrue: lostTrue.length,
    lostLabelledFalse: lostFalse.length,
    unlabelled: unlabelled.length,
    newUnlabelled: fresh.length,
    newUnlabelledByRule: freshByRule,
    perRule,
    treeDigest: digest,
    notes,
    problems,
  }
  if (asJson) process.stdout.write(JSON.stringify(summary, null, 1) + '\n')
  else {
    const out = []
    out.push(`findings reported by the six rust-plus checks: ${findings.length}`)
    out.push(`labelled findings still reported: ${tp + fp} of ${labels.length} (TRUE ${tp}, FALSE ${fp}); lost since labelling: TRUE ${lostTrue.length}, FALSE ${lostFalse.length}`)
    out.push(`precision = TRUE / (TRUE + FALSE) = ${precision === null ? 'n/a' : `${(100 * precision).toFixed(1)}%`}${base ? `   (baseline ${(100 * base.precision).toFixed(1)}%)` : '   (no baseline yet)'}`)
    out.push(`unlabelled findings: ${unlabelled.length} (the rest of the run, never sampled); new unlabelled since the baseline: ${fresh.length}${fresh.length ? ' (label them before they can count)' : ''}`)
    for (const [r, n] of Object.entries(freshByRule).sort()) out.push(`  new  ${r}: ${n}`)
    out.push('per rule (TRUE / FALSE / precision):')
    for (const [r, v] of Object.entries(perRule)) out.push(`  ${r.padEnd(34)} ${String(v.true).padStart(3)} ${String(v.false).padStart(3)}  ${pct(v.true, v.true + v.false)}`)
    for (const n of notes) out.push(`NOTE: ${n}`)
    for (const p of problems) out.push(`FAIL: ${p}`)
    if (!problems.length) out.push('PASS')
    process.stdout.write(out.join('\n') + '\n')
  }
  process.exit(problems.length ? 1 : 0)
}

main().catch((e) => fail(e.message))
