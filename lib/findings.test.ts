// The finding protocol, the detection files (findings.json, findings.md, findings.sarif, detections.jsonl), the cross-run history,
// the `findings` and `finding` commands, the screen and the MCP field.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runCommand } from './exec.mjs'
// @ts-expect-error plain .mjs module
import { cleanPath, createFindingCollector, defaultSeverity, fingerprint, formatFindingLine, MAX_FINDINGS, normaliseFindings, parseFindingLine, parseOutputLines, ruleForMessage, toolOf } from './findings.mjs'
// @ts-expect-error plain .mjs module
import { buildDetections, buildFindings, evidenceFor, findingsLine, findingsMarkdown, findingsSarif, saveFindings } from './findingsdoc.mjs'
// @ts-expect-error plain .mjs module
import { historyFile, MAX_HISTORY_BYTES, updatedHistory } from './findingshistory.mjs'
// @ts-expect-error plain .mjs module
import { findingDetailText, findingsCommand, findingsSummary } from './findingscmd.mjs'
// @ts-expect-error plain .mjs module
import { findingsItems, renderFindingDetail, renderFindingsScreen } from './findingsscreen.mjs'
// @ts-expect-error plain .mjs module
import { planCommand } from './cli.mjs'
// @ts-expect-error plain .mjs module
import { handleMessage } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { main } from '../run.mjs'

const made: string[] = []
const tmp = (prefix = 'meerkat-findings-') => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

const line = (sev: string, rule: string, path: string, n: number, msg: string) => `MEERKAT-FINDING ${sev} ${rule} ${path}:${n} ${msg}`

describe('the finding protocol', () => {
  test('a valid line is parsed', () => {
    expect(parseFindingLine(line('high', 'eval-call', 'src/a.js', 12, 'eval() is used'))).toEqual({ severity: 'high', rule: 'eval-call', file: 'src/a.js', line: 12, message: 'eval() is used' })
    expect(parseFindingLine(line('info', '-', 'README.md', 0, 'no rule'))?.rule).toBeNull()
    expect(parseFindingLine(`${line('low', 'x', 'dir with space/a.js', 3, 'a: 4 b')}\r`)).toMatchObject({ file: 'dir with space/a.js', line: 3, message: 'a: 4 b' })
  })
  test('anything that is not strictly the format is ignored', () => {
    const bad = [
      line('severe', 'x', 'a.js', 1, 'm'),
      line('high', 'Bad_Rule', 'a.js', 1, 'm'),
      line('high', 'x', '/etc/passwd', 1, 'm'),
      line('high', 'x', 'C:/a.js', 1, 'm'),
      line('high', 'x', '../a.js', 1, 'm'),
      line('high', 'x', 'a/../b.js', 1, 'm'),
      line('high', 'x', `${'a'.repeat(301)}.js`, 1, 'm'),
      line('high', 'x', 'a\u0007b.js', 1, 'm'),
      'MEERKAT-FINDING high x a.js m',
      'MEERKAT-FINDING high x a.js:x m',
      line('high', 'x', 'a.js', 1, ''),
      ` ${line('high', 'x', 'a.js', 1, 'm')}`,
      'meerkat-finding high x a.js:1 m',
      'MEERKAT-FINDING',
    ]
    for (const b of bad) expect(parseFindingLine(b), b).toBeNull()
  })
  test('control characters leave the message and it is cut to 8000 characters', () => {
    const p = parseFindingLine(line('low', 'x', 'a.js', 1, `bad\u001b[31m${'y'.repeat(9000)}`))
    expect(p.message).not.toMatch(/[\u0000-\u001f]/)
    expect(p.message.length).toBe(8000)
  })
  test('the helper writes only valid lines', () => {
    expect(formatFindingLine('high', 'eval-call', 'src\\a.js', 3, 'x')).toBe('MEERKAT-FINDING high eval-call src/a.js:3 x')
    expect(formatFindingLine('high', null, 'a.js', -1, 'x')).toBe('MEERKAT-FINDING high - a.js:0 x')
    expect(formatFindingLine('nope', 'x', 'a.js', 1, 'x')).toBeNull()
    expect(formatFindingLine('high', 'x', '/abs', 1, 'x')).toBeNull()
    expect(cleanPath('./a/b.js')).toBe('a/b.js')
  })
  test('at most 5000 per check', () => {
    const c = createFindingCollector()
    for (let i = 0; i < MAX_FINDINGS + 50; i++) c.add(line('low', 'x', 'a.js', i, 'm'))
    expect(c.findings.length).toBe(MAX_FINDINGS)
    expect(c.dropped).toBe(50)
    expect(normaliseFindings([{ severity: 'high', rule: 'r', file: 'a.js', line: 2, message: 'm' }, { severity: 'x' }])).toHaveLength(1)
  })
  test('the runner takes the lines out of the output, also across chunk boundaries', async () => {
    const d = tmp()
    const script = join(d, 'child.mjs')
    writeFileSync(script, `process.stdout.write('before\\nMEERKAT-FIND')\nsetTimeout(() => { process.stdout.write('ING high r1 a.js:3 split line\\nMEERKAT-FINDING bogus line\\n' + 'MEERKAT-FINDING low - b.js:0 whole\\nafter\\n'); process.exit(1) }, 150)\n`)
    const r = await runCommand({ cmd: process.execPath, args: [script], cwd: d })
    expect(r.findings).toEqual([
      { severity: 'high', rule: 'r1', file: 'a.js', line: 3, message: 'split line' },
      { severity: 'low', rule: null, file: 'b.js', line: 0, message: 'whole' },
    ])
    expect(r.output).toBe('before\nafter\n')
    expect(r.findingsDropped).toBe(1)
  })
})

