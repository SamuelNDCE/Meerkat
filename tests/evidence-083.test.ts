// Evidence for dismissals (lib/evidence.mjs): VERIFIED, STALE and UNVERIFIED, end to end on the real CLI plus unit cases for each kind.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { buildEvidence, checkEvidence, parseEvidence, partitionByEvidence, LEGACY_LABEL } from '../lib/evidence.mjs'
// @ts-expect-error plain .mjs module
import { acceptedSets, dismissalDoc, saveAccepted, withDismissal } from '../lib/accepted.mjs'
// @ts-expect-error plain .mjs module
import { makeSandbox, runCli } from './smoke-helpers.mjs'

const base = mkdtempSync(join(tmpdir(), 'mk-ev-'))
afterAll(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }))
let n = 0
const proj = (files: Record<string, string>) => {
  const d = join(base, `p${++n}`)
  mkdirSync(d, { recursive: true })
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), t)
  }
  return d
}

describe('parsing', () => {
  test('kinds and shapes', () => {
    expect(parseEvidence('note:checked with the vendor')).toEqual({ kind: 'note', value: 'checked with the vendor' })
    expect(parseEvidence('line:src/a.js:12')).toEqual({ kind: 'line', value: 'src/a.js:12' })
    expect(() => parseEvidence('screenshot:x')).toThrow(/test, line or note/)
    expect(() => parseEvidence('line:')).toThrow()
    expect(() => parseEvidence('nonsense')).toThrow()
  })
})

describe('line evidence', () => {
  test('matches -> VERIFIED; edited -> STALE; file gone -> STALE; moved out of range -> STALE', () => {
    const d = proj({ 'src/a.js': 'const a = 1\nconst token = readEnv()\nexport { a }\n' })
    const ev = buildEvidence('line:src/a.js:2', { projectPath: d })
    expect(ev).toMatchObject({ kind: 'line', file: 'src/a.js', line: 2, text: 'const token = readEnv()', exact: true })
    const item = { id: 'x', reason: 'r', evidence: ev }
    expect(checkEvidence(item, d)).toMatchObject({ state: 'VERIFIED', label: 'line:src/a.js:2' })
    writeFileSync(join(d, 'src/a.js'), 'const a = 1\nconst token = readEnv("NEW")\nexport { a }\n')
    expect(checkEvidence(item, d).state).toBe('STALE')
    writeFileSync(join(d, 'src/a.js'), 'const a = 1')
    expect(checkEvidence(item, d).detail).toMatch(/now has only 1 line/)
    rmSync(join(d, 'src/a.js'))
    expect(checkEvidence(item, d).detail).toMatch(/no longer exists/)
  })
  test('named text: the line must contain it, then and now', () => {
    const d = proj({ 'a.py': 'x = 1\npassword = os.environ["PW"]  # ok\n' })
    expect(() => buildEvidence('line:a.py:2:nomatch', { projectPath: d })).toThrow(/does not contain "nomatch"/)
    const ev = buildEvidence('line:a.py:2:os.environ', { projectPath: d })
    expect(ev.exact).toBe(false)
    expect(checkEvidence({ evidence: ev }, d).state).toBe('VERIFIED')
    writeFileSync(join(d, 'a.py'), 'x = 1\npassword = other()\n')
    expect(checkEvidence({ evidence: ev }, d).state).toBe('STALE')
  })
  test('refuses what does not hold now, and paths outside the project', () => {
    const d = proj({ 'a.js': 'one\n\ntwo\n' })
    expect(() => buildEvidence('line:a.js:9', { projectPath: d })).toThrow(/does not hold/)
    expect(() => buildEvidence('line:a.js:2', { projectPath: d })).toThrow(/empty/)
    expect(() => buildEvidence('line:../outside.js:1', { projectPath: d })).toThrow(/outside the project/)
    expect(() => buildEvidence('line:missing.js:1', { projectPath: d })).toThrow(/no longer exists/)
  })
  test('CRLF files verify the same as LF', () => {
    const d = proj({ 'a.js': 'a\r\nb = 2\r\n' })
    const ev = buildEvidence('line:a.js:2', { projectPath: d })
    expect(checkEvidence({ evidence: ev }, d).state).toBe('VERIFIED')
  })
})

