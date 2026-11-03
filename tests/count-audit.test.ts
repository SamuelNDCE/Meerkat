// Every count Meerkat reports (checks, suites, sub-checks) must be generated or proved, never typed.
//  1. A check's declared `subs` equals the number of distinct MEERKAT-SUB rule ids it prints on its own fixture (or, where the rule set
//     depends on a budget, the number the code itself computes). A check that prints several rules without declaring them counts as one,
//     which would under-report, so that is caught too.
//  2. The numbers in docs/checks.md, docs/coverage.md and the README counts block equal what the checks themselves add up to.
//  3. No hand-written page types a count of checks, sub-checks, rules, suites or packs.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { declaredSubs, groupBySuite, suiteIdOf } from '../lib/suites.mjs'
// @ts-expect-error plain JS module
import { report } from '../thorough/mutation.mjs'
// @ts-expect-error plain JS module
import { orderVariants, tzLocaleVariants } from '../thorough/robustness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const empty = mkdtempSync(join(tmpdir(), 'count-audit-'))
afterAll(() => rmSync(empty, { recursive: true, force: true }))

type Spec = { cmd: string; args: string[]; cwd?: string }
type Check = { id: string; subs?: number; run?: Spec; selfTest?: Spec; pack: string; group: string; tier: string; optIn?: string }