describe('severity defaults and fingerprints', () => {
  test('the check, then its group, and critical for the secrets suite', () => {
    expect(defaultSeverity({ severity: 'low', group: 'security' }, 'x')).toBe('low')
    expect(defaultSeverity({ group: 'security' }, 'x')).toBe('high')
    expect(defaultSeverity({ group: 'functionality' }, 'x')).toBe('medium')
    expect(defaultSeverity({ group: 'ui' }, 'x')).toBe('medium')
    expect(defaultSeverity({ group: 'performance' }, 'x')).toBe('low')
    expect(defaultSeverity({ group: 'refactor' }, 'x')).toBe('low')
    expect(defaultSeverity({ group: 'security' }, 'secrets')).toBe('critical')
  })
  test('the id survives a line shift and changes with the file', () => {
    const a = fingerprint({ rule: 'r', check: 'c', file: 'a.js', message: 'used at a.js:12 on line 12' })
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprint({ rule: 'r', check: 'c', file: 'a.js', message: 'used at a.js:40 on line 40' })).toBe(a)
    expect(fingerprint({ rule: 'r', check: 'c', file: 'b.js', message: 'used at a.js:12 on line 12' })).not.toBe(a)
    expect(fingerprint({ rule: 's', check: 'c', file: 'a.js', message: 'used at a.js:12 on line 12' })).not.toBe(a)
  })
})

// A project folder with source files, and results as the runner makes them.
function project(files: Record<string, string>) {
  const d = tmp('meerkat-findings-proj-')
  for (const [n, body] of Object.entries(files)) {
    mkdirSync(join(d, n, '..'), { recursive: true })
    writeFileSync(join(d, n), body)
  }
  return d
}
const scriptCheck = { id: 'risky', group: 'security', tier: 'fast', lane: 'free', title: 'Risky calls', pack: 'security', origin: 'bundled', install: 'npm i risky', run: { cmd: 'node', args: ['/m/thorough/risky.mjs', 'risky'] } }
const toolCheck = { id: 'lint', group: 'functionality', tier: 'fast', lane: 'free', title: 'Lint', run: { cmd: 'eslint', args: ['.'] } }
const meta = { version: '1.0.0', runId: 'r2', preset: null, tier: 'fast', startedAt: '2026-10-31T10:00:00.000Z', endedAt: '2026-10-31T10:00:05.000Z', ms: 5000 }

