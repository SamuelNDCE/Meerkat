// The Meerkat orchestrator (the validation tool) (issue #3114): selection, lanes, statuses, the hard timeout and the loader.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { lastLine } from './lib/exec.mjs'
import { globToRegExp, matchesAny } from './lib/glob.mjs'
import { loadChecks, validateCheck } from './lib/load-checks.mjs'
import { bashFor, wrapForLane } from './lib/lanes.mjs'
import { costOf, orderForSpeed, runAll, runOne, selectChecks, summarise } from './lib/runner.mjs'
import { applyConfig, findConfig, readConfig } from './lib/config.mjs'
import { missingBinaries } from './lib/which.mjs'
import { parseArgs } from './run.mjs'
import { parseCells, planJobs } from './click-shards.mjs'
import { assess, report } from './promotion-due.mjs'
import { resolveWidth } from './click-shards.mjs'
import { applyProfile } from './lib/profiles.mjs'
import { computeProgress, createProgress, etaMs, formatDuration, renderBar } from './lib/progress.mjs'
import { createStatus, fanOut } from './lib/status.mjs'
import { applyLearned, learnedSeconds, loadTimings, median, recordRun, saveTimings } from './lib/timings.mjs'
import coreChecks from './checks/core.mjs'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nv-verify-test-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ctx = () => ({ repoRoot: dir, appDir: dir, env: process.env, platform: process.platform, exists: () => true, changedFiles: [] })
const fake = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  title: 'x',
  estSeconds: 1,
  run: () => ({ ok: true, detail: '' }),
  ...over,
})
const node = (code: string, over: Record<string, unknown> = {}) => fake({ run: { cmd: 'node', args: ['-e', code], cwd: 'app' }, ...over })
const ids = (list: any[]) => list.map((c) => c.id)

describe('glob and selection', () => {
  test('** crosses folders, * does not', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true)
    expect(globToRegExp('apps/*.json').test('apps/x/y.json')).toBe(false)
    expect(matchesAny(['packages/**'], ['packages/core/src/lib.rs'])).toBe(true)
    expect(matchesAny(['Cargo.toml'], ['docs/a.md'])).toBe(false)
  })
  test('fast tier drops thorough checks, opt-in checks need --include', () => {
    const checks = [fake({ id: 'a' }), fake({ id: 'b', tier: 'thorough' }), fake({ id: 'c', optIn: 'staging' })]
    expect(ids(selectChecks(checks, { tier: 'fast', mode: 'all' }).run)).toEqual(['a'])
    expect(ids(selectChecks(checks, { tier: 'thorough', mode: 'all' }).run)).toEqual(['a', 'b'])
    expect(selectChecks(checks, { tier: 'thorough', mode: 'all', include: ['staging'] }).run).toHaveLength(3)
  })
  test('--changed skips checks whose paths did not change, keeps path-less ones', () => {
    const checks = [fake({ id: 'a', paths: ['src/**'] }), fake({ id: 'b', paths: ['docs/**'] }), fake({ id: 'c' })]
    const sel = selectChecks(checks, { tier: 'fast', mode: 'changed', changedFiles: ['src/x.ts'] })
    expect(ids(sel.run)).toEqual(['a', 'c'])
    expect(ids(sel.skipped)).toEqual(['b'])
  })
  test('--only picks by id regardless of tier', () => {
    const checks = [fake({ id: 'a' }), fake({ id: 'b', tier: 'thorough' })]
    expect(ids(selectChecks(checks, { tier: 'fast', only: ['b'], mode: 'all' }).run)).toEqual(['b'])
  })
})