const packs: string[] = readdirSync(join(root, 'packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
const checks: Check[] = []
for (const pack of packs) for (const c of await loadChecks(join(root, 'packs', pack))) checks.push({ ...c, pack })

// The sub-check rule ids a command prints. Run in an empty folder: the checks read the folder they are started in.
const ruleIds = (spec: Spec | undefined, timeout = 120_000): Promise<Set<string>> =>
  new Promise((resolve) => {
    if (!spec) return resolve(new Set())
    execFile(spec.cmd, spec.args, { cwd: spec.cwd === 'repo' ? empty : root, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (_e, out) => {
      resolve(new Set(String(out).split(/\r?\n/).filter((l) => l.startsWith('MEERKAT-SUB ')).map((l) => l.split(' ')[2])))
    })
  })

// Rules that depend on the project (one per exported function, one per dependency) cannot be declared: they count as one.
const PROJECT_DEPENDENT = ['crash-fuzz', 'unused-dependency-proof']
// Declared counts that the fixture cannot show, because the fixture runs with smaller budgets or the check has none; the code computes them.
const FROM_CODE: Record<string, number> = {
  'tz-locale-matrix': tzLocaleVariants().length,
  'test-order-independence': 1 + orderVariants('vitest', ['npm', 'test'], { runs: 2 }).length,
  'mutation-testing': (() => {
    const lines: string[] = []
    report({ status: 'ok', noChanged: true, base: { how: 'test' } }, (l: string) => lines.push(l))
    return new Set(lines.filter((l) => l.startsWith('MEERKAT-SUB ')).map((l) => l.split(' ')[2])).size
  })(),
}

describe('declared sub-check counts equal the rules each check prints', () => {
  const declared = checks.filter((c) => c.subs !== undefined)

  test('there are declared checks to audit, and every declared number is a whole number', () => {
    expect(declared.length).toBeGreaterThan(30)
    for (const c of declared) expect(Number.isInteger(c.subs) && (c.subs as number) >= 1, c.id).toBe(true)
  })

  test.each(declared.filter((c) => !(c.id in FROM_CODE)).map((c) => [c.id, c] as const))('%s prints exactly its declared rules on its fixture', async (_id, c) => {
    const onFixture = await ruleIds(c.selfTest)
    // A check with no fixture (test-to-code-ratio) is proved by its run on an empty folder instead.
    const seen = c.selfTest ? onFixture : await ruleIds(c.run)
    expect([...seen].sort(), `${c.id} declares ${c.subs} but prints ${seen.size}`).toHaveLength(c.subs as number)
  }, 240_000)

  test.each(Object.entries(FROM_CODE))('%s declares the number its code computes (%i)', (id, n) => {
    expect(checks.find((c) => c.id === id)?.subs).toBe(n)
  })

  test('checks whose rules depend on the project declare none, so they count as one', () => {
    for (const id of PROJECT_DEPENDENT) expect(checks.find((c) => c.id === id)?.subs, id).toBeUndefined()
  })

  test('a check that declares no rules prints at most one, on an empty folder and on its fixture', async () => {
    const undeclared = checks.filter((c) => c.subs === undefined && !PROJECT_DEPENDENT.includes(c.id) && c.run?.cmd === 'node' && String(c.run.args?.[0]).includes('thorough'))
    expect(undeclared.length).toBeGreaterThan(100)
    const bad: string[] = []
    let next = 0
    const worker = async () => {
      while (next < undeclared.length) {
        const c = undeclared[next++]
        const ids = new Set([...(await ruleIds(c.run, 60_000)), ...(await ruleIds(c.selfTest, 60_000))])
        if (ids.size > 1) bad.push(`${c.id} prints ${ids.size} rules (${[...ids].join(', ')}) but declares none`)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    expect(bad).toEqual([])
  }, 600_000)
})

// The totals the way the documents must show them, added up from the checks without using the generators.
const suiteOf = (c: Check) => suiteIdOf(c)
const expected = {
  checks: checks.length,
  suites: new Set(checks.map(suiteOf)).size,
  subs: checks.reduce((n, c) => n + declaredSubs(c), 0),
  packs: packs.length,
  quick: checks.filter((c) => c.tier === 'fast').length,
  thorough: checks.filter((c) => c.tier === 'thorough').length,
  optIn: checks.filter((c) => c.optIn).length,
}
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n')
const between = (text: string, a: string, b: string) => text.slice(text.indexOf(a) + a.length, text.indexOf(b))

describe('the counts in the generated documents equal the checks', () => {
  test('docs/checks.md headline: checks, suites, sub-checks, packs, tiers', () => {
    const head = between(read('docs/checks.md'), '<!-- checks:start -->', '## Suites').trim().split('\n')[0]
    expect(head).toContain(`**${expected.checks} checks** in ${expected.suites} suites with ${expected.subs} sub-checks`)
    expect(head).toContain(`across ${expected.packs} packs: ${expected.quick} quick, ${expected.thorough} thorough, ${expected.optIn} opt-in`)
  })

  test('docs/checks.md suite table: every suite row has the right number of checks and sub-checks, and the rows add up to the headline', () => {
    const rows = [...read('docs/checks.md').matchAll(/^\| `([a-z0-9-]+)` \| [^|]+ \| (\d+) \| (\d+) \|/gm)].map((m) => ({ id: m[1], checks: Number(m[2]), subs: Number(m[3]) }))
    const groups = groupBySuite(checks) as { id: string; checks: Check[] }[]
    expect(rows.map((r) => r.id)).toEqual(groups.map((g) => g.id))
    for (const g of groups) {
      const row = rows.find((r) => r.id === g.id)
      expect(row?.checks, `${g.id} checks`).toBe(g.checks.length)
      expect(row?.subs, `${g.id} sub-checks`).toBe(g.checks.reduce((n, c) => n + declaredSubs(c), 0))
    }
    expect(rows.reduce((n, r) => n + r.checks, 0)).toBe(expected.checks)
    expect(rows.reduce((n, r) => n + r.subs, 0)).toBe(expected.subs)
  })

  test('docs/checks.md kind sections list every check once', () => {
    const text = read('docs/checks.md')
    const listed = [...text.matchAll(/^\| `([a-z0-9-]+)` \| (?:fast|thorough) \|/gm)].map((m) => m[1])
    expect(listed).toHaveLength(expected.checks)
    expect(new Set(listed).size).toBe(expected.checks)
    const kinds = [...text.matchAll(/^## (\w+) checks\n\n.*? (\d+) checks\.$/gm)].reduce((n, m) => n + Number(m[2]), 0)
    expect(kinds).toBe(expected.checks)
  })

  test('the README counts line', () => {
    const block = between(read('README.md'), '<!-- counts:start -->', '<!-- counts:end -->')
    expect(block).toContain(`**${expected.checks} checks · ${expected.subs} sub-checks · ${expected.suites} suites.**`)
  })

  test('docs/coverage.md headline and suite table', () => {
    const text = read('docs/coverage.md')
    expect(text).toContain(`Counted from all ${expected.packs} packs under \`packs/\`: **${expected.checks} checks** in **${expected.suites} suites** with **${expected.subs} rules** (sub-checks).`)
    const rows = [...between(text, '<!-- coverage:start -->', '<!-- coverage:end -->').matchAll(/^\| `([a-z0-9-]+)` \| .* \| (\d+) \| (\d+) \| [^|]+ \| [^|]+ \|$/gm)].map((m) => ({ id: m[1], checks: Number(m[2]), subs: Number(m[3]) }))
    expect(rows.reduce((n, r) => n + r.checks, 0)).toBe(expected.checks)
    expect(rows.reduce((n, r) => n + r.subs, 0)).toBe(expected.subs)
  })
})

describe('no hand-written page types a count', () => {
  const GENERATED = [/<!-- checks:start -->[\s\S]*?<!-- checks:end -->/g, /<!-- counts:start -->[\s\S]*?<!-- counts:end -->/g, /<!-- coverage:start -->[\s\S]*?<!-- coverage:end -->/g, /<!-- coverage-lang:start -->[\s\S]*?<!-- coverage-lang:end -->/g]
  // A dated record of one run (not a claim about what Meerkat ships) may keep its figures.
  const DATED = /^## Last run \(\d{4}-\d{2}-\d{2}\)/
  // A limit ("at most 2000 rules", "above 24 checks") is a rule of the tool, not a count of what ships.
  const COUNT = /(?<!\b(?:at most|at least|above|over|under|more than|fewer than|up to|than) )\b\d[\d,]*\+? (checks|sub-checks|rules|suites|packs)\b/g
  const files = ['README.md', 'CONTRIBUTING.md', 'llms.txt', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]

  test.each(files.map((f) => [f] as const))('%s', (f) => {
    let text = read(f)
    for (const re of GENERATED) text = text.replace(re, '')
    let dated = false
    const hits: string[] = []
    for (const line of text.split('\n')) {
      if (/^#{1,6} /.test(line)) dated = DATED.test(line)
      if (!dated && COUNT.test(line)) hits.push(line.slice(0, 120))
      COUNT.lastIndex = 0
    }
    expect(hits, `${f} types a count by hand: point at docs/checks.md instead`).toEqual([])
  })
})
