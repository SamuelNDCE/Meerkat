// End-to-end tests on realistic fake apps (tools/fake-apps): the REAL runner (node run.mjs --app <dir> --preset quick) on a clean and a
// defective variant of five apps. A clean variant must give no failure and no finding; every planted defect must be reported in
// findings.json with the right check, rule, file and at least the stated severity. Nothing in the project folder may change.
//
// Optional outside tools (eslint, tsc, typos, ...) may be missing on this PC. A check whose tool is missing is NOT RUN, which is not a
// failure and not a finding, so the clean test allows it; the exit code is then 1 (a run is only 0 when nothing was left unchecked).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { APPS, generate } from '../tools/fake-apps/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SEVERITY = ['info', 'low', 'medium', 'high', 'critical']
vi.setConfig({ testTimeout: 300_000 }) // each test runs the real runner, 10 to 60 s on a busy PC
const SANE_MS = 180_000 // one quick run of a tiny project: seconds when the PC is idle, well under this when it is busy
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

type Defect = { check: string; rule?: string; file: string; severity: string; match?: string }
type Run = { code: number | null; out: string; ms: number; runDir: string; runName: string; summary: any; findings: any; logRoot: string }

// A hash of every file under a folder except .git, with sizes and times: any write to the project changes it.
function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // .git is git's own; target/ is the build output the project's own cargo checks make (gitignored, not part of the project).
      if (e.name === '.git' || e.name === 'target') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else h.update(p.slice(dir.length)).update(readFileSync(p)).update(String(statSync(p).mtimeMs))
    }
  }
  walk(dir)
  return h.digest('hex')
}

function meerkat(dir: string, args: string[], root: string): Run {
  const logRoot = join(root, 'logs')
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, ...args, '--plain'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MEERKAT_LOG_DIR: logRoot, MEERKAT_TIMINGS: join(root, 'timings.json'), MEERKAT_PLAIN: '1', NO_COLOR: '1' },
  })
  const ms = Date.now() - t0
  const runs = join(logRoot, 'runs')
  const runName = existsSync(runs) ? readdirSync(runs).sort().pop() ?? '' : ''
  const runDir = join(runs, runName)
  const read = (f: string) => (existsSync(join(runDir, f)) ? JSON.parse(readFileSync(join(runDir, f), 'utf8')) : null)
  return { code: r.status, out: `${r.stdout}${r.stderr}`, ms, runDir, runName, summary: read('summary.json'), findings: read('findings.json'), logRoot }
}

const found = (findings: any, d: Defect) =>
  (findings?.findings ?? []).find(
    (f: any) => f.check === d.check && (d.rule === undefined || f.rule === d.rule) && f.file === d.file && SEVERITY.indexOf(f.severity) >= SEVERITY.indexOf(d.severity) && (d.match === undefined || `${f.title} ${f.message}`.includes(d.match)),
  )

function project(name: string, variant: 'clean' | 'defective'): { dir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-e2e-'))
  made.push(root)
  return { dir: generate(name, variant, join(root, 'p')), root }
}

describe('the fake apps are well formed', () => {
  test('every app has a clean and a defective variant and a defect list that names real files of the defective variant', () => {
    expect(Object.keys(APPS).sort()).toEqual(['clip-desk', 'express-api', 'ledger-core', 'notes-ui', 'tasks-app'])
    for (const [name, app] of Object.entries(APPS) as [string, any][]) {
      expect(app.defects.length, name).toBeGreaterThan(0)
      for (const d of app.defects as Defect[]) {
        expect(Object.keys(app.defective), `${name}: ${d.check}`).toContain(d.file)
        expect(SEVERITY, `${name}: ${d.check}`).toContain(d.severity)
      }
      const planted = Object.keys(app.defective).filter((f) => app.defective[f] !== app.clean[f])
      expect(planted.length, `${name} differs from its clean variant`).toBeGreaterThan(0)
    }
  })

  test('generation is deterministic and touches only the folder it is given', () => {
    const a = project('ledger-core', 'defective')
    const b = project('ledger-core', 'defective')
    const files = (d: string) => readdirSync(d, { recursive: true }).map(String).filter((f) => !f.startsWith('.git')).sort()
    expect(files(a.dir)).toEqual(files(b.dir))
    expect(readFileSync(join(a.dir, 'src', 'lib.rs'), 'utf8')).toBe(readFileSync(join(b.dir, 'src', 'lib.rs'), 'utf8'))
  })
})

