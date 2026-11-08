// Shared helpers for the red-test suite (lib/redtest/README.md): build a throwaway project, run the REAL Meerkat on it, read back what it saved.
// Nothing here touches the folder a test did not create. Every project lives under one temp folder that the caller removes.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseline, readme } from '../../tools/fake-apps/kit.mjs'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const SEVERITY = ['info', 'low', 'medium', 'high', 'critical']
const made = []

export function scratch(prefix = 'meerkat-redtest-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function cleanup() {
  for (const d of made.splice(0)) {
    // Windows can hold a folder for a moment after a child exits; a few tries, never an error.
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(d, { recursive: true, force: true })
        break
      } catch {
        /* retry */
      }
    }
  }
}

// Write a file tree (relative path -> text or Buffer) under dir.
export function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
}

export function git(dir, ...args) {
  const env = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }
  return execFileSync('git', ['-c', 'user.name=redtest', '-c', 'user.email=redtest@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.excludesFile=', '-C', dir, ...args], { stdio: 'pipe', env, encoding: 'utf8' })
}

export function commitAll(dir) {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'redtest fixture')
}

// A project folder with these files, committed. Returns its path.
export function makeProject(files, name = 'proj') {
  const dir = join(scratch(), name)
  mkdirSync(dir, { recursive: true })
  writeTree(dir, files)
  commitAll(dir)
  return dir
}

// `npx vitest` puts Meerkat's own node_modules/.bin on PATH; a run must see only what a user's machine has.
function cleanPath(env) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const marker = join('node_modules', '.bin')
  return { ...env, [key]: String(env[key] ?? '').split(delimiter).filter((p) => !p.includes(marker)).join(delimiter) }
}

// Run the real run.mjs on a folder. Returns { code, out, ms, timedOut, summary, findings, runDir, results } (summary and findings are null when the run saved none).
export function meerkat(dir, args = [], { env = {}, timeoutMs = 240_000, cwd = ROOT } = {}) {
  const logRoot = join(scratch('meerkat-redtest-logs-'), 'logs')
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, ...args, '--plain'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...cleanPath(process.env), MEERKAT_FINDINGS: 'all', MEERKAT_TRUST_PROJECT: '1', MEERKAT_LOG_DIR: logRoot, MEERKAT_TIMINGS: join(logRoot, '..', 'timings.json'), MEERKAT_PLAIN: '1', NO_COLOR: '1', ...env },
  })
  const runs = join(logRoot, 'runs')
  const runName = existsSync(runs) ? readdirSync(runs).sort().pop() ?? '' : ''
  const runDir = join(runs, runName)
  const read = (f) => {
    try {
      return existsSync(join(runDir, f)) ? JSON.parse(readFileSync(join(runDir, f), 'utf8')) : null
    } catch {
      return null
    }
  }
  const summary = runName ? read('summary.json') : null
  return { code: r.status, signal: r.signal, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t0, timedOut: Boolean(r.error && /ETIMEDOUT/.test(String(r.error.code))), summary, findings: runName ? read('findings.json') : null, runDir, results: summary?.results ?? [] }
}

export const statusOf = (run, id) => run.results.find((r) => r.id === id)?.status

// Is this defect { check, rule?, file, severity, match? } in the findings? A finding two checks reported counts for every reporter.
export function foundDefect(findings, d) {
  return (findings?.findings ?? []).find(
    (f) =>
      [{ check: f.check, rule: f.rule }, ...(f.alsoReportedBy ?? [])].some((r) => r.check === d.check && (d.rule === undefined || r.rule === d.rule || r.rule === null)) &&
      f.file === d.file &&
      SEVERITY.indexOf(f.severity) >= SEVERITY.indexOf(d.severity) &&
      (d.match === undefined || `${f.title} ${f.message}`.includes(d.match)),
  )
}

// Only the bug-grade findings (critical, high, medium); low and info are notes (the accuracy corpus counts them the same way).
export const bugFindings = (findings) => (findings?.findings ?? []).filter((f) => ['critical', 'high', 'medium'].includes(f.severity))

// A tiny, well-kept Node project (licence, security policy, CI, dependabot, README from the fake-app kit): the base for fault, adversarial, regression and clean-twin runs. Clean on purpose.
export function tinyNodeFiles(extra = {}) {
  return {
    'package.json': JSON.stringify({ name: 'tiny-app', version: '1.0.0', private: true, license: 'MIT', type: 'module', engines: { node: '>=20' }, scripts: { test: 'node --test' } }, null, 2) + '\n',
    'package-lock.json': JSON.stringify({ name: 'tiny-app', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'tiny-app', version: '1.0.0', license: 'MIT', engines: { node: '>=20' } } } }, null, 2) + '\n',
    ...baseline({ test: 'npm test', ignore: 'node_modules/\n' }),
    'README.md': readme('tiny-app', 'A tiny, well-kept app used as the base of the red tests.', 'npm ci', 'node src/index.js', 'npm test'),
    'src/index.js': "export function add(a, b) {\n  return a + b\n}\n",
    ...extra,
  }
}
