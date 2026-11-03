import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (f: string) => import(pathToFileURL(join(root, 'tools', f)).href)

const defect = (project: string, key: string, check: string) => ({ id: `${project}:${key}`, key, project, check, file: 'a.js', line: 1 })
type D = { project: string; key: string }

describe('planted defect distinctness', () => {
  test('a duplicate planted line is reported', async () => {
    const { analyse } = await load('accuracy-distinct.mjs')
    const text: Record<string, string> = { 'p:a': '  const r = eval(req.body.x)', 'q:b': 'const r =   eval(req.body.x)' }
    const r = analyse([defect('p', 'a', 'risky-code'), defect('q', 'b', 'risky-code')], (d: D) => text[`${d.project}:${d.key}`])
    expect(r.duplicates).toBe(1)
    expect(r.lines[0]).toContain('DUPLICATE p:a q:b')
  })

  test('a unique line is not reported', async () => {
    const { analyse } = await load('accuracy-distinct.mjs')
    const text: Record<string, string> = { 'p:a': 'const r = eval(req.body.x)', 'q:b': 'db.query("select * from t where id=" + id)' }
    const r = analyse([defect('p', 'a', 'risky-code'), defect('q', 'b', 'sql')], (d: D) => text[`${d.project}:${d.key}`])
    expect(r.duplicates).toBe(0)
    expect(r.near).toBe(0)
    expect(r.lines).toEqual([])
  })

  test('noise counts only unmatched bug-severity findings on planted projects', async () => {
    const { noiseReport } = await load('accuracy-corpus.mjs')
    const planted = [{ ...defect('p', 'a', 'risky-code'), alt: [], rule: '' }]
    const f = (severity: string, check: string, line: number) => ({ severity, check, rule: null, file: 'a.js', line })
    const r = noiseReport(planted, { p: { findings: { findings: [f('high', 'risky-code', 2), f('high', 'other', 40), f('low', 'other', 50)] } } })
    expect(r.lines).toEqual(['NOISE-TOTAL 1 across 1 planted projects', 'NOISE p other/- a.js:40'])
    expect(noiseReport(planted, {}).lines).toEqual([])
  })
})
