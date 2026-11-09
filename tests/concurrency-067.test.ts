// Several Meerkat processes at once must not corrupt the shared state in the Meerkat data folder.
// Every test starts real CLI processes in scratch folders and asserts the FINAL state, never timing.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
const TRUST_WORKER = join(ROOT, 'tests', 'helpers', 'save-trust-worker.mjs')
const made: string[] = []
const scratch = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), `meerkat-conc-${p}-`))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

type Res = { code: number | null; out: string; err: string }
function run(file: string, args: string[], cwd: string, env: Record<string, string>): Promise<Res> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file, ...args], { cwd, env: { ...process.env, CI: '1', NO_COLOR: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (c) => (out += c))
    p.stderr.on('data', (c) => (err += c))
    p.on('close', (code) => resolve({ code, out, err }))
  })
}
const meerkat = (args: string[], cwd: string, logDir: string) => run(BIN, args, cwd, { MEERKAT_LOG_DIR: logDir })

function repo(name: string, files = 1): string {
  const d = scratch(name)
  const git = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'a')
  for (let i = 0; i < files; i++) writeFileSync(join(d, `f${i}.js`), `console.log(${i})\n`)
  git('add', '.')
  return d
}
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
// A stack trace or a thrown error on stderr. (Gate progress and "warning:" lines are fine.)
const noStack = (r: Res) => expect(r.err).not.toMatch(/^\s+at .*\(|Error: |node:internal|Unhandled/m)

// A run folder is complete when summary.json parses and says it finished.
function checkRunFolders(logDir: string, expected: number) {
  const runs = join(logDir, 'runs')
  const names = readdirSync(runs)
  expect(names.length).toBe(expected)
  for (const n of names) {
    const s = json(join(runs, n, 'summary.json'))
    expect(s.status).toBe('complete')
    expect(s.results.length).toBeGreaterThan(0)
  }
}
function noTempFiles(logDir: string) {
  const left: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (/\.tmp|\.corrupt-/.test(e.name)) left.push(join(d, e.name))
    }
  }
  walk(logDir)
  expect(left).toEqual([])
}

describe('several gates at once', () => {
  test('8 processes, 4 repos (2 each): every run complete, pointers valid, every project remembered', async () => {
    const logDir = scratch('logs')
    const repos = ['a', 'b', 'c', 'd'].map((n) => repo(n))
    const results = await Promise.all([...repos, ...repos].map((r) => meerkat(['gate', '--staged'], r, logDir)))
    for (const r of results) {
      expect(r.out).toMatch(/MEERKAT gate:/)
      expect([0, 1]).toContain(r.code)
      noStack(r)
    }
    checkRunFolders(logDir, 8)
    expect(json(join(logDir, 'latest.json')).dir).toBeTruthy()
    const byProject = json(join(logDir, 'latest-by-project.json'))
    expect(Object.keys(byProject).length).toBe(4)
    for (const v of Object.values<any>(byProject)) expect(existsSync(join(v.dir, 'summary.json'))).toBe(true)
    const byPreset = json(join(logDir, 'latest-by-preset.json'))
    expect(Object.keys(byPreset).length).toBeGreaterThan(0)
    noTempFiles(logDir)
  }, 240_000)

  test('2 processes on the SAME repo: two separate complete run folders, nothing half written', async () => {
    const logDir = scratch('logs')
    const r = repo('same')
    const results = await Promise.all([meerkat(['gate', '--staged'], r, logDir), meerkat(['gate', '--staged'], r, logDir)])
    for (const x of results) {
      expect(x.out).toMatch(/MEERKAT gate:/)
      noStack(x)
    }
    checkRunFolders(logDir, 2)
    expect(Object.keys(json(join(logDir, 'latest-by-project.json'))).length).toBe(1)
    json(join(logDir, 'latest-by-preset.json'))
    noTempFiles(logDir)
    // the shared per-project files (findings history, gate cache) must still parse
    for (const sub of ['findings', 'cache']) {
      const d = join(logDir, sub)
      if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.json')) json(join(d, f))
    }
  }, 240_000)
})

describe('dismiss and undismiss at once', () => {
  test('parallel dismiss of different findings keeps all of them; a dismiss/undismiss race leaves a parseable file', async () => {
    const logDir = scratch('logs')
    const r = repo('dismiss', 3)
    await meerkat(['gate', '--staged'], r, logDir)
    const runs = readdirSync(join(logDir, 'runs'))
    const ids: string[] = json(join(logDir, 'runs', runs[0], 'findings.json')).findings.map((f: any) => f.id)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const [a, b, c] = ids
    const dismiss = (id: string, why: string) => meerkat(['dismiss', id, '--reason', why], r, logDir)
    // a is dismissed by two processes at once, b once, and an undismiss of c runs alongside.
    await dismiss(c, 'seed')
    const res = await Promise.all([dismiss(a, 'one'), dismiss(a, 'two'), dismiss(b, 'three'), meerkat(['undismiss', c], r, logDir)])
    for (const x of res) noStack(x)
    const dir = join(logDir, 'dismissals')
    const files = readdirSync(dir)
    expect(files.length).toBe(1)
    const doc = json(join(dir, files[0]))
    const got = doc.items.map((i: any) => i.id).sort()
    expect(got).toContain(a)
    expect(got).toContain(b)
    expect(got).not.toContain(c)
    expect(got.filter((i: string) => i === a).length).toBe(1)
    noTempFiles(logDir)
  }, 240_000)
})

describe('trust writes at once', () => {
  test('6 processes saving 25 records each: trust.json parses and holds all 150, with the hash each wrote', async () => {
    const logDir = scratch('logs')
    mkdirSync(logDir, { recursive: true })
    const env = { MEERKAT_LOG_DIR: logDir }
    const prefixes = ['/p0', '/p1', '/p2', '/p3', '/p4', '/p5']
    const res = await Promise.all(prefixes.map((p) => run(TRUST_WORKER, [p, '25'], ROOT, env)))
    for (const x of res) {
      expect(x.code).toBe(0)
      noStack(x)
    }
    const doc = json(join(logDir, 'trust.json'))
    expect(Object.keys(doc.projects).length).toBe(150)
    for (const p of prefixes) for (let i = 0; i < 25; i++) expect(doc.projects[p + '/' + i].hash).toBe('hash-' + p + '-' + i)
    noTempFiles(logDir)
  }, 120_000)
})
