// Benchmark: how many gate runs and how much wall time a batch of PR branches costs.
// Usage: node tools/bench-batch.mjs <meerkat-root> [--branches N] [--conflicts K] [--gate-ms MS]
// Builds a throwaway repo with N feature branches, K of which textually conflict with a base that moved on,
// then runs `runBatch` from the given Meerkat checkout with a fake gate that sleeps MS per run.
// Prints gate runs, wall time and the verdict counts, so two checkouts can be compared on the same fixture.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : dflt
}
const rootArg = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')))
if (!rootArg) {
  process.stderr.write('usage: node tools/bench-batch.mjs <meerkat-root> [--branches N] [--conflicts K] [--gate-ms MS]\n')
  process.exit(2)
}
const N = flag('--branches', 12)
const K = flag('--conflicts', 3)
const GATE_MS = flag('--gate-ms', 150)
const BAD = flag('--bad', 0) // the last BAD branches add a file that makes the gate fail
const meerkatRoot = resolve(rootArg)

const work = mkdtempSync(join(tmpdir(), 'meerkat-bench-'))
const repo = join(work, 'repo')
const git = (...a) => {
  const r = spawnSync('git', ['-C', repo, '-c', 'user.name=b', '-c', 'user.email=b@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (file, body) => {
  mkdirSync(join(repo, file, '..'), { recursive: true })
  writeFileSync(join(repo, file), body)
}
const commit = (msg) => {
  git('add', '-A')
  git('commit', '-q', '-m', msg)
}

mkdirSync(repo, { recursive: true })
git('init', '-q', '-b', 'main')
put('src/shared.js', 'export const shared = 1\n')
put('src/common.js', 'export const common = 1\n')
commit('base')
const branches = []
for (let i = 0; i < N; i++) {
  const b = `pr-${i}`
  branches.push(b)
  git('checkout', '-q', '-b', b, 'main')
  if (i < K) {
    put('src/shared.js', `export const shared = ${100 + i}\n`) // every conflicting branch edits the same line
  } else if (i >= N - BAD) {
    put('src/bad.js', 'export const bad = 1\n') // makes the gate fail on any checkout that includes this branch
  } else {
    put(`src/mod-${i}.js`, `export const m${i} = 1\n`)
  }
  commit(b)
  git('checkout', '-q', 'main')
}
put('src/shared.js', 'export const shared = 999\n') // trunk moves on that line: the K conflicting branches now conflict with it
commit('trunk moves')

const { runBatch } = await import(pathToFileURL(join(meerkatRoot, 'lib', 'batch.mjs')).href)

let gateRuns = 0
const gate = async (dir) => {
  gateRuns++
  await new Promise((r) => setTimeout(r, GATE_MS))
  const bad = fs.existsSync(join(dir, 'src', 'bad.js'))
  return bad ? { code: 1, verdict: 'FAIL', reason: 'FAIL', checks: [] } : { code: 0, verdict: 'PASS', reason: 'PASS', checks: [] }
}
const lines = []
const logDir = join(work, 'logs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logDir }
const t0 = Date.now()
const code = await runBatch(['--base', 'main', '--app', repo, ...branches.map((b) => b)], {
  env,
  cwd: repo,
  out: (t) => lines.push(t),
  err: () => {},
  gate,
  devBaseline: async () => false,
})
const wall = Date.now() - t0
const summary = {
  meerkatRoot,
  branches: N,
  conflictingBranches: K,
  badBranches: BAD,
  gateMsPerRun: GATE_MS,
  exitCode: code,
  gateRuns,
  wallMs: wall,
  gateTimeMs: gateRuns * GATE_MS,
  outputTail: lines.slice(-6),
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