describe('fallback extraction', () => {
  const exists = (p: string) => (['src/a.js', 'src/b.js'].includes(p) ? p : null)
  test('path:line and path: message lines, nothing else', () => {
    const out = ['risky: found 3', '  src/a.js:2 eval() runs text as code', '  src/b.js: a bare message', '  nofile.js:4 does not exist', '  ... and 2 more'].join('\n')
    expect(parseOutputLines(out, exists)).toEqual([
      { file: 'src/a.js', line: 2, message: 'eval() runs text as code' },
      { file: 'src/b.js', line: 0, message: 'a bare message' },
    ])
  })
  test('the rule id comes from a failing sub-check whose title the message starts with', () => {
    const subs = [{ id: 'eval-call', status: 'FAIL', reason: '1 found: eval() runs text as code' }]
    expect(ruleForMessage('eval() runs text as code', subs)).toEqual({ id: 'eval-call', title: 'eval() runs text as code' })
    expect(ruleForMessage('something else', subs)).toBeNull()
  })
  test('a script check is parsed, a tool check keeps its first 25 raw lines, NOT RUN is not a finding', () => {
    const d = project({ 'src/a.js': 'x\neval(y)\n', 'src/b.js': 'ok\n' })
    const many = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const results = [
      { id: 'risky', status: 'FAIL', ms: 10, detail: 'sub-check eval-call failed', suite: 'risky-calls', subs: [{ id: 'eval-call', status: 'FAIL', reason: '1 found: eval() runs text as code' }] },
      { id: 'lint', status: 'FAIL', ms: 10, detail: '2 problems', suite: 'node', subs: [] },
      { id: 'e2e', status: 'NOT RUN', ms: 0, detail: 'missing on PATH: playwright', suite: 'other', subs: [] },
    ]
    const sink = new Map([['risky', { findings: [], output: 'risky: found 1\n  src/a.js:2 eval() runs text as code\n' }], ['lint', { findings: [], output: many }]])
    const doc = buildFindings({ results, checks: [scriptCheck, toolCheck], sink, appDir: d, meta })
    const f = doc.findings.find((x: any) => x.check === 'risky')
    expect(f).toMatchObject({ severity: 'high', rule: 'eval-call', file: 'src/a.js', line: 2, confidence: 'medium', evidence: 'eval(y)', fix: 'npm i risky', status: 'new' })
    expect(f.detectedBy).toMatchObject({ check: 'risky', pack: 'security', origin: 'bundled', tool: null })
    const t = doc.findings.find((x: any) => x.check === 'lint')
    expect(t.rawOutput).toHaveLength(40)
    expect(t.file).toBeNull()
    expect(t.detectedBy.tool.name).toBe('eslint')
    expect(doc.findings.some((x: any) => x.check === 'e2e')).toBe(false)
    expect(doc.notRun).toMatchObject([{ check: 'e2e', reason: 'missing on PATH: playwright' }])
    expect(toolOf(scriptCheck)).toBeNull()
  })
  test('findings printed with MEERKAT-FINDING win over parsing and are high confidence; duplicates merge', () => {
    const d = project({ 'src/a.js': 'a\nb\n' })
    const fl = [{ severity: 'low', rule: 'r', file: 'src/a.js', line: 1, message: 'same thing' }, { severity: 'low', rule: 'r', file: 'src/a.js', line: 2, message: 'same thing' }]
    const doc = buildFindings({ results: [{ id: 'risky', status: 'FAIL', ms: 1, detail: 'x', suite: 'risky-calls', subs: [] }], checks: [scriptCheck], sink: new Map([['risky', { findings: fl, output: 'src/a.js:1 other text\n' }]]), appDir: d, meta })
    expect(doc.findings).toHaveLength(1)
    expect(doc.findings[0]).toMatchObject({ confidence: 'high', occurrences: 2, lines: [1, 2], severity: 'low' })
  })
})

describe('evidence never carries a secret', () => {
  test('a line that redaction would change gives no evidence; the secrets suite never has any', () => {
    expect(evidenceFor('const apiKey = "abcdef123456789"', 'risky-calls')).toBeNull()
    expect(evidenceFor('token: ghp_' + 'a'.repeat(36), 'x')).toBeNull()
    expect(evidenceFor('const x = 1', 'secrets')).toBeNull()
    expect(evidenceFor('  eval(y)  ', 'risky-calls')).toBe('eval(y)')
    expect((evidenceFor('x'.repeat(500), 'risky-calls') ?? '').length).toBe(500)
  })
})

// Two runs of the same project, saved through saveFindings into a temporary log folder.
function saveRun(env: any, appDir: string, runId: string, results: any[], sink: Map<string, any>, over: any = {}) {
  const dir = join(env.MEERKAT_LOG_DIR, 'runs', runId)
  mkdirSync(dir, { recursive: true })
  return saveFindings({ dir, results, checks: [scriptCheck, toolCheck], sink, appDir, env, version: '1.0.0', tier: 'fast', startedAtMs: Date.parse(over.start ?? '2026-10-31T10:00:00Z'), ms: 1000, note: over.note ?? (() => {}), io: over.io })
}
const failing = (id = 'risky') => ({ id, status: 'FAIL', ms: 5, detail: 'failed', suite: 'risky-calls', subs: [], logFile: null })
const finds = (...list: [string, number][]) => new Map([['risky', { findings: list.map(([m, n]) => ({ severity: 'high', rule: 'r', file: 'src/a.js', line: n, message: m })), output: '' }]])