describe('statuses, order and fail-fast', () => {
  test('missing tool is NOT RUN, never a pass', async () => {
    const r = await runOne(fake({ needs: ['no-such-binary-xyz'] }), ctx())
    expect(r.status).toBe('NOT RUN')
    expect(missingBinaries(['node'])).toEqual([])
  })
  test('stops at the first failure unless --keep-going', async () => {
    const mk = () => [fake({ id: 'bad', estSeconds: 1, run: () => ({ ok: false, detail: 'boom' }) }), fake({ id: 'later', estSeconds: 2 })]
    const stop = await runAll(mk(), ctx(), { parallel: 1 })
    expect(stop.map((r: any) => r.status)).toEqual(['FAIL', 'NOT RUN'])
    const keep = await runAll(mk(), ctx(), { parallel: 1, keepGoing: true })
    expect(keep.map((r: any) => r.status)).toEqual(['FAIL', 'PASS'])
  })
  test('a check that needs a failed dependency is NOT RUN', async () => {
    const res = await runAll(
      [fake({ id: 'build', run: () => ({ ok: false, detail: 'no' }) }), fake({ id: 'win', after: ['build'], estSeconds: 5 })],
      ctx(),
      { keepGoing: true },
    )
    expect(res[1].status).toBe('NOT RUN')
    expect(res[1].detail).toContain('build')
  })
  test('bash is found the way the lanes find it on Windows, not only on PATH; elsewhere it is still required', async () => {
    const check = fake({ needs: ['bash'] })
    const onWindows = await runOne(check, { ...ctx(), env: { PATH: '', NV_BASH: 'C:/Git/bin/bash.exe' }, platform: 'win32' })
    expect(onWindows.status).toBe('PASS')
    const elsewhere = await runOne(check, { ...ctx(), env: { PATH: '' }, platform: 'linux' })
    expect(elsewhere.status).toBe('NOT RUN')
    expect(elsewhere.detail).toContain('bash')
  })
  test('the one-line failure detail is the cause, not the routine log lines after it', () => {
    const output = ['  PASS  something', 'VERIFICATION ERRORED: Error: Cannot find module', '2026-10-31T00:19:31Z INFO  [sidecar] state stopped', '2026-10-31T00:19:31Z INFO  [sidecar] ignored the exit'].join(String.fromCharCode(10))
    expect(lastLine(output)).toContain('VERIFICATION ERRORED')
    expect(lastLine('plain output' + String.fromCharCode(10) + 'last line')).toBe('last line')
  })
  test('summary line and exit code: failed or not run both fail the run', () => {
    const ok = summarise('fast', [{ status: 'PASS' }], 2, 1500)
    expect(ok.line).toBe('MEERKAT fast: 1 passed, 0 failed, 0 not run, 2 skipped in 1.5s')
    expect(ok.exitCode).toBe(0)
    expect(summarise('fast', [{ status: 'NOT RUN' }], 0, 0).exitCode).toBe(1)
    expect(summarise('fast', [{ status: 'FAIL' }], 0, 0).exitCode).toBe(1)
  })
  test('cargo lane runs one at a time', async () => {
    let live = 0
    let peak = 0
    const slow = (id: string) =>
      fake({
        id,
        lane: 'cargo',
        run: async () => {
          live++
          peak = Math.max(peak, live)
          await new Promise((r) => setTimeout(r, 40))
          live--
          return { ok: true, detail: '' }
        },
      })
    await runAll([slow('a'), slow('b'), slow('c')], ctx(), { parallel: 4 })
    expect(peak).toBe(1)
  })
})

describe('hard timeout', () => {
  test('a function check that never settles is FAIL after its timeout', async () => {
    const hang = fake({ id: 'hang', timeoutSeconds: 0.2, run: () => new Promise(() => {}) })
    const r = await runOne(hang, ctx())
    expect(r.status).toBe('FAIL')
    expect(r.detail).toContain('timed out')
  })
  test('a command that hangs is killed and reported as FAIL', async () => {
    const t0 = Date.now()
    const r = await runOne(node('setInterval(() => {}, 1000)', { timeoutSeconds: 1 }), ctx())
    expect(r.status).toBe('FAIL')
    expect(r.detail).toContain('timed out')
    expect(Date.now() - t0).toBeLessThan(15_000)
  }, 20_000)
  test('exit 75 is NOT RUN and shows the reason from the last line', async () => {
    const r = await runOne(node('console.log("NOT RUN: k6 target env var is not set"); process.exit(75)'), ctx())
    expect(r).toEqual({ status: 'NOT RUN', detail: 'k6 target env var is not set' })
  })
  test('exit code decides pass or fail, and the last line is the detail', async () => {
    expect((await runOne(node('process.exit(0)'), ctx())).status).toBe('PASS')
    const failed = await runOne(node('console.log("what is wrong"); process.exit(3)'), { ...ctx(), env: { ...process.env, NV_VERIFY_LOG_DIR: dir } })
    expect(failed.detail).toMatch(/^what is wrong {2}\[full output: .*\.log\]$/)
    const file = /full output: (.*)\]/.exec(failed.detail)![1]
    expect(readFileSync(file, 'utf8')).toContain('what is wrong')
  })
})

describe('self-test', () => {
  test('a check that fails its broken case is trusted, one that passes it is not', async () => {
    const good = node('process.exit(0)', { selfTest: { cmd: 'node', args: ['-e', 'process.exit(1)'], cwd: 'app', expectFail: true } })
    const weak = node('process.exit(0)', { selfTest: { cmd: 'node', args: ['-e', 'process.exit(0)'], cwd: 'app', expectFail: true } })
    expect((await runOne(good, ctx(), { selfTest: true })).status).toBe('PASS')
    expect((await runOne(weak, ctx(), { selfTest: true })).status).toBe('FAIL')
    expect((await runOne(fake(), ctx(), { selfTest: true })).detail).toContain('no selfTest')
  })
})

