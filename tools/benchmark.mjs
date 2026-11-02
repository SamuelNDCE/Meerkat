#!/usr/bin/env node
// Ground-truth benchmark: runs Meerkat on a known vulnerable open-source project and compares its findings with the project's
// published vulnerability list (benchmarks/<name>.json).
//   node tools/benchmark.mjs <name> [--dir <checkout>] [--keep]
// Without --dir the project is cloned (shallow) into a new empty temp folder and pinned to the commit in the benchmark file.
// The checkout is untrusted data: it is only read and scanned, nothing in it is installed or run by this tool.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

// The vulnerability class a Meerkat finding speaks about. Order matters: the first matching entry wins. A finding no entry knows has class null
// and can never match an expected vulnerability (it is listed as unmatched).
const CLASS_RULES = [
  [/open-redirect/i, 'open-redirect'],
  [/regex-dos|redos/i, 'redos'],
  [/\beval\b|new Function|code-injection/i, 'code-injection'],
  [/nosql|\$where/i, 'nosql-injection'],
  [/sql-concat|sql-injection/i, 'sql-injection'],
  [/ssrf/i, 'ssrf'],
  [/csrf/i, 'csrf'],
  [/xss|innerhtml|autoescape/i, 'xss'],
  [/cookie|session-cookie/i, 'session-cookie'],
  [/http-server|plain http|insecure-transport|no-tls/i, 'insecure-transport'],
  [/hsts|xfo|frame-ancestors|xcto|referrer-policy|permissions-policy|coop|coep|corp|csp|x-powered-by|helmet/i, 'security-headers'],
  [/secret|private-key|hardcoded|credential/i, 'hardcoded-secret'],
  [/session-fixation|regenerate/i, 'session-fixation'],
  [/enumerat/i, 'user-enumeration'],
  [/log-injection|log-forging/i, 'log-injection'],
  [/idor|access-control|authz|missing-auth/i, 'missing-access-control'],
]

export function classOf(finding) {
  const hay = [finding.rule, finding.check, finding.title].filter(Boolean).join(' ')
  for (const [re, cls] of CLASS_RULES) if (re.test(hay)) return cls
  return null
}

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '')

function findingLines(f) {
  const out = []
  if (Array.isArray(f.lines)) for (const n of f.lines) if (Number.isFinite(n) && n > 0) out.push(n)
  if (Number.isFinite(f.line) && f.line > 0) out.push(f.line)
  return out
}

// Matches findings to expected entries. An entry is found when a finding of the same class is in the same file and either has a line inside
// [first - window, last + window] (kind 'line'), or has no line at all because the check reports the whole file (kind 'file').
// One finding may support several expected entries, because one real line can hold two documented problems.
export function matchFindings(expected, findings, window = 5) {
  const used = new Set()
  const found = []
  const missed = []
  for (const e of expected) {
    let hit = null
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i]
      if (norm(f.file) !== norm(e.file) || classOf(f) !== e.class) continue
      const lines = findingLines(f)
      const kind = lines.some((n) => n >= e.lines[0] - window && n <= e.lines[1] + window) ? 'line' : lines.length === 0 ? 'file' : null
      if (!kind) continue
      used.add(i) // every finding that supports the entry is accounted for, not only the first
      if (!hit || (kind === 'line' && hit.kind === 'file')) hit = { index: i, kind }
    }
    if (hit) found.push({ expected: e, kind: hit.kind, finding: findings[hit.index] })
    else missed.push(e)
  }
  const unmatched = findings.filter((_, i) => !used.has(i))
  return { found, missed, unmatched }
}

