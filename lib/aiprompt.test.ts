// The AI prompt (lib/aiprompt.mjs), `meerkat prompt`, full-length messages end to end, AI verification with a fake model, and run.log.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { buildAiPrompt, shortPromptText, writeAiPrompt } from './aiprompt.mjs'
// @ts-expect-error plain .mjs module
import { applyVerdicts, parseVerdict, planVerification, runVerification, verifyRunDir } from './aiverify.mjs'
// @ts-expect-error plain .mjs module
import { formatFindingLine, MAX_MESSAGE, parseFindingLine } from './findings.mjs'
// @ts-expect-error plain .mjs module
import { buildFindings, readFindings, saveFindings } from './findingsdoc.mjs'
// @ts-expect-error plain .mjs module
import { planCommand } from './cli.mjs'
// @ts-expect-error plain .mjs module
import { createPrompt } from './promptcmd.mjs'
// @ts-expect-error plain .mjs module
import { runLogText } from './runlog.mjs'
// @ts-expect-error plain .mjs module
import { commandHelp } from './help.mjs'

const made: string[] = []
const tmp = (p = 'meerkat-aiprompt-') => {
  const d = mkdtempSync(join(tmpdir(), p))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

const LONG = `start-${'long message part. '.repeat(160)}-END-MARK`
const mk = (over: any) => ({ id: 'aaaaaaaaaaaaaaaa', severity: 'medium', title: 'a title', message: 'a message', suite: 'risky-calls', check: 'risky', rule: 'eval-call', file: 'src/a.js', line: 2, column: null, detectedBy: { check: 'risky', checkTitle: 'Risky calls', pack: null, origin: 'bundled' }, fix: 'remove eval', explanation: 'The rule says: eval is risky.', confidence: 'high', occurrences: 1, lines: [2], logFile: 'C:/logs/risky.log', status: 'new', firstSeen: 'now', ...over })
const sample = () => {
  const findings = [
    mk({ id: '1111111111111111', severity: 'critical', message: 'a leaked key shaped value', suite: 'secrets', rule: 'key-shape' }),
    mk({ id: '2222222222222222', severity: 'high', message: LONG, fix: `fix-${'f'.repeat(1500)}` }),
    mk({ id: '3333333333333333', severity: 'low', message: 'tiny style point', evidence: 'var x = 1' }),
    mk({ id: '4444444444444444', severity: 'info', message: 'an info note' }),
    mk({ id: '5555555555555555', severity: 'medium', message: 'weak guess', confidence: 'low' }),
    mk({ id: '7777777777777777', severity: 'medium', message: 'a firm medium' }),
    mk({ id: '6666666666666666', severity: 'high', message: 'judged a false alarm', aiVerdict: 'probably false alarm', aiReason: 'the value is a test fixture' }),
  ]
  const doc = { schemaVersion: 1, meerkat: { version: '0.3.0' }, run: { id: '20261101-080000-demo-fast', dir: 'C:/logs/runs/20261101-080000-demo-fast', project: { name: 'demo', path: 'C:/projects/demo' }, preset: 'fast', tier: 'fast', startedAt: '2026-11-01T08:00:00.000Z', ms: 125000, machine: { os: 'test', node: 'v20' }, comparedWith: null }, counts: { total: findings.length, bySeverity: { critical: 1, high: 2, medium: 1, low: 1, info: 1 }, new: 6, known: 0, fixed: 0 }, findings, fixed: [], notRun: [{ check: 'e2e', title: 'End to end', reason: 'missing on PATH: playwright', install: 'npx playwright install' }] }
  const summary = { estimatedMs: 90000, counts: { pass: 3, fail: 2, notRun: 1 }, subTotals: { total: 10, pass: 8, fail: 2, na: 0 }, results: [{ id: 'lint', title: 'Lint', status: 'FAIL', detail: 'lint exploded', detailFull: `lint exploded ${'x'.repeat(900)}`, logFile: 'C:/logs/lint.log' }, { id: 'risky', status: 'FAIL', detail: 'x' }] }
  return { doc, summary }
}

describe('buildAiPrompt', () => {
  const { doc, summary } = sample()
  const text: string = buildAiPrompt({ doc, summary })
  test('says what Meerkat is, with the repository and NOT RUN explained', () => {
    expect(text).toContain('https://github.com/SamuelNDCE/Meerkat')
    expect(text).toContain('the repository README explains the tool')
    expect(text).toMatch(/NOT RUN means the check could not run/)
    expect(text).toMatch(/NOT a pass/)
  })
  test('has the run facts', () => {
    for (const s of ['project name (untrusted','folder: C:/projects/demo', 'preset / tier: fast', '2026-11-01T08:00:00.000Z', 'Meerkat version: 0.3.0', '2 min 5 s', 'estimated 1 min 30 s'.replace('estimated', 'Meerkat had estimated')]) expect(text).toContain(s)
  })
  test('golden: every finding is there in full, no message or fix is truncated', () => {
    for (const f of doc.findings) {
      expect(text).toContain(f.id)
      expect(text).toContain(f.message)
      expect(text).toContain(f.fix)
      expect(text).toContain(f.logFile)
      expect(text).toContain(`${f.file}:${f.line}`)
    }
    expect(text).toContain('var x = 1')
    expect(text).toContain('END-MARK')
  })
  test('sections come in the agreed order and severities are grouped', () => {
    const at = (s: string) => text.indexOf(s)
    const order = ['## 1. What Meerkat is', '## 2. This run', '## 3. How to read a finding', '## 4. The findings', '### CRITICAL', '### HIGH', '### MEDIUM', '### LOW', '### INFO', '## 5. Check these first', '## 6. Checks that failed but produced no findings', '## 7. NOT RUN', '## 8. What to do']
    const idx = order.map(at)
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
  test('doubtful findings (low confidence or judged a false alarm) are in their own section, not in the severity groups', () => {
    const firm = text.slice(text.indexOf('## 4.'), text.indexOf('## 5.'))
    const doubtful = text.slice(text.indexOf('## 5.'), text.indexOf('## 6.'))
    expect(firm).not.toContain('5555555555555555')
    expect(firm).not.toContain('6666666666666666')
    expect(doubtful).toContain('5555555555555555')
    expect(doubtful).toContain('6666666666666666')
    expect(doubtful).toContain('AI verification: probably false alarm')
    expect(doubtful).toContain('the value is a test fixture')
    expect(firm).toContain('3333333333333333')
  })
  test('failed checks with no findings and NOT RUN checks carry their reason and install command', () => {
    expect(text).toContain(`Lint: lint exploded ${'x'.repeat(900)}`)
    expect(text).toContain('End to end: missing on PATH: playwright')
    expect(text).toContain('npx playwright install')
  })
  test('tells the AI to verify, fix by severity, stay in scope and re-run', () => {
    for (const s of ['Read the code before changing anything', 'false positives', 'starting with the highest severity', 'Do not touch unrelated code', 'meerkat verify']) expect(text).toContain(s)
  })
  test('the clipboard line names the absolute path', () => {
    expect(shortPromptText('C:/logs/run/ai-prompt.md')).toMatch(/^This is a Meerkat report\. Read the Meerkat report at .*ai-prompt\.md/)
  })
})

describe('a 3000 character message survives from the MEERKAT-FINDING line to ai-prompt.md', () => {
  test('end to end', () => {
    const big = `m${'abcdefghij'.repeat(299)}abcdefghz`
    expect(big.length).toBe(3000)
    const line = formatFindingLine('high', 'big-rule', 'src/a.js', 2, big)
    expect(line).toContain(big)
    expect(MAX_MESSAGE).toBeGreaterThanOrEqual(8000)
    const parsed = parseFindingLine(line)
    expect(parsed.message).toBe(big)
    const root = tmp()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.js'), 'x\neval(y)\n')
    const logs = tmp()
    const run = join(logs, 'runs', '20261101-080000-demo-fast').split('\\').join('/')
    mkdirSync(run, { recursive: true })
    const check = { id: 'risky', group: 'security', tier: 'fast', lane: 'free', title: 'Risky', run: { cmd: 'node', args: ['/m/thorough/risky.mjs'] } }
    const results = [{ id: 'risky', status: 'FAIL', ms: 5, detail: 'failed', suite: 'risky-calls', subs: [] }]
    const sink = new Map([['risky', { findings: [parsed], output: '' }]])
    const env = { ...process.env, MEERKAT_LOG_DIR: logs }
    const saved = saveFindings({ dir: run, results, checks: [check], sink, appDir: root, repoRoot: root, env, startedAtMs: Date.now(), ms: 5, note: () => {} })
    expect(saved.doc.findings[0].message).toBe(big)
    const json = JSON.parse(readFileSync(join(run, 'findings.json'), 'utf8'))
    expect(json.findings[0].message).toBe(big)
    expect(readFileSync(join(run, 'findings.md'), 'utf8')).toContain(big)
    expect(readFileSync(join(run, 'findings.sarif'), 'utf8')).toContain(big)
    expect(readFileSync(join(run, 'detections.jsonl'), 'utf8')).toContain(big)
    const w = writeAiPrompt(run)
    expect(w.ok).toBe(true)
    expect(readFileSync(join(run, 'ai-prompt.md'), 'utf8')).toContain(big)
  })
  test('a tool failure keeps its whole line (detailFull) and 40 raw output lines', () => {
    const root = tmp()
    const out = Array.from({ length: 40 }, (_, i) => `line ${i} ${'y'.repeat(900)}`).join('\n')
    const results = [{ id: 'lint', status: 'FAIL', ms: 1, detail: 'cut', detailFull: `full-${'q'.repeat(2500)}`, suite: 'node', subs: [] }]
    const doc = buildFindings({ results, checks: [{ id: 'lint', group: 'functionality', tier: 'fast', run: { cmd: 'eslint', args: ['.'] } }], sink: new Map([['lint', { findings: [], output: out }]]), appDir: root, meta: { version: '1', runId: 'r', tier: 'fast', startedAt: '2026-11-01T00:00:00.000Z', endedAt: '2026-11-01T00:00:01.000Z', ms: 1 } })
    expect(doc.findings[0].message).toBe(`full-${'q'.repeat(2500)}`)
    expect(doc.findings[0].rawOutput).toHaveLength(40)
    expect(doc.findings[0].rawOutput[0].length).toBeGreaterThan(900)
  })
})

describe('meerkat prompt', () => {
  test('is planned and has help', () => {
    expect(planCommand(['prompt'], {})).toMatchObject({ kind: 'noun', noun: 'prompt', verb: 'create', target: null })
    expect(planCommand(['prompt', '--last', '--no-copy'], {})).toMatchObject({ noun: 'prompt', flags: { last: true, noCopy: true } })
    expect(planCommand(['prompt', '--bogus'], {}).kind).toBe('error')
    expect(JSON.stringify(commandHelp('prompt'))).toContain('ai-prompt.md')
  })
  test('writes the file and copies the short text through the clipboard function', () => {
    const logs = tmp()
    const run = join(logs, 'runs', '20261101-080000-demo-fast').split('\\').join('/')
    mkdirSync(run, { recursive: true })
    const { doc } = sample()
    writeFileSync(join(run, 'findings.json'), JSON.stringify(doc))
    let copied = ''
    const r = createPrompt({}, null, { dir: run, copy: (t: string) => ((copied = t), true) })
    expect(r.ok).toBe(true)
    expect(r.copied).toBe(true)
    expect(copied).toBe(`This is a Meerkat report. Read the Meerkat report at ${r.file} and follow the instructions Meerkat gives there.`)
    expect(readFileSync(r.file, 'utf8')).toContain(LONG)
    const none = createPrompt({}, null, { dir: tmp() })
    expect(none.ok).toBe(false)
  })
})

describe('AI verification (fake model, no network)', () => {
  const choice = { cmd: ['fake'], env: {}, label: 'FakeModel' }
  test('parseVerdict is strict', () => {
    expect(parseVerdict('VERDICT: real\nREASON: the input reaches eval')).toEqual({ verdict: 'real', reason: 'the input reaches eval' })
    expect(parseVerdict('VERDICT: probably false alarm\nREASON: test fixture')?.verdict).toBe('probably false alarm')
    expect(parseVerdict('looks fine')).toBeNull()
    expect(parseVerdict('VERDICT: real')).toBeNull()
    expect(parseVerdict('VERDICT: maybe\nREASON: x')).toBeNull()
    expect(parseVerdict('VERDICT: real\nREASON: a\nextra line')).toBeNull()
  })
  const project = () => {
    const root = tmp()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.js'), Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`).join('\n'))
    writeFileSync(join(root, 'src/key.js'), `const k = 'AKIA${'IOSFODNN7EXAMPLE'}'\n`)
    return root
  }
  const docFor = (root: string) => {
    const { doc } = sample()
    doc.run.project.path = root.split('\\').join('/')
    doc.findings = [mk({ id: 'a1', severity: 'high', message: 'eval of input', line: 20 }), mk({ id: 'a2', severity: 'medium', message: 'near a key', file: 'src/key.js', line: 1 }), mk({ id: 'a3', severity: 'critical', suite: 'secrets', message: 'secret' }), mk({ id: 'a4', severity: 'low', message: 'low one' })]
    return doc
  }
  test('sends only medium and worse, never secrets or an excerpt with a secret, and says what it sends', () => {
    const plan = planVerification(docFor(project()), { choice })
    expect(plan.ok).toBe(true)
    expect(plan.items.map((x: any) => x.f.id).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(plan.items.find((x: any) => x.f.id === 'a1').ex.text).toContain('20: const v19 = 19')
    expect(plan.items.find((x: any) => x.f.id === 'a2').ex.skip).toMatch(/secret/)
    expect(plan.items.find((x: any) => x.f.id === 'a3').ex.skip).toMatch(/secrets/)
    expect(plan.count).toBe(1)
    expect(plan.text).toContain('FakeModel')
    expect(plan.text).toContain('ONLY')
  })
  test('a verdict is added, findings are never removed, and the false alarm moves in the prompt', async () => {
    const root = project()
    const doc = docFor(root)
    const plan = planVerification(doc, { choice })
    const sent: string[] = []
    const res = await runVerification(plan, { ask: async (_c: any, p: string) => (sent.push(p), 'VERDICT: probably false alarm\nREASON: constant input') })
    expect(res.status).toBe('PARTIAL') // the secrets finding and the one beside a key get no verdict (NOT RUN for them)
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toContain('AKIA')
    const next = applyVerdicts(doc, res, { label: 'FakeModel' })
    expect(next.findings).toHaveLength(doc.findings.length)
    expect(next.findings.find((f: any) => f.id === 'a1')).toMatchObject({ aiVerdict: 'probably false alarm', aiReason: 'constant input' })
    const text = buildAiPrompt({ doc: next, summary: null })
    const sec5 = text.slice(text.indexOf('## 5.'), text.indexOf('## 6.'))
    expect(sec5).toContain('eval of input')
  })
  test('fails closed: an error or an unreadable reply gives no verdict and NOT RUN, nothing dropped', async () => {
    const root = project()
    const dir = tmp()
    const doc = docFor(root)
    writeFileSync(join(dir, 'findings.json'), JSON.stringify(doc))
    for (const ask of [async () => { throw new Error('offline') }, async () => 'sure, looks fine!']) {
      const r = await verifyRunDir(dir, { yes: true, choice, ask })
      expect(r.status).toBe('NOT RUN')
      expect(r.text).toMatch(/NOT RUN/)
      const back = readFindings(dir)
      expect(back.findings).toHaveLength(4)
      expect(back.findings.every((f: any) => !f.aiVerdict)).toBe(true)
    }
  })
  test('asks for a yes unless --yes: without it nothing is sent', async () => {
    const root = project()
    const dir = tmp()
    writeFileSync(join(dir, 'findings.json'), JSON.stringify(docFor(root)))
    let called = 0
    const ask = async () => (called++, 'VERDICT: real\nREASON: ok')
    const no = await verifyRunDir(dir, { choice, ask, confirm: async () => false })
    expect(no.status).toBe('NOT RUN')
    expect(called).toBe(0)
    const yes = await verifyRunDir(dir, { choice, ask, confirm: async () => true })
    expect(yes.ok).toBe(true)
    expect(called).toBe(1)
    expect(readFindings(dir).findings.find((f: any) => f.id === 'a1').aiVerdict).toBe('real')
    expect(readFileSync(join(dir, 'findings.md'), 'utf8')).toContain('AI verification: real')
  })
  test('the cap limits how many findings are verified', () => {
    const doc = docFor(project())
    expect(planVerification(doc, { choice, max: 1 }).items).toHaveLength(1)
  })
})

describe('run.log', () => {
  test('is chronological and has the preset, folder, machine, estimate, limit, exit code and a summary', () => {
    const t0 = Date.parse('2026-11-01T08:00:00.000Z')
    const text: string = runLogText({
      tier: 'fast', preset: 'fast', project: { name: 'demo', path: 'C:/p/demo' }, t0, ms: 4000, exitCode: 1, line: '1 failed', version: '0.3.0', machine: 'win32 test',
      results: [{ id: 'lint', status: 'FAIL', exitCode: 1, limitMs: 60000, detail: 'timed out after 60 s (limit is 60 s)', logFile: 'C:/l/lint.log' }, { id: 'later', status: 'NOT RUN', detail: 'needs lint' }],
      events: [{ t: t0 + 100, event: 'start', id: 'lint', lane: 'free' }, { t: t0 + 2100, event: 'end', id: 'lint', status: 'FAIL', ms: 2000, subs: { pass: 1, fail: 1, na: 0 } }],
      checks: [{ id: 'lint', estSeconds: 30 }], selection: { ran: ['lint', 'later'], skipped: ['x'], covered: [], disabled: [] }, estimatedMs: 45000,
      findingsInfo: { line: 'findings: 2 high', doc: { counts: { byCheck: { lint: 2 } } } },
    })
    const lines = text.trim().split('\n')
    const stamps = lines.map((l) => /^\[([^\]]+)\]/.exec(l)![1])
    expect([...stamps].sort()).toEqual(stamps)
    for (const s of ['run started: fast on demo', 'folder: C:/p/demo', 'Meerkat 0.3.0', 'checks chosen, in this order (2): lint, later', 'estimated time for the whole run: 45.0 s', 'start  lint', 'time limit 60.0 s', 'finish lint: FAIL; exit code 1; took 2.0 s; estimate 30 s; limit 60.0 s; TIMED OUT', 'findings 2', 'finish later: NOT RUN; never started', 'run finished: exit code 1']) expect(text).toContain(s)
  })
})