describe('lanes', () => {
  test('cargo commands always go through the lock script from NV_CARGO_LOCK', () => {
    const w = wrapForLane('cargo', 'cargo', ['build'], { NV_CARGO_LOCK: '/x/lock.sh', NV_BASH: 'bash' }, () => true, {})
    expect(w).toMatchObject({ cmd: 'bash', args: ['/x/lock.sh', 'cargo', 'build'] })
    // A script that is configured but missing is named; with nothing configured the built-in lock is used.
    expect(wrapForLane('cargo', 'cargo', ['build'], { NV_CARGO_LOCK: '/x/lock.sh', NV_BASH: 'bash' }, () => false, {}).missing).toContain('cargo lock script not found')
    expect(wrapForLane('cargo', 'cargo', ['build'], {}, () => false, {})).toMatchObject({ cmd: 'node', args: [expect.stringContaining('cargo-lock-run.mjs'), 'cargo', 'build'] })
    expect(wrapForLane('cargo', 'cargo', ['build'], { NV_BASH: 'bash' }, () => true, { cargoLock: '/home/lock.sh' })).toMatchObject({ cmd: 'bash', args: ['/home/lock.sh', 'cargo', 'build'] })
  })
  test('electron lane uses the machine lock when present, runs directly when not', () => {
    const w = wrapForLane('electron', 'npm', ['run', 'x'], { NV_ELECTRON_LOCK: '/x/e.sh', NV_BASH: 'bash' }, () => true)
    expect(w.args?.[0]).toBe('/x/e.sh')
    expect(w.env?.NV_ELECTRON_LOCK_HELD).toBe('1')
    // The machine lock is optional; the test safety layer is not.
    const lockless = wrapForLane('electron', 'npm', ['run', 'x'], {}, (p: string) => p.includes('test-safety'))
    expect(lockless).toMatchObject({ cmd: 'npm' })
  })
  test('every electron command gets the test safety layer, and a missing layer is NOT RUN, never a silent skip', () => {
    const w = wrapForLane('electron', 'npm', ['run', 'x'], {}, () => true)
    expect(w.env?.NV_TEST_SAFETY).toBe('1')
    expect(wrapForLane('electron', 'npm', ['run', 'x'], {}, () => false).missing).toContain('test safety layer not built')
  })
  test('NV_TEST_SAFETY=off leaves the layer out (only the self-test of the layer itself does this)', () => {
    const w = wrapForLane('electron', 'npm', ['run', 'x'], { NV_TEST_SAFETY: 'off' }, () => false)
    expect(w).toMatchObject({ cmd: 'npm' })
    expect(w.env?.NV_TEST_SAFETY).toBeUndefined()
  })
})

describe('loader', () => {
  test('a check file that throws on import becomes one FAIL naming the file, others still load', async () => {
    writeFileSync(join(dir, 'broken.mjs'), 'throw new Error("kaput")\n')
    writeFileSync(join(dir, 'notarray.mjs'), 'export default 5\n')
    writeFileSync(join(dir, 'good.mjs'), "export default [{ id: 'g', group: 'ui', tier: 'fast', lane: 'free', title: 'g', run: { cmd: 'node', args: [] } }]\n")
    const checks = await loadChecks(dir)
    expect(ids(checks).sort()).toEqual(['bad-check-file-broken', 'bad-check-file-notarray', 'g'])
    const bad = checks.find((c: any) => c.id === 'bad-check-file-broken')
    const r = await runOne(bad, ctx())
    expect(r.status).toBe('FAIL')
    expect(r.detail).toContain('broken.mjs')
  })
  test('a missing checks folder is not an error', async () => {
    expect(await loadChecks(join(dir, 'nope'))).toEqual([])
  })
  test('every core check is well formed, unique and has a self-test', () => {
    const seen = new Set()
    for (const c of coreChecks as any[]) {
      expect(validateCheck(c)).toBeNull()
      expect(c.selfTest, c.id).toBeTruthy()
      expect(seen.has(c.id)).toBe(false)
      seen.add(c.id)
    }
  })
})

// A stray backspace byte once sat where a word-boundary escape belonged in this regex, so the error line was never found.
describe('lastLine', () => {
  test('shows the error line, not the warning that cargo prints after it', () => {
    expect(lastLine('URL: x\nerror: 4 vulnerabilities found!\nwarning: 12 allowed warnings found\n')).toBe('error: 4 vulnerabilities found!')
  })
  test('still finds the error line when the tool colours it', () => {
    expect(lastLine('x\n\u001b[1m\u001b[31merror\u001b[0m: broken\nwarning: later')).toBe('error: broken')
  })
  test('falls back to the last line when there is no error line', () => {
    expect(lastLine('one\ntwo\n')).toBe('two')
  })
})