describe('the detection files of a run', () => {
  test('new, known and fixed across two runs, with firstSeen, and the history file', () => {
    const logs = tmp()
    const d = project({ 'src/a.js': 'a\nb\nc\n' })
    const env = { ...process.env, MEERKAT_LOG_DIR: logs }
    const one = saveRun(env, d, '20261031-100000-fast', [failing()], finds(['bad one', 1], ['bad two', 2]))
    expect(one.doc.counts).toMatchObject({ total: 2, new: 2, known: 0, fixed: 0 })
    expect(one.doc.findings.every((f: any) => f.status === 'new')).toBe(true)
    // The second run: "bad one" moved to line 3 (still known), "bad two" is gone, "bad three" is new.
    const two = saveRun(env, d, '20261031-110000-fast', [failing()], finds(['bad one', 3], ['bad three', 1]), { start: '2026-10-31T11:00:00Z' })
    const byMsg = Object.fromEntries(two.doc.findings.map((f: any) => [f.message, f]))
    expect(byMsg['bad one'].status).toBe('known')
    expect(byMsg['bad one'].firstSeen).toBe('2026-10-31T10:00:00.000Z')
    expect(byMsg['bad three'].status).toBe('new')
    expect(two.doc.counts).toMatchObject({ total: 2, new: 1, known: 1, fixed: 1 })
    expect(two.doc.fixed).toHaveLength(1)
    expect(two.doc.fixed[0]).toMatchObject({ title: 'bad two', previousRun: '20261031-100000-fast' })
    expect(existsSync(historyFile(env, d))).toBe(true)
    expect(JSON.parse(readFileSync(historyFile(env, d), 'utf8')).runs).toHaveLength(2)
    expect(findingsLine(two.doc, 'x/findings.md')).toBe('findings: 2 high (1 new)  details: x/findings.md')
    expect(findingsMarkdown(two.doc)).toContain('Fixed since the last run')
  })
  test('history survives the pruning of run folders', () => {
    const logs = tmp()
    const d = project({ 'src/a.js': 'a\n' })
    const env = { ...process.env, MEERKAT_LOG_DIR: logs }
    saveRun(env, d, '20261031-100000-fast', [failing()], finds(['stays', 1]))
    rmSync(join(logs, 'runs'), { recursive: true, force: true })
    const two = saveRun(env, d, '20261031-110000-fast', [failing()], finds(['stays', 1]))
    expect(two.doc.findings[0].status).toBe('known')
  })
  test('the history never grows past 2 MB and keeps 20 runs at most', () => {
    const big = (n: number) => ({ runId: `r${n}`, kind: 'fast', at: '2026-10-31T10:00:00Z', runDir: null, ids: [], items: Array.from({ length: 3000 }, (_, i) => ({ id: String(i), severity: 'low', title: 'x'.repeat(200), file: 'f', line: i, check: 'c', rule: null })) })
    let history: any = null
    let text = ''
    for (let i = 0; i < 40; i++) ({ history, text } = updatedHistory(history, { project: { name: 'p', path: '/p' }, entry: big(i) }))
    expect(text.length).toBeLessThanOrEqual(MAX_HISTORY_BYTES)
    expect(history.runs.length).toBeLessThanOrEqual(20)
    expect(history.runs.at(-1).runId).toBe('r39')
  })

  test('findings.json matches its schema, SARIF is structurally valid, detections.jsonl is in time order', () => {
    const logs = tmp()
    const d = project({ 'src/a.js': 'eval(x)\n' })
    const env = { ...process.env, MEERKAT_LOG_DIR: logs }
    const recorder = { events: [{ t: 1000, event: 'start', id: 'risky' }, { t: 1500, event: 'end', id: 'risky' }, { t: 1600, event: 'end', id: 'e2e' }] }
    const results = [{ ...failing(), subs: [{ id: 'r', status: 'FAIL', reason: '2 found: a title' }] }, { id: 'e2e', status: 'NOT RUN', ms: 0, detail: 'missing on PATH: playwright', suite: 'other', subs: [] }]
    const dir = join(logs, 'runs', '20261031-100000-fast')
    mkdirSync(dir, { recursive: true })
    const saved = saveFindings({ dir, results, checks: [scriptCheck], sink: finds(['eval is used', 1]), appDir: d, env, version: '1.0.0', tier: 'fast', startedAtMs: 1000, ms: 700, recorder })
    const doc = JSON.parse(readFileSync(saved.files.findings, 'utf8'))
    validateDoc(doc)
    const sarif = JSON.parse(readFileSync(saved.files.sarif, 'utf8'))
    validateSarif(sarif)
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: 'r', level: 'error', partialFingerprints: { meerkatFindingHash: doc.findings[0].id } })
    expect(sarif.runs[0].results[0].locations[0].physicalLocation).toMatchObject({ artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1 } })
    const events = readFileSync(saved.files.detections, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    for (let i = 1; i < events.length; i++) expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t)
    const kinds = events.map((e: any) => e.event)
    expect(kinds).toEqual(expect.arrayContaining(['check-failed', 'sub-check-failed', 'finding', 'rule-hit', 'check-not-run']))
    expect(events.find((e: any) => e.event === 'check-not-run')).toMatchObject({ check: 'e2e', message: 'missing on PATH: playwright', t: 600 })
    expect(events.find((e: any) => e.event === 'sub-check-failed')).toMatchObject({ rule: 'r', check: 'risky' })
    expect(events.every((e: any) => typeof e.time === 'string' && 'durationMs' in e && 'tool' in e)).toBe(true)
    expect(buildDetections({ doc, results, checks: [scriptCheck], recorder, startedAtMs: 1000 }).length).toBe(events.length)
  })

  test('a write that fails does not fail the run and leaves no half file', () => {
    const logs = tmp()
    const d = project({ 'src/a.js': 'a\n' })
    const env = { ...process.env, MEERKAT_LOG_DIR: logs }
    const notes: string[] = []
    const io = { writeFileSync: () => { throw new Error('disk full') }, renameSync: () => { throw new Error('no') }, unlinkSync: () => {} }
    const r = saveRun(env, d, '20261031-100000-fast', [failing()], finds(['x', 1]), { io, note: (m: string) => notes.push(m) })
    expect(r.doc.counts.total).toBe(1)
    expect(notes.length).toBeGreaterThanOrEqual(4)
    expect(readdirSync(join(logs, 'runs', '20261031-100000-fast'))).toEqual([])
    // A document that cannot even be built is a note, never an exception.
    const notes2: string[] = []
    expect(saveFindings({ dir: join(logs, 'runs', 'x'), results: null as any, checks: [], sink: new Map(), appDir: d, env, note: (m: string) => notes2.push(m), startedAtMs: 0, ms: 0 })).toBeNull()
    expect(notes2[0]).toMatch(/could not be compiled/)
  })
})

