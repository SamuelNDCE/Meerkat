// The release gate's `counts` step: the pure exit mapping, the check-only mode of the generators (writes nothing), and a drifted document.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { judgeCounts } from '../tools/release/gate.mjs'
// @ts-expect-error plain JS module
import { createSink } from '../tools/check-mode.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const tmps: string[] = []
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })
const ok = (name: string) => ({ name, code: 0, stdout: '', stderr: '' })

describe('judgeCounts: the exit mapping', () => {
  const all = ['gen-checks', 'gen-coverage', 'make-badges', 'count-audit']
  test('0 when everything is current', () => {
    const r = judgeCounts(all.map(ok))
    expect(r.exit).toBe(0)
    expect(r.status).toBe('pass')
  })
  test('1 when a document drifted, naming the file and the fix', () => {
    const r = judgeCounts([
      { name: 'gen-checks', code: 1, stdout: 'docs/checks.md is out of date\n', stderr: '' },
      ...all.slice(1).map(ok),
    ])
    expect(r.exit).toBe(1)
    expect(r.status).toBe('fail')
    expect(r.note).toContain('docs/checks.md')
    expect(r.note).toContain('run node tools/gen-checks.mjs to fix')
  })
  test('the fix names the generator that found the drift', () => {
    const r = judgeCounts([ok('gen-checks'), { name: 'gen-coverage', code: 1, stdout: 'docs/coverage.md is out of date\n', stderr: '' }, ok('make-badges'), ok('count-audit')])
    expect(r.note).toContain('run node tools/gen-coverage.mjs to fix')
  })
  test('a failing count-audit test is a drift (1)', () => {
    const r = judgeCounts([...all.slice(0, 3).map(ok), { name: 'count-audit', code: 1, stdout: 'FAIL docs/checks.md headline', stderr: '' }])
    expect(r.exit).toBe(1)
    expect(r.note).toContain('run node tools/gen-checks.mjs to fix')
  })
  test('75 when a generator cannot run (crash code 2, spawn failure 127)', () => {
    expect(judgeCounts([{ name: 'gen-checks', code: 2, stdout: '', stderr: 'boom' }, ...all.slice(1).map(ok)]).exit).toBe(75)
    const r = judgeCounts([ok('gen-checks'), ok('gen-coverage'), { name: 'make-badges', code: 127, stdout: '', stderr: 'spawn failed' }, ok('count-audit')])
    expect(r.exit).toBe(75)
    expect(r.status).toBe('notrun')
  })
  test('a drift beats a generator that could not run (1, like the other steps)', () => {
    const r = judgeCounts([{ name: 'gen-checks', code: 2, stdout: '', stderr: 'boom' }, { name: 'gen-coverage', code: 1, stdout: 'docs/coverage.md is out of date\n', stderr: '' }, ok('make-badges'), ok('count-audit')])
    expect(r.exit).toBe(1)
  })
})

describe('check mode of the generators', () => {
  test('a sink in check mode writes nothing and reports a drifted document with exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-counts-'))
    tmps.push(dir)
    const doc = join(dir, 'checks.md')
    writeFileSync(doc, 'old text\n')
    const lines: string[] = []
    const sink = createSink(['--check'], { script: 'tools/gen-checks.mjs', log: (l: string) => lines.push(l) })
    sink.write(doc, 'new text\n', 'docs/checks.md')
    expect(readFileSync(doc, 'utf8')).toBe('old text\n')
    expect(sink.finish()).toBe(1)
    const joined = lines.join('\n')
    expect(joined).toContain('docs/checks.md')
    const j = judgeCounts([{ name: 'gen-checks', code: 1, stdout: joined, stderr: '' }])
    expect(j.exit).toBe(1)
    expect(j.note).toContain('docs/checks.md')
  })
  test('a sink in check mode is quiet and exit 0 when the document is current (CRLF ignored)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-counts-'))
    tmps.push(dir)
    const doc = join(dir, 'checks.md')
    writeFileSync(doc, 'same\r\ntext\r\n')
    const sink = createSink(['--check'], { script: 'tools/gen-checks.mjs', log: () => {} })
    sink.write(doc, 'same\ntext\n', 'docs/checks.md')
    expect(sink.finish()).toBe(0)
  })
  test('a missing document counts as drift', () => {
    const sink = createSink(['--check'], { script: 'tools/gen-checks.mjs', log: () => {} })
    sink.write(join(tmpdir(), 'meerkat-does-not-exist.md'), 'x', 'docs/nope.md')
    expect(sink.finish()).toBe(1)
  })
  test('without --check the sink writes the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-counts-'))
    tmps.push(dir)
    const doc = join(dir, 'x.md')
    const sink = createSink([], { script: 'tools/gen-checks.mjs', log: () => {} })
    sink.write(doc, 'hello\n', 'x.md')
    expect(readFileSync(doc, 'utf8')).toBe('hello\n')
    expect(sink.finish()).toBe(0)
  })
  test.each(['gen-checks', 'gen-coverage', 'make-badges'])('%s --check exits 0 or 1 and changes no file', (name) => {
    const files = ['README.md', 'docs/checks.md', 'docs/coverage.md']
    const before = files.map((f) => statSync(join(ROOT, f)).mtimeMs)
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', `${name}.mjs`), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 })
    expect([0, 1]).toContain(r.status)
    if (r.status === 1) expect(r.stdout).toMatch(/is out of date/)
    expect(files.map((f) => statSync(join(ROOT, f)).mtimeMs)).toEqual(before)
  })
})