describe('arguments', () => {
  test('flags parse', () => {
    const o = parseArgs(['--thorough', '--only', 'a,b', '--include', 'staging', '--json', 'o.json', '--keep-going'])
    expect(o).toMatchObject({ thorough: true, only: ['a', 'b'], include: ['staging'], json: 'o.json', keepGoing: true })
    expect(parseArgs(['--changed', '--all']).errors).toHaveLength(1)
    expect(parseArgs(['--wat']).errors[0]).toContain('--wat')
  })
})

describe('click-through shards runner', () => {
  test('no cells means one default cell', () => {
    expect(parseCells('')).toEqual([{ label: 'default', env: {} }])
  })

  test('cells map to the gate knobs and a typo is an error', () => {
    const cells = parseCells('theme=light; theme=dark,size=1024x720; motion=1')
    expect(cells.map((c) => c.env)).toEqual([
      { NV_CLICKS_THEME: 'light' },
      { NV_CLICKS_THEME: 'dark', NV_CLICKS_SIZE: '1024x720' },
      { NV_CLICKS_REDUCED_MOTION: '1' },
    ])
    expect(() => parseCells('colour=red')).toThrow(/NV_CLICKS_CELLS/)
  })

  test('one job per cell and shard', () => {
    const jobs = planJobs(parseCells('theme=light;theme=dark'), 3)
    expect(jobs).toHaveLength(6)
    expect(jobs.filter((j) => j.cell.label === 'theme=light').map((j) => j.shard)).toEqual([1, 2, 3])
  })
})

describe('promotion lag report', () => {
  test('a hop is due at the threshold, stable never triggers, a missing branch is unknown not ok', () => {
    const rows = assess({ 'dev>test': 99, 'test>beta': 100, 'beta>stable': 900 }, 100)
    expect(rows.map((r) => r.due)).toEqual([false, true, false])
    expect(assess({ 'dev>test': null, 'test>beta': 0, 'beta>stable': 0 })[0].due).toBe(false)
    expect(report(rows, 100)).toMatch(/DUE: test -> beta/)
    expect(report(assess({ 'dev>test': null, 'test>beta': 0, 'beta>stable': 0 }), 100)).toMatch(/unknown\s+UNKNOWN|UNKNOWN/)
  })

  test('the default cell can be listed next to others', () => {
    expect(parseCells('default;theme=black').map((c) => c.label)).toEqual(['default', 'theme=black'])
  })
})

describe('tuning for slower machines', () => {
  const machine = (cpus: number, gb: number) => ({ cpus, freeBytes: gb * 2 ** 30 })

  test('auto sizes the window count from cores and free memory, up to its ceiling', () => {
    expect(resolveWidth('auto:6', 4, machine(12, 12))).toBe(6)
    expect(resolveWidth('auto:6', 4, machine(4, 12))).toBe(2)
    expect(resolveWidth('auto:6', 4, machine(12, 3))).toBe(2)
    expect(resolveWidth('auto', 4, machine(2, 1))).toBe(1)
    expect(resolveWidth('3', 4, machine(2, 1))).toBe(3)
    expect(resolveWidth('', 4)).toBe(4)
    expect(() => resolveWidth('lots', 4)).toThrow(/whole number or auto/)
  })

  test('a profile fills in only what the person has not set', () => {
    const env: Record<string, string> = { NV_CLICKS_SHARDS: '5' }
    const set = applyProfile('low', env)
    expect(env.NV_CLICKS_SHARDS).toBe('5')
    expect(env.NV_CLICKS_JOBS).toBe('2')
    expect(set).not.toContain('NV_CLICKS_SHARDS=2')
    expect(() => applyProfile('huge', {})).toThrow(/unknown profile/)
  })

  test("a check env is a default that an NV_ variable beats, but not in a self-test", async () => {
    const check = { id: 'envy', group: 'functionality', tier: 'fast', lane: 'free', title: 't', needs: [], run: { cmd: 'node', args: ['-e', 'process.exit(process.env.NV_X === "user" ? 0 : 1)'], cwd: 'app', env: { NV_X: 'default' } }, selfTest: { cmd: 'node', args: ['-e', 'process.exit(process.env.NV_X === "fixture" ? 1 : 0)'], cwd: 'app', env: { NV_X: 'fixture' } } }
    expect((await runOne(check as never, { ...ctx(), env: { ...process.env, NV_X: 'user' } })).status).toBe('PASS')
    expect((await runOne(check as never, { ...ctx(), env: { ...process.env } })).status).toBe('FAIL')
    expect((await runOne(check as never, { ...ctx(), env: { ...process.env, NV_X: 'user' } }, { selfTest: true })).status).toBe('PASS')
  })

  test('a check covered by a bigger one in the same run does not run on its own', () => {
    const mk = (id: string, extra = {}) => ({ id, tier: 'thorough', ...extra })
    const sel = selectChecks([mk('small', { supersededBy: 'big' }), mk('big')] as never, { tier: 'thorough', mode: 'all', changedFiles: null })
    expect(sel.run.map((c: { id: string }) => c.id)).toEqual(['big'])
    expect(sel.superseded.map((c: { id: string }) => c.id)).toEqual(['small'])
    const alone = selectChecks([mk('small', { supersededBy: 'big' })] as never, { tier: 'thorough', mode: 'all', changedFiles: null })
    expect(alone.run).toHaveLength(1)
  })
})