function validateDoc(doc: any) {
  expect(doc.schemaVersion).toBe(1)
  expect(typeof doc.meerkat.version).toBe('string')
  for (const k of ['id', 'dir', 'preset', 'tier', 'startedAt', 'endedAt', 'ms']) expect(doc.run).toHaveProperty(k)
  expect(doc.run.project).toMatchObject({ name: expect.any(String), path: expect.any(String) })
  expect(doc.run.machine).toMatchObject({ os: expect.any(String), node: expect.any(String) })
  for (const k of ['total', 'bySeverity', 'bySuite', 'byCheck', 'new', 'known', 'fixed']) expect(doc.counts).toHaveProperty(k)
  expect(Object.keys(doc.counts.bySeverity).sort()).toEqual(['critical', 'high', 'info', 'low', 'medium'])
  expect(doc.counts.total).toBe(doc.findings.length)
  for (const f of doc.findings) {
    expect(f.id).toMatch(/^[0-9a-f]{16}$/)
    expect(['critical', 'high', 'medium', 'low', 'info']).toContain(f.severity)
    for (const k of ['title', 'message', 'suite', 'check']) expect(typeof f[k]).toBe('string')
    expect(f).toHaveProperty('rule')
    expect(f).toHaveProperty('file')
    expect(f).toHaveProperty('line')
    expect(f.column).toBeNull()
    expect(f.detectedBy).toMatchObject({ check: f.check, origin: expect.any(String), command: expect.anything() })
    expect(f).toHaveProperty('fix')
    expect(['high', 'medium']).toContain(f.confidence)
    expect(['new', 'known']).toContain(f.status)
    expect(Number.isNaN(Date.parse(f.firstSeen))).toBe(false)
    expect(f).toHaveProperty('logFile')
    if ('evidence' in f) expect(f.evidence.length).toBeLessThanOrEqual(200)
  }
}
function validateSarif(s: any) {
  expect(s.version).toBe('2.1.0')
  expect(typeof s.$schema).toBe('string')
  expect(s.runs).toHaveLength(1)
  const run = s.runs[0]
  expect(run.tool.driver.name).toBe('Meerkat')
  expect(typeof run.tool.driver.version).toBe('string')
  const ids = new Set(run.tool.driver.rules.map((r: any) => r.id))
  for (const r of run.tool.driver.rules) expect(typeof r.shortDescription.text).toBe('string')
  for (const r of run.results) {
    expect(ids.has(r.ruleId)).toBe(true)
    expect(['error', 'warning', 'note']).toContain(r.level)
    expect(typeof r.message.text).toBe('string')
    expect(typeof r.partialFingerprints.meerkatFindingHash).toBe('string')
    for (const l of r.locations ?? []) {
      expect(typeof l.physicalLocation.artifactLocation.uri).toBe('string')
      if (l.physicalLocation.region) expect(l.physicalLocation.region.startLine).toBeGreaterThanOrEqual(1)
    }
  }
}

