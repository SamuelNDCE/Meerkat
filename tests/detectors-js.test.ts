// The JavaScript and web detectors (knip, cspell, htmlhint, size-limit, Lighthouse): REAL recorded output of each tool (tests/fixtures/detectors/)
// on a small broken project and on its clean twin. Both sides are tested: the defect is found, the clean twin passes. No tool has to be installed.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { confirmFindings } from '../lib/confirm.mjs'
// @ts-expect-error plain JS module
import { parseCspell, parseHtmlhint, parseKnip, parseLighthouse, parseSizeLimit } from '../thorough/detectors.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = join(ROOT, 'tests/fixtures/detectors')
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const json = (name: string) => JSON.parse(readFileSync(join(FX, name), 'utf8'))
function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough/detectors.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })
  const out = `${r.stdout}${r.stderr}`
  return { code: r.status, out, findings: out.split(/\r?\n/).filter((l) => l.startsWith('MEERKAT-FINDING')) }
}
const TOOLS = [
  ['knip-unused', 'knip', 4],
  ['cspell-spelling', 'cspell', 2],
  ['htmlhint-html', 'htmlhint', 3],
  ['size-limit-budget', 'size-limit', 1],
  ['lighthouse-page', 'lighthouse', 6],
] as const

describe('both sides: the planted defect is found, the clean twin passes', () => {
  for (const [id, base, count] of TOOLS) {
    test(`${id}: recorded output of the broken project gives ${count} finding(s), exit 1`, () => {
      const r = run([id, '--sample', join(FX, `${base}.json`)])
      expect(r.code, r.out).toBe(1)
      expect(r.findings).toHaveLength(count)
    })
    test(`${id}: recorded output of the clean twin gives no findings, exit 0`, () => {
      const r = run([id, '--sample', join(FX, `${base}-clean.json`)])
      expect(r.code, r.out).toBe(0)
      expect(r.findings).toHaveLength(0)
    })
  }
})

describe('what each parser keeps (real output)', () => {
  test('knip: unused file, dependency and export, with the export line', () => {
    const f = parseKnip(json('knip.json'))
    expect(f.map((x: any) => x.rule).sort()).toEqual(['knip-unused-dependency', 'knip-unused-devdependency', 'knip-unused-export', 'knip-unused-file'])
    expect(f.find((x: any) => x.rule === 'knip-unused-export')).toMatchObject({ file: 'lib.js', line: 2 })
    expect(f.find((x: any) => x.rule === 'knip-unused-dependency')).toMatchObject({ file: 'package.json' })
    expect(f.some((x: any) => x.file === 'orphan.js' && x.rule === 'knip-unused-file')).toBe(true)
  })
  test('cspell: one finding per file and word, with the suggestion, no machine path', () => {
    const f = parseCspell(json('cspell.json'))
    expect(f.map((x: any) => x.message).join('|')).toMatch(/documnet.*document/)
    expect(f.every((x: any) => x.severity === 'low' && x.line === 2)).toBe(true)
    expect(JSON.stringify(f)).not.toMatch(/Users|[A-Z]:/)
    const dup = json('cspell.json')
    dup.issues.push(dup.issues[0])
    expect(parseCspell(dup)).toHaveLength(f.length)
  })
  test('htmlhint: rule ids, line, error vs warning', () => {
    const f = parseHtmlhint(json('htmlhint.json'))
    expect(f.map((x: any) => x.rule).sort()).toEqual(['htmlhint-doctype-first', 'htmlhint-id-unique', 'htmlhint-tag-pair'])
    expect(f.every((x: any) => x.line === 1 && x.severity === 'medium')).toBe(true)
  })
  test('size-limit: only a failed limit is a finding', () => {
    expect(parseSizeLimit(json('size-limit.json'))).toMatchObject([{ rule: 'size-limit-exceeded', file: 'index.js' }])
    expect(parseSizeLimit([{ name: 'a.js', passed: true, size: 1, sizeLimit: 2 }])).toEqual([])
  })
  test('lighthouse: only audits that fail outright, in accessibility and best-practices', () => {
    const f = parseLighthouse(json('lighthouse.json'))
    const rules = f.map((x: any) => x.rule)
    for (const r of ['lighthouse-image-alt', 'lighthouse-html-has-lang', 'lighthouse-document-title', 'lighthouse-doctype', 'lighthouse-charset', 'lighthouse-landmark-one-main']) expect(rules).toContain(r)
    expect(f.find((x: any) => x.rule === 'lighthouse-image-alt').severity).toBe('medium')
    expect(f.find((x: any) => x.rule === 'lighthouse-charset').severity).toBe('low')
  })
})