describe('live progress display', () => {
  const checks = [{ id: 'a', estSeconds: 10 }, { id: 'b', estSeconds: 30 }, { id: 'c', estSeconds: 60 }]

  test('time and bar formatting', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(75_000)).toBe('1:15')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
    expect(renderBar(0.5, 10)).toBe('█████░░░░░')
    expect(renderBar(2, 4)).toBe('████')
    expect(renderBar(Number.NaN, 4)).toBe('░░░░')
  })

  test('progress is weighted by estimate, counts part of a running check, and never reaches 100% while one runs', () => {
    expect(computeProgress({ checks, done: new Set(['c']), running: new Map(), now: 0 }).fraction).toBeCloseTo(0.6)
    const half = computeProgress({ checks, done: new Set(), running: new Map([['b', 0]]), now: 15_000 })
    expect(half.fraction).toBeCloseTo(15 / 100)
    const slow = computeProgress({ checks, done: new Set(['a', 'b']), running: new Map([['c', 0]]), now: 600_000 })
    expect(slow.fraction).toBeLessThan(1)
    expect(computeProgress({ checks, done: new Set(['a', 'b', 'c']), running: new Map(), now: 0 }).fraction).toBe(1)
  })

  test('time left only appears after a tenth of the work and is time spent scaled by what remains', () => {
    expect(etaMs(0.05, 10_000)).toBeNull()
    expect(etaMs(0.5, 60_000)).toBe(60_000)
    expect(etaMs(1, 60_000)).toBeNull()
  })

  test('a terminal gets a redrawn block and one line per finished check; a pipe gets only the plain lines', () => {
    let t = 0
    const out: string[] = []
    const stream = { columns: 100, write: (x: string) => { out.push(x) } }
    const bar = createProgress({ title: 'VERIFY fast', checks, stream, enabled: true, now: () => t, color: false, tickMs: 1_000_000 })
    bar.start(checks[0])
    t = 12_000
    bar.settle(checks[0], { status: 'PASS', detail: 'fine' }, 12_000)
    bar.settle(checks[1], { status: 'FAIL', detail: 'broken' }, 1_000)
    bar.stop()
    const text = out.join('')
    expect(text).toContain('✔ PASS')
    expect(text).toContain('✖ FAIL')
    expect(text).toContain('1 passed')
    expect(text).toContain('1 failed')
    expect(text).toContain('2/3 checks')
    expect(text).toContain('?25h')
    const piped: string[] = []
    const plain = createProgress({ title: 'x', checks, stream: { write: (x: string) => { piped.push(x) } }, enabled: false })
    plain.start(checks[0])
    plain.stop()
    expect(piped.join('')).toBe('')
  })
})

describe('finding bash for a machine lock script', () => {
  test('NV_BASH wins; non-Windows uses bash; Windows looks next to git then in Program Files; none means the built-in lock', () => {
    expect(bashFor({ NV_BASH: 'C:/x/bash.exe' }, () => false, 'win32')).toBe('C:/x/bash.exe')
    expect(bashFor({}, () => false, 'linux')).toBe('bash')
    expect(bashFor({ PATH: '' , ProgramFiles: 'C:/Program Files' }, (p: string) => p.split('\\').join('/') === 'C:/Program Files/Git/bin/bash.exe', 'win32')?.split('\\').join('/')).toBe('C:/Program Files/Git/bin/bash.exe')
    expect(bashFor({ PATH: '' }, () => false, 'win32')).toBeNull()
    const noBash = wrapForLane('cargo', 'cargo', ['build'], { NV_CARGO_LOCK: '/x/lock.sh', PATH: '' }, () => true, {})
    expect(noBash.cmd).toBe(process.platform === 'win32' ? 'node' : 'bash')
  })
})