describe('SARIF levels', () => {
  test('critical and high are errors, medium a warning, low and info notes', () => {
    const mk = (severity: string) => ({ id: severity, severity, title: 't', message: 'm', suite: 's', check: 'c', rule: null, file: null, line: null, lines: [], detectedBy: { checkTitle: 'c' }, status: 'new' })
    const sarif = findingsSarif({ meerkat: { version: '1' }, findings: ['critical', 'high', 'medium', 'low', 'info'].map(mk) })
    expect(sarif.runs[0].results.map((r: any) => r.level)).toEqual(['error', 'error', 'warning', 'note', 'note'])
  })
})

// A real run of the secrets-plus check on a fixture project: no file may hold the secret.
describe('a real run', () => {
  test('writes the four files, prints the findings line and never keeps a secret', async () => {
    const logs = tmp()
    const fake = `AKIA${'ABCDEFGHIJKLMNOP'}`
    const d = project({ 'src/config.js': `const region = 'eu'\nconst key = '${fake}'\n`, 'meerkat.config.json': JSON.stringify({ packs: ['secrets-plus'] }) })
    const env: any = { ...process.env, MEERKAT_LOG_DIR: logs }
    const lines: string[] = []
    const code = await main(['--app', d, '--all', '--plain', '--only', 'secrets-plus'], { log: (l: string) => lines.push(l), env })
    expect(code).toBe(1)
    const run = join(logs, 'runs', readdirSync(join(logs, 'runs'))[0])
    expect(lines.some((l) => /^findings: 1 critical \(1 new\)  details: .*findings\.md$/.test(l))).toBe(true)
    for (const name of ['findings.json', 'findings.md', 'findings.sarif', 'detections.jsonl', 'summary.json']) expect(existsSync(join(run, name)), name).toBe(true)
    for (const name of ['findings.json', 'findings.md', 'findings.sarif', 'detections.jsonl']) expect(readFileSync(join(run, name), 'utf8'), name).not.toContain(fake)
    expect(readFileSync(join(run, 'findings.json'), 'utf8')).not.toContain('AKIA]')
    const doc = JSON.parse(readFileSync(join(run, 'findings.json'), 'utf8'))
    validateDoc(doc)
    expect(doc.findings[0]).toMatchObject({ severity: 'critical', suite: 'secrets', check: 'secrets-plus', rule: 'aws-access-key-id', file: 'src/config.js', line: 2 })
    expect('evidence' in doc.findings[0]).toBe(false)
    const summary = JSON.parse(readFileSync(join(run, 'summary.json'), 'utf8'))
    expect(Object.keys(summary.files).sort()).toEqual(['detections', 'findings', 'report', 'sarif'])
    expect(summary.findings.total).toBe(1)
    expect(readFileSync(join(run, 'detections.jsonl'), 'utf8')).toContain('"event":"sub-check-failed"')
  }, 60000)

  test('scanRules prints one finding line per hit next to its usual output', () => {
    const d = tmp()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'a.js'), 'ok\n// TODO later\n')
    const script = join(d, 'scan.mjs')
    const rules = pathToFileURL(join(process.cwd(), 'thorough', 'rules.mjs')).href
    writeFileSync(script, `import { scanRules } from '${rules}'\nprocess.exitCode = scanRules('t', ${JSON.stringify(d)}, [{ id: 'todo-word', title: 'a TODO word is left in', ext: ['js'], re: /TODO/, bad: 'TODO', good: 'x' }])\n`)
    let out = ''
    try {
      execFileSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, MEERKAT_DEFAULT_SEVERITY: 'low' } })
    } catch (e: any) {
      out = String(e.stdout)
    }
    expect(out).toContain('MEERKAT-FINDING low todo-word src/a.js:2 a TODO word is left in')
    expect(out).toContain('t: found 1')
  })
})

