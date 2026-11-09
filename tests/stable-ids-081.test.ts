import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { buildFindings } from '../lib/findingsdoc.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { acceptedSets, applyAccepted, dismissalDoc, saveAccepted, withDismissal, readDismissals } from '../lib/accepted.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { fingerprint } from '../lib/findings.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { findingIds, markLegacyNoticed, migrationNote, normaliseText, unnoticedLegacy } from '../lib/findingid.mjs'

type R = Record<string, any>
type Item = { file: string; line: number; message?: string }
const BAD = 'const x = run(userInput)'
const MSG = 'unsafe call of a variable'
let dir: string
let home: string
let env: NodeJS.ProcessEnv

const write = (file: string, lines: string[]) => {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), lines.join('\n'))
}
// A run with the given findings of one check, built the way a real run builds them. A message that names its own position is how a check
// that cannot leave it out writes one: "... at L5".
const build = (items: Item[]) => {
  const sink = new Map<string, R>([['chk', { findings: items.map((i) => ({ severity: 'high', rule: 'unsafe-call', file: i.file, line: i.line, message: i.message ?? MSG })), output: '' }]])
  const results: R[] = [{ id: 'chk', title: 'Check', status: 'FAIL', ms: 1 }]
  const checks: R[] = [{ id: 'chk', title: 'Check', group: 'security' }]
  const meta = { version: 't', runId: 'r1', preset: 'quick', tier: 'quick', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), ms: 1 }
  const doc = buildFindings({ results, checks, sink, appDir: dir, repoRoot: dir, env, meta })
  return { doc, sink, results }
}
const at = (n: number) => `${MSG} at L${n} (${n}, 4) col ${n}`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mk-ids-'))
  home = mkdtempSync(join(tmpdir(), 'mk-ids-home-'))
  env = { ...process.env, MEERKAT_LOG_DIR: home }
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('stable finding ids', () => {
  test('the same finding keeps its id when it moves from line 5 to line 9, even when the message names the position', () => {
    write('src/a.js', ['// 1', '// 2', '// 3', '// 4', BAD])
    const a = build([{ file: 'src/a.js', line: 5, message: at(5) }]).doc.findings[0]
    write('src/a.js', ['// 1', '// 2', '// 3', '// 4', '// 5', '// 6', '// 7', '// 8', BAD])
    const b = build([{ file: 'src/a.js', line: 9, message: at(9) }]).doc.findings[0]
    expect(a.id).toMatch(/^[0-9a-f]{16}$/)
    expect(b.id).toBe(a.id)
    expect(a.line).toBe(5)
    expect(b.line).toBe(9)
  })
  test('a copy of the same text in a second file is a different finding', () => {
    write('src/a.js', [BAD])
    write('src/b.js', [BAD])
    const { doc } = build([{ file: 'src/a.js', line: 1 }, { file: 'src/b.js', line: 1 }])
    expect(doc.findings).toHaveLength(2)
    expect(new Set(doc.findings.map((f: R) => f.id)).size).toBe(2)
  })
  test('a different message in the same file is a different finding', () => {
    write('src/a.js', [BAD])
    const { doc } = build([{ file: 'src/a.js', line: 1 }, { file: 'src/a.js', line: 50, message: 'another problem entirely' }])
    expect(doc.findings).toHaveLength(2)
  })
  test('the same text on several lines of one file is still one finding with its lines listed', () => {
    write('src/a.js', [BAD])
    const { doc } = build([{ file: 'src/a.js', line: 1, message: at(1) }, { file: 'src/a.js', line: 60, message: at(60) }])
    expect(doc.findings).toHaveLength(1)
    expect(doc.findings[0].occurrences).toBe(2)
  })
  test('a message with no position hashes exactly as before, so its id does not change', () => {
    const ids = findingIds({ rule: 'r', check: 'c', file: 'x.js', message: 'plain words' })
    expect(ids.id).toBe(ids.legacyId)
    expect(ids.id).toBe(fingerprint({ rule: 'r', check: 'c', file: 'x.js', message: 'plain words' }))
    write('src/a.js', [BAD])
    expect(build([{ file: 'src/a.js', line: 1 }]).doc.findings[0].legacyId).toBeUndefined()
  })
  test('a message with a position the old id missed keeps the old id as legacyId', () => {
    write('src/a.js', [BAD])
    const f = build([{ file: 'src/a.js', line: 1, message: at(1) }]).doc.findings[0]
    expect(f.legacyId).toBe(fingerprint({ rule: 'unsafe-call', check: 'chk', file: 'src/a.js', message: at(1) }))
    expect(f.legacyId).not.toBe(f.id)
  })
  test('normaliseText ignores every position form and case', () => {
    expect(normaliseText('Bad at L12 and line9 (3, 4) col 7 x.js:5:2')).toBe(normaliseText('bad at L99 and line1 (8, 9) column 2 x.js:70:1'))
  })
})