describe('measured times replace the written guesses', () => {
  test('the middle of the last passes wins; failures and stopped checks are not recorded', () => {
    expect(median([300, 100, 200])).toBe(200)
    expect(median([100, 300])).toBe(200)
    expect(median([])).toBeNull()
    let t = recordRun({ checks: {} }, [{ id: 'a', status: 'PASS', ms: 293_000 }, { id: 'b', status: 'FAIL', ms: 5_000 }, { id: 'c', status: 'NOT RUN', ms: 0 }], 'fast')
    expect(Object.keys(t.checks)).toEqual(['a'])
    for (const ms of [100_000, 120_000, 110_000, 130_000, 140_000]) t = recordRun(t, [{ id: 'a', status: 'PASS', ms }], 'fast')
    expect((t.checks as any).a.fast).toEqual([100_000, 120_000, 110_000, 130_000, 140_000])
    expect(learnedSeconds(t, 'a', 'fast')).toBe(120)
    expect(learnedSeconds(t, 'a', 'thorough')).toBeNull()
  })
  test('applyLearned changes only checks that have been measured, and keeps the written value', () => {
    const t = recordRun({ checks: {} }, [{ id: 'proptest', status: 'PASS', ms: 293_000 }], 'fast')
    const checks = [fake({ id: 'proptest', estSeconds: 3 }), fake({ id: 'other', estSeconds: 7 })] as any[]
    expect(applyLearned(checks, t, 'fast')).toBe(1)
    expect(checks[0].estSeconds).toBe(293)
    expect(checks[0].writtenEstSeconds).toBe(3)
    expect(checks[1].estSeconds).toBe(7)
  })
  test('the file round-trips, and a missing or broken file means no measurements, not a crash', () => {
    const file = join(dir, 'timings.json')
    expect(loadTimings(file)).toEqual({ checks: {} })
    writeFileSync(file, '{ not json')
    expect(loadTimings(file)).toEqual({ checks: {} })
    const t = recordRun({ checks: {} }, [{ id: 'a', status: 'PASS', ms: 5_000 }], 'fast')
    expect(saveTimings(file, t)).toBe(true)
    expect(loadTimings(file)).toEqual(t)
    expect(saveTimings(join(file, 'nested', 'x.json'), t)).toBe(false)
  })
})

describe('the status file and the heartbeat', () => {
  const checks = [fake({ id: 'build', lane: 'cargo', estSeconds: 100 }), fake({ id: 'tests', lane: 'cargo', estSeconds: 100 }), fake({ id: 'win', lane: 'electron', after: ['build'], estSeconds: 50 })] as any[]
  test('it writes what is running, for how long, what waits and why, and what finished', () => {
    let t = 0
    const writes: any[] = []
    const lines: string[] = []
    const st = createStatus({ title: 'VERIFY fast', tier: 'fast', checks, file: 'f.json', write: (_f: string, d: any) => { writes.push(d) }, say: (l: string) => { lines.push(l) }, now: () => t, tickMs: 0, heartbeatMs: 30_000 })
    st.start(checks[0])
    st.queue([{ id: 'tests', reason: 'the cargo lane is busy' }, { id: 'win', reason: 'after build' }])
    t = 60_000
    st.settle(checks[0], { status: 'PASS', detail: '' }, 60_000)
    const last = writes[writes.length - 1]
    expect(last.state).toBe('running')
    expect(last.counts).toMatchObject({ total: 3, finished: 1, passed: 1, failed: 0 })
    expect(last.finished[0]).toMatchObject({ id: 'build', status: 'PASS' })
    expect(last.percent).toBeGreaterThan(30)
    st.start(checks[1])
    t = 90_000
    const mid = st.snapshot()
    expect(mid.running[0]).toMatchObject({ id: 'tests', elapsedMs: 30_000, expectedMs: 100_000, overran: false })
    expect(st.line()).toContain('running: tests 0:30/1:40')
    t = 400_000
    expect(st.snapshot().running[0].overran).toBe(true)
    expect(st.line()).toContain('slower than usual')
    st.stop('VERIFY fast: done')
    const final = writes[writes.length - 1]
    expect(final).toMatchObject({ state: 'done', percent: 100, summary: 'VERIFY fast: done' })
  })
  test('waiting reasons come from the scheduler', async () => {
    const seen: any[] = []
    const a = fake({ id: 'a', lane: 'cargo', run: async () => { await new Promise((r) => setTimeout(r, 30)); return { ok: true } } })
    const b = fake({ id: 'b', lane: 'cargo' })
    const c = fake({ id: 'c', lane: 'electron', after: ['a'] })
    await runAll([a, b, c] as any[], ctx(), { hooks: { queue: (w: any[]) => { seen.push(w) } } })
    const first = seen[0]
    expect(first.find((w: any) => w.id === 'b').reason).toBe('the cargo lane is busy')
    expect(first.find((w: any) => w.id === 'c').reason).toBe('after a')
    expect(seen[seen.length - 1]).toEqual([])
  })
  test('a status file that cannot be written never stops the run, and fanOut calls every listener', () => {
    const st = createStatus({ title: 't', tier: 'fast', checks, file: 'f.json', write: () => { throw new Error('disk full') }, now: () => 0, tickMs: 0 })
    expect(() => { st.start(checks[0]); st.settle(checks[0], { status: 'PASS' }, 1); st.stop() }).not.toThrow()
    const calls: string[] = []
    const both = fanOut({ start: () => calls.push('a') }, null, { start: () => calls.push('b'), settle: () => calls.push('c') })
    ;(both as any).start({})
    ;(both as any).settle({})
    ;(both as any).queue([])
    expect(calls).toEqual(['a', 'b', 'c'])
  })
})