// A run folder with a findings.json, for the commands.
function savedRun() {
  const logs = tmp()
  const d = project({ 'src/a.js': 'a\n' })
  const env = { ...process.env, MEERKAT_LOG_DIR: logs }
  const fl = [
    { severity: 'critical', rule: 'k', file: 'src/a.js', line: 1, message: 'crit thing' },
    { severity: 'medium', rule: 'm', file: 'src/a.js', line: 1, message: 'medium thing' },
    { severity: 'low', rule: 'l', file: 'src/a.js', line: 1, message: 'low thing' },
  ]
  const saved = saveRun(env, d, '20261031-100000-fast', [{ ...failing(), suite: 'secrets' }], new Map([['risky', { findings: fl, output: '' }]]))
  writeFileSync(join(logs, 'latest.json'), JSON.stringify({ dir: join(logs, 'runs', '20261031-100000-fast') }))
  return { logs, env, saved, d }
}
const runCmd = (env: any, argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const plan = planCommand(argv, { cwd: process.cwd(), env })
  const code = plan.kind === 'noun' ? findingsCommand(plan, { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env, cwd: process.cwd() }) : -1
  return { code, out: out.join('\n'), err: err.join('\n'), plan }
}

describe('meerkat findings and meerkat finding', () => {
  test('the table, the filters and --json', () => {
    const { env } = savedRun()
    const all = runCmd(env, ['findings'])
    expect(all.code).toBe(0)
    expect(all.out).toContain('crit thing')
    expect(all.out).toMatch(/SEVERITY\s+RULE\s+WHERE\s+WHAT\s+STATUS/)
    expect(runCmd(env, ['findings', '--severity', 'medium']).out).not.toContain('low thing')
    expect(runCmd(env, ['findings', '--suite', 'nothing']).out).toContain('No findings match.')
    expect(runCmd(env, ['findings', '--check', 'risky', '--new']).out).toContain('medium thing')
    expect(runCmd(env, ['findings', '--limit', '1']).out).toContain('and 2 more')
    const j = JSON.parse(runCmd(env, ['findings', '--json']).out)
    expect(j.total).toBe(3)
    expect(j.findings[0].severity).toBe('critical')
  })
  test('--fail-on exits 1 only when a finding at or above that severity exists', () => {
    const { env } = savedRun()
    expect(runCmd(env, ['findings', '--fail-on', 'critical']).code).toBe(1)
    expect(runCmd(env, ['findings', '--fail-on', 'high']).code).toBe(1)
    const lowOnly = savedRunWith([{ severity: 'low', rule: 'l', file: 'src/a.js', line: 1, message: 'low thing' }])
    expect(runCmd(lowOnly, ['findings', '--fail-on', 'high']).code).toBe(0)
    expect(runCmd(lowOnly, ['findings', '--fail-on', 'low']).code).toBe(1)
    expect(planCommand(['findings', '--fail-on', 'bogus'], { cwd: process.cwd(), env }).kind).toBe('error')
  })
  test('one finding in full, by id or by the start of an id', () => {
    const { env, saved } = savedRun()
    const id = saved.doc.findings[0].id
    const r = runCmd(env, ['finding', id.slice(0, 6)])
    expect(r.code).toBe(0)
    for (const w of ['what:', 'where:', 'detected by:', 'confidence:', 'log:', 'fix:', 'first seen:', 'crit thing']) expect(r.out).toContain(w)
    expect(runCmd(env, ['finding', 'ffffffff']).code).toBe(1)
    expect(findingDetailText(saved.doc.findings[0], saved.doc)).toContain('risky.mjs')
  })
  test('--export copies the saved file', () => {
    const { env, logs } = savedRun()
    expect(runCmd(env, ['findings', '--export', 'sarif']).out).toContain('"version": "2.1.0"')
    const target = join(logs, 'out.sarif')
    expect(runCmd(env, ['findings', '--export', 'sarif', target]).code).toBe(0)
    expect(JSON.parse(readFileSync(target, 'utf8')).version).toBe('2.1.0')
    expect(planCommand(['findings', '--export', 'xml'], { cwd: process.cwd(), env }).kind).toBe('error')
  })
  test('the MCP meerkat_last result carries counts and the top findings', async () => {
    const { env } = savedRun()
    const ctx = { showLast: () => ({ ok: true, text: 'the report' }), findingsSummary: () => findingsSummary(env) }
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'meerkat_last', arguments: {} } }, ctx)
    expect(r.result.structuredContent.findings.counts.total).toBe(3)
    expect(r.result.structuredContent.findings.top[0].severity).toBe('critical')
    expect(r.result.structuredContent.findings.top.length).toBeLessThanOrEqual(20)
    const plain = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'meerkat_last', arguments: {} } }, { showLast: () => ({ ok: true, text: 'the report' }) })
    expect(plain.result.structuredContent).toBeUndefined()
  })
})
function savedRunWith(fl: any[]) {
  const logs = tmp()
  const d = project({ 'src/a.js': 'a\n' })
  const env = { ...process.env, MEERKAT_LOG_DIR: logs }
  saveRun(env, d, '20261031-100000-fast', [failing()], new Map([['risky', { findings: fl, output: '' }]]))
  writeFileSync(join(logs, 'latest.json'), JSON.stringify({ dir: join(logs, 'runs', '20261031-100000-fast') }))
  return env
}

