// Kind 1, planted bugs (mutation): take a CLEAN fixture project, plant one known defect by swapping in ONE file from the defective variant, run
// Meerkat on only the checks that should see it, and assert each reports it. Recall is counted per family and printed at the end.
import { afterAll, describe, expect, test, vi } from 'vitest'
import { APPS } from '../../tools/fake-apps/index.mjs'
import { cleanup, commitAll, foundDefect, meerkat, scratch, writeTree } from './harness.mjs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

vi.setConfig({ testTimeout: 180_000 })
afterAll(cleanup)

// One family per kind of defect. A defect belongs to the family of its check (rule ids do not change the family).
const FAMILY: Record<string, string> = {
  'sql-concat': 'injection',
  'cookie-flags': 'web-headers-and-cookies',
  'wh-headers': 'web-headers-and-cookies',
  'secret-scan': 'secrets',
  'secrets-plus': 'secrets',
  'js-unhandled-promise': 'js-correctness',
  'ui-static': 'ui-and-accessibility',
  'css-contrast': 'ui-and-accessibility',
  'target-blank-noopener': 'ui-and-accessibility',
  'cp-rust': 'rust',
  'rp-errors': 'rust',
  'debug-enabled': 'python-config',
  'electron-node-integration': 'desktop',
}

type Defect = { check: string; rule?: string; file: string; severity: string; match?: string }
const tally: Record<string, { planted: number; found: number; missed: string[] }> = {}

// Every (app, file) pair that holds a planted defect is one mutant: the clean tree with only that file replaced by its defective version.
const mutants: { app: string; file: string; defects: Defect[] }[] = []
for (const [app, def] of Object.entries(APPS) as [string, any][]) {
  const byFile = new Map<string, Defect[]>()
  for (const d of def.defects as Defect[]) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
  for (const [file, defects] of byFile) mutants.push({ app, file, defects })
}

describe('planted bugs: one defect per check family is found', () => {
  test('the fixture is clean apart from the planted file, and every defect has a family', () => {
    for (const m of mutants) {
      const def: any = (APPS as any)[m.app]
      expect(def.clean[m.file], `${m.app}/${m.file}`).not.toBe(def.defective[m.file])
      for (const d of m.defects) expect(FAMILY[d.check], `no family for ${d.check}`).toBeTruthy()
    }
  })

  test.each(mutants.map((m) => [`${m.app}: ${m.file}`, m] as const))('%s', (_label, m) => {
    const def: any = (APPS as any)[m.app]
    const dir = join(scratch(), def.name)
    mkdirSync(dir, { recursive: true })
    writeTree(dir, { ...def.clean, [m.file]: def.defective[m.file] })
    commitAll(dir)
    const only = [...new Set(m.defects.map((d) => d.check))].join(',')
    const run = meerkat(dir, ['--preset', 'quick', '--only', only, '--all'])
    expect(run.findings, run.out.slice(-1500)).not.toBeNull()
    for (const d of m.defects) {
      const fam = (tally[FAMILY[d.check]] ??= { planted: 0, found: 0, missed: [] })
      fam.planted++
      if (foundDefect(run.findings, d)) fam.found++
      else fam.missed.push(`${d.check}${d.rule ? `/${d.rule}` : ''} in ${m.app}/${d.file}`)
    }
    const missed = Object.values(tally).flatMap((f) => f.missed)
    expect(missed.filter((x) => x.includes(`${m.app}/${m.file}`)), `reported: ${JSON.stringify((run.findings?.findings ?? []).map((f: any) => [f.severity, f.check, f.rule, f.file]))}`).toEqual([])
  })

  test('recall per family (printed)', () => {
    const rows = Object.entries(tally).sort(([a], [b]) => a.localeCompare(b))
    const lines = ['REDTEST-RECALL family planted found recall', ...rows.map(([f, t]) => `REDTEST-RECALL ${f} ${t.planted} ${t.found} ${t.planted ? Math.round((100 * t.found) / t.planted) : 100}%`)]
    const planted = rows.reduce((n, [, t]) => n + t.planted, 0)
    const found = rows.reduce((n, [, t]) => n + t.found, 0)
    lines.push(`REDTEST-RECALL-TOTAL ${found} of ${planted}`)
    console.log(lines.join('\n'))
    for (const [f, t] of rows) expect(t.missed, `family ${f} missed`).toEqual([])
  })
})