describe.each(Object.keys(APPS))('%s, quick preset', (name) => {
  const app: any = (APPS as any)[name]

  test('the clean variant gives no failure and no finding', () => {
    const { dir, root } = project(name, 'clean')
    const before = hashTree(dir)
    const run = meerkat(dir, ['--preset', 'quick'], root)
    expect(run.summary, run.out.slice(-2000)).not.toBeNull()
    const failed = run.summary.results.filter((r: any) => r.status === 'FAIL').map((r: any) => `${r.id}: ${String(r.detail).slice(0, 200)}`)
    expect(failed).toEqual([])
    expect(run.summary.counts.fail).toBe(0)
    expect(run.findings.counts.total, JSON.stringify(run.findings.findings.map((f: any) => [f.check, f.rule, f.file]))).toBe(0)
    // 0 only when nothing was left unchecked; a missing optional outside tool is NOT RUN and makes the run 1, never a failure.
    expect(run.code).toBe(run.summary.counts.notRun === 0 ? 0 : 1)
    expect(run.summary.counts.pass).toBeGreaterThan(200)
    expect(run.ms).toBeLessThan(SANE_MS)
    expect(hashTree(dir)).toBe(before)
  })

  test('every planted defect is reported with the right check, file and severity', () => {
    const { dir, root } = project(name, 'defective')
    const before = hashTree(dir)
    const run = meerkat(dir, ['--preset', 'quick'], root)
    expect(run.findings, run.out.slice(-2000)).not.toBeNull()
    expect(run.code).toBe(1)
    expect(run.summary.counts.fail).toBeGreaterThan(0)
    const missed = (app.defects as Defect[]).filter((d) => !found(run.findings, d)).map((d) => `${d.check}${d.rule ? `/${d.rule}` : ''} in ${d.file}`)
    expect(missed, `not detected: ${missed.join('; ')}\nreported: ${JSON.stringify(run.findings.findings.map((f: any) => [f.severity, f.check, f.rule, f.file]))}`).toEqual([])
    expect(run.ms).toBeLessThan(SANE_MS)
    expect(hashTree(dir)).toBe(before)
  })

  test('the run folder is named with the project and the tier and holds the report files', () => {
    const { dir, root } = project(name, 'defective')
    const run = meerkat(dir, ['--preset', 'quick', '--only', app.defects[0].check, '--all'], root)
    expect(run.runName).toMatch(new RegExp(`^\\d{8}-\\d{6}-${app.name}-fast$`))
    for (const f of ['findings.json', 'findings.md', 'findings.sarif', 'summary.json', 'report.md', 'timeline.jsonl', 'detections.jsonl']) expect(existsSync(join(run.runDir, f)), f).toBe(true)
    expect(existsSync(join(run.logRoot, 'latest.json'))).toBe(true)
    expect(run.summary.project.name).toBe(app.name)
    expect(run.summary.files.findings).toContain('findings.json')
    expect(run.findings.schemaVersion).toBe(1)
    expect(run.findings.run.project.name).toBe(app.name)
    const sarif = JSON.parse(readFileSync(join(run.runDir, 'findings.sarif'), 'utf8'))
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0].results.length).toBe(run.findings.counts.total)
  })
})