describe('note, legacy and implicit evidence', () => {
  test('a note is UNVERIFIED and still suppresses; an old dismissal has the legacy label', () => {
    const d = proj({ 'a.js': 'x\n' })
    const note = buildEvidence('note:vendor confirmed', { projectPath: d })
    expect(checkEvidence({ evidence: note }, d)).toMatchObject({ state: 'UNVERIFIED', label: 'note:vendor confirmed' })
    expect(checkEvidence({ id: 'old', reason: 'r' }, d)).toMatchObject({ state: 'UNVERIFIED', label: LEGACY_LABEL })
    expect(LEGACY_LABEL).toBe('note (unverified, from before evidence was required)')
    const { live, stale } = partitionByEvidence([{ id: 'old' }, { id: 'n', evidence: note }], d)
    expect(live).toHaveLength(2)
    expect(stale).toHaveLength(0)
  })
})

describe('test evidence', () => {
  const setup = () =>
    proj({
      'meerkat.config.json': JSON.stringify({ commands: { test: 'node run-test.mjs {name}' } }),
      'run-test.mjs': 'process.exit(String(process.argv[2]).includes("FAILS") ? 1 : 0)\n',
      'test/a.test.js': "test('keeps empty input', () => {})\ntest('FAILS on purpose', () => {})\n",
    })
  const env = { ...process.env, MEERKAT_TRUST_PROJECT: '1' }
  test('a test that exists and passes is VERIFIED; removed -> STALE; a failing test is refused', () => {
    const d = setup()
    const ev = buildEvidence('test:keeps empty input', { projectPath: d, env })
    expect(ev).toMatchObject({ kind: 'test', name: 'keeps empty input', lastResult: 'pass' })
    expect(checkEvidence({ evidence: ev }, d).state).toBe('VERIFIED')
    expect(() => buildEvidence('test:FAILS on purpose', { projectPath: d, env })).toThrow(/exited 1/)
    expect(() => buildEvidence('test:no such test', { projectPath: d, env })).toThrow(/no test file/)
    writeFileSync(join(d, 'test/a.test.js'), "test('something else', () => {})\n")
    expect(checkEvidence({ evidence: ev }, d)).toMatchObject({ state: 'STALE' })
  })
  test('lastResult fail makes it STALE; an untrusted repo and a name with shell characters are refused', () => {
    const d = setup()
    expect(checkEvidence({ evidence: { kind: 'test', name: 'keeps empty input', lastResult: 'fail' } }, d).state).toBe('STALE')
    expect(() => buildEvidence('test:keeps empty input', { projectPath: d, env: { ...process.env, MEERKAT_TRUST_PROJECT: '0', MEERKAT_LOG_DIR: join(base, 'nolog') } })).toThrow(/trust/)
    writeFileSync(join(d, 'test/b.test.js'), "test('x; echo pwned', () => {})\n")
    expect(() => buildEvidence('test:x; echo pwned', { projectPath: d, env })).toThrow(/unsafe/)
  })
})