describe('dismissals follow the id', () => {
  const dismiss = (f: R) => saveAccepted('dismissed', env, dir, dismissalDoc(withDismissal(readDismissals(env, dir), { id: f.id, rule: f.rule, check: f.check, file: f.file, title: f.title, reason: 'test reason' })))
  const apply = (b: R) => applyAccepted(b.results, b.sink, acceptedSets({ env, projectPath: dir }), b.doc.findings, b.doc.hiddenChecks)

  test('dismissed on line 5, still dismissed after the code moves to line 9', () => {
    write('src/a.js', ['// 1', '// 2', '// 3', '// 4', BAD])
    dismiss(build([{ file: 'src/a.js', line: 5, message: at(5) }]).doc.findings[0])
    write('src/a.js', ['// 1', '// 2', '// 3', '// 4', '// 5', '// 6', '// 7', '// 8', BAD])
    const b = build([{ file: 'src/a.js', line: 9, message: at(9) }])
    const records = apply(b)
    expect(records).toHaveLength(1)
    expect(b.results[0].status).toBe('PASS')
  })
  test('a new copy in a second file is not covered by the dismissal', () => {
    write('src/a.js', [BAD])
    write('src/b.js', [BAD])
    dismiss(build([{ file: 'src/a.js', line: 1 }]).doc.findings[0])
    const b = build([{ file: 'src/a.js', line: 1 }, { file: 'src/b.js', line: 1 }])
    apply(b)
    expect(b.results[0].status).toBe('FAIL')
  })
  test('an old dismissal made under the old id still matches, and the migration is said once', () => {
    write('src/a.js', [BAD])
    const legacy = fingerprint({ rule: 'unsafe-call', check: 'chk', file: 'src/a.js', message: at(5) })
    saveAccepted('dismissed', env, dir, dismissalDoc(withDismissal([], { id: legacy, rule: 'unsafe-call', check: 'chk', file: 'src/a.js', title: 't', reason: 'old one' })))
    const b = build([{ file: 'src/a.js', line: 5, message: at(5) }])
    const records = apply(b)
    expect(b.results[0].status).toBe('PASS')
    expect(records[0].matchedLegacyId).toBe(legacy)
    const fresh = unnoticedLegacy(env, dir, [legacy])
    expect(fresh).toEqual([legacy])
    expect(migrationNote(fresh)).toMatch(/matched by the old id/)
    expect(markLegacyNoticed(env, dir, fresh)).toBe(true)
    expect(unnoticedLegacy(env, dir, [legacy])).toEqual([])
    expect(migrationNote([])).toBeNull()
    // the dismissal itself is still there and still matches after being marked
    const b2 = build([{ file: 'src/a.js', line: 5, message: at(5) }])
    apply(b2)
    expect(b2.results[0].status).toBe('PASS')
  })
  test('an old dismissal for another file does not match', () => {
    write('src/a.js', [BAD])
    const other = fingerprint({ rule: 'unsafe-call', check: 'chk', file: 'src/other.js', message: at(5) })
    saveAccepted('dismissed', env, dir, dismissalDoc(withDismissal([], { id: other, check: 'chk', file: 'src/other.js', title: 't', reason: 'r' })))
    const b = build([{ file: 'src/a.js', line: 5, message: at(5) }])
    apply(b)
    expect(b.results[0].status).toBe('FAIL')
  })
})