describe('start order for speed', () => {
  test('a check others wait on starts first, quick gates stay ahead of it, the rest keep cheapest first', () => {
    const list = [
      fake({ id: 'clippy', lane: 'cargo', estSeconds: 189 }),
      fake({ id: 'parser', lane: 'cargo', estSeconds: 293 }),
      fake({ id: 'fmt', lane: 'cargo', estSeconds: 5 }),
      fake({ id: 'build', lane: 'cargo', estSeconds: 378 }),
      fake({ id: 'axe', lane: 'electron', estSeconds: 83, after: ['build'] }),
      fake({ id: 'clicks', lane: 'electron', estSeconds: 112, after: ['build'] }),
    ]
    const order = ids(orderForSpeed(list))
    expect(order[0]).toBe('fmt')
    expect(order[1]).toBe('build')
    expect(order.indexOf('build')).toBeLessThan(order.indexOf('clippy'))
    expect(order.indexOf('clippy')).toBeLessThan(order.indexOf('parser'))
    expect(order).toHaveLength(list.length)
  })
  test('a dependency cycle does not loop forever', () => {
    const order = orderForSpeed([fake({ id: 'a', after: ['b'] }), fake({ id: 'b', after: ['a'] })])
    expect(order).toHaveLength(2)
  })
})

describe('the scheduler gives light checks the machine together and heavy ones room', () => {
  const sleepCheck = (id: string, ms: number, extra: Record<string, unknown> = {}) => fake({ id, estSeconds: 1, run: async () => { await new Promise((r) => setTimeout(r, ms)); return { ok: true, detail: '' } }, ...extra })
  test('a check costs what it says, or the usual cost of its lane', () => {
    expect(costOf({ lane: 'free' } as never).cpu).toBe(1)
    expect(costOf({ lane: 'cargo' } as never).cpu).toBeGreaterThan(3)
    expect(costOf({ lane: 'free', cost: { cpu: 7 } } as never)).toMatchObject({ cpu: 7 })
  })
  test('with room, light checks run at the same time; the budget holds a heavy one back until there is room', async () => {
    const order: string[] = []
    const mk = (id: string, cpu: number) => sleepCheck(id, 60, { cost: { cpu, memGB: 0 }, run: async () => { order.push('start ' + id); await new Promise((r) => setTimeout(r, 60)); order.push('end ' + id); return { ok: true, detail: '' } } })
    const res = await runAll([mk('heavy', 8), mk('light-a', 1), mk('light-b', 1)], ctx(), { parallel: 5, budget: { cpu: 8, reserveGB: 0 }, freeMemGB: () => 64 })
    expect(res.map((r: any) => r.status)).toEqual(['PASS', 'PASS', 'PASS'])
    expect(order.indexOf('end heavy')).toBeLessThan(order.indexOf('start light-a'))
    expect(order.indexOf('start light-b')).toBeLessThan(order.indexOf('end light-a'))
  })
  test('little memory free means a heavy check waits, but one check can always run alone', async () => {
    const res = await runAll([sleepCheck('big', 20, { cost: { cpu: 1, memGB: 50 } })], ctx(), { parallel: 2, budget: { cpu: 8, reserveGB: 3 }, freeMemGB: () => 1 })
    expect(res[0].status).toBe('PASS')
    const seen: string[] = []
    const a = sleepCheck('a', 40, { cost: { cpu: 1, memGB: 0.1 }, run: async () => { seen.push('a'); await new Promise((r) => setTimeout(r, 40)); return { ok: true, detail: '' } } })
    const b = sleepCheck('b', 10, { cost: { cpu: 1, memGB: 10 }, run: async () => { seen.push('b'); return { ok: true, detail: '' } } })
    await runAll([a, b], ctx(), { parallel: 2, budget: { cpu: 8, reserveGB: 3 }, freeMemGB: () => 5 })
    expect(seen).toEqual(['a', 'b'])
  })
  test('without a budget nothing changes: everything runs side by side as before', async () => {
    const t0 = Date.now()
    await runAll([sleepCheck('x', 80), sleepCheck('y', 80), sleepCheck('z', 80)], ctx(), { parallel: 5 })
    expect(Date.now() - t0).toBeLessThan(230)
  })
  test('the full unit tests also run in the fast tier when every check runs (nothing differs from origin/dev)', () => {
    const checks = [fake({ id: 'changed', supersededBy: 'all' }), fake({ id: 'all', tier: 'thorough', fastWhenAll: true }), fake({ id: 'other', tier: 'thorough' })]
    const sel = selectChecks(checks, { tier: 'fast', mode: 'all', changedFiles: null })
    expect(ids(sel.run)).toEqual(['all'])
    expect(ids(sel.superseded)).toEqual(['changed'])
    expect(ids(selectChecks(checks, { tier: 'fast', mode: 'changed', changedFiles: ['x'] }).run)).toEqual(['changed'])
  })
})

