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
    const sc = { name: 'hang', driver: { cmd: process.execPath, args: [join(FIX, 'hang-driver.mjs')] }, steps: [{ type: 'open', url: 'http://x.test/', timeoutMs: 300 }] }
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
