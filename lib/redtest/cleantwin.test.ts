// Kind 5, clean-twin false alarm: the CLEAN version of every fixture used by the planted-bug kind (and the tiny base project the other kinds use) must give
// zero findings and zero failed checks. A critical, high or medium finding on a clean twin is a false alarm; low and info are notes and are counted apart.
// This is the number the suite exists to drive down: it is printed as REDTEST-FALSE-ALARMS and the test fails while it is above zero.
import { afterAll, describe, expect, test, vi } from 'vitest'
import { APPS } from '../../tools/fake-apps/index.mjs'
import { bugFindings, cleanup, commitAll, makeProject, meerkat, scratch, tinyNodeFiles, writeTree } from './harness.mjs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

vi.setConfig({ testTimeout: 300_000 })
afterAll(cleanup)

type Twin = { name: string; dir: string }
const twins: Twin[] = [
  ...(Object.entries(APPS) as [string, any][]).map(([name, app]) => {
    const dir = join(scratch(), app.name)
    mkdirSync(dir, { recursive: true })
    writeTree(dir, app.clean)
    commitAll(dir)
    return { name, dir }
  }),
  { name: 'tiny-node', dir: makeProject(tinyNodeFiles()) },
]

const alarms: string[] = []
const notes: string[] = []

describe('clean twins give no false alarms', () => {
  test.each(twins.map((t) => [t.name, t] as const))('%s', (_n, t) => {
    const run = meerkat(t.dir, ['--preset', 'quick'], { timeoutMs: 280_000 })
    expect(run.summary, run.out.slice(-1500)).not.toBeNull()
    const bad = bugFindings(run.findings).map((f: any) => `${t.name}: ${f.severity} ${f.check}${f.rule ? `/${f.rule}` : ''} ${f.file ?? ''}${f.line ? `:${f.line}` : ''}`)
    alarms.push(...bad)
    notes.push(...(run.findings?.findings ?? []).filter((f: any) => !['critical', 'high', 'medium'].includes(f.severity)).map((f: any) => `${t.name}: ${f.severity} ${f.check}`))
    const failed = run.results.filter((r: any) => r.status === 'FAIL').map((r: any) => `${r.id}: ${String(r.detail).slice(0, 160)}`)
    expect({ falseAlarms: bad, failedChecks: failed }).toEqual({ falseAlarms: [], failedChecks: [] })
  })

  test('the false-alarm count (printed)', () => {
    console.log([`REDTEST-FALSE-ALARMS ${alarms.length} across ${twins.length} clean twins`, ...alarms.map((a) => `FALSE-ALARM ${a}`), `REDTEST-CLEAN-TWIN-NOTES ${notes.length} low/info findings (not counted)`].join('\n'))
    expect(alarms.length).toBe(0)
  })
})