describe('NOT RUN, never a pass', () => {
  test('a missing tool is NOT RUN (75) with an install hint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-js-'))
    made.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', 'size-limit': [{ path: 'a.js', limit: '1 kB' }] }))
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    const env = { PATH: '', Path: '', MEERKAT_TOOLS_HOME: join(dir, 'no-tools') }
    for (const [id, hint] of [['knip-unused', 'knip'], ['cspell-spelling', 'cspell'], ['size-limit-budget', 'size-limit'], ['lighthouse-page', 'lighthouse']] as const) {
      const r = run([id, '--root', dir], env)
      expect(r.code, `${id}: ${r.out}`).toBe(75)
      expect(r.out).toContain('NOT RUN')
      expect(r.out).toContain(`npm install --prefix ~/.meerkat-tools/js`)
      expect(r.out).toContain(hint)
    }
  })
  test('size-limit and Lighthouse do nothing on a project that has no configuration or page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-js-'))
    made.push(dir)
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}')
    expect(run(['size-limit-budget', '--root', dir]).code).toBe(0)
    expect(run(['lighthouse-page', '--root', dir]).code).toBe(0)
  })
  test('output that is not what the tool prints is NOT RUN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-js-'))
    made.push(dir)
    const f = join(dir, 'x.json')
    writeFileSync(f, 'not json')
    for (const id of ['knip-unused', 'cspell-spelling', 'htmlhint-html', 'size-limit-budget', 'lighthouse-page']) expect(run([id, '--sample', f]).code, id).toBe(75)
    writeFileSync(f, '{"runtimeError":{"message":"no chrome"}}')
    expect(run(['lighthouse-page', '--sample', f]).code).toBe(75)
  })
})

describe('the pack and the merge classes', () => {
  test('five new checks, opt-in with a self-test; spelling needs its own opt-in', async () => {
    const checks = (await loadChecks(join(ROOT, 'packs/detectors'))) as any[]
    for (const [id] of TOOLS) {
      const c = checks.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      expect(c.selfTest.expectFail).toBe(true)
      expect(c.install).toContain('~/.meerkat-tools/js')
      expect(c.optIn).toBe(id === 'cspell-spelling' ? 'spelling' : 'detectors')
    }
  })
  test('knip and another dead-code check on the same export line are one finding; a finding with no line never merges', () => {
    let n = 0
    const f = (over: Record<string, unknown>) => ({ id: `i${++n}`, severity: 'low', suite: 'x', check: 'a', rule: null, file: 'lib.js', line: 2, lines: [2], occurrences: 1, message: 'm', confidence: 'medium', ...over })
    const a = f({ check: 'knip-unused', rule: 'knip-unused-export' })
    const b = f({ check: 'dead-code', rule: 'unused-export' })
    const map = new Map([a, b].map((x) => [x.id, x]))
    confirmFindings(map)
    expect(map.size).toBe(1)
    const c = f({ check: 'knip-unused', rule: 'knip-unused-file', line: 0, lines: [0] })
    const d = f({ check: 'dead-code', rule: 'unused-file', line: 0, lines: [0] })
    const m2 = new Map([c, d].map((x) => [x.id, x]))
    confirmFindings(m2)
    expect(m2.size).toBe(2)
  })
})