describe('the findings screen', () => {
  const { saved } = (() => savedRun())()
  const doc = saved.doc
  test('one heading per severity, a row per finding', () => {
    const items = findingsItems(doc)
    expect(items.filter((i: any) => i.kind === 'heading').map((i: any) => i.label)).toEqual(['critical (1)', 'medium (1)', 'low (1)'])
    expect(items.filter((i: any) => i.kind === 'item')).toHaveLength(3)
  })
  test('renders within the width and the rows, with and without colour', () => {
    for (const color of [false, true]) {
      const lines = renderFindingsScreen(doc, { width: 80, rows: 24, color }).map((l: any) => l.text)
      expect(lines.length).toBeLessThanOrEqual(23)
      expect(lines.join('\n')).toContain('crit thing')
      if (!color) for (const l of lines) expect(l.length).toBeLessThanOrEqual(80)
    }
  })
  test('the detail screen shows every part', () => {
    const text = renderFindingDetail(doc.findings[0], { width: 80 }).join('\n')
    for (const w of ['what', 'where', 'rule', 'check', 'confidence', 'log', 'fix', 'first seen', 'crit thing']) expect(text).toContain(w)
  })
})

describe('the check fields and the help', () => {
  test('severity and fix are validated', async () => {
    // @ts-expect-error plain .mjs module
    const { validateCheck } = await import('./load-checks.mjs')
    const base = { id: 'x', group: 'security', tier: 'fast', lane: 'free', title: 't', run: { cmd: 'node' } }
    expect(validateCheck({ ...base, severity: 'high', fix: 'do it' })).toBeNull()
    expect(validateCheck({ ...base, severity: 'huge' })).toMatch(/severity/)
    expect(validateCheck({ ...base, fix: 5 })).toMatch(/fix/)
  })
  test('both commands are registered', async () => {
    // @ts-expect-error plain .mjs module
    const { commandHelp, describe: describeAll } = await import('./help.mjs')
    expect(commandHelp('findings')).toContain('--fail-on')
    expect(commandHelp('finding')).toContain('meerkat finding <id>')
    expect(describeAll({}).commands.map((c: any) => c.name)).toEqual(expect.arrayContaining(['findings', 'finding']))
    // @ts-expect-error plain .mjs module
    const { completionScript } = await import('./completion.mjs')
    expect(completionScript('bash')).toContain('findings')
  })
})
