// Kind 3, adversarial inputs: odd folders and files. Meerkat must not crash (no stack trace, no hang) and must say what it did or skipped.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { cleanup, commitAll, makeProject, meerkat, scratch, tinyNodeFiles, writeTree } from './harness.mjs'

vi.setConfig({ testTimeout: 180_000 })
afterAll(cleanup)

const CHECKS = ['--preset', 'quick', '--only', 'secret-scan,whitespace,json-valid,links,risky-code,large-files,sensitive-files', '--all']
const STACK = /\n\s+at (?:\w+\.)?\w+ \(.*\.mjs:\d+|TypeError:|RangeError:|Unhandled|ERR_UNHANDLED|FATAL ERROR|heap out of memory/

// What every adversarial run must satisfy: it ended on its own, nothing leaked a stack trace, and it said something about what happened.
function sane(run: any, label: string) {
  expect(run.timedOut, `${label}: hung`).toBe(false)
  expect(run.out, `${label}: stack trace in output`).not.toMatch(STACK)
  expect(run.out.trim().length, `${label}: said nothing`).toBeGreaterThan(0)
  expect(run.code, `${label}: no exit code (killed by ${run.signal})`).not.toBeNull()
  expect([0, 1, 2]).toContain(run.code)
}

describe('adversarial inputs', () => {
  test('an empty folder is refused with a plain reason, not a crash', () => {
    const dir = join(scratch(), 'empty')
    mkdirSync(dir)
    const run = meerkat(dir, CHECKS)
    sane(run, 'empty')
    expect(run.code).toBe(2)
    expect(run.out).toMatch(/not a project|no project|nothing to check|empty/i)
  })

  test('an empty folder with --force still runs and ends cleanly', () => {
    const dir = join(scratch(), 'empty-force')
    mkdirSync(dir)
    const run = meerkat(dir, [...CHECKS, '--force'])
    sane(run, 'empty --force')
  })

  test('a folder with only binary files is handled and the binaries are not read as text', () => {
    const dir = makeProject({ 'a.bin': Buffer.from([0, 255, 1, 254, 0, 0, 7]), 'img/logo.png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), 'data/blob.dat': Buffer.alloc(4096, 0xff) })
    const run = meerkat(dir, [...CHECKS, '--force'])
    sane(run, 'binaries only')
    if (run.findings) expect((run.findings.findings ?? []).filter((f: any) => f.severity === 'critical' || f.severity === 'high').map((f: any) => [f.check, f.file])).toEqual([])
  })

  test('a 5 MB file does not crash or stall the checks and is reported as large or skipped, not as a text finding storm', () => {
    const big = `${'const value = 1\n'.repeat(Math.ceil((5 * 1024 * 1024) / 15))}`
    const dir = makeProject(tinyNodeFiles({ 'src/big.js': big }))
    const run = meerkat(dir, CHECKS)
    sane(run, '5 MB file')
    expect(run.summary).not.toBeNull()
    expect(run.ms).toBeLessThan(150_000)
    expect((run.findings?.findings ?? []).length).toBeLessThan(50)
  })

  test('CRLF files and a UTF-8 BOM do not crash the checks and a BOM alone is not a secret or a bug', () => {
    const dir = makeProject({
      ...tinyNodeFiles(),
      'src/crlf.js': 'export const a = 1\r\nexport const b = 2\r\n',
      'src/bom.js': '\uFEFFexport const c = 3\n',
      'src/bom-crlf.json': '\uFEFF{\r\n  "ok": true\r\n}\r\n',
      'docs/notes.md': '# Notes\r\n\r\nPlain text.\r\n',
    })
    const run = meerkat(dir, CHECKS)
    sane(run, 'crlf+bom')
    expect(run.summary).not.toBeNull()
    expect((run.findings?.findings ?? []).filter((f: any) => ['critical', 'high'].includes(f.severity))).toEqual([])
  })

  test('unicode file names (accents, CJK, emoji, a right-to-left name) are listed and checked, not dropped or crashed on', () => {
    const dir = makeProject({
      ...tinyNodeFiles(),
      'src/café.js': 'export const cafe = 1\n',
      'src/日本語.js': 'export const nihongo = 1\n',
      'docs/emoji-🦦.md': '# otter\n',
      'src/مرحبا.js': 'export const marhaba = 1\n',
    })
    const run = meerkat(dir, CHECKS)
    sane(run, 'unicode names')
    expect(run.summary).not.toBeNull()
    expect(run.out).not.toMatch(/\uFFFD{2,}/)
  })

  test('a path with spaces (and a bracket and an apostrophe) works', () => {
    const base = scratch()
    const dir = join(base, "my project (copy) it's")
    mkdirSync(dir, { recursive: true })
    writeTree(dir, tinyNodeFiles({ 'src/with space.js': 'export const s = 1\n' }))
    commitAll(dir)
    const run = meerkat(dir, CHECKS)
    sane(run, 'spaces')
    expect(run.summary).not.toBeNull()
    expect(run.code).toBeLessThanOrEqual(1)
  })

  test('a symlink loop does not hang or crash the run', () => {
    const dir = makeProject(tinyNodeFiles())
    let linked = true
    try {
      mkdirSync(join(dir, 'loop'))
      symlinkSync(join(dir, 'loop'), join(dir, 'loop', 'again'), 'junction')
      symlinkSync('b', join(dir, 'a'))
      symlinkSync('a', join(dir, 'b'))
    } catch {
      linked = false // no permission to make links here (Windows without developer mode): the run below still has to be sane
    }
    const run = meerkat(dir, CHECKS)
    sane(run, `symlink loop (links made: ${linked})`)
    expect(run.ms).toBeLessThan(150_000)
  })
})

describe('adversarial inputs: the large-file edge', () => {
  const secret = `const t = "ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}"\n`
  const bigWithSecret = () => makeProject(tinyNodeFiles({ 'src/k.js': `${'const value = 1\n'.repeat(350_000)}${secret}` }))

  test('a 5 MB file is reported by the large-files check, by name', () => {
    const run = meerkat(makeProject(tinyNodeFiles({ 'src/big.js': 'const value = 1\n'.repeat(350_000) })), CHECKS)
    expect((run.findings?.findings ?? []).some((f: any) => f.check === 'large-files' && f.file === 'src/big.js')).toBe(true)
  })

  // KNOWN GAP (found by this suite, 2026-11-06): secret-scan skips every file over 1 MB (MAX_BYTES in thorough/secret-scan.mjs) without saying so, and
  // reports "no secrets found". A token in a big file passes. test.fails keeps the suite green while the gap is open and turns red when it is fixed, so
  // the marker has to be removed then.
  test.fails('secret-scan either finds a token in a file over 1 MB or says it skipped that file', () => {
    const run = meerkat(bigWithSecret(), ['--preset', 'quick', '--only', 'secret-scan', '--all'])
    const detail = String(run.results.find((r: any) => r.id === 'secret-scan')?.detail ?? '')
    expect(/possible secret|skipped|too large|over 1 ?MB|not scanned/i.test(detail), detail).toBe(true)
  })
})
