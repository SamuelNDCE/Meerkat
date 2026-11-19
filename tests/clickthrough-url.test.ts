// Click-through step expectations: expect.url and expect.title are compared with what the driver reports after the step.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { validateScenario } from '../lib/clickthrough.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DRIVER = join(ROOT, 'fixtures', 'clickthrough', 'fake-url-driver.mjs')
const RUNNER = join(ROOT, 'lib', 'clickthrough.mjs')
const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'mk-ctu-')); made.push(d); return d }

function run(env: Record<string, string>, step: any) {
  const dir = tmp()
  writeFileSync(join(dir, 'sc.json'), JSON.stringify({ name: 'url', driver: { cmd: process.execPath, args: [DRIVER], env }, steps: [step] }))
  const out = tmp()
  const r = spawnSync(process.execPath, [RUNNER, 'sc.json', '--root', dir, '--out', out], { encoding: 'utf8', timeout: 60_000 })
  const result = JSON.parse(readFileSync(join(out, readdirSync(out)[0], 'result.json'), 'utf8'))
  return { code: r.status, stdout: r.stdout, result }
}

describe('click-through expect.url and expect.title', () => {
  test('a matching url passes', () => {
    const r = run({}, { type: 'open', url: 'http://x.test/a', expect: { url: 'http://x.test/a' } })
    expect(r.code).toBe(0)
    expect(r.result.steps[0].ok).toBe(true)
  })

  test('a different reported url fails and names both urls', () => {
    const r = run({ MEERKAT_FAKE_FINAL_URL: 'http://other.test/login' }, { type: 'open', url: 'http://x.test/a', expect: { url: 'http://x.test/a' } })
    expect(r.code).toBe(1)
    expect(r.result.failed.expected).toContain('http://x.test/a')
    expect(r.result.failed.actual).toContain('http://other.test/login')
    expect(r.stdout).toContain('http://x.test/a')
    expect(r.stdout).toContain('http://other.test/login')
  })

  test('a matching title passes', () => {
    const r = run({ MEERKAT_FAKE_TITLE: 'Dashboard' }, { type: 'open', url: 'http://x.test/', expect: { title: 'Dashboard' } })
    expect(r.code).toBe(0)
  })

  test('a different reported title fails and names both titles', () => {
    const r = run({ MEERKAT_FAKE_TITLE: 'Sign in' }, { type: 'open', url: 'http://x.test/', expect: { title: 'Dashboard' } })
    expect(r.code).toBe(1)
    expect(r.result.failed.expected).toContain('Dashboard')
    expect(r.result.failed.actual).toContain('Sign in')
    expect(r.stdout).toContain('Dashboard')
    expect(r.stdout).toContain('Sign in')
  })

  test('a driver that reports nothing fails a step that asked, with a clear message', () => {
    const r = run({ MEERKAT_FAKE_NO_REPORT: '1' }, { type: 'open', url: 'http://x.test/', expect: { url: 'http://x.test/' } })
    expect(r.code).toBe(1)
    expect(r.result.failed.actual).toContain('did not report a url')
  })

  test('a step with no expect fields behaves as before even when the driver reports other values', () => {
    const r = run({ MEERKAT_FAKE_FINAL_URL: 'http://other.test/', MEERKAT_FAKE_TITLE: 'Else' }, { type: 'open', url: 'http://x.test/' })
    expect(r.code).toBe(0)
    const q = run({ MEERKAT_FAKE_NO_REPORT: '1' }, { type: 'open', url: 'http://x.test/' })
    expect(q.code).toBe(0)
  })

  test('validateScenario checks the expect block', () => {
    const base = { name: 'n', driver: { cmd: 'node' } }
    expect(validateScenario({ ...base, steps: [{ type: 'open', url: 'http://x/', expect: { url: 'http://x/', title: 'T' } }] })).toEqual([])
    expect(validateScenario({ ...base, steps: [{ type: 'open', url: 'http://x/', expect: {} }] }).join()).toContain('expect needs url or title')
    expect(validateScenario({ ...base, steps: [{ type: 'open', url: 'http://x/', expect: { url: 5 } }] }).join()).toContain('expect.url must be a non-empty string')
    expect(validateScenario({ ...base, steps: [{ type: 'open', url: 'http://x/', expect: 'x' }] }).join()).toContain('expect must be an object')
  })
})