export function unmatchedByRule(unmatched) {
  const counts = new Map()
  for (const f of unmatched) {
    const key = `${f.check || '?'}/${f.rule || '-'}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function summarize(bench, findings) {
  const { found, missed, unmatched } = matchFindings(bench.expected, findings, bench.lineWindow ?? 5)
  const total = bench.expected.length
  return { total, found, missed, unmatched, recall: total ? found.length / total : 0, byRule: unmatchedByRule(unmatched) }
}

function parseArgs(argv) {
  const o = { name: null, dir: null, keep: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') o.dir = argv[++i]
    else if (argv[i] === '--keep') o.keep = true
    else if (!o.name) o.name = argv[i]
  }
  return o
}

function cloneAtCommit(repo, commit) {
  const base = mkdtempSync(join(tmpdir(), 'meerkat-bench-'))
  const dir = join(base, 'checkout')
  mkdirSync(dir)
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'inherit' })
  execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', repo, commit], { stdio: 'inherit' })
  execFileSync('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD'], { stdio: 'inherit' })
  return { base, dir }
}

function findFile(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      const r = findFile(p, name)
      if (r) return r
    } else if (e === name) return p
  }
  return null
}

function runMeerkat(appDir) {
  const logs = mkdtempSync(join(tmpdir(), 'meerkat-bench-logs-'))
  const jsonOut = join(logs, 'run.json')
  const env = { ...process.env, MEERKAT_FINDINGS: 'all', MEERKAT_LOG_DIR: logs }
  spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', appDir, '--preset', 'quick', '--plain', '--json', jsonOut], { env, stdio: ['ignore', 'ignore', 'inherit'], timeout: 20 * 60 * 1000 })
  const file = findFile(logs, 'findings.json')
  if (!file) throw new Error(`Meerkat wrote no findings.json under ${logs}`)
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  return { findings: doc.findings || [], logs }
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (!o.name) {
    console.error('usage: node tools/benchmark.mjs <name> [--dir <checkout>] [--keep]')
    process.exit(2)
  }
  const file = join(ROOT, 'benchmarks', `${o.name}.json`)
  if (!existsSync(file)) {
    console.error(`no benchmark file ${file}`)
    process.exit(2)
  }
  const bench = JSON.parse(readFileSync(file, 'utf8'))
  let cloned = null
  let dir = o.dir ? resolve(o.dir) : null
  if (!dir) {
    console.error(`cloning ${bench.repo} at ${bench.commit} into a new temp folder ...`)
    cloned = cloneAtCommit(bench.repo, bench.commit)
    dir = cloned.dir
  } else {
    try {
      const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      if (head !== bench.commit) console.error(`note: ${dir} is at ${head}, the benchmark is pinned to ${bench.commit}; line numbers may differ`)
    } catch {
      console.error(`note: ${dir} is not a git checkout, the pinned commit ${bench.commit} cannot be checked`)
    }
  }
  const { findings, logs } = runMeerkat(dir)
  const s = summarize(bench, findings)
  console.log(`benchmark ${bench.name} (${bench.repo} @ ${bench.commit.slice(0, 12)})`)
  console.log(`findings: ${findings.length}, expected vulnerabilities: ${s.total}`)
  console.log(`recall: ${s.found.length}/${s.total} = ${(s.recall * 100).toFixed(1)}%`)
  console.log('\nfound:')
  for (const m of s.found) console.log(`  ${m.expected.id} ${m.expected.class} ${m.expected.file}:${m.expected.lines[0]}  <- ${m.finding.check}/${m.finding.rule || '-'} (${m.kind} match)`)
  console.log('\nmissed:')
  for (const e of s.missed) console.log(`  ${e.id} ${e.class} ${e.file}:${e.lines[0]}-${e.lines[1]}  ${e.note}`)
  console.log(`\nfindings not matched to any expected vulnerability: ${s.unmatched.length} (candidate false alarms, not judged here)`)
  for (const [rule, n] of s.byRule) console.log(`  ${String(n).padStart(4)}  ${rule}`)
  if (cloned && !o.keep) rmSync(cloned.base, { recursive: true, force: true })
  else if (cloned) console.error(`checkout kept at ${dir}`)
  rmSync(logs, { recursive: true, force: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
