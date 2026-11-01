// The compatibility matrix: every check Meerkat has, run through the real runner on a set of small, clean sample projects of many kinds
// (tools/compat-fixtures.mjs). The projects are clean, so a FAIL is a false-positive candidate; a crash or a hang is a bug in the check.
//   node tools/compat-matrix.mjs [--out <file>] [--dir <fixtures folder>] [--only a,b] [--timeout <seconds per check>] [--keep]
// Writes <out>.json and <out>.txt (default: the OS temp dir) and prints a summary of the problem classes:
//   (a) CRASH         exit code other than 0, 1 or 75, a stack trace in the output, or a timeout
//   (b) FALSE-FAIL    any FAIL on a clean fixture
//   (c) BAD NOT RUN   a NOT RUN whose reason is not a missing tool (or "not a git repo" on the not-a-git-folder fixture)
//   (d) DEAD          a check that never PASSES on any project
//   (e) DUPLICATE     the same check id in two packs
//   (f) SLOW          a check that took over 10 seconds on a tiny fixture
// Exit code: 0 when there is no problem in a, b, c, e; 1 otherwise.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FIXTURES, makeFixtures } from './compat-fixtures.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OK_CODES = new Set([0, 1, 75])
export const SLOW_MS = 10_000
const STACK = /\n\s+at\s+\S+.*\(?(file:\/\/|node:internal|[A-Za-z]:[\\/]|\/).*:\d+:\d+\)?|\bUncaught\b|\bTypeError:|\bReferenceError:|\bSyntaxError:|\bRangeError:|ERR_[A-Z_]+|Unhandled promise rejection/

// A NOT RUN is fine when a tool is missing (the message says which and how to install it).
export const toolReason = (d) => /missing on PATH|^needs [\w.,@/ -]+: |not installed|isn't installed|is not installed|install[: ]|needs .* (installed|on PATH)|no .*(binary|executable) found|not found on PATH|toolchain/i.test(d)
// A budget check with no budget written down: it says which setting to add (NOT RUN, by design: it cannot know your numbers).
export const configReason = (d) => /.meerkat-budgets.json|Add, for example|has no (?:eslint|prettier|stylelint) configuration|could not reach (?:the service|the npm registry)|registry could not be reached/i.test(d)
// FAILs that are TRUE on a fixture because the fixture is empty on purpose: a repo with no files really has no README or licence.
export const EXPECTED_FAILS = { 'empty-git-repo': ['license', 'readme-sections', 'security-policy', 'gitignore-essentials'] }
export const gitReason = (d) => /not a git repo|no git repo|not a git folder|git repository/i.test(d)