describe('end to end on the real CLI', () => {
  let sb: any
  let id = ''
  let file = ''
  let line = 0
  const dismissals = (args: string[] = []) => runCli(sb, ['dismissals', ...args]).stdout
  const openIds = () => {
    const f = JSON.parse(runCli(sb, ['findings', '--json', '--limit', '500']).stdout || '{}')
    return (f.findings ?? f.items ?? []) as { id: string; check: string; file?: string; line?: number }[]
  }
  beforeAll(() => {
    sb = makeSandbox({ label: 'ev083' })
    runCli(sb, ['verify'], { timeout: 140000 })
    const all = openIds()
    // The evidence line is any line of the project that the person points at; it need not be the finding's own file (this fixture's findings have none).
    id = all[0]?.id ?? ''
    file = 'package.json'
    line = 2
  }, 170000)
  afterAll(() => sb?.cleanup())

  test('the fixture run has a finding and the evidence line exists', () => {
    expect(id).not.toBe('')
    expect(readFileSync(join(sb.app, file), 'utf8')).toContain('smoke-app')
  })

  test('line evidence: VERIFIED, suppresses; after the line is edited it is STALE and the finding returns', () => {
    const r = runCli(sb, ['dismiss', id, '--reason', 'fixture: checked by hand', '--evidence', `line:${file}:${line}`])
    expect(r.code, r.all).toBe(0)
    expect(r.stdout).toMatch(/Evidence: VERIFIED line:/)
    const ok = dismissals()
    console.log(`VERIFIED row: ${ok}`)
    expect(ok).toMatch(/^ACTIVE\s+\S+.*evidence: VERIFIED line:/m)
    expect(dismissals(['--show', id.slice(0, 8)])).toMatch(/evidence: VERIFIED/)
    expect(acceptedSets({ env: sb.env, projectPath: sb.app }).dismissed.has(id)).toBe(true)
    // edit the line: the dismissal stops suppressing at once
    const p = join(sb.app, file)
    const lines = readFileSync(p, 'utf8').split('\n')
    lines[line - 1] = '  "name": "smoke-app-renamed",'
    writeFileSync(p, lines.join('\n'))
    const stale = dismissals()
    console.log(`STALE row: ${stale}`)
    expect(stale).toMatch(/^STALE\s+\S+.*evidence: STALE line:/m)
    const sets = acceptedSets({ env: sb.env, projectPath: sb.app })
    expect(sets.dismissed.has(id)).toBe(false)
    expect(sets.stale.has(id)).toBe(true)
    // and a real run brings the finding back
    runCli(sb, ['verify'], { timeout: 140000 })
    expect(openIds().some((x) => x.check === 'dependency-updates-configured'), 'the finding must come back once the dismissal is STALE').toBe(true)
    id = openIds().find((x) => x.check === 'dependency-updates-configured')?.id ?? '' // the id of a finding can change when the project changes
  }, 400000)

  test('a note is UNVERIFIED; no --evidence is an implicit UNVERIFIED note with a hint', () => {
    const r = runCli(sb, ['dismiss', id, '--reason', 'fixture: note', '--evidence', 'note:asked the owner'])
    expect(r.stdout).toMatch(/Evidence: UNVERIFIED note:asked the owner/)
    const t = dismissals()
    console.log(`UNVERIFIED row: ${t}`)
    expect(t).toMatch(/evidence: UNVERIFIED note:asked the owner/)
    const r2 = runCli(sb, ['dismiss', id, '--reason', 'fixture: bare'])
    expect(r2.code).toBe(0)
    expect(r2.stdout).toMatch(/Evidence: note \(unverified, no evidence was given\)/)
  })

  test('an evidence that does not hold refuses the dismissal', () => {
    runCli(sb, ['undismiss', id])
    const r = runCli(sb, ['dismiss', id, '--reason', 'x', '--evidence', `line:${file}:99999`])
    expect(r.code).toBe(2)
    expect(r.all).toMatch(/Nothing was dismissed/)
    expect(runCli(sb, ['dismiss', id, '--reason', 'x', '--evidence', 'bogus']).code).toBe(2)
    expect(dismissals()).not.toMatch(/"x"/) // the refused dismissals saved nothing
  })

  test('an old dismissal without evidence keeps working and has the legacy label', () => {
    saveAccepted('dismissed', sb.env, sb.app, dismissalDoc(withDismissal([], { id: 'legacyid0001', rule: null, check: 'c', file: 'a.js', title: 't', reason: 'from an older version' })))
    const t = dismissals()
    console.log(`LEGACY row: ${t}`)
    expect(t).toMatch(/^ACTIVE\s+legacyid0001.*evidence: UNVERIFIED note \(unverified, from before evidence was required\)/m)
    expect(acceptedSets({ env: sb.env, projectPath: sb.app }).dismissed.has('legacyid0001')).toBe(true)
  })
})

describe('file safety (links and size)', () => {
  test('a link that leads outside the project is refused; an oversize file is refused; a normal file still verifies', () => {
    const outside = proj({ 'secret.txt': 'top secret line\n' })
    const d = proj({ 'ok.js': 'const ok = 1\n', 'big.txt': 'x'.repeat(2 * 1024 * 1024 + 10) })
    expect(buildEvidence('line:ok.js:1', { projectPath: d }).kind).toBe('line')
    expect(() => buildEvidence('line:big.txt:1', { projectPath: d })).toThrow(/too large/)
    let made = 0
    try {
      symlinkSync(join(outside, 'secret.txt'), join(d, 'link.txt'), 'file')
      made++
      expect(() => buildEvidence('line:link.txt:1', { projectPath: d })).toThrow(/symbolic link|outside the project/)
    } catch (e: any) {
      if (!/EPERM|EACCES|symbolic link|outside/.test(String(e?.code ?? e?.message))) throw e
    }
    try {
      symlinkSync(outside, join(d, 'dirlink'), 'junction') // a link in a parent folder
      made++
      expect(() => buildEvidence('line:dirlink/secret.txt:1', { projectPath: d })).toThrow(/outside the project/)
    } catch (e: any) {
      if (!/EPERM|EACCES|outside/.test(String(e?.code ?? e?.message))) throw e
    }
    expect(made).toBeGreaterThan(0)
    // a stored evidence that now points through a link is STALE, never read
    expect(checkEvidence({ evidence: { kind: 'line', file: 'dirlink/secret.txt', line: 1, text: 'top secret line', exact: true } }, d).state).toBe('STALE')
  })
})
