// Click-through runner: a fake driver (fixtures/clickthrough/fake-driver.mjs) passes one scenario and fails another with a named step.
// No real app is started: the scenarios have no `app` block.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { clickThroughCheck } from '../lib/clickthrough.mjs'
import { validateCheck } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIX = join(ROOT, 'fixtures', 'clickthrough')
const RUNNER = join(ROOT, 'lib', 'clickthrough.mjs')
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mk-ct-'))
  made.push(d)
  return d
}
const exec = (scenario: string, root: string, out: string) => spawnSync(process.execPath, [RUNNER, scenario, '--root', root, '--out', out], { encoding: 'utf8', timeout: 60_000 })

function run(scenario: string) {
  const out = tmp()
  const r = exec(scenario, FIX, out)
  const dir = join(out, readdirSync(out)[0])
  return { code: r.status, stdout: r.stdout, result: JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8')) }
}

describe('click-through runner', () => {
  test('a passing scenario exits 0 and saves a screenshot', () => {
    const r = run('pass.json')
    expect(r.code).toBe(0)
    expect(r.result.status).toBe('pass')
    expect(r.result.steps.every((s: any) => s.ok)).toBe(true)
    expect(r.result.screenshots).toHaveLength(1)
    expect(existsSync(r.result.screenshots[0])).toBe(true)
  })

  test('a failing scenario exits 1 and names the step with expected and actual', () => {
    const r = run('fail.json')
    expect(r.code).toBe(1)
    expect(r.result.failed.n).toBe(3)
    expect(r.result.failed.expected).toContain('text "Saved" is present')
    expect(r.result.failed.actual).toContain('page shows: Welcome, Save')
    expect(r.result.steps[3].skipped).toBe(true)
    expect(r.stdout).toContain('FAIL step 3')
  })

  test('a step that hangs is stopped at its timeout', () => {
    const dir = tmp()
    const sc = { name: 'hang', driver: { cmd: process.execPath, args: [join(FIX, 'hang-driver.mjs')], protocol: 1 }, steps: [{ type: 'open', url: 'http://x.test/', timeoutMs: 300 }] }
    writeFileSync(join(dir, 'hang.json'), JSON.stringify(sc))
    const t = Date.now()
    const r = exec('hang.json', dir, tmp())
    expect(r.status).toBe(1)
    expect(Date.now() - t).toBeLessThan(15_000)
    expect(r.stdout).toContain('no answer within 300 ms')
  })

  test('a driver that cannot start exits 75', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ name: 'nodriver', driver: { cmd: 'meerkat-no-such-driver-xyz' }, steps: [{ type: 'open', url: 'http://x.test/' }] }))
    expect(exec('x.json', dir, tmp()).status).toBe(75)
  })

  test('an invalid scenario exits 1 naming the problem', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ name: 'bad', driver: { cmd: 'node' }, steps: [{ type: 'click' }] }))
    const r = exec('bad.json', dir, tmp())
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('step 1 (click): needs text or selector')
  })

  test('the check wrapper is a valid window-lane check that follows the window gate', () => {
    const c: any = clickThroughCheck({ id: 'ct-demo', scenario: 'scenarios/demo.json' })
    expect(validateCheck(c)).toBeNull()
    expect(c.lane).toBe('windows')
    expect(c.found).toBe(true)
    expect(c.run.args).toContain('scenarios/demo.json')
  })
})

describe('click-through runner, protocol 2 (persistent driver)', () => {
  const PD = join(FIX, 'fake-persistent-driver.mjs')
  const steps = (extra: any[] = []) => [
    { type: 'open', url: 'http://x.test/' },
    { type: 'assert', text: 'Welcome' },
    { type: 'click', text: 'Save' },
    { type: 'assert', text: 'Saved' },
    { type: 'screenshot', name: 'done' },
    ...extra,
  ]
  function runPd(env: Record<string, string>, stepList: any[] = steps()) {
    const dir = tmp()
    writeFileSync(join(dir, 'sc.json'), JSON.stringify({ name: 'pd', driver: { cmd: process.execPath, args: [PD], env }, steps: stepList }))
    const out = tmp()
    const t = Date.now()
    const r = exec('sc.json', dir, out)
    const run = join(out, readdirSync(out)[0])
    return { code: r.status, stdout: r.stdout, ms: Date.now() - t, run, result: JSON.parse(readFileSync(join(run, 'result.json'), 'utf8')) }
  }

  test('a passing scenario speaks protocol 2 and saves a screenshot', () => {
    const r = runPd({})
    expect(r.code).toBe(0)
    expect(r.result.protocol).toBe(2)
    expect(r.result.capabilities).toContain('click')
    expect(r.result.steps.every((s: any) => s.ok)).toBe(true)
    expect(existsSync(r.result.screenshots[0])).toBe(true)
  })

  test('a failing scenario names the step with expected and actual', () => {
    const r = runPd({ MEERKAT_FAKE_BREAK_SAVE: '1' })
    expect(r.code).toBe(1)
    expect(r.result.failed.n).toBe(4)
    expect(r.result.failed.expected).toContain('text "Saved" is present')
    expect(r.result.failed.actual).toContain('page shows: Welcome, Save')
    expect(r.result.steps[4].skipped).toBe(true)
    expect(r.stdout).toContain('FAIL step 4')
  })

  test('a driver that never replies to one step fails that step at its timeout', () => {
    const list = steps().map((s, i) => (i === 2 ? { ...s, timeoutMs: 300 } : s))
    const r = runPd({ MEERKAT_FAKE_HANG_STEP: '3' }, list)
    expect(r.code).toBe(1)
    expect(r.result.failed.n).toBe(3)
    expect(r.result.failed.actual).toBe('no answer within 300 ms')
    expect(r.stdout).toContain('FAIL step 3')
    expect(r.ms).toBeLessThan(15_000)
  })

  test('a driver that exits before ready ends the run with 75', () => {
    const r = runPd({ MEERKAT_FAKE_NO_READY: '1' })
    expect(r.code).toBe(75)
    expect(r.result.status).toBe('cannot-start')
    expect(r.result.note).toContain('before ready')
  })

  test('a driver that answers ready with ok false ends the run with 75 and its detail', () => {
    const r = runPd({ MEERKAT_FAKE_NOT_OK: '1' })
    expect(r.code).toBe(75)
    expect(r.result.note).toContain('no display here')
  })

  test('the driver is started once for a multi-step scenario and logs stderr to driver.log', () => {
    const r = runPd({})
    expect(r.result.steps.length).toBeGreaterThan(4)
    const starts = readFileSync(join(r.run, 'session', 'starts.log'), 'utf8').trim().split('\n')
    expect(starts).toHaveLength(1)
    expect(existsSync(join(r.run, 'driver.log'))).toBe(true)
  })

  test('readLines splits on newlines across chunks and flushes the last partial line', async () => {
    const { PassThrough } = await import('node:stream')
    const { readLines } = await import('../lib/clickthrough.mjs')
    const s = new PassThrough()
    const got: string[] = []
    readLines(s, (l: string) => got.push(l))
    s.write('{"a":1}\r\n{"b"')
    s.write(':2}\nlast')
    s.end()
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual(['{"a":1}', '{"b":2}', 'last'])
  })
})