// Every check id the packs define, with the pack folder it came from (for duplicate detection).
export async function allCheckIds() {
  const { loadChecks } = await import(pathToFileURL(join(ROOT, 'lib', 'load-checks.mjs')).href)
  const rows = []
  for (const d of readdirSync(join(ROOT, 'packs'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    for (const c of await loadChecks(join(ROOT, 'packs', d.name))) rows.push({ id: c.id, pack: d.name, optIn: c.optIn ?? null })
  }
  return rows
}

function runProject({ name, dir, work, timeoutSeconds, overallSeconds, ids, packs }) {
  return new Promise((done) => {
    const cfg = join(work, `${name}.config.json`)
    const override = Object.fromEntries(ids.map((id) => [id, { timeoutSeconds }]))
    writeFileSync(cfg, JSON.stringify({ packs, override }, null, 2))
    const json = join(work, `${name}.result.json`)
    const logs = join(work, 'logs', name)
    mkdirSync(logs, { recursive: true })
    const env = { ...process.env, MEERKAT_PLAIN: '1', MEERKAT_LOG_DIR: logs, MEERKAT_TIMINGS: join(work, 'timings.json'), MEERKAT_STATUS: join(work, `${name}.status.json`), MEERKAT_HISTORY: join(work, 'history.json'), MEERKAT_USER_CONFIG: join(work, 'no-user-config.json') }
    const child = spawn(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--config', cfg, '--preset', 'full', '--plain', '--json', json], { cwd: ROOT, env, windowsHide: true })
    let out = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (out += b))
    const t0 = Date.now()
    const killer = setTimeout(() => {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      } catch {
        /* ignore */
      }
      child.kill()
    }, overallSeconds * 1000)
    child.on('close', (code) => {
      clearTimeout(killer)
      let parsed = null
      try {
        parsed = JSON.parse(readFileSync(json, 'utf8'))
      } catch {
        /* no result */
      }
      done({ code, parsed, out, ms: Date.now() - t0 })
    })
  })
}

// One row per (project, check): status, duration, reason, and the crash verdict.
export function classify(name, r) {
  const log = r.logFile && existsSync(r.logFile) ? readFileSync(r.logFile, 'utf8') : ''
  const detail = String(r.detail ?? '').split('\n')[0].replace(/\s*\[full output: .*\]\s*$/, '').slice(0, 220)
  const timedOut = /timed out after/i.test(detail)
  const badExit = r.exitCode !== undefined && r.exitCode !== null && !OK_CODES.has(r.exitCode)
  const stack = r.status !== 'PASS' && STACK.test(log) && !/self-test/.test(detail)
  const crash = timedOut || badExit || (r.status === 'FAIL' && stack)
  return { project: name, id: r.id, status: r.status, ms: r.ms ?? 0, exitCode: r.exitCode ?? null, reason: detail, crash: crash ? (timedOut ? 'timed out' : badExit ? `exit code ${r.exitCode}` : 'stack trace in the output') : null }
}

export async function runMatrix({ names = Object.keys(FIXTURES), dir, work, timeoutSeconds = 120, overallSeconds = 1800, say = () => {} } = {}) {
  const defs = await allCheckIds()
  mkdirSync(work, { recursive: true })
  const ids = defs.map((d) => d.id)
  // EVERY pack on every project (not just the ones that apply), so each check shows how it behaves where it does not belong. The neuralvault
  // example pack needs that app's own window harness and is not in packs/.
  const packs = [...new Set(defs.map((d) => d.pack))]
  const projects = makeFixtures(dir, names)
  const rows = []
  const meta = {}
  for (const name of names) {
    say(`== ${name}`)
    const r = await runProject({ name, dir: projects[name], work, timeoutSeconds, overallSeconds, ids, packs })
    if (!r.parsed) {
      meta[name] = { error: `the run produced no result (exit ${r.code}): ${r.out.split('\n').slice(-5).join(' | ').slice(0, 400)}` }
      say(`   no result: ${meta[name].error}`)
      continue
    }
    for (const res of r.parsed.results) rows.push(classify(name, res))
    meta[name] = { summary: r.parsed.summary, ms: r.ms }
    say(`   ${r.parsed.summary}`)
  }
  return { rows, meta, defs, names }
}

export function analyse({ rows, meta, defs, names }) {
  const byProject = {}
  for (const n of names) byProject[n] = { PASS: 0, FAIL: 0, 'NOT RUN': 0, total: 0 }
  for (const r of rows) {
    const c = byProject[r.project]
    c[r.status] = (c[r.status] ?? 0) + 1
    c.total++
  }
  const crashes = rows.filter((r) => r.crash)
  const isExpected = (r) => EXPECTED_FAILS[r.project]?.includes(r.id)
  const falseFails = rows.filter((r) => r.status === 'FAIL' && !r.crash && !isExpected(r))
  const expectedFails = rows.filter((r) => r.status === 'FAIL' && isExpected(r))
  const statusOf = new Map(rows.map((r) => [`${r.project}/${r.id}`, r.status]))
  const badNotRun = rows.filter((r) => {
    if (r.status !== 'NOT RUN') return false
    if (toolReason(r.reason) || configReason(r.reason)) return false
    if (r.project === 'not-a-git-folder' && gitReason(r.reason)) return false
    const dep = /^needs (\S+), which did not pass/.exec(r.reason)
    if (dep) {
      const s = statusOf.get(`${r.project}/${dep[1]}`)
      return s === 'PASS' // a dependency that passed cannot be the reason
    }
    return true
  })
  const everPassed = new Set(rows.filter((r) => r.status === 'PASS').map((r) => r.id))
  const seen = new Set(rows.map((r) => r.id))
  const dead = [...seen].filter((id) => !everPassed.has(id)).map((id) => ({ id, reasons: [...new Set(rows.filter((r) => r.id === id).map((r) => `${r.status}: ${r.reason}`))].slice(0, 2) }))
  const dupMap = new Map()
  for (const d of defs) dupMap.set(d.id, [...(dupMap.get(d.id) ?? []), d.pack])
  const duplicates = [...dupMap].filter(([, packs]) => packs.length > 1).map(([id, packs]) => ({ id, packs }))
  const slow = rows.filter((r) => r.ms > SLOW_MS)
  return { byProject, crashes, falseFails, expectedFails, badNotRun, dead, duplicates, slow, meta }
}

export function formatReport(rows, a, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const L = []
  L.push(`Meerkat compatibility matrix, ${date}`, '')
  L.push('Per project (PASS / FAIL / NOT RUN):')
  for (const [n, c] of Object.entries(a.byProject)) L.push(`  ${n.padEnd(20)} ${String(c.PASS).padStart(4)} ${String(c.FAIL).padStart(4)} ${String(c['NOT RUN']).padStart(4)}   (${c.total} checks)${a.meta[n]?.error ? `  ERROR: ${a.meta[n].error}` : ''}`)
  const sec = (title, items, fmt) => {
    L.push('', `${title}: ${items.length}`)
    for (const i of items) L.push(`  ${fmt(i)}`)
  }
  sec('(a) CRASH', a.crashes, (r) => `${r.project} / ${r.id}: ${r.crash}: ${r.reason}`)
  sec('(b) FALSE-FAIL candidates', a.falseFails, (r) => `${r.project} / ${r.id}: ${r.reason}`)
  if (a.expectedFails.length) L.push('', `Expected FAILs (the fixture is empty on purpose): ${a.expectedFails.map((r) => `${r.project}/${r.id}`).join(', ')}`)
  sec('(c) NOT RUN without a tool reason', a.badNotRun, (r) => `${r.project} / ${r.id}: ${r.reason}`)
  sec('(d) DEAD (never PASS anywhere)', a.dead, (d) => `${d.id}: ${d.reasons.join(' || ')}`)
  sec('(e) DUPLICATE ids', a.duplicates, (d) => `${d.id} in ${d.packs.join(', ')}`)
  sec(`(f) SLOW (over ${SLOW_MS / 1000}s)`, a.slow, (r) => `${r.project} / ${r.id}: ${(r.ms / 1000).toFixed(1)}s`)
  L.push('', 'Every (project, check):')
  const w = Math.max(...rows.map((r) => r.id.length), 5)
  for (const r of rows) L.push(`${r.project.padEnd(20)} ${r.id.padEnd(w)} ${r.status.padEnd(7)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.reason}`)
  return L.join('\n') + '\n'
}

function parseArgs(argv) {
  const o = { out: null, dir: null, only: null, timeout: 120, keep: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i]
    else if (argv[i] === '--dir') o.dir = argv[++i]
    else if (argv[i] === '--only') o.only = argv[++i].split(',')
    else if (argv[i] === '--timeout') o.timeout = Number(argv[++i])
    else if (argv[i] === '--keep') o.keep = true
  }
  return o
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv)
  const work = mkdtempSync(join(tmpdir(), 'meerkat-matrix-'))
  const dir = o.dir ? resolve(o.dir) : join(work, 'projects')
  const out = resolve(o.out ?? join(tmpdir(), 'meerkat-compat-matrix'))
  const res = await runMatrix({ names: o.only ?? undefined, dir, work, timeoutSeconds: o.timeout, say: (s) => console.log(s) })
  const a = analyse(res)
  const text = formatReport(res.rows, a)
  writeFileSync(`${out}.json`, JSON.stringify({ date: new Date().toISOString(), byProject: a.byProject, crashes: a.crashes, falseFails: a.falseFails, badNotRun: a.badNotRun, dead: a.dead, duplicates: a.duplicates, slow: a.slow, rows: res.rows }, null, 2))
  writeFileSync(`${out}.txt`, text)
  console.log(text.split('\nEvery (project, check):')[0])
  console.log(`written: ${out}.json and ${out}.txt`)
  if (!o.keep) rmSync(work, { recursive: true, force: true })
  process.exit(a.crashes.length || a.falseFails.length || a.badNotRun.length || a.duplicates.length ? 1 : 0)
}
