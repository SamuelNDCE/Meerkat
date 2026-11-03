import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = () => import(pathToFileURL(join(root, 'tools', 'accuracy-labels.mjs')).href)

describe('two-layer labels', () => {
  test('accepts both fragment layouts', async () => {
    const { parseFragment } = await load()
    const m = parseFragment('a\tcritical\teasy\r\nb\t\thigh\thard\r\n\r\n# note\r\n', 'f.txt')
    expect(m.get('a')).toMatchObject({ impact: 'critical', difficulty: 'easy' })
    expect(m.get('b')).toMatchObject({ impact: 'high', difficulty: 'hard' })
    expect(m.size).toBe(2)
  })

  test('rejects an unknown impact or difficulty', async () => {
    const { parseFragment } = await load()
    expect(() => parseFragment('a\tsevere\teasy\n', 'f.txt')).toThrow(/unknown impact "severe"/)
    expect(() => parseFragment('a\tlow\timpossible\n', 'f.txt')).toThrow(/unknown difficulty "impossible"/)
  })

  test('rejects a duplicate key', async () => {
    const { parseFragment } = await load()
    const m = parseFragment('a\tlow\teasy\n', 'one.txt')
    expect(() => parseFragment('a\thigh\thard\n', 'two.txt', m)).toThrow(/listed twice/)
    expect(() => parseFragment('a\tlow\teasy\na\tlow\teasy\n', 'x.txt')).toThrow(/listed twice/)
  })

  test('rejects a planted key with no label when strict', async () => {
    const { missingLabels } = await load()
    const labels = new Map([['a', { impact: 'low', difficulty: 'easy' }]])
    expect(missingLabels([{ key: 'a' }, { key: 'zz' }], labels)).toEqual(['zz'])
    expect(() => missingLabels([{ key: 'zz' }], labels, true)).toThrow(/zz/)
  })

  test('the real fragments load without error', async () => {
    const { loadLabels } = await load()
    expect(loadLabels().size).toBeGreaterThan(0)
  })

  test('cross-tab counts add up to the planted total, unlabelled included', async () => {
    const { labelStats, crossTab, labelReport } = await load()
    const labels = new Map([
      ['a', { impact: 'critical', difficulty: 'easy' }],
      ['b', { impact: 'critical', difficulty: 'hard' }],
      ['c', { impact: 'low', difficulty: 'extreme' }],
    ])
    const planted = [
      { key: 'a', detected: true },
      { key: 'b', detected: false },
      { key: 'c', detected: true },
      { key: 'd', detected: false },
    ]
    const s = labelStats(planted, labels)
    let plantedSum = 0
    let detectedSum = 0
    for (const row of Object.values(s.cross) as Record<string, { planted: number; detected: number }>[])
      for (const c of Object.values(row)) {
        plantedSum += c.planted
        detectedSum += c.detected
      }
    expect(plantedSum).toBe(planted.length)
    expect(detectedSum).toBe(2)
    expect(s.unlabelled).toBe(1)
    expect(s.cross.critical.easy).toEqual({ planted: 1, detected: 1 })
    expect(crossTab(s)).toContain('UNLABELLED')
    expect(labelReport(planted, labels)).toContain('UNLABELLED d')
  })
})
