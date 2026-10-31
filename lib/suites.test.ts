// Suites and sub-checks: the registry and its coverage, the MEERKAT-SUB protocol (parser, runner, exit-vs-sub rule), the roll-up, selection
// (`check <suite>`, `suite/check`, `suite/check/sub`), the config switches, the menu's two-level picker and the suite grouping of board and report.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyConfig, readConfig } from './config.mjs'
import { planCommand } from './cli.mjs'
import { runCommand } from './exec.mjs'
import { loadChecks, validateCheck } from './load-checks.mjs'
import { applySuiteTicks, initialState, menuStep, parseSuiteRows, renderPicker, suiteCheckItems, suitePickerItems } from './menu.mjs'
import { finalReport } from './report.mjs'
import { writeRunReport } from './runlog.mjs'
import { runOne, selectChecks, table } from './runner.mjs'
import { createSubCollector, enrichResults, judge, MAX_REASON, narrowSubs, normaliseSubs, parseSubLine, rollup, subCounts, subSummaryText, suiteRollup } from './subchecks.mjs'
import { CHECK_SUITE, PACK_SUITE, parseRef, parseSubRef, resolveOnly, SUITE_CATEGORIES, SUITE_IDS, SUITES, suiteIdOf, suiteOf } from './suites.mjs'
import { suiteList, suiteListText, suiteShow } from './suitelist.mjs'
import { groupRows } from './tui/group.mjs'
import { MEERKAT_DIR } from './paths.mjs'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-suites-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const packs = readdirSync(join(MEERKAT_DIR, 'packs'))
async function everyCheck() {
  const out: any[] = []
  for (const p of packs) for (const c of await loadChecks(join(MEERKAT_DIR, 'packs', p))) out.push({ ...c, source: `pack ${p}` })
  return out
}
const script = (body: string) => {
  const file = join(dir, `child-${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, body)
  return file
}
const ctxFor = (extra = {}) => ({ repoRoot: dir, appDir: dir, env: process.env, platform: process.platform, exists: () => true, changedFiles: [], ...extra })
const checkOf = (file: string, id = 'scan', extra = {}) => ({ id, title: id, lane: 'free', group: 'functionality', tier: 'fast', run: { cmd: process.execPath, args: [file], cwd: 'repo' }, ...extra })

describe('the suite registry', () => {
  test('there are 40 to 60 suites, each with a label, a purpose and a known category', () => {
    expect(SUITES.length).toBeGreaterThanOrEqual(40)
    expect(SUITES.length).toBeLessThanOrEqual(60)
    expect(new Set(SUITE_IDS).size).toBe(SUITE_IDS.length)
    for (const s of SUITES) {
      expect(s.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(s.label.length).toBeGreaterThan(1)
      expect(s.purpose.length).toBeGreaterThan(10)
      expect(Object.keys(SUITE_CATEGORIES)).toContain(s.category)
    }
  })

  test('every check of every bundled pack lands in a suite, by its id or by its pack', async () => {
    const all = await everyCheck()
    expect(all.length).toBeGreaterThan(200)
    for (const c of all) {
      const id = suiteOf(c)
      expect(id, `${c.id} (pack ${c.source}) has no suite`).not.toBeNull()
      expect(SUITE_IDS).toContain(id)
    }
    // A suite is never empty, except the catch-all "other".
    const used = new Set(all.map((c) => suiteOf(c)))
    for (const id of SUITE_IDS) if (id !== 'other') expect(used.has(id), `suite ${id} holds no check`).toBe(true)
  })

  test('a new check of a pack falls into that pack\'s suite, an unknown one into "other", and a suite id never equals a check id', async () => {
    expect(suiteOf({ id: 'brand-new-check', source: 'pack rust' })).toBe('rust')
    expect(suiteOf({ id: 'brand-new-check', pack: 'web-plus' })).toBe('html-and-css')
    expect(suiteOf({ id: 'brand-new-check', source: 'mine.mjs' })).toBeNull()
    expect(suiteIdOf({ id: 'brand-new-check', source: 'mine.mjs' })).toBe('other')
    expect(suiteOf({ id: 'secret-scan', suite: 'rust' })).toBe('rust')
    const ids = new Set((await everyCheck()).map((c) => c.id))
    for (const s of SUITE_IDS) expect(ids.has(s), `suite ${s} has the id of a check`).toBe(false)
    for (const s of Object.values(CHECK_SUITE).concat(Object.values(PACK_SUITE))) expect(SUITE_IDS).toContain(s)
    for (const p of packs) expect(Object.keys(PACK_SUITE), `pack ${p} has no default suite`).toContain(p)
  })

  test('check fields subs and suite are validated', () => {
    const base = { id: 'x', group: 'security', tier: 'fast', lane: 'free', title: 'X', run: { cmd: 'node' } }
    expect(validateCheck({ ...base, subs: 12 })).toBeNull()
    expect(validateCheck({ ...base, subs: 0 })).toMatch(/subs/)
    expect(validateCheck({ ...base, subs: 501 })).toMatch(/subs/)
    expect(validateCheck({ ...base, subs: 1.5 })).toMatch(/subs/)
    expect(validateCheck({ ...base, suite: 'Not Kebab' })).toMatch(/suite/)
  })
})

describe('the MEERKAT-SUB line parser', () => {
  test('accepts the exact format', () => {
    expect(parseSubLine('MEERKAT-SUB PASS aws-access-key none found')).toEqual({ status: 'PASS', id: 'aws-access-key', reason: 'none found' })
    expect(parseSubLine('MEERKAT-SUB FAIL r1 bad thing\r')).toEqual({ status: 'FAIL', id: 'r1', reason: 'bad thing' })
    expect(parseSubLine('MEERKAT-SUB NA docker-pinned no Dockerfile here')).toEqual({ status: 'NA', id: 'docker-pinned', reason: 'no Dockerfile here' })
    expect(parseSubLine('MEERKAT-SUB PASS bare')).toEqual({ status: 'PASS', id: 'bare', reason: '' })
  })

  test('rejects every other line', () => {
    const bad = ['MEERKAT-SUB MAYBE a b', 'MEERKAT-SUB pass a b', 'MEERKAT-SUB PASS Bad_Id x', 'MEERKAT-SUB PASS -a x', `MEERKAT-SUB PASS ${'a'.repeat(62)} x`, 'MEERKAT-SUB PASS', 'MEERKAT-SUB  PASS a b', ' MEERKAT-SUB PASS a b', 'xMEERKAT-SUB PASS a b', 'MEERKAT-SUBS PASS a b', 'meerkat-sub PASS a b']
    for (const line of bad) expect(parseSubLine(line), line).toBeNull()
    expect(parseSubLine(`MEERKAT-SUB PASS ${'a'.repeat(61)} x`)).not.toBeNull()
  })

  test('removes control characters and caps the reason at 200 characters', () => {
    expect(parseSubLine('MEERKAT-SUB FAIL r \u001b[31mred\u0007 text\tand tab')?.reason).toBe('[31mred text and tab')
    expect(parseSubLine(`MEERKAT-SUB FAIL r ${'y'.repeat(500)}`)?.reason).toHaveLength(MAX_REASON)
  })

  test('the collector keeps the first line of each rule and stops at the cap', () => {
    const c = createSubCollector(3)
    for (const l of ['MEERKAT-SUB PASS a one', 'MEERKAT-SUB FAIL a two', 'garbage', 'MEERKAT-SUB PASS b', 'MEERKAT-SUB PASS c', 'MEERKAT-SUB PASS d']) c.add(l)
    expect(c.subs.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(c.subs[0].reason).toBe('one')
    expect(c.dropped).toBe(3)
  })

  test('the default cap is 2000 sub-checks per check', () => {
    const list = Array.from({ length: 2300 }, (_, i) => ({ id: `rule-${i}`, status: 'PASS' }))
    expect(normaliseSubs(list)).toHaveLength(2000)
  })
})

describe('the runner takes the sub lines out of the output', () => {
  test('across chunk boundaries, stdout only, never in the output, invalid ones dropped', async () => {
    const f = script(`
      const w = (s) => new Promise((r) => process.stdout.write(s, r))
      await w('hello\\nMEERKAT-SU')
      await new Promise((r) => setTimeout(r, 40))
      await w('B PASS rule-a fine\\nMEERKAT-SUB FAIL rule-b bad\\u0007thing\\nMEERKAT-SUB MAYBE x y\\nMEERKAT-SUBX\\nMEERKAT-SUB PASS Bad_ID x\\nMEERKAT-SUB NA rule-c\\nMEERKAT-S')
      await new Promise((r) => setTimeout(r, 40))
      await w('UB PASS rule-d late\\nbye\\n')
      process.stderr.write('MEERKAT-SUB PASS on-stderr ignored\\n')
    `)
    const lines: string[] = []
    const r = await runCommand({ cmd: process.execPath, args: [f], cwd: dir, onLine: (l: string) => lines.push(l) })
    expect(r.subs.map((x: any) => x.id)).toEqual(['rule-a', 'rule-b', 'rule-c', 'rule-d'])
    expect(r.subs[1]).toEqual({ status: 'FAIL', id: 'rule-b', reason: 'badthing' })
    expect(r.subsDropped).toBe(3)
    expect(r.output).not.toMatch(/MEERKAT-SUB (PASS|FAIL|NA) rule/)
    expect(r.output).toContain('hello\nbye\n')
    expect(r.output).toContain('MEERKAT-SUB PASS on-stderr ignored')
    expect(lines.join('\n')).not.toContain('rule-a')
  })

  test('ordinary output with a half line starting like the protocol is kept whole', async () => {
    const r = await runCommand({ cmd: process.execPath, args: [script(`process.stdout.write('MEERKAT-SUB')`)], cwd: dir })
    expect(r.output).toBe('MEERKAT-SUB')
    expect(r.subs).toEqual([])
  })
})

describe('exit code and sub lines decide a check together', () => {
  const run = (body: string, extra: Record<string, unknown> = {}, ctx = {}) => runOne(checkOf(script(body), 'scan', extra) as never, ctxFor({ logDir: join(dir, 'logs'), ...ctx })) as Promise<any>
  beforeEach(() => mkdirSync(join(dir, 'logs'), { recursive: true }))

  test('exit 0 with a FAIL sub line is a FAIL: a script lying is a bug', async () => {
    const r = await run(`console.log('MEERKAT-SUB PASS ok-rule fine'); console.log('MEERKAT-SUB FAIL bad-rule it is bad'); process.exit(0)`)
    expect(r.status).toBe('FAIL')
    expect(r.detail).toMatch(/^sub-check bad-rule failed/)
    expect(r).toMatchObject({ subTotal: 2, subPass: 1, subFail: 1, subNa: 0 })
    expect(r.outputFile).toBeTruthy()
  })

  test('exit 1 with no FAIL sub line stays a FAIL with the exit code\'s reason', async () => {
    const r = await run(`console.log('MEERKAT-SUB PASS a ok'); console.log('crashed somewhere'); process.exit(1)`)
    expect(r.status).toBe('FAIL')
    expect(r.detail).toContain('crashed somewhere')
    expect(r.subPass).toBe(1)
  })

  test('exit 1 with a FAIL sub line shows the rule as the reason', async () => {
    const r = await run(`console.log('MEERKAT-SUB FAIL aws-access-key AKIA found in a.js'); console.log('1 problem'); process.exit(1)`)
    expect(r.status).toBe('FAIL')
    expect(r.detail).toMatch(/^sub-check aws-access-key failed: AKIA found in a\.js/)
  })

  test('exit 0 and only PASS and NA lines passes; NA is not a failure', async () => {
    const r = await run(`console.log('MEERKAT-SUB PASS a'); console.log('MEERKAT-SUB NA b no Dockerfile'); console.log('MEERKAT-SUB NA c')`)
    expect(r.status).toBe('PASS')
    expect(r).toMatchObject({ subTotal: 3, subPass: 1, subFail: 0, subNa: 2 })
  })

  test('the sub lines are written to the check\'s log under --- sub-checks --- and not into its output', async () => {
    const r = await run(`console.log('visible'); console.log('MEERKAT-SUB FAIL x boom'); process.exit(1)`)
    const log = readFileSync(r.logFile, 'utf8')
    const at = log.indexOf('--- output ---')
    const sub = log.indexOf('--- sub-checks ---')
    expect(at).toBeGreaterThan(0)
    expect(sub).toBeGreaterThan(at)
    expect(log.slice(at, sub)).not.toContain('MEERKAT-SUB')
    expect(log.slice(sub)).toContain('FAIL x  boom')
  })

  test('a rule turned off in the config is left out, and a check whose only failing rules are turned off passes', async () => {
    const body = `console.log('MEERKAT-SUB PASS a'); console.log('MEERKAT-SUB FAIL b nope'); process.exit(1)`
    const r = await run(body, {}, { disabledSubs: new Map([['scan', new Set(['b'])]]) })
    expect(r.status).toBe('PASS')
    expect(r.subTotal).toBe(1)
    expect(r.detail).toMatch(/turned off/)
    const still = await run(`console.log('MEERKAT-SUB FAIL b nope'); console.log('MEERKAT-SUB FAIL c nope too'); process.exit(1)`, {}, { disabledSubs: new Map([['scan', new Set(['b'])]]) })
    expect(still.status).toBe('FAIL')
    expect(still.detail).toMatch(/sub-check c failed/)
  })

  test('a function check can return subs, judged the same way', async () => {
    const fn = { id: 'fn', title: 'fn', lane: 'free', group: 'functionality', tier: 'fast', run: () => ({ ok: true, detail: 'fine', subs: [{ id: 'one', status: 'PASS' }, { id: 'two', status: 'FAIL', reason: 'no' }] }) }
    const r: any = await runOne(fn as never, ctxFor())
    expect(r.status).toBe('FAIL')
    expect(r.detail).toBe('sub-check two failed')
  })

  test('judge() on its own', () => {
    const subs = [{ id: 'a', status: 'FAIL', reason: 'r' }]
    expect(judge({ subs, code: 0 }).status).toBe('FAIL')
    expect(judge({ subs, code: 1 }).status).toBeNull()
    expect(judge({ subs: [{ id: 'a', status: 'PASS', reason: '' }], code: 1 }).status).toBeNull()
    expect(judge({ subs, code: 1, disabled: new Set(['a']) }).status).toBe('PASS')
  })
})

describe('the roll-up', () => {
  const results = [
    { id: 'a', status: 'PASS', ms: 1000, subs: [{ id: 'r1', status: 'PASS', reason: '' }, { id: 'r2', status: 'NA', reason: 'n/a' }, { id: 'r3', status: 'PASS', reason: '' }] },
    { id: 'b', status: 'FAIL', ms: 2000, subs: [{ id: 'r1', status: 'FAIL', reason: 'bad' }] },
    { id: 'c', status: 'PASS', ms: 10 },
    { id: 'd', status: 'NOT RUN', ms: 0, detail: 'missing tool' },
  ]
  test('a check with no sub lines is one sub-check; NA never counts as a failure', () => {
    expect(subCounts(results[0])).toEqual({ total: 3, pass: 2, fail: 0, na: 1 })
    expect(subCounts(results[2])).toEqual({ total: 1, pass: 1, fail: 0, na: 0 })
    expect(subCounts(results[3])).toEqual({ total: 1, pass: 0, fail: 0, na: 1 })
    const t = rollup(results)
    expect(t).toMatchObject({ total: 6, pass: 3, fail: 1, na: 2, withSubs: 2 })
    expect(t.pass + t.fail + t.na).toBe(t.total)
  })

  test('the SUMMARY line names the sub-checks only when some check reported them', () => {
    expect(subSummaryText(results)).toBe('6 sub-checks: 3 passed, 1 failed, 2 not applicable here')
    expect(subSummaryText([{ id: 'x', status: 'PASS' }])).toBe('')
    const lines = finalReport({ results, tier: 'fast', totalMs: 41000 })
    expect(lines.find((l: string) => l.startsWith('SUMMARY'))).toBe('SUMMARY [ 0:41 ] 4 checks (6 sub-checks: 3 passed, 1 failed, 2 not applicable here): 2 passed, 1 failed, 1 not run')
    expect(lines.join('\n')).toContain('sub-check r1: bad')
    expect(finalReport({ results: [{ id: 'x', status: 'PASS', ms: 5 }], tier: 'fast', totalMs: 1000 })[1]).toBe('SUMMARY [ 1.0s ] 1 checks: 1 passed, 0 failed, 0 not run')
  })

  test('enrichResults adds suite and counts; suiteRollup lists every failing sub-check', () => {
    const checks = [{ id: 'secret-scan' }, { id: 'eslint', source: 'pack node' }]
    const full = enrichResults([{ id: 'secret-scan', status: 'FAIL', ms: 1, subs: [{ id: 'aws', status: 'FAIL', reason: 'key' }] }, { id: 'eslint', status: 'PASS', ms: 1 }], checks)
    expect(full[0]).toMatchObject({ suite: 'secrets', subTotal: 1, subFail: 1 })
    expect(full[1]).toMatchObject({ suite: 'node', subTotal: 1, subPass: 1, subs: [] })
    const rows = suiteRollup(full)
    expect(rows[0]).toMatchObject({ id: 'secrets', checks: 1, subFail: 1, failedSubs: [{ check: 'secret-scan', id: 'aws', reason: 'key' }] })
  })

  test('summary.json, report.md and timeline.jsonl carry suites and sub-checks', () => {
    const full = enrichResults(results, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    const runDir = join(dir, 'run')
    mkdirSync(runDir)
    const recorder = { events: [{ t: 1000, event: 'start', id: 'a', lane: 'free' }, { t: 2000, event: 'end', id: 'a', status: 'PASS', ms: 1000, subs: { total: 3, pass: 2, fail: 0, na: 1 } }], waits: new Map() }
    const report = writeRunReport({ dir: runDir, tier: 'fast', results: full, line: 'MEERKAT fast', exitCode: 1, ms: 5000, env: { MEERKAT_LOG_DIR: dir }, recorder })
    const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
    expect(summary.subTotals).toMatchObject({ total: 6, pass: 3, fail: 1, na: 2 })
    expect(summary.results[0]).toMatchObject({ suite: 'other', subTotal: 3, subs: expect.any(Array) })
    expect(summary.suites[0]).toHaveProperty('failedSubs')
    expect(report).toContain('## Suites')
    expect(report).toContain('### Failed sub-checks')
    expect(report).toContain('other/b/r1: bad')
    const timeline = readFileSync(join(runDir, 'timeline.jsonl'), 'utf8')
    expect(timeline).toContain('"subs":{"total":3')
  })
})

describe('selection', () => {
  const checks = [
    { id: 'secret-scan', source: 'pack security', group: 'security', tier: 'fast', lane: 'free', title: 's' },
    { id: 'sensitive-files', source: 'pack hygiene', group: 'security', tier: 'fast', lane: 'free', title: 's' },
    { id: 'eslint', source: 'pack node', group: 'functionality', tier: 'fast', lane: 'free', title: 'e' },
    { id: 'ai-diff-review', source: 'pack ai', group: 'security', tier: 'thorough', lane: 'free', title: 'a', optIn: 'ai' },
  ]
  const ids = (r: any) => r.run.map((c: any) => c.id).sort()

  test('a suite name runs every check of the suite; opt-in ones only when included', () => {
    expect(ids(selectChecks(checks as never, { tier: 'fast', only: ['secrets'], mode: 'all' }))).toEqual(['secret-scan', 'sensitive-files'])
    expect(ids(selectChecks(checks as never, { tier: 'fast', only: [], suites: ['ai-review'], mode: 'all' }))).toEqual([])
    expect(ids(selectChecks(checks as never, { tier: 'fast', only: [], suites: ['ai-review'], include: ['ai'], mode: 'all' }))).toEqual(['ai-diff-review'])
  })

  test('suite/check runs one check and must name its own suite; a plain id still works', () => {
    expect(ids(selectChecks(checks as never, { tier: 'fast', only: ['secrets/secret-scan'], mode: 'all' }))).toEqual(['secret-scan'])
    const wrong = selectChecks(checks as never, { tier: 'fast', only: ['node/secret-scan', 'eslint'], mode: 'all' })
    expect(ids(wrong)).toEqual(['eslint'])
    expect(wrong.unmatched).toEqual(['node/secret-scan'])
  })

  test('suite/check/sub runs the parent check and remembers the one sub-check to report', () => {
    const r = selectChecks(checks as never, { tier: 'fast', only: ['secrets/secret-scan/aws-access-key'], mode: 'all' })
    expect(ids(r)).toEqual(['secret-scan'])
    expect([...r.subOnly.get('secret-scan')]).toEqual(['aws-access-key'])
    // asked for whole as well: the whole check wins
    expect(resolveOnly(checks as never, ['secrets/secret-scan/a', 'secret-scan']).subOnly.size).toBe(0)
    const results = narrowSubs(
      [{ id: 'secret-scan', status: 'PASS', subs: [{ id: 'aws-access-key', status: 'PASS', reason: '' }, { id: 'other-rule', status: 'FAIL', reason: 'x' }] }],
      r.subOnly,
    ) as any[]
    expect(results[0].subs.map((x: any) => x.id)).toEqual(['aws-access-key'])
    expect(results[0]).toMatchObject({ subTotal: 1, subFail: 0 })
    const missing = narrowSubs([{ id: 'secret-scan', status: 'PASS' }], r.subOnly) as any[]
    expect(missing[0].subs[0]).toMatchObject({ id: 'aws-access-key', status: 'NA' })
  })

  test('parseRef and parseSubRef', () => {
    expect(parseRef('secrets/secret-scan/aws')).toEqual({ suite: 'secrets', check: 'secret-scan', sub: 'aws' })
    expect(parseRef('./some/folder')).toBeNull()
    expect(parseRef('src/lib')).toBeNull()
    expect(parseSubRef('secret-scan/aws')).toEqual({ check: 'secret-scan', sub: 'aws' })
    expect(parseSubRef('secrets/secret-scan/aws')).toMatchObject({ check: 'secret-scan', sub: 'aws' })
    expect(parseSubRef('nope/secret-scan/aws')).toBeNull()
    expect(parseSubRef('a')).toBeNull()
  })

  test('the command line: meerkat check <suite>, suite/check and a folder after them', () => {
    const cwd = resolve('/work/app')
    const plan = (argv: string[]) => planCommand(argv, { cwd, env: {}, interactive: false, presets: { user: {}, project: {} } }) as any
    expect(plan(['check', 'secrets'])).toMatchObject({ kind: 'run', checks: ['secrets'] })
    expect(plan(['check', 'secrets']).args).toEqual(expect.arrayContaining(['--only', 'secrets', '--all']))
    expect(plan(['check', 'secrets/secret-scan']).args).toEqual(expect.arrayContaining(['--only', 'secrets/secret-scan']))
    const withFolder = plan(['check', 'secrets/secret-scan/aws-access-key', 'web-security', '../other'])
    expect(withFolder.folder).toBe(resolve(cwd, '../other'))
    expect(withFolder.checks).toEqual(['secrets/secret-scan/aws-access-key', 'web-security'])
    expect(plan(['check', '--suite', 'secrets', 'eslint']).args).toEqual(expect.arrayContaining(['--suite', 'secrets']))
    expect(plan(['suite', 'list'])).toMatchObject({ kind: 'noun', noun: 'suite', verb: 'list' })
    expect(plan(['suite', 'show', 'secrets'])).toMatchObject({ noun: 'suite', verb: 'show', name: 'secrets' })
    expect(plan(['suite', 'show', 'nope'])).toMatchObject({ kind: 'error' })
    expect(plan(['suite', 'show'])).toMatchObject({ kind: 'error' })
    expect(plan(['check', 'list', '--flat']).flags).toMatchObject({ flat: true })
  })
})

describe('config: turning off a suite or a sub-check', () => {
  test('readConfig keeps "suite:<name>" in disable and validates disableSubs', () => {
    const file = join(dir, 'meerkat.config.json')
    writeFileSync(file, JSON.stringify({ disable: ['eslint', 'suite:web-security', 'suite:Bad Name'], disableSubs: ['secret-scan/aws-access-key', 'secrets/secret-scan/jwt', 'nonsense', 'Bad/Case'] }))
    const { config, notes } = readConfig(file)
    expect(config.disable).toEqual(['eslint', 'suite:web-security'])
    expect(config.disableSubs).toEqual(['secret-scan/aws-access-key', 'secret-scan/jwt'])
    expect(notes.join('\n')).toMatch(/Bad Name/)
    expect(notes.join('\n')).toMatch(/nonsense/)
    writeFileSync(file, JSON.stringify({ disableSubs: 'secret-scan/x' }))
    expect(readConfig(file).notes.join('\n')).toMatch(/disableSubs/)
  })

  test('applyConfig removes the checks of a disabled suite, lists them, and validates sub-checks against the loaded checks', async () => {
    const config = { packs: ['security', 'node'], extraChecks: [], disable: ['suite:secrets', 'suite:no-such-suite'], disableSubs: ['secret-scan/aws-access-key', 'ghost-check/x'], override: {}, budget: null, presets: {} }
    const r = await applyConfig([], config, { load: loadChecks })
    const have = r.checks.map((c: any) => c.id)
    expect(have).not.toContain('secret-scan')
    expect(have).toContain('risky-code')
    expect(have).toContain('eslint')
    expect(r.disabled.find((d: any) => d.id === 'secret-scan')).toMatchObject({ by: 'suite:secrets' })
    expect(r.disabledSubs).toEqual(['secret-scan/aws-access-key'])
    expect(r.notes.join('\n')).toMatch(/no such suite/)
    expect(r.notes.join('\n')).toMatch(/ghost-check/)
  })
})

describe('the menu\'s two-level picker', () => {
  const rows = [
    { id: 'secret-scan', suite: 'secrets', title: 'Secrets', subs: 5 },
    { id: 'sensitive-files', suite: 'secrets', title: 'Sensitive files' },
    { id: 'eslint', suite: 'node', title: 'ESLint' },
  ]

  test('about fifty rows instead of hundreds: one per suite, under its category, with counts and a purpose', () => {
    const items = suitePickerItems(rows)
    const suites = items.filter((i: any) => i.kind === 'item')
    expect(suites.map((i: any) => i.value)).toEqual(['secrets', 'node'])
    expect(suites[0].label).toContain('2 checks, 6 sub-checks')
    expect(suites[0].about.length).toBeGreaterThan(10)
    expect(items.filter((i: any) => i.kind === 'heading').length).toBeGreaterThan(0)
    expect(parseSuiteRows(JSON.stringify(rows))).toHaveLength(3)
    expect(parseSuiteRows('not json')).toEqual([])
  })

  test('Space ticks a whole suite, Right opens it, Enter returns suite names and suite/check pairs', () => {
    let state: any = initialState(suitePickerItems(rows), { multi: true })
    const node = state.items.findIndex((i: any) => i.value === 'node')
    state = { ...state, cursor: state.items.findIndex((i: any) => i.value === 'secrets') }
    let r = menuStep(state, 'right') as any
    expect(r.action).toMatchObject({ type: 'open' })
    expect(r.action.item.value).toBe('secrets')
    // tick one check inside: partly ticked
    const level2 = suiteCheckItems(r.action.item, rows)
    expect(level2.map((i: any) => i.value)).toEqual(['secrets/secret-scan', 'secrets/sensitive-files'])
    const partial = applySuiteTicks(r.action.item, ['secrets/sensitive-files'], level2.map((i: any) => i.value))
    expect(partial).toMatchObject({ checked: false, partialValues: ['secrets/sensitive-files'] })
    state = { ...state, items: state.items.map((i: any) => (i.value === 'secrets' ? partial : i)), cursor: node }
    expect(renderPicker(state, { title: 't', question: 'q', hint: 'h', maxRows: 20, width: 100 }).map((l: any) => l.text).join('\n')).toContain('[~] Secrets')
    r = menuStep(state, 'space') as any
    r = menuStep(r.state, 'enter') as any
    expect(r.action).toEqual({ type: 'submit', values: ['secrets/sensitive-files', 'node'] })
    // Space on the partly ticked suite ticks all of it
    const all = menuStep({ ...state, cursor: state.items.findIndex((i: any) => i.value === 'secrets') }, 'space') as any
    expect(all.state.items.find((i: any) => i.value === 'secrets')).toMatchObject({ checked: true })
    expect(all.state.items.find((i: any) => i.value === 'secrets').partialValues).toBeUndefined()
    expect(applySuiteTicks(partial, level2.map((i: any) => i.value), level2.map((i: any) => i.value))).toMatchObject({ checked: true })
    expect(applySuiteTicks(partial, [], ['a'])).toMatchObject({ checked: false })
  })

  test('Right does nothing on a flat list, so the old picker keeps its keys', () => {
    const state: any = initialState([{ kind: 'item', label: 'a', value: 'a', checked: false }], { multi: true })
    expect(menuStep(state, 'right').action).toBeNull()
  })
})

describe('suite grouping of the board and the end report', () => {
  const many = (suiteOfI: (i: number) => string | undefined) =>
    Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, status: i === 3 ? 'FAIL' : 'PASS', group: 'security', suite: suiteOfI(i), declaredSubs: 4, ms: 10 }))

  test('rows with suites fold by suite (label from the registry); without suite data the kind grouping stays', () => {
    const cats = groupRows(many((i) => (i < 10 ? 'secrets' : i < 20 ? 'node' : undefined)))!
    expect(cats.map((c: any) => c.label).sort()).toEqual(['Node and TypeScript tools', 'Other checks', 'Secrets'])
    const secrets: any = cats.find((c: any) => c.suite === 'secrets')
    expect(secrets).toMatchObject({ total: 10, subTotal: 40 })
    expect(cats[0].suite).toBe('secrets') // the one with a failure first
    expect(cats[0].open.map((r: any) => r.id)).toEqual(['c3'])
    const kinds = groupRows(many(() => undefined))!
    expect(kinds.map((c: any) => c.label)).toEqual(['Security'])
    expect(kinds[0].suite).toBeNull()
  })

  test('table() and the end report fold real checks by suite above 24 checks', async () => {
    const all = (await everyCheck()).slice(0, 40)
    const results = all.map((c: any, i: number) => ({ id: c.id, status: i === 1 ? 'FAIL' : 'PASS', ms: 5, detail: i === 1 ? 'broke' : '' }))
    const text = table(results as never, { checks: all })
    expect(text).toMatch(/\d+ checks, \d+ sub-checks/)
    const report = finalReport({ results, tier: 'fast', totalMs: 1000, checks: all }).join('\n')
    expect(report).toMatch(/SUITE {5}/)
    expect(report).not.toMatch(/KIND {6}/)
  })
})

describe('suite list and suite show', () => {
  test('the catalogue and what applies here are counted apart; a check that declares no rules counts as one', async () => {
    const all = await everyCheck()
    const project: any = { appDir: dir, checks: all.filter((c: any) => c.source === 'pack security'), disabled: [{ id: 'x', by: 'suite:rust' }] }
    const d = await suiteList(project, { env: { ...process.env } })
    expect(d.totals.checks.catalogue).toBe(all.length)
    expect(d.totals.checks.here).toBe(project.checks.length)
    expect(d.totals.subChecks.catalogue).toBeGreaterThanOrEqual(all.length)
    const secrets: any = d.suites.find((s: any) => s.id === 'secrets')
    expect(secrets.checks.here).toBeGreaterThan(0)
    expect(secrets.checks.catalogue).toBeGreaterThanOrEqual(secrets.checks.here)
    expect(d.suites.find((s: any) => s.id === 'rust')).toMatchObject({ disabled: true, checks: { here: 0 } })
    expect(suiteListText(d)).toContain('suites apply here')
    const show: any = await suiteShow('secrets', project, { env: { ...process.env } })
    expect(show.checks.map((c: any) => c.id)).toContain('secret-scan')
    expect(show.checks.find((c: any) => c.id === 'secret-scan').here).toBe(true)
    expect(show.subChecks).toBeGreaterThan(0)
    expect(existsSync(dir)).toBe(true)
  })
})
