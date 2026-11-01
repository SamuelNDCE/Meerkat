// Tier rules, first-run estimate scaling, per-project timings and time limits (docs/tiers.md).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS modules
import { loadChecks, validateCheck } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS modules
import { applyLearned, loadTimings, projectKey, recordRun, saveTimings } from '../lib/timings.mjs'
// @ts-expect-error plain JS modules
import { scaleFactor, scaledSeconds } from '../lib/eta.mjs'
// @ts-expect-error plain JS modules
import { effectiveTimeoutSeconds, isCompileCheck, loadBudgets, loadFactorFrom, timeoutText } from '../lib/timeouts.mjs'
// @ts-expect-error plain JS modules
import { runCommand } from '../lib/exec.mjs'
// @ts-expect-error plain JS modules
import { isAlone } from '../lib/runner.mjs'

const dir = mkdtempSync(join(tmpdir(), 'mk-tiers-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const packsDir = join(__dirname, '..', 'packs')
const all: any[] = []
for (const p of readdirSync(packsDir)) all.push(...(await loadChecks(join(packsDir, p))))

// Compile, test and build checks that stay in the quick tier on purpose: the quick preset is "before every push", which
// includes the build, the type check and the tests. Anything new that compiles must be added here WITH a reason, or go to thorough.
const COMPILE_IN_FAST: Record<string, string> = {
  'rust-clippy': 'the quick run type-checks the code; clippy is the Rust build check (estimate 180 s, heavy, cargo lane)',
  'rust-test': 'the quick run runs the tests (estimate 300 s, heavy, cargo lane)',
  tsc: 'type check is part of quick (estimate 60 s)',
  'go-vet': 'part of the Go quick set',
  'go-test': 'the quick run runs the tests',
  'maven-compile': 'the quick run builds the project',
  'maven-test': 'the quick run runs the tests',
  'dotnet-build': 'the quick run builds the project',
  'swift-build': 'the quick run builds the project',
  pytest: 'the quick run runs the tests',
  rspec: 'the quick run runs the tests',
}
// Checks that are cheap or free-lane but stay thorough on purpose.
const THOROUGH_ON_PURPOSE: Record<string, string> = {
  'npm-audit-all': 'asks the network; measured max 6.6 s, over the 6 s rule',
  'circular-imports': 'runs madge (an outside tool), not measured here',
  'dead-python': 'runs vulture (an outside tool), not measured here',
  'perf-endpoints': 'starts the app and calls it',
  'perf-load': 'starts the app and loads it',
  'perf-build': 'runs the build and times it',
  'rust-build-release': 'compiles in release mode',
  'rust-doc': 'compiles the docs',
}

describe('tier rules (data check)', () => {
  test('a compile, test or build check in the quick tier is on the allowlist with a reason', () => {
    const bad = all.filter((c) => c.tier === 'fast' && isCompileCheck(c) && !COMPILE_IN_FAST[c.id]).map((c) => c.id)
    expect(bad).toEqual([])
    for (const reason of Object.values(COMPILE_IN_FAST)) expect(reason.length).toBeGreaterThan(5)
  })
  test('a compile check is weighted heavy, or alone', () => {
    const bad = all.filter((c) => isCompileCheck(c) && c.tier !== undefined && !['heavy', 'medium'].includes(c.weight ?? (c.lane === 'cargo' ? 'heavy' : 'light')) && !isAlone(c)).map((c) => `${c.id}:${c.weight}`)
    expect(bad.filter((x) => !/^(go-vet|tsc):/.test(x))).toEqual([])
  })
  test('a thorough check that is free-lane, not opt-in and not heavy is on the allowlist with a reason', () => {
    const bad = all.filter((c) => c.tier === 'thorough' && !c.optIn && c.lane === 'free' && !isAlone(c) && !['heavy'].includes(c.weight) && !THOROUGH_ON_PURPOSE[c.id]).map((c) => c.id)
    expect(bad).toEqual([])
  })
  test('git-history-secrets (measured median 0.36 s, max 2 s, 0.7 s on a large repository) is quick', () => {
    expect(all.find((c) => c.id === 'git-history-secrets').tier).toBe('fast')
  })
  test('the realistic first-run estimates', () => {
    const est = (id: string) => all.find((c) => c.id === id).estSeconds
    expect(est('rust-fmt')).toBe(10)
    expect(est('rust-clippy')).toBe(180)
    expect(est('rust-test')).toBe(300)
    expect(est('rust-doc')).toBe(120)
    expect(est('rust-build-release')).toBe(400)
    expect(est('rust-audit')).toBe(15)
    expect(est('rust-deny')).toBe(20)
    expect(est('local-links')).toBe(60)
    expect(est('go-test')).toBe(90)
    expect(est('pytest')).toBe(60)
    expect(est('maven-test')).toBe(120)
  })
  test('every check passes validation, and scale is files or crates', () => {
    expect(all.map(validateCheck).filter(Boolean)).toEqual([])
    expect(validateCheck({ ...all[0], scale: 'bananas' })).toMatch(/scale must be files or crates/)
  })
})

describe('estimates that grow with the project', () => {
  test('buckets', () => {
    expect(scaleFactor('files', 10)).toBe(0.4)
    expect(scaleFactor('files', 200)).toBe(1)
    expect(scaleFactor('files', 1000)).toBe(2)
    expect(scaleFactor('files', 9000)).toBe(4)
    expect(scaleFactor('crates', 1)).toBe(0.5)
    expect(scaleFactor('crates', 4)).toBe(1)
    expect(scaleFactor('crates', 12)).toBe(1.5)
    expect(scaleFactor('crates', 40)).toBe(2.5)
    expect(scaleFactor('nothing', 40)).toBe(1)
  })
  test('scaledSeconds scales a first-run estimate and leaves an unscaled or unknown one alone', () => {
    expect(scaledSeconds({ estSeconds: 180, scale: 'crates' }, { crates: 40 })).toBe(450)
    expect(scaledSeconds({ estSeconds: 180, scale: 'crates' }, {})).toBe(180)
    expect(scaledSeconds({ estSeconds: 180 }, { crates: 40 })).toBe(180)
  })
  test('the project own measured time wins over the scaled guess, and scaling does not compound', () => {
    const repo = mkdtempSync(join(dir, 'ws-'))
    writeFileSync(join(repo, 'Cargo.toml'), '[workspace]\nmembers = ["a", "b", "c", "d", "e", "f", "g"]\n')
    const timings: any = Object.defineProperty({ checks: {} }, 'project', { value: repo, enumerable: false })
    const checks: any[] = [{ id: 'x-clippy', estSeconds: 180, scale: 'crates' }, { id: 'x-test', estSeconds: 300, scale: 'crates' }]
    applyLearned(checks, timings, 'fast')
    expect(checks[0].estSeconds).toBe(270) // 7 members: factor 1.5
    applyLearned(checks, timings, 'fast')
    expect(checks[0].estSeconds).toBe(270)
    const learned = { checks: recordRun({ checks: {} }, [{ id: 'x-clippy', status: 'PASS', ms: 42_000 }], 'fast').checks }
    Object.defineProperty(learned, 'project', { value: repo, enumerable: false })
    applyLearned(checks, learned, 'fast')
    expect(checks[0].estSeconds).toBe(42)
    expect(checks[1].estSeconds).toBe(450)
  })
})

describe('timings are kept per project', () => {
  test('a time from one project is never used for another', () => {
    const file = join(dir, 'timings.json')
    const a = join(dir, 'proj-a')
    const b = join(dir, 'proj-b')
    saveTimings(file, { ...recordRun({ checks: {} }, [{ id: 'rust-clippy', status: 'PASS', ms: 600_000 }], 'fast'), project: a })
    saveTimings(file, { ...recordRun({ checks: {} }, [{ id: 'rust-clippy', status: 'PASS', ms: 3_000 }], 'fast'), project: b })
    expect(loadTimings(file, a).checks['rust-clippy'].fast).toEqual([600_000])
    expect(loadTimings(file, b).checks['rust-clippy'].fast).toEqual([3_000])
    expect(loadTimings(file, join(dir, 'proj-c')).checks).toEqual({})
    const checks: any[] = [{ id: 'rust-clippy', estSeconds: 180 }]
    applyLearned(checks, loadTimings(file, join(dir, 'proj-c')), 'fast')
    expect(checks[0].estSeconds).toBe(180)
    applyLearned(checks, loadTimings(file, a), 'fast')
    expect(checks[0].estSeconds).toBe(600)
  })
  test('an older flat file is read as the project it names, and kept when another project saves', () => {
    const file = join(dir, 'old.json')
    const a = join(dir, 'old-a')
    writeFileSync(file, JSON.stringify({ checks: { e: { fast: [5000] } }, project: a }))
    expect(loadTimings(file, a).checks.e.fast).toEqual([5000])
    expect(loadTimings(file, join(dir, 'old-b')).checks).toEqual({})
    saveTimings(file, { ...recordRun({ checks: {} }, [{ id: 'e', status: 'PASS', ms: 1000 }], 'fast'), project: join(dir, 'old-b') })
    expect(loadTimings(file, a).checks.e.fast).toEqual([5000])
  })
  test('project keys ignore the slash style and a trailing slash', () => {
    expect(projectKey(join(dir, 'k') + '/')).toBe(projectKey(join(dir, 'k')))
  })
})

describe('time limits', () => {
  const normal = { id: 'n', estSeconds: 10, run: { cmd: 'node', args: [] } }
  const compile = { id: 'c', estSeconds: 180, scale: 'crates', run: { cmd: 'cargo', args: ['clippy'] } }
  test('a tiny check gets max(est x 4, 60), a normal one max(est x 5, 120), a compile check max(est x 8, 300)', () => {
    expect(effectiveTimeoutSeconds({ ...normal, estSeconds: 3 })).toBe(60)
    expect(effectiveTimeoutSeconds(normal)).toBe(120) // never under 120 s for a non-trivial check
    expect(effectiveTimeoutSeconds({ ...normal, estSeconds: 30 })).toBe(150) // 5 x the estimate
    expect(effectiveTimeoutSeconds({ ...normal, estSeconds: 30 })).toBeGreaterThanOrEqual(3 * 30)
    expect(effectiveTimeoutSeconds({ ...compile, scale: undefined })).toBe(1440)
    expect(effectiveTimeoutSeconds({ ...compile, scale: undefined, estSeconds: 10 })).toBe(300)
    expect(effectiveTimeoutSeconds({ id: 'found-x', lane: 'windows', estSeconds: 100, run: { cmd: 'node', args: [] } })).toBe(420)
    expect(isCompileCheck(compile)).toBe(true)
    expect(isCompileCheck(normal)).toBe(false)
  })
  test('a busy machine grants up to twice the time; a quiet one changes nothing', () => {
    expect(loadFactorFrom({ load1: 0, cpuCount: 8, busy: 0.2, freeRatio: 0.6 })).toBe(1)
    expect(loadFactorFrom({ load1: 8, cpuCount: 8 })).toBe(2)
    expect(loadFactorFrom({ load1: 6, cpuCount: 8 })).toBe(1.5)
    expect(loadFactorFrom({ busy: 1 })).toBe(2) // Windows has no load average: the busy share is used
    expect(loadFactorFrom({ freeRatio: 0.04 })).toBe(2) // memory nearly gone
    expect(loadFactorFrom({ load1: 80, cpuCount: 8 })).toBe(2) // capped
    expect(effectiveTimeoutSeconds(normal, { load: 2 })).toBe(240)
    expect(effectiveTimeoutSeconds(normal, { load: () => 1.5 })).toBe(180)
    expect(effectiveTimeoutSeconds(normal, { load: 9 })).toBe(240) // the factor itself is capped
    expect(effectiveTimeoutSeconds({ ...normal, timeoutSeconds: 7 }, { load: 2 })).toBe(14)
    expect(effectiveTimeoutSeconds(normal, { load: 2, budgets: { timeouts: { n: 900 } } })).toBe(900) // an exact limit stays exact
  })
  test('it grows with the project size, and an explicit larger pack timeout is kept', () => {
    expect(effectiveTimeoutSeconds(compile, { facts: { crates: 40 } })).toBe(1440 * 2.5)
    expect(effectiveTimeoutSeconds(compile, { facts: { crates: 1 } })).toBe(1440) // never shrinks below 1
    expect(effectiveTimeoutSeconds({ ...normal, timeoutSeconds: 900 })).toBe(900)
    expect(effectiveTimeoutSeconds({ ...normal, timeoutSeconds: 1 })).toBe(1) // a short limit written on purpose is kept
  })
  test('--timeout-scale and the budgets file change it, and the scale is capped at 10', () => {
    expect(effectiveTimeoutSeconds(normal, { scale: 2 })).toBe(240)
    expect(effectiveTimeoutSeconds(normal, { scale: 50 })).toBe(1200)
    expect(effectiveTimeoutSeconds(normal, { budgets: { timeoutScale: 3 } })).toBe(360)
    expect(effectiveTimeoutSeconds(normal, { scale: 2, budgets: { timeouts: { n: 1800 } } })).toBe(1800)
    const d = mkdtempSync(join(dir, 'b-'))
    writeFileSync(join(d, '.meerkat-budgets.json'), JSON.stringify({ timeoutScale: 2, timeouts: { n: 900, bad: -1 } }))
    expect(loadBudgets(d)).toEqual({ timeouts: { n: 900 }, idleKill: {}, maxRunMinutes: 90, timeoutScale: 2 })
    expect(loadBudgets(join(dir, 'missing'))).toEqual({ timeouts: {}, idleKill: {}, maxRunMinutes: 90, timeoutScale: 1 })
  })
  test('the timeout text says what happened and how to raise it', () => {
    expect(timeoutText(61.2, 60)).toBe('timed out after 61 s (limit is 60 s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)')
  })
  const talker = (ms: number) => ['-e', `let i=0;const t=setInterval(()=>{console.log('line '+(i++))},100);setTimeout(()=>{clearInterval(t);process.exit(0)},${ms})`]
  test('a check killed by its limit says so, never a silent fail', async () => {
    const r = await runCommand({ cmd: process.execPath, args: ['-e', 'setTimeout(()=>{},20000)'], timeoutMs: 700 })
    expect(r.timedOut).toBe(true)
    expect(r.output).toMatch(/timed out after \d+ s \(limit is \d+ s; raise it with --timeout-scale 2/)
  }, 15000)
  test('a compile or test check that is still printing is not killed at the limit', async () => {
    const r = await runCommand({ cmd: process.execPath, args: talker(2200), timeoutMs: 1500, extendWhileActive: true, idleMs: 1000 })
    expect(r.timedOut).toBe(false)
    expect(r.code).toBe(0)
  }, 15000)
  test('without the extension the same check is stopped at the limit', async () => {
    const r = await runCommand({ cmd: process.execPath, args: talker(2200), timeoutMs: 1000 })
    expect(r.timedOut).toBe(true)
  }, 15000)
  test('the extension has a hard cap of twice the limit', async () => {
    const r = await runCommand({ cmd: process.execPath, args: talker(30000), timeoutMs: 1000, extendWhileActive: true, idleMs: 600 })
    expect(r.timedOut).toBe(true)
    expect(r.ms).toBeLessThan(4500)
  }, 15000)
})

describe('the run timeline records time properly', () => {
  test('a real run: end minus start equals ms, starts follow the run start, waits are separate, totals add up', async () => {
    const { spawnSync } = await import('node:child_process')
    const { readFileSync, readdirSync, mkdirSync } = await import('node:fs')
    const app = mkdtempSync(join(dir, 'app-'))
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'tl-app', version: '1.0.0' }))
    writeFileSync(join(app, 'a.json'), '{"a":1}\n')
    const logs = join(dir, 'tl-logs')
    mkdirSync(logs)
    const r = spawnSync(process.execPath, [join(__dirname, '..', 'run.mjs'), '--app', app, '--preset', 'quick', '--only', 'json-valid,whitespace,large-files,final-newline', '--plain'], { env: { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_TIMINGS: join(dir, 'tl-timings.json'), NO_COLOR: '1' }, encoding: 'utf8', timeout: 90_000 })
    expect(r.error).toBeUndefined()
    const runs = readdirSync(join(logs, 'runs'))
    expect(runs.length).toBe(1)
    const base = join(logs, 'runs', runs[0])
    const s = JSON.parse(readFileSync(join(base, 'summary.json'), 'utf8'))
    const ev = readFileSync(join(base, 'timeline.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const starts = new Map(ev.filter((e: any) => e.event === 'start').map((e: any) => [e.id, e]))
    const ends = ev.filter((e: any) => e.event === 'end')
    expect(ends.length).toBe(starts.size)
    expect(starts.size).toBeGreaterThanOrEqual(3)
    const t0 = Date.parse(s.startedAt)
    for (const e of ends as any[]) {
      const a: any = starts.get(e.id)
      expect(Math.abs(e.t - a.t - e.ms)).toBeLessThanOrEqual(150) // end minus start is the time the check reports
      expect(Date.parse(a.at)).toBeGreaterThanOrEqual(t0 - 5) // nothing starts before the run does
      expect(e.t).toBeGreaterThanOrEqual(a.t)
    }
    for (const w of Object.values(s.waited ?? {}) as any[]) expect(w.waitedMs).toBeGreaterThanOrEqual(0) // queue wait is its own field
    const real = s.results.filter((x: any) => x.status === 'PASS' && !/not applicable/.test(x.detail ?? ''))
    for (const x of real) expect(x.ms).toBeGreaterThan(0) // no 0.0 for real work
    const last = Math.max(...(ends as any[]).map((e) => e.t))
    expect(s.ms).toBeGreaterThanOrEqual(last - 5) // the run lasts at least until its last check ends
    expect(s.ms).toBeLessThanOrEqual(Math.max(...s.results.map((x: any) => x.ms ?? 0)) * s.results.length + 5000) // and no longer than all checks one after another
  }, 120_000)
})
