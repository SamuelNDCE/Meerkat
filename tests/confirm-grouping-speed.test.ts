// confirmFindings groups findings through a per-file index instead of asking every group: the groups must be exactly the ones the plain scan makes.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { confirmFindings, sameProblem } from '../lib/confirm.mjs'

// The plain scan this replaced: each finding joins the first group every member of which it matches.
function bruteGroups(items: any[]): string[][] {
  const list: any[][] = []
  for (const f of items) {
    const g = list.find((x) => x.every((m) => sameProblem(f, m)))
    if (g) g.push(f)
    else list.push([f])
  }
  return list.map((g) => g.map((x) => x.id))
}

let seed = 12345
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
const RULES = ['sql-concat', 'sql-injection', 'hardcoded-password', 'generic-secret', 'api-key', 'xss-innerhtml', 'unused-export', 'no-such-class', 'eval-call', 'ghsa-aaaa-bbbb-cccc']
const CHECKS = ['one', 'two', 'three', 'secret-scan']
const FILES = ['a.js', 'b.js', 'c.js', 'd.js', '', undefined]

describe('grouping through the per-file index', () => {
  test('300 random findings land in the same groups as the plain scan', () => {
    for (let round = 0; round < 8; round++) {
      const items = Array.from({ length: 300 }, (_, i) => {
        const rule = RULES[rnd(RULES.length)]
        const adv = rnd(7) === 0 ? ' GHSA-aaaa-bbbb-cccc' : ''
        return { id: `r${round}-${i}`, severity: 'medium', suite: rnd(5) === 0 ? 'secrets' : 'x', check: CHECKS[rnd(CHECKS.length)], rule, file: FILES[rnd(FILES.length)], line: rnd(4) === 0 ? 0 : 1 + rnd(6), lines: [1], occurrences: 1, message: `m${adv}` }
      })
      const expected = bruteGroups(items.map((x) => ({ ...x })))
      const map = new Map(items.map((x) => [x.id, x]))
      const r = confirmFindings(map)
      const survivors = new Set(map.keys())
      expect(survivors.size).toBe(expected.length)
      expect(r.merged).toBe(items.length - expected.length)
      for (const g of expected) expect(g.filter((id) => survivors.has(id))).toHaveLength(1)
      const total = [...map.values()].reduce((n, x: any) => n + (x.occurrences ?? 1), 0)
      expect(total).toBe(items.length)
    }
  })
})