// A gap the fake Flask app found: a secret assigned through a subscript (app.config["SECRET_KEY"] = "...") was not seen at all.
describe('secret-like name in a subscript', () => {
  test('config["SECRET_KEY"] = "<value>" is a finding; an environment lookup and a placeholder are not', async () => {
    const { findKeyword } = await import('../thorough/rules-secrets-plus.mjs')
    const secret = ['hunter2', 'super', 'secret', 'key', '9f8e7d6c'].join('-')
    expect(findKeyword(`app.config["SECRET_KEY"] = "${secret}"`)).not.toBeNull()
    expect(findKeyword(`app.config['API_TOKEN'] = '${secret}'`)).not.toBeNull()
    expect(findKeyword(`settings["password"]: "${secret}"`)).not.toBeNull()
    expect(findKeyword('app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]')).toBeNull()
    expect(findKeyword('app.config["SECRET_KEY"] = "changeme"')).toBeNull()
    expect(findKeyword('headers["X-Api-Key-Header"] = "x-api-key-header-name"')).toBeNull()
  })
})

describe('exit codes', () => {
  // Tool-free checks only, so the exit code does not depend on what is installed on this PC.
  const FREE = 'secret-scan,risky-code,sql-concat,cookie-flags'

  test('0: a clean project and checks that need no outside tool', () => {
    const { dir, root } = project('express-api', 'clean')
    const run = meerkat(dir, ['--preset', 'quick', '--only', FREE, '--all'], root)
    expect(run.out).toMatch(/4 passed, 0 failed, 0 not run/)
    expect(run.code).toBe(0)
    expect(run.findings.counts.total).toBe(0)
  })

  test('1: the same checks on the defective project', () => {
    const { dir, root } = project('express-api', 'defective')
    const run = meerkat(dir, ['--preset', 'quick', '--only', FREE, '--all'], root)
    expect(run.code).toBe(1)
    expect(run.summary.counts.fail).toBeGreaterThanOrEqual(3)
    expect(run.findings.counts.bySeverity.critical).toBeGreaterThanOrEqual(1)
  })

  test('75 from a check means NOT RUN: it is not a failure and not a finding, and the run is not a pass', () => {
    const { dir, root } = project('ledger-core', 'clean')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'needs-service.mjs'), 'console.error("the service is not running")\nprocess.exit(75)\n')
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ packs: ['security'], discover: false, customChecks: [{ id: 'needs-service', title: 'Needs a service', cmd: 'node', args: ['scripts/needs-service.mjs'], tier: 'fast', group: 'functionality' }] }))
    const run = meerkat(dir, ['--only', 'needs-service', '--all'], root)
    const r = run.summary.results.find((x: any) => x.id === 'needs-service')
    expect(r?.status, run.out.slice(-1500)).toBe('NOT RUN')
    expect(run.summary.counts).toMatchObject({ fail: 0, notRun: 1 })
    expect(run.findings.counts.total).toBe(0)
    expect(run.findings.notRun.map((x: any) => x.check)).toContain('needs-service')
    expect(run.code).toBe(1)
  })

  test('a folder that selects no checks is reported, not passed (exit 3)', () => {
    const { dir, root } = project('ledger-core', 'clean')
    const run = meerkat(dir, ['--only', 'no-such-check', '--all'], root)
    expect(run.code).not.toBe(0)
  })
})

describe('the preset run on a clean app also passes the full preset where it is cheap', () => {
  test('full preset, ledger-core clean: no failures, no findings, nothing written to the project', () => {
    const { dir, root } = project('ledger-core', 'clean')
    const before = hashTree(dir)
    const run = meerkat(dir, ['--preset', 'full'], root)
    expect(run.summary, run.out.slice(-1500)).not.toBeNull()
    const failed = run.summary.results.filter((r: any) => r.status === 'FAIL').map((r: any) => `${r.id}: ${String(r.detail).slice(0, 160)}`)
    expect(failed).toEqual([])
    expect(run.findings.counts.total).toBe(0)
    expect(run.runName).toMatch(/-ledger-core-thorough$/)
    expect(hashTree(dir)).toBe(before)
  }, 600_000)
})