describe('swapping checks and tools in and out with meerkat.config.json', () => {
  const built = [fake({ id: 'type-check', run: { cmd: 'npm', args: ['run', 'check'], cwd: 'app' }, selfTest: { cmd: 'x', args: [], expectFail: true } }), fake({ id: 'ui-axe' }), fake({ id: 'lint' })] as any[]
  const read = (obj: unknown) => readConfig('/p/meerkat.config.json', () => JSON.stringify(obj))
  const slash = (f: string | null) => (f ?? '').split(String.fromCharCode(92)).join('/')
  test('the file is found next to the app, then in the repo, or named on the command line', () => {
    const has = (...files: string[]) => (f: string) => files.includes(slash(f))
    expect(slash(findConfig({ explicit: '/x/c.json', appDir: '/a', repoRoot: '/r', exists: () => true }))).toMatch(/c\.json$/)
    expect(slash(findConfig({ appDir: '/a', repoRoot: '/r', exists: has('/a/meerkat.config.json', '/r/meerkat.config.json') }))).toMatch(/a\/meerkat\.config\.json$/)
    expect(findConfig({ appDir: '/a', repoRoot: '/r', exists: () => false })).toBeNull()
  })
  test('mistakes are reported as notes and the rest of the file still applies; a broken file is ignored', () => {
    const r = read({ disable: 'nope', override: { lint: { colour: 'red', tier: 'thorough' } }, budget: { cpu: 0 }, extraChecks: 5 })
    expect(r.notes.length).toBeGreaterThanOrEqual(4)
    expect(r.config.override.lint).toEqual({ tier: 'thorough' })
    const broken = readConfig('/p/c.json', () => '{ nope')
    expect(broken.notes[0]).toContain('ignored')
    expect(broken.config).toEqual({})
  })
  test('disable lists what it turned off; an unknown id is a note, not a silent nothing', async () => {
    const out = await applyConfig(built, read({ disable: ['ui-axe', 'ghost'] }).config, { file: '/p/meerkat.config.json' })
    expect(out.checks.map((c: any) => c.id)).toEqual(['type-check', 'lint'])
    expect(out.disabled.map((d: any) => d.id)).toEqual(['ui-axe'])
    expect(out.notes.join(' ')).toContain('ghost')
  })
  test('override changes a check; changing its tool drops the old self-test so the new tool must prove itself', async () => {
    const out = await applyConfig(built, read({ override: { 'type-check': { tier: 'thorough', run: { cmd: 'pnpm', args: ['tsc'] } }, lint: { estSeconds: 9 }, ghost: { tier: 'fast' } } }).config, { file: '/p/meerkat.config.json' })
    const t = out.checks.find((c: any) => c.id === 'type-check') as any
    expect(t.tier).toBe('thorough')
    expect(t.run).toMatchObject({ cmd: 'pnpm', args: ['tsc'], cwd: 'app' })
    expect(t.selfTest).toBeUndefined()
    expect((out.checks.find((c: any) => c.id === 'lint') as any).estSeconds).toBe(9)
    expect(out.notes.join(' ')).toContain('ghost')
    const bad = await applyConfig(built, read({ override: { lint: { lane: 'moon' } } }).config, { file: '/p/meerkat.config.json' })
    expect((bad.checks.find((c: any) => c.id === 'lint') as any).lane).toBe('free')
    expect(bad.notes.join(' ')).toContain('lane')
  })
  test('extra checks are added, and one with the same id swaps out the built-in one', async () => {
    const extra = [fake({ id: 'lint', title: 'my lint' }), fake({ id: 'brand-new' })] as any[]
    const out = await applyConfig(built, read({ extraChecks: ['more'] }).config, { file: '/p/meerkat.config.json', load: async () => extra })
    expect(out.checks.map((c: any) => c.id)).toEqual(['type-check', 'ui-axe', 'lint', 'brand-new'])
    expect((out.checks.find((c: any) => c.id === 'lint') as any).title).toBe('my lint')
    expect(out.notes.join(' ')).toContain('swapped')
    const only = await applyConfig(built, read({ builtin: false, extraChecks: ['more'] }).config, { file: '/p/meerkat.config.json', load: async () => extra })
    expect(only.checks.map((c: any) => c.id)).toEqual(['lint', 'brand-new'])
  })
})
